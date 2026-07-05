"use server"

import { and, asc, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, type Tx } from "@/lib/actions"
import { db, runInTenant } from "@/db"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import { isDuplicateNumberError } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import {
  financeDocs,
  financeDocKind,
  financeDocStatus,
  salesOrders,
  projects,
  accounts,
  paymentMilestones,
  tenantSettings,
  attachments,
  opportunities,
  organization,
  intercompanyDeals,
  intercompanyDealParties,
  intercompanyDealResponses,
} from "@/db/schema"
import { maybeCompleteProject } from "@/server/services/finance"
import {
  FINANCE_KINDS,
  FINANCE_STATUS_NEXT,
  canAttach,
  kindsForDirection,
  type FinanceDocKind,
} from "@/lib/finance-kinds"
import { partyShare } from "@/lib/interco-share"
import { FINANCE_MODULE } from "@/lib/modules"
import {
  DEFAULT_INVOICE_DUE_DAYS,
  DEFAULT_REMINDER_DAYS,
} from "@/lib/tenant-defaults"
import { toDateString } from "@/lib/dates"

export type FinanceDocStatus = (typeof financeDocStatus.enumValues)[number]

export type FinanceDocRow = {
  id: string
  kind: FinanceDocKind
  number: string
  status: FinanceDocStatus
  partyName: string | null
  amount: string
  currency: string
  docDate: string | null
  dueDate: string | null
  notes: string | null
  parentId: string | null
  parentNumber: string | null
  salesOrderId: string | null
  soNumber: string | null
  projectId: string | null
  projectCode: string | null
  milestoneId: string | null
  reminderStage: number
  lastReminderAt: Date | null
  intercompanyDealId: string | null
  counterpartDocId: string | null
  /** Proof/attachment count (receipts/payments need ≥ 1 to be issued). */
  attachCount: number
  createdAt: Date
}

/** The module is an add-on: every entry point re-checks the master switch
 *  (lib/modules.ts) AND the tenant's backend flag. */
async function assertFinanceEnabled(tx: Tx, tenantId: string): Promise<void> {
  if (!FINANCE_MODULE) {
    throw new Error("The billing & purchasing module is disabled.")
  }
  const [s] = await tx
    .select({ on: tenantSettings.financeModule })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  if (!s?.on) {
    throw new Error("The billing & purchasing module is not enabled for this organization.")
  }
}

/** Whether the finance module is enabled (for nav/pages). */
export async function isFinanceEnabled(): Promise<boolean> {
  if (!FINANCE_MODULE) return false
  return withTenant(PERMISSIONS.FINANCE_VIEW, async (tx, ctx) => {
    const [s] = await tx
      .select({ on: tenantSettings.financeModule })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return s?.on ?? false
  })
}

/** All documents in one direction (sale = O2C, purchase = P2P), newest first. */
export async function listFinanceDocs(
  direction: "sale" | "purchase"
): Promise<FinanceDocRow[]> {
  return withTenant(PERMISSIONS.FINANCE_VIEW, async (tx, ctx) => {
    await assertFinanceEnabled(tx, ctx.tenantId)
    const parent = alias(financeDocs, "parent_doc")
    const rows = await tx
      .select({
        id: financeDocs.id,
        kind: financeDocs.kind,
        number: financeDocs.number,
        status: financeDocs.status,
        partyName: financeDocs.partyName,
        amount: financeDocs.amount,
        currency: financeDocs.currency,
        docDate: financeDocs.docDate,
        dueDate: financeDocs.dueDate,
        notes: financeDocs.notes,
        parentId: financeDocs.parentId,
        parentNumber: parent.number,
        salesOrderId: financeDocs.salesOrderId,
        soNumber: salesOrders.soNumber,
        projectId: financeDocs.projectId,
        projectCode: projects.projectCode,
        milestoneId: financeDocs.milestoneId,
        reminderStage: financeDocs.reminderStage,
        lastReminderAt: financeDocs.lastReminderAt,
        intercompanyDealId: financeDocs.intercompanyDealId,
        counterpartDocId: financeDocs.counterpartDocId,
        attachCount: sql<number>`(select count(*)::int from ${attachments} a where a.attachable_type = 'finance_doc' and a.attachable_id = ${financeDocs.id})`,
        createdAt: financeDocs.createdAt,
      })
      .from(financeDocs)
      .leftJoin(parent, eq(financeDocs.parentId, parent.id))
      .leftJoin(salesOrders, eq(financeDocs.salesOrderId, salesOrders.id))
      .leftJoin(projects, eq(financeDocs.projectId, projects.id))
      .where(inArray(financeDocs.kind, kindsForDirection(direction)))
      .orderBy(desc(financeDocs.createdAt))
      .limit(1000)
    return rows as FinanceDocRow[]
  })
}

