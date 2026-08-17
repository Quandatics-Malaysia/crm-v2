# Task 11 — Payment milestone decoupling

## Implementation

- Replaced the milestone lifecycle with `won | invoiced`; new milestones
  default to Won and only manual Won → Invoiced is accepted.
- Added Closed Won propagation that marks all live Funnel milestones Won.
  Milestones remain creatable before close.
- Removed milestone invoice creation and link-selection writes, the Finance
  create-dialog milestone selector, milestone Finance tab, and milestone-driven
  Project completion. Existing Finance document links remain read-only.
- Retained deprecated nullable invoice snapshot columns and the historical
  finance foreign key for read compatibility; new finance documents leave the
  link null.
- Added idempotent migration `0083_payment_milestone_decoupling.sql`, mapping
  pending → won and invoiced/paid → invoiced while preserving historical
  invoice columns/FKs.
- Updated Salesforce import and sample seed mappings to the two-state model.

## TDD evidence

- RED: lifecycle tests failed because the policy module and compatibility
  migration were missing; coupling assertions found invoice creation, Finance
  tab, and Project completion paths.
- GREEN: added pure lifecycle policy, migration contract checks, Closed Won
  synchronization, and decoupled action/UI paths; focused and full suites pass.

## Verification

- Full web tests: 64 files passed, 9 skipped; 589 tests passed, 55 skipped.
- Typecheck: passed.
- Lint: passed.
- Drizzle migration diff check: passed.
- Migration journal/contract checks: passed in the full web suite.
- Live `db:migrate`: blocked before applying any migration by local
  PostgreSQL `ECONNREFUSED`; no database state changed.
- `git diff --check`: passed.

## Fix round 1/5

- Root cause: rendered Finance and Sales documentation still described the
  legacy `pending → invoiced → paid` lifecycle and invoice/receipt-driven
  Project completion.
- Updated `content-finance.tsx` and `content-sales.tsx` to document only
  Won/Invoiced milestones, pre-close preparation, Closed Won → Won propagation,
  manual Won → Invoiced, and no automatic invoice, receipt, or Project
  completion side effects.
- Removed stale milestone billing-tab, invoice-link, receipt, paid, pending,
  and automatic-coupling claims from the rendered copy and diagrams.
- Added `payment-milestone-documentation.test.ts`, which extracts rendered
  React documentation text and guards the lifecycle and stale-copy boundaries.

## Fix round 1 TDD evidence

- RED: the new rendered-documentation regression failed on missing two-state
  lifecycle copy and the legacy `pending → invoiced → paid` claim.
- GREEN: focused documentation/lifecycle suite passed with 2 files and 7 tests.

## Fix round 1 verification

- Full web tests: 65 files passed, 9 skipped; 591 tests passed, 55 skipped.
- Typecheck: passed.
- Lint: passed.
- `git diff --check`: passed.

## Commit

Commit message: `feat: decouple payment milestones from invoicing`
