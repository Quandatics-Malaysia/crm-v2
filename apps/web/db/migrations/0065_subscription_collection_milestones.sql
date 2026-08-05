ALTER TABLE "platform_subscription_invoices"
  ADD COLUMN "monthly_seat_price" numeric(14, 2),
  ADD COLUMN "billing_period_count" integer,
  ADD COLUMN "collection_frequency" text;
--> statement-breakpoint
ALTER TABLE "platform_subscription_invoices"
  ADD CONSTRAINT "platform_subscription_invoices_collection_frequency_check"
  CHECK ("collection_frequency" IS NULL OR "collection_frequency" IN ('monthly', 'upfront'));
--> statement-breakpoint
CREATE TABLE "platform_subscription_collection_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "invoice_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "title" text NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_subscription_collection_milestones_invoice_sequence_uq" UNIQUE("invoice_id", "sequence")
);
--> statement-breakpoint
ALTER TABLE "platform_subscription_collection_milestones"
  ADD CONSTRAINT "platform_subscription_collection_milestones_tenant_id_organization_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_subscription_collection_milestones"
  ADD CONSTRAINT "platform_subscription_collection_milestones_invoice_id_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "public"."platform_subscription_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "platform_subscription_collection_milestones_tenant_due_idx"
  ON "platform_subscription_collection_milestones" USING btree ("tenant_id", "due_at");
