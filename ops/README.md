# Ops

Local-server deployment. No cloud services; everything builds and runs on the box.

## Deploys

Push to `main` → `.github/workflows/deploy.yml`:

1. `quality` (GitHub-hosted): `npm ci`, lint, typecheck, test, build.
2. `deploy` (self-hosted runner on the server): `git pull` in the server checkout
   (default `/opt/crm-v2`, override with `CRM_DIR` in the runner env), then
   `docker compose up -d --build migrate web` — the `migrate` one-shot applies
   migrations before `web` restarts.

One-time runner install: repo → Settings → Actions → Runners → New self-hosted
runner, then run it as a service. Docs:
<https://docs.github.com/en/actions/hosting-your-own-runners>
Add the runner user to the `docker` group.

## Backups

The `backup` service runs `scheduler.sh`:

- Daily 00:00 UTC — `backup.sh`: per-table CSVs, `pg_dump -Fc` → `crm.dump`,
  `appfiles.tar.gz`, all in the `backups` volume under `/backups/full-data`.
- Weekly Sun 23:00 UTC — dated snapshot + restore verification.

### Off-box mirror

Set `BACKUP_RSYNC_TARGET` in `.env` (e.g. `user@nas:/backups/crm`). After each
run, `/backups` is mirrored there with `rsync -az --delete`. Unset → skipped.
Setup:

1. Put an SSH key (600 perms) + `known_hosts` for the target in `./ops/ssh/`.
2. Uncomment the `./ops/ssh:/root/.ssh:ro` mount on the `backup` service.
3. `docker compose up -d backup`.

## Restore

```sh
docker compose exec backup /ops/restore.sh /backups/full-data/crm.dump --yes
```

Clean-restores the DB with `pg_restore --clean` and unpacks
`appfiles.tar.gz` into the uploads volume. Stop `web` first; afterwards
`docker compose run --rm migrate` if the `crm_app` password needs re-syncing.

## Monitoring

Point uptime monitoring at `https://<domain>/api/health` (same endpoint the
compose healthcheck uses).
