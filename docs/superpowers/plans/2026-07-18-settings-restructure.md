# Settings Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 3,284-line `settings-client.tsx` tabbed monolith into focused nested routes under a `settings/layout.tsx` grouped sub-nav, consolidating tax + money config under a "Billing" umbrella — with zero behavior change.

**Architecture:** New sections are built as standalone nested routes first (each a server `page.tsx` that fetches its slice + a client file holding cards moved **verbatim** from the monolith). The monolith stays live at `/settings` throughout so parity can be checked. The final task adds the sub-nav layout, flips `/settings` to redirect, deletes the monolith, and rewires nav + redirects.

**Tech Stack:** Next.js 16 App Router (nested layouts, `useSelectedLayoutSegment(s)`), React 19, Base UI (shadcn `base-maia`), react-hook-form + zod, Drizzle, server actions via `runAction`/`assertCan`.

## Global Constraints

- **Behavior-preserving move.** Every form, schema, dialog, table, and action moves **verbatim** — same JSX, same zod schema, same action calls. New code is limited to: `layout.tsx` sub-nav, thin per-section `page.tsx` fetchers, the `PicklistCard` extraction, and redirects. A changed field/validation is a bug, not the task.
- **Server actions stay in `app/(app)/settings/actions.ts`** — all section clients import them via the `@/app/(app)/settings/actions` alias. Do not duplicate or rewrite action logic. (Tax actions are the one exception — they move with the tax client, Task 6.)
- **Permissions unchanged.** Each page + action keeps its existing server-side gate (`TENANT_SETTINGS`, `TAX_VIEW`/`TAX_CONFIGURE`, `TENANT_MANAGE_USERS`, `FUNNEL_MANAGE`). The sub-nav filters items by permission but never replaces the server gate.
- **Module gating unchanged.** Finance-gated pieces (invoice reminders, `FINANCE_SWITCHES`, invoice-due-days) stay gated on `settings.financeEnabled` exactly as today.
- **Package manager is pnpm.** Verify with `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`. The repo's `_flip.cjs` scratch file breaks whole-repo lint — lint touched files with `pnpm exec eslint <file>` if whole-repo lint fails on that file only.
- **`getSettings()` returns the full `TenantSettingsView`** — each section calls it independently; do not try to share one fetch across routes.
- Route folder is `app/(app)/settings/`. The `(app)` segment is a route group — keep the parentheses in paths.

---

## File map

```
app/(app)/settings/
├─ actions.ts                 # UNCHANGED — shared action module (all sections import from here)
├─ constants.ts               # UNCHANGED — imported by nature/product-code/auto-join clients
├─ page.tsx                   # Task 11: becomes redirect → ./general
├─ settings-client.tsx        # Task 11: DELETED
├─ layout.tsx                 # Task 11: NEW — grouped sub-nav
├─ _nav.ts                    # Task 11: NEW — sub-nav item config (label, href, segment, permission)
├─ general/
│  ├─ page.tsx                # Task 2
│  └─ general-client.tsx      # Task 2 (GeneralForm, CompanyProfileCard, Currencies picklist, IntercompanyPartnersCard)
├─ billing/
│  ├─ page.tsx                # Task 11: redirect → ./numbering
│  ├─ numbering/{page,client}.tsx    # Task 3
│  ├─ invoicing/{page,client}.tsx    # Task 4
│  └─ tax/{page,client,actions}.tsx  # Task 6 (moved from /tax-settings)
├─ taxonomy/
│  ├─ page.tsx                # Task 11: redirect → ./industries
│  ├─ industries/{page,client}.tsx      # Task 7
│  ├─ project-natures/{page,client}.tsx # Task 8
│  ├─ product-codes/{page,client}.tsx   # Task 9
│  └─ funnel-stages/{page,client}.tsx   # Task 10
└─ people/{page,client}.tsx   # Task 5

components/picklist-card.tsx   # Task 1: NEW — extracted shared component
app/(app)/tax-settings/page.tsx # Task 6: becomes redirect → /settings/billing/tax
components/app-sidebar.tsx      # Task 11: Settings link → /settings/general
components/command-palette.tsx  # Task 11: Settings link → /settings/general
```

All source line ranges below refer to `app/(app)/settings/settings-client.tsx` as it stands at the start of this plan.

---

### Task 1: Extract `PicklistCard` to a shared component

`PicklistCard` (used 5× in the monolith) must be a standalone component before sections that need it can move.

**Files:**
- Create: `components/picklist-card.tsx`
- Modify: `app/(app)/settings/settings-client.tsx` (remove the inline `PicklistCard`, import the new one)

