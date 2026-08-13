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

test("control migrations keep trigger guards in remote-D1-compatible statement forms", async () => {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()

  for (const file of migrationFiles) {
    const sql = await readFile(new URL(file, migrationsDirectory), "utf8")
    assert.doesNotMatch(
      sql,
      /WITH\s+(?:RECURSIVE\s+)?[\s\S]*?\b(?:INSERT|UPDATE|DELETE)\b/i,
      `${file} uses CTE-backed DML, which remote D1 migrations do not reliably accept`,
    )
    assert.doesNotMatch(
      sql,
      /BEGIN\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE)?\s*TRANSACTION/i,
      `${file} opens an explicit transaction inside D1 migration execution`,
    )
  }
})
