# Task 5 — Grouped bidirectional PPVVC editing

## Implementation

- Added the exact grouped `1-Pain`, `2-Power`, `3-Vision`, `4-Value`, `5-Control` metadata and shared editor.
- Made Opportunity the authoritative PPVVC source; Funnel edits resolve the parent Opportunity and atomically synchronize all live child Funnels.
- Added audit-preserving server actions, tenant/deleted-row guards, row locking, and authoritative board reads.
- Added grouped detail editors, compact board badges, and inline PPVVC editing in stage advancement.
- Preserved existing stage-gate and permission behavior, with PPVVC values read from the live Opportunity.

## TDD evidence

- RED: the new synchronization tests initially failed because `@/lib/ppvvc` did not exist.
- GREEN: synchronization tests passed after the authoritative service was implemented.
- RED: the editor contract tests initially failed because `@/components/ppvvc-editor` did not exist.
- GREEN: editor contract tests passed after the grouped editor was implemented.

## Verification

- Focused tests: 3 files passed, 23 tests passed.
- Full web suite: 53 files passed, 5 skipped; 492 tests passed, 38 skipped.
- Typecheck: passed with no TypeScript errors.
- Lint: passed.
- Migration checks: 2 files passed, 1 skipped; 20 tests passed, 1 skipped.
- `git diff --check`: passed.

## Files

- `apps/web/lib/ppvvc.ts`
- `apps/web/server/services/ppvvc.ts`
- `apps/web/components/ppvvc-editor.tsx`
- `apps/web/tests/ppvvc-sync.test.ts`
- `apps/web/tests/ppvvc-editor.test.ts`
- Opportunity and Funnel actions, readers, board/detail/stage UI, and stage service updates.
- Small type-only fixes in `apps/web/server/services/conversion.ts` and `apps/web/tests/project-code-stage.test.ts` required to complete the repository typecheck.

## Commit

Commit SHA is returned in the final handoff after the requested feature commit.

## Fix round 1/5 — review findings

### Findings addressed

- P1 stale PPVVC snapshots: `PpvvcEditor` now submits only dirty fields and safely merges refreshed props into clean draft fields while preserving unsaved edits.
- P1 stage gate refresh: successful inline PPVVC saves immediately update the dialog's local authoritative values and PPVVC-backed gate flags.
- P1 Funnel-side synchronization: both mutation paths record meaningful before/after audit and activity history for the authoritative Opportunity and every live child Funnel.
- P2 draft resynchronization: editor server snapshots are tracked independently from local drafts and reconciled field-by-field.
- P2 stage requirements: stage dialogs render only PPVVC sections represented by entered-stage requirements.
- P2 transaction coverage: removed fake transaction tests and added a PostgreSQL boundary suite covering tenant/deleted predicates, row locking, rollback atomicity, audit/history, and production sync-history wiring.

### TDD evidence

- RED: focused tests failed on missing dirty-patch, draft-merge, relevant-field, and live-gate contracts.
- GREEN: focused tests passed after the editor and gate helpers were implemented.
- RED: synchronization contract test failed because child before/after pairs were absent.
- GREEN: synchronization tests passed after tenant-scoped locks and child change snapshots were added.
- RED: history contract test failed because Funnel PPVVC fields were not registered.
- GREEN: history tests passed after registry and shared audit/history wiring were added.

### Verification

- Focused PPVVC/stage tests: 53 files passed; 495 tests passed; 41 skipped.
- Full web suite: 53 files passed; 6 skipped; 495 tests passed; 41 skipped.
- Typecheck: passed.
- Lint: passed.
- Migration checks: passed; database migration suite skipped without configured test database URLs.
- `git diff --check`: passed.

### Fix-round files

- `apps/web/components/ppvvc-editor.tsx`
- `apps/web/lib/ppvvc.ts`
- `apps/web/lib/stage-gate.ts`
- `apps/web/app/(app)/funnel/stage-advance-dialog.tsx`
- `apps/web/app/(app)/funnel/actions.ts`
- `apps/web/app/(app)/opportunities/actions.ts`
- `apps/web/server/services/ppvvc.ts`
- `apps/web/server/services/changes/registry.ts`
- `apps/web/tests/ppvvc-sync.test.ts`
- `apps/web/tests/ppvvc-sync-db.test.ts`
- `apps/web/tests/stage-gate.test.ts`

Commit SHA: reported in the final handoff.

## Fix round 2/5 — PPVVC lost updates and lock-order inversion

### Findings addressed

