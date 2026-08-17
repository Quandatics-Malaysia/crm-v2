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
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_funnel_version_uq"
  ON "quotations" ("funnel_id", "version");
