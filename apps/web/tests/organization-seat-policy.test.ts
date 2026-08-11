import { describe, expect, it } from "vitest"

import {
  allowLicensedOrganizationCreation,
  licensedOrganizationHooks,
} from "@/lib/organization-seat-policy"

describe("Better Auth organization seat bypass policy", () => {
  it("blocks the Better Auth organization-creation route for every identity", async () => {
    await expect(allowLicensedOrganizationCreation({ isSuperadmin: true })).resolves.toBe(false)
    await expect(allowLicensedOrganizationCreation({ isSuperadmin: false })).resolves.toBe(false)
    await expect(allowLicensedOrganizationCreation({})).resolves.toBe(false)
  })

  it.each([
    "beforeCreateInvitation",
    "beforeAcceptInvitation",
    "beforeRejectInvitation",
    "beforeCancelInvitation",
    "beforeRemoveMember",
    "beforeUpdateMemberRole",
  ] as const)("blocks the public %s bypass", async (hook) => {
    await expect(licensedOrganizationHooks[hook]({} as never)).rejects.toThrow(/licensed|CRM role/)
  })

  it("blocks every direct Better Auth member add, including a superadmin target", async () => {
    await expect(licensedOrganizationHooks.beforeAddMember({ user: { isSuperadmin: false } } as never)).rejects.toThrow(/licensed/)
    await expect(licensedOrganizationHooks.beforeAddMember({ user: { isSuperadmin: true } } as never)).rejects.toThrow(/licensed/)
  })
})
