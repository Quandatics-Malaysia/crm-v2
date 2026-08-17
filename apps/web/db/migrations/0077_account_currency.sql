-- Account currency is required, tenant-backed, and additive for existing rows.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" char(3);
--> statement-breakpoint
UPDATE "accounts" AS a
SET "currency" = COALESCE(
  (
    SELECT upper(trim(ts."default_currency"))::char(3)
    FROM "tenant_settings" AS ts
    WHERE ts."organization_id" = a."tenant_id"
  ),
  'MYR'::char(3)
)
WHERE a."currency" IS NULL;
--> statement-breakpoint
UPDATE "accounts" SET "currency" = 'MYR'::char(3) WHERE "currency" IS NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "currency" SET DEFAULT 'MYR';
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "currency" SET NOT NULL;
--> statement-breakpoint
-- Normalize the seeded/default template name without rewriting legacy records.
UPDATE "pipelines"
SET "name" = 'Sales Funnel'
WHERE "is_default" = true AND "name" = 'Sales Pipeline';
