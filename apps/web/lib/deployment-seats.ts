import "server-only"

import { sql } from "drizzle-orm"

import { db, type Tx } from "@/db"
import { writeAuthAudit } from "@/server/audit"
import { assertWriteAllowed } from "@/lib/write-access"

function assertMembershipWriteAllowed(): Promise<void> {
  return assertWriteAllowed({ operation: "membership_mutation" })
}

export function normalizeSeatEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    /[\u0000-\u001f\u007f-\u009f\s]/u.test(normalized)
  ) {
    throw new Error("Invalid seat email")
  }
  return normalized
}

export type DeploymentSeatResult = {
  allowed: boolean
  reason: string
  occupiedUsers: number
  reservedInvitations: number
  seatLimit: number
  overage: boolean
  accessMode?: string
}

type DecisionRow = {
  allowed: boolean
  reason: string
  occupied_user_count: number | string
  reserved_invitation_count: number | string
  seat_limit: number
  overage: boolean
}

type UsageRow = {
  occupied_user_count: number | string
  reserved_invitation_count: number | string
  seat_limit: number
  access_mode: string
  write_allowed: boolean
  overage: boolean
}

type InvitationDecisionRow = DecisionRow & { effective_invitation_id: string }
type MembershipDecisionRow = DecisionRow & { effective_member_id: string }

type SeatActor = { userId: string; memberId: string }

function decisionResult(row: DecisionRow | undefined): DeploymentSeatResult {
  if (!row) throw new Error("Deployment seat decision returned no result")
  const occupiedUsers = Number(row.occupied_user_count)
  const reservedInvitations = Number(row.reserved_invitation_count)
  if (!Number.isSafeInteger(occupiedUsers) || !Number.isSafeInteger(reservedInvitations)) {
    throw new Error("Deployment seat decision returned invalid counts")
  }
  return {
    allowed: row.allowed,
    reason: row.reason,
    occupiedUsers,
    reservedInvitations,
    seatLimit: row.seat_limit,
    overage: row.overage,
  }
}

function assertAllowed(result: DeploymentSeatResult): void {
  if (result.allowed) return
  if (result.reason === "seat_limit") throw new Error("Deployment seat limit has been reached.")
  if (result.reason === "vendor_support_no_membership") {
    throw new Error("Vendor support identities cannot receive standing CRM membership.")
  }
  if (result.reason === "platform_master_existing_only") {
    throw new Error("The platform master cannot be granted new standing tenant membership.")
  }
  throw new Error("A write-enabled deployment entitlement is required to change seats.")
}

async function lockUsage(tx: Tx, now: Date): Promise<DeploymentSeatResult> {
  const rows = await tx.execute(sql`
    select * from read_deployment_seat_usage(${now.toISOString()}::timestamp with time zone)
  `) as unknown as UsageRow[]
  const row = rows[0]
  if (!row) throw new Error("Deployment seat usage returned no result")
  return {
    allowed: row.write_allowed,
    reason: row.access_mode,
    occupiedUsers: Number(row.occupied_user_count),
    reservedInvitations: Number(row.reserved_invitation_count),
    seatLimit: row.seat_limit,
    overage: row.overage,
    accessMode: row.access_mode,
  }
}

