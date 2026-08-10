import { APIError } from "better-auth/api"

type Candidate = { isSuperadmin?: boolean | null; [key: string]: unknown }

export async function allowLicensedOrganizationCreation(candidate: Candidate): Promise<boolean> {
  return candidate.isSuperadmin === true
}

function blocked(message: string) {
  return async (..._args: unknown[]): Promise<never> => {
    throw new APIError("FORBIDDEN", { message })
  }
}

export const licensedOrganizationHooks = {
  beforeCreateInvitation: blocked("Use the licensed team invitation action."),
  beforeAcceptInvitation: blocked("Use the licensed invitation-consumption path."),
  beforeRejectInvitation: blocked("Use the licensed invitation-revocation path."),
  beforeCancelInvitation: blocked("Use the licensed invitation-revocation path."),
  beforeAddMember: async ({ user }: { user: Candidate }): Promise<void> => {
    if (user.isSuperadmin !== true) {
      throw new APIError("FORBIDDEN", { message: "Use the licensed membership action." })
    }
  },
  beforeRemoveMember: blocked("Use the licensed membership action."),
  beforeUpdateMemberRole: blocked("Use the CRM role-assignment action."),
}
