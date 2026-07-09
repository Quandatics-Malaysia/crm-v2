# CRM → Salesforce-parity re-layout — COMPLETE CHANGE-LIST (MVP scope)

**Scope decision (per owner):** the *entire current CRM is the MVP*. Payment Milestones are
pulled OUT of the disabled `projects` module and hand-built as a **core, funnel-attached**
feature. **No schema changes. No enabling the `projects`/`salesOrders`/`finance` modules.**
Everything is hand-typed using the app's existing components (`data-table`, `object-tile`,
`Card`/`Tabs`/`Field`, `StagePath`/`StageProgress`, `status-badge`, the `.link` class).

Reference layouts (highlights, field sections, related lists, list columns) are in
`phase1-salesforce-spec/SPEC.md` — one section per object. This file is the actionable checklist;
SPEC.md is the source of truth for *what each screen should contain*.

Legend:  ✅ done on branch `relayout-salesforce-parity`  ·  ⬜ to do  ·  ⚠️ needs `tsc`/DB to verify

---

## 0. Environment / verify (run on a machine with the toolchain)
- ⬜ `rm -f .git/index.lock` (a stale lock from the prior session; harmless but blocks commits)
- ⬜ `npm install`
- ⬜ Optionally add `.gitattributes` with `* text=auto eol=lf` to kill CRLF diff noise
- ⬜ After EACH object: `npm run typecheck` (`tsc --noEmit`) and fix any errors
- ⬜ Start Postgres (Docker) + `npm run dev`, log in `admin@demo.local / Password`, eyeball each
      screen against the matching SPEC.md section (and the live Salesforce org)

## 1. Dashboard — ✅ done (calibration piece)
- ✅ `app/(app)/dashboard/page.tsx` restructured into the two-column SF home shape:
      **Salesperson's Activity** (Follow-ups Due) | **Salesperson's Funnels** (Approvals,
      Overdue Invoices, Stale Funnels), with a `ColumnHeading` banner per column; existing data only.
- ⬜ *(Optional, deferred — needs new aggregate queries in `dashboard/actions.ts` + a `recharts`
      chart)* the two SF bar charts — **funnel amount by owner × sales stage** and **closed deals
      by product category** — plus **recently-viewed** lists and a **sales-activity-by-month** chart.
      Sketch: group `funnels` by `ownerMemberId` + stage summing `amount`; group quote/deal lines by
      product category summing amount. Add a `DashboardCharts` client component using `@/components/ui/chart`.

## 2. List-view columns
- ✅ Leads `leads/leads-table.tsx` — added **Mobile** (`phone`), Owner moved before Source →
      Name · Company · Mobile · Email · Status · Owner · (Source · Stage · Converted · Created)
- ✅ Products `products/products-table.tsx` — added **Description** after Name
- ✅ Funnel `funnel/funnels-table.tsx` — Name · Account · **Est. funnel amount** · **Est. close date**
      · **Sales stage** · Owner · Status
- ✅ Contacts `persons/persons-table.tsx` — Email moved above Title
- ✅ Accounts `accounts/accounts-table.tsx` — Owner moved up after Name
- ⬜ Opportunities `opportunities/opportunities-table.tsx` — SF shows only the Opportunity number;
      our table (Code · Opportunity · Account · Owner · Funnels · Est. funnel amount) is a superset.
      Keep as-is, OR lead with **Opportunity** (name/number) + **Account** + **Total Estimated Funnel
      Amount** to mirror the SF "Opportunities" list more closely. (SPEC §3)
- ⬜ Quotations list (`quotations/page.tsx` / quotations table component) — target columns
      (SPEC §5): **Quote Name · Funnel Name · Synced · Line Items (count) · Ref No · Total Excluding
      Tax · Tax Amount · Total Including Tax**. Reorder/rename existing columns to this; add a
      count/synced column only if the row type already carries it (no schema change).

## 3. Detail-body field-section regrouping (rename sections + reorder existing fields + tab sets)
> The app is already SF-shaped (two-column detail, `Field`, `RelatedQuickLinks`, `StagePath`,
> tabbed `DataTable`). Work = section NAMES, field ORDER, TAB labels to match SPEC. Move existing
> fields only; if a Salesforce field has no column in our schema (e.g. Marketing Event, Power
> Sponsor Budget Limit), **omit it — do not add schema.**

- ✅ Product `products/product-detail-body.tsx` — sections **Product Information** /
      **Description Information**, SF field order, added **Active** field. (SPEC §8) — reference example.
- ⬜ Lead `leads/[id]/lead-detail-body.tsx` (SPEC §2) — tabs **Company Information** /
      **Lead Information** / **Remarks**; highlights: Full Mobile Number · Email · Lead Designation ·
      Lead Department · Company · Request Approval For. Path Unqualified→Working→Nurturing→Converted.
- ⬜ Account `accounts/[id]/account-detail-body.tsx` (SPEC §6) — sections **Account Information** +
      **Address Information**; tabs Contacts/Opportunities/Funnels/Contracts.
- ⬜ Contact `persons/[id]/person-detail-body.tsx` (SPEC §7) — section **Contact Information**;
      highlights Contact Designation · Department · Number · Email · Account.
- ⬜ Opportunity `opportunities/[id]/opportunity-detail-body.tsx` (SPEC §3) — tabs **Opportunity Info**
      / **Analysis** (PPVVC: 1-P Power Sponsor · 2-P Pain · 3-V Vision · 4-V Value · 5-C Control) /
      **Funnels** / **Remarks**.
