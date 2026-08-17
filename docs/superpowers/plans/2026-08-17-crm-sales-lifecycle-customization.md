# CRM Sales Lifecycle Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed per-user list views and align Account, Lead, Opportunity, Funnel, Product, Quotation, and Payment Milestone behavior with the approved sales lifecycle.

**Architecture:** Extend shared table metadata and tenant-scoped settings first, then centralize PPVVC and state transitions in pure/service modules used by both UI and server actions. Ship additive database migrations before applying stricter application rules. Preserve legacy pipeline and finance history while preventing new writes through obsolete flows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL 17, Zod, TanStack Table, Vitest, pnpm.

## Global Constraints

- Read `apps/web/node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, `forms.md`, and `data-security.md` before editing Server Actions or forms.
- Run shell commands through `rtk`; use `rtk proxy` only when raw output is required.
- Use `apply_patch` for edits.
- Preserve tenant RLS and derive organization/member ownership from authenticated server context.
- Keep legacy pipelines and finance documents readable; do not delete historical data.
- Opportunity code/name format is `ORGCODEOPP-YYYY-NNNN`.
- PPVVC order is Pain, Power, Vision, Value, Control.
- Closed Won and Closed Lost are immutable.
- Quotation acceptance never changes Funnel stage.
- No Project module integration.
- Each task starts with a failing test and ends with focused verification and a commit.

---

## File structure

- `apps/web/lib/data-table-filters.ts`: typed filter definitions, validation, and pure predicates.
- `apps/web/components/data-table.tsx`: filter controls, URL state, and saved-view integration point.
- `apps/web/db/schema/saved-views.ts`: per-member saved-view persistence.
- `apps/web/app/(app)/_shared/saved-view-actions.ts`: authenticated saved-view CRUD.
- `apps/web/lib/ppvvc.ts`: canonical PPVVC metadata and completion helpers.
- `apps/web/server/services/ppvvc.ts`: transactional Opportunity/Funnel synchronization.
- `apps/web/lib/quotation-transitions.ts`: pure quotation state machine.
- Existing domain forms/actions remain responsible for page-specific orchestration.

### Task 1: Typed filter engine

**Files:**
- Create: `apps/web/lib/data-table-filters.ts`
- Create: `apps/web/tests/data-table-filters.test.ts`
- Modify: `apps/web/components/data-table.tsx`

**Interfaces:**
- Produces: `DataTableFilterDefinition`, `DataTableFilterValue`, `validateFilterValue()`, `matchesFilter()`.
- `DataTableFilterDefinition` is a discriminated union for `text | number | money | date | boolean | enum | relation`.

- [ ] **Step 1: Write failing pure-function tests**

Cover text contains/equals/starts-with; numeric equals/greater-than/less-than/between; date on/before/after/between; boolean; enum multi-select; relation ID matching; invalid ranges.

```ts
expect(matchesFilter("Alpha Beta", { type: "text", operator: "contains", value: "beta" })).toBe(true)
expect(matchesFilter(15, { type: "number", operator: "between", min: 10, max: 20 })).toBe(true)
expect(validateFilterValue({ type: "date", operator: "between", from: "2026-08-20", to: "2026-08-10" }).success).toBe(false)
```

- [ ] **Step 2: Run failing test**

Run: `rtk pnpm --filter web test -- data-table-filters.test.ts`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement filter union and predicates**

Use explicit operator unions. Treat empty values as inactive. Parse dates as ISO calendar dates and reject `NaN`, inverted ranges, and non-finite numbers.

- [ ] **Step 4: Integrate filter metadata into `DataTable`**

Replace `DataTableFacet` with backwards-compatible `filters?: DataTableFilterDefinition[]`. Render datatype-specific controls, preserve typed values as encoded JSON URL parameters, and continue reading legacy `f_<column>` facet parameters.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm --filter web test -- data-table-filters.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add typed data table filters`

### Task 2: Per-user named saved views

