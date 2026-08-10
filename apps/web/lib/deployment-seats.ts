import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { db, type Tx } from "@/db"
import {
  member,
  membershipProfiles,
  memberRoles,
  pendingInvites,
  user,
} from "@/db/schema"
import { writeAuthAudit } from "@/server/audit"

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

type SeatActor = { userId: string | null; memberId?: string | null }

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
  actor: SeatActor
  entries: Array<
    | { kind: "active"; userId: string; memberId?: string; roleId: string | null; tierLevel: number }
    | { kind: "invite"; email: string; roleId: string | null; tierLevel: number; expiresAt?: Date }
  >
  entityAudit: { name: string; slug: string; invites: Array<{ email: string; roleName: string }> }
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()
  await db.transaction(async (tx) => {
    await lockUsage(tx, now)
    await setTenant(tx, input.tenantId)
    for (const entry of input.entries) {
      if (entry.kind === "active") {
        const [existingMember] = await tx.select({ id: member.id }).from(member).where(and(
          eq(member.organizationId, input.tenantId), eq(member.userId, entry.userId),
        )).limit(1)
        const memberId = existingMember?.id ?? entry.memberId ?? crypto.randomUUID()
        const [targetUser] = await tx.select({ email: user.email, isSuperadmin: user.isSuperadmin })
          .from(user).where(eq(user.id, entry.userId)).limit(1)
        if (!targetUser) throw new Error("User not found.")
        if (targetUser.isSuperadmin && !existingMember) {
          throw new Error("The platform master cannot be granted new standing tenant membership.")
        }
        const normalizedEmail = normalizeSeatEmail(targetUser.email)
        const [invite] = await tx.select({ id: pendingInvites.id }).from(pendingInvites).where(and(
          eq(pendingInvites.tenantId, input.tenantId), eq(pendingInvites.normalizedEmail, normalizedEmail),
        )).limit(1)
        const rows = await tx.execute(sql`select * from activate_deployment_seat(
          ${memberId}, ${entry.userId}, ${invite?.id ?? null}, ${now.toISOString()}::timestamp with time zone
        )`) as unknown as DecisionRow[]
        assertAllowed(decisionResult(rows[0]))
        await writeActiveMembership(tx, {
          tenantId: input.tenantId, memberId, userId: entry.userId, roleId: entry.roleId,
          tierLevel: entry.tierLevel, now,
        })
        if (invite) await tx.delete(pendingInvites).where(eq(pendingInvites.id, invite.id))
        await writeAuthAudit(tx, {
          tenantId: input.tenantId, action: "member.added", actorUserId: input.actor.userId,
          actorMemberId: input.actor.memberId, entityType: "member", entityId: memberId,
          after: { roleId: entry.roleId },
        })
      } else {
        const normalizedEmail = normalizeSeatEmail(entry.email)
        const expiresAt = entry.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const invitationId = crypto.randomUUID()
        const rows = await tx.execute(sql`select * from reserve_deployment_seat(
          ${invitationId}, ${normalizedEmail}, ${expiresAt.toISOString()}::timestamp with time zone,
          ${now.toISOString()}::timestamp with time zone
        )`) as unknown as DecisionRow[]
        assertAllowed(decisionResult(rows[0]))
        await tx.insert(pendingInvites).values({
          id: invitationId, tenantId: input.tenantId, email: normalizedEmail, normalizedEmail,
          roleId: entry.roleId, tierLevel: entry.tierLevel, invitedByMemberId: input.actor.memberId ?? null,
          expiresAt,
        })
        await writeAuthAudit(tx, {
          tenantId: input.tenantId, action: "member.invited", actorUserId: input.actor.userId,
          actorMemberId: input.actor.memberId, entityType: "pending_invite", entityId: invitationId,
          after: { roleId: entry.roleId, expiresAt },
        })
      }
    }
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "entity.created",
      actorUserId: input.actor.userId,
      actorMemberId: input.actor.memberId,
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
  const normalizedEmail = normalizeSeatEmail(input.email)
  const now = input.now ?? new Date()
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw new Error("Invite expiry must be in the future.")

  return db.transaction(async (tx) => {
    await lockUsage(tx, now)
    await setTenant(tx, input.tenantId)
    const [existing] = await tx
      .select({ id: pendingInvites.id })
      .from(pendingInvites)
      .where(and(
        eq(pendingInvites.tenantId, input.tenantId),
        eq(pendingInvites.normalizedEmail, normalizedEmail),
      ))
      .limit(1)
    const invitationId = existing?.id ?? input.invitationId ?? crypto.randomUUID()
    const rows = await tx.execute(sql`
      select * from reserve_deployment_seat(
        ${invitationId}, ${normalizedEmail}, ${expiresAt.toISOString()}::timestamp with time zone,
        ${now.toISOString()}::timestamp with time zone
      )
    `) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)

    if (existing) {
      await tx.update(pendingInvites).set({
        email: normalizedEmail,
        normalizedEmail,
        roleId: input.roleId,
        tierLevel: input.tierLevel ?? 0,
        invitedByMemberId: input.invitedByMemberId ?? null,
        expiresAt,
        updatedAt: now,
      }).where(eq(pendingInvites.id, invitationId))
    } else {
      await tx.insert(pendingInvites).values({
        id: invitationId,
        tenantId: input.tenantId,
        email: normalizedEmail,
        normalizedEmail,
        roleId: input.roleId,
        tierLevel: input.tierLevel ?? 0,
        invitedByMemberId: input.invitedByMemberId ?? null,
        expiresAt,
      })
    }
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "member.invited",
      actorUserId: input.actor.userId,
      actorMemberId: input.actor.memberId,
      entityType: "pending_invite",
      entityId: invitationId,
      after: { roleId: input.roleId, expiresAt },
    })
    return { invitationId, result }
  })
}

