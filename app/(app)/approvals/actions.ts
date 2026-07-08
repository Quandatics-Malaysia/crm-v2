"use server"

import { and, desc, eq, inArray, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { revalidatePath } from "next/cache"
import { runInTenant } from "@/db"
import {
  stageApprovalRequests,
  funnels,
  pipelineStages,
  member,
  user,
  tenantSettings,
} from "@/db/schema"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { decideApproval, type DecisionOutcome } from "@/server/services/stage"

export type ApprovalRow = {
  id: string
  funnelId: string
  opportunityName: string
  requesterName: string | null
  approverName: string | null
  fromStageName: string | null
  targetStageName: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  decisionNote: string | null
  requestedAt: string
  decidedAt: string | null
}

const fromStage = alias(pipelineStages, "from_stage")
const targetStage = alias(pipelineStages, "target_stage")

/** Shared row shape builder — joins opportunity, stages, requester, approver. */
function buildApprovalQuery(tx: Parameters<Parameters<typeof runInTenant>[1]>[0], where: SQL | undefined) {
  return tx
    .select({
      id: stageApprovalRequests.id,
      funnelId: stageApprovalRequests.funnelId,
      opportunityName: funnels.name,
      requesterUserId: stageApprovalRequests.requesterMemberId,
      approverMemberId: stageApprovalRequests.approverMemberId,
      fromStageName: fromStage.name,
      targetStageName: targetStage.name,
      reason: stageApprovalRequests.reason,
      status: stageApprovalRequests.status,
      decisionNote: stageApprovalRequests.decisionNote,
      requestedAt: stageApprovalRequests.requestedAt,
      decidedAt: stageApprovalRequests.decidedAt,
    })
    .from(stageApprovalRequests)
    .innerJoin(
      funnels,
      eq(stageApprovalRequests.funnelId, funnels.id)
    )
    .leftJoin(fromStage, eq(stageApprovalRequests.fromStageId, fromStage.id))
    .innerJoin(
      targetStage,
      eq(stageApprovalRequests.targetStageId, targetStage.id)
    )
    .where(where)
    .orderBy(desc(stageApprovalRequests.requestedAt))
}

/** Resolve member ids -> display names in one round trip. */
async function nameMap(
  tx: Parameters<Parameters<typeof runInTenant>[1]>[0],
  memberIds: (string | null)[]
): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds.filter((m): m is string => !!m))]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ memberId: member.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(inArray(member.id, ids))
  const map = new Map<string, string>()
  for (const r of rows) map.set(r.memberId, r.name)
  return map
}

/** Pending requests routed to me (or any pending if I can approve broadly). */
export async function listIncomingApprovals(): Promise<ApprovalRow[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const canApprove = ctx.isSuperadmin || ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE)
    const conditions: SQL[] = [eq(stageApprovalRequests.status, "pending")]
    // A broad approver (or superadmin) can decide ANY pending request — see
    // decideApproval() — including one routed to a now-disabled approver, which
    // would otherwise sit pending and invisible. So they see every pending
    // request in the tenant (runInTenant already scopes to the tenant). Everyone
    // else only sees requests explicitly routed to them.
    if (!canApprove) {
      if (!ctx.memberId) return []
      conditions.push(eq(stageApprovalRequests.approverMemberId, ctx.memberId))
    }

    const rows = await buildApprovalQuery(tx, and(...conditions))
    const names = await nameMap(tx, [
      ...rows.map((r) => r.requesterUserId),
      ...rows.map((r) => r.approverMemberId),
    ])
    return rows.map((r) => shape(r, names))
  })
}

/**
 * The tenant's approval-gate tier: members at this tier (or above), plus anyone
 * holding the stage-approval permission, can both bypass the gate and approve
 * gated advances. Surfaced as inline help so the UI can name the approving tier.
 */
export async function getApprovalGateInfo(): Promise<{ bypassTier: number }> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const [settings] = await tx
      .select({ bypassTier: tenantSettings.approvalBypassTier })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return { bypassTier: settings?.bypassTier ?? 40 }
  })
}

/** Requests I raised. */
export async function listMyApprovals(): Promise<ApprovalRow[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    if (!ctx.memberId) return []
    const rows = await buildApprovalQuery(
      tx,
      eq(stageApprovalRequests.requesterMemberId, ctx.memberId)
    )
    const names = await nameMap(tx, [
      ...rows.map((r) => r.requesterUserId),
      ...rows.map((r) => r.approverMemberId),
    ])
    return rows.map((r) => shape(r, names))
  })
}

type RawRow = {
  id: string
  funnelId: string
  opportunityName: string
  requesterUserId: string
  approverMemberId: string | null
  fromStageName: string | null
  targetStageName: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  decisionNote: string | null
  requestedAt: Date
  decidedAt: Date | null
}

function shape(r: RawRow, names: Map<string, string>): ApprovalRow {
  return {
    id: r.id,
    funnelId: r.funnelId,
    opportunityName: r.opportunityName,
    requesterName: names.get(r.requesterUserId) ?? null,
    approverName: r.approverMemberId ? names.get(r.approverMemberId) ?? null : null,
    fromStageName: r.fromStageName,
    targetStageName: r.targetStageName,
    reason: r.reason,
    status: r.status,
    decisionNote: r.decisionNote,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  }
}

/**
 * Approve / reject / cancel a request via the core stage service. Returns the
 * resolved {@link DecisionOutcome} so the client can surface an honest message —
 * e.g. an approve that found the funnel already moved on resolves as `obsolete`
 * (request closed) rather than failing.
 */
export async function decideApprovalAction(input: {
  requestId: string
  decision: "approved" | "rejected" | "cancelled"
  note?: string
}): Promise<ActionResult<DecisionOutcome>> {
  return runAction(async () => {
    const ctx = await requireContext()
    const outcome = await decideApproval(ctx, input)
    revalidatePath("/approvals")
    // An approved/obsolete decision changes the funnel's stage, so refresh the
    // funnel views too.
    revalidatePath("/funnel")
    return outcome
  })
}
