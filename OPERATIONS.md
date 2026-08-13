# Operations Guide

Everything an operator needs to run, migrate, and toggle this CRM.
Quick reference first; details below.

> The repo root is a thin pnpm workspace; the app source (including
> `modules.config.ts`) lives under `apps/web/`. All `pnpm run …` commands
> below still run from the repo root — they delegate to `--filter web`.

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
| Reset the platform master password | `docker compose run --rm -it migrate pnpm run db:reset-master` |
| **Enable/disable an optional module** | edit `modules.config.ts`, then rebuild + redeploy |
| Run tests | `pnpm test` |
| Typecheck / lint / build | `npx tsc --noEmit` · `pnpm run lint` · `pnpm run build` |
| Source-based local/staging stack | `docker compose up -d --build` (never use for production) |
| Anything inside the container | `docker compose exec web pnpm run <script>` |

**Golden rule:** after every `git pull` that touches `apps/web/db/migrations/`, run
`pnpm run db:migrate` before starting the app. `column "…" does not exist`
errors always mean a pending migration.

## Publish and verify a signed client release

1. From a clean reviewed `main`, run the release helper. It creates the annotated
   strict SemVer tag, starts `release-images`, waits, and records the manifest:

   ```bash
   scripts/release-one-command.sh --bump patch --wait
   ```

2. Watch the `release-images` workflow. It runs only on GitHub-hosted runners
   and uses only the workflow-scoped `GITHUB_TOKEN` plus GitHub OIDC. No
   Cloudflare, registry PAT, or signing private key is accepted by the job.

3. Require all four matrix builds (`web`, `migrator`, `backup`, `agent`) to pass image
   build, Trivy, SPDX SBOM, Cosign signing, and immediate signature
   verification. A failed gate leaves version and commit tags unpublished.

4. Download `release-manifest-v1.2.3`. Confirm its `source_commit` is the tagged
   commit, its `workflow_identity` is exactly
   `https://github.com/Super-ERP/crm-v2/.github/workflows/release-images.yml@refs/tags/v1.2.3`,
   and it lists exactly four `sha256:` digests.

5. Run the protected `deploy-production` workflow with that exact release tag.
   It downloads the source-free bundle, applies the manifest, and runs
   `deploy/client/deploy.sh`. Never deploy a version tag, commit tag, or `latest`
   in place of a manifest digest.

Keep the release manifest, per-image SPDX JSON SBOMs, and Cosign verification
records with release evidence. BuildKit provenance and keyless signatures stay
attached to the immutable GHCR digest. If any image must be rebuilt, issue a
new release tag; do not move or reuse an existing release tag.

## Internal-Ops production deployment

Production is the source-free stack under `/home/internalops/quandatics-client`.
It is deployed only from a signed release through `deploy-production`. The root
`docker-compose.yaml` is for local development, staging, and recovery rehearsal;
it is not the production deployment contract. Do not run `docker compose down -v`
or prune CRM volumes/images during recovery.

Confirm workflow state with `gh workflow list --all`. The self-hosted runner
must be online before production or staging deployment jobs can start.

### Self-hosted runner stuck or offline

When CI shows:
- `deploy` or `deploy-staging` queued for long,
- and GH runners API shows `Internal-Ops-DB` as `offline` or `busy=false`,

run this from the jumpbox:

1. Connect and check runner process:

   ```bash
   ssh internalops@<server> "ps -ef | grep -E 'Runner.Listener|actions/runner' | grep -v grep"
   ```

   Expected: no stale `run.sh`/`Runner.Listener` process if the runner is down.

2. Start or restart the runner in `/home/internalops/actions-runner`:

   ```bash
   ssh internalops@<server> "cd ~/actions-runner && nohup ./run.sh > /tmp/github-runner.log 2>&1 < /dev/null &"
   ```

   Notes:
   - `svc.sh` should manage startup when `sudo` is available on the host.
   - Some hosts register this directory as a systemd service; if available, use:
     `ssh internalops@<server> 'cd ~/actions-runner && sudo ./svc.sh start'`
     (only when it works in your environment).

3. Confirm listener is active and healthy:

   ```bash
   ssh internalops@<server> "tail -n 40 /tmp/github-runner.log"
   ```

   Look for:
   - `Current runner version: ...`
   - `Listening for Jobs`

4. Confirm GitHub now sees the runner and retry or re-run:

   ```bash
   gh api repos/Super-ERP/crm-v2/actions/runners --jq '.runners[] | {name,status,busy}'
   gh run rerun <deploy-run-id>
   ```


### Release log location

The signed release history is written to:

```text
docs/operations/release-log.md
```

`scripts/release-one-command.sh` appends to this file when a release completes.
If the file does not exist, no release has been logged yet in this repository
snapshot.

## Operator workspace: client onboarding and signing

Use the protected control-plane UI at `/operator`; it is vendor-operated, not a
customer or partner self-service surface. Keep the deployment workspace open and
follow its **Deployment signing progress** and **Required action** cards. They
are authoritative for the next safe action.