**Files:**
- Create: `apps/web/db/schema/saved-views.ts`
- Modify: `apps/web/db/schema/index.ts`
- Create: `apps/web/db/migrations/0076_saved_views.sql`
- Modify: `apps/web/db/migrations/meta/_journal.json`
- Create: `apps/web/app/(app)/_shared/saved-view-actions.ts`
- Create: `apps/web/components/saved-view-menu.tsx`
- Modify: `apps/web/components/data-table.tsx`
- Create: `apps/web/tests/saved-views.test.ts`

**Interfaces:**
- Produces: `listSavedViews(listKey)`, `saveView(input)`, `renameView(id, name)`, `duplicateView(id, name)`, `setDefaultView(id)`, `deleteView(id)`.
- Saved payload: `{ filters, sorting, visibility, pageSize }`, validated before persistence.

- [ ] **Step 1: Write schema/action contract tests**

Assert organization/member columns, unique `(organization_id, member_id, list_key, name)`, one default per member/list, owner-only update/delete, and invalid payload rejection.

- [ ] **Step 2: Run failing test**

Run: `rtk pnpm --filter web test -- saved-views.test.ts`
Expected: FAIL because schema/actions do not exist.

- [ ] **Step 3: Add schema and migration**

Create `saved_views` with UUID ID, organization/member IDs, list key, name, JSONB payload columns, `is_default`, timestamps, tenant/member indexes, uniqueness constraints, and RLS matching current tenant helper patterns.

- [ ] **Step 4: Implement authenticated CRUD**

Use server context for owner fields. Wrap `setDefaultView` in a transaction that clears the prior default for the same member/list before setting the selected row.

- [ ] **Step 5: Add saved-view menu**

Expose select, save, rename, duplicate, set default, delete, and base-view reset. Applying a view replaces table state and URL state. Ignore stale columns and show one warning toast.

- [ ] **Step 6: Wire every shared DataTable caller**

Assign stable `tableId`/list keys to Accounts, Persons, Leads, Opportunities, Funnels, Products, Quotations, Projects, Sales Orders, Payment Milestones, Billing, and Intercompany lists. Convert existing facets to typed enum/relation/boolean definitions.

- [ ] **Step 7: Verify and commit**

Run: `rtk pnpm --filter web test -- saved-views.test.ts data-table-filters.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add per-user saved list views`

### Task 3: Account currency and Lead simplification

**Files:**
- Modify: `apps/web/db/schema/crm.ts`
- Modify: `apps/web/db/schema/rbac.ts`
- Create: `apps/web/db/migrations/0077_account_currency.sql`
- Modify: `apps/web/app/(app)/accounts/actions.ts`
- Modify: `apps/web/app/(app)/accounts/account-form.tsx`
- Modify: `apps/web/app/(app)/accounts/[id]/account-detail-body.tsx`
- Modify: `apps/web/app/(app)/leads/lead-form.tsx`
- Modify: `apps/web/app/(app)/leads/actions.ts`
- Modify: `apps/web/app/(app)/leads/page.tsx`
- Modify: `apps/web/server/services/conversion.ts`
- Create: `apps/web/tests/account-lead-rules.test.ts`

**Interfaces:**
- Account input adds `currency: string` validated against `tenantSettings.currencies`.
- Lead create/update input no longer exposes `pipelineId` or `currentStageId`.

- [ ] **Step 1: Write failing rule tests**

Assert Account rejects unconfigured/free-text currency, defaults from tenant currency, Lead form/action omits Funnel/Stage, and conversion resolves default Sales Funnel plus first OPEN stage.

- [ ] **Step 2: Run failing test**

Run: `rtk pnpm --filter web test -- account-lead-rules.test.ts`

- [ ] **Step 3: Add and backfill Account currency**

Add required `char(3)` Account currency. Migration backfills from each organization's tenant default, falling back to `MYR`, then sets NOT NULL.

- [ ] **Step 4: Update Account UI/actions**

Load configured currencies, render Select only, display currency on detail/list, and default new Opportunity/Quotation forms from Account while allowing another configured selection.

- [ ] **Step 5: Remove Lead Funnel/Stage UI and payload**

Keep nullable legacy DB columns. Delete form fields, lookup loading, validation, and create/update writes. Conversion uses one shared default Sales Funnel resolver.