/** The tenant's reminder schedule + invoice due window (with defaults). */
async function financeSettings(tx: Tx, tenantId: string) {
  const [s] = await tx
    .select({
      reminderDays: tenantSettings.invoiceReminderDays,
      invoiceDueDays: tenantSettings.invoiceDueDays,
      autoCompleteProjectOnPaid: tenantSettings.autoCompleteProjectOnPaid,
      intercoAutoMirror: tenantSettings.intercoAutoMirror,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  return {
    reminderDays: s?.reminderDays?.length ? s.reminderDays : DEFAULT_REMINDER_DAYS,
    invoiceDueDays: s?.invoiceDueDays ?? DEFAULT_INVOICE_DUE_DAYS,
    autoCompleteProjectOnPaid: s?.autoCompleteProjectOnPaid ?? false,
    intercoAutoMirror: s?.intercoAutoMirror ?? true,
  }
}

/** Reminder schedule for the docs pages (client computes which stage is due). */
export async function getReminderSchedule(): Promise<number[]> {
  return withTenant(PERMISSIONS.FINANCE_VIEW, async (tx, ctx) => {
    return (await financeSettings(tx, ctx.tenantId)).reminderDays
  })
}

export type FinanceSources = {
  /** Approved sales orders — the roots both chains hang off. */
  salesOrders: {
    id: string
    soNumber: string
    projectId: string | null
    projectName: string | null
    accountName: string | null
    currency: string | null
    value: string | null
  }[]
  /** Existing live documents, as parent candidates (filtered by kind in the UI). */
  docs: {
    id: string
    kind: FinanceDocKind
    number: string
    amount: string
    currency: string
  }[]
  /** Pending milestones per project, for the invoice ↔ milestone tie. */
  milestones: { id: string; projectId: string; title: string; amount: string }[]
}

/** Everything the create dialog needs, in one round trip. Managers only —
 *  it enumerates tenant-wide SOs, project values and milestone amounts. */
export async function listFinanceSources(): Promise<FinanceSources> {
  return withTenant(PERMISSIONS.FINANCE_MANAGE, async (tx, ctx) => {
    await assertFinanceEnabled(tx, ctx.tenantId)
    const sos = await tx
      .select({
        id: salesOrders.id,
        soNumber: salesOrders.soNumber,
        projectId: salesOrders.projectId,
        projectName: projects.name,
        accountName: accounts.name,
        currency: projects.currency,
        value: projects.value,
      })
      .from(salesOrders)
      .leftJoin(projects, eq(salesOrders.projectId, projects.id))
      .leftJoin(accounts, eq(projects.accountId, accounts.id))
      .where(eq(salesOrders.status, "approved"))
      .orderBy(desc(salesOrders.reviewedAt))
      .limit(500)
    const docs = await tx
      .select({
        id: financeDocs.id,
        kind: financeDocs.kind,
        number: financeDocs.number,
        amount: financeDocs.amount,
        currency: financeDocs.currency,
      })
      .from(financeDocs)
      .where(inArray(financeDocs.status, ["draft", "issued"]))
      .orderBy(desc(financeDocs.createdAt))
      .limit(500)
    // Pending AND not already carried by a live invoice (drafts included —
    // a drafted milestone is spoken for until that draft is cancelled).
    const milestones = await tx
      .select({
        id: paymentMilestones.id,
        projectId: paymentMilestones.projectId,
        title: paymentMilestones.title,
        amount: paymentMilestones.amount,
      })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.status, "pending"),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(financeDocs)
              .where(
                and(
                  eq(financeDocs.milestoneId, paymentMilestones.id),
                  ne(financeDocs.status, "cancelled")
                )
              )
          )
        )
      )
      .orderBy(asc(paymentMilestones.sortOrder))
      .limit(500)
    return {
      salesOrders: sos.filter((s) => !!s.soNumber) as FinanceSources["salesOrders"],
      docs: docs as FinanceSources["docs"],
      milestones,
    }
  })
}

/** Mint {ENTITY}{PREFIX}-0001. */
// ponytail: count-based numbering (docs are never hard-deleted, so the count
// is monotonic); move to a counter column if deletes ever exist.
async function mintNumber(
  tx: Tx,
  tenantId: string,
  kind: FinanceDocKind,
  offset = 0
): Promise<string> {
  const [s] = await tx
    .select({ entityCode: tenantSettings.entityCode })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  const [c] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(financeDocs)
    .where(eq(financeDocs.kind, kind))
  const entity = (s?.entityCode || "ENT").toUpperCase()
  const running = String(Number(c?.n ?? 0) + 1 + offset).padStart(4, "0")
  return `${entity}${FINANCE_KINDS[kind].prefix}-${running}`
}

/**
 * Internal insert with number minting + duplicate retry message. Used by the
 * public createFinanceDoc (after chain validation) AND by system automation
 * (milestone issuance, intercompany mirroring) which owns its own invariants.
 */
async function insertDoc(
  tx: Tx,
  tenantId: string,
  values: Omit<
    typeof financeDocs.$inferInsert,
    "tenantId" | "number" | "id" | "createdAt" | "updatedAt"
  > & { kind: FinanceDocKind }
): Promise<{ id: string; number: string }> {
  // The count-based number can collide under concurrency; each attempt runs
  // in a savepoint so a duplicate doesn't abort the caller's transaction.
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await mintNumber(tx, tenantId, values.kind, attempt)
    try {
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(financeDocs)
          .values({ ...values, tenantId, number })
          .returning({ id: financeDocs.id, number: financeDocs.number })
        return row
      })
    } catch (e) {
      if (!isDuplicateNumberError(e)) throw e
    }
  }
  throw new Error("Could not assign a unique document number — please try again.")
}

/** Money comparisons in integer cents (numeric columns arrive as strings). */
function cents(v: string | number | null | undefined): number {
  return Math.round(Number(v ?? 0) * 100)
}

const SETTLING_KINDS: FinanceDocKind[] = ["receipt", "payment"]

/** Everything the post-commit interco mirror needs, collected in-tx. */
type IntercoMirror = {
  originDocId: string
  dealId: string
  partnerTenantId: string
  originTenantId: string
  share: string
  currency: string
  dueDate: string | null
  sourceNumber: string
  projectId: string | null
}

export type CreateFinanceDocInput = {
  kind: FinanceDocKind
  salesOrderId?: string | null
  parentId?: string | null
  milestoneId?: string | null
  partyName?: string | null
  amount: string
  docDate?: string | null
  dueDate?: string | null
  notes?: string | null
}

