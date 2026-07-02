ALTER TABLE "tenant_settings" ADD COLUMN "lead_sources" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "loss_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "so_document_kinds" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "company_address" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "company_registration_no" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "company_phone" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "company_email" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "company_website" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "bank_details" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "quote_footer" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "logo_storage_key" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "logo_content_type" text;