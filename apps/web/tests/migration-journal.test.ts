import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveAccountCurrencyBackfill } from "@/server/services/tenant-currency"

describe("migration journal", () => {
  it("includes the latest account currency migration", async () => {
    const journal = JSON.parse(
      await readFile(path.resolve(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> }

    expect(journal.entries.at(-1)).toMatchObject({
      idx: 77,
      tag: "0077_account_currency",
    })
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
})