- [ ] **Step 6: Lock new pipeline configuration**

Rename seeded/default pipeline consistently to `Sales Funnel`. Remove pipeline creation/edit controls; retain legacy pipeline display for records already assigned.

- [ ] **Step 7: Verify and commit**

Run: `rtk pnpm --filter web test -- account-lead-rules.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: simplify lead funnel defaults and add account currency`

### Task 4: Opportunity naming and 4A project-code timing

**Files:**
- Modify: `apps/web/lib/opportunity-code.ts`
- Modify: `apps/web/server/services/opportunity-container.ts`
- Modify: `apps/web/app/(app)/opportunities/actions.ts`
- Modify: `apps/web/app/(app)/opportunities/opportunities-table.tsx`
- Modify: `apps/web/server/services/stage.ts`
- Create: `apps/web/db/migrations/0078_opportunity_name_project_code.sql`
- Modify: `apps/web/tests/opportunity-code.test.ts`
- Create: `apps/web/tests/project-code-stage.test.ts`

**Interfaces:**
- `formatOpportunityCode({ organizationCode, year, number }): string` returns `QMOPP-2026-0001`.
- `ensureOpportunityProjectCode(tx, opportunityId, context): Promise<string>` is idempotent.

- [ ] **Step 1: Replace old code tests with approved format tests**

Test normalization, year, zero-padding, missing organization-code rejection, and `name === code` creation behavior.

- [ ] **Step 2: Add failing 4A timing tests**

Assert Opportunity creation leaves `projectCode = null`; entering `4A` assigns once; rollback/re-entry preserves value; stages before `4A` do not assign; no Project row is created.

- [ ] **Step 3: Implement Opportunity code/name equality**

Generate code from organization code and assign same value to both fields. Remove independent Opportunity-name editing and duplicate table columns.

- [ ] **Step 4: Move project-code generation into stage transaction**

Remove call from Opportunity creation. On target stage code `4a`, lock Opportunity and allocate only when null. Do not import or mutate Project module code.

- [ ] **Step 5: Add migration**

Set existing Opportunity names to existing codes. Preserve all existing non-null project codes; do not renumber old opportunities.

- [ ] **Step 6: Verify and commit**

Run: `rtk pnpm --filter web test -- opportunity-code.test.ts project-code-stage.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: align opportunity and project code timing`

### Task 5: PPVVC synchronization and grouped UI

**Files:**
- Create: `apps/web/lib/ppvvc.ts`
- Create: `apps/web/server/services/ppvvc.ts`
- Modify: `apps/web/app/(app)/opportunities/actions.ts`
- Modify: `apps/web/app/(app)/funnel/actions.ts`
- Create: `apps/web/components/ppvvc-editor.tsx`
- Modify: `apps/web/app/(app)/opportunities/[id]/opportunity-detail-body.tsx`
- Modify: `apps/web/app/(app)/funnel/[id]/funnel-detail-body.tsx`
- Modify: `apps/web/app/(app)/funnel/funnels-board.tsx`
- Modify: `apps/web/app/(app)/funnel/stage-advance-dialog.tsx`
- Modify: `apps/web/lib/api-readers.ts`
- Create: `apps/web/tests/ppvvc-sync.test.ts`

**Interfaces:**
- `PPVVC_FIELDS = [{ key: "pain", number: 1, label: "Pain" }, ...] as const`.
- `updateOpportunityPpvvc(tx, { opportunityId, values, actorId })` updates source and all live children atomically.

- [ ] **Step 1: Write failing metadata/sync tests**

Assert exact 1-Pain, 2-Power, 3-Vision, 4-Value, 5-Control order; Opportunity-side edit cascade; Funnel-side edit resolves parent and cascades; deleted children remain untouched; stage gate reads source row.

- [ ] **Step 2: Implement shared PPVVC metadata and service**

Keep Opportunity authoritative. Funnel action must never update one child PPVVC row directly.

- [ ] **Step 3: Add shared editor**

Render five numbered sections with textareas, save state, validation, and completion badges. Use same component on Opportunity and Funnel details.

- [ ] **Step 4: Enhance board and stage dialog**

