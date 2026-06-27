import "dotenv/config"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { and, eq, isNull, or } from "drizzle-orm"
import * as schema from "@/db/schema"

/**
 * Idempotent backfill for the new project-code scheme. Runs as the privileged
 * (superuser) connection like db/seed.ts, so RLS is bypassed and all tenants
 * are processed.
 *
 *   (a) ACCOUNT CODES — every account with a NULL/blank `code` gets an
 *       upper-case alphanumeric code derived from its name (~3-5 chars), made
 *       unique within its tenant by appending a number on collision. Accounts
 *       that already have a code are left untouched.
 *   (b) PRODUCT TYPES — every tenant_settings row whose `product_types` is empty
 *       is seeded with a sensible default picklist so projects can be coded.
 *
 * Re-runnable: only rows that are still missing data are written.
 *
 *   npm run db:backfill-codes
 */

const { accounts, tenantSettings } = schema

const DEFAULT_PRODUCT_TYPES = [
  { code: "CONSULT", name: "Consulting" },
  { code: "IMPL", name: "Implementation" },
  { code: "MSP", name: "Managed Services" },
  { code: "WEB", name: "Web" },
  { code: "INFRA", name: "Infrastructure" },
  { code: "SUPP", name: "Support" },
]

/**
 * Derive a short (3-5 char) upper-case alphanumeric base code from an account
 * name. Falls back to "ACC" when the name has no usable characters.
 */
function baseCodeFromName(name: string): string {
  const cleaned = (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return "ACC"
  // Single word → first 3-5 chars. Multiple words → first word padded with the
  // leading chars of following words until we reach ~5, keeping it readable.
  let base = words[0].slice(0, 5)
  for (let i = 1; i < words.length && base.length < 3; i++) {
    base += words[i].slice(0, 3 - base.length)
  }
  base = base.slice(0, 5)
  if (base.length < 3) base = (base + "ACC").slice(0, 3)
  return base
}

/** Make `base` unique within `used` (per-tenant) by appending 2, 3, … */
function uniqueCode(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

async function main() {
  const url =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/crm"
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql, { schema })

  // ── (a) account codes ─────────────────────────────────────────────────────
  const allAccounts = await db
    .select({
      id: accounts.id,
      tenantId: accounts.tenantId,
      name: accounts.name,
      code: accounts.code,
    })
    .from(accounts)

  // Seed per-tenant "used" sets with codes that already exist.
  const usedByTenant = new Map<string, Set<string>>()
  for (const a of allAccounts) {
    if (a.code && a.code.trim()) {
      const set = usedByTenant.get(a.tenantId) ?? new Set<string>()
      set.add(a.code.trim().toUpperCase())
      usedByTenant.set(a.tenantId, set)
    }
  }

  let codedCount = 0
  for (const a of allAccounts) {
    if (a.code && a.code.trim()) continue
    const used = usedByTenant.get(a.tenantId) ?? new Set<string>()
    usedByTenant.set(a.tenantId, used)
    const code = uniqueCode(baseCodeFromName(a.name), used)
    await db
      .update(accounts)
      .set({ code })
      // Guard against a concurrent backfill having set it meanwhile.
      .where(
        and(
          eq(accounts.id, a.id),
          or(isNull(accounts.code), eq(accounts.code, ""))
        )
      )
    codedCount++
  }

  // ── (b) default product-type picklist for tenants that have none ───────────
  const settingsRows = await db
    .select({
      organizationId: tenantSettings.organizationId,
      productTypes: tenantSettings.productTypes,
    })
    .from(tenantSettings)

  let seededTenants = 0
  for (const s of settingsRows) {
    const current = s.productTypes ?? []
    if (current.length > 0) continue
    await db
      .update(tenantSettings)
      .set({ productTypes: DEFAULT_PRODUCT_TYPES })
      .where(eq(tenantSettings.organizationId, s.organizationId))
    seededTenants++
  }

  await sql.end()
  console.log("✓ backfill complete")
  console.log(`  account codes assigned: ${codedCount}`)
  console.log(`  tenants seeded with default product types: ${seededTenants}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
