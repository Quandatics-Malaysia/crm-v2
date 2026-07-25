# Staging Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a persistent staging environment at `staging.quandatics.com` — a second, fully-namespaced Docker stack on the same box, deployed from a `staging` branch, so changes can be previewed before production.

**Architecture:** No separate staging compose file. The two host-published ports in the base `docker-compose.yaml` are env-parameterized (defaults = today's prod values, so prod is unchanged); staging reuses the same compose with `-p crm-staging --env-file .env.staging`, which namespaces every container/volume/network away from prod (`crm-v2`) and publishes staging on 8091/5434. A new `deploy-staging.yml` workflow deploys on push to `staging` from a separate server checkout, in its own concurrency group.

**Tech Stack:** Docker Compose, GitHub Actions (self-hosted runner), Cloudflare Tunnel + Access (dashboard-managed), pnpm.

## Global Constraints

- **Prod must be untouched in behavior.** The only change to `docker-compose.yaml` is parameterizing two host ports with defaults equal to their current literals (`8081`, `5433`) — `docker compose config` with no staging env must render byte-identical published ports to today.
- **Staging never reuses prod's project name, ports, volumes, or secrets.** Project `crm-staging` (via `-p`), ports `8091`/`5434`, `.env.staging` with its own `POSTGRES_PASSWORD`/`CRM_APP_PASSWORD`/`BETTER_AUTH_SECRET`.
- **The `deploy-staging` job uses a distinct `concurrency: group` from the prod `deploy`** so a staging deploy never cancels or is cancelled by a prod deploy.
- **Staging is email/password login only** — no `MICROSOFT_*` vars; `SEED_SAMPLE_DATA=true` with a non-default `SEED_SAMPLE_PASSWORD`.
- Secrets/`.env.staging` and the server checkout are USER manual steps (§ runbook) — the code makes them possible but can't create them.
- pnpm; YAML validated with `python3 -c "import yaml; ..."` and `docker compose config`.
- Commit co-author trailer exactly: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File map

```
docker-compose.yaml            # Task 1: parameterize caddy + db host ports (defaults unchanged)
.gitignore                     # Task 2: add !.env.staging.example exception
.env.staging.example           # Task 2: NEW committed template
.github/workflows/deploy-staging.yml  # Task 3: NEW staging deploy workflow
OPERATIONS.md                  # Task 4: NEW "Staging environment" runbook section
```

The `staging` branch itself is created during execution (final step), not a file.

---

### Task 1: Env-parameterize the two host ports in the base compose

**Files:**
- Modify: `docker-compose.yaml` (the `db` service `ports:` and the `caddy` service `ports:`)

**Interfaces:**
- Produces: `docker-compose.yaml` honoring `DB_HOST_PORT` (default `5433`) and `CADDY_HOST_PORT` (default `8081`); staging sets these to `5434`/`8091` via its env file.

- [ ] **Step 1: Parameterize the db host port**

In `docker-compose.yaml`, the `db` service `ports:` block:
```yaml
    ports:
      - "127.0.0.1:5433:5432"
```
becomes:
```yaml
    ports:
      - "127.0.0.1:${DB_HOST_PORT:-5433}:5432"
```

- [ ] **Step 2: Parameterize the caddy host port**

The `caddy` service `ports:` block:
```yaml
    ports:
      - "8081:8081"
```
becomes:
```yaml
    ports:
      - "${CADDY_HOST_PORT:-8081}:8081"
```

- [ ] **Step 3: Verify prod rendering is unchanged**

Run (no staging env in scope):
```bash
docker compose -f docker-compose.yaml config 2>/dev/null | grep -A2 -E "5432|8081"
```
Expected: published ports still resolve to `127.0.0.1:5433:5432` and `8081:8081` — identical to before. (If Docker daemon is down, instead run `DB_HOST_PORT= CADDY_HOST_PORT= docker compose config` once it's up; the defaults must produce 5433/8081.)

- [ ] **Step 4: Verify staging rendering uses the new ports**

```bash
DB_HOST_PORT=5434 CADDY_HOST_PORT=8091 docker compose -f docker-compose.yaml config 2>/dev/null | grep -A2 -E "5432|8081"
```
Expected: `127.0.0.1:5434:5432` and `8091:8081`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yaml
git commit -m "build(compose): env-parameterize db + caddy host ports (defaults unchanged)

Lets a second stack (staging) publish on different host ports without a
separate compose file. Defaults equal today's prod values, so prod is
unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `.env.staging.example` template + gitignore exception

**Files:**
- Modify: `.gitignore` (add `!.env.staging.example`)
- Create: `.env.staging.example`

**Interfaces:**
- Consumes: the port vars from Task 1 (`DB_HOST_PORT`, `CADDY_HOST_PORT`).
- Produces: a committed template an operator copies to `.env.staging` on the box.

- [ ] **Step 1: Un-ignore the template**

`.gitignore` currently has (around line 33-35):
```
# env files (can opt-in for committing if needed)
.env*
!.env.example
```
Add a line after `!.env.example`:
```
!.env.staging.example
```

- [ ] **Step 2: Write the template**

Create `.env.staging.example` (model it on `.env.example`, but staging-specific):
```bash
# Staging environment — copy to `.env.staging` on the box in the ~/crm-v2-staging
# checkout, fill in the secrets, then deploy via the `staging` branch.
# Staging runs the SAME docker-compose.yaml, namespaced with `-p crm-staging`
# and these different host ports so it never collides with prod on the box.

# --- Staging-only host ports (must differ from prod's 8081 / 5433) ---
CADDY_HOST_PORT=8091
DB_HOST_PORT=5434

# --- Public identity (Cloudflare tunnel routes staging.quandatics.com here) ---
DOMAIN=staging.quandatics.com
BETTER_AUTH_URL=https://staging.quandatics.com
APP_URL=https://staging.quandatics.com

# --- Secrets: generate FRESH, never reuse prod's ---
POSTGRES_PASSWORD=change_me_staging_postgres
CRM_APP_PASSWORD=change_me_staging_crm_app
BETTER_AUTH_SECRET=change_me_run_openssl_rand_base64_32

# --- Seed: staging shows sample data; use a strong non-default password ---
SEED_SAMPLE_DATA=true
DEMO_ADMIN_EMAIL=admin@demo.local
DEMO_ADMIN_PASSWORD=change_me_strong_staging_admin
SEED_SAMPLE_PASSWORD=change_me_strong_staging_sample

# --- Auth mode: email/password only. Leave Microsoft Entra UNSET on staging. ---
# MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID intentionally omitted.

# --- Cloudflare Access gates staging to the team, so ACME/TLS is handled by the
#     tunnel; Caddy serves plain HTTP on the container. ---
ACME_EMAIL=
```

- [ ] **Step 3: Verify the template is now trackable**

```bash
git check-ignore .env.staging.example; echo "exit: $?"
```
Expected: exit `1` (NOT ignored — check-ignore prints nothing and returns 1 when a file is not ignored).

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.staging.example
git commit -m "chore(staging): add .env.staging.example template + gitignore exception

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `deploy-staging.yml` workflow

**Files:**
- Create: `.github/workflows/deploy-staging.yml`

**Interfaces:**
- Consumes: the `crm-staging` project + `.env.staging` on the box (`~/crm-v2-staging`).
- Produces: on push to `staging`, a quality gate then a self-hosted deploy of the staging stack.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/deploy-staging.yml`:
```yaml
# Deploy the STAGING stack on push to the `staging` branch. Mirrors deploy.yml
# but targets a separate server checkout (~/crm-v2-staging) and Compose project
# (crm-staging), in its own concurrency group so it never fights the prod deploy.
name: deploy-staging

on:
  push:
    branches: [staging]

concurrency:
  group: deploy-staging
  cancel-in-progress: false

jobs:
  quality:
    runs-on: ubuntu-latest
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

  deploy-staging:
    needs: quality
    runs-on: self-hosted
    steps:
      - name: Pull latest staging
        run: git -C "${STAGING_DIR:-$HOME/crm-v2-staging}" pull --ff-only origin staging
      - name: Rebuild and restart the staging stack
        run: |
          docker compose \
            -p crm-staging \
            -f "${STAGING_DIR:-$HOME/crm-v2-staging}/docker-compose.yaml" \
            --env-file "${STAGING_DIR:-$HOME/crm-v2-staging}/.env.staging" \
            up -d --build migrate web caddy
```

- [ ] **Step 2: Validate YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-staging.yml')); print('YAML OK')"
```
Expected: `YAML OK`.

- [ ] **Step 3: Confirm distinct concurrency group + branch from prod**

```bash
grep -A1 "concurrency:" .github/workflows/deploy.yml .github/workflows/deploy-staging.yml
grep -A2 "^on:" .github/workflows/deploy.yml .github/workflows/deploy-staging.yml
```
Expected: prod group `deploy` on `main`; staging group `deploy-staging` on `staging` — different groups, different branches.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-staging.yml
git commit -m "ci(staging): deploy-staging workflow on push to the staging branch

Separate server checkout (~/crm-v2-staging), Compose project crm-staging,
and concurrency group so it never cancels the prod deploy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: OPERATIONS runbook for the one-time manual setup

**Files:**
- Modify: `OPERATIONS.md` (add a "Staging environment" section)

**Interfaces:**
- Consumes: everything above.
- Produces: the operator's checklist for the parts code can't do (Cloudflare dashboard + server checkout + secrets), plus the day-to-day flow.

- [ ] **Step 1: Add the section**

Append a `## Staging environment` section to `OPERATIONS.md` documenting:
- **What it is:** `staging.quandatics.com`, same box, project `crm-staging`, ports 8091/5434, deployed from the `staging` branch.
- **One-time setup (USER):**
  1. On the box: `git clone <repo> ~/crm-v2-staging && cd ~/crm-v2-staging && git checkout staging`, then `cp .env.staging.example .env.staging` and fill in fresh secrets (`openssl rand -base64 32` for `BETTER_AUTH_SECRET`; strong values for all passwords).
  2. Cloudflare Zero Trust → the existing tunnel → **Public Hostname**: add `staging.quandatics.com` → `http://localhost:8091`.
  3. Cloudflare Zero Trust → **Access → Applications**: add an application protecting `staging.quandatics.com` with a policy allowing the team's emails (keeps staging private; the sample seed mints demo creds).
  4. Register the self-hosted runner already covers the `staging` branch (same repo runner — no new runner needed).
- **Deploy flow:** `git push origin <feature>:staging` (or merge into `staging`) → `deploy-staging` runs → review at `staging.quandatics.com` → merge to `main` for prod.
- **Reset staging data:** `docker compose -p crm-staging -f ~/crm-v2-staging/docker-compose.yaml --env-file ~/crm-v2-staging/.env.staging down -v` then re-deploy.
- **Guardrail:** staging must keep `CADDY_HOST_PORT=8091` / `DB_HOST_PORT=5434` — never prod's 8081/5433.

- [ ] **Step 2: Verify the section renders**

```bash
grep -nE "^## |^### " OPERATIONS.md | grep -i staging
```
Expected: the new "Staging environment" heading appears.

- [ ] **Step 3: Commit**

```bash
git add OPERATIONS.md
git commit -m "docs(ops): staging environment runbook (Cloudflare + server setup, deploy flow)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Final step (execution, not a file task): create the `staging` branch

After Tasks 1-4 merge to `main`, create the long-lived branch:
```bash
git checkout main && git pull
git checkout -b staging && git push -u origin staging
```
This first push will trigger `deploy-staging` — which will FAIL until the USER has done the one-time server + Cloudflare setup (§ Task 4). That's expected; the workflow is idempotent and re-runs green once `~/crm-v2-staging` + `.env.staging` exist.

---

## Self-Review notes

- **Spec coverage:** §2 isolation (project/ports/volumes) → Task 1 (ports) + `-p crm-staging` in Task 3 (project prefix namespaces volumes); §3 components → Task 1 (compose reuse), Task 2 (`.env.staging`), Task 3 (workflow), final step (`staging` branch); §4 security → Task 2 (non-default seed passwords) + Task 4 (Cloudflare Access runbook); §5 data lifecycle → Task 4 (persistent + reset command); §6 manual steps → Task 4 runbook; §7 verification → Task 1 Steps 3-4 (prod-unchanged), Task 3 Step 3 (distinct concurrency). No spec section unmapped.
- **Deviation from spec (documented):** the spec named a `docker-compose.staging.yaml`; the plan instead env-parameterizes the base compose because Compose *concatenates* `ports` across `-f` override files, which would double-publish and collide 5433 with prod. Env-parameterization is DRYer and avoids that gotcha. Same outcome (namespaced staging stack), fewer files.
- **No placeholders:** every task has exact file paths, exact before/after YAML, and exact verify commands.
- **Prod-safety is the load-bearing invariant** — Task 1 Steps 3-4 explicitly prove the default render is unchanged before anything staging-specific exists.
