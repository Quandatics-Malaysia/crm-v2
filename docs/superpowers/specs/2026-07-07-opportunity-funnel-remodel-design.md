# Opportunity → Funnel two-level re-model (core-only)

- **Date:** 2026-07-07
- **Status:** Approved (design) — pending implementation plan
- **Author:** pairing session (Claude + jienweng)
- **Source of truth:** `Salesforce - Object Automation Flows.docx` §5 (Opportunity) and §6 (Funnel)

## 1. Context & goal

crm-v2's core CRM currently collapses "opportunity" and "funnel" into a single
staged-deal object plus a pipeline template. The Salesforce automation doc the
business wants to mirror treats them as **two objects in a parent → child
relationship**:

- **Opportunity** = the container/pursuit. Per-year running number → ID → name,
  a **PPVVC** analysis block, and a rolled-up **Total Estimated Funnel Amount**.
- **Funnel** = the deal that moves through the sales-stage ladder. One
  Opportunity rolls up **many** Funnels. The Funnel owns quotes, dates, amounts,
  and (when enabled) project item lists / payment milestones / contracts.

**Goal:** re-model crm-v2 so Opportunity and Funnel are distinct, with the
Salesforce rollup + PPVVC cascade + the core-fitting automation flows — while
keeping everything that touches deferred modules (projects, finance, contracts)
behind their existing plugin flags per the Core Edition (PROP-0003).

This inverts crm-v2's current naming: today's `opportunities` (the staged deal)
becomes **`funnels`**, today's `funnels` (the pipeline template) becomes
**`pipelines`**, and a **new** `opportunities` container is introduced.

## 2. Non-goals / explicitly deferred

Stays behind the deferred plugins (`projects`, `salesOrders`, `finance`) or a
later pass — **not built now**:

- Project Item List creation on 4A/Renewal/Closed Won (`projects`).
- Payment Milestone sum / delete-on-drop / fully-billed indicator (`projects`/`finance`).
- Contract flows and license-renewal auto-creation (`finance`/`projects`).
- Scheduled CSV "sales report by salesperson" email.
- The doc's **multi-layer role-based approval routing** (account-manager → two
  layers, director → one layer, CEO → auto-approve). This is the "extended
  reporting hierarchy" being gated behind the **`advancedRoles`** module (see
  §10 Related work). Core keeps crm-v2's existing single-level upline/tier
  stage-advance approval.

## 3. Object model

### 3.1 `opportunities` — repurposed as the CONTAINER

| Column | Notes |
|---|---|
| `id`, `tenantId` | as today |
| `accountId`, `primaryPersonId` | the pursuit's account + primary contact |
| `ownerMemberId` | owner |
| `opportunityYear` (int) | drives the per-year running number |
| `opportunityNumber` (int) | running number within the year |
| `code` (text) | formulated ID, e.g. `OPP-{YY}-{NNNN}` |
| `name` (text) | mapped from `code` + descriptor |
| PPVVC block: `pain`, `power`, `vision`, `value`, `control` (text) | the "Analysis section"; cascades to child funnels |
| `totalEstimatedFunnelAmount` (numeric 14,2) | rollup = Σ child funnels' `estimatedFunnelAmount`; recomputed **synchronously** on any child funnel insert/update/delete/soft-delete |
| `description`, `currency` | |
| `customFields` (jsonb) | as today |
| timestamps, soft-delete | |

The container has **no stage** — stages live on the funnel. Container status is
derived (e.g. "has a won funnel") for display; not persisted initially (YAGNI).

### 3.2 `funnels` — the DEAL (renamed from today's `opportunities`)

Keeps today's deal columns, **plus**:

| Column | Notes |
|---|---|
| `opportunityId` (uuid, FK → `opportunities`) | **NEW** — parent container. `onDelete: restrict` (delete children first). |
| `pipelineId` (uuid, FK → `pipelines`) | renamed from today's `funnelId` |
| `currentStageId` (uuid, FK → `pipeline_stages`) | as today |
| `accountId` | auto-populated from the parent Opportunity on create/repoint |
| `awardDate` (date) | **NEW** — maps to close date on Won |
| `isRenewal` (bool, default false) | **NEW** — forward-compat flag; renewal automation is deferred |
| PPVVC block (text ×5) | cascaded from the parent Opportunity |
| `estimatedFunnelAmount` (numeric) | renamed from `estimatedAmount` — drives forecast + rollup |
| `quotedAmount` (numeric) | renamed from `amount` (synced from primary quotation) |
| existing: `primaryQuotationId`, `recognizedPercent`, `isIntercompany`, `projectYear`, `projectNatureCode`, `projectNatures`, `currency`, `expectedCloseDate`, `actualCloseDate`, `closedAt`, `status`, `kivReviewDate`, `lostReason`, `customFields`, timestamps, soft-delete | unchanged semantics |

### 3.3 `pipelines` / `pipeline_stages` — renamed from `funnels` / `funnel_stages`

Structure unchanged (name/isDefault/isActive; stages with code/kind/probability/
sortOrder/requiresApprovalToEnter/includeInForecast/requiredFields). The
canonical 8-stage ladder (`0e,1d,2c,3b,4a,won,lost,kiv`) in `lib/funnel-stages.ts`
is unchanged.

### 3.4 FK repointing (which references follow the DEAL vs the CONTAINER)

Most `opportunityId` FKs describe the **deal**, so they repoint to `funnels`
(rename `opportunityId → funnelId`):

