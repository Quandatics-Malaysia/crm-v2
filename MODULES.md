# The module (plugin) system

Everything beyond the **core CRM** (leads, accounts, contacts/persons,
opportunities, funnel + stage-gated approvals, quotations, tax, products,
pipeline dashboard, RBAC/Team) is an **optional plugin**, switched on or off
for the whole deployment by **one boolean** in
[`modules.config.ts`](./modules.config.ts).

Guiding principle: **disable, don't delete.** A disabled plugin's nav, routes,
server actions, and roles-matrix group all disappear, but its code, DB tables,
migrations, RLS, and any existing rows stay intact. Flip the flag back on and
the feature returns exactly as it was.

Current plugins: `projects`, `salesOrders`, `finance` (billing + purchasing +
intercompany), `forecast`, `audit` (the log viewer), `documentation`.

---

## The 6 moving parts

| File | Role |
|---|---|
| [`modules.config.ts`](./modules.config.ts) | **The switches.** One boolean per plugin. Pure/import-free so client, server, next-free services, and seed scripts can all read it. |
| [`lib/modules.ts`](./lib/modules.ts) | **The registry.** `ModuleId` type (auto-derived from the config keys), the `MODULES` metadata + **dependency graph**, and the gate functions: `isModuleEnabled` / `assertModuleEnabled` / `validateModuleConfig`. |
| [`lib/module-guard.ts`](./lib/module-guard.ts) | **Route guard.** `requireModule(id)` → `redirect("/dashboard")` when the plugin is off. `server-only`. |
| [`lib/actions.ts`](./lib/actions.ts) | **Action guard.** `withModule(id, permission, fn)` = `assertModuleEnabled` then the normal tenant/RLS-scoped `withTenant`. |
| [`instrumentation.ts`](./instrumentation.ts) | **Boot check.** Runs `validateModuleConfig()` on startup and **refuses to boot** if a plugin is on but a dependency is off (in every environment, not just prod). |
| Nav + permissions | [`components/app-sidebar.tsx`](./components/app-sidebar.tsx), [`components/command-palette.tsx`](./components/command-palette.tsx) tag items with `module?: ModuleId`; [`lib/permissions.ts`](./lib/permissions.ts) tags each roles-matrix group. All are filtered by `isModuleEnabled`. |

The dependency graph is code, not config, so operators can't misconfigure it:

```
salesOrders → projects
finance      → projects, salesOrders
(projects, forecast, audit, documentation have no deps)
```

---

## Operator: enable/disable an existing module

1. Edit [`modules.config.ts`](./modules.config.ts) — set the flag (and any
   dependencies it needs; the app validates this at boot).
2. **Rebuild + redeploy** (`npm run build` + restart, or `docker compose up -d
   --build`). There is no per-tenant flag and no CLI — the config file is the
   single source of truth.
3. Nothing else. No migration, no data change. Enabling later shows all
   retained data; disabling hides the feature without touching it.

> **Boot safety net:** enabling `finance` without `projects`+`salesOrders`
> makes the server refuse to start with a message naming exactly what to fix.

---

## Developer: add a brand-new module `X` from scratch

The "ingestion" recipe — every step is a small, local edit:

1. **Declare the switch.** Add `x: false` to `MODULE_CONFIG` in
   `modules.config.ts`. The `ModuleId` union and `MODULE_IDS` pick it up
   automatically — no other type wiring.

2. **Register metadata + deps.** Add to `MODULES` in `lib/modules.ts`:
   ```ts
   x: { id: "x", label: "X", dependsOn: [/* e.g. "projects" */] },
   ```
   `validateModuleConfig()` now enforces those deps at boot for free.

3. **Guard the routes.** First line of every `app/(app)/x/**/page.tsx`
   (and any `layout.tsx`):
   ```ts
   import { requireModule } from "@/lib/module-guard"
   // inside the async component, before any data fetch:
   requireModule("x")
   ```

4. **Guard the server actions.** Swap `withTenant(...)` → `withModule("x", ...)`
   for X's actions (defense in depth behind the hidden nav + route redirect).
   For an action that doesn't use `withTenant`, put `assertModuleEnabled("x")`
   as its first line.

5. **Tag the nav.** Add `module: "x"` to X's item(s) in the nav arrays of
   `components/app-sidebar.tsx` and `components/command-palette.tsx`. The
   layout already computes the on/off map from `MODULE_IDS`, so the items
   filter themselves.

6. **Tag the roles-matrix group.** Add `module: "x"` to X's group in
   `ALL_GROUPS` in `lib/permissions.ts`. **Keep X's permission keys in
   `ALL_PERMISSION_KEYS`** so grants survive toggling; `PERMISSION_LABELS` is
   built from the unfiltered list so denials still render a label when off.

7. **Break any core→X static edge.** If core (or a next-free service) must call
   into X, do NOT statically import it — use a guarded dynamic import so core
   carries no build-time dependency on the plugin:
   ```ts
   if (isModuleEnabled("x")) {
     const { doThing } = await import("@/app/(app)/x/actions")
     await doThing(...)
   }
   ```
   (See `server/services/value.ts`, `stage.ts`, `quotations/actions.ts`,
   `funnel/actions.ts` for the existing examples.)

8. **Partition the seed.** Wrap any X sample rows in
   `if (isModuleEnabled("x")) { ... }` in `db/seed-sample.ts`, so a core-only
   seed produces zero orphan rows.

9. **Schema stays.** X's tables live in `db/schema` with migrations + RLS as
   usual. Per "disable, don't delete," they are created regardless of the flag;
   the flag only gates *access*, never *data*.

**Verify:** `npm run typecheck && npm run build` with `x: false` (proves core
has no static edge into X), then flip `x: true` (+deps) and smoke-test that the
routes serve and the nav appears. `npm run test` for any pure logic.

---

## Why it's safe

- **One switch, boot-validated.** Dependencies can't be misconfigured — the app
  won't start on an inconsistent config.
- **No static coupling.** With a plugin off, the production build carries no
  import edge into its code (the guarded dynamic imports are the seam).
- **Reversible by construction.** Off = access gated (nav hidden, routes
  redirect, actions refuse, roles group hidden). Data, schema, and numbering are
  untouched, so on ⇄ off round-trips with zero loss.
