"use server"

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, withModule, requireContext, assertCan } from "@/lib/actions"
import { runInTenant } from "@/db"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import {
  salesOrders,
  salesOrderStatus,
  projects,
  member,
  user,
  attachments,
  funnels,
  quotations,
  tenantSettings,
} from "@/db/schema"
import {
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_SO_DOCUMENT_KINDS,
} from "@/lib/tenant-defaults"
import { storage } from "@/lib/storage"
import { nextSoNumber, isDuplicateNumberError } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"

type SalesOrderStatus = (typeof salesOrderStatus.enumValues)[number]

export type SalesOrderRow = {
  id: string
  projectId: string
  projectName: string
  projectCode: string
  soNumber: string | null
  status: SalesOrderStatus
  submittedByName: string | null
  reviewedByName: string | null
  rejectReason: string | null
  notes: string | null
  submittedAt: string
  reviewedAt: string | null
  document?: { id: string; fileName: string; contentType: string }
  /** Review context, so an approver isn't deciding blind. */
  amount: string | null
  currency: string
  /** Source funnel (the deal this project came from), if any. */
  funnelName: string | null
  /** Reference of the accepted quotation this project was based on, if any. */
  quoteNumber: string | null
}

/**
 * Attach the latest "sales_order" supporting document (if any) to each row by
 * its sales-order id. Returns a map keyed by sales-order id.
 */
async function loadDocuments(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ids: string[]
): Promise<Map<string, { id: string; fileName: string; contentType: string }>> {
  const out = new Map<string, { id: string; fileName: string; contentType: string }>()
  if (ids.length === 0) return out
  const rows = await tx
    .select({
      id: attachments.id,
      attachableId: attachments.attachableId,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.attachableType, "sales_order"),
        inArray(attachments.attachableId, ids)
      )
    )
    .orderBy(desc(attachments.createdAt))
  // Rows are newest-first; keep the first (latest) per sales order.
  for (const r of rows) {
    if (!out.has(r.attachableId)) {
      out.set(r.attachableId, {
        id: r.id,
        fileName: r.fileName,
        contentType: r.contentType,
      })
    }
  }
  return out
}

type RawRow = {
  id: string
  projectId: string
  projectName: string
  projectCode: string
  soNumber: string | null
  status: SalesOrderStatus
  submittedByName: string | null
  reviewedByName: string | null
  rejectReason: string | null
  notes: string | null
  submittedAt: Date
  reviewedAt: Date | null
  amount: string | null
  currency: string
  funnelName: string | null
  quoteNumber: string | null
}