export async function createFinanceDoc(
  input: CreateFinanceDocInput
): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const created = await withTenant(
      PERMISSIONS.FINANCE_MANAGE,
      async (tx, ctx) => {
        await assertFinanceEnabled(tx, ctx.tenantId)
        const kind = input.kind
        if (!financeDocKind.enumValues.includes(kind)) {
          throw new Error("Unknown document kind")
        }
        const amount = Number(input.amount)
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error("Amount must be 0 or more")
        }
        if (FINANCE_KINDS[kind].settlesParent && amount <= 0) {
          throw new Error("A payment must be more than 0.")
        }

        // Resolve the source: a parent document and/or the root sales order.
        let parent: typeof financeDocs.$inferSelect | null = null
        if (input.parentId) {
          const [p] = await tx
            .select()
            .from(financeDocs)
            .where(eq(financeDocs.id, input.parentId))
            .limit(1)
          if (!p) throw new Error("Source document not found")
          if (p.status === "cancelled")
            throw new Error("Cannot attach to a cancelled document")
          // Money-received documents settle their parent — that only means
          // anything once the parent is actually issued.
          if (FINANCE_KINDS[kind].settlesParent && p.status !== "issued") {
            throw new Error(
              `The ${FINANCE_KINDS[p.kind as FinanceDocKind].label.toLowerCase()} must be issued before recording its payment.`
            )
          }
          parent = p
        }
        const salesOrderId = input.salesOrderId || parent?.salesOrderId || null
        if (!canAttach(kind, (parent?.kind as FinanceDocKind) ?? null, !!salesOrderId)) {
          const meta = FINANCE_KINDS[kind]
          const from = [
            ...(meta.fromSalesOrder ? ["an approved sales order"] : []),
            ...meta.parents.map((p) => `a ${FINANCE_KINDS[p].label.toLowerCase()}`),
          ].join(" or ")
          throw new Error(`A ${meta.label.toLowerCase()} must be created from ${from}.`)
        }

        // Derive project / currency / party down the chain.
        let projectId = parent?.projectId ?? null
        let currency = parent?.currency ?? null
        let partyName = input.partyName?.trim() || parent?.partyName || null
        if (!projectId && salesOrderId) {
          const [so] = await tx
            .select({
              projectId: salesOrders.projectId,
              currency: projects.currency,
              accountName: accounts.name,
            })
            .from(salesOrders)
            .leftJoin(projects, eq(salesOrders.projectId, projects.id))
            .leftJoin(accounts, eq(projects.accountId, accounts.id))
            .where(eq(salesOrders.id, salesOrderId))
            .limit(1)
          if (!so) throw new Error("Sales order not found")
          projectId = so.projectId
          currency = currency ?? so.currency
          // Customer prefill only makes sense on the sale side.
          if (!partyName && FINANCE_KINDS[kind].direction === "sale") {
            partyName = so.accountName
          }
        }

        // Invoice ↔ milestone tie (invoices only, milestone must be pending,
        // belong to this chain's project, and not be claimed by a live invoice).
        let milestoneId: string | null = null
        if (input.milestoneId && kind === "invoice") {
          const [m] = await tx
            .select({
              id: paymentMilestones.id,
              status: paymentMilestones.status,
              projectId: paymentMilestones.projectId,
            })
            .from(paymentMilestones)
            .where(eq(paymentMilestones.id, input.milestoneId))
            .limit(1)
          if (!m) throw new Error("Milestone not found")
          if (m.status !== "pending")
            throw new Error("That milestone is already invoiced or paid")
          if (!projectId || m.projectId !== projectId)
            throw new Error("That milestone belongs to a different project.")
          const [claimed] = await tx
            .select({ number: financeDocs.number })
            .from(financeDocs)
            .where(
              and(
                eq(financeDocs.milestoneId, m.id),
                ne(financeDocs.status, "cancelled")
              )
            )
            .limit(1)
          if (claimed)
            throw new Error(
              `That milestone is already on invoice ${claimed.number}.`
            )
          milestoneId = m.id
        }

        // Default the payment window (Settings → invoice due days) so the
        // salesperson doesn't type dates for the common case.
        let dueDate = input.dueDate || null
        if (!dueDate && (kind === "invoice" || kind === "purchase_invoice")) {
          const { invoiceDueDays } = await financeSettings(tx, ctx.tenantId)
          const base = input.docDate ? new Date(input.docDate) : new Date()
          base.setDate(base.getDate() + invoiceDueDays)
          dueDate = toDateString(base)
        }

        const row = await insertDoc(tx, ctx.tenantId, {
          kind,
          parentId: parent?.id ?? null,
          salesOrderId,
          projectId,
          milestoneId,
          partyName,
          amount: amount.toFixed(2),
          currency: currency ?? "MYR",
          docDate: input.docDate || toDateString(new Date()),
          dueDate,
          notes: input.notes?.trim() || null,
        })

        await writeAudit(tx, ctx, {
          action: `finance.${kind}.created`,
          entityType: "finance_doc",
          entityId: row.id,
          after: { number: row.number, amount: amount.toFixed(2), parentId: parent?.id ?? null },
        })
        await logActivity(tx, ctx, {
          entityType: "finance_doc",
          entityId: row.id,
          type: "system",
          subject: `${FINANCE_KINDS[kind].label} ${row.number} created (draft)`,
        })
        return row
      }
    )
    revalidatePath("/billing")
    revalidatePath("/purchasing")
    return created
  })
}

/**
 * Move a document through draft → issued → settled/cancelled. Side effects
 * keep the chain honest: issuing an invoice marks its milestone invoiced;
 * issuing a receipt/payment settles its parent (and pays the invoice's
 * milestone).
 */
