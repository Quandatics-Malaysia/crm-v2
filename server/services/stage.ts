import "server-only"
import { and, eq, ne } from "drizzle-orm"
import { runInTenant, type Tx } from "@/db"
import {
  funnels,
  pipelineStages,
  funnelStageHistory,
  stageApprovalRequests,
  membershipProfiles,
  roles,
  rolePermissions,
  permissions,
  tenantSettings,
} from "@/db/schema"
import { PERMISSIONS } from "@/lib/permissions"
import {
  buildStageGate,
  missingFromKeys,
  requiresCloseRemarks,
  closeRemarksLabel,
  stagesEnteredBy,
  requiredKeysForStages,
  type StageGateState,
} from "@/lib/stage-gate"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { isModuleEnabled } from "@/lib/modules"
import type { ServerContext } from "@/lib/server-context"
// Shared LOCAL YYYY-MM-DD formatter. Deriving `actualCloseDate` from this (a
// local-calendar slice) instead of a raw UTC `toISOString().slice(0,10)` keeps
// the date consistent with the `closedAt` timestamptz instead of rolling a day
// early for tenants east of UTC. (No per-tenant timezone field exists yet; the
// reporting layer remains the place to re-localize if needed.)
import { toDateString } from "@/lib/dates"

type StageRow = typeof pipelineStages.$inferSelect
type OppRow = typeof funnels.$inferSelect

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
  if (from.id === to.id) throw new Error("This funnel is already in this stage")
  if (isTerminalKind(from.kind))
    throw new Error("This funnel is closed. Reopen it before changing its stage.")
  if (to.kind === "OPEN" && to.sortOrder <= from.sortOrder)
    throw new Error("Stage moves must advance forward in the funnel")
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
        eq(stageApprovalRequests.funnelId, opp.id),
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
      funnelId: opp.id,
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
    after: { funnelId: opp.id, targetStage: target.code },
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
    .update(funnels)
    .set({
      currentStageId: toStage.id,
      status,
      closedAt: closeTs,
      actualCloseDate: closeTs
        ? opp.actualCloseDate ?? toDateString(closeTs)
        : null,
    })
    .where(eq(funnels.id, opp.id))

  await tx.insert(funnelStageHistory).values({
    tenantId: ctx.tenantId,
    funnelId: opp.id,
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
  // Stage + status feed the partner-facing intercompany mirror (no-op unless
  // this deal is intercompany). Loaded lazily so this next-free service carries
  // no static dependency on the finance plugin.
  if (isModuleEnabled("finance")) {
    const { syncIntercompanyMirror } = await import("@/server/services/intercompany")
    await syncIntercompanyMirror(tx, opp.id)
  }
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
  input: {
    funnelId: string
    targetStageId: string
    reason?: string
    /** Custom-field values captured in the advance dialog, merged onto the
     *  funnel before the entry gate is evaluated. */
    customFields?: Record<string, string>
  }
): Promise<AdvanceOutcome> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.id, input.funnelId))
      .limit(1)
    if (!opp) throw new Error("Funnel not found")

    // Every stage of this funnel — needed to resolve the requirements of any
    // intermediate stages a multi-stage jump skips over.
    const allStages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, opp.pipelineId))

    const from = allStages.find((s) => s.id === opp.currentStageId)
    if (!from) throw new Error("Current stage not found")

    const target = allStages.find((s) => s.id === input.targetStageId)
    if (!target) throw new Error("Stage not found")
    if (target.pipelineId !== opp.pipelineId)
      throw new Error("Stage does not belong to this funnel")

    // Enforce the stage state machine before anything else.
    assertTransitionAllowed(from, target)

    const [settings] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    // Merge the dialog's custom-field values onto the funnel before evaluating
    // the gate, so the info the user just filled in counts.
    const mergedCustom: Record<string, unknown> = {
      ...((opp.customFields ?? {}) as Record<string, unknown>),
      ...(input.customFields ?? {}),
    }

    // Entry requirements: the information that must be on the funnel before it
    // may enter this stage (mirrors Salesforce's "fill the info to mark this
    // stage" gate). Authoritative — the dialog pre-checks the same rules.
    // Presets read real columns; custom fields read the merged values. A
    // multi-stage jump (e.g. 0e→4a) must satisfy every stage it passes through.
    const presets: StageGateState = {
      hasEstimate:
        opp.estimatedAmount != null && Number(opp.estimatedAmount) > 0,
      hasCloseDate: !!opp.expectedCloseDate,
      hasContact: !!opp.primaryPersonId,
      hasNature:
        Array.isArray(opp.projectNatures) && opp.projectNatures.length > 0,
      hasQuote: !!opp.primaryQuotationId,
    }
    const stageGate = buildStageGate(
      presets,
      mergedCustom,
      settings?.customFunnelFields ?? []
    )
    // Requirements are tenant custom fields only; any legacy preset key left on
    // a stage is ignored (never enforced) so it can't silently block a move.
    const customKeys = new Set(
      (settings?.customFunnelFields ?? []).map((f) => f.key)
    )
    const requiredKeys = requiredKeysForStages(
      stagesEnteredBy(allStages, from.id, target.id)
    ).filter((k) => customKeys.has(k))
    const missing = missingFromKeys(requiredKeys, stageGate)
    if (missing.length > 0) {
      throw new Error(
        `Add ${missing.map((m) => m.label).join(", ")} before moving to ${target.name}.`
      )
    }
    if (requiresCloseRemarks(target.kind) && !input.reason?.trim()) {
      throw new Error(
        `${closeRemarksLabel(target.kind)} is required to move to ${target.name}.`
      )
    }

    // Persist the captured custom-field values (even when the move only queues
    // an approval — the info is now on record for the approver).
    if (input.customFields && Object.keys(input.customFields).length > 0) {
      await tx
        .update(funnels)
        .set({ customFields: mergedCustom as Record<string, string> })
        .where(eq(funnels.id, opp.id))
    }

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
 * raised instead of moving directly. Signature is intentionally additive;
 * `acceptQuotation` (quotations folder) calls this.
 *
 * Returns `{ moved, pendingApproval }`:
 *  - `moved` is true only when the funnel actually advanced into Won,
 *  - `pendingApproval` is true when the Won stage is gated and only a pending
 *    approval request was filed (the funnel did NOT move yet),
 *  - both false on a no-op (no funnel, already closed/won, or no Won stage).
 * The caller's toast can then say "win is pending approval" rather than "won".
 */
