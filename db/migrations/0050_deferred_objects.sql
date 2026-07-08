-- Deferred Salesforce objects → 1:1 migration targets (Lead's Company,
-- Opportunity Product, Contract) + payment_milestones invoicing fields.

-- Lead's Company (Company__c)
CREATE TABLE "lead_companies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "name" text NOT NULL,
  "lead_id" uuid,
  "address" text,
  "website" text,
  "phone" text,
  "relationship" text,
  "company_code" text,
  "assignment_indicator" text,
  "owner_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "lead_companies" ADD CONSTRAINT "lead_companies_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "lead_companies" ADD CONSTRAINT "lead_companies_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE set null;
ALTER TABLE "lead_companies" ADD CONSTRAINT "lead_companies_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "member"("id") ON DELETE set null;
CREATE INDEX "lead_companies_tenant_idx" ON "lead_companies" ("tenant_id");

-- Opportunity Product (OpportunityLineItem)
CREATE TABLE "opportunity_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "funnel_id" uuid NOT NULL,
  "product_id" uuid,
  "description" text,
  "quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
  "unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
  "discount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "item_discount" numeric(14, 2),
  "total_price" numeric(14, 2),
  "product_category" text,
  "uom" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE cascade;
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE set null;
CREATE INDEX "opportunity_products_funnel_idx" ON "opportunity_products" ("tenant_id", "funnel_id");

-- Contract
CREATE TABLE "contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "account_id" uuid,
  "funnel_id" uuid,
  "contract_number" text,
  "name" text,
  "start_date" date,
  "contract_term" integer,
  "status" text,
  "customer_signed_title" text,
  "customer_signed_date" date,
  "activated_date" date,
  "order_number" text,
  "special_terms" text,
  "owner_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE set null;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE set null;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "member"("id") ON DELETE set null;
CREATE INDEX "contracts_tenant_account_idx" ON "contracts" ("tenant_id", "account_id");

-- payment_milestones: attach to a funnel + Salesforce invoicing fields
ALTER TABLE "payment_milestones" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "payment_milestones" ADD COLUMN "funnel_id" uuid;
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE cascade;
ALTER TABLE "payment_milestones" ADD COLUMN "split_percentage" numeric(6, 2);
ALTER TABLE "payment_milestones" ADD COLUMN "invoice_number" text;
ALTER TABLE "payment_milestones" ADD COLUMN "invoice_date" date;
ALTER TABLE "payment_milestones" ADD COLUMN "expected_invoice_month" text;
ALTER TABLE "payment_milestones" ADD COLUMN "expected_invoice_year" integer;
ALTER TABLE "payment_milestones" ADD COLUMN "so_number" text;
ALTER TABLE "payment_milestones" ADD COLUMN "product_category" text;
ALTER TABLE "payment_milestones" ADD COLUMN "product_subcategory" text;
ALTER TABLE "payment_milestones" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
CREATE INDEX "payment_milestones_funnel_idx" ON "payment_milestones" ("tenant_id", "funnel_id");