export async function setFinanceDocStatus(
  id: string,
  next: FinanceDocStatus
): Promise<ActionResult<void>> {
  return runAction(async () => {
    // Info collected inside the transaction for post-commit automation.
    let mirrors: IntercoMirror[] = []

    await withTenant(PERMISSIONS.FINANCE_MANAGE, async (tx, ctx) => {
      await assertFinanceEnabled(tx, ctx.tenantId)
      const [doc] = await tx
        .select()
        .from(financeDocs)
        .where(eq(financeDocs.id, id))
        .limit(1)
      if (!doc) throw new Error("Document not found")
      if (!FINANCE_STATUS_NEXT[doc.status]?.includes(next)) {
        throw new Error(`A ${doc.status} document cannot become ${next}.`)
      }

      // Proof gate: money-received documents need an attached proof (bank
      // slip / remittance advice) BEFORE they can be issued.
      if (
        next === "issued" &&
        (doc.kind === "receipt" || doc.kind === "payment")
      ) {
        const [a] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(attachments)
          .where(
            and(
              eq(attachments.attachableType, "finance_doc"),
              eq(attachments.attachableId, id)
            )
          )
        if (!Number(a?.n)) {
          throw new Error(
            `Attach the payment proof before issuing this ${FINANCE_KINDS[doc.kind as FinanceDocKind].label.toLowerCase()}.`
          )
        }
      }

      // Compare-and-set: a concurrent transition (double-click, second tab)
      // must fail loudly, not double-run the side effects below.
      const [moved] = await tx
        .update(financeDocs)
        .set({ status: next, updatedAt: new Date() })
        .where(and(eq(financeDocs.id, id), eq(financeDocs.status, doc.status)))
        .returning({ id: financeDocs.id })
      if (!moved) {
        throw new Error("The document just changed — refresh and retry.")
      }

      if (next === "issued") {
        // Invoice issued → its milestone is now invoiced.
        if (doc.kind === "invoice" && doc.milestoneId) {
          await tx
            .update(paymentMilestones)
            .set({ status: "invoiced", updatedAt: new Date() })
            .where(
              and(
                eq(paymentMilestones.id, doc.milestoneId),
                eq(paymentMilestones.status, "pending")
              )
            )
        }
        // Receipt/payment issued → settle the parent once the live payments
        // cover its full amount (a partial payment leaves it issued).
        if (FINANCE_KINDS[doc.kind as FinanceDocKind].settlesParent && doc.parentId) {
          const [parent] = await tx
            .select()
            .from(financeDocs)
            .where(eq(financeDocs.id, doc.parentId))
            .limit(1)
          if (!parent || parent.status !== "issued") {
            throw new Error(
              "The parent document must be issued before recording its payment."
            )
          }
          // Sum includes this doc — it just moved to issued above.
          const [agg] = await tx
            .select({ total: sql<string>`coalesce(sum(${financeDocs.amount}), 0)` })
            .from(financeDocs)
            .where(
              and(
                eq(financeDocs.parentId, doc.parentId),
                inArray(financeDocs.kind, SETTLING_KINDS),
                inArray(financeDocs.status, ["issued", "settled"])
              )
            )
          // ponytail: outstanding ignores credit notes — net them in when CNs
          // are used for real refunds rather than corrections.
          if (cents(agg?.total) >= cents(parent.amount)) {
            await tx
              .update(financeDocs)
              .set({ status: "settled", updatedAt: new Date() })
              .where(
                and(eq(financeDocs.id, parent.id), eq(financeDocs.status, "issued"))
              )
            if (parent.kind === "invoice" && parent.milestoneId) {
              await tx
                .update(paymentMilestones)
                .set({ status: "paid", updatedAt: new Date() })
                .where(eq(paymentMilestones.id, parent.milestoneId))
            }
            // Automation: all milestones paid → project Completed (toggle).
            if (parent.kind === "invoice" && parent.projectId) {
              await maybeCompleteProject(tx, ctx, parent.projectId)
            }
          } else {
            const outstanding = (cents(parent.amount) - cents(agg?.total)) / 100
            await logActivity(tx, ctx, {
              entityType: "finance_doc",
              entityId: parent.id,
              type: "system",
              subject: `Partial payment ${doc.number} received — ${outstanding.toFixed(2)} ${parent.currency} outstanding`,
            })
          }
        }
        // Intercompany: issuing a CUSTOMER invoice on an interco project
        // queues the auto-mirror (executed after this tx commits).
        if (doc.kind === "invoice" && !doc.intercompanyDealId) {
          mirrors = await prepareIntercoMirror(tx, ctx.tenantId, doc)
        }
      }

      // "Mark settled" straight on an invoice = money received without a
      // receipt document — same milestone/project side effects as a receipt.
      if (next === "settled" && doc.kind === "invoice") {
        if (doc.milestoneId) {
          await tx
            .update(paymentMilestones)
            .set({ status: "paid", updatedAt: new Date() })
            .where(
              and(
                eq(paymentMilestones.id, doc.milestoneId),
                ne(paymentMilestones.status, "paid")
              )
            )
        }
        if (doc.projectId) {
          await maybeCompleteProject(tx, ctx, doc.projectId)
        }
      }

      // Cancelling an issued document must undo what issuing did.
      if (next === "cancelled" && doc.status === "issued") {
        // Live payment documents block the cancel — cancel those first.
        const [liveSettle] = await tx
          .select({ number: financeDocs.number })
          .from(financeDocs)
          .where(
            and(
              eq(financeDocs.parentId, id),
              inArray(financeDocs.kind, SETTLING_KINDS),
              ne(financeDocs.status, "cancelled")
            )
          )
          .limit(1)
        if (liveSettle) {
          throw new Error(
            `Cancel ${liveSettle.number} first — it records a payment against this document.`
          )
        }
        // Free the milestone so it can be invoiced again.
        if (doc.kind === "invoice" && doc.milestoneId) {
          await tx
            .update(paymentMilestones)
            .set({ status: "pending", updatedAt: new Date() })
            .where(
              and(
                eq(paymentMilestones.id, doc.milestoneId),
                eq(paymentMilestones.status, "invoiced")
              )
            )
        }
        // Cancelling a receipt/payment: un-settle the parent when the
        // remaining live payments no longer cover it.
        if (FINANCE_KINDS[doc.kind as FinanceDocKind].settlesParent && doc.parentId) {
          const [parent] = await tx
            .select()
            .from(financeDocs)
            .where(eq(financeDocs.id, doc.parentId))
            .limit(1)
          if (parent?.status === "settled") {
            const [agg] = await tx
              .select({ total: sql<string>`coalesce(sum(${financeDocs.amount}), 0)` })
              .from(financeDocs)
              .where(
                and(
                  eq(financeDocs.parentId, parent.id),
                  inArray(financeDocs.kind, SETTLING_KINDS),
                  inArray(financeDocs.status, ["issued", "settled"])
                )
              )
            if (cents(agg?.total) < cents(parent.amount)) {
              await tx
                .update(financeDocs)
                .set({ status: "issued", updatedAt: new Date() })
                .where(
                  and(
                    eq(financeDocs.id, parent.id),
                    eq(financeDocs.status, "settled")
                  )
                )
              if (parent.kind === "invoice" && parent.milestoneId) {
                await tx
                  .update(paymentMilestones)
                  .set({ status: "invoiced", updatedAt: new Date() })
                  .where(
                    and(
                      eq(paymentMilestones.id, parent.milestoneId),
                      eq(paymentMilestones.status, "paid")
                    )
                  )
              }
              // ponytail: an auto-completed project stays completed — reopen
              // it manually if the reversal actually reopens delivery.
            }
          }
        }
      }

      await writeAudit(tx, ctx, {
        action: `finance.${doc.kind}.${next}`,
        entityType: "finance_doc",
        entityId: id,
        after: { number: doc.number, status: next },
      })
      await logActivity(tx, ctx, {
        entityType: "finance_doc",
        entityId: id,
        type: "system",
        subject: `${doc.number} ${next}`,
      })
    })

    // Best-effort post-commit: the interco mirror must never fail the issue.
    // Each party's pair runs in its OWN transaction, so one party's failure
    // doesn't block the others' documents from being minted; the activity
    // trail below makes any miss discoverable.
    // (cast: TS can't see the assignment inside the withTenant closure)
    const ms = mirrors as IntercoMirror[]
    for (const m of ms) {
      try {
        await executeIntercoMirror(m)
      } catch (e) {
        console.error("[finance] interco auto-mirror failed", e)
        try {
          const ctx = await requireContext()
          await runInTenant(m.originTenantId, (tx) =>
            logActivity(tx, ctx, {
              entityType: "finance_doc",
              entityId: m.originDocId,
              type: "system",
              subject: `Intercompany auto-mirror to ${m.partnerTenantId} FAILED — create the partner-share documents manually.`,
            })
          )
        } catch {
          // trail is best-effort too
        }
      }
    }

    revalidatePath("/billing")
    revalidatePath("/purchasing")
  })
}

