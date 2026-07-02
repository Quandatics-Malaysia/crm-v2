ALTER TABLE "tenant_settings" ADD COLUMN "auto_create_project_on_accept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "milestone_template" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "default_country" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "phone_prefix" text;