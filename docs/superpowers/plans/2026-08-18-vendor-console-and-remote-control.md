# Vendor Console Superadmin Control + Gateway Hardening + Remote Operations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the operator (vendor superadmin) able to control every customer deployment remotely from the Cloudflare control-plane console with clear step-by-step flows, while hardening the customer-side gateway and simplifying how customers operate their own instance.

**Current reality (from audit, 2026-08-18):**
- Operator console (`apps/control-plane/src/routes/operator.tsx`) can only: create clients/contracts/deployments/invoices, assign entitlement schedules, issue install tokens, issue entitlements, update contract controls (JSON-only, no form). Roles `vendor_support`, `release_manager`, `auditor` exist but are wired to zero routes.
- Agent is outbound-only: register → status → heartbeat → fetch/apply entitlement. No command channel. `lastSuccessfulBackupAt`/`lastRestoreTestAt` hardcoded null in `runner.ts`.
- `BACKUP_VAULT` R2 binding declared but zero code references. Production backups run only via GitHub `deploy-production` workflow on a self-hosted runner.
- Gateway (`deploy/client/Caddyfile`) has security headers + `/api/internal/*` 404, but no rate limiting, CSP, HSTS, body-size limit.
- No operator user administration, no deployment status mutation, no key rotation UI, no global audit page, no renewal-claims visibility.
- Production is currently **read-only** until a valid signed entitlement is applied (root-cause runbook in Task 0).

**Architecture:** Extend the existing signed deployment protocol with a **command channel** (control-plane pushes signed commands; agent polls and executes, replies via heartbeat/ack). Keep agent outbound-only (no inbound ports). Extend operator console routes + UI. Harden gateway in `deploy/client`. Add customer-facing self-service + support flow in `apps/web`. All remote operations go through the vendor console with explicit confirmation and full audit.

**Tech Stack:** Hono + Cloudflare D1/R2/R2 + Workers (control-plane), Node 20 + Docker (deployment-agent), Caddy 2 (gateway), Next.js 16 + Drizzle + Postgres (web), Vitest, pnpm.

## Global Constraints

