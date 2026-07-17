# pnpm Migration + Org Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the half-done npm→pnpm migration so the Docker build and auto-deploy stop being broken (Phase 0), then stand up the GitHub organisation, teams, CODEOWNERS, and branch protection that turn CONTRIBUTING.md's review rules from convention into enforcement (Phase 1).

**Architecture:** Phase 0 is pure infrastructure: swap `npm ci` / `npm run` for pinned pnpm across `Dockerfile` and `.github/workflows/deploy.yml`, finalize `pnpm-workspace.yaml`, and prove it with a real `docker build`. Phase 1 is an ops runbook: some steps are browser-only GitHub actions you perform, the rest are `gh` API calls and a CODEOWNERS commit, sequenced so team-based ownership only lands once the repo is inside the org.

**Tech Stack:** pnpm 11.6.0, Node 22 (Docker) / 26 (local), Next.js 16.2.9 standalone, Docker multi-stage, GitHub Actions (GitHub-hosted `quality` job + self-hosted `deploy` job), `gh` CLI.

## Global Constraints

- **pnpm version pinned to `11.6.0`** everywhere (matches the local lockfile-producing version) — copied into `package.json` `packageManager` and both CI/Docker installs.
- **Never introduce a second lockfile.** `package-lock.json` stays deleted; `pnpm-lock.yaml` is the only lockfile and is committed.
- **`main` is production.** There is no staging. Every change is validated by `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before merge, and Phase 0 is not "done" until a real `docker build` of all three targets succeeds.
- **Frozen installs in CI/Docker** — `pnpm install --frozen-lockfile`, never a plain `install` that could mutate the lockfile.
- **Do not touch application code, schema, or migrations.** These two phases change build/config/governance only.
- **Repo identity target:** `quandatics/crm` (org `quandatics`, repo renamed from `crm-v2`). Use these exact names.

---

## Phase 0 — Unbreak the build (pnpm migration)

Independent of Phase 1 and of the monorepo restructure. Ship this first; it fixes a deploy that is broken on the current commit.

### Task 0.1: Pin pnpm and finalize the workspace file

**Files:**
- Modify: `package.json` (add `packageManager` field)
- Modify: `pnpm-workspace.yaml` (replace placeholder `allowBuilds` with pnpm-generated build approvals)

**Interfaces:**
- Produces: a reproducible `pnpm install --frozen-lockfile` that builds the native deps (`esbuild`, `sharp`, `unrs-resolver`) rather than silently skipping their postinstall scripts. `esbuild`'s build script is load-bearing — `tsx` (used by the migrate image and every `db:*` script) fails without its binary.

- [ ] **Step 1: Confirm the starting state**

Run:
```bash
cd /Users/jienweng/Code/Quandatics/crm-v2
ls package-lock.json 2>&1        # expect: No such file
ls -la pnpm-lock.yaml            # expect: present (~310k)
pnpm --version                   # expect: 11.6.0
```
Expected: no `package-lock.json`, `pnpm-lock.yaml` present, pnpm 11.6.0.

- [ ] **Step 2: Add the `packageManager` field to package.json**

In `package.json`, immediately after the `"private": true,` line, add:
```json
  "packageManager": "pnpm@11.6.0",
```
This is the single source of truth for the pnpm version; `pnpm/action-setup` and local `corepack` both read it.

- [ ] **Step 3: Let pnpm write the canonical build-approval config**

The current `pnpm-workspace.yaml` has placeholder text (`set this to true or false`) that is not valid config. Do not hand-author the replacement — have pnpm generate it, so the key name and format are exactly what this pnpm version expects:

```bash
# Reproduce a clean install so pnpm re-detects ignored build scripts:
rm -rf node_modules
pnpm install
```
Expected: install completes; pnpm prints a note that build scripts of `esbuild` / `sharp` / `unrs-resolver` were ignored, suggesting `pnpm approve-builds`.

```bash
pnpm approve-builds
```
When prompted, select **all** of `esbuild`, `sharp`, `unrs-resolver` (space to toggle, enter to confirm). pnpm rewrites `pnpm-workspace.yaml` with the correct approval key (`onlyBuiltDependencies:` in this pnpm version) and the three package names.

- [ ] **Step 4: Verify the workspace file is now valid config**

Run:
```bash
cat pnpm-workspace.yaml
```
Expected: no `set this to true or false` placeholder text remains; instead a real list, e.g.:
```yaml
onlyBuiltDependencies:
  - esbuild
  - sharp
  - unrs-resolver