/**
 * Inside the issue transaction: decide whether this customer invoice needs
 * intercompany mirrors, and collect everything the post-commit step needs —
 * one entry per party whose share is positive and who hasn't declined.
 * Returns [] when not applicable (not interco, mirroring off, no parties).
 */
async function prepareIntercoMirror(
  tx: Tx,
  tenantId: string,
  doc: typeof financeDocs.$inferSelect
): Promise<IntercoMirror[]> {
  const { intercoAutoMirror } = await financeSettings(tx, tenantId)
  if (!intercoAutoMirror || !doc.projectId) return []
  const [opp] = await tx
    .select({
      isIntercompany: opportunities.isIntercompany,
      quotedAmount: opportunities.amount,
      estimatedAmount: opportunities.estimatedAmount,
    })
    .from(projects)
    .innerJoin(opportunities, eq(projects.opportunityId, opportunities.id))
    .where(eq(projects.id, doc.projectId))
    .limit(1)
  if (!opp?.isIntercompany) return []

  const rows = await tx
    .select({
      partnerEntityId: intercompanyDealParties.partnerEntityId,
      shareType: intercompanyDealParties.shareType,
      shareValue: intercompanyDealParties.shareValue,
      dealId: intercompanyDeals.id,
      response: intercompanyDealResponses.response,
    })
    .from(intercompanyDealParties)
    .innerJoin(
      opportunities,
      eq(opportunities.id, intercompanyDealParties.opportunityId)
    )
    .innerJoin(
      projects,
      eq(projects.opportunityId, opportunities.id)
    )
    .leftJoin(
      intercompanyDeals,
      and(
        eq(intercompanyDeals.opportunityId, intercompanyDealParties.opportunityId),
        eq(intercompanyDeals.partnerTenantId, intercompanyDealParties.partnerEntityId)
      )
    )
    .leftJoin(
      intercompanyDealResponses,
      eq(intercompanyDealResponses.dealId, intercompanyDeals.id)
    )
    .where(eq(projects.id, doc.projectId))

  const dealTotal = Number(opp.quotedAmount ?? opp.estimatedAmount ?? 0)
  const mirrors: IntercoMirror[] = []
  for (const row of rows) {
    // Need a mirrored deal row and a share; a party who explicitly DECLINED
    // never gets documents minted into their books.
    if (!row.dealId || row.response === "declined") continue
    const shareNum = partyShare(
      { shareType: row.shareType, shareValue: Number(row.shareValue) },
      dealTotal,
      Number(doc.amount)
    )
    if (!(shareNum > 0)) continue
    mirrors.push({
      originDocId: doc.id,
      dealId: row.dealId,
      partnerTenantId: row.partnerEntityId,
      originTenantId: tenantId,
      share: shareNum.toFixed(2),
      currency: doc.currency,
      dueDate: doc.dueDate,
      sourceNumber: doc.number,
      projectId: doc.projectId,
    })
  }
  return mirrors
}

