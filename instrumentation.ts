/**
 * Next.js startup instrumentation. `register()` runs once per server instance
 * and must complete before the server handles requests. We use it ONLY for
 * fail-fast production safety checks. It is a deliberate no-op in development,
 * so local dev keeps working with the convenient defaults in `lib/env.ts`.
 *
 * Checks (production only):
 *   1. BETTER_AUTH_SECRET must not be the public dev default (forgeable sessions).
 *   2. The app DB role must NOT be a superuser / BYPASSRLS role — otherwise
 *      Postgres FORCE ROW LEVEL SECURITY is silently bypassed and tenant
 *      isolation is gone. We connect with DATABASE_URL and inspect pg_roles.
 *   3. If Microsoft Entra is configured, MICROSOFT_TENANT_ID must be a real
 *      directory GUID (not unset and not "common"), so we don't accept any
 *      Azure AD / personal account.
 */
export async function register() {
  // Only the Node.js runtime can open a TCP Postgres connection (skip Edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Module registry invariants — cheap, pure, and a bug in ANY environment, so
  // this runs before the production-only early return below.
  const { validateModuleConfig } = await import("@/lib/modules")
  const moduleErrors = validateModuleConfig()
  if (moduleErrors.length) {
    throw new Error(
      "Invalid module configuration (modules.config.ts):\n" +
        moduleErrors.map((e) => `  - ${e}`).join("\n")
    )
  }

  // Production-only: never throw in development.
  if (process.env.NODE_ENV !== "production") return

  const errors: string[] = []

  // 1. signing secret must not be the public dev default
  if ((process.env.BETTER_AUTH_SECRET ?? "") === "dev-secret-change-me-please") {
    errors.push(
      "BETTER_AUTH_SECRET is still the public dev default; set a real secret (e.g. `openssl rand -base64 32`)."
    )
  }

  // 3. if Microsoft Entra is configured, lock it to a single directory
  const microsoftConfigured = Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
  )
  if (microsoftConfigured) {
    const tenantId = process.env.MICROSOFT_TENANT_ID
    if (!tenantId || tenantId === "common") {
      errors.push(
        'MICROSOFT_TENANT_ID must be your directory (tenant) GUID — not unset and not "common" — when Microsoft sign-in is configured.'
      )
    }
  }

  // 2. the app DB role must not bypass RLS
  const url = process.env.DATABASE_URL
  if (!url) {
    errors.push("DATABASE_URL is not set.")
  } else {
    const { default: postgres } = await import("postgres")
    const sql = postgres(url, { max: 1 })
    try {
      const rows = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `
      const role = rows[0]
      if (role?.rolsuper || role?.rolbypassrls) {
        errors.push(
          "The application DATABASE_URL role is a SUPERUSER or has BYPASSRLS — " +
            "row-level security would be a silent no-op. Connect as the non-privileged crm_app role."
        )
      }
    } finally {
      await sql.end()
    }
  }

  if (errors.length) {
    throw new Error(
      "Refusing to start in production due to insecure configuration:\n" +
        errors.map((e) => `  - ${e}`).join("\n")
    )
  }
}
