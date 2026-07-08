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
import { MAPPINGS, type Ctx, type ObjectMap } from "./mapping"

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

const STAGE_NORMALIZE: Record<string, string> = {
  "0e": "0e", identified: "0e", "1d": "1d", qualified: "1d", "2c": "2c", proposal: "2c",
  "3b": "3b", negotiation: "3b", "4a": "4a", commit: "4a", "closed won": "won", won: "won",
  "closed lost": "lost", lost: "lost", kiv: "kiv",
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
        const code = STAGE_NORMALIZE[sfStage.trim().toLowerCase()] ?? sfStage.trim().toLowerCase()
        const id = stageByCode.get(code)
        return id && pipeline ? { pipelineId: pipeline.id, stageId: id } : null
      },
      warn: (m) => warnings.push(m),
    }

    console.log(`\n=== crm-v2 import  (${COMMIT ? "COMMIT" : "DRY-RUN"})  tenant=${TENANT}  dir=${DIR} ===`)
    if (!defaultOwner) console.log("⚠ no default owner resolved — owner_member_id rows will be null unless owner-map.json covers them")

    let totalRead = 0
    let totalWritten = 0
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
      const written = await ingest(sql, map, rows, ctx, COMMIT)
      totalWritten += written
      console.log(`    ${COMMIT ? "inserted" : "would insert"}: ${written}`)
    }

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

async function ingest(
  sql: postgres.Sql,
  map: ObjectMap,
  rows: Record<string, string>[],
  ctx: Ctx,
  commit: boolean
): Promise<number> {
  let n = 0
  for (const r of rows) {
    const sfId = r[map.sfId]
    if (!sfId) { ctx.warn(`${map.object}: row missing ${map.sfId}`); continue }
    const record: Record<string, unknown> = {
      id: ctx.detId(map.object, sfId),
      tenant_id: TENANT,
    }
    for (const [sfCol, fm] of Object.entries(map.fields)) {
      if (!(sfCol in r)) continue
      record[fm.col] = fm.xform ? fm.xform(r[sfCol], ctx) : (r[sfCol] || null)
    }
    if (map.defaults) Object.assign(record, map.defaults(r, ctx))

    if (commit) {
      const res = await sql`
        insert into ${sql(map.table)} ${sql(record)}
        on conflict (id) do nothing`
      n += res.count
    } else {
      n += 1
    }
  }
  return n
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
