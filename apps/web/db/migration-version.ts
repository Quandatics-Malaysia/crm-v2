import type { Sql } from "postgres"

type JournalEntry = { idx: number; tag: string }

const migrationVersionPattern = /^[A-Za-z0-9._-]{1,128}$/

export function latestAppliedMigrationVersion(journal: unknown): string {
  if (journal === null || typeof journal !== "object" || !("entries" in journal)) {
    throw new TypeError("Invalid migration journal")
  }
  const entries = (journal as { entries?: unknown }).entries
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("Invalid migration journal")

  let previousIndex = -1
  let latestVersion = ""
  for (const candidate of entries) {
    if (candidate === null || typeof candidate !== "object") throw new TypeError("Invalid migration journal")
    const { idx, tag } = candidate as Partial<JournalEntry>
    const match = typeof tag === "string" ? tag.match(/^([0-9]{4})_[A-Za-z0-9_-]+$/) : null
    if (!Number.isInteger(idx) || idx! <= previousIndex || match === null) {
      throw new TypeError("Invalid migration journal")
    }
    previousIndex = idx!
    latestVersion = match[1]
  }
  return latestVersion
}

export async function publishAppliedMigrationVersion(database: Sql, version: string): Promise<void> {
  if (!migrationVersionPattern.test(version)) throw new TypeError("Invalid applied migration version")
  await database`
    INSERT INTO deployment_runtime_metadata (singleton, migration_version, published_at)
    VALUES (1, ${version}, now())
    ON CONFLICT (singleton) DO UPDATE SET
      migration_version = EXCLUDED.migration_version,
      published_at = EXCLUDED.published_at
  `
}
