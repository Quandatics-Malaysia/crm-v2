# Operator Signing Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide one guided operator flow from client creation through signed entitlement issuance and healthy deployment verification.

**Architecture:** Keep Hono JSX server rendering and D1 as the source of truth. Add a deployment workspace view model that derives onboarding state from contracts, install tokens, registration, schedules, entitlements, and heartbeats. Mutations remain POST-only, RBAC-protected, same-origin checked, and audited.

**Tech stack:** Cloudflare Workers, Hono JSX, D1, TypeScript, Vitest Workers pool, plain CSS, minimal progressive enhancement.

---

## Task 1: Derive the onboarding state

**Files:**

- Create: `apps/control-plane/src/repos/onboarding.ts`
- Create: `apps/control-plane/tests/operator-onboarding.test.ts`
- Modify: `apps/control-plane/src/repos/clients.ts`

- [ ] Write tests for missing contract, missing registration, missing schedule, unsigned, heartbeat missing/stale/unhealthy, active lease, grace lease, and read-only lease.
- [ ] Add `getDeploymentWorkspace(db, deploymentId, now)` returning client, compatible contracts, registration, token metadata, schedule, latest entitlement, latest heartbeat, recent entitlement versions, and recent audit events.
- [ ] Derive progress and next action in one pure function. Keep licence and connectivity states separate.
- [ ] Link deployment rows from the client workspace to `/operator/deployments/:deploymentId`.
- [ ] Run `pnpm --filter control-plane test -- operator-onboarding.test.ts` and `pnpm --filter control-plane typecheck`.

## Task 2: Build the operator visual foundation

**Files:**

- Create: `apps/control-plane/src/ui/styles.ts`
- Create: `apps/control-plane/src/ui/components.tsx`
- Modify: `apps/control-plane/src/ui/layout.tsx`
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/tests/operator-crud.test.ts`

- [ ] Add rendering tests for landmarks, skip link, active navigation, escaped content, badges, buttons, fields, cards, empty states, notices, and error panels.
- [ ] Serve scoped CSS from `/operator/styles.css`; use tokens for spacing, colour, type, borders, focus, and responsive layout.
- [ ] Add reusable `PageHeader`, `StatusBadge`, `ProgressSteps`, `Field`, `Card`, `EmptyState`, `Notice`, and `DataList` components.
- [ ] Extend `OperatorLayout` with skip navigation, operator identity, breadcrumbs, and a clear content width.
- [ ] Preserve `no-store`, CSP-compatible markup, semantic HTML, visible focus, and 44px targets.
- [ ] Run focused tests and typecheck.

## Task 3: Redesign dashboard, client list, and client workspace

**Files:**

- Modify: `apps/control-plane/src/ui/dashboard.tsx`
- Modify: `apps/control-plane/src/repos/clients.ts`
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/tests/operator-crud.test.ts`

- [ ] Test dashboard counts and attention items, client rows/statuses, empty states, and the primary next action.
- [ ] Replace raw lists with summary cards and readable tables.
- [ ] Reorder onboarding as Client → Contract → Deployment; keep organisations in a non-blocking secondary section.
- [ ] Move create forms into focused cards with labels, examples, help text, browser constraints, and server validation.
- [ ] Use POST/redirect/GET notices for successful ordinary mutations without changing JSON API behaviour.
- [ ] Run CRUD, auth, and typecheck suites.

## Task 4: Add the deployment signing workspace

**Files:**

- Create: `apps/control-plane/src/ui/deployment.tsx`
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/repos/onboarding.ts`
- Modify: `apps/control-plane/tests/operator-onboarding.test.ts`

- [ ] Test `/operator/deployments/:deploymentId` for every progress state and role.
- [ ] Add the summary header, progress stepper, next-action card, entitlement history, heartbeat panel, and audit timeline.
- [ ] Explain blocked states in plain language and link directly to the required action.
- [ ] Render timestamps consistently in UTC with explicit labels; never infer browser timezone on the server.
- [ ] Keep advanced identifiers available but visually secondary.
- [ ] Run focused tests and typecheck.

## Task 5: Expose safe install-token issuance

**Files:**

- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/repos/deployments.ts`
- Modify: `apps/control-plane/src/ui/deployment.tsx`
- Modify: `apps/control-plane/tests/operator-onboarding.test.ts`

