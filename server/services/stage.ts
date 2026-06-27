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

/**
 * Render a naive `date` column value (YYYY-MM-DD) from a timestamp using the
 * server's local calendar rather than a raw UTC slice, so `actualCloseDate`
 * stays consistent with the `closedAt` timestamptz it is derived from instead of
 * rolling a day early for tenants east of UTC. (No per-tenant timezone field
 * exists yet; the reporting layer remains the place to re-localize if needed.)
 */
function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

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

/** Stage kinds other than OPEN are terminal (Won / Lost / KIV-parked). */
function isTerminalKind(kind: string): boolean {
  return kind !== "OPEN"
}

/**
 * Enforce the stage state machine for a single move:
 *  - the deal can't move to the stage it's already in,
 *  - a closed/parked (terminal) deal can't move at all without an explicit,
 *    separately-handled reopen (none is wired today, so it's simply rejected),
 *  - moving between OPEN stages must go forward (monotonic) — no backward hops.
 * OPEN → terminal (win / lose / park) is always allowed from an open stage.
 */
function assertTransitionAllowed(from: StageRow, to: StageRow): void {
  if (from.id === to.id) throw new Error("The deal is already in this stage")
  if (isTerminalKind(from.kind))
    throw new Error("This deal is closed. Reopen it before changing its stage.")
  if (to.kind === "OPEN" && to.sortOrder <= from.sortOrder)
    throw new Error("Stage moves must advance forward in the pipeline")
}

/** Whether the actor may enter approval-gated stages without a request. */
function canBypassApproval(
  ctx: ServerContext,
  settings: typeof tenantSettings.$inferSelect | undefined
): boolean {
  const bypassTier = settings?.approvalBypassTier ?? 40
  return (
    ctx.isSuperadmin ||
    ctx.tierLevel >= bypassTier ||
    ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE)
  )
}

/** Walk the upline chain for the first ancestor that can approve; else any approver. */
async function resolveApprover(
  tx: Tx,
  requesterMemberId: string,
  requesterTier: number
): Promise<string> {
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
      // Only an active member can actually act on the request — a disabled or
      // still-invited approver would leave it stuck pending and invisible.
      mgrProf.status === "active" &&
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
        eq(membershipProfiles.status, "active"),
        ne(membershipProfiles.memberId, requesterMemberId)
      )
    )
    .limit(1)
  if (!fallback?.m)
    throw new Error(
      "No approver is available to route this request. Ask an administrator to grant the stage-approval permission."
    )
  return fallback.m
}

/**
 * Create (or reuse) a pending approval request routed to the upline. Shared by
 * manual gated advances and the quote-accept auto-win when the Won stage is
 * approval-gated, so neither path can silently bypass the gate.
 */
async function createApprovalRequest(
  tx: Tx,
  ctx: ServerContext,
  opp: OppRow,
  target: StageRow,
  reason: string
): Promise<{ approvalRequestId: string }> {
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
  if (existing) return { approvalRequestId: existing.id }

  const approver = await resolveApprover(tx, ctx.memberId, ctx.tierLevel)
  const [req] = await tx
    .insert(stageApprovalRequests)
    .values({
      tenantId: ctx.tenantId,
      opportunityId: opp.id,
      requesterMemberId: ctx.memberId,
      fromStageId: opp.currentStageId,
      targetStageId: target.id,
      reason: reason.trim(),
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
  return { approvalRequestId: req.id }
}

async function applyStageMove(
  tx: Tx,
  ctx: ServerContext,
  opp: OppRow,
  toStage: StageRow,
  source: "manual" | "approval" | "quote_accept" | "reopen",
  approvalRequestId?: string | null,
  reason?: string | null
): Promise<void> {
  const status = kindToStatus(toStage.kind)
  const closing = status === "won" || status === "lost"
  // Preserve the original close timestamp/date if the deal was already closed;
  // only stamp a new one when a still-open deal is being closed. Derive
  // actualCloseDate from this same timestamp so the date and timestamptz agree.
  const closeTs = closing ? opp.closedAt ?? new Date() : null
  await tx
    .update(opportunities)
    .set({
      currentStageId: toStage.id,
      status,
      closedAt: closeTs,
      actualCloseDate: closeTs
        ? opp.actualCloseDate ?? toDateString(closeTs)
        : null,
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
    reason: reason ?? null,
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

    const [from] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, opp.currentStageId))
      .limit(1)
    if (!from) throw new Error("Current stage not found")

    const [target] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, input.targetStageId))
      .limit(1)
    if (!target) throw new Error("Stage not found")
    if (target.funnelId !== opp.funnelId)
      throw new Error("Stage does not belong to this funnel")

    // Enforce the stage state machine before anything else.
    assertTransitionAllowed(from, target)

    const [settings] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    const gated =
      target.requiresApprovalToEnter && !canBypassApproval(ctx, settings)

    if (!gated) {
      await applyStageMove(
        tx,
        ctx,
        opp,
        target,
        "manual",
        null,
        input.reason?.trim() || null
      )
      return { moved: true }
    }

    if (!input.reason || !input.reason.trim())
      throw new Error("A reason is required for this approval")

    const { approvalRequestId } = await createApprovalRequest(
      tx,
      ctx,
      opp,
      target,
      input.reason
    )
    return { moved: false, approvalRequestId }
  })
}

