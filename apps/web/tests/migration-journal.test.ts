import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveAccountCurrencyBackfill } from "@/server/services/tenant-currency"

describe("migration journal", () => {
  it("includes the latest quotation revision migration", async () => {
    const journal = JSON.parse(
      await readFile(path.resolve(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> }

    expect(journal.entries.at(-1)).toMatchObject({
      idx: 82,
      tag: "0082_quotation_revisions",
    })
  })

  it("adds tenant-safe revision lineage and a unique funnel version guard", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0082_quotation_revisions.sql"),
      "utf8"
    )

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"revision_of_id"\s+uuid/i)
    expect(migration).toMatch(/REFERENCES\s+"quotations"\s*\("id"\)\s+ON DELETE SET NULL/i)
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS\s+"quotations_revision_of_idx"/i)
    expect(migration).toMatch(/ROW_NUMBER\(\) OVER\s*\(\s*PARTITION BY[\s\S]{0,80}"funnel_id"/i)
    expect(migration).toMatch(/ORDER BY[\s\S]{0,40}"created_at"[\s\S]{0,40}"id"/i)
    expect(migration).toMatch(/UPDATE\s+"quotations"/i)
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+"quotations_funnel_version_uq"/i)
  })

  it("adds approval statuses and nullable approval metadata safely", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0081_quotation_approval.sql"),
      "utf8"
    )

    expect(migration).toMatch(/ADD VALUE IF NOT EXISTS\s+'pending_approval'/i)
    expect(migration).toMatch(/ADD VALUE IF NOT EXISTS\s+'approved'/i)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"approver_member_id"\s+text/i)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"approved_at"\s+timestamp with time zone/i)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"rejection_reason"\s+text/i)
    expect(migration).toMatch(/quotation\.approve/i)
    expect(migration).toMatch(/INSERT INTO\s+"role_permissions"/i)
    expect(migration).not.toMatch(/UPDATE\s+"quotations"/i)
  })

  it("adds nullable quotation content fields without fabricating historical values", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0080_quotation_content_fields.sql"),
      "utf8"
    )

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"attention_contact_id"\s+uuid/i)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"delivery"\s+text/i)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS\s+"payment_term"\s+text/i)
    expect(migration).not.toMatch(/UPDATE\s+"quotations"\s+SET\s+"(delivery|payment_term|attention_contact_id)"\s*=/i)
  })

  it("uses configured default, first configured, then MYR for account backfill", () => {
    expect(resolveAccountCurrencyBackfill("USD", ["MYR", "USD"])).toBe("USD")
    expect(resolveAccountCurrencyBackfill("EUR", ["SGD", "USD"])).toBe("SGD")
    expect(resolveAccountCurrencyBackfill("EUR", [])).toBe("MYR")
    expect(resolveAccountCurrencyBackfill("EUR", { malformed: true } as never)).toBe("MYR")
  })

  it("repairs the drifted contact department column idempotently", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0074_repair_person_department.sql"),
      "utf8"
    )

    expect(migration).toMatch(
      /ALTER TABLE\s+"persons"\s+ADD COLUMN IF NOT EXISTS\s+"department" text/
    )
  })

  it("backfills names without renumbering or rewriting project codes", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0078_opportunity_name_project_code.sql"),
      "utf8"
    )

    expect(migration).toMatch(/SET\s+"name"\s*=\s*"code"/)
    expect(migration).not.toMatch(/opportunity_number\s*=/i)
    expect(migration).not.toMatch(/project_code\s*=/i)
  })
})
