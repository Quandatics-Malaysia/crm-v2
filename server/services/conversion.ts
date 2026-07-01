import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { runInTenant } from "@/db"
import {
  leads,
  accounts,
  persons,
  opportunities,
  funnels,
  funnelStages,
  opportunityStageHistory,
} from "@/db/schema"
import { FIRST_STAGE_CODE } from "@/lib/funnel-stages"
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
  opportunityId: string | null
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
    expectedCloseDate?: string | null
    existingAccountId?: string | null
    /** Details for the account created on the new-account path (optional). */
    newAccount?: {
      accountType?: "client" | "reseller" | null
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
          ownerMemberId: lead.ownerMemberId ?? ctx.memberId,
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

    // Optional opportunity at the first stage of the default funnel.
    let opportunityId: string | null = null
    if (input.createOpportunity) {
      const [defaultFunnel] = await tx
        .select()
        .from(funnels)
        .where(and(eq(funnels.tenantId, ctx.tenantId), eq(funnels.isDefault, true)))
        .limit(1)
      const funnel =
        defaultFunnel ??
        (
          await tx
            .select()
            .from(funnels)
            .where(eq(funnels.tenantId, ctx.tenantId))
            .limit(1)
        )[0]

      if (funnel) {
        const [stage] = await tx
          .select()
          .from(funnelStages)
          .where(
            and(
              eq(funnelStages.funnelId, funnel.id),
              eq(funnelStages.code, FIRST_STAGE_CODE)
            )
          )
          .limit(1)
        if (stage) {
          const [opp] = await tx
            .insert(opportunities)
            .values({
              tenantId: ctx.tenantId,
              name: input.opportunityName || `${lead.companyName || lead.name} opportunity`,
              accountId,
              primaryPersonId: person.id,
              funnelId: funnel.id,
              currentStageId: stage.id,
              ownerMemberId: lead.ownerMemberId ?? ctx.memberId ?? "",
              currency: "MYR",
              expectedCloseDate: input.expectedCloseDate ?? null,
            })
            .returning()
          opportunityId = opp.id
          await tx.insert(opportunityStageHistory).values({
            tenantId: ctx.tenantId,
            opportunityId: opp.id,
            toStageId: stage.id,
            changedByMemberId: ctx.memberId,
            probabilityAtChange: stage.probability,
            source: "manual",
          })
        }
      }
    }

    await tx
      .update(leads)
      .set({
        status: "converted",
        convertedAccountId: accountId,
        convertedPersonId: person.id,
        convertedOpportunityId: opportunityId,
        convertedAt: new Date(),
      })
      .where(eq(leads.id, input.leadId))

    await writeAudit(tx, ctx, {
      action: "lead.converted",
      entityType: "lead",
      entityId: input.leadId,
      after: { accountId, personId: person.id, opportunityId },
    })

    return { accountId, personId: person.id, opportunityId }
  })
}
