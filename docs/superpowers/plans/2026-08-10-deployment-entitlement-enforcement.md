# Deployment Entitlement Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce signed deployment-wide seats, modules, commercial state, and offline grace without giving the deployment agent database credentials.

**Architecture:** A small Node agent owns deployment identity and exchanges signed protocol messages with the vendor control plane. It submits validated bundles to an authenticated internal CRM endpoint. The CRM stores last-known-good bundles, gates every mutation centrally, counts unique active people across organisations, and exposes entitlement state to server-rendered UI.

**Tech Stack:** Node.js 22, Next.js 16 route handlers and server actions, PostgreSQL/Drizzle, Zod, Web Crypto Ed25519, Vitest, Docker Compose.

## Global Constraints

- An invalid, expired, mismatched, or downgraded bundle never replaces the last-known-good bundle.
- The agent has no PostgreSQL connection string and cannot issue SQL.
- Seats count unique active user identities across the deployment, including accepted memberships and unexpired invite reservations.
- Client Owner and Admin may manage memberships only within the signed seat ceiling; only the vendor changes that ceiling.
- Read-only mode preserves login, viewing, export, backup, license repair, and support diagnostics.

---

### Task 1: Persist and Evaluate Last-Known-Good Entitlements

**Files:**
- Create: `apps/web/db/migrations/0063_deployment_control.sql`
- Create: `apps/web/lib/deployment-control.ts`
- Create: `apps/web/lib/deployment-control.test.ts`
- Modify: `apps/web/db/schema.ts`

**Interfaces:**
- `applySignedEntitlement(envelope, expectedDeploymentId)` verifies before an atomic upsert.
- `getDeploymentAccess(now)` returns mode, reason, seat limit, module IDs, lease timestamps, and bundle revision.
- The table stores one current bundle and an append-only application history; the private signing key is never stored.

- [ ] Write failing verification, mismatch, downgrade, active, grace, and read-only tests.
- [ ] Run `pnpm --filter web test -- deployment-control.test.ts` and confirm failure.
- [ ] Add migration/schema and implement the service using `@crm/control-protocol`.
- [ ] Run the focused test, web typecheck, and migration test.
- [ ] Commit with `feat: persist signed deployment entitlements`.

### Task 2: Build the Deployment Agent

**Files:**
- Create: `apps/deployment-agent/package.json`
- Create: `apps/deployment-agent/tsconfig.json`
- Create: `apps/deployment-agent/src/config.ts`
- Create: `apps/deployment-agent/src/identity.ts`
- Create: `apps/deployment-agent/src/client.ts`
- Create: `apps/deployment-agent/src/runner.ts`
- Create: `apps/deployment-agent/src/index.ts`
- Create: `apps/deployment-agent/tests/agent.test.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- First boot creates an Ed25519 keypair in `/var/lib/crm-agent`, registers a one-time token, and persists deployment identity with mode `0600` private material.
- Every 15 minutes with ±15% jitter it posts `DeploymentHeartbeat`, fetches newer entitlement bundles, and sends them to `WEB_INTERNAL_URL` with `AGENT_WEB_SECRET`.
- Configuration delivery is deferred until signed control-plane retrieval and authenticated web apply endpoints exist; the agent only reports the web application's current configuration version.
- Retry uses capped exponential backoff with jitter and never clears cached bundles on network failure.

- [ ] Write failing tests with fake control-plane and CRM servers.
- [ ] Run `pnpm --filter @crm/deployment-agent test` and confirm failure.
- [ ] Implement config validation, identity, registration, heartbeat, fetch, apply, and graceful shutdown.
- [ ] Verify tests/typecheck and assert the package has no database dependency or `DATABASE_URL` read.
- [ ] Commit with `feat: add client deployment agent`.

### Task 3: Add Authenticated Internal Deployment APIs

**Files:**
- Create: `apps/web/app/api/internal/deployment/entitlement/route.ts`
- Create: `apps/web/app/api/internal/deployment/status/route.ts`
- Create: `apps/web/lib/internal-agent-auth.ts`
- Create: `apps/web/lib/internal-agent-auth.test.ts`
- Modify: `.env.example`
- Modify: `apps/web/lib/env.ts`

**Interfaces:**
- Bearer authentication compares a 32-byte secret in constant time.
- `PUT /api/internal/deployment/entitlement` accepts a signed envelope and returns accepted revision/mode.
- `GET /api/internal/deployment/status` returns non-secret health, unique active seats, invite reservations, migration version, and app version.

- [ ] Read the installed Next.js route-handler guide completely.
- [ ] Write failing auth and route tests for missing, bad, valid, replayed, and malformed requests.
- [ ] Implement `runtime = "nodejs"`, body limits, no-store responses, and structured audit logs.
- [ ] Run focused tests, web lint, and typecheck.
- [ ] Commit with `feat: expose authenticated deployment control API`.

### Task 4: Enforce Deployment-Wide Seats and Membership Authority

**Files:**
- Create: `apps/web/lib/deployment-seats.ts`
- Create: `apps/web/lib/deployment-seats.test.ts`
- Modify: `apps/web/app/(app)/team/actions.ts`
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/permissions.ts`
- Modify: `apps/web/db/schema.ts`
- Modify: `apps/web/db/migrations/0063_deployment_control.sql`

