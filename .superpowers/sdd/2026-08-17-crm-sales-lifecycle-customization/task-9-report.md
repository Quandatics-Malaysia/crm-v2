# Task 9 — Quotation approval state machine

## Implementation

- Added `pending_approval` and `approved` quotation statuses with additive,
  idempotent migration `0081_quotation_approval.sql`.
- Added approver member, approval timestamp, and approval rejection reason
  fields. Existing quotation rows keep their current statuses and metadata.
- Added `quotation.approve` permission to the catalog, permission UI, seeded
  Manager/Developer roles, and existing system-role migration backfill.
- Added pure quotation transition policy. Draft can submit for approval only;
  Pending Approval can approve or return to Draft with a required reason;
  Approved can send or be explicitly reset to Draft; customer Accept/Reject is
  valid only from Sent. Direct Draft-to-Sent is rejected.
- Added locked transactional actions:
  `submitQuotationForApproval`, `approveQuotation`, `rejectQuotation`,
  `returnApprovedQuotationToDraft`, and `rejectCustomerQuotation`.
  Actions enforce tenant visibility, permissions, current status, audit events,
  and route revalidation.
- Changed send to require Approved and lock its row. Draft update, send,
  acceptance, and customer rejection paths use row locking where lifecycle
  races matter.
- Removed quotation-accept auto-win behavior. Customer acceptance does not
  move Funnel stage.
- Updated quotation UI: Draft shows Submit for approval; Pending Approval
  shows Approve / Reject approval; Approved is read-only with explicit reset;
  Send appears only for Approved; customer actions appear only for Sent.

## TDD evidence

- RED: focused tests failed because quotation transition module/actions and
  migration/journal entry were missing. Existing send and customer-reject
  paths also failed the new approval expectations.
- GREEN: focused suite passed after implementation: 61 files, 549 passed,
  53 skipped.

## Verification

- Full web tests: 61 files passed, 7 skipped; 549 tests passed, 53 skipped.
- Typecheck: passed.
- Lint: passed.
- Migration journal/contract checks: passed in full web suite.
- `git diff --check`: passed.
- `pnpm build`: blocked by pre-existing Next 16 Server Action violations in
  Task 1–3 files (`saved-view-actions.ts`, `accounts/actions.ts`, and
  `leads/actions.ts`); no Task 9 file was reported in build errors.
- `pnpm --filter web db:migrate`: blocked by local PostgreSQL
  `ECONNREFUSED` while creating the `drizzle` schema; no migration was applied.

## Commit

Commit message: `feat: require quotation approval before send`
