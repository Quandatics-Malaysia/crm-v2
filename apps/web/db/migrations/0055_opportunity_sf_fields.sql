-- Salesforce field parity on the Opportunity container: Owner/Power Sponsor
-- contact + budget limit, Estimated Budget (distinct from the
-- totalEstimatedFunnelAmount rollup), Estimated Close Date, New Business?,
-- container-level Renewal Opportunity?, Show Dashboards, Assigned Presales,
-- Competitor. Designation fields are derived from persons.title, not stored.
ALTER TABLE "opportunities" ADD COLUMN "owner_contact_id" uuid;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_contact_id_persons_id_fk"
  FOREIGN KEY ("owner_contact_id") REFERENCES "persons"("id") ON DELETE set null;
ALTER TABLE "opportunities" ADD COLUMN "owner_budget_limit" numeric(14, 2);
ALTER TABLE "opportunities" ADD COLUMN "power_sponsor_contact_id" uuid;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_power_sponsor_contact_id_persons_id_fk"
  FOREIGN KEY ("power_sponsor_contact_id") REFERENCES "persons"("id") ON DELETE set null;
ALTER TABLE "opportunities" ADD COLUMN "power_sponsor_budget_limit" numeric(14, 2);
ALTER TABLE "opportunities" ADD COLUMN "estimated_budget" numeric(14, 2);
ALTER TABLE "opportunities" ADD COLUMN "estimated_close_date" date;
ALTER TABLE "opportunities" ADD COLUMN "new_business" boolean DEFAULT false NOT NULL;
ALTER TABLE "opportunities" ADD COLUMN "is_renewal" boolean DEFAULT false NOT NULL;
ALTER TABLE "opportunities" ADD COLUMN "show_dashboards" boolean DEFAULT false NOT NULL;
ALTER TABLE "opportunities" ADD COLUMN "assigned_presales" text;
ALTER TABLE "opportunities" ADD COLUMN "competitor" text;

-- Funnel fields needed for the 4A stage-gate rule.
ALTER TABLE "funnels" ADD COLUMN "procurement_stage" text;
ALTER TABLE "funnels" ADD COLUMN "negotiation_done" boolean DEFAULT false NOT NULL;
ALTER TABLE "funnels" ADD COLUMN "negotiation_date" date;
ALTER TABLE "funnels" ADD COLUMN "expected_invoice_month" text;
ALTER TABLE "funnels" ADD COLUMN "expected_invoice_year" integer;
