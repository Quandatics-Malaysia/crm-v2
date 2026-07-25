# Workspace Restructure (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Next.js app into `apps/web` under a pnpm workspace, so the repo is ready for `apps/worker` and `modules/*`, **without changing what production builds or how it boots** except for the mechanically-required path updates.

**Architecture:** A minimal, spec-aligned restructure. The whole app (source + its configs + its `package.json`) moves into `apps/web/`; the repo root becomes a thin pnpm workspace (`packages: [apps/*, packages/*, modules/*]`). The `@/*` alias stays relative (`./*`) inside `apps/web`, so all 294 `@/` imports resolve unchanged. **Package extraction (`packages/db|core|ui`) is deferred** — per the spec's staged approach, existing code converts opportunistically when a worker/module needs it, not in this pass.

**Tech Stack:** pnpm workspaces, Next.js 16 standalone (`outputFileTracingRoot`), Docker multi-stage, GitHub Actions self-hosted deploy.

## Global Constraints

- **Production must keep building and booting.** The only prod-affecting changes are the mechanically-required ones: `outputFileTracingRoot` (so standalone traces the monorepo), the standalone entrypoint path (`.next/standalone/apps/web/server.js`), and Docker/compose build-context + COPY paths. No app behavior, schema, or route changes.
- **The `@/*` alias stays `./*` relative to `apps/web`** — no import rewrites across the 294 files.
- **`modules.config.ts` and `instrumentation.ts` move with the app into `apps/web`** (they're app runtime), and keep working.
- **pnpm workspace root:** `pnpm-workspace.yaml` gets `packages: [apps/*, packages/*, modules/*]`. `pnpm-lock.yaml` regenerates at the root.
- **Defer:** `packages/db`, `packages/core`, `packages/ui`, `packages/config`, `apps/worker`, `modules/*` — NOT in this plan. This plan only creates `apps/web` + the workspace shell.
- **Every task ends green:** `pnpm --filter web run typecheck && pnpm --filter web run build`, and the Docker targets build. Prod-deployability is re-verified before merge (Task 6).
- Commit co-author trailer exactly: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Current → target layout

```
BEFORE (repo root)                    AFTER
  app/ components/ lib/ server/         apps/web/
  db/ hooks/ public/ tests/               app/ components/ lib/ server/ db/ hooks/
  instrumentation.ts proxy.ts             public/ tests/ instrumentation.ts proxy.ts
  modules.config.ts                       modules.config.ts
  next.config.ts tsconfig.json            next.config.ts tsconfig.json
  package.json (the app)                  package.json (the app)  ← moves
  postcss/tailwind/eslint config          <app configs>           ← move
                                        pnpm-workspace.yaml (root: packages)
                                        package.json (root: workspace, thin)
                                        Dockerfile docker-compose*.yaml Caddyfile ops/  ← stay at root
                                        docs/ docs-site/                                ← stay at root
```

Root-level files that STAY at root: `Dockerfile`, `docker-compose*.yaml`, `Caddyfile`, `ops/`, `docs/`, `docs-site/`, `.github/`, `.gitignore`, `README.md` / `CONTRIBUTING.md` / `MODULES.md` / `OPERATIONS.md` / `AGENTS.md` / `AUDIT.md`.

Everything the app needs to build moves into `apps/web/`.

---

### Task 1: Create the workspace shell + move the app into `apps/web`

**Files:**
- Create: `apps/web/` (via `git mv`), root `pnpm-workspace.yaml` (packages), root `package.json` (thin workspace)
- Move: all app source + app configs into `apps/web/`

**Interfaces:**
- Produces: `apps/web/` containing the entire app; a root workspace that resolves `web` as a package.

- [ ] **Step 1: Record a rollback point**

```bash
git rev-parse HEAD   # note this commit — the pre-move state, for rollback
```

- [ ] **Step 2: Move the app source + configs into apps/web (git mv preserves history)**

```bash
mkdir -p apps/web
for p in app components lib server db hooks public tests \
         instrumentation.ts proxy.ts modules.config.ts \
         next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs \
         components.json package.json .env.example; do
  [ -e "$p" ] && git mv "$p" apps/web/ || echo "skip (absent): $p"
done
# tailwind/globals live under app/ already; app/globals.css moved with app/.
# Verify what remains at root vs moved:
git status --short | head -40
```
(Adjust the list to the actual root config filenames — e.g. `postcss.config.js`/`.mjs`, `eslint.config.js`/`.mjs`. `git mv` only what exists.)

- [ ] **Step 3: Root pnpm-workspace.yaml**

Edit root `pnpm-workspace.yaml` to add a `packages` key (keep the existing `allowBuilds`):
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "modules/*"

allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true
```

- [ ] **Step 4: Name the app package + thin root package.json**

In `apps/web/package.json`, set `"name": "web"` (it may currently be `"crm-v2"`). Keep all its scripts/deps as-is.

Create a thin root `package.json`:
```json
{
  "name": "crm-monorepo",
  "private": true,
  "packageManager": "pnpm@11.6.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm --filter web run build",
    "dev": "pnpm --filter web run dev",
    "lint": "pnpm --filter web run lint",
    "typecheck": "pnpm --filter web run typecheck",
    "test": "pnpm --filter web run test",
    "db:migrate": "pnpm --filter web run db:migrate",
    "db:setup": "pnpm --filter web run db:setup",
    "db:setup-seeded": "pnpm --filter web run db:setup-seeded"
  }
}
```
(Move `packageManager` off the app package if you prefer it only at root; keeping it in both is harmless. Mirror the db:* scripts the deploy/runbooks call.)

- [ ] **Step 5: Reinstall at the workspace root**

```bash
rm -rf node_modules apps/web/node_modules
pnpm install
```
Expected: a single root `pnpm-lock.yaml`; `web` recognized as a workspace package (`pnpm --filter web exec node -e "console.log('ok')"` prints `ok`).

- [ ] **Step 6: Commit the move (no config fixes yet — those are Task 2)**

```bash
git add -A
git commit -m "refactor(monorepo): move the Next.js app into apps/web under a pnpm workspace