Extend board payload with Opportunity ID and PPVVC completion. Show five compact badges. Badge click and missing stage requirement open inline editor with current values.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm --filter web test -- ppvvc-sync.test.ts stage-gate.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add grouped bidirectional PPVVC editing`

### Task 6: Reversible Funnel stages with terminal locks

**Files:**
- Modify: `apps/web/lib/stage-gate.ts`
- Modify: `apps/web/app/(app)/funnel/stage-transitions.ts`
- Modify: `apps/web/server/services/stage.ts`
- Modify: `apps/web/app/(app)/funnel/stage-advance-dialog.tsx`
- Modify: `apps/web/app/(app)/funnel/stage-reopen-dialog.tsx`
- Modify: `apps/web/tests/stage-gate.test.ts`

**Interfaces:**
- `canTransition(from, to)` allows any nonterminal source to any different OPEN/PARKED target; WON/LOST sources allow none.
- Stage requirements apply only when target order is forward.

- [ ] **Step 1: Rewrite failing transition matrix tests**

Cover OPEN backward, OPEN forward, KIV to OPEN, OPEN to KIV, WON blocked, LOST blocked, rollback bypassing requirements, and forward movement after rollback revalidating entered stages.

- [ ] **Step 2: Implement one shared transition policy**

Make client helper delegate to the same pure rule used by server guard. Remove Closed Lost reopen path and old KIV-terminal assumption.

- [ ] **Step 3: Update stage UI**

Label backward actions `Move back`; show no gate form for rollback; retain gate and approval UI for forward movement.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm --filter web test -- stage-gate.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: allow safe funnel stage rollback`

### Task 7: Nested Product taxonomy and quotation defaults

**Files:**
- Modify: `apps/web/db/schema/rbac.ts`
- Create: `apps/web/db/migrations/0079_product_taxonomy_quote_defaults.sql`
- Modify: `apps/web/app/(app)/settings/actions.ts`
- Modify: `apps/web/app/(app)/settings/taxonomy/product-codes/product-codes-client.tsx`
- Modify: `apps/web/app/(app)/settings/billing/invoicing/invoicing-client.tsx`
- Modify: `apps/web/app/(app)/products/product-form.tsx`
- Modify: `apps/web/app/(app)/products/actions.ts`
- Modify: `apps/web/app/(app)/products/[id]/product-detail-body.tsx`
- Create: `apps/web/tests/product-taxonomy.test.ts`

**Interfaces:**
- `ProductCategory = { code: string; name: string; subcategories: { code: string; name: string }[] }`.
- Tenant Settings add `quoteDefaultNotes`, `quoteDefaultDelivery`, `quoteDefaultPaymentTerm`.

- [ ] **Step 1: Write failing taxonomy/default tests**

Test duplicate codes, subcategory ownership, invalid Product category/subcategory pairs, removal protection for in-use values, and quotation-default length limits.

- [ ] **Step 2: Migrate settings data**

Transform each existing `{code,name}` category to `{code,name,subcategories:[]}`. Collect existing Product subcategory strings under their current category using normalized generated codes; preserve displayed names.

- [ ] **Step 3: Build nested Settings editor**

Support Category and nested Subcategory add/edit/archive. Validate unique codes case-insensitively.

- [ ] **Step 4: Replace Product free text**

Use dependent Select controls in create/edit/detail. Server validates pair against Settings.

- [ ] **Step 5: Add quotation default fields to Settings**

Persist and expose Notes, Delivery, and Payment Term defaults with explicit maximum lengths.

- [ ] **Step 6: Verify and commit**

Run: `rtk pnpm --filter web test -- product-taxonomy.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add nested product taxonomy and quote defaults`

### Task 8: Quotation content snapshots and Attention contact

