ALTER TYPE "public"."attachable_type" ADD VALUE 'finance_doc';--> statement-breakpoint
ALTER TYPE "public"."activity_entity_type" ADD VALUE 'finance_doc';--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "invoice_reminder_days" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "invoice_due_days" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "auto_complete_project_on_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "interco_auto_mirror" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD COLUMN "reminder_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD COLUMN "last_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD COLUMN "intercompany_deal_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD COLUMN "counterpart_doc_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_intercompany_deal_id_intercompany_deals_id_fk" FOREIGN KEY ("intercompany_deal_id") REFERENCES "public"."intercompany_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_counterpart_doc_id_finance_docs_id_fk" FOREIGN KEY ("counterpart_doc_id") REFERENCES "public"."finance_docs"("id") ON DELETE set null ON UPDATE no action;