import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  assertWriteAllowed: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/write-access", () => ({
  assertWriteAllowed: mocks.assertWriteAllowed,
}))

vi.mock("@/db", () => ({
  db: {
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}))

vi.mock("@/server/audit", () => ({ writeAuthAudit: vi.fn() }))

import {
  activateMembership,
  autoJoinMembership,
  bootstrapOwner,
  consumeInvitation,
  disableOrRemoveMembership,
  getDeploymentSeatUsage,
  normalizeSeatEmail,
  provisionEntitySeats,
  reconcileExpiredReservations,
  releaseInvitation,
  reserveInvitation,
} from "@/lib/deployment-seats"

describe("deployment seat email identity", () => {
  it.each([
    [" Person@Example.COM ", "person@example.com"],
    ["USER+tag@Example.com", "user+tag@example.com"],
    ["mixed.Case@Sub.Example.com", "mixed.case@sub.example.com"],
  ])("normalizes %j with exact trim-and-lower semantics", (input, expected) => {
    expect(normalizeSeatEmail(input)).toBe(expected)
  })

  it.each([
    "",
    "   ",
    "user\n@example.com",
    "user\u0000@example.com",
    "user @example.com",
    "user@example.com ",
  ])("rejects blank, control, or embedded-whitespace identity %j", (input) => {
    expect(() => normalizeSeatEmail(input)).toThrow("Invalid seat email")
  })
})

describe("commercial seat mutation boundaries", () => {
  const actor = { userId: "user-1", memberId: "member-1" }
  const readOnlyError = Object.assign(new Error("read-only"), {
    code: "LICENSE_READ_ONLY",
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertWriteAllowed.mockRejectedValue(readOnlyError)
  })

  it.each([
    ["entity bootstrap", () => provisionEntitySeats({
      tenantId: "tenant-1",
      actor: { userId: "user-1" },
      entries: [],
      entityAudit: { name: "Tenant", slug: "tenant", invites: [] },
    })],
    ["invite reservation", () => reserveInvitation({
      tenantId: "tenant-1", email: "new@example.com", roleId: "role-1", actor,
    })],
    ["membership activation", () => activateMembership({
      tenantId: "tenant-1", userId: "user-2", roleId: "role-1", actor,
    })],
    ["invitation consumption", () => consumeInvitation({
      tenantId: "tenant-1", invitationId: crypto.randomUUID(), userId: "user-2",
    })],
    ["domain auto-join", () => autoJoinMembership({
      tenantId: "tenant-1", userId: "user-2", roleId: "role-1",
    })],
    ["owner bootstrap", () => bootstrapOwner({
      tenantId: "tenant-1", userId: "user-2", roleId: "role-1", mode: "empty",
    })],
    ["membership removal", () => disableOrRemoveMembership({
      tenantId: "tenant-1", memberId: "member-2", remove: true, actor,
    })],
    ["invitation revocation", () => releaseInvitation({
      tenantId: "tenant-1", invitationId: crypto.randomUUID(), actor,
    })],
    ["reservation reconciliation", () => reconcileExpiredReservations()],
  ] as Array<[string, () => Promise<unknown>]>) (
    "blocks %s before database work",
    async (_label, work) => {
      await expect(work()).rejects.toBe(readOnlyError)
      expect(mocks.assertWriteAllowed).toHaveBeenCalledWith({
        operation: "membership_mutation",
      })
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it("does not put deployment seat reads behind write access", async () => {
    const execute = vi.fn(async () => [{
      occupied_user_count: 2,
      reserved_invitation_count: 1,
      seat_limit: 10,
      access_mode: "read_only",
      write_allowed: false,
      overage: false,
    }])
    mocks.transaction.mockImplementation(async (work) => work({ execute }))

    await expect(getDeploymentSeatUsage()).resolves.toMatchObject({
      occupiedUsers: 2,
      reservedInvitations: 1,
      accessMode: "read_only",
    })
    expect(mocks.assertWriteAllowed).not.toHaveBeenCalled()
  })
})
