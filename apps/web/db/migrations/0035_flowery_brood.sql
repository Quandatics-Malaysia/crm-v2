ALTER TABLE "tenant_settings" ADD COLUMN "currencies" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "payment_terms" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "quote_valid_days" integer;