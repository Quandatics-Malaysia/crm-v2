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

## Fix round 1 evidence

### Review finding addressed

Added behavior-level tests in `apps/web/tests/saved-views.test.ts` for:

- real service CRUD through a repository contract, including save/list/get/rename/duplicate/delete and same-tenant different-member isolation;
- valid zero-default state (new views are not implicitly default);
- per-owner default replacement, including preservation of another member's default, with the replacement performed through the repository transaction seam;
- fail-closed RLS predicate behavior for absent, null, mismatched, and matching tenant context;
- stale sorting, filter, and visibility fields being dropped during saved-view application.

`apps/web/app/(app)/_shared/saved-view-actions.ts` now routes all Server Actions through the repository-backed service. The SQL adapter is run inside the existing `runInTenant` transaction; default clearing is explicitly constrained by organization, member, and list. `apps/web/lib/data-table-saved-views.ts` contains the production application logic used by `DataTable`, so the stale-field test does not inspect source text or metadata.

### TDD evidence

RED was captured before adding the production seams:

```text
rtk pnpm --dir apps/web test -- saved-views.test.ts
FAIL tests/saved-views.test.ts
Error: Cannot find package '@/lib/data-table-saved-views'
Test Files 1 failed | 47 passed | 4 skipped
Tests 457 passed | 37 skipped
```

GREEN after the service and stale-application implementation:

```text
rtk pnpm --dir apps/web test -- saved-views.test.ts
Test Files 48 passed | 4 skipped (52)
Tests 465 passed | 37 skipped (502)
```

### Database boundary

Live PostgreSQL was unavailable in this workspace: `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` were both unset. The fallback therefore uses a minimal in-memory repository implementing the same repository interface consumed by the production service. Tests execute the production validation, ownership, CRUD, default replacement, transaction callback, and stale-application logic. The RLS test executes the pure fail-closed predicate that mirrors the SQL policy `organization_id = current_setting('app.current_tenant', true)`; SQL execution/RLS enforcement itself remains the unexecuted boundary because no PostgreSQL connection was available. Schema metadata, migration journal, and RLS policy wiring remain covered by the existing repository tests.

### Final verification

- Focused saved-view/filter run: PASS — 48 files, 465 passed, 37 skipped.
- Full web suite: PASS — 48 files, 465 passed, 37 skipped.
- Migration journal run: PASS — 48 files, 465 passed, 37 skipped.
- Typecheck: PASS — `rtk pnpm --dir apps/web run typecheck`.
- Lint: PASS — `rtk pnpm --dir apps/web run lint`.
- Diff whitespace check: PASS — `rtk git diff --check`.

### Fix-round self-review and concerns

- Zero defaults remain valid; there is no automatic promotion or mandatory default.
- Tenant/member identity still comes only from server context. Service ownership checks fail closed, while SQL RLS supplies tenant isolation and the adapter preserves member isolation for default replacement.
- The Task 1 operator-allowlist minor remains resolved by the prior implementation; this fix did not expand that scope.
- The only verification limitation is the unavailable live PostgreSQL boundary described above. The working tree is otherwise ready for commit.
