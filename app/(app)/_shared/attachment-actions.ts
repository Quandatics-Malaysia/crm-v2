"use server"

import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireContext } from "@/lib/server-context"
import { runInTenant } from "@/db"
import { attachments, quotations, stageApprovalRequests } from "@/db/schema"
import { storage } from "@/lib/storage"
import { logActivity, type ActivityEntity } from "@/server/services/activity"

export type AttachableType =
  | "stage_approval_request"
  | "quotation"
  | "opportunity"
  | "account"
  | "lead"
  | "person"
  | "project"

export type AttachmentRow = {
  id: string
  fileName: string
  contentType: string
  byteSize: number
  createdAt: string
}

const ACTIVITY_ENTITY: Partial<Record<AttachableType, ActivityEntity>> = {
  account: "account",
  person: "person",
  lead: "lead",
  opportunity: "opportunity",
  project: "project",
}

export async function listEntityAttachments(
  type: AttachableType,
  id: string
): Promise<AttachmentRow[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        byteSize: attachments.byteSize,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(eq(attachments.attachableType, type), eq(attachments.attachableId, id))
      )
      .orderBy(desc(attachments.createdAt))
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  })
}

export type FunnelDocument = AttachmentRow & {
  source: "Funnel" | "Quotation" | "Approval"
}

/**
 * Centralized document view for a funnel: aggregates files attached to the
 * opportunity itself, its quotations, and its stage-approval requests — so a
 * signed quote/PO uploaded anywhere in the deal is visible on the funnel.
 */
export async function listOpportunityDocuments(
  opportunityId: string
): Promise<FunnelDocument[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const quoteIds = (
      await tx
        .select({ id: quotations.id })
        .from(quotations)
        .where(eq(quotations.opportunityId, opportunityId))
    ).map((q) => q.id)
    const reqIds = (
      await tx
        .select({ id: stageApprovalRequests.id })
        .from(stageApprovalRequests)
        .where(eq(stageApprovalRequests.opportunityId, opportunityId))
    ).map((r) => r.id)

    const rows = await tx
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        byteSize: attachments.byteSize,
        createdAt: attachments.createdAt,
        attachableType: attachments.attachableType,
      })
      .from(attachments)
      .where(
        or(
          and(
            eq(attachments.attachableType, "opportunity"),
            eq(attachments.attachableId, opportunityId)
          ),
          quoteIds.length
            ? and(
                eq(attachments.attachableType, "quotation"),
                inArray(attachments.attachableId, quoteIds)
              )
            : sql`false`,
          reqIds.length
            ? and(
                eq(attachments.attachableType, "stage_approval_request"),
                inArray(attachments.attachableId, reqIds)
              )
            : sql`false`
        )
      )
      .orderBy(desc(attachments.createdAt))

    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      contentType: r.contentType,
      byteSize: r.byteSize,
      createdAt: r.createdAt.toISOString(),
      source:
        r.attachableType === "opportunity"
          ? "Funnel"
          : r.attachableType === "quotation"
            ? "Quotation"
            : "Approval",
    }))
  })
}

export async function uploadEntityAttachment(formData: FormData): Promise<void> {
  const ctx = await requireContext()
  const file = formData.get("file") as File | null
  const type = formData.get("attachableType") as AttachableType
  const id = formData.get("attachableId") as string
  const revalidate = formData.get("revalidate") as string | null
  if (!file || !id || !type) throw new Error("Missing file or target")
  if (file.size > 25 * 1024 * 1024) throw new Error("File exceeds 25 MB")

  const buf = Buffer.from(await file.arrayBuffer())
  const stored = await storage.put(ctx.tenantId, file.name, buf)
  await runInTenant(ctx.tenantId, async (tx) => {
    await tx.insert(attachments).values({
      tenantId: ctx.tenantId,
      attachableType: type,
      attachableId: id,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      byteSize: stored.size,
      storageKey: stored.key,
      uploadedByMemberId: ctx.memberId,
    })
    const ent = ACTIVITY_ENTITY[type]
    if (ent) {
      await logActivity(tx, ctx, {
        entityType: ent,
        entityId: id,
        type: "file",
        subject: `Attached ${file.name}`,
      })
    }
  })
  if (revalidate) revalidatePath(revalidate)
}

export async function deleteEntityAttachment(
  id: string,
  revalidate?: string
): Promise<void> {
  const ctx = await requireContext()
  await runInTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1)
    if (!row) return
    await tx.delete(attachments).where(eq(attachments.id, id))
    try {
      await storage.delete(row.storageKey)
    } catch {
      // best-effort; row already removed
    }
  })
  if (revalidate) revalidatePath(revalidate)
}