```

- [ ] **Step 5: Prove a frozen install is reproducible and builds natives**

```bash
rm -rf node_modules
pnpm install --frozen-lockfile
node -e "require('esbuild').version && console.log('esbuild OK')"
```
Expected: install completes with **no** "ignored build scripts" warning; `esbuild OK` prints (its binary postinstall ran).

- [ ] **Step 6: Verify the app still builds locally under pnpm**

```bash
pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build
```
Expected: all four pass; `.next/standalone/server.js` exists afterward (`ls .next/standalone/server.js`).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build(pnpm): pin pnpm@11.6.0 and approve native build scripts

Adds the packageManager field and replaces the placeholder pnpm-workspace
build-approval block with pnpm-generated onlyBuiltDependencies (esbuild,
sharp, unrs-resolver). esbuild's postinstall is load-bearing: tsx and every
db:* script break without its binary.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.2: Switch the Dockerfile from npm to pnpm

**Files:**
- Modify: `Dockerfile` (base stage: install pnpm; deps stage: copy pnpm lockfile + workspace, `pnpm install --frozen-lockfile`; build stage: `pnpm run build`)

**Interfaces:**
- Consumes: `packageManager` + `pnpm-workspace.yaml` from Task 0.1.
- Produces: three working image targets — `migrator` (tsx + drizzle-kit), `web` (standalone runner), and the intermediate `build`. The `runner` and `migrator` stages are unchanged except that they inherit a `node_modules` produced by pnpm.

- [ ] **Step 1: Install pnpm in the base stage**

In `Dockerfile`, find the base stage:
```dockerfile
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
```
Replace it with:
```dockerfile
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
# Pin pnpm globally. We use `npm i -g` rather than corepack: corepack is being
# unbundled from newer Node and its registry-signature checks are a recurring
# CI failure. The version must match packageManager in package.json.
RUN npm install -g pnpm@11.6.0
WORKDIR /app
```

- [ ] **Step 2: Fix the deps stage to use the pnpm lockfile**

Find:
```dockerfile
# ---- dependencies (incl. dev, for build + migrate) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci
```
Replace with:
```dockerfile
# ---- dependencies (incl. dev, for build + migrate) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

- [ ] **Step 3: Fix the build stage's build command**

Find (in the `build` stage):
```dockerfile
RUN npm run build
```
Replace with:
```dockerfile
RUN pnpm run build
```
Leave the `migrator` and `runner` stages unchanged — they invoke `node_modules/.bin/tsx` and `node server.js` directly, not npm.

- [ ] **Step 4: Start Docker and build the runner target**

The Docker daemon is not currently running — start Docker Desktop first, then:
```bash
docker build --target runner -t crm-web-test .
```
Expected: build succeeds through all stages; final line shows the `crm-web-test` image written.

Contingency (only if the copied `node_modules` fails at runtime with missing-module errors): pnpm's symlinked layout can occasionally not survive a cross-stage `COPY`. If so, add `node-linker=hoisted` to `.npmrc` at the repo root and rebuild. Do **not** apply this pre-emptively — the default layout normally copies fine.

- [ ] **Step 5: Build the migrator target**

```bash
docker build --target migrator -t crm-migrate-test .
```
Expected: build succeeds. This is the stage that would break first if `esbuild` (via `tsx`) were mis-installed, so a clean build here confirms Task 0.1 Step 3 worked inside Docker too.

- [ ] **Step 6: Smoke-test that the runner image starts its server**

```bash
docker run --rm crm-web-test node -e "require('fs').accessSync('server.js'); console.log('standalone server present')"
```
Expected: `standalone server present`. (Full boot needs Postgres + env; that is exercised by the deploy, not here.)

- [ ] **Step 7: Commit**

