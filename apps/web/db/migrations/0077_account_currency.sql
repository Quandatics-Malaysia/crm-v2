-- Account currency is required, tenant-backed, and additive for existing rows.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" char(3);
--> statement-breakpoint
-- Normalize each tenant setting first: keep a configured default, otherwise
-- use the first configured currency, then MYR. This makes the Settings default
-- and every backfilled Account use the same effective currency.
UPDATE "tenant_settings" AS ts
SET "default_currency" = COALESCE(
  (
    SELECT upper(trim(ts."default_currency"))::char(3)
    FROM jsonb_array_elements_text(COALESCE(ts."currencies", '[]'::jsonb)) AS c(value)
    WHERE upper(trim(c.value)) = upper(trim(ts."default_currency"))
      AND upper(trim(c.value)) ~ '^[A-Z]{3}$'
    LIMIT 1
  ),
  (
    SELECT upper(trim(c.value))::char(3)
    FROM jsonb_array_elements_text(COALESCE(ts."currencies", '[]'::jsonb)) WITH ORDINALITY AS c(value, ordinal)
    WHERE upper(trim(c.value)) ~ '^[A-Z]{3}$'
    ORDER BY c.ordinal
    LIMIT 1
  ),
  'MYR'::char(3)
);
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
