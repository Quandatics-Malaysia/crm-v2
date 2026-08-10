import type { Sql } from "postgres"

type JournalEntry = { idx: number; tag: string; when: number }

const migrationVersionPattern = /^[0-9]{4}$/

function validatedJournalEntries(journal: unknown): JournalEntry[] {
  if (journal === null || typeof journal !== "object" || !("entries" in journal)) {
    throw new TypeError("Invalid migration journal")
  }
  const entries = (journal as { entries?: unknown }).entries
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("Invalid migration journal")

  let previousIndex = -1
  let previousTimestamp = -1
  return entries.map((candidate) => {
    if (candidate === null || typeof candidate !== "object") throw new TypeError("Invalid migration journal")
    const { idx, tag, when } = candidate as Partial<JournalEntry>
    const match = typeof tag === "string" ? tag.match(/^([0-9]{4})_[A-Za-z0-9_-]+$/) : null
    if (
      !Number.isInteger(idx) || idx! <= previousIndex ||
      !Number.isSafeInteger(when) || when! <= previousTimestamp || when! <= 0 ||
      match === null
    ) {
      throw new TypeError("Invalid migration journal")
    }
    previousIndex = idx!
    previousTimestamp = when!
    return { idx: idx!, tag: tag!, when: when! }
  })
}

export function latestAppliedMigrationVersion(journal: unknown): string {
  const entries = validatedJournalEntries(journal)
  return entries.at(-1)!.tag.slice(0, 4)
}

type AppliedTimestamp = bigint | number | string | null

function validatedAppliedTimestamp(value: AppliedTimestamp): bigint {
  if (typeof value === "bigint" && value > BigInt(0)) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value)
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return BigInt(value)
  throw new TypeError("Invalid applied migration history")
}

export function resolveAppliedMigrationVersion(
  journal: unknown,
  latestAppliedTimestamp: AppliedTimestamp,
): string | null {
  const entries = validatedJournalEntries(journal)
  const appliedTimestamp = validatedAppliedTimestamp(latestAppliedTimestamp)
  const latestSourceTimestamp = BigInt(entries.at(-1)!.when)
  if (appliedTimestamp > latestSourceTimestamp) return null
  const appliedEntry = entries.find((entry) => BigInt(entry.when) === appliedTimestamp)
  if (appliedEntry === undefined) throw new TypeError("Invalid applied migration history")
  return appliedEntry.tag.slice(0, 4)
}

export async function readActualAppliedMigrationVersion(database: Sql, journal: unknown): Promise<string | null> {
  const rows = await database<{ created_at: string }[]>`
    SELECT created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `
  return resolveAppliedMigrationVersion(journal, rows[0]?.created_at ?? null)
}

export async function publishAppliedMigrationVersion(database: Sql, version: string): Promise<string> {
  if (!migrationVersionPattern.test(version)) throw new TypeError("Invalid applied migration version")
  const rows = await database<{ migration_version: string }[]>`
    INSERT INTO deployment_runtime_metadata (singleton, migration_version, published_at)
    VALUES (1, ${version}, now())
    ON CONFLICT (singleton) DO UPDATE SET
      migration_version = CASE
        WHEN deployment_runtime_metadata.migration_version ~ '^[0-9]{4}$' THEN
          CASE
            WHEN deployment_runtime_metadata.migration_version::integer >= EXCLUDED.migration_version::integer
              THEN deployment_runtime_metadata.migration_version
            ELSE EXCLUDED.migration_version
          END
        ELSE deployment_runtime_metadata.migration_version
      END,
      published_at = CASE
        WHEN deployment_runtime_metadata.migration_version ~ '^[0-9]{4}$' THEN
          CASE
            WHEN deployment_runtime_metadata.migration_version::integer >= EXCLUDED.migration_version::integer
              THEN deployment_runtime_metadata.published_at
            ELSE EXCLUDED.published_at
          END
        ELSE deployment_runtime_metadata.published_at
      END
    RETURNING migration_version
  `
  const publishedVersion = rows[0]?.migration_version
  if (publishedVersion === undefined || !migrationVersionPattern.test(publishedVersion)) {
    throw new TypeError("Invalid published migration version")
  }
  return publishedVersion
}

export async function publishAfterSuccessfulMigration(
  applyMigrations: () => Promise<void>,
  readAppliedVersion: () => Promise<string | null>,
  publish: (version: string) => Promise<unknown>,
): Promise<string | null> {
  await applyMigrations()
  const version = await readAppliedVersion()
  if (version !== null) await publish(version)
  return version
}
