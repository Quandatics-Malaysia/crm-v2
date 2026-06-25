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

  // Microsoft Entra (single-tenant app registration)
  MICROSOFT_CLIENT_ID: read("MICROSOFT_CLIENT_ID"),
  MICROSOFT_CLIENT_SECRET: read("MICROSOFT_CLIENT_SECRET"),
  MICROSOFT_TENANT_ID: read("MICROSOFT_TENANT_ID", "common"),

  // File storage
  STORAGE_DRIVER: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? "./var/uploads",

  NODE_ENV: process.env.NODE_ENV ?? "development",
}

export const isProd = env.NODE_ENV === "production"
export const microsoftConfigured = Boolean(
  env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
)
