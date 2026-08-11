import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { genericOAuth, microsoftEntraId } from "better-auth/plugins/generic-oauth"
import { nextCookies } from "better-auth/next-js"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { and, eq, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { db, runInTenant } from "@/db"
import * as schema from "@/db/schema"
import { writeAuthAudit } from "@/server/audit"
import { ROLE_TEMPLATES } from "@/lib/permissions"
import { env, microsoftConfigured, isProd } from "@/lib/env"
import {
  autoJoinMembership,
  consumeInvitation,
  normalizeSeatEmail,
} from "@/lib/deployment-seats"
import {
  allowLicensedOrganizationCreation,
  licensedOrganizationHooks,
} from "@/lib/organization-seat-policy"

/**
 * Consume pending invites for a user. An admin invites by exact email
 * (Team → Add member for someone who hasn't signed in yet); on the invitee's
 * first sign-in this creates the member + profile with the invited role/tier
 * and deletes the invite. Idempotent (member-exists check) and multi-tenant:
 * a person invited by several entities joins all of them. Returns the first
 * joined org id. Exact-email invites take precedence over domain auto-join.
 */
async function consumePendingInvites(user: {
  id: string
  email?: string | null
}): Promise<string | null> {
  const rawEmail = user.email ?? ""
  if (!rawEmail.trim()) return null
  const email = normalizeSeatEmail(rawEmail)
  const now = new Date()
  const organizations = await db.select({ id: schema.organization.id }).from(schema.organization)
  const invites: Array<{ id: string; tenantId: string }> = []
  for (const organization of organizations) {
    const rows = await runInTenant(organization.id, (tx) => tx
      .select({ id: schema.pendingInvites.id, tenantId: schema.pendingInvites.tenantId })
      .from(schema.pendingInvites)
      .where(and(
        eq(schema.pendingInvites.normalizedEmail, email),
        sql`${schema.pendingInvites.expiresAt} > ${now}`,
      )))
    invites.push(...rows)
  }
  if (invites.length === 0) return null

  let firstOrgId: string | null = null
  for (const invite of invites) {
    try {
      await consumeInvitation({
        tenantId: invite.tenantId,
        invitationId: invite.id,
        userId: user.id,
        memberId: randomUUID(),
      })
      firstOrgId ??= invite.tenantId
    } catch (e) {
      console.error("[auth] pending-invite consumption failed", e)
    }
  }
  return firstOrgId
}

/**
 * Domain auto-join. After a new user is created, if their email domain matches a
 * workspace's `autoJoinDomains`, add them to that workspace with its configured
 * default role (falls back to "Rep"). No-op when nothing matches (invite-only).
 * Returns the joined org id so the session can be pointed at it.
 */
async function autoJoinByDomain(user: {
  id: string
  email?: string | null
}): Promise<string | null> {
  const domain = (user.email ?? "").split("@")[1]?.toLowerCase() ?? ""
  if (!domain) return null
  const organizations = await db.select({ id: schema.organization.id }).from(schema.organization)
  let org: { orgId: string; roleName: string | null } | undefined
  for (const organization of organizations) {
    const match = await runInTenant(organization.id, async (tx) => {
      const [settings] = await tx.select({
        orgId: schema.tenantSettings.organizationId,
        roleName: schema.tenantSettings.autoJoinRole,
      }).from(schema.tenantSettings).where(and(
        eq(schema.tenantSettings.organizationId, organization.id),
        sql`${schema.tenantSettings.autoJoinDomains} @> ${JSON.stringify([domain])}::jsonb`,
      )).limit(1)
      return settings
    })
    if (match) { org = match; break }
  }
  if (!org) return null
  const roleName = org.roleName ?? "Rep"
  const tier = ROLE_TEMPLATES.find((r) => r.name === roleName)?.tier ?? 0
  const [existing] = await db.select({ id: schema.member.id }).from(schema.member).where(and(
    eq(schema.member.userId, user.id), eq(schema.member.organizationId, org.orgId),
  )).limit(1)
  if (existing) return org.orgId
  const roleRow = await runInTenant(org.orgId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(
        and(
          eq(schema.roles.tenantId, org.orgId),
          eq(schema.roles.name, roleName)
        )
      )
      .limit(1)
    return row
  })
  if (!roleRow) throw new Error("Auto-join role is not configured.")
  await autoJoinMembership({
    tenantId: org.orgId,
    userId: user.id,
    memberId: randomUUID(),
    roleId: roleRow.id,
    tierLevel: tier,
  })
  return org.orgId
}

/**
 * Per-tenant gate for email/password sign-in. A tenant can switch itself to
 * SSO-only via `tenant_settings.allow_password_login = false`; we enforce that
 * here so the toggle is real (it was previously dead config). A user with no
 * membership yet (first-login bootstrap / break-glass superadmin) is allowed
 * through — there is no tenant to consult. A multi-tenant user is allowed if
 * ANY of their orgs still permits password login.
 */
