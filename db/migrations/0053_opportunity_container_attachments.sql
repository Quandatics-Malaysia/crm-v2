-- Attachments/documents on the Opportunity CONTAINER (opportunities table).
-- "opportunity" already means the funnel/deal (legacy naming, kept as-is —
-- see the comment in db/schema/approvals.ts); the container needs its own
-- attachable_type value to get a Documents tab.
ALTER TYPE "attachable_type" ADD VALUE 'opportunity_container';
