# Paste this into a Claude Code session opened in `crm-v2`

You are working in this repo (`crm-v2`), a **custom fork of Next.js 16** — its APIs and conventions
differ from stock Next, so **read `AGENTS.md` and the guides in `node_modules/next/dist/docs/`
before writing any Next code**, and heed deprecation notices.

## Goal
Finish making our CRM's list views, detail layouts, related lists, and the home dashboard
"more or less" match our Salesforce reference org, using OUR existing components/theme. This is a
**RE-LAYOUT, not a re-platform.** Treat the **entire current CRM as the MVP**, including Payment
Milestones (which must be pulled out of the disabled `projects` module and hand-built as a core,
funnel-attached feature).

## Read these first (already in the repo)
- `phase1-salesforce-spec/SPEC.md` — the Salesforce reference, one section per object (Dashboard,
  Lead, Opportunity, Funnel, Quote, Account, Contact, Product, Payment Milestone, Quote Line Item):
  highlights panels, field sections + order, related lists, and list-view columns.
- `phase1-salesforce-spec/CHANGE-LIST.md` — the actionable checklist (✅ done / ⬜ to do), with
  per-file instructions. **Work through the ⬜ items.** Section §4 is the Payment Milestone decoupling.

> **No screenshot files exist.** The browser tool couldn't save images, so `SPEC.md` (text) is the
> visual source of truth. For a live pixel reference open the Salesforce org yourself —
> `https://connect-momentum-5641.lightning.force.com`, app "Quandatics Sales" (a Claude Code session
> can't browse it; use it during calibration). `phase1-salesforce-spec/screenshots/` is intentionally empty.

## Hard constraints (do not violate)
1. **No database schema or data-model changes.** UI only (which fields show, sections, related lists,
   list columns, dashboard cards).
2. **Do NOT enable any module** in `modules.config.ts` — `projects`, `salesOrders`, `finance`,
   `forecast`, `audit`, `advancedRoles` stay OFF. Payment Milestones must work as CORE without the
   `projects` module (see CHANGE-LIST §4 — the `payment_milestones` table already has `funnelId`
   and all needed columns, so no schema change and no module flip is required).
3. Reuse existing shared building blocks: `components/data-table.tsx`, `components/object-tile.tsx`
   (`RelatedQuickLinks`), the `Card`/`Tabs`/`Field` patterns in the existing `*-detail-body.tsx`
   files, `components/status-badge.tsx`, `app/(app)/funnel/stage-path.tsx`, and the global `.link`
   class. Match structure/spacing/section-names — NOT Salesforce's raw styling.
4. If a Salesforce field has no column in our schema, **omit it** — never invent schema.

## How to work
- Do it **object by object**, in this order:
  1. Payment Milestone → core MVP (CHANGE-LIST §4) — new `app/(app)/payment-milestones/` route
     (actions/list/detail), a Funnel "Payment Milestones" related tab, and a nav item, all
     funnel-scoped and un-gated (add a core `PAYMENT_MILESTONE_VIEW` permission WITHOUT a `module`).
  2. Detail-body regroupings: Lead, Contact, Account, Opportunity, Quote, then Funnel (CHANGE-LIST §3).
  3. Remaining list columns: Quotations, Opportunities (CHANGE-LIST §2).
  4. (Optional) Dashboard bar charts + recently-viewed (CHANGE-LIST §1) — this one DOES need new
     read queries in `dashboard/actions.ts`; keep them tenant-scoped like the existing ones.
- After **each** object: run `npm run typecheck` (`tsc --noEmit`) and fix every error you introduced.
- Continue on the existing branch **`relayout-salesforce-parity`** (already has the dashboard + 5
  list-table + product-detail edits). First run `rm -f .git/index.lock` if git complains, and
  `npm install` if `node_modules` is missing. **Do not push or open a PR unless asked.**
- For each finished object, show me a short before/after (the SPEC section vs. your rendered result)
  so I can calibrate. Do the **Payment Milestone** and the **Dashboard** first for calibration.

## Definition of done
Every object's list view + detail layout + related lists (+ the home dashboard) visually and
structurally resembles its `SPEC.md` section, built with our components, `tsc --noEmit` clean, on
the branch, with Payment Milestones visible as a core feature without the `projects` module enabled.
