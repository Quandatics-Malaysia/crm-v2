# Operations Guide

Everything an operator needs to run, migrate, and toggle this CRM.
Quick reference first; details below.

> **Internal documentation:** `/documentation` is a standalone docs site
> (module guides, Mermaid flow maps, ⌘K full-text search, generated schema
> reference, per-version changelog). It is linked NOWHERE in the app — URL
> only, and only for holders of `docs.view` (Owner/Admin by default; grant
> per role in Team & roles). Kill switch: Settings → General → Behavior →
> "Documentation". Regenerate the schema pages after a migration with
> `pnpm run docs:schema`.

## Cheat sheet

| What | Command |
|---|---|
| Run dev server | `pnpm run dev` (needs Postgres up + migrations applied) |
| Apply DB migrations + RLS + views + permission sync | `pnpm run db:migrate` |
| Seed base data (roles, funnel, tax, demo admin) | `pnpm run db:seed` |
| Seed sample CRM data | `pnpm run db:seed-sample` |
| **Enable/disable an optional module** | edit `modules.config.ts`, then rebuild + redeploy |
| Run tests | `pnpm test` |
| Typecheck / lint / build | `npx tsc --noEmit` · `pnpm run lint` · `pnpm run build` |
| Full stack via Docker | `docker compose up -d --build` (migrate runs automatically) |
| Anything inside the container | `docker compose exec web pnpm run <script>` |

**Golden rule:** after every `git pull` that touches `db/migrations/`, run
`pnpm run db:migrate` before starting the app. `column "…" does not exist`
errors always mean a pending migration.

## Optional modules (plugins)

Everything beyond the core CRM is an optional plugin, toggled **deployment-wide**
in one file — `modules.config.ts` at the repo root — with one boolean each.
See [`MODULES.md`](./MODULES.md) for the architecture and the recipe to add a
brand-new module.

```ts
export const MODULE_CONFIG = {
  projects: false,      // Delivery projects + payment milestones
  salesOrders: false,   // Accepted quote → sales order (needs projects)
  finance: false,       // Billing + Purchasing + intercompany (needs projects + salesOrders)
  forecast: false,      // Probability-weighted billing forecast
  audit: false,         // Audit-log VIEWER (the log is always recorded regardless)
  advancedRoles: false, // Custom roles + permission-matrix editor + seniority tiers
  documentation: true,  // In-app docs
} as const
```

- **One switch, global.** Set a value and **rebuild + redeploy** (`pnpm run build`
  + restart). There is no per-tenant flag anymore — the old
  `pnpm run module:finance` CLI and `tenant_settings.finance_module` column are
  retired (the column is kept but no longer read).
- **Dependencies are validated at boot** (`lib/modules.ts` → `validateModuleConfig`,
  called from `instrumentation.ts`): enabling `finance` without `projects` +
  `salesOrders`, for example, refuses to start with a clear error.
- **Disable, don't delete.** A disabled plugin's nav, routes, actions, and roles-
  matrix group all disappear, but its code, DB tables, and any existing data stay
  intact — flip the flag back on and it returns unchanged.
- **Audit note:** `audit: false` only hides the `/audit` viewer; `writeAudit`
  keeps recording the compliance log, so enabling it later shows full history.
- **Advanced-roles note:** `advancedRoles: false` hides only the role
  *customization* surface (custom roles, the permission-matrix editor, seniority
  tiers). The permission ENGINE always runs, basic role assignment and the
  reporting line stay available, and every permission grant is retained — flip
  it on later and the full role framework returns unchanged.

### Finance module (O2C / P2P add-on)

The Billing + Purchasing document chains — Sales Order → Delivery Order
(optional) → Invoice → Credit Note / Payment Receipt, and SO → RFQ / direct
PO → Purchase Invoice → Payment. Ships **off**. Enable by setting `finance: true`
(and its deps `projects` + `salesOrders`) in `modules.config.ts`, then redeploy.

What ON enables:
- **Streamlined issuance**: Project → Billing tab shows a progress bar
  (invoiced/paid vs value), billed margin, and one-click "Draft invoice" per
  pending milestone — amount, customer, sales order and due date all derived.
- **Document detail pages** (`/billing/<id>`): status actions, the chain,
  attachments and an activity timeline. A payment receipt / supplier payment
  CANNOT be issued without an attached proof.
- **Reminders (in-app)**: overdue invoices surface on the dashboard with
  "Reminder N due" chips based on the schedule in Settings → Numbering →
  Invoice reminders (default 7/14/30 days after due); one click logs it.
- **Intercompany auto-mirror** (toggle in Settings → Behavior): issuing a
  customer invoice on an interco project drafts the pair — your purchase
  invoice from the partner + the partner's sales invoice to you, both for
  the partner share.
- **Auto-complete project** (toggle): all milestones paid → project Completed.
- **Billed margin** on /forecast (invoices − credit notes − purchase invoices).
- Sidebar section **Finance → Billing / Purchasing** (users need the
  `finance.view` permission; Owner/Admin have it automatically, Manager
  gets `finance.manage`).
- Document creation from **approved sales orders**, chained with minted
  numbers (`{ENTITY}INV-0001`, `DO`, `CN`, `RCT`, `RFQ`, `PO`, `PINV`, `PAY`).
- The milestone tie: issuing an invoice marks its payment milestone
  **invoiced**; issuing a receipt settles the invoice and marks the
  milestone **paid**.

