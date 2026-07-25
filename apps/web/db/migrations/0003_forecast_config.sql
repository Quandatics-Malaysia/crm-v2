ALTER TABLE "tenant_settings" ADD COLUMN "industries" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "quote_prefix" text DEFAULT 'Q-' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "quote_next_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "quote_pad_width" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "include_in_forecast" boolean DEFAULT true NOT NULL;