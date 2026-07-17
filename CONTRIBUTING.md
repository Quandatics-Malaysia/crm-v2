# Contributing to CRM v2

This is the day-one guide. Read it once, then keep [`MODULES.md`](./MODULES.md)
open while you work.

> **Note:** this describes the repo **as it is today**. A monorepo restructure
> (`apps/` + `packages/` + `modules/`) is designed and approved — see
> [the design spec](./docs/superpowers/specs/2026-07-17-monorepo-org-structure-design.md).
> Nothing below changes when it lands except *where files live*; the five rules
> stay identical.

---

## 1. Get it running

Follow **[README → Local development](./README.md#local-development)**. Use
`npm run db:setup-seeded` rather than `db:setup` — it gives you sample accounts,
funnels, and quotations to click around, plus four extra logins.

You need a Postgres 17 running somewhere. There is no shared dev database — you
run your own.

## 2. Understand the shape

| To learn… | Read |
|---|---|
| What the product does | [README](./README.md) |
| **The module (plugin) system** — read this before writing anything | [MODULES.md](./MODULES.md) |
| Where the repo is heading (monorepo, teams, ownership) | [Design spec](./docs/superpowers/specs/2026-07-17-monorepo-org-structure-design.md) |
| Running it in production, backups, DB access | [OPERATIONS.md](./OPERATIONS.md) |
| Past security/correctness findings | [AUDIT.md](./AUDIT.md) |
| Rules for AI coding agents | [AGENTS.md](./AGENTS.md) |

Current layout:

```
app/(app)/<module>/     # routes, server actions, module UI
components/             # shared design system (shadcn/Base UI)
lib/                    # shared kernel — auth, permissions, module registry
server/services/        # business rules — MUST NOT import next/*
db/schema/              # Drizzle tables
db/migrations/          # generated SQL — one linear chain
modules.config.ts       # the on/off switch for every optional module
ops/                    # backup scripts, Caddyfile
```

## 3. The five rules

These are invariants. Breaking one is a blocking review comment, not a nit.
Each has a reason and a way to check.

**1 — One migration chain. Never your own.**
All migrations live in `db/migrations/` and apply in one order, in full, on
every deployment. Modules do **not** get their own chains. Cross-module foreign
keys already exist (`finance` → `projects` + `salesOrders`), so independent
chains applied in different orders would break outright.

**2 — Flags gate access, never data.**
"Disable, don't delete." A module's tables, migrations, RLS, and rows exist
regardless of its flag. Turning a module off hides nav, redirects routes, and
refuses actions — it never touches data. Toggling must round-trip with zero loss.

**3 — No static core→module import.**
With a module's flag `false`, the production build must carry no import edge
into its code. When core needs a module, use a guarded dynamic import:

```ts
if (isModuleEnabled("x")) {
  const { doThing } = await import("@/app/(app)/x/actions")
  await doThing(...)
}
```

*Schema is exempt* — because of rule 2, every module's tables always exist, so
`db/schema` importing them is correct. This rule is about actions, services, and UI.

**Check it:** `npm run typecheck && npm run build` with your flag `false`. If
your code gets pulled in, you have a static edge to remove.

**4 — Registration is explicit.**
Module metadata, nav entries, and permission groups are hand-registered in core
files ([`MODULES.md`](./MODULES.md) steps 1, 2, 5, 6). Do **not** add
auto-discovery — a central registry that imports every module violates rule 3
and drags disabled modules into the bundle.

This means every new module touches ~4 core files and needs a core review. That
is deliberate.

**5 — Business rules stay framework-free.**
`server/services/*` must not import `next/*`. Those rules run outside the web
layer (workers, jobs, seeds). Data access goes through
`withTenant(permission, (tx, ctx) => …)`, or `withModule(id, permission, …)` for
a gated module.

## 4. Adding a module

Follow the 9-step recipe in **[MODULES.md → "Developer: add a brand-new module"](./MODULES.md)**.
Ship it with its flag `false`; a core maintainer turns it on.

If you find yourself wanting to import another module's internals — **stop.**
That is a design conversation, not an import.

## 5. Branch → PR → review

```
git checkout -b feat/<module>-<short-desc>
```

Before opening a PR, all four must pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Plus: if you touched a gated module, build once with its flag `false` (rule 3).

**PR checklist**

- [ ] The four checks pass
- [ ] Built with my module's flag `false` (rule 3)
- [ ] No new migration chain (rule 1); migrations are generated, not hand-written
- [ ] No tables gated on a flag (rule 2)
- [ ] `server/services/*` still free of `next/*` (rule 5)
- [ ] Sample seed rows wrapped in `isModuleEnabled(...)` if I added any

Every PR needs a review. Changes to `lib/`, `db/migrations/`, `modules.config.ts`,
Docker, or CI need a **core maintainer**. Migrations and RLS need **two** — they
are the highest-blast-radius change in the repo.

**Cross-module PRs are normal.** Roughly half our commits touch more than one
module. One PR, one review, CI proves the whole thing — that is a large part of
why we stay in one repo.

## 6. Who owns what

| Area | Owner | You need… |
|---|---|---|
| `app/(app)/<module>/` | that module's owner | module owner + core approval |
| `lib/`, `db/`, `modules.config.ts` | core maintainers | core approval |
| `db/migrations/`, RLS | core maintainers | **two** core approvals |
| `ops/`, compose, Dockerfile | ops + core | core approval |
| `.github/` | core maintainers | core approval |

## 7. Deploying

You don't. Merging to `main` deploys automatically: quality gate → self-hosted
runner on the box → `docker compose up -d --build`. **There is no staging
environment** — `main` is production. This is why the checks are not optional.

## 8. Not yet in place

Honest status, so you know what to expect:

- The GitHub org, teams, `CODEOWNERS`, and branch protection are **not set up
  yet** — reviews are by convention until they are.
- The repo is mid-migration from npm to **pnpm workspaces**; the commands above
  become `pnpm` when that lands.
- The `apps/` + `packages/` + `modules/` restructure is designed, not built.