**Interfaces:**
- `reserveSeatForInvite(email, invitationId, expiresAt)` atomically locks the deployment counter and rejects over-cap invitations.
- Accepted memberships and pending, unexpired invitations count once per normalised email/user identity across all organisations.
- Owner/Admin can invite and deactivate tenant members; neither can increase the signed ceiling or grant platform-superadmin.

- [ ] Write concurrency tests proving two final-seat invitations cannot both succeed and duplicate identities count once.
- [ ] Replace tenant-local seat checks and the superadmin-only invite rule with deployment-level checks.
- [ ] Release reservations on revoke/expiry/accept and reconcile counters in a repair job.
- [ ] Run auth, team, seat, and permission test suites.
- [ ] Commit with `feat: enforce deployment-wide licensed seats`.

### Task 5: Convert Build-Time Module Flags to Signed Runtime Entitlements

**Files:**
- Create: `apps/web/lib/module-registry.ts`
- Create: `apps/web/lib/modules.server.ts`
- Create: `apps/web/lib/modules.server.test.ts`
- Modify: `apps/web/lib/modules.ts`
- Modify: `apps/web/lib/module-guard.ts`
- Modify: `apps/web/app/(app)/layout.tsx`
- Modify: module navigation, route, action, API, and job call sites returned by `rg "isModuleEnabled|requireModule" apps/web`

**Interfaces:**
- `module-registry.ts` is a pure, client-safe catalog; only server code reads entitlements.
- `getEntitledModuleMap()` is request-scoped and supplies navigation/rendering.
- `requireEntitledModule(id)` is mandatory in route handlers, actions, imports, exports, and scheduled jobs; hidden navigation is not security.

- [ ] Inventory all current module checks and add failing denial tests for every protected server entry point.
- [ ] Split registry from server gate and replace synchronous build-env decisions.
- [ ] Pass a serialisable module map to client components without importing server-only code.
- [ ] Run module tests, full web typecheck, lint, and production build.
- [ ] Commit with `feat: enforce signed runtime module entitlements`.

### Task 6: Apply Commercial Read-Only Mode Centrally

**Files:**
- Create: `apps/web/lib/write-access.ts`
- Create: `apps/web/lib/write-access.test.ts`
- Modify: `apps/web/lib/action-result.ts`
- Modify: `apps/web/lib/actions.ts`
- Modify: `apps/web/lib/server-context.ts`
- Modify: `apps/web/app/(app)/settings/subscription/**`
- Modify: mutating API route handlers returned by `rg "export async function (POST|PUT|PATCH|DELETE)" apps/web/app/api`

**Interfaces:**
- `assertWriteAllowed({ operation })` permits explicit recovery operations and rejects business mutations with a typed `LICENSE_READ_ONLY` result.
- Server actions use the central runner; route handlers and background jobs call the same guard explicitly.
- UI shows active/grace/read-only state and exact recovery deadline but does not expose signing material.

- [ ] Write failing matrices for active, grace, read-only, export, backup, and license-repair operations.
- [ ] Integrate the guard into central action/API/job boundaries.
- [ ] Replace local invoice/seat editing UI with read-only vendor-issued entitlement details for client roles.
- [ ] Run focused tests, API tests, lint, typecheck, and build.
- [ ] Commit with `feat: enforce commercial read-only mode`.

### Task 7: Wire and Exercise the Production Stack

**Files:**
- Modify: `deploy/client/docker-compose.yaml`
- Modify: `deploy/client/.env.example`
- Create: `deploy/client/ops/agent-health.sh`
- Create: `apps/deployment-agent/Dockerfile`
- Create: `tests/e2e/licensing.spec.ts`

**Interfaces:**
- Compose mounts a private agent state volume and shares only `AGENT_WEB_SECRET`/internal network with web.
- Health fails when no valid cached entitlement has ever been applied; control-plane outage alone does not fail during grace.

- [ ] Add an E2E scenario: register, activate, invite to ceiling, reject overflow, disable module, enter grace, enter read-only, restore lease.
- [ ] Build images and run the scenario against Compose.
- [ ] Inspect agent environment and mounts to prove no DB credential/source is present.
- [ ] Commit with `test: cover deployment entitlement lifecycle`.