async function fetchRows(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: Parameters<Parameters<typeof withTenant>[1]>[1],
  projectId?: string,
  salesOrderId?: string
): Promise<SalesOrderRow[]> {
  // Sales orders inherit visibility from their parent project's owner.
  // Approvers must still see every submitted SO, so they bypass owner scoping.
  const visible = await visibleMemberIds(tx, ctx)
  const scopeSO = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE) ? null : visible
  const rows = (await tx
    .select({
      id: salesOrders.id,
      projectId: salesOrders.projectId,
      projectName: projects.name,
      projectCode: projects.projectCode,
      soNumber: salesOrders.soNumber,
      status: salesOrders.status,
      submittedByMemberId: salesOrders.submittedByMemberId,
      reviewedByMemberId: salesOrders.reviewedByMemberId,
      rejectReason: salesOrders.rejectReason,
      notes: salesOrders.notes,
      submittedAt: salesOrders.submittedAt,
      reviewedAt: salesOrders.reviewedAt,
      amount: projects.value,
      currency: projects.currency,
      funnelName: funnels.name,
      quoteNumber: quotations.quoteNumber,
    })
    .from(salesOrders)
    .innerJoin(projects, eq(salesOrders.projectId, projects.id))
    // Review context inherited from the parent project: the funnel it came from
    // and the accepted quotation it was based on (both optional).
    .leftJoin(funnels, eq(projects.funnelId, funnels.id))
    .leftJoin(quotations, eq(projects.quotationId, quotations.id))
    .where(
      and(
        // Never surface SOs whose parent project was soft-deleted — soft-delete
        // doesn't fire the cascade FK, so they'd otherwise dangle in this list.
        isNull(projects.deletedAt),
        projectId ? eq(salesOrders.projectId, projectId) : undefined,
        salesOrderId ? eq(salesOrders.id, salesOrderId) : undefined,
        ownerScope(projects.ownerMemberId, scopeSO)
      )
    )
    .orderBy(desc(salesOrders.submittedAt))
    // Capped server-side; the global list table surfaces a "refine your search"
    // notice at this count (cap={1000}) so rows never silently vanish.
    .limit(1000)) as Array<{
    id: string
    projectId: string
    projectName: string
    projectCode: string
    soNumber: string | null
    status: SalesOrderStatus
    submittedByMemberId: string | null
    reviewedByMemberId: string | null
    rejectReason: string | null
    notes: string | null
    submittedAt: Date
    reviewedAt: Date | null
    amount: string | null
    currency: string
    funnelName: string | null
    quoteNumber: string | null
  }>

  // Resolve member -> user display names in one pass.
  const memberIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.submittedByMemberId, r.reviewedByMemberId])
        .filter((v): v is string => !!v)
    )
  )
  const nameByMemberId = new Map<string, string>()
  if (memberIds.length) {
    const people = await tx
      .select({ memberId: member.id, name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(inArray(member.id, memberIds))
    for (const p of people) nameByMemberId.set(p.memberId, p.name)
  }

  const docs = await loadDocuments(
    tx,
    rows.map((r) => r.id)
  )

  return rows.map((r): SalesOrderRow => {
    const raw: RawRow = {
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      projectCode: r.projectCode,
      soNumber: r.soNumber,
      status: r.status,
      submittedByName: r.submittedByMemberId
        ? (nameByMemberId.get(r.submittedByMemberId) ?? null)
        : null,
      reviewedByName: r.reviewedByMemberId
        ? (nameByMemberId.get(r.reviewedByMemberId) ?? null)
        : null,
      rejectReason: r.rejectReason,
      notes: r.notes,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      amount: r.amount,
      currency: r.currency,
      funnelName: r.funnelName,
      quoteNumber: r.quoteNumber,
    }
    return {
      ...raw,
      submittedAt: raw.submittedAt.toISOString(),
      reviewedAt: raw.reviewedAt ? raw.reviewedAt.toISOString() : null,
      document: docs.get(r.id),
    }
  })
}

/**
 * Submit a sales order together with its mandatory supporting document as one
 * unit. The blob is written to storage first, then the sales-order row and its
 * attachment are inserted in a single transaction — so an SO can never exist
 * without its proof. If the transaction fails the row is never created and the
 * orphaned blob is harmless (GC-able); the inverse — an SO row with no document
 * — must never happen. Each dropped file becomes its own submission.
 */
export async function submitSalesOrderWithDocument(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
  const file = formData.get("file")
  const projectId = formData.get("projectId")
  const notesRaw = formData.get("notes")
  const documentKindRaw = formData.get("documentKind")
  const paymentTermRaw = formData.get("paymentTerm")
  if (!(file instanceof File) || typeof projectId !== "string" || !projectId) {
    throw new Error("A supporting document and project are required")
  }
  if (file.size === 0) throw new Error("The document is empty")
  if (file.size > 25 * 1024 * 1024) throw new Error("File exceeds 25 MB")
  const notes =
    typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : null
  // Free-form (tenant-configurable picklist in Settings); length-capped only.
  const documentKind =
    typeof documentKindRaw === "string" && documentKindRaw.trim()
      ? documentKindRaw.trim().slice(0, 60)
      : null
  const paymentTerm =
    typeof paymentTermRaw === "string" && paymentTermRaw.trim()
      ? paymentTermRaw.trim().slice(0, 60)
      : null

  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.SALES_ORDER_SUBMIT)

  // Store the blob before opening the transaction; a failed insert below leaves
  // only an orphaned (GC-able) file, never a sales order without its document.
  const buf = Buffer.from(await file.arrayBuffer())
  const stored = await storage.put(ctx.tenantId, file.name, buf)

  const result = await runInTenant(ctx.tenantId, async (tx) => {
    const [proj] = await tx
      .select({ id: projects.id, ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!proj) throw new Error("Project not found")

    // An SO inherits its owner from the parent project; only the project's
    // owner (or a manager up the chain) may submit against it.
    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, proj.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this project")

    const [created] = await tx
      .insert(salesOrders)
      .values({
        tenantId: ctx.tenantId,
        projectId,
        status: "submitted",
        notes,
        documentKind,
        paymentTerm,
        submittedByMemberId: ctx.memberId,
        submittedAt: new Date(),
      })
      .returning({ id: salesOrders.id })

    await tx.insert(attachments).values({
      tenantId: ctx.tenantId,
      attachableType: "sales_order",
      attachableId: created.id,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      byteSize: stored.size,
      storageKey: stored.key,
      uploadedByMemberId: ctx.memberId,
    })

    await logActivity(tx, ctx, {
      entityType: "project",
      entityId: projectId,
      type: "system",
      subject: "Sales order submitted",
    })

    await writeAudit(tx, ctx, {
      action: "sales_order.submitted",
      entityType: "sales_order",
      entityId: created.id,
      after: { projectId },
    })
    return { id: created.id }
  })

  revalidatePath("/sales-orders")
  revalidatePath(`/projects/${projectId}`)
  return result
  })
}

