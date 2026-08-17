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

## Fix round 3/5

- Root cause: round 2 applied the stale-claim regexes only to raw source;
  rendered JSX could join split phrases, and broad matches could reject
  accurate negations such as “does not create” or “is not supported”.
- Added `stale-claims.ts` with normalized rendered-text scanning, all stale
  patterns applied to both source and rendered documentation, and bounded
  sentence-context negation handling.
- Updated the reference ERD with `FUNNELS |o--o{ PAYMENT_MILESTONES` and
  `PROJECTS |o--o{ PAYMENT_MILESTONES`, accurately showing both nullable
  ownership paths.
- Added regressions for JSX-split positive coupling claims and accurate
  negated wording.

## Fix round 3 TDD evidence

- RED: the new guard import failed before implementation; after the matcher
  existed, the ERD assertions and overlapping stale-match expectation exposed
  the remaining cases.
- GREEN: focused documentation suite passed with 1 file and 5 tests.

## Fix round 3 verification

- Full web tests: 65 files passed, 9 skipped; 594 tests passed, 55 skipped.
- Typecheck: passed.
- Lint: passed.
- `git diff --check`: passed.

## Fix round 4/5

- Root cause: raw TSX source could hide stale phrases behind JSX tags or
  whitespace/string expressions, while the negation lookback crossed comma
  and conjunction boundaries and suppressed later positive claims.
- Normalized raw source by replacing JSX presentation boundaries with spaces;
  tag attributes and identifier-only expression code remain non-documentation.
- Scoped negation to the matched phrase's local clause, stopping at punctuation
  and conjunctions including `but` and `however`.
- Added regressions for raw JSX/expression splits, source-code false positives,
  and negated-then-positive clauses.

## Fix round 4 TDD evidence

- RED: the raw JSX split and negated-then-positive tests failed against the
  round-3 matcher.
- GREEN: focused documentation suite passed with 1 file and 6 tests.

## Fix round 4 verification

- Full web tests: 65 files passed, 9 skipped; 595 tests passed, 55 skipped.
- Typecheck: passed.
- Lint: passed.
- `git diff --check`: passed.

## Fix round 5/5

- Root cause: raw JSX normalization only recognized an expression when its
  entire contents were one simple string. Dynamic expressions such as
  `{invoice}` therefore left identifier text between prose words, and
  `and`/`or` were incorrectly treated as negation clause boundaries.
- Replaced expression cleanup with balanced JSX-expression scanning. Dynamic
  or compound expressions become separators; only standalone string literals
  that can be safely parsed remain searchable prose. JSX tags remain
  presentation separators.
- Kept negation across coordinated `and`/`or` predicates while stopping at
  punctuation and adversative boundaries such as `but` and `however`.
- Added regressions for `{invoice}` false positives, split static literals,
  compound dynamic expressions, coordinated negation, and the existing
  negated-then-positive adversative clauses.

## Fix round 5 TDD evidence

- RED: the new dynamic-expression and coordinated-negation regressions failed
  against the round-4 scanner with two failing tests.
- GREEN: the same documentation command passed with 65 files and 597 tests;
  9 files and 55 tests remain intentionally skipped.

## Fix round 5 verification

- Full web tests: 65 files passed, 9 skipped; 597 tests passed, 55 skipped.
- Typecheck: passed with `tsc --noEmit`.
- Lint: passed.
- `git diff --check`: passed.

## Commit

Commit message: `test: finalize milestone claim scanner`
