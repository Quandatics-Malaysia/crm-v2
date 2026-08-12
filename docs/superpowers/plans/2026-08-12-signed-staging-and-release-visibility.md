# Signed Staging and Release Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy isolated, source-free staging beside production and show trustworthy release metadata in both environments.

**Architecture:** Extend runtime configuration with validated public release metadata, expose it through an authenticated server component, and permit signed SemVer prerelease images. Reuse the hardened client deployment bundle with a separate staging identity, ports, secrets, volumes, entitlement, and Cloudflare Access policy. Promote immutable digests; never build or check out source on the client host.

**Tech Stack:** Next.js, TypeScript, Docker Compose, PostgreSQL, Cloudflare Access/DNS, GitHub Actions, GHCR, Cosign, Trivy, SPDX SBOM.

## Global Constraints

- Production URL remains `https://app.quandatics.com`; staging uses `https://staging.app.quandatics.com`.
- Production Compose project remains `crm-v2`; staging uses `crm-v2-staging`.
- Staging gateway binds `127.0.0.1:8092`; staging PostgreSQL binds `127.0.0.1:5434`.
- Staging has separate credentials, deployment ID, storage ID, database, volumes, agent state, backup state, and entitlement.
- Initial Cloudflare Access allowlist contains only `laijienweng@gmail.com`.
- No Git checkout, source, self-hosted runner, mutable image tag, or build occurs on client host.
- Production uses `stable`; staging uses `beta`.
- Compose always deploys immutable digest references.
- Staging never receives production customer data.
- Production must visibly show version and release channel.

---

### Task 1: Runtime release metadata contract

**Files:**
- Modify: `apps/web/lib/env.ts`
- Create: `apps/web/lib/release-metadata.ts`
- Create: `apps/web/tests/release-metadata.test.ts`
- Modify: `deploy/client/compose.yaml`
- Modify: `deploy/client/.env.example`
- Modify: `deploy/client/deploy.sh`
- Modify: `apps/web/tests/production-compose.test.ts`

**Interfaces:**
- Produces: `getReleaseMetadata(): ReleaseMetadata`
- Produces: `ReleaseMetadata` fields `applicationVersion`, `releaseTag`, `releaseChannel`, `deploymentEnvironment`, `imageDigestShort`, `migrationVersion`, `deployedAt`

- [ ] Write tests proving accepted `stable`, `beta`, and `canary` channels; 12-character digest abbreviation; ISO deployment timestamp; and fail-closed rejection of malformed metadata.
- [ ] Run focused tests and confirm failure because metadata parser does not exist.
- [ ] Add `RELEASE_TAG`, `RELEASE_CHANNEL`, `DEPLOYMENT_ENV`, `IMAGE_DIGEST`, and `DEPLOYED_AT` to central environment access.
- [ ] Implement strict metadata parsing without exposing secrets or full source provenance.
- [ ] Pass values through Compose and protected deployment-record rollback handling.
- [ ] Run focused tests and production Compose contract tests.
- [ ] Commit as `feat: expose validated runtime release metadata`.

### Task 2: Authenticated System version UI

**Files:**
- Create: `apps/web/components/settings/system-version-card.tsx`
- Modify: appropriate authenticated settings/about route discovered from existing navigation
- Create: `apps/web/tests/system-version-card.test.tsx`

**Interfaces:**
- Consumes: `getReleaseMetadata()` from Task 1
- Produces: authenticated System version card

- [ ] Write component tests asserting application version, channel badge, environment, short digest, migration version, and deployment time render.
- [ ] Add test proving full digest, source commit, registry URL, and secrets never render.
- [ ] Run focused tests and confirm missing component failure.
- [ ] Implement compact read-only card using existing design system and responsive layout.
- [ ] Mount card in authenticated settings/about surface visible in both production and staging.
- [ ] Run focused component tests, typecheck, and production build.
- [ ] Commit as `feat: show deployed system version`.

### Task 3: Signed release-candidate workflow

**Files:**
- Modify: `.github/workflows/release-images.yml`
- Modify: `.github/workflows/tests/release-images.test.mjs`
- Modify: `packages/control-protocol/src/version.ts` only if current strict parser rejects valid SemVer prereleases
- Modify: related protocol tests only if parser changes

**Interfaces:**
- Produces: signed `vMAJOR.MINOR.PATCH-rc.N` and final `vMAJOR.MINOR.PATCH` manifests
- Preserves: exact workflow identity and annotated-tag requirement

- [ ] Add workflow tests accepting `v1.2.14-rc.1` and rejecting malformed prereleases, lightweight tags, and mutable publication paths.
- [ ] Run workflow tests and confirm prerelease case fails.
- [ ] Change tag validation to full SemVer 2.0 prerelease grammar while retaining annotated-tag enforcement.
- [ ] Ensure manifest and Cosign identity include exact prerelease tag.
- [ ] Run workflow and protocol tests.
- [ ] Commit as `ci: publish signed release candidates`.

### Task 4: Staging deployment profile and operator runbooks

**Files:**
- Create: `deploy/client/staging.env.example`
- Modify: `deploy/client/README.md`
- Create: `docs/operations/release-versioning.md`
- Create: `docs/operations/client-staging-guide.md`
- Create: `docs/operations/production-promotion-checklist.md`
- Create: `docs/operations/environment-inventory.example.md`
- Create: `docs/operations/staging-incident-response.md`
- Modify: bundle policy tests located under `deploy/client/tests` or nearest existing test directory