**Interfaces:**
- Produces: `export function PicklistCard(props: <same props as the inline version>)` at `@/components/picklist-card`. Keep the exact prop signature and behavior of the inline version (lines 2932-3048).

- [ ] **Step 1: Move the component verbatim**

Cut `PicklistCard` from `settings-client.tsx` (lines ~2932-3048, the full `function PicklistCard(...) { ... }`) into a new `components/picklist-card.tsx`. Add `"use client"` at the top. Copy over ONLY the imports it actually uses (Card family, Button, Input, Badge, `X`/`Plus` icons from lucide, `cn`, react state). Export it: `export function PicklistCard(...)`.

- [ ] **Step 2: Import it back in the monolith**

In `settings-client.tsx`, add `import { PicklistCard } from "@/components/picklist-card"` and delete the now-removed inline definition. Every existing `<PicklistCard .../>` call site stays unchanged.

- [ ] **Step 3: Verify compile + no behavior change**

Run: `pnpm run typecheck && pnpm exec eslint components/picklist-card.tsx "app/(app)/settings/settings-client.tsx"`
Expected: no type errors; eslint clean on both files.
Run: `pnpm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/picklist-card.tsx "app/(app)/settings/settings-client.tsx"
git commit -m "refactor(settings): extract PicklistCard to a shared component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: General section route

Move the General tab into its own route. **Payment terms and SO doc kinds do NOT come here** — they go to `billing/invoicing` (Task 4). General keeps org form, company profile, Currencies picklist, and Intercompany partners.

**Files:**
- Create: `app/(app)/settings/general/page.tsx`, `app/(app)/settings/general/general-client.tsx`

**Interfaces:**
- Consumes: `getSettings`, `listTenantMembers`, `listEntities` from the existing modules; `PicklistCard` from `@/components/picklist-card`.
- Produces: route `/settings/general` rendering the General content.

- [ ] **Step 1: Create the server page**

`general/page.tsx` — server component:
```tsx
import { getSettings, listTenantMembers } from "@/app/(app)/settings/actions"
import { listEntities } from "@/lib/lookups"
import { GeneralClient } from "./general-client"

export default async function GeneralSettingsPage() {
  const [settings, members, entities] = await Promise.all([
    getSettings(),
    listTenantMembers(),
    listEntities(),
  ])
  return <GeneralClient settings={settings} members={members} entities={entities} />
}
```
(Match the exact import paths/names the monolith's `page.tsx` uses for these three.)

- [ ] **Step 2: Create the client with the moved cards**

`general/general-client.tsx` (`"use client"`): move **verbatim** from `settings-client.tsx`:
- `generalSchema` (143-186), `SWITCHES`/`FINANCE_SWITCHES` constants (188-243), `GeneralForm` (245-717)
- `CompanyProfileCard` (2736-2926)
- `IntercompanyPartnersCard` (3055-3132)

Export `GeneralClient({ settings, members, entities })` that renders (in the same order the General `TabsContent` did, 3157-3217): `GeneralForm`, `CompanyProfileCard`, the **Currencies** `PicklistCard` only (not payment-terms/SO-kinds), and `IntercompanyPartnersCard`. Fix imports: `PicklistCard` from `@/components/picklist-card`, actions from `@/app/(app)/settings/actions`, everything else from the same modules the monolith imported.

Leave the monolith's General tab in place for now (parity reference) — it still imports these from itself; do not delete them from `settings-client.tsx` yet (Task 11 deletes the monolith wholesale).

- [ ] **Step 3: Verify**

Run: `pnpm run typecheck && pnpm exec eslint "app/(app)/settings/general/"*.tsx && pnpm run build`
Expected: clean; build succeeds; `/settings/general` is a valid route.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/settings/general/"
git commit -m "feat(settings): general section route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Billing / Numbering route

**Files:**
- Create: `app/(app)/settings/billing/numbering/page.tsx`, `.../numbering-client.tsx`

**Interfaces:**
- Consumes: `getSettings` from `@/app/(app)/settings/actions`.
- Produces: route `/settings/billing/numbering`.

- [ ] **Step 1: Server page**
```tsx
import { getSettings } from "@/app/(app)/settings/actions"
import { NumberingClient } from "./numbering-client"
export default async function NumberingSettingsPage() {
  const settings = await getSettings()
  return <NumberingClient settings={settings} />
}
```

- [ ] **Step 2: Client with moved cards**

`numbering-client.tsx` (`"use client"`): move verbatim `pad()` (751-753), `numberingSchema` (721-747), `NumberingForm` (755-1074), `MilestoneTemplateCard` (2611-2729). Export `NumberingClient({ settings })` rendering `NumberingForm` then `MilestoneTemplateCard` (same as monolith 3219-3237). Fix imports (actions via `@/app/(app)/settings/actions`).

- [ ] **Step 3: Verify** — `pnpm run typecheck && pnpm exec eslint "app/(app)/settings/billing/numbering/"*.tsx && pnpm run build` → clean.
- [ ] **Step 4: Commit** — `git add "app/(app)/settings/billing/numbering/" && git commit -m "feat(settings): billing/numbering route\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 4: Billing / Invoicing route

