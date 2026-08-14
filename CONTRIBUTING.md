# Contributing to CRM v2

This is the day-one guide. Read it once, then keep [`MODULES.md`](./MODULES.md)
open while you work.

> **Note:** the `apps/` workspace restructure has landed — the app now lives
> under `apps/web/`, with the repo root as a thin pnpm workspace. `packages/`
> and `modules/` are reserved in `pnpm-workspace.yaml` for later phases — see
> [the design spec](./docs/superpowers/specs/2026-07-17-monorepo-org-structure-design.md).
> Only *where files live* changed; the five rules stay identical.

---

## 1. Get it running

Follow **[README → Local development](./README.md#local-development)**. Use
`pnpm run db:setup-seeded` rather than `db:setup` — it gives you sample accounts,
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

Current layout — the repo root is a thin pnpm workspace; the app lives under
`apps/web/`:

```
apps/web/app/(app)/<module>/   # routes, server actions, module UI
apps/web/components/           # shared design system (shadcn/Base UI)
apps/web/lib/                  # shared kernel — auth, permissions, module registry
apps/web/server/services/      # business rules — MUST NOT import next/*
apps/web/db/schema/            # Drizzle tables
apps/web/db/migrations/        # generated SQL — one linear chain
apps/web/modules.config.ts     # the on/off switch for every optional module
ops/                           # backup scripts, Caddyfile (repo root)
```

## 3. The five rules

These are invariants. Breaking one is a blocking review comment, not a nit.
Each has a reason and a way to check.

**1 — One migration chain. Never your own.**
All migrations live in `apps/web/db/migrations/` and apply in one order, in full, on
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

**Check it:** `pnpm run typecheck && pnpm run build` with your flag `false`. If
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

Follow the 10-step recipe in **[MODULES.md → "Developer: add a brand-new module"](./MODULES.md)**.
Ship it with its flag `false`; a core maintainer turns it on.

If you find yourself wanting to import another module's internals — **stop.**
That is a design conversation, not an import.

## 5. Branch → PR → review

```
git checkout -b feat/<module>-<short-desc>
```

Before opening a PR, all four must pass:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Plus: if you touched a gated module, build once with its flag `false` (rule 3).

**PR checklist**

- [ ] The four checks pass
- [ ] Built with my module's flag `false` (rule 3)
- [ ] No new migration chain (rule 1); migrations are generated, not hand-written
- [ ] No tables gated on a flag (rule 2)
- [ ] `server/services/*` still free of `next/*` (rule 5)
- [ ] Sample seed rows wrapped in `isModuleEnabled(...)` if I added any

Every PR needs a review. Changes to `apps/web/lib/`, `apps/web/db/migrations/`, `apps/web/modules.config.ts`,
Docker, or CI need a **core maintainer**. Migrations and RLS need **two** — they
are the highest-blast-radius change in the repo.

Use the protected staging environment for browser validation when the change
cannot be proved by automated tests alone. Credentials stay in the protected
environment and must never be pasted into PR comments or workflow summaries.

**Cross-module PRs are normal.** Roughly half our commits touch more than one
module. One PR, one review, CI proves the whole thing — that is a large part of
why we stay in one repo.

## 6. Who owns what

| Area | Owner | You need… |
|---|---|---|
| `app/(app)/<module>/` | that module's owner | module owner + core approval |
| `apps/web/lib/`, `apps/web/db/`, `apps/web/modules.config.ts` | core maintainers | core approval |
| `apps/web/db/migrations/`, RLS | core maintainers | **two** core approvals |
| `ops/`, compose, Dockerfile | ops + core | core approval |
| `.github/` | core maintainers | core approval |

## 7. Deploying

Deployments are automated. Pushing to `main` runs the quality gate and
rebuilds the isolated staging stack; its temporary public URL is published in
that workflow run's summary. Production is separate: create a signed release,
then approve the `deploy-production` workflow. The normal path is **feature
branch → `main` → signed release → production approval**.

## 8. Status of the setup

What's in place:

- The public repo lives in the **`Super-ERP`** GitHub org, with `core` and
  `ops` teams and `CODEOWNERS` routing reviews to them where assigned.
- **CI runs on every PR** (`quality`: lint · typecheck · test · build) and the
  PR template lists the checklist above.

Repository rules must require green CI and a `@Super-ERP/core` review
before merge. Verify the active ruleset in GitHub after changing workflow names.

Not built yet:

- The `apps/` **workspace** restructure has landed (the app is under
  `apps/web/`); the `packages/` and `modules/` layers of the design are still
  reserved, not built.

## 9. External developer workflow

External integration developers may read the public source, but never receive
production-runtime access through repository access. Production access and support
scope remain separate.
Use one of these lanes:

### Lane A — Source contributor

For a developer changing CRM code:

- Fork the public repository, or use a branch when team write access is required.
- Branch from latest `main` using `feat/<short-feature>`.
- Never commit secrets (`.env`, cloud keys, certificates, DB passwords).
- Before PR, run `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, and
  `pnpm run build`.
- Open a PR, validate in protected staging when needed, and wait for core review.
- Never use `app.quandatics.com` as a development environment.

### Lane B — API-only integration developer

For a partner integrating only through supported contracts:

- Use the public [external developer guide](https://github.com/Super-ERP/docs/tree/main/pages/external-developers/overview.mdx).
- Receive a tenant-scoped API key from **Settings → API Keys**.
- Use a staging or sandbox tenant, never production credentials.
- Use the documented REST API and API playground.
- Route support and acceptance evidence through Quandatics.

Current API v1 is read-only. It cannot create leads, update funnels, send
quotations, or change users. Do not automate the UI to bypass this boundary.

### Lane C — Future plugin partner

External plugin packaging is not implemented yet. The `modules/` workspace is
reserved for a future SDK boundary. Until then, use the API lane or submit a
normal source contribution.

All production merges remain routed through `@Super-ERP/core`.
