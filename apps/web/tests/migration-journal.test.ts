import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("migration journal", () => {
  it("includes the person department repair migration", async () => {
    const journal = JSON.parse(
      await readFile(path.resolve(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> }

    expect(journal.entries.at(-1)).toMatchObject({
      idx: 74,
      tag: "0074_repair_person_department",
    })
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
