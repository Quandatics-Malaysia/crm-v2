-- KIV "Closed Remarks" text reason, distinct from kiv_review_date (a
-- follow-up-by date) — mirrors lost_reason's role for the Lost terminal kind.
ALTER TABLE "funnels" ADD COLUMN "kiv_reason" text;
