# Vendor Control Plane Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vendor-cloud admin portal and deployment API that own clients, contracts, invoices, deployment identity, audit history, and signed entitlement leases.

**Architecture:** A Hono Cloudflare Worker serves operator pages and deployment APIs. D1 stores metadata, Cloudflare Access authenticates operators, application RBAC authorises each action, and a shared protocol package defines canonical signed payloads for Workers, Node agents, and the CRM.

**Tech Stack:** Cloudflare Workers, Hono JSX, D1, Drizzle SQLite, Zod, Web Crypto Ed25519, Cloudflare Access JWT, Wrangler, Vitest Workers pool.

## Global Constraints

- The control plane stores commercial and deployment metadata, not live CRM rows or plaintext client backups.
- Operator and deployment authentication use separate middleware and credentials.
- Every commercial, entitlement, configuration, release, backup, restore, and access mutation writes an append-only audit event.
- Workers code uses generated binding types, `wrangler.jsonc`, `nodejs_compat`, structured logs, awaited promises, and binding APIs.
- The operator owner uses Cloudflare Access plus application RBAC; production has no header-only or password-only bypass.
- A 24-hour signed operational lease carries a seven-day offline grace deadline.

---

### Task 1: Shared Signed Protocol Package

**Files:**
- Create: `packages/control-protocol/package.json`
- Create: `packages/control-protocol/tsconfig.json`
- Create: `packages/control-protocol/src/canonical-json.ts`
- Create: `packages/control-protocol/src/crypto.ts`
- Create: `packages/control-protocol/src/entitlement.ts`
- Create: `packages/control-protocol/src/heartbeat.ts`
- Create: `packages/control-protocol/src/index.ts`
- Create: `packages/control-protocol/tests/protocol.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `EntitlementLease`, `SignedEnvelope<T>`, `DeploymentHeartbeat`, `DeploymentRegistration`, `canonicalJson(value)`, `signEnvelope(payload, keyId, privateKey)`, `verifyEnvelope(envelope, publicKeys)`, and `evaluateLease(lease, now)`.
- `evaluateLease` returns `{ mode: "active" | "grace" | "read_only"; reason: string; writeAllowed: boolean }`.

- [ ] **Step 1: Write failing protocol tests**

Cover deterministic key ordering, altered-payload rejection, wrong-key rejection, deployment-ID mismatch, active state, seven-day grace, read-only state, and clock rollback input. Use a generated Ed25519 key pair in the test.

- [ ] **Step 2: Run tests and confirm the package is absent**

Run: `pnpm --filter @crm/control-protocol test`
Expected: FAIL because the workspace package does not exist.

- [ ] **Step 3: Implement schemas and Web Crypto signing**

Use Zod schemas with ISO timestamps, integer seat limits from 1 to 100000, known module IDs, 24-hour `leaseExpiresAt`, and `graceUntil >= leaseExpiresAt`. Canonical JSON must sort object keys recursively and reject non-finite numbers and unsupported values.

- [ ] **Step 4: Run package verification**

Run: `pnpm --filter @crm/control-protocol test && pnpm --filter @crm/control-protocol typecheck`
Expected: all protocol tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/control-protocol
git commit -m "feat(control): add signed deployment protocol"
```

### Task 2: Worker Scaffold, Bindings, and D1 Schema

**Files:**
- Create: `apps/control-plane/package.json`
- Create: `apps/control-plane/tsconfig.json`
- Create: `apps/control-plane/wrangler.jsonc`
- Create: `apps/control-plane/vitest.config.ts`
- Create: `apps/control-plane/src/index.ts`
- Create: `apps/control-plane/src/db/schema.ts`
- Create: `apps/control-plane/src/db/client.ts`
- Create: `apps/control-plane/migrations/0001_control_plane.sql`
- Create: `apps/control-plane/tests/health.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Bindings: `CONTROL_DB: D1Database`, `BACKUP_VAULT: R2Bucket`, `ASSETS: Fetcher`, vars `ENVIRONMENT`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `BOOTSTRAP_OWNER_EMAIL`, and secrets `ENTITLEMENT_SIGNING_PRIVATE_JWK`, `INSTALL_TOKEN_PEPPER`.
- Produces: `GET /health` returning `{ status: "ok", environment, database: "ok" }`.

- [ ] **Step 1: Fetch current Workers docs and generate current binding types**

Run: `pnpm --filter control-plane exec wrangler types`
Expected: generated `worker-configuration.d.ts` matches `wrangler.jsonc`; do not hand-write `Env`.

- [ ] **Step 2: Write a failing Workers-runtime health test**

Use `SELF.fetch("https://control.invalid/health")` and assert status 200 plus the JSON contract.

- [ ] **Step 3: Run the test and confirm no Worker entry point exists**

Run: `pnpm --filter control-plane test`
Expected: FAIL on the missing module or route.

- [ ] **Step 4: Implement Hono entry point and the initial relational schema**

Create indexed tables for operator users/roles, clients, deployments, deployment keys, contracts, invoices, plans, module catalog, entitlement versions, heartbeat rollups, install tokens, and operator audit log. Use text ISO timestamps, integer booleans, foreign keys, prepared statements, and migration-tracked SQL.

- [ ] **Step 5: Apply local migrations and run tests**

Run: `pnpm --filter control-plane db:migrate:local && pnpm --filter control-plane test && pnpm --filter control-plane typecheck`
Expected: health test passes inside the Workers runtime.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml apps/control-plane
git commit -m "feat(control): scaffold worker and D1 schema"
```

