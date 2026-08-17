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
