-- Two-level Opportunity → Funnel re-model (Salesforce-aligned).
-- See https://github.com/Super-ERP/docs/blob/main/archive/specs/2026-07-07-opportunity-funnel-remodel-design.md
-- Runs on a schema created by 0000–0046 (deal=opportunities, template=funnels).
-- No production data exists yet, so the ADD ... NOT NULL columns are safe.

-- 1. Template funnels/funnel_stages → pipelines/pipeline_stages ----------------
ALTER TABLE "funnels" RENAME TO "pipelines";
ALTER TABLE "funnel_stages" RENAME TO "pipeline_stages";
ALTER TABLE "pipeline_stages" RENAME COLUMN "funnel_id" TO "pipeline_id";
ALTER INDEX "funnels_tenant_idx" RENAME TO "pipelines_tenant_idx";
ALTER INDEX "funnels_default_uq" RENAME TO "pipelines_default_uq";
ALTER TABLE "pipeline_stages" RENAME CONSTRAINT "funnel_stages_code_uq" TO "pipeline_stages_code_uq";
ALTER TABLE "pipeline_stages" RENAME CONSTRAINT "funnel_stages_order_uq" TO "pipeline_stages_order_uq";

-- 2. Deal opportunities → funnels --------------------------------------------
ALTER TABLE "opportunities" RENAME TO "funnels";
ALTER TABLE "funnels" RENAME COLUMN "funnel_id" TO "pipeline_id";
-- Free up index names the new container will reuse.
ALTER INDEX "opportunities_tenant_stage_idx" RENAME TO "funnels_tenant_stage_idx";
ALTER INDEX "opportunities_tenant_account_idx" RENAME TO "funnels_tenant_account_idx";
ALTER TABLE "funnels" RENAME CONSTRAINT "opportunities_tenant_account_fk" TO "funnels_tenant_account_fk";

-- 3. Stage history opportunity_stage_history → funnel_stage_history -----------
ALTER TABLE "opportunity_stage_history" RENAME TO "funnel_stage_history";
ALTER TABLE "funnel_stage_history" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER INDEX "opp_stage_history_opp_idx" RENAME TO "funnel_stage_history_idx";

-- 4. Repoint child FK columns opportunity_id → funnel_id (all refer to the DEAL)
ALTER TABLE "quotations" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "stage_approval_requests" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "intercompany_deals" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "intercompany_deal_parties" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "deal_costs" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "contract_years" RENAME COLUMN "opportunity_id" TO "funnel_id";
ALTER TABLE "projects" RENAME COLUMN "opportunity_id" TO "funnel_id";
-- leads.converted_opportunity_id stays — it points to the CONTAINER below.
-- leads.funnel_id is the chosen PIPELINE (template) for conversion → pipeline_id.
ALTER TABLE "leads" RENAME COLUMN "funnel_id" TO "pipeline_id";

-- 5. New Opportunity CONTAINER -----------------------------------------------
CREATE TABLE "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "account_id" uuid NOT NULL,
  "primary_person_id" uuid,
  "owner_member_id" text NOT NULL,
  "opportunity_year" integer NOT NULL,
  "opportunity_number" integer NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "pain" text,
  "power" text,
  "vision" text,
  "value" text,
  "control" text,
  "total_estimated_funnel_amount" numeric(14, 2),
  "description" text,
  "currency" char(3) DEFAULT 'MYR' NOT NULL,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "opportunities_code_uq" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "opportunities_number_uq" UNIQUE ("tenant_id", "opportunity_year", "opportunity_number")
);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_organization_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_primary_person_id_persons_id_fk"
  FOREIGN KEY ("primary_person_id") REFERENCES "persons"("id") ON DELETE set null;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_member_id_member_id_fk"
  FOREIGN KEY ("owner_member_id") REFERENCES "member"("id") ON DELETE restrict;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_account_fk"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE restrict;
CREATE INDEX "opportunities_tenant_account_idx" ON "opportunities" ("tenant_id", "account_id");

-- 6. Funnel gains its container link + Salesforce fields ----------------------
ALTER TABLE "funnels" ADD COLUMN "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE restrict;
ALTER TABLE "funnels" ADD COLUMN "award_date" date;
ALTER TABLE "funnels" ADD COLUMN "is_renewal" boolean DEFAULT false NOT NULL;
ALTER TABLE "funnels" ADD COLUMN "pain" text;
ALTER TABLE "funnels" ADD COLUMN "power" text;
ALTER TABLE "funnels" ADD COLUMN "vision" text;
ALTER TABLE "funnels" ADD COLUMN "value" text;
ALTER TABLE "funnels" ADD COLUMN "control" text;
CREATE INDEX "funnels_opportunity_idx" ON "funnels" ("tenant_id", "opportunity_id");