export type ResubmitSalesOrderInput = {
  notes?: string
}

export async function resubmitSalesOrder(
  id: string,
  input: ResubmitSalesOrderInput
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const projectId = await withModule(
    "salesOrders",
    PERMISSIONS.SALES_ORDER_SUBMIT,
    async (tx, ctx) => {
      // Lock the SO row so a concurrent resubmit/approve can't double-act on it.
      const [so] = await tx
        .select({ status: salesOrders.status, projectId: salesOrders.projectId })
        .from(salesOrders)
        .where(eq(salesOrders.id, id))
        .limit(1)
        .for("update")
      if (!so) throw new Error("Sales order not found")
      if (so.status !== "rejected")
        throw new Error("Only rejected sales orders can be resubmitted")

      // An SO inherits its owner from the parent project; only the project's
      // owner (or a manager up the chain) may resubmit it.
      const [proj] = await tx
        .select({ ownerMemberId: projects.ownerMemberId })
        .from(projects)
        .where(eq(projects.id, so.projectId))
        .limit(1)
      const visible = await visibleMemberIds(tx, ctx)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, proj?.ownerMemberId ?? null)
      )
        throw new Error("FORBIDDEN: not permitted on this project")

      // Conditional flip guards against a racing transition; assert exactly one
      // still-rejected row changed.
      const [updated] = await tx
        .update(salesOrders)
        .set({
          status: "submitted",
          rejectReason: null,
          reviewedByMemberId: null,
          reviewedAt: null,
          notes: input.notes ?? null,
          submittedByMemberId: ctx.memberId,
          submittedAt: new Date(),
        })
        .where(and(eq(salesOrders.id, id), eq(salesOrders.status, "rejected")))
        .returning({ id: salesOrders.id })
      if (!updated)
        throw new Error("Only rejected sales orders can be resubmitted")

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: so.projectId,
        type: "system",
        subject: "Sales order resubmitted",
      })

      await writeAudit(tx, ctx, {
        action: "sales_order.resubmitted",
        entityType: "sales_order",
        entityId: id,
        after: { projectId: so.projectId },
      })
      return so.projectId
    }
  )
  revalidatePath("/sales-orders")
  revalidatePath(`/projects/${projectId}`)
  })
}

export async function approveSalesOrder(
  id: string
): Promise<ActionResult<{ soNumber: string }>> {
  return runAction(async () => {
  const result = await withModule(
    "salesOrders",
    PERMISSIONS.SALES_ORDER_APPROVE,
    async (tx, ctx) => {
      // Lock the SO row first: minting the official number and flipping the
      // status must be atomic so a concurrent approve can't burn a second
      // number or double the activity/audit trail.
      const [so] = await tx
        .select({ status: salesOrders.status, projectId: salesOrders.projectId })
        .from(salesOrders)
        .where(eq(salesOrders.id, id))
        .limit(1)
        .for("update")
      if (!so) throw new Error("Sales order not found")
      if (so.status !== "submitted")
        throw new Error("Only submitted sales orders can be approved")

      // Never mint an official SO number for a submission with no proof.
      const [doc] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.attachableType, "sales_order"),
            eq(attachments.attachableId, id)
          )
        )
        .limit(1)
      if (!doc)
        throw new Error(
          "Cannot approve a sales order without a supporting document"
        )

      const soNumber = await nextSoNumber(tx, ctx)

      // Conditional flip guards against a racing transition; only mint against a
      // still-submitted row and assert exactly one row changed.
      let updated: { id: string } | undefined
      try {
        ;[updated] = await tx
          .update(salesOrders)
          .set({
            status: "approved",
            soNumber,
            reviewedByMemberId: ctx.memberId,
            reviewedAt: new Date(),
          })
          .where(
            and(eq(salesOrders.id, id), eq(salesOrders.status, "submitted"))
          )
          .returning({ id: salesOrders.id })
      } catch (e) {
        // The minted SO number collided (the tenant's SO "Next number" was set
        // at or below an already-issued value). Surface a friendly retry.
        if (isDuplicateNumberError(e)) {
          throw new Error(
            "Could not assign a unique sales-order number — raise the SO Next number in Settings, then try again."
          )
        }
        throw e
      }
      if (!updated)
        throw new Error("Only submitted sales orders can be approved")

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: so.projectId,
        type: "system",
        subject: `Sales order approved: ${soNumber}`,
      })

      await writeAudit(tx, ctx, {
        action: "sales_order.approved",
        entityType: "sales_order",
        entityId: id,
        after: { soNumber, projectId: so.projectId },
      })
      return { soNumber, projectId: so.projectId }
    }
  )
  revalidatePath("/sales-orders")
  revalidatePath(`/projects/${result.projectId}`)
  return { soNumber: result.soNumber }
  })
}

