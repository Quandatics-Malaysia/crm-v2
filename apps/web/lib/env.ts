/**
 * Centralized environment access. Never throws at import time (so `next build`
 * and drizzle-kit don't crash); missing secrets surface at runtime use.
 */
const DEV_DB = "postgres://postgres:postgres@localhost:5432/crm"

function read(name: string, fallback = ""): string {
  return process.env[name] ?? fallback
}

export const env = {
  /** App connection — in production this is the RLS-enforced `crm_app` role. */
  DATABASE_URL: read("DATABASE_URL", DEV_DB),
  /** Privileged connection for migrations + seed (superuser, bypasses RLS). */
  DATABASE_ADMIN_URL:
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? DEV_DB,

  BETTER_AUTH_SECRET: read("BETTER_AUTH_SECRET", "dev-secret-change-me-please"),
  BETTER_AUTH_URL: read("BETTER_AUTH_URL", "http://localhost:3000"),
  APP_URL: process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  // Platform operator (the single account allowed to administer tenants,
  // licensing and subscriptions across the installation). Keep this separate
  // from demo credentials; production provisioning must set both values.
  PLATFORM_MASTER_EMAIL: read("PLATFORM_MASTER_EMAIL"),

  // Versioned, public-only vendor Ed25519 trust set. Signing keys never enter web.
  VENDOR_ENTITLEMENT_TRUST_SET: read("VENDOR_ENTITLEMENT_TRUST_SET"),

  // Machine-only deployment agent boundary. Parsed strictly on route use.
  DEPLOYMENT_ID: read("DEPLOYMENT_ID"),
  AGENT_WEB_SECRET: read("AGENT_WEB_SECRET"),
  APPLICATION_VERSION: read("APPLICATION_VERSION"),
  MIGRATION_VERSION: read("MIGRATION_VERSION"),

  // Microsoft Entra (single-tenant app registration)
  MICROSOFT_CLIENT_ID: read("MICROSOFT_CLIENT_ID"),
  MICROSOFT_CLIENT_SECRET: read("MICROSOFT_CLIENT_SECRET"),
  MICROSOFT_TENANT_ID: read("MICROSOFT_TENANT_ID"),

  // File storage
  STORAGE_DRIVER: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? "./var/uploads",

  NODE_ENV: process.env.NODE_ENV ?? "development",
}

export const isProd = env.NODE_ENV === "production"
export const microsoftConfigured = Boolean(
  env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
)
