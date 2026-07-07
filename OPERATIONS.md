# Operations Guide

Everything an operator needs to run, migrate, and toggle this CRM.
Quick reference first; details below.

> **Internal documentation:** `/documentation` is a standalone docs site
> (module guides, Mermaid flow maps, ⌘K full-text search, generated schema
> reference, per-version changelog). It is linked NOWHERE in the app — URL
> only, and only for holders of `docs.view` (Owner/Admin by default; grant
> per role in Team & roles). Kill switch: Settings → General → Behavior →
> "Documentation". Regenerate the schema pages after a migration with
> `npm run docs:schema`.

## Cheat sheet

| What | Command |
|---|---|
| Run dev server | `npm run dev` (needs Postgres up + migrations applied) |
| Apply DB migrations + RLS + views + permission sync | `npm run db:migrate` |
| Seed base data (roles, funnel, tax, demo admin) | `npm run db:seed` |
| Seed sample CRM data | `npm run db:seed-sample` |
| **Enable/disable an optional module** | edit `modules.config.ts`, then rebuild + redeploy |
| Run tests | `npm test` |
| Typecheck / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` |
| Full stack via Docker | `docker compose up -d --build` (migrate runs automatically) |
| Anything inside the container | `docker compose exec web npm run <script>` |

**Golden rule:** after every `git pull` that touches `db/migrations/`, run
`npm run db:migrate` before starting the app. `column "…" does not exist`
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

- **One switch, global.** Set a value and **rebuild + redeploy** (`npm run build`
  + restart). There is no per-tenant flag anymore — the old
  `npm run module:finance` CLI and `tenant_settings.finance_module` column are
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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `column "…" does not exist` on startup | Pending migrations | `npm run db:migrate` |
| Dev terminal spams `GET /dashboard` + `ChunkLoadError` | A browser tab (any device on your LAN) left open across a dev-server restart; its stale HMR client reload-loops | Close or hard-refresh (Cmd+Shift+R) every tab pointing at the dev server |
| `npm ci` fails in Docker: "lock file out of sync" | Lockfile written by a newer npm than the image's | `npx npm@10.9.8 install --package-lock-only`, commit, rebuild |
| Finance pages 404/redirect though flag is on | Master switch off, or user lacks `finance.view` | Check `lib/modules.ts` and the user's role |
| Sign-in works but user sees nothing | Membership `disabled`/`invited`, or tenant suspended | Team page (status) / `tenant_settings.status` |
