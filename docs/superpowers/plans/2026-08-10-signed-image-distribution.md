# Signed Image Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production source checkouts and on-server builds with minimal, signed OCI images and a source-free client deployment bundle.

**Architecture:** GitHub Actions builds web, migrator, and backup images on a hosted runner, scans them, generates SBOMs, signs immutable digests with Cosign keyless signing, and publishes them to private GHCR packages. Quandatics receives Compose files, proxy configuration, verified operational scripts, and pull-only registry credentials.

**Tech Stack:** Docker BuildKit, Next.js 16 standalone output, esbuild, GitHub Actions, GHCR, Trivy, Syft, Cosign, POSIX shell.

## Global Constraints

- Quandatics receives no Git repository, TypeScript source, tests, internal docs, build credentials, or Git history.
- Production deploys use immutable image digests and verify the expected GitHub Actions signing identity.
- A failed pull or signature check leaves the running release untouched.
- The migrator image contains bundled JavaScript plus SQL migration assets, not application TypeScript.
- PR preview and vendor staging keep source-build workflows; only client production uses the source-free bundle.
- Every schema release uses expand-and-contract migrations and creates a verified backup before migration.

---

### Task 1: Runtime Artifact Policy

**Files:**
- Create: `scripts/check-runtime-artifacts.sh`
- Create: `scripts/tests/check-runtime-artifacts.test.sh`
- Modify: `.dockerignore`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: a Docker-exported filesystem directory passed as argument 1.
- Produces: `scripts/check-runtime-artifacts.sh <root>` with exit 0 for an allowed runtime tree and exit 1 when it finds `.git`, `.ts`, `.tsx`, `.map`, `.env`, test fixtures, or private docs.

- [ ] **Step 1: Write a failing shell test**

```sh
fixture=$(mktemp -d)
mkdir -p "$fixture/apps/web"
touch "$fixture/apps/web/server.js" "$fixture/apps/web/leak.ts"
if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected TypeScript leak to fail" >&2
  exit 1
fi
rm "$fixture/apps/web/leak.ts"
scripts/check-runtime-artifacts.sh "$fixture"
```

- [ ] **Step 2: Run the test and confirm the missing checker fails**

Run: `sh scripts/tests/check-runtime-artifacts.test.sh`
Expected: FAIL with `scripts/check-runtime-artifacts.sh: not found`.

- [ ] **Step 3: Implement the allowlist checker and disable browser source maps**

The checker must validate an explicit directory, reject an empty or `/` target, and use `find` patterns for forbidden artifacts. Set `productionBrowserSourceMaps: false` in `apps/web/next.config.ts`. Add `.git`, `.github`, `.superpowers`, `docs`, `docs-site`, tests, local env files, and developer caches to `.dockerignore` while keeping `apps/web/db/migrations` and `apps/web/db/sql` available to the migrator build stage.

- [ ] **Step 4: Run the checker test**