```bash
git add Dockerfile
git commit -m "build(docker): install and use pnpm instead of npm ci

Base stage pins pnpm@11.6.0; deps stage copies pnpm-lock.yaml +
pnpm-workspace.yaml and runs a frozen install; build stage runs pnpm run
build. Fixes a build broken by the deleted package-lock.json. runner and
migrator stages are unchanged (they call tsx/node directly).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.3: Switch the deploy workflow's quality gate to pnpm

**Files:**
- Modify: `.github/workflows/deploy.yml` (the `quality` job only)

**Interfaces:**
- Consumes: `packageManager` from Task 0.1.
- Produces: a green `quality` check named exactly `quality` — Phase 1's branch protection requires this literal name as a required status check.

- [ ] **Step 1: Replace the quality job's setup + steps**

In `.github/workflows/deploy.yml`, find the `quality` job's steps:
```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```
Replace with:
```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.6.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck
      - run: pnpm test
      - run: pnpm run build
```
`pnpm/action-setup` must come **before** `setup-node`, because `cache: pnpm` needs pnpm on PATH to locate the store. Leave the `deploy` job untouched — it runs `docker compose up -d --build`, which now picks up the pnpm Dockerfile automatically.

- [ ] **Step 2: Lint the workflow YAML locally**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml OK')"
```
Expected: `yaml OK`.

- [ ] **Step 3: Commit and push to a branch (NOT main yet)**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): run the quality gate with pnpm

pnpm/action-setup@v4 (pinned 11.6.0) before setup-node with cache: pnpm,
then a frozen install and the lint/typecheck/test/build gate. The deploy
job is unchanged. Job name stays 'quality' — used as a required status
check by branch protection.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify the quality job passes on GitHub before merging**

This is the real end-to-end test of Phase 0 — it runs the pnpm install + build on a clean GitHub-hosted runner.
```bash
git push -u origin <current-branch>
gh pr create --fill --base main
gh pr checks --watch
```
Expected: the `quality` check goes green. Only after it is green, merge:
```bash
gh pr merge --squash
```
Merging to `main` triggers the `deploy` job on the self-hosted runner. Watch it:
```bash
gh run watch
```
Expected: `deploy` succeeds; the server rebuilds the pnpm images and restarts `migrate` + `web`. Confirm the live app: `curl -fsS https://<DOMAIN>/api/health` returns 200.

**Phase 0 is complete when `/api/health` returns 200 after a pnpm-based deploy.**

---

## Phase 1 — Org, teams, CODEOWNERS, branch protection

Turns the review model in CONTRIBUTING.md from convention into GitHub-enforced rules. Several steps are **USER ACTION** (browser-only or require a permission you must grant); they are marked and cannot be automated by an agent.

### Decisions locked for this plan (change here if wrong)

- Org name: **`quandatics`**. Repo renamed **`crm-v2` → `crm`**, giving `quandatics/crm`.
- **Transfer the existing repo** (keeps git history, issues, and the self-hosted runner) rather than creating a fresh one.
- Initial teams: **`core`** (you), **`ops`** (you, for now). Per-module teams are created when a module gets its own contributors — not now.
- Branch protection does **not** enforce on admins initially, so you are not locked out while solo.

### Task 1.1: Create the org and grant `gh` the scope to manage it — USER ACTION

**Files:** none (GitHub-side).

- [ ] **Step 1: Create the organisation (browser only — no CLI exists for this)**

Go to <https://github.com/organizations/plan>, choose the Free plan, and create an org named exactly **`quandatics`**. Set yourself (`JienWeng`) as the owner.

- [ ] **Step 2: Grant `gh` the `admin:org` scope**

Your current token has `read:org` but not `admin:org`, so team/branch-protection API calls will 403 without this:
```bash
gh auth refresh -s admin:org,repo,workflow
```
Follow the browser prompt. Then verify:
```bash
gh auth status | grep -i "scopes"
```
Expected: the scope list now includes `admin:org`.

- [ ] **Step 3: Verify org visibility from the CLI**

```bash
gh api /orgs/quandatics --jq '.login'
```
Expected: `quandatics`.

---

### Task 1.2: Rename and transfer the repo into the org — USER ACTION + CLI

**Files:** none (GitHub-side); afterward the git remote and the server's checkout must be re-pointed.

**Interfaces:**
- Produces: `quandatics/crm` as the canonical repo. Everything downstream (CODEOWNERS teams, branch protection) requires the repo to live in the org.