- ⬜ Funnel `funnel/[id]/funnel-detail-body.tsx` (SPEC §4) — already the richest match. Optional:
      rename Details sections to **Opportunity Information** / **Funnel Info** / **Procurement Process
      (PP)**; ADD the **Payment Milestones** related tab (see §4).
- ⬜ Quote `quotations/[id]/page.tsx` + `[id]/preview/page.tsx` (SPEC §5) — section **Quote Information**;
      Quote Line Items grid columns → Product · Product Category · Description · UOM · Quantity ·
      Unit Price · Item Discount · Sub-total.

## 4. Payment Milestone → CORE MVP (decouple from the `projects` module)  ⬜
**Why it's feasible with no schema change:** `db/schema/billing.ts` `paymentMilestones` already has
`funnelId` (nullable `projectId`) and every SF field: `title`, `amount`, `dueDate`, `status`
(pending→invoiced→paid), `invoiceNumber`, `invoiceDate`, `expectedInvoiceMonth/Year`, `soNumber`,
`productCategory`, `productSubcategory`, `splitPercentage`, `quotationId`. The Salesforce importer
already maps `Payment_Milestone__c` → `payment_milestones` (`db/import/mapping.ts`).
Today the ONLY payment-milestone UI is `projects/[id]/milestones-panel.tsx`, and every milestone
query in `projects/actions.ts` is wrapped in `withModule("projects")`, so with `projects:false`
it's invisible. We add a **funnel-scoped, un-gated** path alongside it.

Do NOT modify `modules.config.ts`. Do NOT modify the schema. Steps:

1. **Permission (core, not module-gated).** In `lib/permissions.ts` add `PAYMENT_MILESTONE_VIEW`
   (and `_MANAGE` if you want create/edit). Model it on an existing core perm — **do NOT set
   `module: "projects"`** on it (contrast the project perm at ~L214 which does). Grant it to the
   same roles that already have `FUNNEL_VIEW`.
2. **Actions — `app/(app)/payment-milestones/actions.ts`** (NEW). Use `runInTenant`/`db` like
   `dashboard/actions.ts`; **no `withModule`**. Provide:
   - `listPaymentMilestones()` → all tenant milestones (for the nav list view)
   - `listFunnelMilestones(funnelId)` → milestones where `funnelId = ?` (for the Funnel tab)
   - `getPaymentMilestone(id)` → one milestone + resolved funnel/quote names for the detail page
   - (optional) `create/update/deleteMilestone` mirroring `projects/actions.ts` but WITHOUT the
     module guard and keyed by `funnelId`.
   Gate reads with `ctx.can(PERMISSIONS.PAYMENT_MILESTONE_VIEW)`.
3. **Funnel related tab (matches SF Funnel "Payment Milestones" tab).**
   - `funnel/[id]/page.tsx`: call `listFunnelMilestones(funnelId)` and pass to the body.
   - `funnel/[id]/funnel-detail-body.tsx`: add a `milestones` prop, a **Payment Milestones** tab
     (a `DataTable` with columns Name · Amount · Status · Invoice Number · Invoice Date), and a
     `RelatedQuickLinks` entry `{ kind: "milestone", label: "Payment Milestones", count, onSelect }`.
4. **Standalone nav + list (matches SF "Payment Milestones" nav tab).**
   - `app/(app)/payment-milestones/page.tsx` + `payment-milestones-table.tsx` — one column
     **Payment Milestone Name** (`title`) per SPEC §9; `DataTable`, `ObjectTile kind="milestone"`.
   - `components/app-sidebar.tsx`: add a nav item **Payment Milestones** under the CRM/Sales section,
     `permission: PERMISSIONS.PAYMENT_MILESTONE_VIEW` (NOT `module`-gated). Tile `bg-yellow-600`
     (already the milestone colour in `object-tile.tsx`).
5. **Detail page — `app/(app)/payment-milestones/[id]/page.tsx` + `payment-milestone-detail-body.tsx`**
   (NEW). SF layout (SPEC §9): highlights **Quote Number · Invoice Number · Amount · Actual Invoice
   Date · Payment Received?**; an **Invoice status path** pending→invoiced→paid (reuse
   `StageProgress`/`status-badge`); section **Payment Milestone** (Name · Funnel link · Product
   Category · Product Subcategory · SO Number · Quote · Project Code) + **Invoice Details** + **Remarks**;
   `RelatedQuickLinks` (Notes · Files · History).
6. Leave `projects/[id]/milestones-panel.tsx` and the project-scoped milestone actions untouched
   (they stay behind the projects module). The new path is additive and funnel-scoped.
7. ⚠️ `npm run typecheck`; then verify /payment-milestones and the Funnel tab render with seeded data.

## 5. Hard constraints (unchanged)
- No DB schema / data-model changes anywhere.
- Do NOT enable any module in `modules.config.ts` (`projects`, `salesOrders`, `finance`, `forecast`,
  `audit`, `advancedRoles` stay OFF).
- Read the custom-Next.js guides in `node_modules/next/dist/docs` before writing Next code, and heed
  deprecations (AGENTS.md).
- Reuse the existing component library + theme; match structure/spacing/section names, not SF's raw CSS.
- `npx tsc --noEmit` after each object; work on a branch; don't push/PR unless asked.

## 6. Files already changed on branch `relayout-salesforce-parity`
`app/(app)/dashboard/page.tsx`, `app/(app)/leads/leads-table.tsx`,
`app/(app)/products/products-table.tsx`, `app/(app)/funnel/funnels-table.tsx`,
`app/(app)/persons/persons-table.tsx`, `app/(app)/accounts/accounts-table.tsx`,
`app/(app)/products/product-detail-body.tsx`. (Nothing committed; verify with `git --no-optional-locks diff`.)
