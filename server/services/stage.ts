import "server-only"
import { and, eq, ne } from "drizzle-orm"
import { runInTenant, type Tx } from "@/db"
import {
  opportunities,
  funnelStages,
  opportunityStageHistory,
  stageApprovalRequests,
  membershipProfiles,
  roles,
  rolePermissions,
  permissions,
  tenantSettings,
} from "@/db/schema"
import { PERMISSIONS } from "@/lib/permissions"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import type { ServerContext } from "@/lib/server-context"

type StageRow = typeof funnelStages.$inferSelect
type OppRow = typeof opportunities.$inferSelect

function kindToStatus(kind: string): "open" | "won" | "lost" | "on_hold" {
  switch (kind) {
    case "WON":
      return "won"
    case "LOST":
      return "lost"
    case "PARKED":
      return "on_hold"
    default:
      return "open"
  }
}

async function memberHasPermission(
  tx: Tx,
  memberId: string,
  key: string
): Promise<boolean> {
  const rows = await tx
    .select({ k: permissions.key })
    .from(membershipProfiles)
    .innerJoin(roles, eq(membershipProfiles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(membershipProfiles.memberId, memberId), eq(permissions.key, key)))
    .limit(1)
  return rows.length > 0
}

/** Walk the upline chain for the first ancestor that can approve; else any approver. */
async function resolveApprover(
  tx: Tx,
  requesterMemberId: string,
  requesterTier: number
): Promise<string | null> {
  let cursor = requesterMemberId
  const seen = new Set<string>([requesterMemberId])
  for (let i = 0; i < 25; i++) {
    const [prof] = await tx
      .select()
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, cursor))
      .limit(1)
    const mgr = prof?.managerMemberId
    if (!mgr || seen.has(mgr)) break
    seen.add(mgr)
    const [mgrProf] = await tx
      .select()
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, mgr))
      .limit(1)
    if (
      mgrProf &&
      (mgrProf.tierLevel ?? 0) >= requesterTier &&
      (await memberHasPermission(tx, mgr, PERMISSIONS.STAGE_ADVANCE_APPROVE))
    ) {
      return mgr
    }
    cursor = mgr
  }
  const [fallback] = await tx
    .select({ m: membershipProfiles.memberId })
    .from(membershipProfiles)
    .innerJoin(roles, eq(membershipProfiles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(permissions.key, PERMISSIONS.STAGE_ADVANCE_APPROVE),
        ne(membershipProfiles.memberId, requesterMemberId)
      )
    )
    .limit(1)
  return fallback?.m ?? null
}

async function applyStageMove(
  tx: Tx,
  ctx: ServerContext,
  opp: OppRow,
  toStage: StageRow,
  source: "manual" | "approval" | "quote_accept",
  approvalRequestId?: string | null
): Promise<void> {
  const status = kindToStatus(toStage.kind)
  const closing = status === "won" || status === "lost"
  await tx
    .update(opportunities)
    .set({
      currentStageId: toStage.id,
      status,
      closedAt: closing ? new Date() : null,
      actualCloseDate: closing ? new Date().toISOString().slice(0, 10) : null,
    })
    .where(eq(opportunities.id, opp.id))

  await tx.insert(opportunityStageHistory).values({
    tenantId: ctx.tenantId,
    opportunityId: opp.id,
    fromStageId: opp.currentStageId,
    toStageId: toStage.id,
    changedByMemberId: ctx.memberId,
    approvalRequestId: approvalRequestId ?? null,
    probabilityAtChange: toStage.probability,
    valueAtChange: opp.amount,
    source,
  })

  await writeAudit(tx, ctx, {
    action: "opportunity.stage_changed",
    entityType: "opportunity",
    entityId: opp.id,
    after: { stage: toStage.code, source },
  })
  await logActivity(tx, ctx, {
    entityType: "opportunity",
    entityId: opp.id,
    type: "stage_change",
    subject: `Stage → ${toStage.name}`,
  })
}

export type AdvanceOutcome = { moved: boolean; approvalRequestId?: string }

/**
 * Two gates: (1) the caller must already hold `stage.advance`. (2) if the target
 * stage requires approval AND the actor is below the tenant bypass tier (and is
 * not an approver), the stage does NOT move — a pending approval request is
 * created and routed to the upline. Otherwise the stage moves immediately.
 */
