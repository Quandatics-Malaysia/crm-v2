# Task 2 Report: Per-user named saved views

## Status

Implemented in `/Users/jienweng/Code/Quandatics/crm-v2/.worktrees/crm-sales-lifecycle-customization`.

## Implementation

- Added `saved_views` schema with UUID ids, organization/member ownership, list key, name, JSONB filters/sorting/visibility, page size, default flag, timestamps, tenant/member indexes, unique owner/list/name constraint, and a partial unique default index per organization/member/list.
- Added migration `0076_saved_views.sql`, journal entry `0076_saved_views`, and organization-keyed RLS in `db/sql/rls.sql`.
- Added authenticated Server Actions: `listSavedViews`, `saveView`, `renameView`, `duplicateView`, `setDefaultView`, and `deleteView`.
- Payloads are validated with Zod plus the Task 1 `validateFilterValue` contract. Organization and member ids come from `requireContext`; mutations scope every update/delete/source lookup to the current member. `setDefaultView` clears the prior default and sets the selected row inside one tenant transaction.
- Added the Saved Views menu with select, save, rename, duplicate, set default, delete, reset-to-base, default-view loading, stale-column filtering, and one warning toast.
- Wired typed enum/relation/boolean filters and stable table ids for Accounts, Persons, Leads, Opportunities, Funnels, Products, Quotations, Projects, Sales Orders, Payment Milestones, Billing, and Intercompany lists.
- Fixed the recorded Task 1 minor: configured operator allowlists now determine the default selected operator. Existing detail-table page sizes remain valid for saved payload persistence.

## Files

Created:

- `apps/web/db/schema/saved-views.ts`
- `apps/web/db/migrations/0076_saved_views.sql`
- `apps/web/app/(app)/_shared/saved-view-actions.ts`
- `apps/web/components/saved-view-menu.tsx`
- `apps/web/tests/saved-views.test.ts`
- `.superpowers/sdd/2026-08-17-crm-sales-lifecycle-customization/task-2-report.md`

Modified:

- `apps/web/db/schema/index.ts`
- `apps/web/db/migrations/meta/_journal.json`
- `apps/web/db/sql/rls.sql` (required by the repository's hand-authored RLS pattern)
- `apps/web/components/data-table.tsx`
- The 11 shared list-table files for typed filters/table wiring.
- `apps/web/tests/migration-journal.test.ts`

## TDD evidence

RED was recorded before production changes:

```text
rtk pnpm --filter web test -- saved-views.test.ts
FAIL tests/saved-views.test.ts
Error: Cannot find package '@/db/schema/saved-views'
Test Files 1 failed | 47 passed | 4 skipped
```

GREEN after implementation:

```text
rtk pnpm --dir apps/web test -- saved-views.test.ts data-table-filters.test.ts
Test Files 48 passed | 4 skipped (52)
Tests 461 passed | 37 skipped (498)
```

The saved-view tests cover schema ownership columns, the owner/list/name uniqueness contract, the one-default index, owner predicates used by mutations, valid payloads, invalid filters/page sizes, and the action surface.

## Verification

- Focused saved-view/filter tests: PASS — 48 files, 461 passed, 37 skipped.
- Full web suite: PASS — `rtk pnpm --dir apps/web test`; 48 files, 461 passed, 37 skipped.
- Typecheck: PASS — `rtk pnpm --dir apps/web run typecheck`.
- Lint: PASS — `rtk pnpm --dir apps/web run lint`.
- Migration journal tests: PASS — `rtk pnpm --dir apps/web test -- migration-journal.test.ts`.
- Diff whitespace check: PASS — `rtk git diff --check`.

## Self-review

- Tenant and member identity is never accepted from the client for persistence or ownership checks.
- RLS uses `organization_id`, not the generic `tenant_id` loop, and fails closed through the existing `app.current_tenant` helper.
- Rename, duplicate, default, and delete all use owner-scoped predicates; default switching is transactional and backed by a database partial unique index.
- Saved payload application filters unknown columns and emits one warning toast; URL state is updated by the existing DataTable history effect.
- The existing `facets` compatibility path remains available for non-migrated callers.

## Concerns

- Verification did not run a live PostgreSQL migration against an external database; migration structure, schema metadata, journal, and RLS wiring were checked by tests/review.
- Saved-view menu loading is best-effort so an unavailable saved-view read does not break list rendering.
- The implementation intentionally keeps the exact current table state payload, including existing small detail-table page sizes, rather than narrowing persistence to only the main list sizes.

Commit subject: `feat: add per-user saved list views`
