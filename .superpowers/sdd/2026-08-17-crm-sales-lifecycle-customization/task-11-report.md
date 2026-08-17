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
  finance foreign key for read compatibility; they are not live invoice
  linkage, and new finance documents leave the link null.
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

## Fix round 2/5

- Root cause: round 1 covered only Finance and Sales prose. Overview's Mermaid
  map, Reference settings/ERD/changelog, and generated schema data still
  exposed one-click invoicing, paid/auto-complete behavior, live invoice
  linkage, and the legacy pending status.
- Updated `content-overview.tsx` to show Funnel milestone planning with no
  Finance edge.
- Updated `content-reference.tsx` to remove the auto-complete setting, live
  invoice ERD edge, milestone reconciliation claim, one-click billing history,
  auto-complete history, and milestone/project Finance side effects.
- Updated `schema-data.ts` to show `won | invoiced`, default `won`, Funnel
  ownership, current milestone columns, and deprecated invoice compatibility
  fields explicitly marked non-live.
- Extended `payment-milestone-documentation.test.ts` to scan every registered
  documentation page plus every `content-*.tsx` source and `schema-data.ts` for
  forbidden stale phrases/statuses.

## Fix round 2 TDD evidence

- RED: expanded source scan failed on the remaining `all milestones paid`,
  one-click, live-invoice, auto-complete, and legacy schema claims.
- GREEN: focused documentation test passed with 1 file and 3 tests.

## Fix round 2 verification

- Full web tests: 65 files passed, 9 skipped; 592 tests passed, 55 skipped.
- Typecheck: passed after replacing unsupported Node `globSync` with typed
  `readdirSync` source discovery.
- Lint: passed.
- `git diff --check`: passed.

## Commit

Commit message: `feat: decouple payment milestones from invoicing`