export async function requestStageAdvance(
  ctx: ServerContext,
  input: { opportunityId: string; targetStageId: string; reason?: string }
): Promise<AdvanceOutcome> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1)
    if (!opp) throw new Error("Opportunity not found")

    const [target] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, input.targetStageId))
      .limit(1)
    if (!target) throw new Error("Stage not found")
    if (target.funnelId !== opp.funnelId)
      throw new Error("Stage does not belong to this funnel")

    const [settings] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    const bypassTier = settings?.approvalBypassTier ?? 40
    const canBypass =
      ctx.isSuperadmin ||
      ctx.tierLevel >= bypassTier ||
      ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE)
    const gated = target.requiresApprovalToEnter && !canBypass

    if (!gated) {
      await applyStageMove(tx, ctx, opp, target, "manual")
      return { moved: true }
    }

    if (!input.reason || !input.reason.trim())
      throw new Error("A reason is required for this approval")
    if (!ctx.memberId) throw new Error("No member context")

    const [existing] = await tx
      .select({ id: stageApprovalRequests.id })
      .from(stageApprovalRequests)
      .where(
        and(
          eq(stageApprovalRequests.opportunityId, opp.id),
          eq(stageApprovalRequests.targetStageId, target.id),
          eq(stageApprovalRequests.status, "pending")
        )
      )
      .limit(1)
    if (existing) return { moved: false, approvalRequestId: existing.id }

    const approver = await resolveApprover(tx, ctx.memberId, ctx.tierLevel)
    const [req] = await tx
      .insert(stageApprovalRequests)
      .values({
        tenantId: ctx.tenantId,
        opportunityId: opp.id,
        requesterMemberId: ctx.memberId,
        fromStageId: opp.currentStageId,
        targetStageId: target.id,
        reason: input.reason.trim(),
        status: "pending",
        approverMemberId: approver,
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "approval.requested",
      entityType: "stage_approval_request",
      entityId: req.id,
      after: { opportunityId: opp.id, targetStage: target.code },
    })
    return { moved: false, approvalRequestId: req.id }
  })
}

/**
 * Move an opportunity to its funnel's WON stage. Called when a quotation is
 * accepted and the tenant has auto-win enabled. No-op if already won.
 */
export async function winOpportunity(
  ctx: ServerContext,
  opportunityId: string
): Promise<void> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1)
    if (!opp) return
    const [won] = await tx
      .select()
      .from(funnelStages)
      .where(and(eq(funnelStages.funnelId, opp.funnelId), eq(funnelStages.kind, "WON")))
      .limit(1)
    if (!won || opp.currentStageId === won.id) return
    await applyStageMove(tx, ctx, opp, won, "quote_accept")
  })
}

/** Approve (performs the move), reject (no change), or cancel (requester only). */
export async function decideApproval(
  ctx: ServerContext,
  input: {
    requestId: string
    decision: "approved" | "rejected" | "cancelled"
    note?: string
  }
): Promise<void> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [req] = await tx
      .select()
      .from(stageApprovalRequests)
      .where(eq(stageApprovalRequests.id, input.requestId))
      .limit(1)
    if (!req) throw new Error("Request not found")
    if (req.status !== "pending") throw new Error("Request already decided")

    if (input.decision === "cancelled") {
      if (req.requesterMemberId !== ctx.memberId && !ctx.isSuperadmin)
        throw new Error("Only the requester can cancel")
      await tx
        .update(stageApprovalRequests)
        .set({ status: "cancelled", decidedAt: new Date(), decisionNote: input.note ?? null })
        .where(eq(stageApprovalRequests.id, req.id))
      await writeAudit(tx, ctx, {
        action: "approval.cancelled",
        entityType: "stage_approval_request",
        entityId: req.id,
      })
      return
    }

    const allowed =
      ctx.isSuperadmin ||
      ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE) ||
      req.approverMemberId === ctx.memberId
    if (!allowed) throw new Error("Not authorized to decide this request")
    if (req.requesterMemberId === ctx.memberId && !ctx.isSuperadmin)
      throw new Error("Cannot approve your own request")

    if (input.decision === "rejected") {
      await tx
        .update(stageApprovalRequests)
        .set({
          status: "rejected",
          approverMemberId: ctx.memberId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        })
        .where(eq(stageApprovalRequests.id, req.id))
      await writeAudit(tx, ctx, {
        action: "approval.rejected",
        entityType: "stage_approval_request",
        entityId: req.id,
      })
      return
    }

    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, req.opportunityId))
      .limit(1)
    const [target] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, req.targetStageId))
      .limit(1)
    if (!opp || !target) throw new Error("Opportunity or stage missing")

    await applyStageMove(tx, ctx, opp, target, "approval", req.id)
    await tx
      .update(stageApprovalRequests)
      .set({
        status: "approved",
        approverMemberId: ctx.memberId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      })
      .where(eq(stageApprovalRequests.id, req.id))
    await writeAudit(tx, ctx, {
      action: "approval.approved",
      entityType: "stage_approval_request",
      entityId: req.id,
    })
  })
}
