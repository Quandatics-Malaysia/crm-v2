# Archived Tenant Licensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive `demo` without deleting data, deny all client access, and exclude archived tenants from deployment seat usage.

**Architecture:** PostgreSQL owns tenant lifecycle and seat authority. Next.js resolves only active organizations and fails closed for stale archived tenant requests. A server-operator command performs audited archive/restore operations; no control appears in client UI.

**Tech Stack:** PostgreSQL 17, Drizzle ORM, Next.js, TypeScript, Vitest, pnpm, Docker, Cosign.

## Global Constraints

- Preserve all `demo` organization, membership, invitation, role, audit, and business records.
- Archived organizations consume zero occupied or reserved seats.
- Client users, superadmins, stale cookies, direct URLs, server actions, and APIs cannot access archived organizations.
- Archive/restore requires server-operator authority and audit logging.
- Production mutation requires a fresh verified PostgreSQL backup.
- Production runs signed immutable images only; do not delete existing source deployment before healthy cutover.
- Licensing remains deployment-wide, not per-organization.

---

### Task 1: Database lifecycle and seat authority

**Files:**
- Create: `apps/web/db/migrations/0070_organization_archive.sql`
- Modify: `apps/web/db/migrations/meta/_journal.json`
- Modify: `apps/web/db/schema/auth.ts`
- Test: `apps/web/tests/deployment-seats-db.test.ts`
- Test: `apps/web/tests/deployment-seats-upgrade.test.ts`
- Test: `apps/web/tests/deployment-status-db.test.ts`

**Interfaces:**
- Produces: `organization.status` (`active | archived`) and `organization.archived_at`.
- Produces: PostgreSQL functions `archive_organization(text, text, text, timestamptz)` and `restore_organization(text, text, text, timestamptz)`.
- Preserves: `read_deployment_seat_usage(timestamptz)` and `read_deployment_status_rollup()` signatures.

- [ ] **Step 1: Write failing migration and DB tests**

Add fixtures containing active `cc`, active `qar`, archived `demo`, active memberships, pending invitations, and reservations. Assert archived rows contribute zero to both counts. Assert each seat mutation function rejects `demo` with `organization_archived`. Assert archive and restore write `organization.archived` and `organization.restored` audit records.

- [ ] **Step 2: Run focused DB tests and confirm RED**

```bash
rtk pnpm --filter web test -- deployment-seats-db deployment-seats-upgrade deployment-status-db
```

Expected: failures because migration `0070`, lifecycle columns, and archive functions do not exist.

- [ ] **Step 3: Implement migration and schema**

Migration requirements:

```sql
ALTER TABLE organization
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN archived_at timestamp with time zone,
  ADD CONSTRAINT organization_status_check CHECK (status IN ('active', 'archived')),
  ADD CONSTRAINT organization_archive_timestamp_check CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  );
```

Replace seat snapshot/status functions so membership and invite queries join `organization` and require `organization.status = 'active'`. Every invitation, activation, membership-change, auto-join, and bootstrap function must verify active organization before mutation. Archive/restore functions must lock target organization, validate operator identity, update status atomically, and append audit record.

Expose matching Drizzle fields:

```ts
status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
archivedAt: timestamp("archived_at", { withTimezone: true }),
```

- [ ] **Step 4: Run focused DB tests and confirm GREEN**

```bash
rtk pnpm --filter web test -- deployment-seats-db deployment-seats-upgrade deployment-status-db
```

Expected: all focused tests pass for clean install and `0069` to `0070` upgrade.

- [ ] **Step 5: Commit database authority**

```bash
rtk proxy git add apps/web/db/migrations/0070_organization_archive.sql apps/web/db/migrations/meta/_journal.json apps/web/db/schema/auth.ts apps/web/tests/deployment-seats-db.test.ts apps/web/tests/deployment-seats-upgrade.test.ts apps/web/tests/deployment-status-db.test.ts
rtk proxy git commit -m "feat: add archived tenant seat authority"
```

---

### Task 2: Deny archived tenant access centrally

