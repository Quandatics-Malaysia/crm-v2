# Quandatics Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing Quandatics installation from a source checkout/self-build deployment to the signed-image, vendor-controlled model without losing CRM data or causing an unrecoverable outage.

**Architecture:** Migration runs as a rehearsed blue/green-style release on the same server: inventory and backup first, import only commercial metadata into the control plane, register the agent, pre-pull and verify immutable images, apply entitlement/config, cut proxy traffic, validate, and retain a timed rollback release.

**Tech Stack:** Docker Compose, Cosign, PostgreSQL, Nginx/Caddy, GitHub Actions/GHCR, Cloudflare control plane/R2, POSIX shell.

## Global Constraints

- Existing CRM rows, uploads, tenant IDs, user IDs, and audit history stay on the Quandatics server.
- No destructive cleanup occurs until acceptance evidence and rollback retention expire; source removal requires explicit separate approval.
- Credentials shown in chat/history are treated as compromised and rotated before production cutover.
- Public TLS, DNS/load-balancer routing, Microsoft callback URLs, and container health must all be verified from outside the LAN.
- A failed step leaves the current release running or invokes the documented rollback.

---

### Task 1: Capture and Reconcile the Existing Installation

**Files:**
- Create: `deploy/client/ops/preflight.sh`
- Create: `deploy/client/ops/export-commercial-metadata.sh`
- Create: `deploy/client/ops/tests/preflight.test.sh`
- Create: `docs/runbooks/quandatics-migration.md`

**Interfaces:**
- Preflight reports versions, Compose state, health, proxy targets, disk, TLS expiry, migration level, backup age, active unique users, organisations, modules, and environment variable names with values redacted.
- Commercial export contains deployment/organisation identifiers, seat state, terms, invoices, and module settings only—never CRM business rows or password hashes.

- [ ] Write fixture tests for secret redaction, unhealthy service, expired TLS, wrong proxy, and successful inventory.
- [ ] Implement read-only scripts and migration checklist.
- [ ] Run against staging first and commit `ops: add quandatics migration preflight`.

### Task 2: Import Commercial Metadata into the Control Plane

**Files:**
- Create: `apps/control-plane/src/routes/operator/import.tsx`
- Create: `apps/control-plane/src/services/import-commercial.ts`
- Create: `apps/control-plane/test/import-commercial.test.ts`

**Interfaces:**
- Dry-run maps existing tenant subscriptions/invoices into one client deployment, contracts, invoice milestones, module entitlements, and seat ceiling.
- Import is idempotent by source ID and emits a reconciliation report; it does not activate/deactivate users.

- [ ] Write failing invalid, duplicate, dry-run, apply, and reconciliation tests.
- [ ] Implement operator-only import and audit trail.
- [ ] Verify in preview and commit `feat: import existing commercial metadata`.

### Task 3: Rehearse Source-Free Deployment and Registration

**Files:**
- Create: `deploy/client/ops/install.sh`
- Create: `deploy/client/ops/register.sh`
- Create: `deploy/client/ops/smoke-test.sh`
- Create: `deploy/client/ops/rollback.sh`

**Interfaces:**
- Installer verifies Cosign identity and digest before updating a versioned release directory and never performs `git pull` or `docker build`.
- Registration consumes a single-use, expiring control-plane token; smoke tests local backend, local proxy, external HTTPS, login callback, read/write, module denial, and backup health.
- Rollback restores prior image digests and proxy target without downgrading the database.

- [ ] Write shell tests with fake Docker/Cosign/proxy commands.
- [ ] Rehearse on an isolated copy of production data with no public email/SSO side effects.
- [ ] Record timings/evidence and commit `ops: rehearse signed client deployment`.

### Task 4: Rotate Secrets and Establish Restricted Vendor Access

**Files:**
- Create: `docs/runbooks/client-access.md`
- Create: `deploy/client/ops/audit-access.sh`
- Modify: `deploy/client/.env.example`

**Interfaces:**
- Runbook covers named SSH keys, restricted sudo commands, no shared passwords, registry pull token, agent secret, Microsoft secret, database credentials, backup recipients, revocation, quarterly review, and break-glass audit.
- Audit script reports permissions and fingerprints without printing private data.

- [ ] Add redaction tests and least-privilege expected-state checks.
- [ ] Rotate every credential previously exposed or defaulted and record only secret-manager references.
- [ ] Validate revoke/reissue and commit `docs: define restricted client operations access`.

### Task 5: Bootstrap Entitlement, Configuration, and Backup Vault

**Files:**
- Modify: `docs/runbooks/quandatics-migration.md`
- Create: `deploy/client/config/quandatics.initial.json.example`

**Interfaces:**
- Create deployment, seat ceiling, contract term, module list, default dark theme, Quandatics workflow configuration, dual backup recipients, and first successful encrypted backup/restore evidence before traffic cutover.

- [ ] Publish candidate entitlement/config to staging and complete acceptance checks.
- [ ] Register production agent without switching traffic and verify heartbeat.
- [ ] Complete encrypted backup plus isolated restore drill.
- [ ] Obtain explicit operator approval recorded in control-plane audit.
- [ ] Commit with `ops: define quandatics cutover configuration`.

### Task 6: Perform Scheduled Cutover and Observe

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Create: `.github/workflows/promote-client-release.yml`
- Modify: `docs/runbooks/quandatics-migration.md`

**Interfaces:**
- Promotion requires an immutable digest set, successful staging evidence, operator approval, backup ID, compatibility check, and maintenance window.
- Workflow verifies/pulls on the restricted runner, runs migration once, health/smoke checks, switches traffic, and posts release evidence; it does not check out source on the client host.

- [ ] Disable the old production `git pull`/build path after the new path passes dry-run.
- [ ] Cut over within the approved window and observe health, login, writes, seats, modules, invoices, agent, and backups.
- [ ] Roll back immediately on acceptance failure; otherwise retain prior release for the agreed period.
- [ ] Commit with `ci: promote signed releases to client deployments`.

### Task 7: Close Migration Without Destructive Cleanup

**Files:**
- Create: `docs/runbooks/quandatics-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Acceptance records external health, TLS, SSO, role matrix, seat ceiling, module matrix, read-only simulation, audit history, backup/restore, source-free image inspection, and rollback result.
- Source checkout is disabled and access-restricted after acceptance; deletion is a later explicit, recoverable operation authorised by the client.

- [ ] Obtain signed acceptance and record operational owners/escalation contacts.
- [ ] Remove obsolete CI secrets/runner permissions, not the source tree, and verify no workflow can rebuild on the client.
- [ ] Link central README to architecture, client operations, release, backup, and support runbooks with minimal duplication.
- [ ] Run final canary observation and commit `docs: close quandatics signed-image migration`.