git mv preserves history; @/ alias stays relative so imports are unchanged.
Config/Docker fixes follow.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fix app configs for the new location

**Files:**
- Modify: `apps/web/next.config.ts` (add `outputFileTracingRoot`), `apps/web/tsconfig.json` (confirm `@/*` → `./*`)

**Interfaces:**
- Consumes: the moved app from Task 1.
- Produces: a `apps/web` that typechecks and builds standalone with the monorepo as the tracing root.

- [ ] **Step 1: outputFileTracingRoot**

In `apps/web/next.config.ts`, add `outputFileTracingRoot` pointing two levels up (to the repo root), so standalone traces workspace files:
```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  serverExternalPackages: ["postgres"],
  allowedDevOrigins: ["192.168.68.100", "10.1.30.86", "localhost"],
};

export default nextConfig;
```

- [ ] **Step 2: Confirm the alias resolves**

`apps/web/tsconfig.json` should still have `"@/*": ["./*"]` (now relative to `apps/web`). No change needed unless it used an absolute base. Verify:
```bash
grep -A2 '"paths"' apps/web/tsconfig.json
```

- [ ] **Step 3: Typecheck + build from the workspace**

```bash
pnpm --filter web run typecheck
pnpm --filter web run build
```
Expected: both pass. Note where standalone landed:
```bash
ls apps/web/.next/standalone/apps/web/server.js
```
Expected: the entrypoint is at `apps/web/.next/standalone/apps/web/server.js` (monorepo tracing nests it under `apps/web/`). Record this path — the Dockerfile depends on it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.ts apps/web/tsconfig.json
git commit -m "build(web): outputFileTracingRoot for the monorepo standalone build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewire the Dockerfile for the workspace

**Files:**
- Modify: `Dockerfile` (all stages)

**Interfaces:**
- Consumes: the workspace + the confirmed standalone entrypoint path from Task 2.
- Produces: `web`, `migrator` image targets that build from the workspace root and boot the app.

- [ ] **Step 1: deps stage — install the whole workspace**

The build context stays the repo root. The deps stage copies the workspace manifests + lockfile and installs:
```dockerfile
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
```

- [ ] **Step 2: build stage — build the web filter**

```dockerfile
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web run build
```

- [ ] **Step 2b: migrator stage — run tsx from apps/web**

