# Task 10 — Quotation revision workflow

## Fix round 1/5

- Migration `0082_quotation_revisions.sql` now repairs duplicate `(funnel_id,
  version)` rows before creating the unique index. The first row in each
  duplicate group is retained; remaining rows receive deterministic versions
  ordered by `created_at, id` above the funnel maximum. Quote numbers and all
  other historical data remain unchanged, and replay is a no-op.
- Revision eligibility is centralized and shared by the server action and UI:
  live Sent, Accepted, Rejected, Expired, and Void are eligible; soft-deleted
  non-Draft history is eligible; live Pending Approval/Approved and every Draft
  source are rejected.
- Added tenant/auth rejection, full status-matrix, complete header/line-copy,
  approval/customer reset, contact revalidation, and source immutability tests.
- Added PostgreSQL-boundary tests for duplicate migration fixtures and real
  transaction contention across version and quote-number allocation. They do
  not mock numbering.
- Report is stored in the standard Task 10 SDD folder.

## TDD evidence

- RED: policy module was missing; migration backfill assertions failed; action
  status tests exposed the existing live Pending Approval/Approved and
  soft-deleted Draft gaps.
- GREEN: focused quotation revision, policy, migration-journal, and boundary
  suites passed; PostgreSQL boundary suites are registered but require the
  project test database URLs.

## Verification

- Full web tests: 63 files passed, 9 skipped; 585 tests passed, 55 skipped.
- Typecheck: passed.
- Lint: passed.
- Migration journal/contract checks: passed in the full web suite.
- PostgreSQL migration and concurrency boundaries: skipped because
  `TEST_DATABASE_ADMIN_URL`/`TEST_DATABASE_URL` are unset; `db:migrate` was
  attempted and blocked by local PostgreSQL `ECONNREFUSED` before applying any
  migration.
- `git diff --check`: passed.

## Commit

Commit message: `fix: harden quotation revision workflow`

## Fix round 2/5

- Fixed the Funnel quotation reader contract: `OpportunityDetail.quotations.status`
  is now `QuotationStatus` and the payload exposes `deletedAt`.
- Funnel detail now selects `quotations.deleted_at` and includes soft-deleted
  quotation history, so the existing revision policy can keep showing the
  revision action for eligible deleted sources. No UI casts were added.
- Added a reader/data regression covering a soft-deleted Sent quote, the typed
  status, the returned deletion timestamp, the selected column, and the absence
  of the live-only `deleted_at IS NULL` predicate.
- Cleared adjacent branch typecheck failures with explicit quotation audit/value
  snapshots, Drizzle's supported self-reference column annotation, and a test
  fixture type that permits a deleted timestamp.

## Fix round 2 TDD evidence

- RED: the new reader regression failed because the quotation projection did not
  select `deletedAt`.
- GREEN: focused reader/policy tests passed after the projection and query
  change; the full web suite also passed.

## Fix round 2 verification

- Focused tests: 2 files passed, 20 tests passed.
- Full web tests: 63 files passed, 9 skipped; 586 tests passed, 55 skipped.
- Exact web typecheck (`pnpm --filter web typecheck`): passed.
- Lint: passed.
- Migration contract tests: 2 files passed, 1 skipped; 23 tests passed, 1 skipped.
- Drizzle migration diff check (`pnpm --filter web exec drizzle-kit check`): passed.
- `git diff --check`: passed.
- `db:migrate`: blocked before applying anything by local PostgreSQL
  `ECONNREFUSED`; `db:generate` was blocked by Drizzle's non-TTY interactive
  schema-conflict prompt and produced no changes.

## Fix round 2 commit

Commit message: `fix: type quotation revision eligibility`
