# Monorepo, org structure, and the module contribution model

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation plan
**Scope:** How crm-v2 is organised as a GitHub organisation so that multiple
people can build modules in parallel, module-by-module, on the existing
Dockerised deployment.

---

## 1. Decision

**One monorepo (`quandatics/crm`) in a GitHub organisation. Not multiple repos.**

Modules stay in-tree. Boundaries are enforced by package structure for new
modules, by lint and CODEOWNERS for existing ones. One Docker build, one
migration chain, one deploy — as today.

### Why not multiple repos

Four drivers were raised for splitting: access control, parallel work,
independent release, and per-client module shipping. Measured against this
codebase, none of them survives:

| Driver | Verdict |
|---|---|
| Access control | Requirement is a **merge gate**, not read isolation. CODEOWNERS delivers it in a monorepo at zero cost. Only *read* isolation would force a split, and it is not required. |
| Parallel work | Monorepo is **better**. Conflicts are a same-*file* problem, not a same-*repo* problem. Modules already sit in separate directories with 0–2 cross-imports each. |
| Independent release | **Not available either way.** One Docker image ships to one box; releasing any module rebuilds the image. Real independent release needs runtime plugins or separate services — an architecture change, not a repo change. |
| Ship per client | **Already exists** via `modules.config.ts`. The only gap is that flipping a flag needs a rebuild — and closing that gap is runtime gating, which also needs no repo split. |

The decisive evidence is empirical. Across the last 90 commits:

- **47%** (43/90) touch **two or more business modules**
- **54%** touch the shared kernel (`lib/`, `components/`)
- **27%** touch `db/migrations/`
- The largest single commit spans **21 modules**

Under polyrepo each of those 43 commits becomes a chain of PRs, version bumps,
and lockfile updates across repos. Ordinary feature work — "show per-funnel
stage-approval history" (`approvals` + `funnel`) — would cost days instead of
minutes, and the cross-cutting consistency passes would simply stop happening.

This history is early-stage and refactor-heavy, so the cross-module rate should
fall as the domain settles. But discounting the large sweeps entirely still
leaves ~18 ordinary 2–4 module commits plus a 27% migration-touch rate against
a single FK-linked schema. That is structural, not a phase.

**Reversibility is asymmetric.** Monorepo → polyrepo later is mechanical
(`git filter-repo` a module package out and publish it), and the package
boundaries this design introduces are precisely the extraction seam.
Polyrepo → monorepo means first unwinding version skew and the degraded
interfaces adopted to avoid cross-repo PRs. **Starting monorepo keeps the
option open; starting polyrepo spends it.**

### What would change this decision

Revisit only if one of these becomes true:

- A contributor must be prevented from **reading** core or finance source.
- A module becomes a **separately-sold product** with its own release train and
  its own database.

---

## 2. Folder architecture

```
crm/
├─ apps/
│  ├─ web/                     # Next.js 16 — routes, RSC, server actions
│  │  ├─ app/                  #   incl. thin route shims for packaged modules
│  │  ├─ instrumentation.ts    #   boot check: validateModuleConfig()
│  │  ├─ next.config.ts        #   outputFileTracingRoot + transpilePackages
│  │  └─ package.json
│  └─ worker/                  # jobs, schedules, external integrations
│     ├─ src/jobs/
│     └─ package.json          #   MUST NOT depend on next
├─ packages/
│  ├─ config/                  # modules.config.ts — zero-dependency, pure
│  ├─ db/                      # client, helpers, CORE tables, migrations, RLS sql
│  ├─ schema-registry/         # composed Drizzle barrel (core + all modules)
│  ├─ core/                    # today's lib/ — auth, permissions, registry, scope
│  └─ ui/                      # today's components/
├─ modules/
│  └─ <name>/                  # NEW modules — one workspace package each
│     ├─ schema.ts             #   this module's Drizzle tables
│     ├─ services/             #   next-free business logic
│     ├─ ui/                   #   React components
│     ├─ jobs/                 #   worker jobs, if any
│     └─ package.json
├─ ops/                        # backup scripts, Caddyfile
├─ docker-compose.yaml
├─ Dockerfile                  # targets: web · worker · migrator
└─ pnpm-workspace.yaml
```