The migrate/seed commands run from `apps/web` (that's where `db/` now lives). Update the `migrator` CMD to `cd apps/web` (or prefix paths):
```dockerfile
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
WORKDIR /app/apps/web
CMD ["sh", "-c", "node_modules/.bin/tsx db/migrate.ts && node_modules/.bin/tsx --conditions=react-server db/seed.ts && if [ \"$SEED_SAMPLE_DATA\" = \"true\" ]; then node_modules/.bin/tsx --conditions=react-server db/seed-sample.ts; fi"]
```
(`node_modules/.bin/tsx` resolves via the hoisted workspace `node_modules` or `apps/web/node_modules`; verify tsx is present at `apps/web/node_modules/.bin` after install.)

- [ ] **Step 3: runner stage — copy the nested standalone + start server.js**

The standalone output now nests under `apps/web/`:
```dockerfile
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
```
(The standalone bundle already contains the workspace layout under `/app`, so `apps/web/server.js` is the entrypoint. Verify against the exact path recorded in Task 2 Step 3 and adjust the two `COPY` targets + `CMD` if the trace nested them differently.)

- [ ] **Step 4: Build both targets**

```bash
docker build --target runner -t crm-web-ws .
docker build --target migrator -t crm-migrate-ws .
docker run --rm crm-web-ws node -e "require('fs').accessSync('apps/web/server.js'); console.log('standalone server present')"
```
Expected: both build; `standalone server present` prints.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "build(docker): build apps/web from the workspace; nested standalone entrypoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update compose + deploy references

**Files:**
- Modify: `docker-compose.yaml`, `docker-compose.dev.yaml` (if it references app paths), `.github/workflows/deploy.yml` + `deploy-staging.yml` (quality job workdir)

**Interfaces:**
- Consumes: the Dockerfile from Task 3.
- Produces: compose + CI that build/run the workspace app.

- [ ] **Step 1: compose build contexts**

`docker-compose.yaml` `migrate` and `web` services already `build: { context: ., target: ... }` — context stays repo root, targets unchanged (the Dockerfile handles the paths). Confirm no service references a moved path (e.g. `./Caddyfile` stays; it didn't move). No change expected beyond a comment; verify with `docker compose config`.

- [ ] **Step 2: CI quality job runs the root workspace scripts**

In `deploy.yml` and `deploy-staging.yml`, the `quality` job's `pnpm install --frozen-lockfile` + `pnpm run lint/typecheck/test/build` now run at the repo root, which delegates to `--filter web` via the root `package.json` scripts (Task 1 Step 4). No path change needed if the root scripts exist. Confirm the root `package.json` has `lint`/`typecheck`/`test`/`build`.

- [ ] **Step 3: Verify compose renders**

```bash
POSTGRES_PASSWORD=x CRM_APP_PASSWORD=x BETTER_AUTH_SECRET=x DEMO_ADMIN_PASSWORD=x docker compose -f docker-compose.yaml config >/dev/null && echo "compose OK"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); yaml.safe_load(open('.github/workflows/deploy-staging.yml')); print('workflows YAML OK')"
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yaml docker-compose.dev.yaml .github/workflows/deploy.yml .github/workflows/deploy-staging.yml
git commit -m "build(ci): workspace-aware compose + deploy references

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Update docs + server-runbook for the new layout

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `OPERATIONS.md`, `AGENTS.md` (path references)

**Interfaces:**
- Produces: docs that describe the `apps/web` layout and updated local-dev commands.

- [ ] **Step 1: Update local-dev + structure references**

- `README.md`: local-dev commands now run at repo root (`pnpm install` then `pnpm run db:setup` / `pnpm run dev` — the root scripts delegate to `web`). Note the app lives in `apps/web`.
- `CONTRIBUTING.md`: update the "Current layout" block to the `apps/web` tree; the five rules are unchanged.
- `OPERATIONS.md`: the server checkout still runs `docker compose up -d --build migrate web`; add that the app source is under `apps/web`.
- `AGENTS.md`: the Next.js-docs pointer (`node_modules/next/dist/docs/`) is now under `apps/web/node_modules` — update the path.

- [ ] **Step 2: Verify no stale root-path references**

```bash
grep -rnE "\b(app|components|lib|server)/" README.md CONTRIBUTING.md | grep -vE "apps/web|app/\(app\)|node_modules" | head
```
Expected: nothing that implies those dirs are still at the repo root.

- [ ] **Step 3: Commit**

```bash
git add README.md CONTRIBUTING.md OPERATIONS.md AGENTS.md
git commit -m "docs: update paths for the apps/web workspace layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full verification + staging-first rollout

**Files:** none (verification + rollout).

**Interfaces:** the whole restructure.

- [ ] **Step 1: Green workspace build**

```bash
pnpm install --frozen-lockfile
pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build
```
Expected: all pass from the repo root.

- [ ] **Step 2: Docker build both targets (final)**

```bash
docker build --target runner -t crm-web-final . && docker build --target migrator -t crm-migrate-final .
```
Expected: both succeed.

- [ ] **Step 3: Roll out to STAGING first, not prod**

Push the branch to `staging` (not `main`) so the restructure deploys to the staging stack first:
```bash
git push origin <this-branch>:staging
```
Watch `deploy-staging`; once green, confirm `staging.quandatics.com/api/health` returns 200 and the app boots from the new standalone path. **Only after staging is verified healthy** open the PR to `main`.

- [ ] **Step 4: PR to main**

Open the PR; the `quality` gate runs. Merge only after staging proved the workspace image boots in a real deploy. Watch the prod `deploy` to green + `app.quandatics.com/api/health` 200.

---

## Self-Review notes

- **Spec coverage:** monorepo spec §2 folder architecture → Tasks 1-2 (apps/web + workspace); §7 Docker/deploy changes (pnpm, `outputFileTracingRoot`, standalone entrypoint move) → Tasks 2-4; the spec's staged approach (§ Phase 2) → this plan does ONLY the app move + workspace shell, deferring `packages/*` and `apps/worker` (documented in Global Constraints).
- **Prod-safety is the spine:** no app/schema/route change; the only prod-affecting edits are `outputFileTracingRoot`, the standalone entrypoint path, and Docker/compose paths — each verified by a real `docker build` (Task 3) and a **staging-first rollout** (Task 6 Step 3) before prod.
- **The `@/` alias staying relative** is what avoids touching 294 import sites — called out in Global Constraints and Task 2 Step 2.
- **Uncertainty flagged honestly:** the exact nested standalone path (`.next/standalone/apps/web/server.js`) is *recorded from a real build* in Task 2 Step 3 and the Dockerfile COPY/CMD adjusted to match, rather than assumed — this is the single most likely thing to differ and the plan verifies it empirically.
- **No placeholders:** exact `git mv` list, exact config code, exact Dockerfile stages, exact verify commands.