### Task 3: Cloudflare Access Authentication, RBAC, and Audit

**Files:**
- Create: `apps/control-plane/src/auth/access.ts`
- Create: `apps/control-plane/src/auth/rbac.ts`
- Create: `apps/control-plane/src/audit.ts`
- Create: `apps/control-plane/src/http/errors.ts`
- Create: `apps/control-plane/tests/operator-auth.test.ts`
- Modify: `apps/control-plane/src/index.ts`

**Interfaces:**
- Produces: `requireOperator(c) -> OperatorContext`, `requireOperatorRole(...roles)`, and `writeOperatorAudit(db, event)`.
- `OperatorContext` contains `operatorId`, `email`, and role set; it never trusts an unverified email header in production.

- [ ] **Step 1: Write failing auth and audit tests**

Test missing JWT returns 401, wrong audience returns 401, verified bootstrap email creates or resolves Vendor Owner, unsupported role returns 403, and a permitted mutation writes an audit row.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm --filter control-plane test -- operator-auth.test.ts`
Expected: FAIL because middleware is missing.

- [ ] **Step 3: Implement Access JWT verification and application RBAC**

Use `jose` remote JWKS against the configured Access team domain, verify issuer and audience, and extract the email claim. Allow deterministic test identity only when `ENVIRONMENT=test`. Hash audit request IDs and store before/after metadata without secrets.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm --filter control-plane test -- operator-auth.test.ts && pnpm --filter control-plane test`
Expected: all auth and audit assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/auth apps/control-plane/src/audit.ts apps/control-plane/src/http apps/control-plane/src/index.ts apps/control-plane/tests/operator-auth.test.ts
git commit -m "feat(control): secure operator access and audit"
```

### Task 4: Client, Deployment, Contract, Invoice, and Module Admin

**Files:**
- Create: `apps/control-plane/src/repos/clients.ts`
- Create: `apps/control-plane/src/repos/contracts.ts`
- Create: `apps/control-plane/src/repos/invoices.ts`
- Create: `apps/control-plane/src/routes/operator.tsx`
- Create: `apps/control-plane/src/ui/layout.tsx`
- Create: `apps/control-plane/src/ui/dashboard.tsx`
- Create: `apps/control-plane/tests/operator-crud.test.ts`
- Modify: `apps/control-plane/src/index.ts`

**Interfaces:**
- Produces operator routes for client creation, unlimited client organisations as metadata, deployment creation, contract dates, seat ceilings, module selection, invoice issuance, and list/detail pages.
- Reuses `buildCollectionMilestones` and contract-proration functions moved into `@crm/control-protocol/billing` from the existing web library.

- [ ] **Step 1: Write failing CRUD and billing tests**

Test duplicate client keys return 409, seat ceilings reject non-integers, contract end precedes start returns 400, module dependency violations return 400, invoice totals preserve final-cent allocation, and each mutation writes audit history.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter control-plane test -- operator-crud.test.ts`
Expected: FAIL because routes and repositories are absent.

- [ ] **Step 3: Move pure billing logic into the shared package**

Move without semantic changes, update the web imports, and keep the existing web billing tests passing. Export `getMonthlyBillingPeriods`, `calculateContractTotal`, and `buildCollectionMilestones`.

- [ ] **Step 4: Implement repositories and Hono JSX pages**

Use server-rendered forms with CSRF-resistant same-origin POSTs, explicit validation errors, pagination, and role checks. Do not embed secrets in HTML or logs.

