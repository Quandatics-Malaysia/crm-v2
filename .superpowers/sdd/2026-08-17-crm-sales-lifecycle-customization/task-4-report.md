# Task 4 report: Opportunity naming and 4A project-code timing

## Result

- Opportunity codes now use `ORGCODEOPP-YYYY-NNNN` with uppercase alphanumeric organization-code normalization.
- Opportunity `name` is always the generated `code`; user name edits and the duplicate Opportunities-table code column are removed.
- Opportunity creation leaves `projectCode` null.
- The first child-funnel transition into stage `4a` allocates the project code inside the stage transaction. The locked, idempotent helper preserves the value across rollback and re-entry.
- No Project row is created or updated by this workflow.
- Migration `0078_opportunity_name_project_code` aligns legacy names to existing codes without renumbering or changing existing project codes.

## Changed files

- `apps/web/lib/opportunity-code.ts`
- `apps/web/server/services/opportunity-container.ts`
- `apps/web/server/services/stage.ts`
- `apps/web/app/(app)/opportunities/actions.ts`
- `apps/web/app/(app)/opportunities/opportunities-table.tsx`
- `apps/web/app/(app)/opportunities/[id]/opportunity-detail-body.tsx`
- `apps/web/db/migrations/0078_opportunity_name_project_code.sql`
- `apps/web/db/migrations/meta/_journal.json`
- `apps/web/tests/opportunity-code.test.ts`
- `apps/web/tests/project-code-stage.test.ts`
- `apps/web/tests/migration-journal.test.ts`

## TDD evidence

- RED: the new format, timing, idempotence, and journal assertions failed against the old implementation (7 expected failures).
- GREEN: focused verification passed with 51 test files, 486 tests passed, and 37 skipped.

## Verification

- `rtk pnpm --filter web test`: passed, 51 files / 485 tests; the subsequent focused run including migration checks passed 486 tests.
- `rtk pnpm --filter web typecheck`: passed; no TypeScript errors.
- `rtk pnpm --filter web lint`: passed.
- `rtk git diff --check`: passed.
- Migration-journal assertions passed, including migration 0078 and preservation checks.

## Commit

Implementation commit SHA: `33fca9f`

The report is committed in the follow-up Task 4 commit using the same required commit message.

## Fix round 1/5

- Added executable PostgreSQL migration coverage for 0078 using the existing temporary-database Drizzle migrator convention. The fixture migrates through 0077, seeds two tenants, applies 0078, reruns the migrator, and asserts `name = code` plus preservation of code, year/number, and non-null `projectCode` values.
- Strengthened the stage test through `requestStageAdvance`/`reopenOpportunity` and the `runInTenant` transaction seam. It now proves rollback, re-entry idempotence, committed Opportunity-code writes, and no `projects` table writes.
- SQLite/PGlite coverage is not used: migration 0078 uses PostgreSQL `IS DISTINCT FROM`, and this repository’s migration harness is PostgreSQL/Drizzle. The integration test uses `TEST_DATABASE_ADMIN_URL`; without it, the focused run reports the PostgreSQL suite as skipped.

Fix-round verification: full web suite passed with 51 files / 487 tests and 38 skipped; typecheck and lint passed. The PostgreSQL fixture was skipped because `TEST_DATABASE_ADMIN_URL` is unset in this workspace.