**Interfaces:**
- Produces: secret-free staging configuration template
- Produces: exact release, acceptance, promotion, rollback, and incident procedures

- [ ] Add policy test asserting staging project, ports, environment, and memory limits differ from production and all images remain digest-only.
- [ ] Run policy test and confirm failure because staging template does not exist.
- [ ] Create staging template with `crm-v2-staging`, ports `8092`/`5434`, `beta`, and limits DB `1g`, web `768m`, agent `128m`, backup `256m`, gateway `128m`.
- [ ] Document annotated tagging, CI evidence, digest deployment, acceptance, final tagging, backup, promotion, rollback, and production version verification.
- [ ] Document exactly what client developers receive and what remains vendor-only.
- [ ] Run policy and documentation checks.
- [ ] Commit as `docs: define signed staging operations`.

### Task 5: Vendor control-plane staging identity and entitlement

**Files:**
- No repository source changes unless operator UI lacks required `beta` deployment support
- Record non-secret IDs in `docs/operations/environment-inventory.md` on vendor side only; do not publish credentials

**Interfaces:**
- Produces: separate staging deployment ID, one-time installation token, and non-billable beta entitlement

- [ ] Create staging deployment under existing Quandatics client with environment `staging` and status `active`.
- [ ] Issue staging installation token and store it only in staging owner-only environment file.
- [ ] Create non-billable staging contract/entitlement with `beta` channel and sufficient test seats/modules.
- [ ] Bind entitlement to signed release-candidate web digest and separate staging deployment ID.
- [ ] Confirm production deployment, contract, seat limit, entitlement revision, and digest remain unchanged.
- [ ] Record deployment ID and release channel without recording token or secrets.

### Task 6: Cloudflare staging hostname and Access

**Files:**
- Cloudflare configuration only

**Interfaces:**
- Produces: `staging.app.quandatics.com` routed to staging gateway
- Produces: Access allow policy for `laijienweng@gmail.com`

- [ ] Create proxied staging DNS/public hostname targeting existing host routing path.
- [ ] Create self-hosted Access application for `staging.app.quandatics.com/*`.
- [ ] Add allow policy for exact email `laijienweng@gmail.com`; deny all others.
- [ ] Confirm unauthenticated request receives Access challenge and production remains unaffected.
- [ ] Complete email OTP login and confirm Access forwards original hostname.

### Task 7: Source-free same-host staging rollout

**Files:**
- Server-only: `/home/internalops/quandatics-client-staging/`
- Server-only: host Caddy routing configuration

**Interfaces:**
- Consumes: signed manifest from Task 3, template from Task 4, staging identity from Task 5, hostname from Task 6
- Produces: isolated healthy `crm-v2-staging` stack

- [ ] Capture production container IDs, image digests, volume names, ports, and health as immutable preflight evidence.
- [ ] Copy only source-free deployment bundle into staging directory and set owner-only permissions.
- [ ] Generate independent staging passwords/secrets and fill protected environment file without printing values.
- [ ] Configure generated/sample data only and bootstrap `laijienweng@gmail.com`.
- [ ] Produce and verify encrypted staging backup evidence required by deploy gate.
- [ ] Verify all release-candidate image signatures and manifest identity.
- [ ] Deploy project `crm-v2-staging` on ports `8092`/`5434` using digest references.
- [ ] Add hostname route to loopback `8092` without changing production upstream.
- [ ] Verify staging health, agent registration, beta entitlement, login, and System version card.
- [ ] Recheck production container IDs, volumes, release metadata, and health are unchanged.

### Task 8: Production release visibility rollout

**Files:**
- Uses signed final release artifacts and existing `/home/internalops/quandatics-client/` bundle

**Interfaces:**
- Consumes: accepted staging commit and final signed manifest
- Produces: production System version card reporting `stable`

- [ ] Record Quandatics acceptance of staging candidate.
- [ ] Create final annotated SemVer tag from exact accepted commit.
- [ ] Confirm CI scan, SBOM, provenance, signing, verification, and release manifest succeed.
- [ ] Create fresh encrypted production backup and authenticated evidence.
- [ ] Update vendor production entitlement to final approved web digest and `stable` channel.
- [ ] Deploy exact final manifest digests through hardened production script.
- [ ] Verify production health, agent entitlement, migration version, full internal digest, and visible System version card.
- [ ] Confirm staging remains on beta candidate until intentionally advanced.

### Task 9: Final isolation and operational acceptance

**Files:**
- Update: `docs/operations/environment-inventory.md` with non-secret final state

**Interfaces:**
- Produces: auditable acceptance record

- [ ] Confirm no source checkout, Git repository, self-hosted runner, Docker build context, or plaintext backup exists on host.
- [ ] Confirm staging and production share no application/database/agent/backup volume.
- [ ] Confirm stopping staging leaves production HTTP 200 and all production containers healthy.
- [ ] Restart staging and confirm persistent staging data plus valid cached entitlement.
- [ ] Confirm unapproved email cannot pass Cloudflare Access.
- [ ] Confirm client developer permissions cannot publish images, issue licenses, access vendor console, or deploy production.
- [ ] Record current versions, channels, short digests, deployment IDs, ports, and rollback references without secrets.
