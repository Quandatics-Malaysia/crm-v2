# Settings restructure — nested routes + grouped sub-nav

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Scope:** Break the 3,284-line `settings-client.tsx` tabbed monolith into
focused nested routes under a shared settings layout with a grouped
`sidebar-07`-style sub-navigation. Pull tax settings in; remove the duplicate
Members tab. No behavior changes to any form, action, or permission.

---

## 1. Problem

- `app/(app)/settings/settings-client.tsx` is **3,284 lines** — every tab's
  forms, tables, dialogs, and schemas in one client component behind a flat
  7-tab bar (General, Numbering, Industries, Project Natures, Product Codes,
  Funnel Stages, Members).
- The 7 tabs aren't grouped; four of them (Industries, Project Natures, Product
  Codes, Funnel Stages) are all taxonomy/lookup config.
- Settings is scattered: `/tax-settings` is a separate route; `/team` duplicates
  the in-settings "Members" tab.

## 2. Non-negotiables (verified during exploration)

- **Nothing outside `settings/`, `tax-settings/`, `team/` imports their
  internals** (CodeGraph + grep). The restructure cannot break other code.
- Every settings query/mutation **already self-gates** server-side
  (`assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)` etc.). We preserve that exactly
  — permissions are defense-in-depth, not just nav hiding.
- Two strings `"crm-v2::seed-sample::"` / `"crm-v2::import::"` elsewhere are hash
  namespaces — irrelevant here, do not touch.

## 3. Target structure

Informed by how Stripe, Odoo, and Salesforce structure settings (see §11):
a grouped left tree of broad categories → nested items, with **all money/
document config consolidated under one "Billing" umbrella** (Stripe "Billing" /
Odoo "Invoicing"), and **tax living inside Billing** rather than as a standalone
page.

```
app/(app)/settings/
├─ layout.tsx                 # grouped sub-nav (sidebar-07 style) + <children>
├─ page.tsx                   # redirect → ./general
├─ general/page.tsx
├─ billing/
│  ├─ numbering/page.tsx      # numbering + milestone template
│  ├─ invoicing/page.tsx      # payment terms + SO doc kinds + invoice reminders
│  └─ tax/page.tsx            # tax rates (moved from /tax-settings)
├─ taxonomy/
│  ├─ industries/page.tsx
│  ├─ project-natures/page.tsx
│  ├─ product-codes/page.tsx
│  └─ funnel-stages/page.tsx
└─ people/page.tsx            # auto-join + members snapshot + link to /team
```

**Sub-nav (in `layout.tsx`), grouped and permission-filtered:**

```
General
Billing ▾            (group header)
  Numbering
  Invoicing          (finance-gated items hidden without the module)
  Tax                (shown only with TAX_VIEW)
Taxonomy ▾           (group header)
  Industries
  Project Natures
  Product Codes
  Funnel Stages
People               (shown only with TENANT_MANAGE_USERS)
```

- Active item resolved via `useSelectedLayoutSegment` / `useSelectedLayoutSegments`.
- Each nav item carries a `permission`; the layout filters items the user can't
  access, mirroring `components/app-sidebar.tsx`.
- `layout.tsx` does **not** hard-redirect on a single permission (the area is
  mixed-permission). It renders the filtered sub-nav; each page + action
  self-gates as today.

## 4. Section-by-section

Every `page.tsx` is a server component that fetches only what its section needs
and renders a small client component. `getSettings()` returns the full
`TenantSettingsView`, so sections that need different slices each call it
independently (cheap, and avoids cross-route shared fetches).