- `quotations.opportunityId → funnelId`
- `stage_approval_requests.opportunityId → funnelId`
- `opportunity_stage_history → funnel_stage_history` (`.funnelId`)
- `intercompany_deals.opportunityId → funnelId`, `intercompany_deal_parties.opportunityId → funnelId`
- `deal_costs.opportunityId → funnelId` *(deferred module; schema-only)*
- `contract_years.opportunityId → funnelId` *(deferred)*
- `projects.opportunityId → funnelId` *(deferred)*

Stays on the **container**:

- `leads.convertedOpportunityId → opportunities.id` — lead conversion creates the
  **Opportunity container** (and optionally a first funnel). Unchanged target.

## 4. Core automation flows (mapped to the doc)

Implemented now, in core:

1. **Opportunity per-year numbering** (§5.1) — `nextOpportunityCode(year)` in the
   numbering service; `code`/`name` derived. Test-first.
2. **PPVVC cascade** (§5.1, §6.1) — on funnel create and on opportunity PPVVC
   edit, copy the 5 analysis fields Opportunity → its Funnel(s). Synchronous
   (not the doc's nightly job).
3. **Total Estimated Funnel Amount rollup** (§5.2) — recompute the container
   total from its funnels' `estimatedFunnelAmount` on any funnel change.
4. **Auto-populate Funnel account** (§6.1) — set `funnel.accountId` from the
   parent Opportunity on create / opportunity repoint.
5. **Closed Won → Account type Prospect→Customer** (§6.1) — on a funnel entering
   `won`, if `accounts.accountType = 'prospect'` set it to `'customer'`.
6. **Award Date → Estimated Funnel Close Date on Won** (§6.1).
7. **Quoted → Estimated amount on Won** (§6.1) — on Won with a quoted amount, set
   `estimatedFunnelAmount = quotedAmount`.
8. **Funnel name format** (§6.1) — `{projectYear} {companyCode} {project|renewal} - {products}`.
   `companyCode` from the tenant/entity code used in finance numbering.
9. **Products-required-from-1D+ gate** (§6.1) — advancing into `1d/2c/3b/4a`
   requires ≥1 product line. Reuse crm-v2's stage-gate infra
   (`lib/stage-gate.ts`, `funnel_stages.requiredFields`).
10. **Stage-change approval** (§6.3) — keep crm-v2's existing upline/tier
    approval (single level). Multi-layer routing deferred to `advancedRoles`.

## 5. Migration strategy — clean reseed

Citrus Cloud is not live until September and there is **no production data**
(only seed rows), so we **restructure the schema and regenerate the seed** rather
than write an in-place data migration:

- New Drizzle migrations create `opportunities` (container) and rename the deal /
  template tables + FKs. Reversible through the migration chain.
- `db/seed-sample.ts` produces Opportunity containers → Funnels (1 container may
  hold ≥1 funnel to exercise the rollup). Plugin sample rows stay wrapped in
  `isModuleEnabled(...)` guards (unchanged partitioning).
- The accepted-quote / won-funnel state remains representable with plugins off.

## 6. RLS, views, access-scope

- **RLS**: new `opportunities` (container) gets the standard tenant-isolation
  policy; renamed tables keep theirs. `funnels` remains RLS-scoped.
- **Views**: `v_billing_forecast`, `v_pipeline_summary`, `v_stage_velocity` read
  the deal + stages — update their table/column names (`funnels`,
  `estimatedFunnelAmount`, `pipeline_stages`). Forecast math unchanged.
- **access-scope**: deal ownership scoping moves to `funnels.ownerMemberId`
  (the deal is what a rep owns). The container `opportunities` row carries its
  own `ownerMemberId`, and container lists scope by **that** column via the
  existing `ownerScope(opportunities.ownerMemberId, visible)` — same idiom as
  every other entity. `ownerScope` / `visibleMemberIds` signatures unchanged.

## 7. Testing (TDD targets — pure logic first)

- `nextOpportunityCode(year, existing)` — per-year increment, gap handling.
- PPVVC cascade — container→funnel copy on create and on edit.
- Rollup — Σ estimatedFunnelAmount across funnels incl. soft-deleted excluded.
- Funnel name formatter — `{year} {companyCode} {project|renewal} - {products}`.
- Won-side mappings — award→close, quoted→estimated, prospect→customer.
- Products-required gate — advancing to 1d+ without products throws.
- End-to-end verify (per `verify` skill) after wiring: create Opportunity →
  add Funnel → advance stages → accept quote → Won, with plugins off.

## 8. Impact surface

`db/schema/pipeline.ts` (+ new container), migrations, RLS SQL, views ·
`app/(app)/funnel/actions.ts` (large) · `quotations` FK + actions ·
`server/services/{numbering,value,stage}.ts` · `lib/access-scope.ts` ·
`app/(app)/dashboard/actions.ts` · UI: `funnel/opportunity-form.tsx`,
`funnel/funnel-detail-body.tsx`, funnel/opportunity lists, nav labels ·
`db/seed-sample.ts`. Sizable but mostly mechanical (rename + repoint), with a
thin layer of new container logic.

## 9. Open questions — resolved

- **PPVVC** = **P**ain / **P**ower / **V**ision / **V**alue / **C**ontrol
  (5 analysis text fields). *(Confirmed by user 2026-07-07.)*
- **Renewal** modeled as a funnel flag (`isRenewal`); renewal automation is
  deferred (it depends on license quote lines + project item lists).
- **Migration** = clean reseed, no in-place data migration. *(Confirmed.)*

## 10. Related / parked work

- **`advancedRoles` module gate** — the business already decided to gate
  granular per-module permission editing, seniority tiers, and the extended
  reporting hierarchy behind a new `advancedRoles` flag (OFF in the MVP). The
  doc's multi-layer stage-approval routing belongs to that module. Design that
  gate separately; this re-model only assumes core's single-level approval.