export async function rejectSalesOrder(
  id: string,
  reason: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const trimmed = (reason ?? "").trim()
  if (!trimmed) throw new Error("A reason is required")
  const projectId = await withModule(
    "salesOrders",
    PERMISSIONS.SALES_ORDER_APPROVE,
    async (tx, ctx) => {
      // Lock the SO row so a concurrent approve/reject can't double-act on it.
      const [so] = await tx
        .select({ status: salesOrders.status, projectId: salesOrders.projectId })
        .from(salesOrders)
        .where(eq(salesOrders.id, id))
        .limit(1)
        .for("update")
      if (!so) throw new Error("Sales order not found")
      if (so.status !== "submitted")
        throw new Error("Only submitted sales orders can be rejected")

      // Conditional flip guards against a racing transition; assert exactly one
      // still-submitted row changed.
      const [updated] = await tx
        .update(salesOrders)
        .set({
          status: "rejected",
          rejectReason: trimmed,
          reviewedByMemberId: ctx.memberId,
          reviewedAt: new Date(),
        })
        .where(and(eq(salesOrders.id, id), eq(salesOrders.status, "submitted")))
        .returning({ id: salesOrders.id })
      if (!updated)
        throw new Error("Only submitted sales orders can be rejected")

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: so.projectId,
        type: "system",
        subject: "Sales order rejected",
      })

      await writeAudit(tx, ctx, {
        action: "sales_order.rejected",
        entityType: "sales_order",
        entityId: id,
        after: { reason: trimmed, projectId: so.projectId },
      })
      return so.projectId
    }
  )
  revalidatePath("/sales-orders")
  revalidatePath(`/projects/${projectId}`)
  })
}

export type SalesOrderProjectOption = {
  id: string
  name: string
  projectCode: string
}

/**
 * Projects the current user may submit a sales order against — visible (owned
 * or managed) and not soft-deleted. Powers the "Submit sales order" dialog on
 * the Sales Orders list, which has to ask which project first since an SO is
 * always created against a project.
 */
export async function listSubmittableProjects(): Promise<
  SalesOrderProjectOption[]
> {
  return withModule("salesOrders", PERMISSIONS.SALES_ORDER_SUBMIT, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: projects.id,
        name: projects.name,
        projectCode: projects.projectCode,
      })
      .from(projects)
      .where(
        and(
          isNull(projects.deletedAt),
          ownerScope(projects.ownerMemberId, visible)
        )
      )
      .orderBy(asc(projects.name))
      .limit(500)
  })
}

/** Options for the submit dialog: tenant payment-term + document-kind picklists. */
export async function listSalesOrderSubmitOptions(): Promise<{
  paymentTerms: string[]
  documentKinds: string[]
}> {
  return withModule("salesOrders", PERMISSIONS.SALES_ORDER_SUBMIT, async (tx, ctx) => {
    const [s] = await tx
      .select({
        paymentTerms: tenantSettings.paymentTerms,
        documentKinds: tenantSettings.soDocumentKinds,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return {
      paymentTerms: s?.paymentTerms?.length
        ? s.paymentTerms
        : DEFAULT_PAYMENT_TERMS,
      documentKinds: s?.documentKinds?.length
        ? s.documentKinds
        : DEFAULT_SO_DOCUMENT_KINDS,
    }
  })
}

/** All tenant sales orders, newest submission first. */
export async function listSalesOrders(): Promise<SalesOrderRow[]> {
  return withModule("salesOrders", PERMISSIONS.SALES_ORDER_VIEW, (tx, ctx) =>
    fetchRows(tx, ctx)
  )
}

/** Sales orders for a single project, newest submission first. */
export async function listProjectSalesOrders(
  projectId: string
): Promise<SalesOrderRow[]> {
  return withModule("salesOrders", PERMISSIONS.SALES_ORDER_VIEW, (tx, ctx) =>
    fetchRows(tx, ctx, projectId)
  )
}

/** One sales order with its review context, or null if not visible. */
export async function getSalesOrder(id: string): Promise<SalesOrderRow | null> {
  return withModule("salesOrders", PERMISSIONS.SALES_ORDER_VIEW, async (tx, ctx) => {
    const [row] = await fetchRows(tx, ctx, undefined, id)
    return row ?? null
  })
}
