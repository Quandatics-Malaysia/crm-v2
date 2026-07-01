ALTER TABLE "funnel_stages" ADD COLUMN "required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- Backfill the Salesforce-style default per-stage requirements (only where not
-- already customized), so the entry gate keeps working for existing tenants.
UPDATE "funnel_stages" SET "required_fields" = '["estimate","closeDate"]'::jsonb WHERE "code" = '1d' AND "required_fields" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "funnel_stages" SET "required_fields" = '["estimate","closeDate","contact","nature"]'::jsonb WHERE "code" = '2c' AND "required_fields" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "funnel_stages" SET "required_fields" = '["estimate","closeDate","contact","nature","quote"]'::jsonb WHERE "code" IN ('3b','4a','won') AND "required_fields" = '[]'::jsonb;