/**
 * Post-commit: create the mirrored pair for the partner share.
 *   ORIGIN  — draft PURCHASE INVOICE from the partner (their cut = a cost)
 *   PARTNER — draft SALES INVOICE to the origin (their cut = their revenue)
 * Both linked via counterpart_doc_id + intercompany_deal_id. Drafts only —
 * each side reviews and issues (the partner's needs no proof; it's revenue).
 */
async function executeIntercoMirror(m: IntercoMirror): Promise<void> {
  const ctx = await requireContext()
  const today = toDateString(new Date())

  // The partner must have the finance module ON — otherwise the mirrored
  // documents would be invisible and unmanageable on their side.
  const partnerOn = await runInTenant(m.partnerTenantId, async (tx) => {
    const [s] = await tx
      .select({ on: tenantSettings.financeModule })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, m.partnerTenantId))
      .limit(1)
    return s?.on ?? false
  })
  if (!partnerOn) {
    await runInTenant(m.originTenantId, (tx) =>
      logActivity(tx, ctx, {
        entityType: "finance_doc",
        entityId: m.originDocId,
        type: "system",
        subject:
          "Interco mirror skipped — the partner entity has the finance module off.",
      })
    )
    return
  }

  // ONE transaction for the whole pair. The tenant GUC is transaction-local,
  // so we can switch sides mid-tx — any failure rolls back both inserts
  // (no half-mirrored books).
  await db.transaction(async (tx) => {
    const asTenant = (t: string) =>
      tx.execute(sql`select set_config('app.current_tenant', ${t}, true)`)

    await asTenant(m.originTenantId)
    // Entity display names (organization is RLS-excluded — readable).
    const orgs = await tx
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(inArray(organization.id, [m.originTenantId, m.partnerTenantId]))
    const nameOf = (id: string) =>
      orgs.find((o) => o.id === id)?.name ?? "Sibling entity"

    // 1. Origin side: purchase invoice from the partner, on the SAME project
    //    so the project's billed margin carries the interco cost.
    const origin = await insertDoc(tx, m.originTenantId, {
      kind: "purchase_invoice",
      parentId: null,
      salesOrderId: null,
      projectId: m.projectId,
      milestoneId: null,
      partyName: nameOf(m.partnerTenantId),
      amount: m.share,
      currency: m.currency,
      docDate: today,
      dueDate: m.dueDate,
      notes: `Intercompany share of ${m.sourceNumber} (auto-mirrored).`,
      intercompanyDealId: m.dealId,
      status: "draft",
    })
    await logActivity(tx, ctx, {
      entityType: "finance_doc",
      entityId: origin.id,
      type: "system",
      subject: `Auto-mirrored from ${m.sourceNumber} (partner share)`,
    })

    // 2. Partner side: sales invoice to the origin, linked to their delivery
    //    project when they created one from the inbound deal.
    await asTenant(m.partnerTenantId)
    const [proj] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.intercompanyDealId, m.dealId),
          isNull(projects.deletedAt)
        )
      )
      .limit(1)
    const partner = await insertDoc(tx, m.partnerTenantId, {
      kind: "invoice",
      parentId: null,
      salesOrderId: null,
      projectId: proj?.id ?? null,
      milestoneId: null,
      partyName: nameOf(m.originTenantId),
      amount: m.share,
      currency: m.currency,
      docDate: today,
      dueDate: m.dueDate,
      notes: `Intercompany share of ${m.sourceNumber} (auto-mirrored).`,
      intercompanyDealId: m.dealId,
      counterpartDocId: origin.id,
      counterpartNumber: origin.number,
      status: "draft",
    })

    // 3. Close the loop: origin's purchase invoice points back at the partner's.
    await asTenant(m.originTenantId)
    await tx
      .update(financeDocs)
      .set({ counterpartDocId: partner.id, counterpartNumber: partner.number })
      .where(eq(financeDocs.id, origin.id))
  })
}

// ── Detail page / issuance / reminders / rollups ─────────────────────────────

export type FinanceDocDetail = {
  doc: FinanceDocRow
  parent: { id: string; number: string; kind: FinanceDocKind } | null
  children: { id: string; number: string; kind: FinanceDocKind; status: FinanceDocStatus; amount: string }[]
  counterpartNumber: string | null
  projectName: string | null
  milestoneTitle: string | null
  quoteNumber: string | null
  /** Tenant reminder schedule (days after due) for stage computation. */
  reminderSchedule: number[]
}