- Read `apps/web/node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, `forms.md`, and `data-security.md` before editing Server Actions or forms.
- Run shell commands through `rtk`; use `rtk proxy` only when raw output is required.
- Never expose agent/web internal routes (`/api/internal/*`) at the edge.
- Agent must remain outbound-only; no inbound ports on customer host.
- Every remote command is idempotent, signed, logged to `operator_audit_log`, and requires explicit operator confirmation in the UI.
- Every task starts with a failing test and ends with focused verification and a commit.
- Production deploy requires operator consent and correct secrets; do not deploy automatically.

---

## File structure

- `apps/control-plane/migrations/0010_*.sql` — operator admin, deployment lifecycle, command queue.
- `apps/control-plane/src/routes/operator.tsx` — console routes/UI.
- `apps/control-plane/src/repos/{operators,deployments-ops,commands}.ts` — new repos.
- `apps/control-plane/src/routes/commands.ts` — agent-facing command fetch/ack API (signed).
- `packages/control-protocol/` — new `command` schemas + signing.
- `apps/deployment-agent/src/` — command poll loop, executors (backup, diagnostics).
- `apps/web/app/api/internal/deployment/command/*` — web-side command relay/exec (backup trigger, diagnostics).
- `deploy/client/` — gateway hardening, backup service scheduler, agent compose.

### Task 0: Production read-only triage runbook (no code)

**Root cause chain:** web is read-only iff `getDeploymentAccess()` returns `read_only` (`apps/web/lib/deployment-control.ts:295`), which happens when no entitlement bundle is stored/applied, or lease expired past grace, or state read fails. Agent self-heals on next ~15 min cycle IF control-plane has a newer version and web accepts it.

**Operator checklist (document in console + runbook):**
1. Open `/operator/deployments/{id}` → check Onboarding progress + heartbeat status (Online/Stale/Never).
2. If "Stale"/"Never connected": agent down or unregistered → reissue install token, verify agent container running, verify `AGENT_WEB_SECRET`/`CONTROL_PLANE_URL` env.
3. If heartbeat Online but web still read-only: verify entitlement state — issue a fresh entitlement version from the Review page (`/entitlements/review`).
4. If apply is rejected: check web logs for rejection reason (`trust_set_invalid`, `unknown_key`, `expired_lease`). `unknown_key`/`trust_set_invalid` = `VENDOR_ENTITLEMENT_TRUST_SET` in the web deployment does not match current control-plane `ENTITLEMENT_SIGNING_PRIVATE_JWK` (key rotation mismatch) → update web env and redeploy.
5. `expired_lease` = lease outside grace window → ensure contract status active and within contract dates on the contract page, then issue.

**Deliverable:** this runbook rendered inside the console as a "Licence repair" card + `docs/operations/` note. **[done]**

### Task 1: Operator roster & access admin

**Files:**
- Migration `0010_operator_admin.sql`: `operator_users` already exists — add UI/route only, plus optional `operator_roles` management.
- `apps/control-plane/src/repos/operators.ts`: `listOperators`, `createOperator(email, accessSubject, roles)`, `setOperatorStatus(id, active|disabled)`, `setOperatorRoles(id, roles[])`.
- Routes: `GET /operator/operators`, `POST /operator/operators`, `POST /operator/operators/:id/status`, `POST /operator/operators/:id/roles` (all `vendor_owner`).
- UI: `/operator/operators` roster page + forms.

- [x] **Step 1:** Write failing repo tests (create/list/disable/role-assign, audit rows written, vendor_owner-only).
- [x] **Step 2:** Implement repos + routes with `requireOperatorRole("vendor_owner")` and audit statements.
- [x] **Step 3:** Build roster UI page + nav item.
- [x] **Step 4:** Verify: `pnpm --filter control-plane test`, typecheck.

### Task 2: Deployment lifecycle control

**Files:**
- `apps/control-plane/src/repos/deployments-ops.ts`: `setDeploymentStatus(id, active|disabled)`, `revokeInstallTokens(id)`.
- Routes + UI on DeploymentPage: Enable/Disable and Revoke pending install tokens, each with confirmation form + audit. Key rotation deferred until signed command channel exists; current agent cannot recover remotely after identity revocation.

- [x] **Step 1:** Failing tests (status transitions, token revoke).
- [x] **Step 2:** Implement repos/routes/UI.
- [x] **Step 3:** Verify.

### Task 3: Contract editing + entitlement controls form

**Files:**
- `apps/control-plane/src/repos/contracts.ts`: add `updateContract(id, {...})` guarded by revision counter.
- `apps/control-plane/src/repos/entitlements.ts`: `updateEntitlementControls` already exists — add HTML form + route (currently JSON-only).
- UI: ContractPage edit form; DeploymentPage entitlement-controls form (status, renewal policy, seat limit, suspension date).

- [x] **Step 1:** Failing tests.
- [x] **Step 2:** Implement + wire forms.
- [x] **Step 3:** Verify.

### Task 4: Observability

**Files:**
- Heartbeat history: surface `heartbeat_rollups` history on DeploymentPage (imageDigest, seats, versions, lastSuccessfulBackupAt, lastRestoreTestAt, agentVersion, clientTimestamp).
- Agent error codes: add `lastErrorCode` from agent runtime to heartbeat payload (control-protocol + runner + D1).
- Renewal claims: `GET /operator/deployments/{id}/entitlements/renewal` showing `entitlement_renewal_claims` (state, attempt_count, last_error_code, retry_at).
- Global audit: `GET /operator/audit` (all roles; write only `auditor` page nav).
- `GET /operator/deployments` health list: all deployments + last heartbeat status + mode.

- [ ] **Step 1:** Failing tests for each surface.
- [ ] **Step 2:** Implement repos/routes/UI.
- [ ] **Step 3:** Verify + commit `feat: deployment observability`.

### Task 5: Remote command channel (core)

**Files:**
- `packages/control-protocol/src/command.ts`: `CommandSchema` (id, deploymentId, kind, payload, issuedAt, expiresAt, signature), ack schema. Signed with same Ed25519 key as entitlements.
- `apps/control-plane/src/repos/commands.ts`: `enqueueCommand`, `nextPendingCommand(deploymentId)` (FIFO, TTL), `ackCommand`, `getCommandHistory`.
- `apps/control-plane/src/routes/commands.ts`: signed `POST /v1/deployments/:id/commands/next` and `POST /v1/deployments/:id/commands/:cid/ack` (agent-auth headers like entitlements retrieval).
- `apps/deployment-agent/src/runner.ts`: after entitlement apply, poll `/commands/next`; execute; ack. Add executor dispatch.
- Web side: commands needing web/DB execute via existing internal secret channel (`apps/web/app/api/internal/deployment/command/*`).

- [ ] **Step 1:** Failing protocol + repo + runner tests.
- [ ] **Step 2:** Implement protocol schemas, repo, agent routes.
- [ ] **Step 3:** Implement agent poll + ack loop.
- [ ] **Step 4:** Verify + commit `feat: signed remote command channel`.

### Task 6: Remote operations (first commands)

**Commands to ship first (each = console button + confirmation + audit + ack):**
- `trigger_backup`: agent signals web backup service to run `prepare-backup-evidence.sh` (or agent runs it); result uploaded to `BACKUP_VAULT` R2; ack carries artifact sha256.
- `verify_restore`: run restore-test on latest artifact; ack carries `RESTORE_VERIFIED`.
- `diagnostics`: collect bounded support bundle (versions, container status, last logs tail, health, DB size) signed back as artifact to R2; surfaced in console.
- `restart_web` / `restart_gateway`: agent runs `docker compose restart <svc>` via host docker socket (agent already has docker access? verify) — fail-closed, requires `vendor_owner`.
- `log_stream`: tail last N lines of a service log; bounded.

**Files:** control-plane commands UI; agent executors `src/executors/`; web internal command endpoints; R2 upload client in agent; console "Remote Actions" card on DeploymentPage with live status (pending/executing/succeeded/failed).

- [ ] **Step 1:** Failing executor tests (fake docker/logs).
- [ ] **Step 2:** Implement `trigger_backup`, `verify_restore`, `diagnostics`.
- [ ] **Step 3:** Console UI card + audit + artifact links.
- [ ] **Step 4:** Verify + commit `feat: remote backup and diagnostics`.

### Task 7: Gateway hardening

**Files:** `deploy/client/Caddyfile`, root `Caddyfile`, `deploy/client/compose.yaml`.

- [x] **Step 1:** Add `request_body` size cap, security headers, upstream timeouts, and container hardening. Rate limiting and HSTS documented for public Nginx/HAProxy because shipped Caddy image has no rate-limit plugin and listens behind TLS terminator.
- [x] **Step 2:** Keep `/api/internal/*` 404 block; health and public routes remain proxied as before.
- [ ] **Step 3:** Verify gateway config (`caddy validate`) + compose smoke test. Blocked: Docker daemon unavailable in build environment.
- [x] **Step 4:** Add config regression test.

### Task 8: Customer self-service simplification

**Files:** `apps/web` (tenant settings + getting-started), `apps/control-plane` (support flow).

- [ ] **Step 1:** "Request support" button in web app → opens vendor support ticket (posts diagnostic snapshot to control-plane or webhook); vendor sees ticket + link in console.
- [ ] **Step 2:** Guided tenant setup wizard (funnel stages, taxonomy, defaults, invites) — consolidate existing scattered settings into numbered steps.
- [ ] **Step 3:** Seat/invitation management clarity: show seats used, send invite, revoke, in one panel.
- [ ] **Step 4:** Verify + commit `feat: customer self-service and support flow`.

### Task 9: Vendor console UX — clear steps

- Wizard-style onboarding already exists (`ProgressSteps`). Add: repair/support action cards, deployment health summary at top, "What to do next" per state (awaiting install / awaiting heartbeat / active / read-only / needs repair), each with one clear action button.

- [ ] **Step 1:** Wire state → next-action mapping (`deriveOnboardingState` extension).
- [ ] **Step 2:** UI polish on DeploymentPage + Dashboard.
- [ ] **Step 3:** Verify + commit `feat: console step-by-step guidance`.

### Task 10: Integration, docs, release

- [ ] **Step 1:** Run full test suites: `pnpm --filter control-plane test`, `pnpm --filter web test`, agent tests.
- [ ] **Step 2:** `pnpm lint` + typecheck all packages.
- [ ] **Step 3:** Update `docs/operations/release-log.md` + `README.md` + `docs/OPERATIONS.md` (read-only runbook, command channel, gateway hardening).
- [ ] **Step 4:** Commit `docs: document vendor console remote control`.
- [ ] **Step 5:** Deploy control-plane (wrangler, requires secrets), then customer bundles per deployment. Only with operator consent and correct secrets.

---

## Open questions before build

1. **Build scope this session:** full plan is multi-week. Recommend building Task 0 runbook + Task 1 (roster) + Task 2 (lifecycle) + Task 7 (gateway hardening) first — self-contained, no protocol change, testable. Command channel (Tasks 5–6) is the highest-value remote capability but touches control-protocol + agent + web; do next.
2. **Deploy target:** control-plane is Cloudflare Worker (wrangler deploy + secrets). Customer instances are separately deployed per host. Confirm what "deploy it" covers.
3. **Agent docker access:** confirm the agent container may mount the host docker socket for restart/log commands, or whether those must run host-side only.
