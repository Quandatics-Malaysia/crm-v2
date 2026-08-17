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