/**
 * Move an opportunity to its funnel's WON stage. Called when a quotation is
 * accepted and the tenant has auto-win enabled. No-op if already won, and a
 * no-op (never an override) when the deal is already closed/parked — accepting
 * a quote must not silently reopen a Lost/KIV deal into Won. If the Won stage
 * is approval-gated and the actor can't bypass, a pending approval request is
 * raised instead of moving directly. Signature is intentionally stable;
 * `acceptQuotation` (quotations folder) calls this.
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
      .for("update")
    if (!opp) return
    // Status guard: only an OPEN deal may auto-win. Won (already), Lost, and
    // KIV/on-hold deals are left untouched.
    if (opp.status !== "open") return

    const [won] = await tx
      .select()
      .from(funnelStages)
      .where(and(eq(funnelStages.funnelId, opp.funnelId), eq(funnelStages.kind, "WON")))
      .limit(1)
    if (!won || opp.currentStageId === won.id) return

    // Respect the Won stage's approval gate instead of bypassing it.
    const [settings] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    if (won.requiresApprovalToEnter && !canBypassApproval(ctx, settings)) {
      await createApprovalRequest(
        tx,
        ctx,
        opp,
        won,
        "Auto-win on quotation acceptance"
      )
      return
    }

    await applyStageMove(tx, ctx, opp, won, "quote_accept")
  })
}

/**
 * Explicitly reopen a closed deal: a PARKED (KIV) or LOST opportunity is moved
 * back to a chosen OPEN stage, which clears `closedAt`/`actualCloseDate` and
 * resets `status` to "open" (via applyStageMove). This is the only sanctioned
 * way out of a terminal state — `assertTransitionAllowed` otherwise freezes
 * closed deals forever. WON is intentionally NOT reopenable here because it has
 * downstream accepted quotes/projects/sales orders that depend on the win.
 * Permission (`stage.advance`) and record-scope are enforced by the caller.
 */
export async function reopenOpportunity(
  ctx: ServerContext,
  input: { opportunityId: string; targetStageId: string; reason?: string }
): Promise<void> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1)
      .for("update")
    if (!opp) throw new Error("Opportunity not found")
    if (opp.status === "open") throw new Error("This deal is already open")

    const [from] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, opp.currentStageId))
      .limit(1)
    if (!from) throw new Error("Current stage not found")
    if (from.kind !== "PARKED" && from.kind !== "LOST")
      throw new Error("Only parked or lost deals can be reopened")

    const [target] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, input.targetStageId))
      .limit(1)
    if (!target) throw new Error("Stage not found")
    if (target.funnelId !== opp.funnelId)
      throw new Error("Stage does not belong to this funnel")
    if (target.kind !== "OPEN")
      throw new Error("A reopened deal must move to an open stage")

    // The `reopen` source already marks this move as a reopen, so the reason is
    // stored verbatim (no "Reopened:" prefix needed).
    await applyStageMove(
      tx,
      ctx,
      opp,
      target,
      "reopen",
      null,
      input.reason?.trim() || null
    )
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
    // Lock the request row so concurrent decisions serialize: a second caller
    // blocks here until this tx commits, then sees status != 'pending'.
    const [req] = await tx
      .select()
      .from(stageApprovalRequests)
      .where(eq(stageApprovalRequests.id, input.requestId))
      .limit(1)
      .for("update")
    if (!req) throw new Error("Request not found")
    if (req.status !== "pending") throw new Error("Request already decided")

    if (input.decision === "cancelled") {
      if (req.requesterMemberId !== ctx.memberId && !ctx.isSuperadmin)
        throw new Error("Only the requester can cancel")
      // Conditional update guarded by status so a racing decision can't be
      // overwritten; rowCount of 0 means it was already decided.
      const cancelled = await tx
        .update(stageApprovalRequests)
        .set({ status: "cancelled", decidedAt: new Date(), decisionNote: input.note ?? null })
        .where(
          and(
            eq(stageApprovalRequests.id, req.id),
            eq(stageApprovalRequests.status, "pending")
          )
        )
        .returning({ id: stageApprovalRequests.id })
      if (cancelled.length === 0) throw new Error("Request already decided")
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
      const rejected = await tx
        .update(stageApprovalRequests)
        .set({
          status: "rejected",
          approverMemberId: ctx.memberId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        })
        .where(
          and(
            eq(stageApprovalRequests.id, req.id),
            eq(stageApprovalRequests.status, "pending")
          )
        )
        .returning({ id: stageApprovalRequests.id })
      if (rejected.length === 0) throw new Error("Request already decided")
      await writeAudit(tx, ctx, {
        action: "approval.rejected",
        entityType: "stage_approval_request",
        entityId: req.id,
      })
      return
    }

    // Approved: lock the opportunity, re-validate the transition against the
    // deal's *current* stage (it may have closed since the request was filed),
    // then claim the request atomically before applying the move.
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, req.opportunityId))
      .limit(1)
      .for("update")
    if (!opp) throw new Error("Opportunity or stage missing")
    const [from] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, opp.currentStageId))
      .limit(1)
    const [target] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, req.targetStageId))
      .limit(1)
    if (!from || !target) throw new Error("Opportunity or stage missing")
    assertTransitionAllowed(from, target)

    const claimed = await tx
      .update(stageApprovalRequests)
      .set({
        status: "approved",
        approverMemberId: ctx.memberId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      })
      .where(
        and(
          eq(stageApprovalRequests.id, req.id),
          eq(stageApprovalRequests.status, "pending")
        )
      )
      .returning({ id: stageApprovalRequests.id })
    if (claimed.length === 0) throw new Error("Request already decided")

    await applyStageMove(tx, ctx, opp, target, "approval", req.id, req.reason)
    await writeAudit(tx, ctx, {
      action: "approval.approved",
      entityType: "stage_approval_request",
      entityId: req.id,
    })
  })
}
