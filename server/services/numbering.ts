import "server-only"
import { eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { projectCounters, tenantSettings } from "@/db/schema"
import { toDateString } from "@/lib/dates"
import type { ServerContext } from "@/lib/server-context"

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505). A minted
 * document number (quote / SO / project code) can collide when the tenant's
 * "Next number" was set at or below an already-issued value. Callers should
 * catch this and surface a friendly retry message instead of the raw
 * "duplicate key value violates unique constraint …" error.
 */
export function isDuplicateNumberError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: unknown }).code === "23505"
  )
}

/**
 * Allocate the next quotation number using the tenant's configurable
 * prefix / sequence / padding, atomically incrementing the counter.
 * Call inside the same tx that inserts the quotation.
 */
export async function nextQuoteNumber(tx: Tx, ctx: ServerContext): Promise<string> {
  const [s] = await tx
    .update(tenantSettings)
    .set({ quoteNextNumber: sql`${tenantSettings.quoteNextNumber} + 1` })
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .returning({
      prefix: tenantSettings.quotePrefix,
      next: tenantSettings.quoteNextNumber,
      pad: tenantSettings.quotePadWidth,
    })
  const assigned = (s?.next ?? 1) - 1
  const prefix = s?.prefix ?? "Q-"
  const pad = s?.pad ?? 4
  return `${prefix}${String(assigned).padStart(pad, "0")}`
}

/**
 * Allocate the next SO number for the entity: {EntityCode}SO-{running}.
 * Each entity keeps its own counter.
 */
export async function nextSoNumber(tx: Tx, ctx: ServerContext): Promise<string> {
  const [s] = await tx
    .update(tenantSettings)
    .set({ soNextNumber: sql`${tenantSettings.soNextNumber} + 1` })
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .returning({
      entityCode: tenantSettings.entityCode,
      next: tenantSettings.soNextNumber,
      pad: tenantSettings.soPadWidth,
    })
  // A zero-row UPDATE means the tenant has no settings row — fail loudly rather
  // than mint a bogus ENTSO-0000 that collides for every such tenant.
  if (!s) throw new Error("Sales-order numbering is not configured for this tenant")
  const assigned = s.next - 1
  const entity = (s.entityCode || "ENT").toUpperCase()
  const running = String(assigned).padStart(s.pad ?? 4, "0")
  return `${entity}SO-${running}`
}

/**
 * Allocate the next project code in the format
 * `{YYYY}-{ENTITY}-{ACCOUNTCODE}-{PROJECTNATURE}-{NNN}` (e.g.
 * `2026-DEMO-ACME-WEB-001`):
 *   - YYYY        — the current LOCAL calendar year.
 *   - ENTITY      — tenant_settings.entityCode (fallback "ENT").
 *   - ACCOUNTCODE — the account's short code (fallback "ACC").
 *   - PROJECTNATURE — the project's chosen project-nature code (fallback "GEN").
 *   - NNN         — a running number that RESETS PER YEAR per tenant, taken from
 *                   `project_counters` and zero-padded to projectPadWidth (3).
 *
 * The running number is bumped atomically via an upsert on (tenant_id, year), so
 * concurrent project creations never reuse a number. Call inside the same tx
 * that inserts the project. All segments are upper-cased.
 */
export async function nextProjectCode(
  tx: Tx,
  ctx: ServerContext,
  { accountCode, projectNatureCode }: { accountCode: string; projectNatureCode: string }
): Promise<string> {
  const year = Number(toDateString().slice(0, 4))

  // Atomically take-and-increment the per-year counter. next_number holds the
  // value to assign NEXT; on first use we seed it to 2 and assign 1, on every
  // subsequent use we bump by 1 and assign the prior value (returned - 1).
  const [counter] = await tx
    .insert(projectCounters)
    .values({ tenantId: ctx.tenantId, year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [projectCounters.tenantId, projectCounters.year],
      set: { nextNumber: sql`${projectCounters.nextNumber} + 1` },
    })
    .returning({ next: projectCounters.nextNumber })
  const assigned = (counter?.next ?? 2) - 1

  const [s] = await tx
    .select({
      entityCode: tenantSettings.entityCode,
      pad: tenantSettings.projectPadWidth,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .limit(1)

  const yyyy = String(year)
  const entity = (s?.entityCode || "ENT").toUpperCase()
  const acct = (accountCode || "ACC").toUpperCase()
  const product = (projectNatureCode || "GEN").toUpperCase()
  const running = String(assigned).padStart(s?.pad ?? 3, "0")
  return `${yyyy}-${entity}-${acct}-${product}-${running}`
}
