-- Quotation revision lineage. The source remains independent: hard deletion
-- of a historical source only clears the pointer on its revision.
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "revision_of_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotations_revision_of_id_fkey'
  ) THEN
    ALTER TABLE "quotations"
      ADD CONSTRAINT "quotations_revision_of_id_fkey"
      FOREIGN KEY ("revision_of_id") REFERENCES "quotations"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotations_revision_of_idx"
  ON "quotations" ("revision_of_id");
--> statement-breakpoint
-- Older installations did not persist a unique per-funnel version. Keep the
-- first row for every duplicate version and deterministically move only the
-- remaining rows above the funnel's existing maximum. This preserves every
-- quote number and all other historical data, and a replay is a no-op once
-- duplicate groups have been repaired.
WITH duplicate_versions AS (
  SELECT "funnel_id", "version"
  FROM "quotations"
  GROUP BY "funnel_id", "version"
  HAVING count(*) > 1
),
duplicate_rows AS (
  SELECT
    q."id",
    q."funnel_id",
    q."created_at",
    row_number() OVER (
      PARTITION BY q."funnel_id", q."version"
      ORDER BY q."created_at", q."id"
    ) AS duplicate_rank
  FROM "quotations" q
  JOIN duplicate_versions d
    ON d."funnel_id" = q."funnel_id" AND d."version" = q."version"
),
funnel_max AS (
  SELECT "funnel_id", max("version") AS max_version
  FROM "quotations"
  GROUP BY "funnel_id"
),
renumbered AS (
  SELECT
    d."id",
    f.max_version + row_number() OVER (
      PARTITION BY d."funnel_id"
      ORDER BY d."created_at", d."id"
    ) AS new_version
  FROM duplicate_rows d
  JOIN funnel_max f ON f."funnel_id" = d."funnel_id"
  WHERE d.duplicate_rank > 1
)
UPDATE "quotations" q
SET "version" = r.new_version
FROM renumbered r
WHERE q."id" = r."id";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_funnel_version_uq"
  ON "quotations" ("funnel_id", "version");
