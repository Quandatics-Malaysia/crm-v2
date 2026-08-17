import "server-only"
import { eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { funnels, projectCounters, quotations, tenantSettings } from "@/db/schema"
import { toDateString } from "@/lib/dates"
import { formatQuoteRef, QUOTE_PAD_WIDTH } from "@/lib/quote-number"
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
 * Allocate the next quotation reference, matching the client's Salesforce
 * format (see lib/quote-number.ts for the exact rules):
 *
 *  - The RUNNING number is per-FUNNEL: every quote on `funnelId` shares one
 *    running number. The funnel's first quote assigns a new one (the
 *    tenant's atomic `quoteNextNumber` counter, i.e. global max + 1);
 *    subsequent quotes on the same funnel reuse the funnel's stored
 *    `funnels.quoteRunningNumber`.
 *  - The REVISION is per-quote-in-funnel: `quotations.version`
 *    (max(version) + 1 for the funnel, or 1 for its first quote).
 *  - The FORMAT (old `Q{yy}-...` vs. new `Q1...`) is fixed by the funnel's
 *    earliest quote's creation date — see formatQuoteRef.
 *
 * Call inside the same tx that inserts the quotation, after the funnel row
 * is known to exist. Returns both the formatted reference AND the revision
 * number the caller MUST write to the new row's `quotations.version` column
 * — the reference's `-{rev}` suffix and the stored version must always
 * agree, since the version column is what the NEXT call's `max(version)`
 * reads back.
 */
export async function nextQuoteNumber(
  tx: Tx,
  ctx: ServerContext,
  funnelId: string
): Promise<{ quoteNumber: string; version: number }> {
  const [f] = await tx
    .select({ quoteRunningNumber: funnels.quoteRunningNumber })
    .from(funnels)
    .where(eq(funnels.id, funnelId))
    .limit(1)
    .for("update")
  if (!f) throw new Error("Funnel not found")

  const [ts] = await tx
    .select({ pad: tenantSettings.quotePadWidth })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .limit(1)
  // No settings row — fail loudly rather than mint a bogus number that
  // collides for every such tenant.
  if (!ts) throw new Error("Quotation numbering is not configured for this tenant")

  let running = f.quoteRunningNumber
  if (running == null) {
    // First quote on this funnel — atomically claim the next running number
    // off the tenant's global counter and stamp it onto the funnel so every
    // later quote on this funnel reuses it.
    const [s] = await tx
      .update(tenantSettings)
      .set({ quoteNextNumber: sql`${tenantSettings.quoteNextNumber} + 1` })
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .returning({ next: tenantSettings.quoteNextNumber })
    if (!s) throw new Error("Quotation numbering is not configured for this tenant")
    running = s.next - 1
    await tx
      .update(funnels)
      .set({ quoteRunningNumber: running, updatedAt: new Date() })
      .where(eq(funnels.id, funnelId))
  }

  // Revision + format are both derived from the funnel's existing quotes.
  // Soft-deleted quotes are INCLUDED here deliberately: quoteNumber keeps a
  // hard (non-partial) unique constraint even after soft-delete, so a
  // deleted quote's version/date must still count to avoid re-minting a
  // reference that collides with it.
  const [agg] = await tx
    .select({
      maxVersion: sql<number>`coalesce(max(${quotations.version}), 0)`,
      minCreatedAt: sql<string | null>`min(${quotations.createdAt})`,
    })
    .from(quotations)
    .where(eq(quotations.funnelId, funnelId))

  const rev = (agg?.maxVersion ?? 0) + 1
  const earliestQuoteDate = agg?.minCreatedAt ?? null

  const quoteNumber = formatQuoteRef({
    running,
    rev,
    earliestQuoteDate,
    pad: ts.pad ?? QUOTE_PAD_WIDTH,
  })
  return { quoteNumber, version: rev }
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
 *   - YYYY        — the deal's CONTRACT/LICENSE start year when supplied
 *                   (`opts.year`, from opportunity.projectYear / project start
 *                   date); falls back to the current local calendar year.
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
  {
    accountCode,
    projectNatureCode,
    year: contractYear,
  }: { accountCode: string; projectNatureCode: string; year?: number | null }
): Promise<string> {
  // Contract/license start year when known, else the current calendar year.
  const year =
    contractYear && contractYear > 0
      ? Math.trunc(contractYear)
      : Number(toDateString().slice(0, 4))

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
