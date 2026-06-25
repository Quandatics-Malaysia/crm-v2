import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { genericOAuth, microsoftEntraId } from "better-auth/plugins/generic-oauth"
import { nextCookies } from "better-auth/next-js"
import { db } from "@/db"
import * as schema from "@/db/schema"
import { env, microsoftConfigured, isProd } from "@/lib/env"

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
    },
  },
  // Email/password is off by default per tenant; we gate at the action layer
  // via tenant_settings.allow_password_login. Public sign-up is disabled —
  // password users are admin-provisioned (break-glass).
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
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
    organization(),
    ...(microsoftConfigured
      ? [
          genericOAuth({
            config: [
              microsoftEntraId({
                clientId: env.MICROSOFT_CLIENT_ID,
                clientSecret: env.MICROSOFT_CLIENT_SECRET,
                tenantId: env.MICROSOFT_TENANT_ID || "common",
                // Use the non-"oauth2" callback path required by the Entra app
                // registration. A Next rewrite maps it to the plugin's handler.
                redirectURI: `${env.BETTER_AUTH_URL}/api/auth/callback/microsoft-entra-id`,
              }),
            ],
          }),
        ]
      : []),
    nextCookies(),
  ],
})

export type Session = typeof auth.$Infer.Session
