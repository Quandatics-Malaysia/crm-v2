import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("migration journal", () => {
  it("includes the person department migration", async () => {
    const journal = JSON.parse(
      await readFile(path.resolve(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> }

    expect(journal.entries.at(-1)).toMatchObject({
      idx: 71,
      tag: "0071_person_department",
    })
  })
})