- P1 Funnel sparse patches: added `normalizePpvvcPatch`, so omitted action fields stay omitted instead of becoming `undefined` keys that normalize to `null`.
- P1 Opportunity stale snapshots: the Opportunity action now forwards only submitted PPVVC keys; the service re-reads the locked authoritative Opportunity, merges that sparse patch, and persists only those keys.
- P2 cross-entry lock order: Funnel validates its tenant/live row without taking a child lock, then both Funnel and Opportunity entry points lock the Opportunity first and live child Funnels second. Funnel identity is revalidated at that ordered lock boundary.
- P2 concurrency coverage: added a PostgreSQL boundary regression racing Funnel and Opportunity edits, with timeout/deadlock protection and final source/child assertions for both disjoint fields.

### TDD evidence

- RED: the sparse-patch contract failed with `TypeError: normalizePpvvcPatch is not a function` before the production helper existed.
- GREEN: the focused PPVVC/editor run passed after the helper, sparse actions, lock-time merge, and ordered locking were implemented.
- The PostgreSQL cross-entry regression is present at the strongest available database boundary but skipped in this workspace because `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` are unset.

### Verification

- Full web suite: 53 files passed; 6 skipped; 496 tests passed; 42 skipped.
- Typecheck: passed with no TypeScript errors.
- Lint: passed.
- Migration-focused checks: passed; PostgreSQL migration fixture skipped without configured database URLs.
- `git diff --check`: passed.

### Fix-round files

- `apps/web/lib/ppvvc.ts`
- `apps/web/app/(app)/funnel/actions.ts`
- `apps/web/app/(app)/opportunities/actions.ts`
- `apps/web/server/services/ppvvc.ts`
- `apps/web/tests/ppvvc-sync.test.ts`
- `apps/web/tests/ppvvc-sync-db.test.ts`

Commit SHA: reported in the final handoff.

## Fix round 3/5 — deterministic cross-entry race and action seams

### Findings addressed

- P1 cross-entry race coverage: replaced timing sleeps with a test-only query-builder barrier that releases both real PostgreSQL transactions together at their first `FOR UPDATE`. Current Funnel and Opportunity paths both report `opportunities` as their first locked table; opposite lock order (`funnels` then `opportunities`) would enter the deadlock path and fail the timeout-bound race.
- P1 action seam coverage: added direct Server Action regressions proving Funnel and Opportunity actions trim and submit sparse PPVVC patches, omit `undefined` keys, preserve ordinary untouched fields, and leave PPVVC persistence to the synchronization service.
- No production change was required; round-2 sparse payload and deterministic lock-order implementation satisfies these regressions.

### TDD evidence

- New action seam tests initially failed during setup because the action dependency seam omitted the production `db` export; after correcting the test double, they passed against the existing actions.
- The database race test now coordinates real transaction query execution rather than relying on elapsed time. It is skipped in this workspace because `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` are unset; typecheck validates the barrier implementation.

### Verification

- Focused PPVVC tests: 2 files passed; 9 tests passed; 4 PostgreSQL tests skipped without configured database URLs.
- Typecheck: passed.
- Lint: passed.
- `git diff --check`: passed.

### Fix-round files

- `apps/web/tests/ppvvc-sync-db.test.ts`
- `apps/web/tests/ppvvc-actions.test.ts`

Commit SHA: reported in the final handoff.

## Fix round 4/5 — action-to-storage sparse PPVVC persistence

### Findings addressed

- Added environment-gated PostgreSQL regressions for sparse Funnel and Opportunity Server Actions.
- Each regression exercises production `runAction`, `withTenant`, authenticated tenant context, real tenant transaction, real PPVVC synchronization service, and admin storage reads.
- Assertions prove submitted PPVVC fields change while every untouched PPVVC field remains unchanged on both authoritative Opportunities and live Funnel snapshots.
- Existing action unit tests remain as forwarding-contract coverage; no synchronization services are mocked in the new regressions.
- No production defect found; production code unchanged.

### TDD evidence

- Tests were authored before any production change; no production change was required because sparse persistence path is already correct.
- PostgreSQL action regressions are environment-gated and skipped in this workspace because `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` are unset.

### Verification

- Focused PPVVC tests: 2 files passed; 9 tests passed; PostgreSQL boundary file skipped with 6 tests skipped.
- Full web suite: 54 files passed; 6 skipped; 498 tests passed; 44 skipped.
- Typecheck: passed with no TypeScript errors.
- Lint: passed.
- Migration-focused checks: 2 files passed; 1 skipped; 20 tests passed; 1 skipped.
- `git diff --check`: passed.

### Fix-round files

- `apps/web/tests/ppvvc-sync-db.test.ts`
- `.superpowers/sdd/2026-08-17-crm-sales-lifecycle-customization/task-5-report.md`

Commit: `test: verify PPVVC sparse persistence`