- [ ] Write failing tests for owner-only access, bounded future expiry, invalid/disabled deployment, audit metadata without token plaintext, no-store response, and one-time reveal.
- [ ] Add `POST /operator/deployments/:deploymentId/install-tokens` using existing `issueInstallToken` and `INSTALL_TOKEN_PEPPER`.
- [ ] Validate expiry server-side and cap token lifetime to the documented onboarding window.
- [ ] Render the plaintext token exactly once in a dedicated result page. Add copy enhancement with a no-JavaScript fallback.
- [ ] Add the route to mutation failure auditing without storing token or secret values.
- [ ] Run onboarding, deployment protocol, auth, and typecheck suites.

## Task 6: Add entitlement configuration, review, and signing

**Files:**

- Modify: `apps/control-plane/src/ui/deployment.tsx`
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/repos/onboarding.ts`
- Modify: `apps/control-plane/tests/operator-onboarding.test.ts`
- Modify: `apps/control-plane/tests/entitlements.test.ts`

- [ ] Test contract compatibility, registration prerequisite, schedule validation, review summary, explicit confirmation, stale-state conflict, successful issuance, and immutable history display.
- [ ] Place schedule configuration in the deployment workspace with friendly labels for configuration version, channel, minimum app version, and optional SHA-256 image digest.
- [ ] Add `GET /operator/deployments/:deploymentId/entitlements/review` showing contract, seats, modules, release controls, lease duration, and grace duration.
- [ ] Require an explicit confirmation value on HTML signing requests. Keep protected JSON signing behaviour compatible.
- [ ] After signing, redirect to the workspace with the issued version notice instead of displaying raw JSON.
- [ ] Label later issuance as **Issue new version** and show prior immutable versions.
- [ ] Run onboarding, entitlement, and typecheck suites.

## Task 7: Add safe, useful HTML errors

**Files:**

- Create: `apps/control-plane/src/ui/error.tsx`
- Modify: `apps/control-plane/src/index.ts`
- Modify: `apps/control-plane/src/http/errors.ts`
- Modify: `apps/control-plane/tests/operator-crud.test.ts`
- Modify: `apps/control-plane/tests/operator-onboarding.test.ts`

- [ ] Test HTML and JSON content negotiation for 400, 403, 404, 409, and 500 responses.
- [ ] Map safe error codes to short operator guidance; include request ID and a back link.
- [ ] Keep JSON error contracts and status codes unchanged.
- [ ] Never render exception messages, SQL, cryptographic details, or secret values.
- [ ] Run all control-plane tests and typecheck.

## Task 8: Document and verify the full workflow

**Files:**

- Modify: `README.md`
- Modify: `OPERATIONS.md`
- Modify: `docs-site/operations/control-plane.mdx`
- Modify: `docs-site/external-developers/overview.mdx`
- Modify: `CHANGELOG.md` if present, otherwise the repository's active version log

- [ ] Document the UI path for new client onboarding, token handling, signing, heartbeat verification, renewal, and recovery from stale/offline states.
- [ ] Remove statements saying install-token issuance requires a hidden/manual repository call.
- [ ] Run `pnpm --filter control-plane test`.
- [ ] Run `pnpm --filter control-plane typecheck`.
- [ ] Run the repository's lint/test/build gates from `package.json` and the docs-site build.
- [ ] Perform browser QA for desktop, narrow viewport, keyboard navigation, token reveal, first signing, re-signing, and stale heartbeat.
- [ ] Verify production response headers and Cloudflare Access protection before rollout.

## Delivery sequence

Implement Tasks 1–3 first as a safe visual/read-only slice. Tasks 4–6 complete onboarding and signing. Task 7 hardens recovery. Task 8 updates operator and external-developer guidance. Deploy to staging, complete one synthetic onboarding, then deploy production and verify one existing deployment without issuing a replacement entitlement unless explicitly intended.