**Files:**
- Modify: `apps/web/db/schema/quotations.ts`
- Create: `apps/web/db/migrations/0080_quotation_content_fields.sql`
- Modify: `apps/web/app/(app)/quotations/actions.ts`
- Modify: `apps/web/app/(app)/quotations/new/page.tsx`
- Modify: `apps/web/app/(app)/quotations/[id]/page.tsx`
- Modify: `apps/web/app/(app)/quotations/quotation-create-form.tsx`
- Modify: `apps/web/app/(app)/quotations/quotation-form.tsx`
- Modify: `apps/web/app/(app)/quotations/[id]/preview/page.tsx`
- Modify: `apps/web/app/(app)/quotations/[id]/preview/external-quotation-document.tsx`
- Modify: `apps/web/tests/entity-quotation-document.test.ts`

**Interfaces:**
- Quotation adds nullable `attentionContactId`, `delivery`, and `paymentTerm`.
- `getQuotationFormMeta(funnelId)` returns recipient-scoped contacts plus tenant defaults.

- [ ] **Step 1: Add failing form/document tests**

Assert new quotation seeds Notes/Delivery/Payment Term, values remain editable snapshots, Attention defaults to primary recipient contact, cross-account contact is rejected, and built-in/external template contexts render saved values.

- [ ] **Step 2: Add schema and migration**

Add fields and tenant-safe contact validation in server actions. Backfill fields as null without fabricating historical content.

- [ ] **Step 3: Update forms and document payloads**

Load contacts from selected recipient account only. Preserve current product-description copy/edit behavior and add a regression assertion for it.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm --filter web test -- entity-quotation-document.test.ts quotation-template-renderer.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add quotation terms and attention contact`

### Task 9: Quotation approval state machine

**Files:**
- Modify: `apps/web/db/schema/quotations.ts`
- Modify: `apps/web/lib/permissions.ts`
- Create: `apps/web/lib/quotation-transitions.ts`
- Create: `apps/web/db/migrations/0081_quotation_approval.sql`
- Modify: `apps/web/app/(app)/quotations/actions.ts`
- Modify: `apps/web/app/(app)/quotations/quotation-form.tsx`
- Create: `apps/web/tests/quotation-transitions.test.ts`
- Create: `apps/web/tests/quotation-approval-actions.test.ts`

**Interfaces:**
- Add permission `quotation.approve`.
- Actions: `submitQuotationForApproval(id)`, `approveQuotation(id)`, `rejectQuotation(id, reason)`, `returnApprovedQuotationToDraft(id)`.

- [ ] **Step 1: Write failing transition tests**

Cover Draft to Pending Approval, approval/rejection, Approved to Sent, direct Draft to Sent rejection, edit reset, customer Accept/Reject from Sent only, and acceptance leaving Funnel stage unchanged.

- [ ] **Step 2: Add schema/permission migration**

Extend enum with `pending_approval` and `approved`; add approver ID, approved timestamp, rejection reason; seed permission into default authorized roles using existing permission migration pattern.

- [ ] **Step 3: Implement transactional actions**

Lock quote row, enforce current state and permission, write audit event, and revalidate affected routes. Delete quote-accept auto-Won behavior.

- [ ] **Step 4: Update UI**

Show Submit, Approve, Reject, Send, Accept, Reject Customer, and Edit as Draft only when allowed. Approved content is read-only until explicit reset.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm --filter web test -- quotation-transitions.test.ts quotation-approval-actions.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: require quotation approval before send`

### Task 10: Quotation revisions

**Files:**
- Modify: `apps/web/db/schema/quotations.ts`
- Create: `apps/web/db/migrations/0082_quotation_revisions.sql`
- Modify: `apps/web/app/(app)/quotations/actions.ts`
- Modify: `apps/web/app/(app)/quotations/quotation-form.tsx`
- Modify: `apps/web/app/(app)/funnel/[id]/funnel-detail-body.tsx`
- Create: `apps/web/tests/quotation-revisions.test.ts`

**Interfaces:**
- `createQuotationRevision(sourceQuotationId): Promise<{ id: string; quoteNumber: string }>`.
- Quotation adds nullable self-reference `revisionOfId`.

- [ ] **Step 1: Write failing revision tests**

Assert eligibility for Sent/Accepted/Rejected/Expired/Void/deleted sources, Draft rejection, copied header/terms/contact/lines, incremented version/number, source immutability, recipient/contact revalidation, and concurrent revision numbering safety.