**Files:**
- Create: `app/(app)/settings/billing/invoicing/page.tsx`, `.../invoicing-client.tsx`

**Interfaces:**
- Consumes: `getSettings`; `PicklistCard`.
- Produces: route `/settings/billing/invoicing`.

- [ ] **Step 1: Server page** — fetch `getSettings()`, pass to `InvoicingClient`.
- [ ] **Step 2: Client** — `invoicing-client.tsx` (`"use client"`) renders three `PicklistCard`s moved from the monolith's General + Numbering tabs: **Payment terms** (`updatePaymentTerms`), **SO document kinds** (`updateSoDocumentKinds`) — both moved out of General; and **Invoice reminders** (`updateInvoiceReminderDays`) — moved out of Numbering, keep the `{settings.financeEnabled ? <PicklistCard.../> : null}` finance gate exactly. Use the same `PicklistCard` props (label/items/action) those call sites used in the monolith. Import `PicklistCard` from `@/components/picklist-card`, actions from `@/app/(app)/settings/actions`.
- [ ] **Step 3: Verify** — typecheck + eslint the new files + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): billing/invoicing route (payment terms, SO kinds, invoice reminders)`.

---

### Task 5: People section route

**Files:**
- Create: `app/(app)/settings/people/page.tsx`, `.../people-client.tsx`

**Interfaces:**
- Consumes: `getSettings`, `listTenantMembers`.
- Produces: route `/settings/people`.

- [ ] **Step 1: Server page** — fetch `getSettings()` and `listTenantMembers()`, pass to `PeopleClient`.
- [ ] **Step 2: Client** — `people-client.tsx` (`"use client"`) moves verbatim `AUTO_JOIN_ROLES` usage, `AutoJoinCard` (2476-2604), `memberColumns` (2406-2444), `TeamTable` (2446-2472). Render `AutoJoinCard` + the read-only `TeamTable`, and keep the existing "Manage members & roles →" link to `/team`. Imports: actions from `@/app/(app)/settings/actions`, `AUTO_JOIN_ROLES` from `@/app/(app)/settings/constants`.
- [ ] **Step 3: Verify** — typecheck + eslint + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): people route (auto-join + members snapshot, links to /team)`.

---

### Task 6: Billing / Tax route (move `tax-settings` in)

**Files:**
- Create: `app/(app)/settings/billing/tax/page.tsx`, `.../tax-client.tsx`, `.../actions.ts`
- Modify: `app/(app)/tax-settings/page.tsx` → redirect

**Interfaces:**
- Consumes: the existing tax actions (`listTaxSettings`, `createTax`, `updateTax`, `deleteTax`, `setDefaultTax`) and `TaxSettingsClient`, moved from `app/(app)/tax-settings/`.
- Produces: route `/settings/billing/tax`; `/tax-settings` redirects to it.

- [ ] **Step 1: Move the tax client + actions**

Move `app/(app)/tax-settings/tax-settings-client.tsx` → `app/(app)/settings/billing/tax/tax-client.tsx` (rename export if desired, keep behavior). Move `app/(app)/tax-settings/actions.ts` → `app/(app)/settings/billing/tax/actions.ts`. Update the client's action import to the new relative path. The tax actions keep their `withTenant(PERMISSIONS.TAX_VIEW/TAX_CONFIGURE, ...)` gates verbatim.

- [ ] **Step 2: New server page**
```tsx
import { listTaxSettings } from "./actions"
import { TaxClient } from "./tax-client"
export default async function TaxSettingsPage() {
  const data = await listTaxSettings()
  return <TaxClient data={data} />
}
```
(Match the original `tax-settings/page.tsx` fetch signature exactly.)

- [ ] **Step 3: Redirect the old route**

`app/(app)/tax-settings/page.tsx`:
```tsx
import { redirect } from "next/navigation"
export default function TaxSettingsRedirect() { redirect("/settings/billing/tax") }
```
Delete `tax-settings/tax-settings-client.tsx` and `tax-settings/actions.ts` (now moved). Confirm nothing else imports the old paths: `grep -rn "tax-settings/actions\|tax-settings-client" app components lib server` returns nothing.