| Route | Client pieces moved in (from settings-client.tsx line ranges) | page.tsx fetches | Gate |
|---|---|---|---|
| `general` | `GeneralForm` (245-717), `CompanyProfileCard` (2736-2926), Currencies `PicklistCard`, `IntercompanyPartnersCard` (3055-3132) | `getSettings`, `listTenantMembers` (for `maxActiveTier` warning), `listEntities` | `TENANT_SETTINGS` |
| `billing/numbering` | `NumberingForm` (755-1074), `MilestoneTemplateCard` (2611-2729) | `getSettings` | `TENANT_SETTINGS` |
| `billing/invoicing` | Payment-terms + SO-doc-kinds `PicklistCard`s (moved from General), invoice-reminders `PicklistCard` (finance-gated, moved from Numbering) | `getSettings` | `TENANT_SETTINGS` |
| `billing/tax` | Entire `tax-settings/` client (unchanged internally) | `listTaxSettings` | `TAX_VIEW` / `TAX_CONFIGURE` |
| `taxonomy/industries` | `IndustriesCard` (1077-1088), `CountriesCard` (1092-1264), lead-source + loss-reason `PicklistCard`s | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/project-natures` | `ProjectNaturesCard` (1268-1392) | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/product-codes` | `ProductCodesCard` (1396-1518) | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/funnel-stages` | `FunnelStagesCard`+`StageDialog`+`StageRowActions` (1761-2402), `CustomFunnelFieldsCard` (1520-1757) | `getSettings`, `getDefaultFunnel` | `TENANT_SETTINGS` (create/delete/reorder self-gate `FUNNEL_MANAGE`) |
| `people` | `AutoJoinCard` (2476-2604), read-only `TeamTable`/`memberColumns` (2406-2472) | `getSettings` (auto-join fields), `listTenantMembers` | `TENANT_MANAGE_USERS` |

**Currency stays in General** (it's org identity, like Stripe's Business
settings). **Payment terms + SO doc kinds move from General into
`billing/invoicing`** — they're document/invoice config, which the research
places under the Billing umbrella, and pulling them out is a large part of
de-cluttering the General tab.

**Funnel-stages coupling:** `StageDialog`'s "required fields" checklist needs the
current custom-field list, so `FunnelStagesCard` and `CustomFunnelFieldsCard`
must live in the same route (`taxonomy/funnel-stages`) — they do.

## 5. Key decisions

**People = consolidate & link (not full merge).** `settings/people` owns the
auto-join config and a read-only members snapshot, with a "Manage members &
roles →" link to `/team`. `/team` and `/team/roles` stay exactly as they are —
they are the canonical RBAC UI. This removes the duplicate Members tab without a
risky RBAC migration or reconciling the two member-listing queries.
`settings/people` reuses the existing `listTenantMembers()` for its snapshot.

**Billing umbrella = tax + all money/document config in one place.** Following
Stripe ("Billing") and Odoo ("Invoicing"), the Billing group consolidates
numbering, milestone template, payment terms, SO doc kinds, invoice reminders,
and **tax rates**. `tax-settings/`'s client moves to `settings/billing/tax`;
`/tax-settings` becomes a redirect to `/settings/billing/tax` (preserves
bookmarks). Tax keeps its own `TAX_VIEW`/`TAX_CONFIGURE` gating — independent of
`TENANT_SETTINGS` — so a tax-only user still reaches it (the Tax sub-nav item
shows when they hold `TAX_VIEW`; the page + actions self-gate). The old
`/tax-settings` sidebar item is removed in favor of the Billing → Tax entry.

**`PicklistCard` promoted.** It's used 5× in settings-client and will be needed
in `general`, `documents`, and `taxonomy/*`. Extract verbatim to
`components/picklist-card.tsx` (behavior-preserving move), import everywhere.

**Server actions stay put.** `settings/actions.ts` keeps all its exports; the new
`page.tsx` files import from it (or a shared `settings/_lib`). Tax actions stay in
`finance/actions.ts` (moved with the client). No action logic changes.

## 6. Nav + redirect updates

- `components/app-sidebar.tsx:120-121` and `components/command-palette.tsx:125-126`:
  the top-level "Settings" entry now lands on `/settings/general`; keep the
  "Team & roles" entry pointing at `/team` (unchanged).
- `settings/page.tsx` → `redirect("/settings/general")`.
- `settings/billing/page.tsx` → `redirect("/settings/billing/numbering")` (group has no own page).
- `settings/taxonomy/page.tsx` → `redirect("/settings/taxonomy/industries")`.
- `/tax-settings/page.tsx` → `redirect("/settings/billing/tax")`.

## 7. Behavior preservation — the hard rule

This is a **move + regroup**, not a rewrite. Each card/form/dialog moves
**verbatim** (same JSX, same `react-hook-form` schema, same action calls). The
only new code is: the `layout.tsx` sub-nav, the thin per-section `page.tsx`
fetchers, the `PicklistCard` extraction, and the redirects. If a diff shows a
form field or validation changing, that's a bug, not the task.

## 8. Verification

- Per section: the page renders, every form saves (toast success), every table
  loads — smoke-tested against a seeded local DB (`docker compose -f
  docker-compose.dev.yaml up -d` + `pnpm run db:setup-seeded`).
- `pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build` green,
  including a build with the finance module **off** (proves the finance-gated
  numbering/switch bits still compile and hide correctly).
- Permission spot-check: a `TENANT_SETTINGS`-only user sees General/Billing
  (Numbering, Invoicing)/Taxonomy but not Billing→Tax or People in the sub-nav;
  a tax-only user reaches `/settings/billing/tax`.

## 9. Out of scope

- **RBAC / `/team` / `/team/roles`** — untouched (People links to them).
- Any change to settings *behavior*, validation, or the DB.
- The two duplicate member queries — left as-is (People uses the settings one).
- Visual redesign beyond the sub-nav grouping — cards keep their current look.

## 10. Resolved decisions

1. **Taxonomy depth** → **4 sub-routes** with nested sub-nav (industries,
   project-natures, product-codes, funnel-stages).
2. **Finance placement** → **move tax into `settings/billing/tax`** under the
   Billing umbrella (not a standalone page, not a link-out) — matches Stripe/Odoo.
3. **Money-config grouping** → **Billing umbrella** consolidating numbering,
   milestone template, payment terms, SO doc kinds, invoice reminders, and tax.

## 11. Research: how established products structure settings

- **Stripe** — Settings behind the gear icon, split into product-area sections;
  **Tax is its own section** with nested sub-items (Business info, Registrations,
  Display preferences); invoicing config sits under a **Billing** umbrella.
  ([Stripe Tax settings](https://docs.stripe.com/invoicing/taxes?dashboard-or-api=dashboard))
- **Odoo** — Taxes live under **Accounting/Invoicing → Configuration →
  Taxes/Settings** — nested inside the finance area, never standalone.
  ([Odoo Taxes](https://www.odoo.com/documentation/19.0/applications/finance/accounting/taxes.html))
- **Salesforce** — Setup is a tree of **broad categories → nested folders**
  (Administration, Platform Tools, Settings), alphabetized, "broad categories to
  make things discoverable."
  ([Salesforce Setup categories](https://www.forcetalks.com/salesforce-topic/what-are-the-three-main-categories-in-the-setup-menu-in-salesforce/))

**Applied:** grouped left tree of categories → nested items (validates the
`sidebar-07` sub-nav); tax + invoicing consolidated under one Billing umbrella
(not scattered); sections grouped by domain (General / Billing / Taxonomy /
People).
