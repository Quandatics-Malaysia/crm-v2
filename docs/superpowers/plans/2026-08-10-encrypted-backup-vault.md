# Encrypted Backup Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep recoverable offsite client backups in the vendor cloud without exposing plaintext CRM data or creating a live queryable replica.

**Architecture:** A dedicated client-side backup container streams PostgreSQL and uploads into an archive, encrypts it to both client and vendor recovery recipients, verifies ciphertext checksums, uploads to a private R2 bucket, and reports only manifests to the control plane. Restores happen in an isolated temporary database with explicit approval and audit evidence.

**Tech Stack:** PostgreSQL 17 tools, age, R2/S3 API, rclone, POSIX shell, Docker, Cloudflare R2 lifecycle/bucket locks.

## Global Constraints

- Plaintext archives never leave the client server and are removed after encryption verification.
- Vendor systems store ciphertext and metadata only; recovery private keys are outside R2 and control-plane D1.
- Backup failure never deletes the last known good local or remote backup.
- Daily retention is 35 days; monthly retention is 12 months; legal/contract holds override lifecycle deletion.

---

### Task 1: Build a Minimal Backup Runtime Image

**Files:**
- Create: `docker/backup/Dockerfile`
- Create: `docker/backup/check-tools.sh`
- Modify: `.github/workflows/release-images.yml`
- Modify: `scripts/check-runtime-artifacts.sh`

**Interfaces:**
- Image pins PostgreSQL client major version and age/rclone versions, runs non-root, contains operational scripts only, and is signed with the release images.

- [ ] Write an image smoke test for tools, user, forbidden files, and version output.
- [ ] Build the minimal image and pass runtime-artifact inspection.
- [ ] Add it to SBOM, scan, sign, and publish jobs.
- [ ] Commit with `build: add encrypted backup runtime image`.

### Task 2: Produce Dual-Recipient Encrypted Archives

**Files:**
- Create: `deploy/client/ops/backup-encrypted.sh`
- Create: `deploy/client/ops/tests/backup-encrypted.test.sh`
- Create: `deploy/client/ops/backup-manifest.schema.json`
- Modify: `deploy/client/.env.example`

**Interfaces:**
- Streams a consistent custom-format dump and upload assets manifest into a timestamped archive, encrypting to `CLIENT_BACKUP_RECIPIENT` and `VENDOR_BACKUP_RECIPIENT`.
- Emits a signed/hashed JSON manifest containing deployment ID, schema/app version, ciphertext SHA-256, bytes, object key, started/completed times, and backup class.

- [ ] Write failing tests with fake pg_dump, age, and uploader binaries.
- [ ] Implement strict input validation, `umask 077`, traps, free-space checks, checksums, and atomic local naming.
- [ ] Prove either recovery identity can decrypt a fixture and a third identity cannot.
- [ ] Commit with `feat: create client encrypted backups`.

### Task 3: Provision Locked R2 Storage and Retention

**Files:**
- Create: `infra/cloudflare/backup-vault/wrangler.jsonc`
- Create: `infra/cloudflare/backup-vault/provision.sh`
- Create: `infra/cloudflare/backup-vault/README.md`
- Create: `infra/cloudflare/backup-vault/tests/provision.test.sh`

**Interfaces:**
- Creates a private per-client prefix/bucket policy, scoped upload credentials, 35-day daily and 12-month monthly lifecycle, CORS disabled, and bucket-lock rules where supported.
- Provisioning is idempotent and prints no secrets.

- [ ] Write command-capture tests for lifecycle, lock, credential scope, and rerun behaviour.
- [ ] Implement with current Wrangler/R2 commands after checking official docs.
- [ ] Validate in a non-production Cloudflare account and commit `infra: provision encrypted backup vault`.

### Task 4: Register Backup Manifests and Inventory

**Files:**
- Create: `apps/control-plane/migrations/0003_backups.sql`
- Create: `apps/control-plane/src/routes/api/backups.ts`
- Create: `apps/control-plane/src/routes/operator/backups.tsx`
- Create: `apps/control-plane/src/services/backups.ts`
- Modify: `apps/deployment-agent/src/client.ts`
- Modify: `apps/deployment-agent/src/runner.ts`

**Interfaces:**
- Agent posts manifest after verifying object metadata/checksum; control plane tracks inventory, verification status, retention class, hold, restore requests, and audit events.
- Control plane never accepts plaintext, recovery keys, or an arbitrary object URL.

- [ ] Write failing manifest auth, deployment-prefix, checksum, duplicate, hold, and RBAC tests.
- [ ] Add D1 schema/routes/operator inventory and agent reporting.
- [ ] Run Worker/agent tests and commit `feat: track encrypted backup inventory`.

### Task 5: Implement Approved Isolated Restore Drills

**Files:**
- Create: `deploy/client/ops/restore-encrypted.sh`
- Create: `deploy/client/ops/verify-restore.sh`
- Create: `deploy/client/ops/tests/restore-encrypted.test.sh`
- Create: `docs/runbooks/backup-restore.md`

**Interfaces:**
- Requires deployment ID, expected checksum, recovery identity path, explicit target database name, and typed confirmation.
- Refuses the production database, decrypts into a private temporary directory, restores into an isolated database/network, runs migration/schema/count checks, records evidence, and cleans plaintext.

- [ ] Write failing wrong-checksum, production-target, bad-key, interrupted, and successful restore tests.
- [ ] Implement restore/verification scripts and operator runbook.
- [ ] Perform a fixture drill and prove plaintext cleanup.
- [ ] Commit with `feat: add audited encrypted restore drills`.

### Task 6: Schedule, Monitor, and Exercise Retention

**Files:**
- Modify: `deploy/client/docker-compose.yaml`
- Create: `deploy/client/ops/install-backup-timer.sh`
- Create: `deploy/client/ops/backup-health.sh`
- Create: `tests/e2e/backup-lifecycle.spec.ts`

**Interfaces:**
- Daily timer writes health state consumed by the agent; the first successful backup each calendar month is classed monthly.
- Alerts cover missed backup, upload/checksum failure, retention-policy drift, and overdue restore drill.

- [ ] Add lifecycle E2E tests using a local S3-compatible test endpoint.
- [ ] Wire volumes, secrets, timers, health, and agent heartbeat summary.
- [ ] Verify daily/monthly classification and safe failure behaviour.
- [ ] Commit with `test: cover encrypted backup lifecycle`.