export type WinOutcome = { moved: boolean; pendingApproval: boolean }

export async function winOpportunity(
  ctx: ServerContext,
  funnelId: string
): Promise<WinOutcome> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.id, funnelId))
      .limit(1)
      .for("update")
    if (!opp) return { moved: false, pendingApproval: false }
    // Status guard: only an OPEN funnel may auto-win. Won (already), Lost, and
    // KIV/on-hold pipelines are left untouched.
    if (opp.status !== "open") return { moved: false, pendingApproval: false }

    const [won] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, opp.pipelineId), eq(pipelineStages.kind, "WON")))
      .limit(1)
    if (!won || opp.currentStageId === won.id)
      return { moved: false, pendingApproval: false }

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
      return { moved: false, pendingApproval: true }
    }

    await applyStageMove(tx, ctx, opp, won, "quote_accept")
    return { moved: true, pendingApproval: false }
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
  input: { funnelId: string; targetStageId: string; reason?: string }
): Promise<void> {
  return runInTenant(ctx.tenantId, async (tx) => {
    const [opp] = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.id, input.funnelId))
      .limit(1)
      .for("update")
    if (!opp) throw new Error("Funnel not found")
    if (opp.status === "open") throw new Error("This funnel is already open")

    const [from] = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.id, opp.currentStageId))
      .limit(1)
    if (!from) throw new Error("Current stage not found")
    if (from.kind !== "PARKED" && from.kind !== "LOST")
      throw new Error("Only parked or lost pipelines can be reopened")

    const [target] = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.id, input.targetStageId))
      .limit(1)
    if (!target) throw new Error("Stage not found")
    if (target.pipelineId !== opp.pipelineId)
      throw new Error("Stage does not belong to this funnel")
    if (target.kind !== "OPEN")
      throw new Error("A reopened funnel must move to an open stage")

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

/**
 * Outcome of a decision. `status` is the request's resolved status — note the
 * extra `"obsolete"` value: an approve that could no longer be applied because
 * the funnel had already moved past/closed the target stage (the request is
 * recorded as `rejected` in the DB with an explanatory note, but reported as
 * obsolete here so the UI can show a neutral, non-error message). `message` is a
 * friendly, user-facing summary the caller can surface in a toast.
 */
export type DecisionOutcome = {
  status: "approved" | "rejected" | "cancelled" | "obsolete"
  message: string
}

/** Approve (performs the move), reject (no change), or cancel (requester only). */
export async function decideApproval(
  ctx: ServerContext,
  input: {
    requestId: string
    decision: "approved" | "rejected" | "cancelled"
    note?: string
  }
): Promise<DecisionOutcome> {
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
      return { status: "cancelled", message: "Request cancelled" }
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
      return { status: "rejected", message: "Request rejected" }
    }

    // Approved: lock the funnel and re-validate the transition against its
    // *current* stage — it may have advanced to/past the target, or closed
    // entirely, since the request was filed.
    const [opp] = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.id, req.funnelId))
      .limit(1)
      .for("update")
    if (!opp) throw new Error("Funnel or stage missing")
    const [from] = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.id, opp.currentStageId))
      .limit(1)
    const [target] = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.id, req.targetStageId))
      .limit(1)
    if (!from || !target) throw new Error("Funnel or stage missing")

    // If the move is no longer applicable — the funnel already sits in the
    // target stage, has been closed (Won/Lost/KIV), or advanced past an open
    // target — DON'T throw + roll back (that would leave the request stuck
    // 'pending' forever, never leaving the queue). Instead resolve it
    // gracefully: record it as decided with a clear "obsolete" note and commit,
    // so it leaves the pending queue with an honest history trail.
    const obsolete =
      from.id === target.id ||
      isTerminalKind(from.kind) ||
      (target.kind === "OPEN" && target.sortOrder <= from.sortOrder)
    if (obsolete) {
      const closeNote =
        "This funnel already moved past the requested stage; request closed."
      const note = input.note?.trim()
        ? `${input.note.trim()} — ${closeNote}`
        : closeNote
      const resolved = await tx
        .update(stageApprovalRequests)
        .set({
          // No "obsolete" value exists in the approval_status enum, so persist
          // as 'rejected' (a terminal, non-pending status) with an explanatory
          // note; the returned outcome distinguishes it as "obsolete".
          status: "rejected",
          approverMemberId: ctx.memberId,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(
          and(
            eq(stageApprovalRequests.id, req.id),
            eq(stageApprovalRequests.status, "pending")
          )
        )
        .returning({ id: stageApprovalRequests.id })
      if (resolved.length === 0) throw new Error("Request already decided")
      await writeAudit(tx, ctx, {
        action: "approval.obsolete",
        entityType: "stage_approval_request",
        entityId: req.id,
        after: { reason: "funnel already moved past requested stage" },
      })
      return { status: "obsolete", message: closeNote }
    }

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
    return {
      status: "approved",
      message: `Request approved — moved to ${target.name}`,
    }
  })
}