1. In **Clients**, create the vendor client, add organisation metadata, then
   create a current active contract with the agreed seats and modules. Add the
   target deployment and open its deployment workspace.
2. For an active deployment that is not registered, open **Install
   registration**, select **Issue install token**, and choose a UTC expiry no
   more than 24 hours ahead. Copy it from the one-time result page into only the
   new host's protected `.env` as `INSTALLATION_TOKEN`; do not put it in tickets,
   logs, shell history, or another host. Deploy the approved signed client
   bundle. Registration consumes the token; it cannot be recovered or reused.
3. After **Registered** is shown, save **Entitlement configuration** using a
   current compatible contract, configuration version, channel, minimum app
   version, and optional approved image digest. Select **Review entitlement
   terms**, check the explicit confirmation, then issue the first immutable
   signed version.
4. Confirm **Heartbeat status** is **Online** and **Healthy**. A current healthy
   heartbeat is no more than 30 minutes old; also check application health and
   release identity on the host.

### Signing, renewal, and change control

- Each issued entitlement version is immutable. To re-sign after a contract,
  seats/modules, configuration, channel, supported-version, or approved-digest
  change, update the relevant UI record, return to the deployment workspace,
  review current terms, explicitly issue a new version, then verify a current
  healthy heartbeat.
- Control-plane cron checks every 15 minutes and renews leases that are missing,
  near expiry, materially changed, or signed by any non-current key. It does
  not replace operator review after a commercial or release-control change.
- For renewal attention, review contract dates/status first, then deployment
  configuration and entitlement history. Use **Review entitlement terms** to
  issue an immediate new version when required; never edit entitlement rows or
  signing data directly.

### Diagnose entitlement state

| Workspace state | Meaning | Operator action |
|---|---|---|
| **Unsigned entitlement** | Registration or ready configuration/signing is incomplete. | Follow **Required action**: register, configure, then review and issue. |
| **Stale connection** or **Never connected** | No current healthy heartbeat has acknowledged the deployment. | Check agent health on host, control-plane reachability, and deployment identity; restore heartbeat. |
| **Grace period** | Last valid lease expired; CRM uses cached signed entitlement during its seven-day offline grace period. App health can still be green. | Treat as degraded: inspect contract, cron, agent, and heartbeat; issue/renew only after reviewing current terms. |
| **Read-only licence** | Grace ended or current commercial controls no longer allow writes. | Restore valid contract/configuration and signed entitlement, then verify heartbeat. Do not bypass write protection. |

The workspace never renders signing keys or signed envelopes. Do not work around
that boundary with direct D1 or host-state changes.

### Deploy or recover production

Prefer the protected workflow; it downloads and verifies the source-free bundle:

```bash
gh workflow run deploy.yml --repo Super-ERP/crm-v2 -f release_tag=v1.2.25
gh run list --repo Super-ERP/crm-v2 --workflow deploy.yml --limit 1
```

For an audited manual retry, connect as `internalops`, verify that
`~/quandatics-client/.env` exists with owner-only permissions, then use the
already-verified manifest and scripts from the bundle:

```bash
cd ~/quandatics-client
test -s .env && stat -c '%A %U:%G %n' .env
./apply-release-manifest.sh .env release-manifest.json v1.2.25
./deploy.sh .env
```

Replace the example tag with the intended immutable release. Do not build or
start the root source Compose stack as a production substitute.

### Production demo tenant

Production can host one isolated demonstration tenant without mixing sample
records into customer organizations. Use the stable `demo-entity` ID; the seed
is idempotent and provisions the tenant's default roles, permission mappings,
pipeline, tax configuration, demo members, and fictional CRM records.

```env
DEMO_TENANT_ID=demo-entity
DEMO_TENANT_NAME=Demo Workspace
SEED_SAMPLE_DATA=true
SEED_SAMPLE_PASSWORD=<strong shareable demo password>
```

Run `migrate` after changing these values. Setting `SEED_SAMPLE_DATA=false`
suspends the demo tenant but deliberately retains its records. It does not
delete the tenant. Never change `DEMO_TENANT_ID` on an established deployment
to create disposable tenants; use staging for that purpose.

The platform master is separate from demo users. Configure only
`PLATFORM_MASTER_EMAIL` and `PLATFORM_MASTER_PASSWORD`; legacy
`DEMO_ADMIN_*` variables are compatibility aliases generated by Compose.

The UI theme is a browser preference, not a tenant setting. With no saved
choice, the application starts in dark mode. The header toggle saves
an explicit `light` or `dark` choice in browser `localStorage`.

Every tenant receives a seeded **Developer** role. It has broad business-module
access and `docs.view`, but cannot manage users, roles, tenant settings, or
subscriptions. An active developer consumes one licensed seat like any other
active member; set the membership to `disabled` when access ends to release the
seat without deleting audit/history records.

### Restore automatic deployments only when wanted

Run these from an authenticated workstation. Enable only the workflows that
should be allowed to execute on the Internal-Ops runner:

