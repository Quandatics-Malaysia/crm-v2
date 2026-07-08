/**
 * Bulk importer: Salesforce object CSVs → crm-v2 (QM tenant).
 *
 *   npm run db:import -- --tenant=<orgId> [--dir=./import-data] [--owner=<memberId>] [--commit]
 *
 * DRY-RUN by default: parses every <Object>.csv, applies the mapping, and prints
 * a coverage report (mapped vs UNMAPPED headers = the parity gap) + would-insert
 * counts — WITHOUT writing. Add --commit to actually insert. Inserts are
 * idempotent (deterministic UUIDs + ON CONFLICT DO NOTHING), so re-running is safe.
 *
 * Owner mapping: put an `owner-map.json` ({ "<sfUserId>": "<memberId>" }) in the
 * import dir; unmapped owners fall back to --owner (or the tenant's first admin).
 */
import "dotenv/config"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { parseCsv } from "./csv"
import { MAPPINGS, stageCode, type Ctx, type ObjectMap } from "./mapping"

const args = process.argv.slice(2)
const flag = (name: string, def = "") =>
  (args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]) ?? def
const DIR = flag("dir", "./import-data")
const TENANT = flag("tenant")
const OWNER_ARG = flag("owner")
const COMMIT = args.includes("--commit")

if (!TENANT) {
  console.error("Missing --tenant=<organization id>. Aborting.")
  process.exit(1)
}

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/crm"