- [ ] **Step 4: Verify** — typecheck + eslint new files + build → clean; `grep` in Step 3 empty.
- [ ] **Step 5: Commit** — `feat(settings): move tax settings to /settings/billing/tax with redirect`.

---

### Task 7: Taxonomy / Industries route

**Files:** Create `app/(app)/settings/taxonomy/industries/page.tsx`, `.../industries-client.tsx`

- [ ] **Step 1: Server page** — fetch `getSettings()`, pass to `IndustriesClient`.
- [ ] **Step 2: Client** — move verbatim `IndustriesCard` (1077-1088), `CountriesCard` (1092-1264). Render `IndustriesCard`, `CountriesCard`, plus the **lead-source** (`updateLeadSources`) and **loss-reason** (`updateLossReasons`) `PicklistCard`s (moved from the monolith's Industries tab, 3239-3260). `PicklistCard` from `@/components/picklist-card`, actions from `@/app/(app)/settings/actions`.
- [ ] **Step 3: Verify** — typecheck + eslint + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): taxonomy/industries route`.

---

### Task 8: Taxonomy / Project Natures route

**Files:** Create `app/(app)/settings/taxonomy/project-natures/page.tsx`, `.../project-natures-client.tsx`

- [ ] **Step 1: Server page** — fetch `getSettings()`, pass to client.
- [ ] **Step 2: Client** — move verbatim `ProjectNaturesCard` (1268-1392). Imports: `PROJECT_NATURE_CODE_MAX`, `normalizeProjectNatureCode`, `validateProjectNatureCode` from `@/app/(app)/settings/constants`; `updateProjectNatures` from `@/app/(app)/settings/actions`.
- [ ] **Step 3: Verify** — typecheck + eslint + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): taxonomy/project-natures route`.

---

### Task 9: Taxonomy / Product Codes route

**Files:** Create `app/(app)/settings/taxonomy/product-codes/page.tsx`, `.../product-codes-client.tsx`