### Package dependency direction (must stay acyclic)

```
packages/config      ← (everything; zero deps, pure)
packages/db          ← core tables, client, helpers. Knows nothing about modules.
modules/*/schema.ts  → packages/db
packages/schema-registry → packages/db + every modules/*/schema.ts
apps/web, apps/worker    → packages/schema-registry, packages/core, packages/ui
```

`packages/schema-registry` exists solely to break the cycle that would occur if
`packages/db` imported the modules that import it. Drizzle config points at the
registry.

**Migrations are generated from `packages/schema-registry` but stored in
`packages/db/migrations/`** — generation reads the composed barrel; the
resulting SQL and its journal live with the client that applies them, which
keeps the migrator Docker target's file set unchanged.

### Naming

Two namespaces, deliberately distinct:

- **`@crm/*`** — workspace packages (`@crm/core`, `@crm/db`, `@crm/module-x`).
- **`@quandatics/*`** — GitHub teams (`@quandatics/core`, `@quandatics/module-x`).

### Why `apps/worker` exists

Background jobs and external integrations are not request-driven and must not
import Next.js. They need schema and permissions but not the web app — which is
what makes extracting `packages/db`, `packages/core`, and `packages/config`
worth doing. Without a worker, the extraction would be ceremony.

---

## 3. Invariants

These are the rules that must not break. Each has a verification.

### I1 — One linear migration chain, always fully applied

Migrations are generated from the composed barrel in
`packages/schema-registry` and applied in one order, in full, on every
deployment. **Per-module migration chains are prohibited.**

*Why:* cross-module foreign keys already exist (`finance` → `projects` +
`salesOrders`). Independent chains applied in different orders across
deployments is combinatorial and would break outright. Every new contributor
will want their module to own its chain; the answer is no.

### I2 — Module flags gate access, never data

Per `MODULES.md`'s "disable, don't delete": a disabled module's nav, routes,
actions, and roles-matrix group disappear; its tables, migrations, RLS, and rows
stay intact. Flags gate *access*, never *schema*.

*Verification:* toggling a flag requires no migration and loses no data.

### I3 — No static core→module edge at runtime

With a module's flag `false`, the production build must carry **no import edge**
into its code. Core reaching into a module uses a guarded dynamic import:

```ts
if (isModuleEnabled("x")) {
  const { doThing } = await import("@crm/module-x/services")
  await doThing(...)
}
```

*Exempt:* **schema**. Because of I2, every module's tables exist regardless of
its flag, so `packages/schema-registry` statically importing all module schemas
is correct and intended. I3 governs actions, services, and UI only.

*Verification:* `pnpm typecheck && pnpm build` with the flag `false`.

### I4 — Registration is explicit and core-reviewed

Module metadata, nav entries, and permission groups are registered by hand in
core files, exactly as `MODULES.md` step 1/2/5/6 describes. **Auto-discovery via
a central static registry is prohibited** — it would violate I3 and pull
disabled modules into the bundle.

*Consequence, accepted deliberately:* every new module's PR touches ~4 core
files and therefore requires core review. This is a feature — no module enters
the product without the core maintainer seeing it — but it is a real bottleneck
and is acknowledged as such. See §8 for the deferred fix.

---

## 4. The module contract

`MODULES.md` remains the normative recipe for adding a module and is unchanged.
This design extends it in three ways:

1. **New modules are workspace packages** under `modules/<name>/`, not
   directories under `app/(app)/`. Existing modules stay where they are and
   convert only when someone is already working in them.
2. **Routes are thin shims.** App Router requires route files under `app/`, so
   `apps/web/app/(app)/x/page.tsx` re-exports from `@crm/module-x/ui`. The shim
   carries the `requireModule("x")` guard.