async function tableColumns(sql: postgres.Sql, table: string): Promise<Set<string>> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}`
  return new Set(rows.map((r) => r.column_name))
}

function det(key: string): string {
  const h = createHash("sha1").update("crm-v2::import::" + key).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const x = b.toString("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

function findCsv(object: string): string | null {
  if (!existsSync(DIR)) return null
  const want = `${object.toLowerCase()}.csv`
  const hit = readdirSync(DIR).find((f) => f.toLowerCase() === want)
  return hit ? join(DIR, hit) : null
}

async function main() {
  const sql = postgres(ADMIN_URL, { max: 4 })
  try {
    // Preload the tenant's default pipeline + stages (funnel FK resolution).
    const [pipeline] = await sql<{ id: string }[]>`
      select id from pipelines where tenant_id = ${TENANT} and is_default = true limit 1`
    const stages = pipeline
      ? await sql<{ id: string; code: string }[]>`
          select id, code from pipeline_stages where pipeline_id = ${pipeline.id}`
      : []
    const stageByCode = new Map(stages.map((s) => [s.code, s.id]))

    // Default owner (tenant's first active member) + optional owner-map.json.
    const [defOwner] = await sql<{ member_id: string }[]>`
      select mp.member_id from membership_profiles mp
      join member m on m.id = mp.member_id
      where m.organization_id = ${TENANT} and mp.status = 'active'
      order by mp.created_at limit 1`
    const defaultOwner = OWNER_ARG || defOwner?.member_id || null
    let ownerMap: Record<string, string> = {}
    const omPath = join(DIR, "owner-map.json")
    if (existsSync(omPath)) ownerMap = JSON.parse(readFileSync(omPath, "utf8"))

    const warnings: string[] = []
    const ctx: Ctx = {
      detId: (object, sfId) => det(`${object}:${sfId}`),
      resolveOwner: (sfUserId) => ownerMap[sfUserId] ?? defaultOwner,
      resolveStage: (sfStage) => {
        const code = stageCode(sfStage)
        const id = stageByCode.get(code)
        return id && pipeline ? { pipelineId: pipeline.id, stageId: id, code } : null
      },
      warn: (m) => warnings.push(m),
    }

    console.log(`\n=== crm-v2 import  (${COMMIT ? "COMMIT" : "DRY-RUN"})  tenant=${TENANT}  dir=${DIR} ===`)
    if (!defaultOwner) console.log("⚠ no default owner resolved — owner_member_id rows will be null unless owner-map.json covers them")

    let totalRead = 0
    let totalWritten = 0
    const deferredUpdates: Deferred[] = []
    for (const map of MAPPINGS) {
      const path = findCsv(map.object)
      if (!path) {
        console.log(`\n• ${map.object.padEnd(16)} — no ${map.object}.csv (skipped)`)
        continue
      }
      const { headers, rows } = parseCsv(readFileSync(path, "utf8"))
      const mappedHeaders = new Set([map.sfId, ...Object.keys(map.fields), ...(map.consumes ?? [])])
      const unmapped = headers.filter((h) => !mappedHeaders.has(h))

      // Validate that every target column actually exists on the live table —
      // catches a typo in mapping.ts WITHOUT writing anything.
      const cols = await tableColumns(sql, map.table)
      const targetCols = new Set(["id", "tenant_id", ...Object.values(map.fields).map((f) => f.col)])
      const badCols = [...targetCols].filter((c) => !cols.has(c))

      console.log(`\n• ${map.object.padEnd(16)} → ${map.table}`)
      console.log(`    rows: ${rows.length}   headers: ${headers.length}   mapped: ${headers.length - unmapped.length}`)
      if (unmapped.length) console.log(`    UNMAPPED (no crm-v2 column): ${unmapped.join(", ")}`)
      if (badCols.length) console.log(`    ✗ mapping.ts targets non-existent columns: ${badCols.join(", ")}`)

      totalRead += rows.length
      const { written, failed } = await ingest(sql, map, rows, ctx, COMMIT, deferredUpdates)
      totalWritten += written
      console.log(`    ${COMMIT ? "inserted" : "would insert"}: ${written}${failed ? `   failed: ${failed}` : ""}`)
    }

    // GLOBAL second pass — backfill self-refs + forward/cyclic links now that
    // every object is in. A missing target just leaves the link null.
    if (COMMIT && deferredUpdates.length) {
      let linked = 0
      for (const d of deferredUpdates) {
        try {
          const res = await sql`update ${sql(d.table)} set ${sql(d.vals)} where id = ${d.id}`
          linked += res.count
        } catch {
          /* target row absent — leave null */
        }
      }
      console.log(`\n• linked ${linked}/${deferredUpdates.length} deferred references (parents, primary quote/contact, lead conversions)`)
    }

    await reconcileCounters(sql, COMMIT)

    if (warnings.length) {
      const uniq = [...new Set(warnings)]
      console.log(`\n⚠ ${warnings.length} warning(s) (${uniq.length} distinct):`)
      uniq.slice(0, 25).forEach((w) => console.log(`    - ${w}`))
      if (uniq.length > 25) console.log(`    …and ${uniq.length - 25} more`)
    }
    console.log(`\n=== ${COMMIT ? "IMPORTED" : "DRY-RUN"}: ${totalRead} read, ${totalWritten} ${COMMIT ? "inserted" : "would insert"} ===`)
    if (!COMMIT) console.log("Re-run with --commit to write. Reconcile UNMAPPED columns against mapping.ts first.\n")
  } finally {
    await sql.end()
  }
}

/**
 * "Smart" running-number detection: scan the source data for the highest number
 * already issued and advance crm-v2's counters past it, so NEW records continue
 * the sequence instead of colliding. Imported historical numbers are untouched.
 * (Opportunity numbering is max-based in the app, so it self-continues — no
 * counter to set here.)
 */
async function reconcileCounters(sql: postgres.Sql, commit: boolean): Promise<void> {
  const maxInSource = (
    object: string,
    col: string,
    minDigits: number,
    maxDigits = 99
  ): number => {
    const path = findCsv(object)
    if (!path) return 0
    const { rows } = parseCsv(readFileSync(path, "utf8"))
    let max = 0
    for (const r of rows) {
      for (const tok of (r[col] ?? "").match(/\d+/g) ?? []) {
        if (tok.length >= minDigits && tok.length <= maxDigits) {
          max = Math.max(max, Number(tok))
        }
      }
    }
    return max
  }
  const quoteNext = maxInSource("Quote", "Quote_Running_Number__c", 1) + 1
  // SO numbers are YYNNNN-shaped, and the field is a messy multi-value list —
  // constrain to 5-6 digit tokens so a concatenation artifact can't inflate it.
  const soNext = maxInSource("Opportunity", "SO_Number__c", 5, 6) + 1

  console.log(`\n=== running-number reconciliation ===`)
  console.log(`    highest Quote running number → next quote number = ${quoteNext}`)
  console.log(`    highest SO number            → next SO number     = ${soNext}`)
  console.log(`    opportunity numbers are max-based in-app → auto-continue (no counter)`)

  if (commit) {
    // GREATEST() so we only ever advance the counter, never lower an issued one.
    await sql`
      update tenant_settings set
        quote_next_number = greatest(quote_next_number, ${quoteNext}),
        so_next_number    = greatest(so_next_number, ${soNext})
      where organization_id = ${TENANT}`
    console.log(`    ✓ counters advanced in tenant_settings`)
  } else {
    console.log(`    (dry-run — counters not changed)`)
  }
}

type Deferred = { table: string; id: string; vals: Record<string, unknown> }

async function ingest(
  sql: postgres.Sql,
  map: ObjectMap,
  rows: Record<string, string>[],
  ctx: Ctx,
  commit: boolean,
  deferredUpdates: Deferred[]
): Promise<{ written: number; failed: number }> {
  const defer = new Set(map.deferCols ?? [])
  let written = 0
  let failed = 0

  for (const r of rows) {
    const sfId = r[map.sfId]
    if (!sfId) { ctx.warn(`${map.object}: row missing ${map.sfId}`); continue }
    const full: Record<string, unknown> = { id: ctx.detId(map.object, sfId), tenant_id: TENANT }
    for (const [sfCol, fm] of Object.entries(map.fields)) {
      if (!(sfCol in r)) continue
      full[fm.col] = fm.xform ? fm.xform(r[sfCol], ctx) : (r[sfCol] || null)
    }
    if (map.defaults) Object.assign(full, map.defaults(r, ctx))

    // Hold back deferred columns (self-refs + forward/cyclic FKs) for a GLOBAL
    // second pass after every object is in — so the base row always inserts.
    const record: Record<string, unknown> = {}
    const dv: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(full)) {
      if (defer.has(k)) { if (v != null) dv[k] = v } else record[k] = v
    }
    if (Object.keys(dv).length) {
      deferredUpdates.push({ table: map.table, id: full.id as string, vals: dv })
    }

    if (!commit) { written++; continue }
    try {
      const res = await sql`insert into ${sql(map.table)} ${sql(record)} on conflict (id) do nothing`
      written += res.count
    } catch (e) {
      failed++
      ctx.warn(`${map.object} insert failed: ${(e as Error).message.slice(0, 100)}`)
    }
  }
  return { written, failed }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
