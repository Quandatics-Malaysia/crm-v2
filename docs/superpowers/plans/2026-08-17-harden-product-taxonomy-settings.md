# Harden Product Taxonomy Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent taxonomy/product races and seed collisions, and make quotation defaults available from CRM Settings without finance entitlement.

**Architecture:** Serialize taxonomy reads and writes with a row lock on the authenticated tenant organization inside the existing tenant transaction. Keep generated seed codes deterministic by allocating a stable suffixed code against all existing category/subcategory codes. Split quotation defaults into a dedicated Settings documents route and retain finance-only invoicing picklists on the finance-gated route.

**Tech Stack:** Next.js 16 App Router, React Server/Client Components, Drizzle ORM/PostgreSQL, Vitest, pnpm.

## Global Constraints

- Use strict TDD: write each regression first, run it failing, implement minimally, then rerun it green.
- Use the installed Next.js documentation under `apps/web/node_modules/next/dist/docs/` for route/page/layout changes.
- Preserve `requireContext`, `assertCan`, `runInTenant`, and existing module/permission boundaries.
- Run the full web test suite, typecheck, lint, migration checks, and diff checks before committing.
- Update `.superpowers/sdd/2026-08-17-crm-sales-lifecycle-customization/task-7-report.md` with fix round 1/5 evidence.

---

### Task 1: Serialize taxonomy settings and product references

**Files:**
- Create: `apps/web/server/services/product-taxonomy-lock.ts`
- Modify: `apps/web/app/(app)/settings/actions.ts`
- Modify: `apps/web/app/(app)/products/actions.ts`
- Test: `apps/web/tests/product-taxonomy-concurrency.test.ts`

**Interfaces:**
- Consumes: `Tx`, authenticated tenant id, and existing tenant/product schema tables.
- Produces: `lockProductTaxonomy(tx, tenantId): Promise<void>` and a database-backed regression proving concurrent taxonomy removal cannot commit around a product create/update.

- [ ] **Step 1: Write the failing boundary test**

  Add a DB-gated Vitest test that opens two tenant transactions, blocks the first transaction after acquiring the product-taxonomy lock, starts the second transaction, and verifies the second transaction does not pass its lock boundary until the first commits. Use a dedicated test tenant and rollback/cleanup in the test utility.

- [ ] **Step 2: Run the boundary test to verify it fails**

  Run `pnpm --filter web exec vitest run tests/product-taxonomy-concurrency.test.ts`.
  Expected: the new test fails because no shared taxonomy lock exists.

- [ ] **Step 3: Implement the minimal shared lock**

  Add `lockProductTaxonomy` that selects the authenticated `organization.id` with `.for("update")` inside the caller’s existing `runInTenant` transaction and throws if the tenant row is absent. Call it before every taxonomy read used by `updateProductCodes`, `createProduct`, and `updateProduct`; retain all existing auth and tenant predicates.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run `pnpm --filter web exec vitest run tests/product-taxonomy-concurrency.test.ts` with PostgreSQL configured, or verify the test is the expected environment-gated skip without PostgreSQL.

- [ ] **Step 5: Run existing taxonomy/action tests**

  Run `pnpm --filter web exec vitest run tests/product-taxonomy.test.ts tests/module-action-entrypoints.test.ts`.

### Task 2: Make sample-seed generated subcategory codes collision-safe

**Files:**
- Create: `apps/web/server/services/product-taxonomy-seed.ts`
- Modify: `apps/web/db/seed-sample.ts`
- Test: `apps/web/tests/product-taxonomy.test.ts`

**Interfaces:**
- Consumes: nested tenant taxonomy and legacy product subcategory display names.
- Produces: deterministic code allocation that preserves an existing same-name mapping, otherwise chooses a normalized base plus `_2`, `_3`, etc. without colliding anywhere in the tenant taxonomy.

- [ ] **Step 1: Write failing collision/idempotence tests**

  Add tests showing a legacy display name whose normalized code is already used by another subcategory receives a deterministic suffix, a collision with another category is also avoided, and rerunning allocation returns the same taxonomy without adding duplicates.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run `pnpm --filter web exec vitest run tests/product-taxonomy.test.ts`.
  Expected: the new allocation assertions fail against the current seed-only inline generator.

- [ ] **Step 3: Implement and use one collision-safe allocator**

  Extract a pure allocator used by `seed-sample.ts`. Normalize the display name, reserve every existing category/subcategory code, return the existing code for an exact normalized display-name match, and otherwise append the first available numeric suffix within the 32-character limit. Keep product lookup by display name and preserve seed idempotency.

- [ ] **Step 4: Run focused tests to verify they pass**

  Run `pnpm --filter web exec vitest run tests/product-taxonomy.test.ts` and confirm the new cases pass.

### Task 3: Move quotation defaults to CRM Settings

**Files:**
- Create: `apps/web/app/(app)/settings/documents/page.tsx`
- Create: `apps/web/app/(app)/settings/documents/documents-client.tsx`
- Modify: `apps/web/app/(app)/settings/billing/invoicing/invoicing-client.tsx`
- Modify: `apps/web/app/(app)/settings/billing/invoicing/page.tsx`
- Modify: `apps/web/app/(app)/settings/_nav.ts`
- Modify: `apps/web/tests/module-page-entrypoints.test.ts`

**Interfaces:**
- Consumes: existing `getSettings`, `updateQuoteDefaults`, and shared quotation-default UI behavior.
- Produces: `/settings/documents`, permission-gated only by CRM tenant settings access; no duplicate quotation-default card; finance-only invoicing route retains payment terms, sales-order document kinds, and invoice reminders.

- [ ] **Step 1: Write the failing route/navigation tests**

  Add route-entrypoint coverage proving `/settings/documents` loads with finance disabled and that the finance-gated invoicing page still denies an unlicensed tenant. Add a navigation assertion for the Documents item and no duplicate quote-default ownership in the invoicing client.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run `pnpm --filter web exec vitest run tests/module-page-entrypoints.test.ts`.
  Expected: the documents route is missing or finance-gated, and the navigation/card ownership assertions fail.

- [ ] **Step 3: Implement the route split**

  Move the existing quote-default client card into `settings/documents`, load settings through the existing server action, remove it from Invoicing, and add a clear Billing/Finance navigation grouping without changing action-level authorization.

- [ ] **Step 4: Run focused route tests to verify they pass**

  Run `pnpm --filter web exec vitest run tests/module-page-entrypoints.test.ts`.

### Task 4: Report and full verification

**Files:**
- Modify: `.superpowers/sdd/2026-08-17-crm-sales-lifecycle-customization/task-7-report.md`

- [ ] **Step 1: Update the report with fix round 1/5**

  Record the concurrency boundary, collision-safe seed behavior, Documents route split, TDD RED/GREEN evidence, and exact verification results.

- [ ] **Step 2: Run the full verification set**

  Run `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web lint`, the repository migration compatibility/check commands, and `git diff --check`.

- [ ] **Step 3: Inspect the final diff and commit**

  Confirm no unrelated changes or untracked files remain, then commit with `fix: harden product taxonomy settings`.