/** Everything the /billing/[id] detail page renders. */
export async function getFinanceDoc(id: string): Promise<FinanceDocDetail | null> {
  return withTenant(PERMISSIONS.FINANCE_VIEW, async (tx, ctx) => {
    await assertFinanceEnabled(tx, ctx.tenantId)
    const parent = alias(financeDocs, "parent_doc")
    const [row] = await tx
      .select({
        id: financeDocs.id,
        kind: financeDocs.kind,
        number: financeDocs.number,
        status: financeDocs.status,
        partyName: financeDocs.partyName,
        amount: financeDocs.amount,
        currency: financeDocs.currency,
        docDate: financeDocs.docDate,
        dueDate: financeDocs.dueDate,
        notes: financeDocs.notes,
        parentId: financeDocs.parentId,
        parentNumber: parent.number,
        parentKind: parent.kind,
        salesOrderId: financeDocs.salesOrderId,
        soNumber: salesOrders.soNumber,
        projectId: financeDocs.projectId,
        projectCode: projects.projectCode,
        projectName: projects.name,
        quotationId: projects.quotationId,
        milestoneId: financeDocs.milestoneId,
        milestoneTitle: paymentMilestones.title,
        reminderStage: financeDocs.reminderStage,
        lastReminderAt: financeDocs.lastReminderAt,
        intercompanyDealId: financeDocs.intercompanyDealId,
        counterpartDocId: financeDocs.counterpartDocId,
        // Denormalized at mirror time — RLS blocks a cross-tenant self-join.
        counterpartNumber: financeDocs.counterpartNumber,
        attachCount: sql<number>`(select count(*)::int from ${attachments} a where a.attachable_type = 'finance_doc' and a.attachable_id = ${financeDocs.id})`,
        createdAt: financeDocs.createdAt,
      })
      .from(financeDocs)
      .leftJoin(parent, eq(financeDocs.parentId, parent.id))
      .leftJoin(salesOrders, eq(financeDocs.salesOrderId, salesOrders.id))
      .leftJoin(projects, eq(financeDocs.projectId, projects.id))
      .leftJoin(paymentMilestones, eq(financeDocs.milestoneId, paymentMilestones.id))
      .where(eq(financeDocs.id, id))
      .limit(1)
    if (!row) return null

    const children = await tx
      .select({
        id: financeDocs.id,
        number: financeDocs.number,
        kind: financeDocs.kind,
        status: financeDocs.status,
        amount: financeDocs.amount,
      })
      .from(financeDocs)
      .where(eq(financeDocs.parentId, id))
      .orderBy(asc(financeDocs.createdAt))

    let quoteNumber: string | null = null
    if (row.quotationId) {
      const [q] = await tx
        .select({ n: sql<string>`quote_number` })
        .from(sql`quotations`)
        .where(sql`id = ${row.quotationId}`)
        .limit(1)
      quoteNumber = q?.n ?? null
    }

    const { reminderDays } = await financeSettings(tx, ctx.tenantId)
    const { parentKind, projectName, milestoneTitle, counterpartNumber, quotationId: _q, ...doc } = row
    return {
      doc: doc as FinanceDocRow,
      parent: row.parentId && row.parentNumber
        ? { id: row.parentId, number: row.parentNumber, kind: parentKind as FinanceDocKind }
        : null,
      children: children as FinanceDocDetail["children"],
      counterpartNumber: counterpartNumber ?? null,
      projectName: projectName ?? null,
      milestoneTitle: milestoneTitle ?? null,
      quoteNumber,
      reminderSchedule: reminderDays,
    }
  })
}

/** One click: log the next payment reminder on an issued document. */
export async function logReminder(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.FINANCE_MANAGE, async (tx, ctx) => {
      await assertFinanceEnabled(tx, ctx.tenantId)
      const [doc] = await tx
        .update(financeDocs)
        .set({
          reminderStage: sql`${financeDocs.reminderStage} + 1`,
          lastReminderAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(financeDocs.id, id), eq(financeDocs.status, "issued")))
        .returning({ number: financeDocs.number, stage: financeDocs.reminderStage })
      if (!doc) throw new Error("Only an issued document can take a reminder.")
      await logActivity(tx, ctx, {
        entityType: "finance_doc",
        entityId: id,
        type: "note",
        subject: `Payment reminder ${doc.stage} logged for ${doc.number}`,
      })
      await writeAudit(tx, ctx, {
        action: "finance.reminder_logged",
        entityType: "finance_doc",
        entityId: id,
        after: { number: doc.number, stage: doc.stage },
      })
    })
    revalidatePath("/billing")
    revalidatePath("/purchasing")
  })
}

/**
 * One-click issuance from the project page: draft an invoice for a PENDING
 * milestone with everything derived — amount, customer, currency, the
 * project's approved sales order, and the due date from settings.
 */
export async function createInvoiceFromMilestone(
  milestoneId: string
): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const created = await withTenant(
      PERMISSIONS.FINANCE_MANAGE,
      async (tx, ctx) => {
        await assertFinanceEnabled(tx, ctx.tenantId)
        const [m] = await tx
          .select({
            id: paymentMilestones.id,
            status: paymentMilestones.status,
            amount: paymentMilestones.amount,
            title: paymentMilestones.title,
            projectId: paymentMilestones.projectId,
          })
          .from(paymentMilestones)
          .where(eq(paymentMilestones.id, milestoneId))
          .limit(1)
        if (!m) throw new Error("Milestone not found")
        if (m.status !== "pending")
          throw new Error("That milestone is already invoiced or paid.")
        // A drafted invoice claims the milestone — one live invoice per
        // milestone (backed by finance_docs_live_milestone_uq).
        const [claimed] = await tx
          .select({ number: financeDocs.number })
          .from(financeDocs)
          .where(
            and(
              eq(financeDocs.milestoneId, m.id),
              ne(financeDocs.status, "cancelled")
            )
          )
          .limit(1)
        if (claimed)
          throw new Error(`That milestone is already on invoice ${claimed.number}.`)

        const [proj] = await tx
          .select({
            id: projects.id,
            currency: projects.currency,
            accountName: accounts.name,
          })
          .from(projects)
          .leftJoin(accounts, eq(projects.accountId, accounts.id))
          .where(and(eq(projects.id, m.projectId), isNull(projects.deletedAt)))
          .limit(1)
        if (!proj) throw new Error("Project not found")

        // The chain roots on an APPROVED sales order — latest one wins.
        const [so] = await tx
          .select({ id: salesOrders.id })
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.projectId, m.projectId),
              eq(salesOrders.status, "approved")
            )
          )
          .orderBy(desc(salesOrders.reviewedAt))
          .limit(1)
        if (!so)
          throw new Error(
            "This project needs an approved sales order before invoicing."
          )

        const { invoiceDueDays } = await financeSettings(tx, ctx.tenantId)
        const due = new Date()
        due.setDate(due.getDate() + invoiceDueDays)

        const row = await insertDoc(tx, ctx.tenantId, {
          kind: "invoice",
          parentId: null,
          salesOrderId: so.id,
          projectId: m.projectId,
          milestoneId: m.id,
          partyName: proj.accountName,
          amount: m.amount,
          currency: proj.currency,
          docDate: toDateString(new Date()),
          dueDate: toDateString(due),
          notes: `Milestone: ${m.title}`,
        })
        await writeAudit(tx, ctx, {
          action: "finance.invoice.created",
          entityType: "finance_doc",
          entityId: row.id,
          after: { number: row.number, amount: m.amount, milestoneId: m.id },
        })
        await logActivity(tx, ctx, {
          entityType: "project",
          entityId: m.projectId,
          type: "system",
          subject: `Invoice ${row.number} drafted for milestone "${m.title}"`,
        })
        return row
      }
    )
    revalidatePath("/billing")
    return created
  })
}

