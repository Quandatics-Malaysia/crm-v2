import "server-only"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { runInTenant } from "@/db"
import {
  leads,
  accounts,
  persons,
  funnels,
  pipelines,
  pipelineStages,
  funnelStageHistory,
} from "@/db/schema"
import { FIRST_STAGE_CODE } from "@/lib/funnel-stages"
import {
  tenantConfiguredCurrency,
  tenantCurrencyForRecord,
} from "./tenant-currency"
import {
  createOpportunityContainer,
  recomputeOpportunityTotal,
} from "./opportunity-container"
import { writeAudit } from "@/server/audit"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import type { ServerContext } from "@/lib/server-context"

export type ConversionResult = {
  accountId: string
  personId: string
  /** The created Opportunity container (null when createOpportunity was false). */
  opportunityId: string | null
}

export function resolveDefaultSalesFunnel(
  pipelines: readonly {
    id: string
    isDefault: boolean
    name?: string
    tenantId?: string
  }[],
  stages: readonly {
    id: string
    pipelineId: string
    code: string
    kind: string
    sortOrder: number
    tenantId?: string
  }[],
  tenantId?: string
): { pipelineId: string; stageId: string } {
  const funnel = pipelines.find(
    (pipeline) =>
      pipeline.isDefault && (!tenantId || !pipeline.tenantId || pipeline.tenantId === tenantId)
  )
  if (!funnel) throw new Error("No default Sales Funnel configured")
  const stage = stages
    .filter(
      (candidate) =>
        candidate.pipelineId === funnel.id &&
        (!tenantId || !candidate.tenantId || candidate.tenantId === tenantId) &&
        candidate.code === FIRST_STAGE_CODE &&
        candidate.kind === "OPEN"
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)[0]
  if (!stage) throw new Error("Default Sales Funnel has no OPEN 0E stage")
  return { pipelineId: funnel.id, stageId: stage.id }
}

/**
 * Atomically convert a qualified lead into an Account + Person (+ optional
 * Opportunity seeded at stage 0e). Carries owner & source; links the lead back
 * to the created records and marks it converted.
 */