```bash
gh workflow enable deploy.yml --repo Super-ERP/crm-v2
gh workflow enable deploy-staging.yml --repo Super-ERP/crm-v2
```

Confirm the final state with `gh workflow list --all`. Leaving these workflows
disabled does not prevent the manual startup commands above.

### Pause staging without deleting data

```bash
docker compose -p crm-staging \
  -f ~/crm-v2-staging/docker-compose.yaml \
  -f ~/crm-v2-staging/docker-compose.staging-tunnel.yaml \
  --env-file ~/crm-v2-staging/.env.staging stop

```

`stop` is intentional. It keeps the containers and named volumes available for
the next startup. Production is managed separately by the signed client bundle.

## Optional modules (plugins)

Everything beyond the core CRM is an optional plugin, toggled **deployment-wide**
in one file — `apps/web/modules.config.ts` — with one boolean each.
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

## Staging environment

A source-built preview stack on the same host, fully namespaced as
`crm-staging`, deploys from the `staging` branch. Each deployment creates a new
Cloudflare quick-tunnel URL and writes it to the workflow summary. It is not a
stable hostname. Flow: **feature → `staging` preview → `main` → signed release →
production approval**.

**One-time setup (do once):**

1. **Protected trust set** — create the GitHub `staging` environment and set its
   `STAGING_VENDOR_ENTITLEMENT_TRUST_SET` secret to the vendor-issued public-key
   JSON. The deploy fails closed when this secret is absent or malformed; never
   put a signing private key in GitHub or the web environment.
2. **Server checkout** — clone a second working tree on the `staging` branch and
   create its env file from the template:
   ```bash
   git clone https://github.com/Super-ERP/crm-v2.git ~/crm-v2-staging
   cd ~/crm-v2-staging && git checkout staging
   cp .env.staging.example .env.staging
   # then edit .env.staging: fresh BETTER_AUTH_SECRET (openssl rand -base64 32)
   # and strong, non-default passwords. Keep CADDY_HOST_PORT=8091 / DB_HOST_PORT=5434.
   ```
3. The existing self-hosted runner serves this repository; no second runner is
   required. Protected staging credentials remain on that host and are never
   printed in logs or summaries.

**Deploy:** push or merge into `staging`:
```bash
git push origin <feature-branch>:staging     # or merge a PR into staging
```
`deploy-staging` runs the quality gate, upgrades retained legacy env files with
a stable generated deployment UUID/shared secret, pins versions from the
checked-out package and migration journal, injects the protected public trust
set, then rebuilds the `crm-staging` stack.
Open the quick-tunnel URL from the latest workflow summary, then merge to `main`
only after acceptance. The staging concurrency group never cancels production.

**Reset staging data** (wipe + reseed):
```bash
docker compose -p crm-staging -f ~/crm-v2-staging/docker-compose.yaml \
  --env-file ~/crm-v2-staging/.env.staging down -v
# next push to staging (or a manual `up -d --build`) reseeds it
```

**Guardrail:** staging must always keep `CADDY_HOST_PORT=8091` / `DB_HOST_PORT=5434`
and project `crm-staging` — never prod's `8081`/`5433`/`crm-v2`, or the two stacks
collide on the box.

## Offline grace recovery

`offline grace` means the web runtime is using its last valid signed entitlement
because the deployment agent has not applied a fresh lease. Application health
can remain green during grace, but this is degraded state.

1. Confirm the contract is active and its end date is later than the requested
   lease window.
2. Confirm the control plane is deployed and its cron completed successfully.
3. Confirm production uses `deploy/client/compose.yaml`; the root source Compose
   stack does not run the deployment agent.
4. On the production host, inspect agent health without printing its state or
   credentials:

   ```bash
   cd ~/quandatics-client
   docker compose --profile deploy exec -T agent /usr/local/bin/agent-health
   ```

5. Redeploy the latest verified signed release if the agent service is absent.
   Do not bypass signature, entitlement, or contract checks.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `column "…" does not exist` on startup | Pending migrations | `pnpm run db:migrate` |
| `offline grace` banner | Agent has not applied a fresh signed lease | Follow **Offline grace recovery** above; verify contract, control-plane cron, and agent |
| Dev terminal spams `GET /dashboard` + `ChunkLoadError` | A browser tab (any device on your LAN) left open across a dev-server restart; its stale HMR client reload-loops | Close or hard-refresh (Cmd+Shift+R) every tab pointing at the dev server |
| `pnpm install --frozen-lockfile` fails in Docker: "lockfile is not up to date" | `pnpm-lock.yaml` wasn't committed after a dependency change | Run `pnpm install` locally, commit the updated `pnpm-lock.yaml`, rebuild |
| Finance pages 404/redirect though flag is on | Master switch off, or user lacks `finance.view` | Check `lib/modules.ts` and the user's role |
| Sign-in works but user sees nothing | Membership `disabled`/`invited`, or tenant suspended | Team page (status) / `tenant_settings.status` |