async function setTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`)
}

export async function getDeploymentSeatUsage(now = new Date()): Promise<DeploymentSeatResult> {
  return db.transaction((tx) => lockUsage(tx, now))
}

export async function provisionEntitySeats(input: {
  tenantId: string
  actor: { userId: string }
  entries: Array<
    | { kind: "active"; userId: string; memberId?: string; roleId: string | null; tierLevel: number }
    | { kind: "invite"; email: string; roleId: string | null; tierLevel: number; expiresAt?: Date }
  >
  entityAudit: { name: string; slug: string; invites: Array<{ email: string; roleName: string }> }
  now?: Date
}): Promise<void> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  await db.transaction(async (tx) => {
    await lockUsage(tx, now)
    await setTenant(tx, input.tenantId)
    for (const entry of input.entries) {
      if (entry.kind === "active") {
        const rows = await tx.execute(sql`select * from bootstrap_deployment_owner(
          ${input.tenantId}, ${entry.userId}, ${entry.memberId ?? crypto.randomUUID()},
          ${entry.roleId}, ${entry.tierLevel}, 'empty',
          ${now.toISOString()}::timestamp with time zone
        )`) as unknown as MembershipDecisionRow[]
        assertAllowed(decisionResult(rows[0]))
      } else {
        const normalizedEmail = normalizeSeatEmail(entry.email)
        const expiresAt = entry.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const invitationId = crypto.randomUUID()
        const rows = await tx.execute(sql`select * from bootstrap_deployment_invitation(
          ${invitationId}::uuid, ${input.tenantId}, ${normalizedEmail}, ${entry.roleId},
          ${entry.tierLevel}, ${input.actor.userId}, ${expiresAt.toISOString()}::timestamp with time zone,
          ${now.toISOString()}::timestamp with time zone
        )`) as unknown as InvitationDecisionRow[]
        assertAllowed(decisionResult(rows[0]))
      }
    }
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "entity.created",
      actorUserId: input.actor.userId,
      entityType: "organization",
      entityId: input.tenantId,
      after: input.entityAudit,
    })
  })
}

export async function reserveInvitation(input: {
  tenantId: string
  invitationId?: string
  email: string
  roleId: string | null
  tierLevel?: number
  invitedByMemberId?: string | null
  actor: SeatActor
  expiresAt?: Date
  now?: Date
}): Promise<{ invitationId: string; result: DeploymentSeatResult }> {
  await assertMembershipWriteAllowed()
  const normalizedEmail = normalizeSeatEmail(input.email)
  const now = input.now ?? new Date()
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw new Error("Invite expiry must be in the future.")

  return db.transaction(async (tx) => {
    const proposedInvitationId = input.invitationId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`select * from reserve_deployment_invitation(
      ${proposedInvitationId}::uuid, ${input.tenantId}, ${normalizedEmail}, ${input.roleId},
      ${input.tierLevel ?? 0}, ${input.invitedByMemberId ?? null}, ${input.actor.userId},
      ${input.actor.memberId}, ${expiresAt.toISOString()}::timestamp with time zone,
      ${now.toISOString()}::timestamp with time zone
    )`) as unknown as InvitationDecisionRow[]
    const row = rows[0]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    return { invitationId: row.effective_invitation_id, result }
  })
}

export async function activateMembership(input: {
  tenantId: string
  userId: string
  memberId?: string
  roleId: string | null
  tierLevel?: number
  actor: SeatActor
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const proposedMemberId = input.memberId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`select * from activate_deployment_membership(
      ${input.tenantId}, ${input.userId}, ${proposedMemberId}, ${input.roleId},
      ${input.tierLevel ?? 0}, null, ${input.actor.userId}, ${input.actor.memberId},
      false, ${now.toISOString()}::timestamp with time zone
    )`) as unknown as MembershipDecisionRow[]
    const row = rows[0]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    return { memberId: row.effective_member_id, result }
  })
}

export async function consumeInvitation(input: {
  tenantId: string
  invitationId: string
  userId: string
  memberId?: string
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const proposedMemberId = input.memberId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`select * from consume_deployment_invitation(
      ${input.tenantId}, ${input.invitationId}::uuid, ${input.userId}, ${proposedMemberId},
      ${now.toISOString()}::timestamp with time zone
    )`) as unknown as MembershipDecisionRow[]
    const row = rows[0]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    return { memberId: row.effective_member_id, result }
  })
}

export async function autoJoinMembership(input: {
  tenantId: string
  userId: string
  memberId?: string
  roleId: string
  tierLevel?: number
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const proposedMemberId = input.memberId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`select * from auto_join_deployment_membership(
      ${input.tenantId}, ${input.userId}, ${proposedMemberId}, ${input.roleId},
      ${input.tierLevel ?? 0}, ${now.toISOString()}::timestamp with time zone
    )`) as unknown as MembershipDecisionRow[]
    const row = rows[0]
    const result = decisionResult(row)
    assertAllowed(result)
    return { memberId: row.effective_member_id, result }
  })
}

export async function bootstrapOwner(input: {
  tenantId: string
  userId: string
  memberId?: string
  roleId: string
  tierLevel?: number
  mode: "empty" | "configured"
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const proposedMemberId = input.memberId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`select * from bootstrap_deployment_owner(
      ${input.tenantId}, ${input.userId}, ${proposedMemberId}, ${input.roleId},
      ${input.tierLevel ?? 100}, ${input.mode}, ${now.toISOString()}::timestamp with time zone
    )`) as unknown as MembershipDecisionRow[]
    const row = rows[0]
    const result = decisionResult(row)
    assertAllowed(result)
    return { memberId: row.effective_member_id, result }
  })
}

export async function disableOrRemoveMembership(input: {
  tenantId: string
  memberId: string
  remove: boolean
  actor: SeatActor
  now?: Date
}): Promise<DeploymentSeatResult> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select * from change_deployment_membership(
      ${input.tenantId}, ${input.memberId}, ${input.remove}, ${input.actor.userId},
      ${input.actor.memberId}, ${now.toISOString()}::timestamp with time zone
    )`) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    return result
  })
}

export async function releaseInvitation(input: {
  tenantId: string
  invitationId: string
  actor: SeatActor
  now?: Date
}): Promise<DeploymentSeatResult> {
  await assertMembershipWriteAllowed()
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select * from revoke_deployment_invitation(
      ${input.tenantId}, ${input.invitationId}::uuid, ${input.actor.userId},
      ${input.actor.memberId}, ${now.toISOString()}::timestamp with time zone
    )`) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    return result
  })
}

export async function reconcileExpiredReservations(now = new Date()): Promise<{
  expiredCount: number
  occupiedUsers: number
  reservedInvitations: number
}> {
  await assertMembershipWriteAllowed()
  const rows = await db.execute(sql`
    select * from reconcile_expired_deployment_seat_reservations(
      ${now.toISOString()}::timestamp with time zone
    )
  `) as unknown as Array<{
    expired_count: number | string
    occupied_user_count: number | string
    reserved_invitation_count: number | string
  }>
  const row = rows[0]
  if (!row) throw new Error("Deployment seat reconciliation returned no result")
  return {
    expiredCount: Number(row.expired_count),
    occupiedUsers: Number(row.occupied_user_count),
    reservedInvitations: Number(row.reserved_invitation_count),
  }
}

export const reconcile = reconcileExpiredReservations