async function writeActiveMembership(tx: Tx, input: {
  tenantId: string
  memberId: string
  userId: string
  roleId: string | null
  tierLevel: number
  now: Date
}): Promise<void> {
  const [existingMember] = await tx.select({ organizationId: member.organizationId, userId: member.userId })
    .from(member).where(eq(member.id, input.memberId)).limit(1)
  if (existingMember && (
    existingMember.organizationId !== input.tenantId || existingMember.userId !== input.userId
  )) {
    throw new Error("Membership identity collision.")
  }
  if (!existingMember) {
    await tx.insert(member).values({
      id: input.memberId,
      organizationId: input.tenantId,
      userId: input.userId,
      role: "member",
      createdAt: input.now,
    })
  }
  await tx.insert(membershipProfiles).values({
    memberId: input.memberId,
    tenantId: input.tenantId,
    roleId: input.roleId,
    tierLevel: input.tierLevel,
    status: "active",
  }).onConflictDoUpdate({
    target: membershipProfiles.memberId,
    set: { roleId: input.roleId, tierLevel: input.tierLevel, status: "active", updatedAt: input.now },
  })
  await tx.delete(memberRoles).where(eq(memberRoles.memberId, input.memberId))
  if (input.roleId) {
    await tx.insert(memberRoles).values({
      tenantId: input.tenantId,
      memberId: input.memberId,
      roleId: input.roleId,
    }).onConflictDoNothing()
  }
}

export async function activateMembership(input: {
  tenantId: string
  userId: string
  memberId?: string
  roleId: string | null
  tierLevel?: number
  actor: SeatActor
  guard?: (tx: Tx) => Promise<void>
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    await lockUsage(tx, now)
    const [existingMember] = await tx.select({ id: member.id }).from(member).where(and(
      eq(member.organizationId, input.tenantId), eq(member.userId, input.userId),
    )).limit(1)
    const memberId = existingMember?.id ?? input.memberId ?? crypto.randomUUID()
    await setTenant(tx, input.tenantId)
    await input.guard?.(tx)
    const [targetUser] = await tx.select({ email: user.email, isSuperadmin: user.isSuperadmin })
      .from(user).where(eq(user.id, input.userId)).limit(1)
    if (!targetUser) throw new Error("User not found.")
    if (targetUser.isSuperadmin && !existingMember) {
      throw new Error("The platform master cannot be granted new standing tenant membership.")
    }
    const normalizedEmail = normalizeSeatEmail(targetUser.email)
    const [invite] = await tx.select({ id: pendingInvites.id }).from(pendingInvites).where(and(
      eq(pendingInvites.tenantId, input.tenantId), eq(pendingInvites.normalizedEmail, normalizedEmail),
    )).limit(1)
    const rows = await tx.execute(sql`
      select * from activate_deployment_seat(
        ${memberId}, ${input.userId}, ${invite?.id ?? null}, ${now.toISOString()}::timestamp with time zone
      )
    `) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    await writeActiveMembership(tx, {
      tenantId: input.tenantId,
      memberId,
      userId: input.userId,
      roleId: input.roleId,
      tierLevel: input.tierLevel ?? 0,
      now,
    })
    if (invite) await tx.delete(pendingInvites).where(eq(pendingInvites.id, invite.id))
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "member.added",
      actorUserId: input.actor.userId,
      actorMemberId: input.actor.memberId,
      entityType: "member",
      entityId: memberId,
      after: { roleId: input.roleId },
    })
    return { memberId, result }
  })
}