3. **Jobs are declared by the module** under `modules/<name>/jobs/` and
   registered by `apps/worker`, under the same explicit-registration rule as I4.

A module package owns: its schema slice, its next-free services, its UI
components, its jobs. It does **not** own: migrations, the module registry, nav
arrays, the permission catalog, Docker, or CI.

---

## 5. Ownership — who does what

### Teams

| Team | Members | Owns |
|---|---|---|
| `@quandatics/core` | JienWeng + trusted maintainers | `packages/**`, migrations, module registry, Docker, CI, RLS/auth/permissions |
| `@quandatics/module-<x>` | The people building module X | `modules/<x>/**` and X's route shims |
| `@quandatics/ops` | Deployment/infra (initially = core) | `ops/**`, compose, server, backups |

### CODEOWNERS

```
*                              @quandatics/core
/modules/<x>/                  @quandatics/module-<x> @quandatics/core
/apps/web/app/(app)/<x>/       @quandatics/module-<x> @quandatics/core
/packages/                     @quandatics/core
/packages/db/migrations/       @quandatics/core
/packages/config/              @quandatics/core
/docker-compose.yaml           @quandatics/ops @quandatics/core
/ops/                          @quandatics/ops @quandatics/core
/.github/                      @quandatics/core
```

### What each role can merge

- **Module owner** — lands changes inside `modules/<x>/` and X's shims with one
  core approval. Cannot land migrations, schema-registry changes, core edits, or
  config/CI changes alone.
- **Core maintainer** — lands anything, but migrations and RLS changes require a
  second core reviewer (they are the highest-blast-radius change in the repo and
  27% of commits touch them).
- **Ops** — lands compose/ops/server changes with one core approval.

### Branch protection on `main`

- PR required; no direct pushes; no force-push.
- CODEOWNERS review required.
- Status checks green: `lint`, `typecheck`, `test`, `build`.
- Linear history.
- Contributors work on **branches in the repo**, not forks — read access is
  shared by design (merge-gate model, §1).

---

## 6. Contribution workflow

1. Branch from `main`: `<type>/<module>-<short-desc>` (e.g. `feat/inventory-stock-levels`).
2. Build inside your module package. If you need something from another module,
   **stop** — that is a design conversation with core, not an import.
3. Schema change? It goes in your module's `schema.ts`; the migration is
   generated from the registry and reviewed by core (I1).
4. Run locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
5. Verify I3: build once with your module's flag `false`. If the build pulls in
   your code, you have a static edge to remove.
6. Open a PR. CODEOWNERS routes it. Cross-module changes are normal and
   expected — one PR, one review, CI proves the whole thing.
7. Merge to `main` deploys automatically (§7). There is no staging environment.

### Rules for contributors

- **Never** give your module its own migration chain (I1).
- **Never** gate tables on a module flag (I2).
- **Never** statically import another module's services or UI from core (I3).
- **Never** add auto-discovery of modules (I4).
- Keep `modules.config.ts` pure — no imports, no side effects.
- New modules ship with their flag `false` until core turns them on.

---

## 7. Docker, deploy, and CI

### Blocking problem to fix first

The working tree has `package-lock.json` deleted and `pnpm-lock.yaml` /
`pnpm-workspace.yaml` added, but `Dockerfile` still runs `npm ci` against
`package-lock.json*` and `deploy.yml` still uses `cache: npm` + `npm ci`.
Since `npm ci` fails without a lockfile, **committing this as-is breaks the
Docker build and the deploy.** `pnpm-workspace.yaml` also has no `packages:`
key, so it is not yet a workspace. Completing the pnpm migration is step one of
the implementation, not a follow-up.

### Dockerfile changes

Multi-target: `web`, `worker`, `migrator`. Three changes are forced and
non-obvious:

