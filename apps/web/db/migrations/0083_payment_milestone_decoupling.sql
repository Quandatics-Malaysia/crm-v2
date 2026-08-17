-- Payment milestones no longer model payment collection. Keep the old
-- nullable invoice snapshots and finance FK for historical reads, but replace
-- the enum and map every legacy row into the two-state lifecycle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payment_milestone_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payment_milestone_status_legacy'
  ) THEN
    ALTER TYPE "payment_milestone_status" RENAME TO "payment_milestone_status_legacy";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payment_milestone_status'
  ) THEN
    CREATE TYPE "payment_milestone_status" AS ENUM ('won', 'invoiced');
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'payment_milestones'
      AND a.attname = 'status'
      AND a.atttypid = to_regtype('payment_milestone_status_legacy')
  ) THEN
    ALTER TABLE "payment_milestones" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "payment_milestones"
      ALTER COLUMN "status" TYPE "payment_milestone_status"
      USING (
        CASE
          WHEN "status"::text = 'pending' THEN 'won'
          WHEN "status"::text IN ('invoiced', 'paid') THEN 'invoiced'
          ELSE 'won'
        END
      )::text::"payment_milestone_status";
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "payment_milestones"
  ALTER COLUMN "status" SET DEFAULT 'won'::"payment_milestone_status";
--> statement-breakpoint

COMMENT ON COLUMN "payment_milestones"."invoice_number" IS
  'Deprecated historical invoice snapshot; read-only compatibility column.';
COMMENT ON COLUMN "payment_milestones"."invoice_date" IS
  'Deprecated historical invoice snapshot; read-only compatibility column.';
COMMENT ON COLUMN "payment_milestones"."expected_invoice_month" IS
  'Deprecated historical invoice planning field; read-only compatibility column.';
COMMENT ON COLUMN "payment_milestones"."expected_invoice_year" IS
  'Deprecated historical invoice planning field; read-only compatibility column.';
COMMENT ON COLUMN "finance_docs"."milestone_id" IS
  'Deprecated historical invoice link; read-only compatibility foreign key.';
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payment_milestone_status_legacy'
  ) THEN
    DROP TYPE "payment_milestone_status_legacy";
  END IF;
END $$;