- [ ] **Step 1: Server page** — fetch `getSettings()`, pass to client.
- [ ] **Step 2: Client** — move verbatim `ProductCodesCard` (1396-1518). Imports: `PRODUCT_CODE_MAX`, `normalizeProductCode`, `validateProductCode` from `@/app/(app)/settings/constants`; `updateProductCodes` from `@/app/(app)/settings/actions`.
- [ ] **Step 3: Verify** — typecheck + eslint + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): taxonomy/product-codes route`.

---

### Task 10: Taxonomy / Funnel Stages route

`FunnelStagesCard` and `CustomFunnelFieldsCard` must live together — the stage dialog's "required fields" checklist needs the current custom-field list.

**Files:** Create `app/(app)/settings/taxonomy/funnel-stages/page.tsx`, `.../funnel-stages-client.tsx`

**Interfaces:** Consumes `getSettings`, `getDefaultFunnel`.

- [ ] **Step 1: Server page**
```tsx
import { getSettings, getDefaultFunnel } from "@/app/(app)/settings/actions"
import { FunnelStagesClient } from "./funnel-stages-client"
export default async function FunnelStagesPage() {
  const [settings, funnel] = await Promise.all([getSettings(), getDefaultFunnel()])
  return <FunnelStagesClient funnel={funnel} customFields={settings.customFunnelFields} />
}
```
- [ ] **Step 2: Client** — move verbatim `stageSchema`/`KIND_OPTIONS` (1761-1783), `StageDialog` (1785-2114), `StageRowActions` (2116-2223), `FunnelStagesCard` (2225-2402), `CustomFunnelFieldsCard` (1520-1757). Render `FunnelStagesCard` + `CustomFunnelFieldsCard` (same as monolith 3270-3273). Keep `groupCustomFields`/`CUSTOM_FIELD_TYPES` imports from `@/lib/stage-gate` (shared with /funnel — do not move). Actions from `@/app/(app)/settings/actions`.
- [ ] **Step 3: Verify** — typecheck + eslint + build → clean.
- [ ] **Step 4: Commit** — `feat(settings): taxonomy/funnel-stages route`.

---

### Task 11: Sub-nav layout, switchover, cleanup, nav rewrite

The switchover — adds the grouped sub-nav, retires the monolith, rewires nav + redirects. After this task the old tabbed page is gone.

**Files:**
- Create: `app/(app)/settings/layout.tsx`, `app/(app)/settings/_nav.ts`
- Create: `app/(app)/settings/billing/page.tsx`, `app/(app)/settings/taxonomy/page.tsx` (group redirects)
- Modify: `app/(app)/settings/page.tsx` (→ redirect), delete `app/(app)/settings/settings-client.tsx`
- Modify: `components/app-sidebar.tsx`, `components/command-palette.tsx`

**Interfaces:**
- Consumes: nothing new; uses `isModuleEnabled` (`@/lib/modules`), permission helpers already used by `app-sidebar.tsx`, `usePathname`/`useSelectedLayoutSegments` from `next/navigation`.

- [ ] **Step 1: Nav config**

`_nav.ts` — export the grouped item list (server-importable, pure): each item `{ label, href, permission }`, grouped under `General`, `Billing` (Numbering, Invoicing, Tax[permission TAX_VIEW]), `Taxonomy` (Industries, Project Natures, Product Codes, Funnel Stages), `People` (permission TENANT_MANAGE_USERS). Finance-gated Invoicing items rely on in-page gating; the Tax item is permission-gated here.

- [ ] **Step 2: Layout with the sub-nav**

`layout.tsx` (server component wrapping `{children}`) renders the sub-nav (a client sub-component using `usePathname` for active state) beside the content. Filter items by the viewer's permissions the same way `components/app-sidebar.tsx` does (reuse its permission-check helper/import). Groups render as headers with their items beneath (sidebar-07 style). Match the app's existing `sidebar.tsx` primitives / card styling so it looks native.

- [ ] **Step 3: Group + index redirects**
```tsx
// settings/page.tsx
import { redirect } from "next/navigation"
export default function SettingsIndex() { redirect("/settings/general") }
```
Same pattern for `settings/billing/page.tsx` → `/settings/billing/numbering` and `settings/taxonomy/page.tsx` → `/settings/taxonomy/industries`.

- [ ] **Step 4: Delete the monolith**

Delete `app/(app)/settings/settings-client.tsx`. Confirm nothing imports it: `grep -rn "settings-client" app components lib server` → empty.

- [ ] **Step 5: Rewire top-level nav**

In `components/app-sidebar.tsx` (line ~121) and `components/command-palette.tsx` (line ~126): change the Settings entry `url`/`href` from `/settings` to `/settings/general`. Leave the "Team & roles" → `/team` entry unchanged. Remove any standalone Tax/`/tax-settings` nav entry if one exists (grep first: `grep -rn "tax-settings" components`).

- [ ] **Step 6: Verify build + typecheck + full lint**

Run: `pnpm run typecheck && pnpm run lint && pnpm run build`
Expected: all clean. (If whole-repo lint fails only on the untracked `_flip.cjs`, that's the known local quirk — lint the changed files individually instead.)
Run: `grep -rn "settings-client\|tax-settings/actions\|tax-settings-client" app components lib server` → empty.

- [ ] **Step 7: Smoke test against a real DB**

```bash
docker compose -f docker-compose.dev.yaml up -d
pnpm run db:setup-seeded
pnpm run dev   # in another shell
```
Then verify each route renders and a representative save works with a toast:
`/settings` (→ general), `/settings/general` (save org form), `/settings/billing/numbering`, `/settings/billing/invoicing` (edit payment terms), `/settings/billing/tax` (add a tax rate), `/tax-settings` (→ billing/tax), `/settings/taxonomy/industries`, `/settings/taxonomy/project-natures`, `/settings/taxonomy/product-codes`, `/settings/taxonomy/funnel-stages` (open a stage dialog), `/settings/people` (edit auto-join). Confirm the sub-nav highlights the active section and hides Tax/People for a user lacking those permissions.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): grouped sub-nav layout, retire monolith, rewire nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** §3 structure → Tasks 2-11 (every route); §4 section table → Tasks 2-10 (fetches + gates match); §5 PicklistCard promotion → Task 1, People consolidate-and-link → Task 5, Billing/tax move + redirect → Task 6; §6 nav + redirects → Task 11; §7 behavior-preservation → Global Constraints + every "move verbatim" step; §8 verification → Task 11 Step 7. No spec section unmapped.
- **Order rationale:** PicklistCard first (Tasks 2/4/7 depend on it). Sections built as standalone routes while the monolith stays live (parity reference). Layout + switchover + monolith deletion last, so no intermediate task leaves `/settings` broken — the monolith serves it until Task 11.
- **Payment terms / SO doc kinds** are explicitly moved General → Billing/Invoicing (Task 2 excludes them, Task 4 includes them) — the one place the move reshuffles cards between tabs.
- **No placeholders:** every task names exact source line ranges, destination files, imports to fix, fetch calls, and verify commands.