export async function convertLead(
  ctx: ServerContext,
  input: {
    leadId: string
    createOpportunity?: boolean
    opportunityName?: string
    /** Funnel's own name — defaults to opportunityName when omitted. */
    funnelName?: string
    expectedCloseDate?: string | null
    existingAccountId?: string | null
    /** Details for the account created on the new-account path (optional). */
    newAccount?: {
      accountType?: "client" | "reseller" | null
      /** Compulsory company code for the created account. */
      code?: string | null
      phone?: string | null
      address?: {
        line1?: string | null
        line2?: string | null
        city?: string | null
        state?: string | null
        postcode?: string | null
        country?: string | null
      } | null
    } | null
  }
): Promise<ConversionResult> {
  return runInTenant(ctx.tenantId, async (tx) => {
    // Lock the lead row so two concurrent converts can't both proceed (TOCTOU).
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), isNull(leads.deletedAt)))
      .limit(1)
      .for("update")
    if (!lead) throw new Error("Lead not found")
    if (lead.status === "converted") throw new Error("Lead already converted")

    // A contact must carry an email. New leads always have one (enforced on
    // create/update), but guard here too so legacy/imported leads can't convert
    // into an email-less contact.
    if (!lead.email?.trim())
      throw new Error("This lead has no email. Add a valid email before converting.")

    // Account: attach to an existing one, or create from the company name. When
    // attaching to a caller-supplied account, validate it exists in this tenant
    // and the caller owns/manages it (mirrors createPerson) — closes the
    // cross-tenant FK / record-scope bypass.
    let accountId = input.existingAccountId ?? null
    if (accountId) {
      const visible = await visibleMemberIds(tx, ctx)
      const [dest] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
        .limit(1)
      if (!dest) throw new Error("Account not found")
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, dest.ownerMemberId)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }
    }
    if (!accountId) {
      // Company code is compulsory on the new-account path (used in project
      // codes). Validate its format and tenant-uniqueness here too — the dialog
      // pre-checks, but the server is authoritative.
      const code = (input.newAccount?.code ?? "").trim().toUpperCase()
      if (!/^[A-Z0-9]{2,6}$/.test(code))
        throw new Error(
          "A company code (2–6 letters/digits) is required for the new account"
        )
      const [dup] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.tenantId, ctx.tenantId),
            eq(sql`upper(${accounts.code})`, code),
            isNull(accounts.deletedAt)
          )
        )
        .limit(1)
      if (dup) throw new Error("Company code already used by another account")

      // Keep only the populated address fields (drop empties) so we never store
      // an object of all-nulls in the jsonb column.
      const rawAddress = input.newAccount?.address ?? null
      const addressEntries = rawAddress
        ? Object.entries(rawAddress).filter(([, v]) => v != null && v !== "")
        : []
      const billingAddress = addressEntries.length
        ? Object.fromEntries(addressEntries)
        : null

      const [acc] = await tx
        .insert(accounts)
        .values({
          tenantId: ctx.tenantId,
          name: lead.companyName || lead.name,
          code,
          ownerMemberId: lead.ownerMemberId ?? ctx.memberId,
          currency: await tenantConfiguredCurrency(tx, ctx.tenantId, undefined),
          accountType:
            input.newAccount?.accountType === "reseller" ? "reseller" : "client",
          phone: input.newAccount?.phone?.trim() || null,
          billingAddress,
        })
        .returning()
      accountId = acc.id
    }

    // Person under that account.
    const parts = (lead.name || "").trim().split(/\s+/)
    const firstName = parts[0] || lead.name || "Contact"
    const lastName = parts.slice(1).join(" ") || null
    const [person] = await tx
      .insert(persons)
      .values({
        tenantId: ctx.tenantId,
        accountId,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        isPrimary: true,
      })
      .returning()

    // Optional Opportunity container (+ first funnel) at the first stage.
    let containerId: string | null = null
    if (input.createOpportunity) {
      const [defaultFunnel] = await tx
        .select({
          id: pipelines.id,
          name: pipelines.name,
          isDefault: pipelines.isDefault,
          tenantId: pipelines.tenantId,
        })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)))
        .limit(1)
      const stages = defaultFunnel
        ? await tx
            .select()
            .from(pipelineStages)
            .where(
              and(
                eq(pipelineStages.pipelineId, defaultFunnel.id),
                eq(pipelineStages.code, FIRST_STAGE_CODE),
                eq(pipelineStages.kind, "OPEN")
              )
            )
            .orderBy(asc(pipelineStages.sortOrder))
        : []
      const resolved = resolveDefaultSalesFunnel(
        defaultFunnel ? [defaultFunnel] : [],
        stages,
        ctx.tenantId
      )
      const stage = stages.find((candidate) => candidate.id === resolved.stageId)!
      const dealName =
        input.opportunityName || `${lead.companyName || lead.name} opportunity`
      const funnelName = input.funnelName || dealName
      const [account] = await tx
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1)
      const currency = await tenantCurrencyForRecord(
        tx,
        ctx.tenantId,
        undefined,
        account?.currency
      )
      const ownerMemberId = lead.ownerMemberId ?? ctx.memberId ?? ""
      // Lead → Opportunity CONTAINER, with a first funnel under it.
      const container = await createOpportunityContainer(tx, ctx, {
        accountId,
        ownerMemberId,
        name: dealName,
        year: input.expectedCloseDate
          ? Number(input.expectedCloseDate.slice(0, 4))
          : null,
        currency,
        primaryPersonId: person.id,
      })
      containerId = container.id
      const [opp] = await tx
        .insert(funnels)
        .values({
          tenantId: ctx.tenantId,
          opportunityId: container.id,
          name: funnelName,
          accountId,
          primaryPersonId: person.id,
          pipelineId: resolved.pipelineId,
          currentStageId: stage.id,
          ownerMemberId,
          currency,
          expectedCloseDate: input.expectedCloseDate ?? null,
        })
        .returning()
      await tx.insert(funnelStageHistory).values({
        tenantId: ctx.tenantId,
        funnelId: opp.id,
        toStageId: stage.id,
        changedByMemberId: ctx.memberId,
        probabilityAtChange: stage.probability,
        source: "manual",
      })
      await recomputeOpportunityTotal(tx, ctx.tenantId, container.id)
    }

    await tx
      .update(leads)
      .set({
        status: "converted",
        convertedAccountId: accountId,
        convertedPersonId: person.id,
        convertedOpportunityId: containerId,
        convertedAt: new Date(),
      })
      .where(eq(leads.id, input.leadId))

    await writeAudit(tx, ctx, {
      action: "lead.converted",
      entityType: "lead",
      entityId: input.leadId,
      after: { accountId, personId: person.id, opportunityId: containerId },
    })

    return { accountId, personId: person.id, opportunityId: containerId }
  })
}
