-- Salesforce field parity (phase-1 core objects). Additive, nullable columns
-- so the client's existing data imports 1:1. See
-- https://github.com/Super-ERP/docs/blob/main/archive/specs/2026-07-08-backend-hardening-design.md (migration notes)
-- and the field-parity gap analysis.
ALTER TABLE "persons" ADD COLUMN "owner_member_id" text;
ALTER TABLE "persons" ADD CONSTRAINT "persons_owner_member_id_member_id_fk"
  FOREIGN KEY ("owner_member_id") REFERENCES "member"("id") ON DELETE set null;
ALTER TABLE "persons" ADD COLUMN "country" text;

ALTER TABLE "leads" ADD COLUMN "mobile" text;
ALTER TABLE "leads" ADD COLUMN "country" text;

ALTER TABLE "accounts" ADD COLUMN "budgeting_date" date;

ALTER TABLE "quotations" ADD COLUMN "quote_date" date;