**Files:**
- Modify: `apps/web/lib/server-context.ts`
- Modify: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/tests/archived-tenant-access.test.ts`
- Test: `apps/web/tests/commercial-readonly-layout.test.ts`

**Interfaces:**
- Produces: `ServerContext.tenantArchived: boolean`.
- Produces: `hasStandingTenantAccess()` requiring active membership, non-suspended settings, and non-archived organization.
- Consumes: `organization.status` from Task 1.

- [ ] **Step 1: Write failing access tests**

Cover active organization fallback, archived active-session cookie, archived-only member, superadmin membership, tenant switcher filtering, and `requireContext()` denial. Expected stable error: `ORGANIZATION_ARCHIVED`.

- [ ] **Step 2: Run focused access tests and confirm RED**

```bash
rtk pnpm --filter web test -- archived-tenant-access commercial-readonly-layout
```

- [ ] **Step 3: Implement central lifecycle resolution**

Join `organization` while resolving membership. Only active organizations may become fallback or active tenant. Add archived state to context and standing-access check. Make `requireContext()` reject archived targets before permissions. Filter layout tenant query with `organization.status = 'active'`. If stale active organization points to archived `demo`, choose oldest active organization; if none exists, render no-access state.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```bash
rtk pnpm --filter web test -- archived-tenant-access commercial-readonly-layout
```

- [ ] **Step 5: Commit request enforcement**

```bash
rtk proxy git add apps/web/lib/server-context.ts 'apps/web/app/(app)/layout.tsx' apps/web/tests/archived-tenant-access.test.ts apps/web/tests/commercial-readonly-layout.test.ts
rtk proxy git commit -m "feat: deny archived tenant access"
```

---

### Task 3: Privileged archive/restore command

**Files:**
- Create: `apps/web/scripts/organization-lifecycle.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/tests/organization-lifecycle.test.ts`

**Interfaces:**
- Produces CLI: `pnpm --filter web organization:lifecycle -- <archive|restore> --slug <slug> --actor-user-id <id> --backup-proof <path>`.
- Consumes: `archive_organization` and `restore_organization` from Task 1.

- [ ] **Step 1: Write failing command tests**

Assert rejection for unknown slug, invalid action, missing operator, missing/malformed/stale backup proof, mismatched database identity, and client-facing execution. Assert idempotent archive/restore and exact audit actor.

- [ ] **Step 2: Run command tests and confirm RED**

```bash
rtk pnpm --filter web test -- organization-lifecycle
```

- [ ] **Step 3: Implement command**

Parse arguments as data, never shell source. Require backup proof signed by deployment trust key and bound to deployment ID, database identity, storage location, and creation time. Require age within rollout backup window. Resolve operator from existing user table and require configured server-operator authority. Call one lifecycle DB function inside one transaction. Never expose this command through Next.js route or UI.

- [ ] **Step 4: Run command tests and confirm GREEN**

```bash
rtk pnpm --filter web test -- organization-lifecycle
```

- [ ] **Step 5: Commit operator command**

```bash
rtk proxy git add apps/web/scripts/organization-lifecycle.ts apps/web/package.json apps/web/tests/organization-lifecycle.test.ts
rtk proxy git commit -m "feat: add audited tenant archive command"
```

---

### Task 4: Release and production archive

**Files:**
- Modify only if release process requires: `progress.md`
- Remote deployment bundle: `/opt/quandatics-client`
- Remote backup directory: `/home/internalops/crm-cutover-backups`

**Interfaces:**
- Consumes: signed web, migrator, agent, and backup image digests containing migration `0070`.
- Produces: healthy image-only deployment where `demo` is archived and excluded from heartbeat seats.

- [ ] **Step 1: Run complete local gates**

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm --filter web test
rtk pnpm --filter web typecheck
rtk pnpm --filter web lint
rtk pnpm --filter web build
```

Expected: all pass; lockfile matches all workspace manifests.

- [ ] **Step 2: Review, merge, and create annotated SemVer release**

Merge only after required GitHub checks pass. Tag next release after `v1.2.12`; release workflow must build, scan, create SPDX SBOM/provenance, sign, verify, and publish immutable digest manifest for all four images.

- [ ] **Step 3: Create and verify fresh production backup**

On `internalops@10.1.10.26`, use signed backup image. Record backup path, SHA-256, database identity, deployment identity, storage identity, creation timestamp, and signed proof. Abort if proof verification fails.

- [ ] **Step 4: Blue/green signed-image deployment**

Use `/opt/quandatics-client` and digest-only image references. Verify Cosign signatures before pull/migration. Keep existing source stack and PostgreSQL rollback path intact. Apply migration `0070`, start image stack on isolated loopback ports, and smoke-test health before proxy switch.

- [ ] **Step 5: Archive `demo`**

Run lifecycle command against slug `demo` using signed backup proof and operator identity. Do not delete rows or volumes.

- [ ] **Step 6: Verify production behavior**

Confirm `qss-automation@quandatics.com` can switch between `cc` and `qar`, cannot see/open `demo`, heartbeat excludes all `demo` members/invites, direct archived tenant requests fail, and control plane reports expected seat usage. Exercise active, suspended, read-only, and restored entitlement states without changing archived tenant data.

- [ ] **Step 7: Retire source only after acceptance**

After agreed observation window and verified rollback artifacts, stop old source containers. Remove source checkout only after explicit owner confirmation. Retain encrypted backup and prior immutable image digests.

---

## Self-Review

- Spec coverage: lifecycle schema, access denial, seat exclusion, audit, backup, restore, and signed rollout covered.
- Placeholder scan: no deferred implementation items.
- Type consistency: `active | archived`, `archivedAt`, `tenantArchived`, archive/restore function and CLI names consistent.
- Scope: one tenant-lifecycle feature plus required safe rollout; no per-tenant licensing redesign.
