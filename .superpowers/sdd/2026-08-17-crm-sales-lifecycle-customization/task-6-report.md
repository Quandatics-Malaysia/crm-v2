# Task 6 — Reversible Funnel stages with terminal locks

## Implementation

- Added one pure transition policy in `apps/web/lib/stage-gate.ts` and made the client adapter delegate to it.
- OPEN and PARKED/KIV stages can move backward or forward; Closed Won and Closed Lost remain immutable.
- Rollbacks skip stage-entry requirements and approval gates. A later forward move uses the normal entered-stage requirement union again.
- Removed the separate KIV/Lost reopen action, service, and dialog route. KIV now uses the shared stage-advance flow.
- Rollback dialogs are labeled `Move back` and hide PPVVC, custom-field, missing-field, reason, and attachment gate UI.

## TDD evidence

- RED: updated transition-matrix tests failed under the old monotonic/terminal policy: backward OPEN, KIV→OPEN, and client-policy cases failed.
- GREEN: focused stage-gate/project-code tests passed after the shared policy, rollback gate bypass, KIV flow, and terminal-lock changes.

## Verification

- Focused tests: 54 files passed; 500 tests passed; 45 skipped.
- Full web suite: 54 files passed; 500 tests passed; 45 skipped.
- Typecheck: passed with no TypeScript errors.
- Lint: passed.
- Migration-focused tests: passed; PostgreSQL integration cases skipped where database variables are unavailable.
- `git diff --check`: passed.
- `pnpm --filter web db:migrate`: unable to connect to PostgreSQL locally (`ECONNREFUSED`); no migration was applied.

## Commit

Commit message: `feat: allow safe funnel stage rollback`

## Fix round 1/5 — review findings

- Rollbacks now cancel all pending stage approvals in the same transaction as the stage change.
- Approval resolution locks the funnel, rechecks the exact current transition, and revalidates live funnel/container gate requirements before applying the move. Stale requests resolve as rejected/obsolete with an audit note.
- Rollback classification now compares ordered targets for every allowed nonterminal transition. Won/Lost targets are always forward despite inconsistent terminal sort orders; Won/Lost sources remain immutable.
- StagePath target titles and instructions distinguish `Move back` from `Advance`.
- Added regression coverage for approval invalidation, rollback cancellation, ordering edge cases, and StagePath copy.

### Fix-round verification

- Focused lifecycle tests: 3 files passed; 29 tests passed.
- Full web suite: 55 files passed; 504 tests passed; 45 skipped.
- Typecheck: passed with no TypeScript errors.
- Lint: passed.
- Migration-focused tests: 2 files passed; 20 tests passed; 1 skipped. Migrator artifact test and runtime-artifact shell test passed.
- `git diff --check`: passed.
- `pnpm --filter web run db:migrate`: unable to connect to local PostgreSQL (`ECONNREFUSED`); no migration was applied.