> **Operational risk — read before running.** Transferring the repo moves its Actions runner registration and changes its URL. The auto-deploy depends on (a) the self-hosted runner still being registered to the moved repo and (b) the server's persistent checkout `git remote` pointing at the new URL. Both are re-pointed below. Expect the deploy to be non-functional for the few minutes between transfer and Step 4. Do this outside a release window.

- [ ] **Step 1: Rename the repo `crm-v2` → `crm`**

```bash
gh repo rename crm --repo JienWeng/crm-v2
```
Expected: confirmation that the repo is now `JienWeng/crm`. (GitHub keeps a redirect from the old name.)

- [ ] **Step 2: Transfer `JienWeng/crm` to the `quandatics` org**

```bash
gh api -X POST /repos/JienWeng/crm/transfer -f new_owner=quandatics
```
Expected: HTTP 202. Confirm:
```bash
gh api /repos/quandatics/crm --jq '.full_name'   # expect: quandatics/crm
```

- [ ] **Step 3: Re-point your local remote**

```bash
git remote set-url origin https://github.com/quandatics/crm.git
git remote -v   # expect origin → quandatics/crm
git fetch origin
```

- [ ] **Step 4: Re-point the server's checkout and confirm the runner (USER ACTION on the server)**

SSH to the deploy box (10.1.10.26) and, in the persistent checkout (`$CRM_DIR`, default `~/crm-v2`):
```bash
cd "${CRM_DIR:-$HOME/crm-v2}"
git remote set-url origin https://github.com/quandatics/crm.git
git pull --ff-only origin main
```
Then in GitHub: **Settings → Actions → Runners** on `quandatics/crm` — confirm the self-hosted runner shows **Idle/online**. If the transfer dropped it, re-register it (Settings → Actions → Runners → New self-hosted runner) using the existing runner directory's `./config.sh` with the new repo URL.

- [ ] **Step 5: Verify auto-deploy still works end-to-end**