- [ ] **Step 5: Run control-plane and web regression tests**

Run: `pnpm --filter control-plane test && pnpm --filter web test -- subscription-billing.test.ts subscription-proration.test.ts`
Expected: all tests pass with one billing implementation.

- [ ] **Step 6: Commit**

```bash
git add packages/control-protocol apps/control-plane apps/web/lib/subscription-billing.ts apps/web/lib/subscription-proration.ts apps/web/tests
git commit -m "feat(control): manage clients contracts and invoices"
```

### Task 5: Installation Tokens, Registration, and Signed Heartbeats

**Files:**
- Create: `apps/control-plane/src/auth/deployment.ts`
- Create: `apps/control-plane/src/repos/deployments.ts`
- Create: `apps/control-plane/src/routes/deployments.ts`
- Create: `apps/control-plane/tests/deployment-protocol.test.ts`
- Modify: `apps/control-plane/src/index.ts`

**Interfaces:**
- Produces: `POST /v1/deployments/register` and `POST /v1/deployments/:id/heartbeat`.
- Registration consumes a single-use token and binds an Ed25519 public JWK. Heartbeats use `X-Deployment-Key-Id`, `X-Deployment-Timestamp`, `X-Deployment-Nonce`, and `X-Deployment-Signature`.

- [ ] **Step 1: Write failing protocol endpoint tests**

Cover one-time token consumption, wrong deployment, replayed nonce, stale timestamp, altered body, revoked key, valid heartbeat rollup, and rejection of PII fields outside the schema.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter control-plane test -- deployment-protocol.test.ts`
Expected: FAIL because deployment middleware and routes are missing.

- [ ] **Step 3: Implement token hashing and signed request verification**

Generate 32 random bytes, display the raw install token once, and store only a SHA-256 digest combined with the server pepper. Use fixed-size timing-safe comparison for token digests and Web Crypto signature verification for heartbeats. Persist nonce hashes with an expiry window.

- [ ] **Step 4: Run protocol and full tests**

Run: `pnpm --filter control-plane test -- deployment-protocol.test.ts && pnpm --filter control-plane test`
Expected: all endpoint tests pass with no replay acceptance.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/auth/deployment.ts apps/control-plane/src/repos/deployments.ts apps/control-plane/src/routes/deployments.ts apps/control-plane/src/index.ts apps/control-plane/tests/deployment-protocol.test.ts
git commit -m "feat(control): register and authenticate deployments"
```

### Task 6: Entitlement Issuance and Control-Plane Deployment

**Files:**
- Create: `apps/control-plane/src/repos/entitlements.ts`
- Create: `apps/control-plane/src/routes/entitlements.ts`
- Create: `apps/control-plane/tests/entitlements.test.ts`
- Create: `.github/workflows/deploy-control-plane.yml`
- Create: `.github/workflows/tests/deploy-control-plane.test.mjs`
- Create: `apps/control-plane/README.md`
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/index.ts`

**Interfaces:**
- Produces immutable signed entitlement versions and `GET /v1/deployments/:id/entitlement/:version`.
- A valid contract issues a 24-hour lease whose `graceUntil` is seven days after lease expiry.

- [ ] **Step 1: Write failing entitlement tests**

Test active issuance, scheduled suspension, non-renewal, seat reduction below heartbeat usage rejection, future-effective reduction acceptance, module dependencies, immutable history, signature verification, and key ID rotation.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter control-plane test -- entitlements.test.ts`
Expected: FAIL because issuance is absent.

- [ ] **Step 3: Implement issuance and operator controls**

Load the signing private JWK from a Worker secret, never D1. Sign canonical payloads, store payload plus signature, and return immutable content with `Cache-Control: private, no-store`. Heartbeat responses return only version references.

- [ ] **Step 4: Add staging and production deployment workflow**

The workflow must run type generation, D1 migration checks, Workers Vitest, `wrangler deploy --dry-run`, then apply remote D1 migrations and deploy using scoped Cloudflare secrets. Production requires a protected GitHub environment.

- [ ] **Step 5: Run all control-plane gates**

Run: `pnpm --filter control-plane exec wrangler types && pnpm --filter control-plane typecheck && pnpm --filter control-plane test && pnpm --filter control-plane exec wrangler deploy --dry-run`
Expected: exit 0 with binding-code consistency.

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane .github/workflows/deploy-control-plane.yml .github/workflows/tests/deploy-control-plane.test.mjs
git commit -m "feat(control): issue signed deployment entitlements"
```
