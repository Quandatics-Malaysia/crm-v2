-- Project nature on the Opportunity container (source of truth, cascaded to
-- child funnels — same pattern as PPVVC), plus an internal delivery code
-- generated once at container creation (never shown in the UI; only used to
-- prefix payment milestones' hidden `name`).
ALTER TABLE "opportunities" ADD COLUMN "project_nature_code" text;
ALTER TABLE "opportunities" ADD COLUMN "project_natures" jsonb;
ALTER TABLE "opportunities" ADD COLUMN "project_code" text;

-- Payment milestones gain a user-facing `description` and a hidden internal
-- `name` (`{projectCode}-{slugified title}`) for reporting/reference only.
ALTER TABLE "payment_milestones" ADD COLUMN "description" text;
ALTER TABLE "payment_milestones" ADD COLUMN "name" text;