What OFF does: hides nav, `/billing` + `/purchasing` redirect to the
dashboard, every finance server action refuses. **Data is retained** —
toggling back on shows everything again.

## Other backend-only knobs (SQL, no UI by design)

| Setting | Where | Effect |
|---|---|---|
| Suspend a tenant | `tenant_settings.status = 'suspended'` | Locks the whole entity (every member loses access) |
| Un-suspend | `tenant_settings.status = 'active'` | Restores access |
| Superadmin | `user.is_superadmin = true` | Bypasses permission checks (break-glass) |

Everything else (currencies, payment terms, milestone template, company
profile, picklists, numbering, automation toggles…) is self-service in
**Settings** for tenant admins.

## Backups & restore

Backups run automatically via the `backup` service (starts with `docker compose
up -d`). It mirrors the client's Salesforce backup flows (see
`System Admin/Power Automate/`): a daily **Full Data** export + a weekly **dated
snapshot**, on the owned `backups` volume.

| What | When | Output (on the `backups` volume) |
|---|---|---|
| Per-object CSV export of every table | daily 00:00 UTC | `full-data/objects/<table>.csv` |
| Full DB dump (restore source of truth) | daily 00:00 UTC | `full-data/crm.dump` |
| Uploaded documents | daily 00:00 UTC | `full-data/appfiles.tar.gz` |
| Dated snapshot of `full-data/` | weekly Sun 23:00 UTC | `archive/<YYYY-MM-DD>/` (kept 8 weeks) |
| Restore-verification (into a scratch DB) | weekly Sun 23:00 UTC | log line `OK — restored … N accounts` |

**Run a backup now / restore / verify (on-demand):**
```bash
docker compose exec backup /ops/backup.sh              # take a backup immediately
docker compose exec backup /ops/verify-restore.sh      # prove the latest dump restores
# RESTORE (destructive — stop web first):
docker compose stop web
docker compose exec backup /ops/restore.sh /backups/full-data/crm.dump --yes
docker compose run --rm migrate                        # re-sync crm_app password + RLS
docker compose start web
```
Copy backups off the host with your own tooling (they're plain files under the
`backups` volume). **Optional offsite:** since you run M365, an `rclone` push of
`backups/` to SharePoint reproduces the "Backup Transfer to BO Folder" step —
left to you so nothing leaves the host unless you configure it.

## Admin access (DB browser)

A `pgweb` DB browser is available behind the `admin` profile, bound to
**localhost only** (never exposed through Caddy). Reach it over an SSH tunnel:
```bash
docker compose --profile admin up -d admin       # start it
ssh -L 8082:127.0.0.1:8082 user@server           # then open http://localhost:8082
docker compose --profile admin down              # stop it when done
```
For local dev, `pnpm run db:studio` (drizzle-studio) is the equivalent.

## Connect a SQL client (VeloxDB / DBeaver / TablePlus)

Postgres is bound to **`127.0.0.1:5433` on the server** (loopback only — never
reachable off-box). To browse it from your workstation, open an SSH tunnel, then
point the client at `localhost`:

```bash
# On your workstation — forward local 5433 → the server's loopback 5433:
ssh -L 5433:127.0.0.1:5433 internalops@<server>
# leave that shell open, then connect the SQL client to:
```

| Field | Value |
|---|---|
| Host | `127.0.0.1` (a.k.a. `localhost`) |
| Port | `5433` |
| Database | `crm` |
| Username | `postgres` (full) or `crm_app` (RLS-enforced, app's view) |
| Password | `POSTGRES_PASSWORD` / `CRM_APP_PASSWORD` from the server `.env` |
| SSL mode | `disable` (traffic is already inside the SSH tunnel) |

`crm_app` sees only what Row-Level Security allows and needs a tenant set
(`SET app.current_tenant = '<org-id>'`); use `postgres` for unrestricted admin
browsing. Close the SSH shell to drop the tunnel when you're done.

## Hardening notes

- **Healthcheck:** `web` is health-gated on `/api/health`; Caddy only routes to a
  healthy container and Docker restarts an unhealthy one.
- **Log rotation:** all services cap logs at 10 MB × 3 files (the `x-logging`
  anchor) so disks don't fill.
- **Resource limits:** `mem_limit:` lines are present but commented in
  `docker-compose.yaml` — uncomment and tune to your host (≥2 GB VPS: db 1g, web 1g).
- **Secrets:** keep `.env` at `chmod 600`, gitignored. Rotate `BETTER_AUTH_SECRET`
  and `CRM_APP_PASSWORD` periodically. Instrumentation refuses to boot in
  production on the dev-default secret or a superuser/BYPASSRLS app role.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `column "…" does not exist` on startup | Pending migrations | `pnpm run db:migrate` |
| Dev terminal spams `GET /dashboard` + `ChunkLoadError` | A browser tab (any device on your LAN) left open across a dev-server restart; its stale HMR client reload-loops | Close or hard-refresh (Cmd+Shift+R) every tab pointing at the dev server |
| `pnpm install --frozen-lockfile` fails in Docker: "lockfile is not up to date" | `pnpm-lock.yaml` wasn't committed after a dependency change | Run `pnpm install` locally, commit the updated `pnpm-lock.yaml`, rebuild |
| Finance pages 404/redirect though flag is on | Master switch off, or user lacks `finance.view` | Check `lib/modules.ts` and the user's role |
| Sign-in works but user sees nothing | Membership `disabled`/`invited`, or tenant suspended | Team page (status) / `tenant_settings.status` |
