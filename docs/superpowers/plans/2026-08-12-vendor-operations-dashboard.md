# Vendor Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a lightweight vendor-only console for customer, tenant, contract, seat, entitlement, deployment-health, backup, and audit operations.

**Architecture:** Extend bounded D1 repository queries with display-safe operational projections, then render them through existing Hono JSX routes. Keep all writes on existing audited endpoints, add explicit confirmation validation for suspension/cancellation, and style the shared layout with one embedded responsive stylesheet.

**Tech Stack:** Cloudflare Workers, D1, Hono, Hono JSX, TypeScript, Vitest, plain CSS.

## Global Constraints

- No frontend framework, client JavaScript, external font, icon, stylesheet, or asset.
- No database migration or new persistent secret.
- Preserve Cloudflare Access, operator RBAC, CSRF, append-only audits, and existing transactions.
- Never render installation tokens, signing keys, raw signed envelopes, or database credentials.
- Bound every list and select only display-safe fields.

---

### Task 1: Operational read models

**Files:**
- Modify: `apps/control-plane/src/repos/clients.ts`
- Modify: `apps/control-plane/src/repos/contracts.ts`
- Test: `apps/control-plane/tests/operator-crud.test.ts`

**Interfaces:**
- Extend `ClientDetail` with latest deployment heartbeat fields and safe aggregate seat/license state.
- Extend `ContractDetail` with renewal/suspension/revision fields, enabled modules, entitlement/deployment summary, and bounded recent audit rows.

- [ ] Add failing repository assertions for latest heartbeat selection, stale/healthy state inputs, occupied seats, image/app/agent versions, backups, modules, and audit ordering.
- [ ] Run `pnpm --dir apps/control-plane test -- operator-crud.test.ts` and confirm RED.
- [ ] Implement bounded SQL projections using latest-row correlated joins/subqueries and explicit field mapping.
- [ ] Rerun focused tests and confirm GREEN.

### Task 2: Safe operational controls and server-rendered UI

**Files:**
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/ui/dashboard.tsx`
- Test: `apps/control-plane/tests/operator-crud.test.ts`

**Interfaces:**
- Render status badges, tenant/client groupings, deployment health, seats, versions, digests, backups, modules, and audit history.
- Existing entitlement control POST requires `confirmCommercialState=confirmed` when status is `suspended` or `cancelled`.

- [ ] Add failing tests for dashboard content, secret absence, and destructive-state confirmation.
- [ ] Implement server validation before `updateEntitlementControls`.
- [ ] Render compact operational forms using existing CSRF inputs and audited endpoints.
- [ ] Rerun focused tests and confirm GREEN.

### Task 3: Shared responsive visual system

**Files:**
- Modify: `apps/control-plane/src/ui/layout.tsx`
- Modify: `apps/control-plane/src/ui/dashboard.tsx`
- Test: `apps/control-plane/tests/operator-crud.test.ts`

**Interfaces:**
- `OperatorLayout` embeds one CSP-compatible CSS block.
- Semantic classes provide header, container, panel, grid, table, badge, metric, form, and responsive behavior.

- [ ] Add HTML assertions for stable semantic hooks and accessibility labels.
- [ ] Add the embedded stylesheet and semantic class hooks without changing field names or actions.
- [ ] Run `pnpm --dir apps/control-plane test -- operator-crud.test.ts`.
- [ ] Run `pnpm --dir apps/control-plane typecheck`.
- [ ] Run `pnpm test` and `pnpm run test:workflows`.
- [ ] Commit, push, create PR, require CI, merge, dispatch production deployment, and confirm success.
