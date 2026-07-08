# Backend hardening — self-hosted, fully owned

- **Date:** 2026-07-08
- **Status:** Approved (design) — pending implementation plan
- **Decision:** Do NOT adopt the Supabase app stack. Keep the proven core
  (Better Auth + Entra, Drizzle, `app.current_tenant` GUC RLS, non-privileged
  `crm_app` role) and harden the existing self-hosted Docker deployment.

## 1. Goal

Close the operational gaps around an already-solid deployment so the client can
run and own the CRM confidently: **automated + tested backups**, a safe **DB
admin/visibility** path, and **runtime hardening** — with **zero recurring fees
and no external dependency**.

## 2. Current baseline (what already exists)

`docker-compose.yaml` runs four services:
- **db** — `postgres:17-alpine`, healthcheck, `restart: unless-stopped`, `pgdata` volume.
- **migrate** — builds the app image, applies Drizzle migrations + RLS + views, `restart: "no"`.
- **web** — the Next.js app, `appfiles` volume for uploads, `expose`d, `restart: unless-stopped`.
- **caddy** — `caddy:2-alpine` reverse proxy with **automatic HTTPS** (the proposal's "automatic encryption").

Volumes: `pgdata`, `appfiles`, `caddydata`, `caddyconfig`. File storage is the
**local filesystem** (`lib/storage.ts` → `STORAGE_LOCAL_DIR` on the `appfiles`
volume). Two-role DB access: `DATABASE_ADMIN_URL` (migrations) + `DATABASE_URL`
(`crm_app`, non-privileged, FORCE RLS).

## 3. Non-goals

No Supabase app stack (GoTrue/PostgREST/Realtime/Kong). No auth change. No
managed/hosted DB. No re-platform. Better Auth, Drizzle, and the GUC-based RLS
stay exactly as-is.

## 4. Automated backups + tested restore (priority)

The largest gap today — there is **no** backup mechanism. **Follows the client's
existing Salesforce backup pattern** documented in `System Admin/Power Automate/`
(*"Salesforce Backup Transfer to BO Folder"* + *"Copy Full Data File to Backup
Folder"*): a daily per-object export into a working **Full Data** folder, then a
weekly **dated snapshot** of it — reproduced here for the self-hosted CRM.

- **`backup` service** (new, in `docker-compose.yaml`): the `postgres:17-alpine`
  image (matching client tools) running a foreground sleep-loop scheduler (env
  inherited cleanly — no cron-env pitfalls). Layout on the host-owned `backups`
  volume mirrors theirs (`Full Data` + dated `Data Backup`):
  - **Daily (00:00)** — `ops/backup.sh`:
    1. Per-object CSV export of **every** `public` base table → `/backups/full-data/<table>.csv` (their per-object "Full Data"; human/finance-readable), overwritten each day.
    2. `pg_dump -Fc` full DB → `/backups/full-data/crm.dump` (guaranteed full restore — CSVs alone don't round-trip FKs/types/RLS).
    3. `tar` the `appfiles` volume (mounted **read-only**) → `/backups/full-data/appfiles.tar.gz`.
  - **Weekly (Sun 23:00)** — `ops/weekly-snapshot.sh`: copy `full-data/` → `/backups/archive/<YYYY-MM-DD>/` (their weekly dated snapshot). Prune archives older than **8 weeks**.
- **Destination:** host-owned `backups` volume (bind-mount to a client path).
  **Offsite is optional and client-owned** — since they run M365, the documented
  offsite is a SharePoint/`rclone` push (their "BO Folder" step), off by default.
- **`ops/restore.sh`** (documented, scripted): stop `web`, `pg_restore` a chosen
  dump (default: `full-data/crm.dump`), untar `appfiles`, restart. Refuses to run
  without an explicit target + `--yes` confirmation.
- **Restore verification** — `ops/verify-restore.sh` (weekly): restores the latest
  dump into a throwaway `crm_verify` database, asserts core row counts > 0, drops
  it. Proves the backup restores, not just that a file exists.

## 5. DB admin UI / visibility

- **`pgweb`** (lightweight web DB browser) as a compose service behind
  `profiles: [admin]` — only runs on `docker compose --profile admin up`.
- Bound to **`127.0.0.1` only** (`ports: "127.0.0.1:8081:8081"`), never routed
  through Caddy → reachable solely via SSH tunnel. Connects with a **read-mostly**
  role where practical.
- `npm run db:studio` (drizzle-studio) remains the local-dev option, documented
  alongside.

## 6. File storage

**Keep the filesystem backend** (`lib/storage.ts`, unchanged) — simplest, fully
owned, already working. Its `appfiles` volume is now covered by §4 backups.
**MinIO is a documented future upgrade** (swap the storage adapter to
S3-compatible) if multi-host or S3 semantics are ever needed — not now.

## 7. Runtime hardening

- **`web` healthcheck** hitting `/api/health` (the endpoint already returns 200);
  Caddy/compose only route to a healthy container.
- **Resource limits** (`mem_limit`/`cpus`) + **log rotation**
  (`logging: json-file, max-size, max-file`) on every long-running service.
- **Postgres tuning** — a small `postgresql.conf` overlay (shared_buffers,
  work_mem, `max_connections` aligned to the app pool `max: 10` + migrate).
- **Secrets** — `.env` stays gitignored with `600` perms; documented rotation of
  `BETTER_AUTH_SECRET` / `CRM_APP_PASSWORD`. (Instrumentation already refuses to
  boot in prod on dev-default secret or a superuser/BYPASSRLS app role.)
- **One-command deploy + upgrade** documented (`docker compose up -d --build`
  already migrates; add the healthcheck-gated rollout note).

## 8. Deliverables

- `docker-compose.yaml`: `backup` service, `admin` (pgweb) profile,
  `web` healthcheck, `mem_limit`/`cpus`/`logging` on services, `backups` volume.
- `ops/backup.sh`, `ops/restore.sh`, `ops/verify-restore.sh`.
- `db/postgresql.conf` overlay (mounted into `db`).
- **OPERATIONS.md**: new "Backups & restore" + "Admin access" + "Hardening" sections.
- No application-code change except (optionally) a Dockerfile tweak to include a
  healthcheck client (`wget`/`curl`).

## 9. Verification

- **Backup → restore smoke test (live):** run one backup, `DROP`/restore into a
  scratch DB, confirm core row counts match; untar+diff a sample `appfiles` entry.
- Confirm `pgweb` is reachable only on `127.0.0.1` (not via the public Caddy host).
- Confirm `web` marked healthy; kill the app process and watch it restart.
- Confirm rotation prunes correctly with seeded old timestamps.

## 10. Rollout

Additive and reversible: new services/volumes/scripts only; no schema or
app-logic change. Land it, run the backup→restore smoke test, then document the
runbook. Safe to ship independently of the parked role-grid work.