- [ ] **Step 2: Add lineage field and index**

Add `revision_of_id` self-reference with `ON DELETE SET NULL` and index. Do not cascade source deletion.

- [ ] **Step 3: Implement transactional clone**

Read soft-deleted source explicitly under tenant scope; allocate next version; copy all approved fields and line snapshots; set new status Draft, clear approval/customer timestamps, and write audit event.

- [ ] **Step 4: Add Revision actions in UI**

Expose from eligible quote detail/history and Funnel quotation table. Redirect to new Draft.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm --filter web test -- quotation-revisions.test.ts quote-number.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: add quotation revision workflow`

### Task 11: Payment Milestone decoupling

**Files:**
- Modify: `apps/web/db/schema/billing.ts`
- Modify: `apps/web/db/schema/finance.ts`
- Create: `apps/web/db/migrations/0083_payment_milestone_decoupling.sql`
- Modify: `apps/web/app/(app)/payment-milestones/actions.ts`
- Modify: `apps/web/app/(app)/payment-milestones/payment-milestone-detail-body.tsx`
- Modify: `apps/web/app/(app)/payment-milestones/payment-milestones-table.tsx`
- Modify: `apps/web/components/milestones-panel.tsx`
- Modify: `apps/web/app/(app)/billing/actions.ts`
- Modify: `apps/web/server/services/finance.ts`
- Modify: `apps/web/server/services/stage.ts`
- Create: `apps/web/tests/payment-milestone-lifecycle.test.ts`

**Interfaces:**
- Milestone status is `won | invoiced` only.
- Closed Won transition sets live milestones to `won`; user action may set `won -> invoiced`.

- [ ] **Step 1: Write failing lifecycle and decoupling tests**

Assert milestones may exist before close, Closed Won sets Won, manual Won to Invoiced, backward status rejection, no invoice creation/link mutation, no finance tab, and no Project completion side effect.

- [ ] **Step 2: Add compatibility migration**

Map `pending` to `won`; map `invoiced` and `paid` to `invoiced`. Preserve historical invoice fields/foreign keys as deprecated nullable columns for read compatibility, but remove all new application writes and UI exposure.

- [ ] **Step 3: Remove finance coupling**

Delete `createInvoiceFromMilestone` entry points, milestone claim/update side effects in billing actions, and milestone-driven Project completion. Finance documents remain independently usable.

- [ ] **Step 4: Simplify milestone UI**

Show planning fields plus Won/Invoiced status only. Remove invoice number/date, expected invoice dates, Finance Docs tab, and invoice links.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm --filter web test -- payment-milestone-lifecycle.test.ts milestone-split.test.ts so-milestones.test.ts && rtk pnpm --filter web typecheck`
Commit: `feat: decouple payment milestones from invoicing`

### Task 12: Full integration, documentation, and release

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/release-log.md`
- Modify: `apps/web/app/documentation/content-sales.tsx`
- Modify: `apps/web/app/documentation/content-reference.tsx`
- Modify: `apps/web/db/migrations/meta/_journal.json`

**Interfaces:**
- No new runtime interface; this task validates all prior interfaces together.

- [ ] **Step 1: Run migration-chain and focused test suite**

Run: `rtk pnpm --filter web test`
Expected: all tests pass.

- [ ] **Step 2: Run static verification**

Run: `rtk pnpm --filter web lint && rtk pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 3: Run production build**

Run: `rtk pnpm build`
Expected: successful production build.

- [ ] **Step 4: Review migration safety and diff**

Run migration tests, `rtk git diff --check`, and cavecrew review. Resolve every blocker or high-severity finding.

- [ ] **Step 5: Update user/developer documentation**

Document saved views, Settings taxonomy/defaults, PPVVC editing, stage rollback, quotation approval/revisions, milestone statuses, migration order, rollback behavior, and permission assignment.

- [ ] **Step 6: Commit integration changes**

Commit: `docs: document CRM sales lifecycle workflows`

- [ ] **Step 7: Publish**

Push feature branch, open PR, run required checks, merge only after green checks, deploy production from `main`, approve protected environment, and smoke-test live pages.
