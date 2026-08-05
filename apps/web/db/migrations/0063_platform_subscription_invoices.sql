CREATE TYPE "platform_subscription_invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');
--> statement-breakpoint
CREATE TABLE "platform_subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" "platform_subscription_invoice_status" DEFAULT 'draft' NOT NULL,
	"plan" text NOT NULL,
	"currency" char(3) NOT NULL,
	"additional_seats" integer NOT NULL,
	"seat_price_full_term" numeric(14, 2) NOT NULL,
	"proration_factor" numeric(9, 8) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_rate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"subscription_starts_at" timestamp with time zone NOT NULL,
	"subscription_ends_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"payment_reference" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_subscription_invoices_number_uq" UNIQUE("invoice_number")
);
--> statement-breakpoint
ALTER TABLE "platform_subscription_invoices" ADD CONSTRAINT "platform_subscription_invoices_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_subscription_invoices" ADD CONSTRAINT "platform_subscription_invoices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "platform_subscription_invoices_tenant_created_idx" ON "platform_subscription_invoices" USING btree ("tenant_id", "created_at");
