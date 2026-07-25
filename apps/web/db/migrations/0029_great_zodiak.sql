ALTER TABLE "tenant_settings" ADD COLUMN "auto_join_domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "auto_join_role" text;