async function passwordLoginAllowed(email: string): Promise<boolean> {
  const [u] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = lower(${email})`)
    .limit(1)
  if (!u) return true // unknown user — let normal auth fail with its own error

  const memberships = await db
    .select({ orgId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, u.id))
  if (memberships.length === 0) return true // no tenant to consult

  for (const m of memberships) {
    const allowed = await runInTenant(m.orgId, async (tx) => {
      const [s] = await tx
        .select({ allow: schema.tenantSettings.allowPasswordLogin })
        .from(schema.tenantSettings)
        .where(eq(schema.tenantSettings.organizationId, m.orgId))
        .limit(1)
      return s?.allow ?? false
    })
    if (allowed) return true
  }
  return false
}

// A real directory (tenant) GUID is required when Microsoft sign-in is
// configured — we never silently fall back to the multi-tenant "common"
// endpoint, which would accept any Azure AD / personal account. The boot guard
// in instrumentation.ts rejects an unset/"common" tenant in production; here we
// simply refuse to register the provider without a real tenant id.
const microsoftTenantId =
  env.MICROSOFT_TENANT_ID && env.MICROSOFT_TENANT_ID !== "common"
    ? env.MICROSOFT_TENANT_ID
    : ""
const entraEnabled = microsoftConfigured && microsoftTenantId.length > 0

// Optional allow-list of email domains for OAuth sign-ups (comma-separated).
// When set, a new user whose email domain isn't listed is rejected at create.
const allowedOAuthDomains = (process.env.MICROSOFT_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),
  user: {
    additionalFields: {
      isSuperadmin: { type: "boolean", required: false, input: false },
      isVendorSupport: { type: "boolean", required: false, input: false },
    },
  },
  // Email/password is enabled at the framework level (so the seed can hash via
  // auth.$context.password.hash and break-glass admins exist), but actual
  // sign-in is gated per tenant by `tenant_settings.allow_password_login` in
  // the `hooks.before` middleware below. Public sign-up is disabled — password
  // users are admin-provisioned.
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  // Reject email/password sign-in for tenants that have opted into SSO-only.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return
      const body = ctx.body as { email?: unknown } | undefined
      const email = typeof body?.email === "string" ? body.email : ""
      if (!email) return
      if (!(await passwordLoginAllowed(email))) {
        throw new APIError("FORBIDDEN", {
          message:
            "Password sign-in is disabled for your organization. Use single sign-on instead.",
        })
      }
    }),
  },
  // Enforce the OAuth email-domain allow-list (if configured) at user creation.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (allowedOAuthDomains.length === 0) return
          const domain = (user.email ?? "").split("@")[1]?.toLowerCase() ?? ""
          if (!allowedOAuthDomains.includes(domain)) {
            throw new APIError("FORBIDDEN", {
              message: "Your email domain is not permitted to sign in.",
            })
          }
        },
        // First login: exact-email invites first, then domain auto-join.
        after: async (user) => {
          try {
            const invited = await consumePendingInvites(user)
            if (!invited) await autoJoinByDomain(user)
          } catch (e) {
            console.error("[auth] domain auto-join failed", e)
          }
        },
      },
    },
    session: {
      create: {
        // Land the user in their workspace: default the active org to their
        // (first) membership when the session doesn't already carry one.
        // Also consume invites here — a user who already EXISTED when the
        // invite was created never re-fires user.create, so each sign-in is
        // the catch-up point (no-op when none are pending).
        before: async (session) => {
          // Stamp last login on the user row (auth tables are RLS-exempt, so a
          // plain update needs no tenant context). Best-effort — never block a
          // valid sign-in on a bookkeeping write.
          try {
            await db
              .update(schema.user)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.user.id, session.userId))
          } catch (e) {
            console.error("[auth] lastLoginAt stamp failed", e)
          }
          try {
            const [u] = await db
              .select({ id: schema.user.id, email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1)
            if (u) await consumePendingInvites(u)
          } catch (e) {
            console.error("[auth] pending-invite catch-up failed", e)
          }
          // Resolve the active org (existing behavior), reusing it to audit the
          // sign-in. audit_log is FORCE-RLS: the login event is written scoped to
          // the user's org via runInTenant (null-tenant writes are blocked by
          // design). A user with no membership yet simply isn't audited here.
          let orgId: string | null =
            (session.activeOrganizationId as string | null | undefined) ?? null
          if (!orgId) {
            const [m] = await db
              .select({ orgId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)
            orgId = m?.orgId ?? null
          }
          if (orgId) {
            const tenantId = orgId
            const meta = session as {
              ipAddress?: string | null
              userAgent?: string | null
            }
            try {
              await runInTenant(tenantId, (tx) =>
                writeAuthAudit(tx, {
                  tenantId,
                  action: "auth.login",
                  actorUserId: session.userId,
                  ip: meta.ipAddress ?? null,
                  userAgent: meta.userAgent ?? null,
                })
              )
            } catch (e) {
              console.error("[auth] login audit failed", e)
            }
          }
          if (session.activeOrganizationId) return
          if (!orgId) return
          return { data: { ...session, activeOrganizationId: orgId } }
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    useSecureCookies: isProd,
  },
  // organization() = tenancy backbone. Microsoft Entra ID is wired via the
  // generic-oauth plugin (provider id "microsoft-entra-id"). nextCookies() MUST be last.
  plugins: [
    organization({
      allowUserToCreateOrganization: allowLicensedOrganizationCreation,
      disableOrganizationDeletion: true,
      organizationHooks: licensedOrganizationHooks,
    }),
    ...(entraEnabled
      ? [
          genericOAuth({
            config: [
              microsoftEntraId({
                clientId: env.MICROSOFT_CLIENT_ID,
                clientSecret: env.MICROSOFT_CLIENT_SECRET,
                tenantId: microsoftTenantId,
                // The generic-oauth plugin's callback handler lives at
                // /api/auth/oauth2/callback/<id>. Register this EXACT URI in the
                // Azure app registration — no Next rewrite is involved.
                redirectURI: `${env.BETTER_AUTH_URL}/api/auth/oauth2/callback/microsoft-entra-id`,
              }),
            ],
          }),
        ]
      : []),
    nextCookies(),
  ],
})

export type Session = typeof auth.$Infer.Session
