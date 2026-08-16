# CRM Task 2 Report

Status: complete

## Delivered

- Added `GET` and `PATCH /api/v1/quotation-templates/default` for the authenticated tenant.
- PATCH accepts a normalized active template code or `null` to clear the tenant default.
- Added tenant-scoped quotation-default read/update helpers and request schema.
- Documented default API curl calls and precedence: account override, tenant default, legacy fallback.

## TDD and verification

- RED: focused route suite failed because `api/v1/quotation-templates/default/route` did not exist.
- GREEN: `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts` — 14 passed.
- `rtk pnpm --dir apps/web run typecheck` — passed.
- `rtk git diff --check` — passed.

## Self-review

- Confirmed default read/write and active-template lookup carry `ctx.tenantId` and run in `withApiTenant`.
- Confirmed existing quotation resolution keeps account override before tenant default.
- Task 1 files unchanged.

## Commit

- `feat: expose tenant quotation default API`

## Concerns

- Full suite, lint, and build remain Task 3 scope.
- The repository-local checklist required by the optional `review` workflow is absent; manual review completed instead.

## Fix round 1

- Root cause: tenant-default writes used `UPDATE`, which silently affected zero rows when `tenant_settings` was absent. Template deactivation paths did not clear a matching tenant default.
- Changed tenant-default write to tenant-scoped `INSERT ... ON CONFLICT DO UPDATE`.
- Clear the matching tenant default inside the same tenant transaction after template PATCH deactivation or DELETE.
- RED: `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts` — 3 expected failures: missing settings returned `null`; PATCH/DELETE each performed one update.
- GREEN: `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts` — 17 passed.
- `rtk pnpm --dir apps/web run typecheck` — passed.

## Fix round 2

- Root cause: default PATCH validated an active template without a row lock, allowing concurrent template deactivation to clear the default before a stale PATCH upsert restored the inactive code.
- Added tenant-scoped `SELECT ... FOR UPDATE` revalidation before the default upsert. Template deactivation/delete updates already lock the same template row, so both operations now serialize in one tenant transaction.
- RED: `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts` — 2 expected failures: locked helper missing; stale revalidation returned 200.
- GREEN: `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts` — 19 passed.
- `rtk pnpm --dir apps/web run typecheck` — passed.