export async function consumeInvitation(input: {
  tenantId: string
  invitationId: string
  userId: string
  memberId?: string
  actor?: SeatActor
  now?: Date
}): Promise<{ memberId: string; result: DeploymentSeatResult }> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    await lockUsage(tx, now)
    const [existingMember] = await tx.select({ id: member.id }).from(member).where(and(
      eq(member.organizationId, input.tenantId), eq(member.userId, input.userId),
    )).limit(1)
    const memberId = existingMember?.id ?? input.memberId ?? crypto.randomUUID()
    await setTenant(tx, input.tenantId)
    const [invite] = await tx.select().from(pendingInvites).where(and(
      eq(pendingInvites.id, input.invitationId),
      eq(pendingInvites.tenantId, input.tenantId),
      sql`${pendingInvites.expiresAt} > ${now}`,
    )).limit(1)
    if (!invite) {
      const [profile] = existingMember
        ? await tx.select({ status: membershipProfiles.status }).from(membershipProfiles)
            .where(eq(membershipProfiles.memberId, existingMember.id)).limit(1)
        : []
      if (profile?.status === "active") {
        const usage = await lockUsage(tx, now)
        return { memberId, result: { ...usage, allowed: true, reason: "idempotent" } }
      }
      throw new Error("Invite is expired, revoked, or unavailable.")
    }
    const [targetUser] = await tx.select({ email: user.email }).from(user).where(eq(user.id, input.userId)).limit(1)
    if (!targetUser || normalizeSeatEmail(targetUser.email) !== invite.normalizedEmail) {
      throw new Error("Invite does not belong to this user.")
    }
    const rows = await tx.execute(sql`
      select * from activate_deployment_seat(
        ${memberId}, ${input.userId}, ${input.invitationId}, ${now.toISOString()}::timestamp with time zone
      )
    `) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    await writeActiveMembership(tx, {
      tenantId: input.tenantId,
      memberId,
      userId: input.userId,
      roleId: invite.roleId,
      tierLevel: invite.tierLevel,
      now,
    })
    await tx.delete(pendingInvites).where(eq(pendingInvites.id, input.invitationId))
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "member.invite_consumed",
      actorUserId: input.actor?.userId ?? input.userId,
      actorMemberId: input.actor?.memberId,
      entityType: "member",
      entityId: memberId,
    })
    return { memberId, result }
  })
}

export async function disableOrRemoveMembership(input: {
  tenantId: string
  memberId: string
  remove: boolean
  actor: SeatActor
  guard?: (tx: Tx) => Promise<void>
  now?: Date
}): Promise<DeploymentSeatResult> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const usage = await lockUsage(tx, now)
    await setTenant(tx, input.tenantId)
    const [profile] = await tx.select({ status: membershipProfiles.status }).from(membershipProfiles)
      .where(and(eq(membershipProfiles.memberId, input.memberId), eq(membershipProfiles.tenantId, input.tenantId)))
      .limit(1)
    if (!profile || (!input.remove && profile.status === "disabled")) {
      return { ...usage, allowed: true, reason: "idempotent" }
    }
    const rows = await tx.execute(sql`
      select * from release_deployment_membership_seat(
        ${input.memberId}, ${now.toISOString()}::timestamp with time zone
      )
    `) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    await input.guard?.(tx)
    if (input.remove) {
      await tx.delete(membershipProfiles).where(eq(membershipProfiles.memberId, input.memberId))
      await tx.delete(member).where(and(eq(member.id, input.memberId), eq(member.organizationId, input.tenantId)))
    } else {
      await tx.update(membershipProfiles).set({ status: "disabled", updatedAt: now })
        .where(and(eq(membershipProfiles.memberId, input.memberId), eq(membershipProfiles.tenantId, input.tenantId)))
    }
    await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: input.remove ? "member.removed" : "member.status_changed",
      actorUserId: input.actor.userId,
      actorMemberId: input.actor.memberId,
      entityType: "member",
      entityId: input.memberId,
      after: input.remove ? undefined : { status: "disabled" },
    })
    return result
  })
}

export async function releaseInvitation(input: {
  tenantId: string
  invitationId: string
  actor: SeatActor
  now?: Date
}): Promise<DeploymentSeatResult> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const usage = await lockUsage(tx, now)
    await setTenant(tx, input.tenantId)
    const [invite] = await tx.select({ id: pendingInvites.id }).from(pendingInvites).where(and(
      eq(pendingInvites.id, input.invitationId), eq(pendingInvites.tenantId, input.tenantId),
    )).limit(1)
    if (!invite) return { ...usage, allowed: true, reason: "idempotent" }
    const rows = await tx.execute(sql`
      select * from release_deployment_invitation_seat(
        ${input.invitationId}, ${now.toISOString()}::timestamp with time zone
      )
    `) as unknown as DecisionRow[]
    const result = decisionResult(rows[0])
    assertAllowed(result)
    const deleted = await tx.delete(pendingInvites).where(and(
      eq(pendingInvites.id, input.invitationId), eq(pendingInvites.tenantId, input.tenantId),
    )).returning({ id: pendingInvites.id })
    if (deleted.length > 0) await writeAuthAudit(tx, {
      tenantId: input.tenantId,
      action: "member.invite_revoked",
      actorUserId: input.actor.userId,
      actorMemberId: input.actor.memberId,
      entityType: "pending_invite",
      entityId: input.invitationId,
    })
    return result
  })
}

export async function reconcileExpiredReservations(now = new Date()): Promise<{
  expiredCount: number
  occupiedUsers: number
  reservedInvitations: number
}> {
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