Run: `sh scripts/tests/check-runtime-artifacts.test.sh`
Expected: PASS for the clean fixture and an expected rejection for `leak.ts`.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore apps/web/next.config.ts scripts/check-runtime-artifacts.sh scripts/tests/check-runtime-artifacts.test.sh
git commit -m "build: enforce source-free runtime artifacts"
```

### Task 2: Compiled Migrator Image

**Files:**
- Create: `scripts/build-migrator.mjs`
- Create: `scripts/tests/migrator-artifact.test.mjs`
- Modify: `Dockerfile`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `apps/web/db/migrate.ts`, `apps/web/db/seed.ts`, schema modules, permission catalog, `db/migrations`, and `db/sql`.
- Produces: `dist/migrator/migrate.mjs`, `dist/migrator/seed.mjs`, `dist/migrator/db/migrations/**`, and `dist/migrator/db/sql/**`.

- [ ] **Step 1: Write the failing artifact test**

```js
import { access, readdir } from "node:fs/promises"
import assert from "node:assert/strict"

await access("dist/migrator/migrate.mjs")
await access("dist/migrator/seed.mjs")
const names = await readdir("dist/migrator", { recursive: true })
assert.equal(names.some((name) => /\.(ts|tsx|map)$/.test(name)), false)
```

- [ ] **Step 2: Run the test and confirm the artifacts do not exist**

Run: `node scripts/tests/migrator-artifact.test.mjs`
Expected: FAIL with `ENOENT: dist/migrator/migrate.mjs`.

- [ ] **Step 3: Add esbuild and bundle the two production entry points**

Add `esbuild` to web dev dependencies. The build script must bundle for Node 22 ESM, preserve required package externals only when the runtime image installs them, copy migration and SQL assets, and omit seed-sample from client production. Replace the Docker `migrator` stage with the compiled output and production dependencies.

- [ ] **Step 4: Build and test the migrator artifacts**

Run: `pnpm --filter web run build:migrator && node scripts/tests/migrator-artifact.test.mjs`
Expected: PASS with no TypeScript or source-map files below `dist/migrator`.

- [ ] **Step 5: Smoke the migrator container command**

Run: `docker build --target migrator -t crm-migrator:test . && docker run --rm crm-migrator:test node /app/migrate.mjs --help`
Expected: the process reaches the migrator entry point; absence of a database may produce the documented connection error, but no missing module or source-file error.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile apps/web/package.json pnpm-lock.yaml scripts/build-migrator.mjs scripts/tests/migrator-artifact.test.mjs
git commit -m "build: compile source-free migrator image"
```

### Task 3: Source-Free Client Deployment Bundle

**Files:**
- Create: `deploy/client/compose.yaml`
- Create: `deploy/client/Caddyfile`
- Create: `deploy/client/.env.example`
- Create: `deploy/client/deploy.sh`
- Create: `deploy/client/verify-images.sh`
- Create: `deploy/client/healthcheck.sh`
- Create: `deploy/client/README.md`
- Create: `scripts/tests/client-bundle.test.sh`

**Interfaces:**
- Consumes: `WEB_IMAGE`, `MIGRATOR_IMAGE`, `BACKUP_IMAGE`, and later `AGENT_IMAGE`, each as `registry/name@sha256:digest`.
- Produces: a Compose project that pulls images without `build:` keys and exposes only the client gateway while binding PostgreSQL administration to loopback.

- [ ] **Step 1: Write the failing bundle test**

The test must assert that `deploy/client/compose.yaml` exists, contains no `build:`, uses digest variables for vendor images, keeps database ports on `127.0.0.1`, and that every shell file passes `sh -n`.

- [ ] **Step 2: Run the test and confirm the bundle is absent**

Run: `sh scripts/tests/client-bundle.test.sh`
Expected: FAIL with a missing `deploy/client/compose.yaml` message.

- [ ] **Step 3: Implement the bundle and guarded deploy script**

`deploy.sh` must validate all required env values, run `verify-images.sh`, confirm a fresh backup marker, pull images, run the migrator, recreate web services, wait for `/api/health`, and record the deployed digests. It must not run `git pull`, `docker compose build`, or delete volumes. `verify-images.sh` must call `cosign verify` with an exact GitHub workflow identity and OIDC issuer.

- [ ] **Step 4: Validate Compose and shell syntax**

Run: `sh scripts/tests/client-bundle.test.sh && docker compose -f deploy/client/compose.yaml --env-file deploy/client/.env.example config --quiet`
Expected: PASS without reading application source.

- [ ] **Step 5: Commit**

```bash
git add deploy/client scripts/tests/client-bundle.test.sh
git commit -m "ops: add source-free client deployment bundle"
```

### Task 4: Signed Release Workflow

**Files:**
- Create: `.github/workflows/release-images.yml`
- Create: `.github/workflows/tests/release-images.test.mjs`
- Modify: `README.md`
- Modify: `OPERATIONS.md`

**Interfaces:**
- Consumes: annotated tags matching `v*` and GitHub OIDC.
- Produces: private GHCR images by digest, SBOM/provenance artifacts, Cosign signatures, and a release manifest artifact containing image names, digests, source commit, workflow identity, and build time.

- [ ] **Step 1: Write a failing workflow structure test**

The Node test must parse the YAML and assert `packages: write`, `id-token: write`, hosted runners, Docker Buildx, image scanning, SBOM generation, digest outputs, and Cosign signing. It must reject self-hosted runners and mutable-only deployment output.

- [ ] **Step 2: Run the test and confirm the workflow is missing**

Run: `node .github/workflows/tests/release-images.test.mjs`
Expected: FAIL because `.github/workflows/release-images.yml` does not exist.

- [ ] **Step 3: Implement the release workflow**

Build separate web, migrator, and backup targets. Push version and commit tags, capture the immutable digest, scan the digest, generate SPDX SBOM and provenance, sign with keyless Cosign, verify the new signature, and upload `release-manifest.json`. Do not expose registry or Cloudflare secrets to pull-request jobs.

- [ ] **Step 4: Run workflow and repository checks**

Run: `node .github/workflows/tests/release-images.test.mjs && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-images.yml .github/workflows/tests/release-images.test.mjs README.md OPERATIONS.md
git commit -m "ci: publish signed private release images"
```

### Task 5: End-to-End Image Inspection

**Files:**
- Create: `scripts/inspect-release-images.sh`
- Modify: `.github/workflows/release-images.yml`

**Interfaces:**
- Consumes: locally built image tags or released digest references.
- Produces: a machine-readable failure when an image contains forbidden source artifacts, runs as root without justification, lacks the expected entry point, or exposes extra ports.

- [ ] **Step 1: Add the inspection command to the workflow test expectations**

The test must require `scripts/inspect-release-images.sh` after each image build and before publish/sign.

- [ ] **Step 2: Run the workflow test and confirm it fails**

Run: `node .github/workflows/tests/release-images.test.mjs`
Expected: FAIL because the inspection step is absent.

- [ ] **Step 3: Implement filesystem export and policy checks**

Use `docker create` and `docker export` into `mktemp -d`, pass the exported root to `check-runtime-artifacts.sh`, inspect image config JSON, and clean up the temporary container and directory with a trap. Reject the web image if its configured user is root.

- [ ] **Step 4: Build and inspect all phase-one targets**

Run: `docker build --target runner -t crm-web:test . && docker build --target migrator -t crm-migrator:test . && sh scripts/inspect-release-images.sh crm-web:test crm-migrator:test`
Expected: PASS and no leaked TypeScript, maps, secrets, or Git data.

- [ ] **Step 5: Commit**

```bash
git add scripts/inspect-release-images.sh .github/workflows/release-images.yml .github/workflows/tests/release-images.test.mjs
git commit -m "ci: inspect release images before signing"
```
