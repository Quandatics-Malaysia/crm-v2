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

```
app/(app)/settings/
├─ layout.tsx                 # grouped sub-nav (sidebar-07 style) + <children>
├─ page.tsx                   # redirect → ./general
├─ general/page.tsx
├─ documents/page.tsx         # (was "Numbering")
├─ taxonomy/
│  ├─ industries/page.tsx
│  ├─ project-natures/page.tsx
│  ├─ product-codes/page.tsx
│  └─ funnel-stages/page.tsx
├─ finance/page.tsx           # (moved from /tax-settings)
└─ people/page.tsx            # auto-join + members snapshot + link to /team
```

**Sub-nav (in `layout.tsx`), grouped and permission-filtered:**

```
General
Documents
Taxonomy ▾           (group header; expands to the 4 below)
  Industries
  Project Natures
  Product Codes
  Funnel Stages
Finance              (shown only with TAX_VIEW)
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
| `general` | `GeneralForm` (245-717), `CompanyProfileCard` (2736-2926), Currencies/Payment-terms/SO-doc-kinds `PicklistCard`s, `IntercompanyPartnersCard` (3055-3132) | `getSettings`, `listTenantMembers` (for `maxActiveTier` warning), `listEntities` | `TENANT_SETTINGS` |
| `documents` | `NumberingForm` (755-1074), `MilestoneTemplateCard` (2611-2729), invoice-reminders `PicklistCard` (finance-gated) | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/industries` | `IndustriesCard` (1077-1088), `CountriesCard` (1092-1264), lead-source + loss-reason `PicklistCard`s | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/project-natures` | `ProjectNaturesCard` (1268-1392) | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/product-codes` | `ProductCodesCard` (1396-1518) | `getSettings` | `TENANT_SETTINGS` |
| `taxonomy/funnel-stages` | `FunnelStagesCard`+`StageDialog`+`StageRowActions` (1761-2402), `CustomFunnelFieldsCard` (1520-1757) | `getSettings`, `getDefaultFunnel` | `TENANT_SETTINGS` (create/delete/reorder self-gate `FUNNEL_MANAGE`) |
| `finance` | Entire `tax-settings/` client (unchanged internally) | `listTaxSettings` | `TAX_VIEW` / `TAX_CONFIGURE` |
| `people` | `AutoJoinCard` (2476-2604), read-only `TeamTable`/`memberColumns` (2406-2472) | `getSettings` (auto-join fields), `listTenantMembers` | `TENANT_MANAGE_USERS` |

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

**Finance = move tax-settings in, with a redirect.** `tax-settings/`'s client
moves to `settings/finance`; `/tax-settings` becomes a redirect to
`/settings/finance` (preserves any bookmarks). The Finance section keeps its own
`TAX_VIEW`/`TAX_CONFIGURE` gating — independent of `TENANT_SETTINGS` — so a
tax-only user still reaches it (sub-nav shows Finance when they hold `TAX_VIEW`;
the section page + actions self-gate). The old `/tax-settings` sidebar item, if
any, is removed in favor of the settings sub-nav entry.

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
- `/tax-settings/page.tsx` → `redirect("/settings/finance")`.

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
- Permission spot-check: a `TENANT_SETTINGS`-only user sees General/Documents/
  Taxonomy but not Finance/People in the sub-nav; a tax-only user reaches
  `/settings/finance`.

## 9. Out of scope

- **RBAC / `/team` / `/team/roles`** — untouched (People links to them).
- Any change to settings *behavior*, validation, or the DB.
- The two duplicate member queries — left as-is (People uses the settings one).
- Visual redesign beyond the sub-nav grouping — cards keep their current look.

## 10. Open sub-decisions (confirm at spec review)

1. **Taxonomy depth** — 4 sub-routes with nested sub-nav (as above, maximal
   "sub-categories"), or one `taxonomy` page stacking the 4 cards? The spec
   assumes 4 sub-routes; say if you'd rather one page.
2. **Finance placement** — move tax into `settings/finance` (assumed), or leave
   `/tax-settings` and just link to it from the sub-nav (matching the People
   pattern)?