export type ProjectBillingSummary = {
  enabled: boolean
  currency: string
  projectValue: string | null
  invoiced: string
  paid: string
  creditNotes: string
  purchaseCost: string
  /** invoiced − credit notes − purchase cost (billed margin so far). */
  margin: string
  docs: FinanceDocRow[]
}

/** Billing progress + margin for one project (project detail Billing tab). */
export async function getProjectBillingSummary(
  projectId: string
): Promise<ProjectBillingSummary | null> {
  return withTenant(PERMISSIONS.FINANCE_VIEW, async (tx, ctx) => {
    if (!FINANCE_MODULE) return null
    const [s] = await tx
      .select({ on: tenantSettings.financeModule })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    if (!s?.on) return null

    const [proj] = await tx
      .select({ value: projects.value, currency: projects.currency })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!proj) return null

    const parent = alias(financeDocs, "parent_doc")
    const docs = (await tx
      .select({
        id: financeDocs.id,
        kind: financeDocs.kind,
        number: financeDocs.number,
        status: financeDocs.status,
        partyName: financeDocs.partyName,
        amount: financeDocs.amount,
        currency: financeDocs.currency,
        docDate: financeDocs.docDate,
        dueDate: financeDocs.dueDate,
        notes: financeDocs.notes,
        parentId: financeDocs.parentId,
        parentNumber: parent.number,
        salesOrderId: financeDocs.salesOrderId,
        soNumber: sql<string | null>`null`,
        projectId: financeDocs.projectId,
        projectCode: sql<string | null>`null`,
        milestoneId: financeDocs.milestoneId,
        reminderStage: financeDocs.reminderStage,
        lastReminderAt: financeDocs.lastReminderAt,
        intercompanyDealId: financeDocs.intercompanyDealId,
        counterpartDocId: financeDocs.counterpartDocId,
        attachCount: sql<number>`(select count(*)::int from ${attachments} a where a.attachable_type = 'finance_doc' and a.attachable_id = ${financeDocs.id})`,
        createdAt: financeDocs.createdAt,
      })
      .from(financeDocs)
      .leftJoin(parent, eq(financeDocs.parentId, parent.id))
      .where(eq(financeDocs.projectId, projectId))
      .orderBy(desc(financeDocs.createdAt))) as FinanceDocRow[]

    const live = (kinds: FinanceDocKind[], statuses: FinanceDocStatus[]) =>
      docs
        .filter((d) => kinds.includes(d.kind) && statuses.includes(d.status))
        .reduce((n, d) => n + Number(d.amount), 0)

    const invoiced = live(["invoice"], ["issued", "settled"])
    const paid = live(["invoice"], ["settled"])
    const creditNotes = live(["credit_note"], ["issued", "settled"])
    const purchaseCost = live(["purchase_invoice"], ["issued", "settled"])
    return {
      enabled: true,
      currency: proj.currency,
      projectValue: proj.value,
      invoiced: invoiced.toFixed(2),
      paid: paid.toFixed(2),
      creditNotes: creditNotes.toFixed(2),
      purchaseCost: purchaseCost.toFixed(2),
      margin: (invoiced - creditNotes - purchaseCost).toFixed(2),
      docs,
    }
  })
}

export type BilledMarginRow = {
  currency: string
  revenue: string
  creditNotes: string
  cost: string
  margin: string
}

/** Per-currency billed margin (sale invoices − credit notes − purchase
 *  invoices, issued+settled) for the forecast page. */
export async function getBilledMargin(): Promise<BilledMarginRow[]> {
  const ctx = await requireContext()
  if (!FINANCE_MODULE || !ctx.can(PERMISSIONS.FINANCE_VIEW)) return []
  return runInTenant(ctx.tenantId, async (tx) => {
    const [s] = await tx
      .select({ on: tenantSettings.financeModule })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    if (!s?.on) return []
    const rows = await tx
      .select({
        currency: financeDocs.currency,
        revenue: sql<string>`coalesce(sum(${financeDocs.amount}) filter (where ${financeDocs.kind} = 'invoice'), 0)`,
        creditNotes: sql<string>`coalesce(sum(${financeDocs.amount}) filter (where ${financeDocs.kind} = 'credit_note'), 0)`,
        cost: sql<string>`coalesce(sum(${financeDocs.amount}) filter (where ${financeDocs.kind} = 'purchase_invoice'), 0)`,
      })
      .from(financeDocs)
      .where(inArray(financeDocs.status, ["issued", "settled"]))
      .groupBy(financeDocs.currency)
    return rows.map((r) => ({
      currency: r.currency,
      revenue: Number(r.revenue).toFixed(2),
      creditNotes: Number(r.creditNotes).toFixed(2),
      cost: Number(r.cost).toFixed(2),
      margin: (
        Number(r.revenue) - Number(r.creditNotes) - Number(r.cost)
      ).toFixed(2),
    }))
  })
}