Trigger a trivial deploy (e.g. merge Task 1.3's CODEOWNERS PR, or push a whitespace commit) and:
```bash
gh run watch
curl -fsS https://<DOMAIN>/api/health
```
Expected: `deploy` job green, `/api/health` 200 from `quandatics/crm`.

---

### Task 1.3: Create teams and commit CODEOWNERS

**Files:**
- Create: `.github/CODEOWNERS`

**Interfaces:**
- Consumes: org + repo-in-org (Tasks 1.1, 1.2). Team slugs must exist and have repo access **before** CODEOWNERS is committed, or GitHub flags "unknown owner" and cannot satisfy code-owner review.

- [ ] **Step 1: Create the `core` and `ops` teams**

```bash
gh api -X POST /orgs/quandatics/teams -f name=core -f privacy=closed
gh api -X POST /orgs/quandatics/teams -f name=ops  -f privacy=closed
```
Expected: HTTP 201 each. Confirm the slugs:
```bash
gh api /orgs/quandatics/teams --jq '.[].slug'   # expect: core, ops
```

- [ ] **Step 2: Give both teams write+ access to the repo**

```bash
gh api -X PUT /orgs/quandatics/teams/core/repos/quandatics/crm -f permission=admin
gh api -X PUT /orgs/quandatics/teams/ops/repos/quandatics/crm  -f permission=push
```
Expected: HTTP 204 each. (You are already an org owner, so you retain full access regardless.)

- [ ] **Step 3: Write the CODEOWNERS file**

Create `.github/CODEOWNERS` (paths reflect the repo **as it is today**; they are rewritten when the monorepo restructure lands):
```
# Ownership + required reviewers. Teams live in the quandatics org.
# See CONTRIBUTING.md and docs/superpowers/specs/2026-07-17-monorepo-org-structure-design.md

*                              @quandatics/core

# Highest blast radius — migrations & RLS need core review (two, by policy).
/db/migrations/                @quandatics/core
/db/schema/                    @quandatics/core

# The module system's core files.
/lib/                          @quandatics/core
/modules.config.ts             @quandatics/core

# Ops, deployment, CI.
/ops/                          @quandatics/ops @quandatics/core
/docker-compose.yaml           @quandatics/ops @quandatics/core
/Dockerfile                    @quandatics/ops @quandatics/core
/.github/                      @quandatics/core
```
(Per-module lines like `/app/(app)/<x>/  @quandatics/module-<x>` are added when those teams are created — omitted now to avoid unknown-owner warnings.)

- [ ] **Step 4: Validate CODEOWNERS parses cleanly**

Push to a branch and check GitHub's parser:
```bash
git checkout -b chore/codeowners
git add .github/CODEOWNERS
git commit -m "chore(governance): add CODEOWNERS for the quandatics org

Routes all changes to @quandatics/core, with migrations/RLS/schema, the
module-system core files, and ops/CI called out explicitly. Team slugs
resolve now that the repo lives in the org. Per-module ownership lines are
added as those teams are created.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chore/codeowners
gh api /repos/quandatics/crm/codeowners/errors --jq '.errors'
```
Expected: `[]` (empty — no unknown owners, no syntax errors).

- [ ] **Step 5: Merge**

```bash
gh pr create --fill --base main
gh pr merge --squash
```

---

### Task 1.4: Enforce branch protection on `main`

**Files:** none (GitHub API).

**Interfaces:**
- Consumes: the `quality` check name (Task 0.3), CODEOWNERS on `main` (Task 1.3).

- [ ] **Step 1: Apply the protection rule**

```bash
gh api -X PUT /repos/quandatics/crm/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```
Expected: HTTP 200 with the protection object echoed back.

Rationale for the two deliberate settings: `enforce_admins: false` keeps you (solo owner) able to land hotfixes without a second reviewer while the team is just you; flip it to `true` once `core` has more than one member. `required_approving_review_count: 1` + `require_code_owner_reviews: true` is what makes CONTRIBUTING.md's "every PR needs a review" real.

- [ ] **Step 2: Verify the rule is live**

```bash
gh api /repos/quandatics/crm/branches/main/protection --jq '{checks: .required_status_checks.contexts, code_owners: .required_pull_request_reviews.require_code_owner_reviews, linear: .required_linear_history.enabled}'
```
Expected: `{"checks":["quality"],"code_owners":true,"linear":true}`.

- [ ] **Step 3: Prove enforcement with a throwaway PR**

```bash
git checkout -b test/branch-protection
git commit --allow-empty -m "test: verify branch protection blocks unreviewed merge"
git push -u origin test/branch-protection
gh pr create --fill --base main
gh pr merge --squash --admin=false 2>&1 | head -5
```
Expected: merge is **refused** pending required review + the `quality` check. Then clean up:
```bash
gh pr close test/branch-protection --delete-branch
```

- [ ] **Step 4: Record the two-reviewer policy for migrations**

GitHub branch protection cannot require a *different* review count for one path. The "migrations/RLS need two core reviewers" rule (spec §5) is therefore **policy, enforced in review**, not automation. Confirm CONTRIBUTING.md §5 and the design spec §5 already state it (they do) — no code change; this step is a checkpoint so the gap is acknowledged, not forgotten. If it must be automated later, the trigger is a required-reviewers GitHub ruleset or a merge-gating Action.

**Phase 1 is complete when a test PR cannot be merged to `main` without a code-owner review and a green `quality` check.**

---

## Self-Review notes

- **Spec coverage:** Phase 0 covers spec §7 "Blocking problem to fix first" (pnpm in Dockerfile + deploy.yml) and the phase-table row "Phase 0". Phase 1 covers spec §5 (teams, CODEOWNERS, branch protection, the two-reviewer migration policy) and the phase-table row "Phase 1". `outputFileTracingRoot` / standalone-entrypoint changes are **not** here — they belong to Phase 2 (the restructure), correctly out of scope for this plan.
- **No new lockfile, no app-code edits** — every task touches only build/config/governance surfaces, per Global Constraints.
- **Name consistency:** `quality` (job name) is referenced identically in Task 0.3 and Task 1.4. Org `quandatics`, repo `crm`, teams `core`/`ops`, pnpm `11.6.0` are used verbatim throughout.
- **Manual gates are explicit:** org creation (1.1), scope grant (1.1), repo transfer + server re-point (1.2) are marked USER ACTION because no agent can perform them.
