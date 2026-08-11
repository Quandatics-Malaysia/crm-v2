import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"

const migrationsDirectory = new URL("../migrations/", import.meta.url)

test("control migrations avoid nested SELECT CASE trigger expressions rejected by remote D1", async () => {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()

  for (const file of migrationFiles) {
    const sql = await readFile(new URL(file, migrationsDirectory), "utf8")
    assert.doesNotMatch(
      sql,
      /SELECT\s+CASE\b[\s\S]*?\bRAISE\s*\(/i,
      `${file} uses SELECT CASE ... RAISE(...), which remote D1 rejects with incomplete input`,
    )
  }
})