- **pnpm replaces npm** — `corepack enable` + `pnpm install --frozen-lockfile`.
- **`outputFileTracingRoot: path.join(__dirname, '../../')`** in
  `apps/web/next.config.ts`. Per the Next.js 16.2.9 docs, tracing defaults to
  the project directory; without this the standalone build **silently omits**
  everything under `packages/`.
- **The standalone entrypoint moves** to `.next/standalone/apps/web/server.js`.
  The current `CMD ["node", "server.js"]` breaks the moment the app moves down
  a level.

`transpilePackages` lists the workspace packages consumed by `apps/web`.

### Compose

Gains a `worker` service alongside `db`, `migrate`, `web`, `caddy`, `backup`,
`admin`. Worker shares the DB, runs as the RLS-enforced `crm_app` role, and
depends on `migrate` completing.

### Deploy

Unchanged: push to `main` → quality gate on a GitHub-hosted runner → self-hosted
runner on the box → `docker compose up -d --build`. No registry.

### CI

Quality gate runs `lint`, `typecheck`, `test`, `build`, scoped with pnpm
`--filter` to affected packages. `.next/cache` is persisted between builds per
the Next.js CI-caching guide.

**Turborepo is deliberately not adopted.** pnpm filters cover affected-only
builds, and turbo's real payoff is remote caching, which needs infrastructure
this deployment deliberately does not have. Adopt it if CI time becomes painful.

---

## 8. Implementation phases

This spec is too large for a single plan. It decomposes into five phases, each
shippable on its own. **Phases 0 and 1 deliver value immediately and do not
depend on the restructure** — people can start contributing under the rules
before a single file moves.

| Phase | Delivers | Depends on |
|---|---|---|
| **0 — Unbreak the build** | Finish the pnpm migration: add `packages:` to `pnpm-workspace.yaml`, switch `Dockerfile` to `corepack enable` + `pnpm install --frozen-lockfile`, switch `deploy.yml` to pnpm. No restructure. Verify the Docker build and a real deploy. | — |
| **1 — Governance** | GitHub org + teams, `CODEOWNERS`, branch protection, `CONTRIBUTING.md`, and the §3 invariants written into `MODULES.md` / `AGENTS.md`. Zero code movement. | — |
| **2 — Workspace skeleton** | `apps/web` + `packages/{config,db,schema-registry,core,ui}`. `outputFileTracingRoot`, `transpilePackages`, Dockerfile path fixes, standalone entrypoint move. Large and mechanical. | 0 |
| **3 — Worker** | `apps/worker` + its Dockerfile target + compose service. First real job. | 2 |
| **4 — First packaged module** | One new module built as `modules/<name>/` end-to-end, proving the §4 contract. | 2 (3 if it has jobs) |

Phase 1's CODEOWNERS necessarily references the current tree and is rewritten in
Phase 2. That rework is accepted deliberately: governance should not wait on the
restructure, and the paths are a handful of lines.

---

## 9. Deferred, with triggers

| Deferred | Trigger to revisit |
|---|---|
| **Codegen module registry** — generate the registry from `modules.config.ts` so module teams own their own nav/permissions and core touches only one line. Preserves I3 by importing enabled modules only. | 3+ independent module teams, or core review of registrations becomes the bottleneck (§3 I4). |
| **Runtime module gating** — flags move from build-time constant to per-tenant config, so one image serves clients with different modules live. | A client needs modules toggled without a rebuild. |
| **Converting the 7 existing modules to packages** | Opportunistic only — when someone is already working in one. Never as a standalone refactor. |
| **Container registry (GHCR)** | Build-on-box time becomes painful, or a second deployment target appears. |
| **Turborepo** | CI wall-clock hurts. |
| **Staging environment** | More than ~3 contributors landing to `main` per day. |

---

## 10. Out of scope

- Microservices, per-module databases, distributed transactions.
- Separate frontends (customer portal, mobile) — not requested.
- Publishing modules to a registry.
- Any change to the funnel/quotation/approval domain logic.
