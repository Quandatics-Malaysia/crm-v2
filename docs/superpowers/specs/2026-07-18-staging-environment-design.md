# Staging environment — design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Scope:** A single persistent staging environment at `staging.quandatics.com`
so changes can be previewed before they hit production. Same box as prod, fully
namespaced, deployed from a `staging` branch, behind the existing Cloudflare
tunnel and gated by Cloudflare Access.

---

## 1. Problem

`main` is production with **no staging** — every merge ships to
`app.quandatics.com` unseen. A visible change (e.g. the settings restructure)
can only be eyeballed after it's already live. We want a persistent
preview environment that mirrors prod closely enough to trust, at near-zero
extra cost.

Non-goal: per-PR ephemeral previews (Vercel-style). That's a bigger system
(DB-per-PR, wildcard routing, teardown); a single staging env solves the actual
pain and is a clean upgrade path to per-PR later (e.g. Coolify).

## 2. Architecture

One extra Docker Compose stack on the **same box** (`10.1.10.26`), fully
namespaced so it cannot touch prod:

```
                       Cloudflare tunnel (existing, dashboard-managed)
     app.quandatics.com ─────────────► localhost:8081  (prod caddy)  ─► prod web:3000
 staging.quandatics.com ─────────────► localhost:8091  (staging caddy) ─► staging web:3000
   (+ Cloudflare Access policy gating staging.* to the team)

  PROD stack  (project "crm",         ~/crm-v2 @ main)
  STAGING stack (project "crm-staging", ~/crm-v2-staging @ staging)
```

**Isolation is by Compose project + distinct ports + distinct volumes:**

| | Prod | Staging |
|---|---|---|
| Compose project | `crm` (default) | `crm-staging` (`COMPOSE_PROJECT_NAME`) |
| Server checkout | `~/crm-v2` @ `main` | `~/crm-v2-staging` @ `staging` |
| Caddy host port | `8081` | `8091` |
| DB loopback port | `127.0.0.1:5433` | `127.0.0.1:5434` |
| Volumes | `pgdata`, `appfiles`, … | `pgdata-staging`, `appfiles-staging`, … |
| Env file | `.env` | `.env.staging` |
| Public host | `app.quandatics.com` | `staging.quandatics.com` |

A staging container/DB/volume crash is invisible to prod — different names,
networks, and disk. Staging gets `mem_limit`s so it can't starve prod.

## 3. Components

**`docker-compose.staging.yaml`** (new). Mirrors `docker-compose.yaml`'s
services (`db`, `migrate`, `web`, `caddy`, `backup` optional) but with
staging-appropriate ports/volumes. Prefer a thin **override** approach: reuse
the base compose where possible and override only ports, volumes, and
`container_name`s — or a standalone staging compose if overrides get unwieldy.
The Caddyfile is reused as-is (it listens on `:8081` inside the container; only
the host publish differs: `8091:8081` for staging).

**`.env.staging`** (server-only, git-ignored). Same shape as `.env` with:
- `DOMAIN=staging.quandatics.com`, `BETTER_AUTH_URL=https://staging.quandatics.com`, `APP_URL=https://staging.quandatics.com`
- Its **own** `POSTGRES_PASSWORD`, `CRM_APP_PASSWORD`, `BETTER_AUTH_SECRET` (never reuse prod's)
- `SEED_SAMPLE_DATA=true` and a **non-default** `SEED_SAMPLE_PASSWORD`
- `DEMO_ADMIN_PASSWORD` (non-default)
- **No** `MICROSOFT_*` vars — email/password login only.

**`.github/workflows/deploy-staging.yml`** (new). On push to `staging`:
- `quality` job (reuse the same lint/typecheck/test/build gate).
- `deploy-staging` job on the self-hosted runner, **separate concurrency group
  `deploy-staging`** (never cancels/blocks the prod `deploy` group):
  ```
  git -C ~/crm-v2-staging pull --ff-only origin staging
  docker compose -p crm-staging -f ~/crm-v2-staging/docker-compose.staging.yaml \
    --env-file ~/crm-v2-staging/.env.staging up -d --build migrate web caddy
  ```

**`staging` branch** — a long-lived rolling preview branch. Flow:
`feature → merge/push to staging → preview → merge to main → prod`.

## 4. Security

Staging is internet-reachable through the tunnel, and the sample seed mints
**well-known demo credentials** (its own docs warn against internet-exposed
use). Two layers:
1. **Cloudflare Access policy** on `staging.quandatics.com` — email-gate to the
   team so the public never reaches the app at all (uses the Zero Trust setup
   already in place for the tunnel). This is the primary control.
2. **Non-default `SEED_SAMPLE_PASSWORD` / `DEMO_ADMIN_PASSWORD`** in
   `.env.staging` — defense in depth if the Access policy is ever misconfigured.

Prod secrets are never reused on staging (separate `.env.staging`).

## 5. Data lifecycle

Staging DB is **persistent** (own volume). Migrations and the sample seed are
idempotent, so a redeploy applies new migrations without wiping data. A manual
reset is `docker compose -p crm-staging down -v && <redeploy>` when a clean
slate is wanted. No automatic reset on deploy.

## 6. Manual steps (one-time, USER)

These can't be automated (Cloudflare dashboard + server-side secrets):
1. **Cloudflare Zero Trust → the tunnel → Public Hostname:** add
   `staging.quandatics.com` → `http://localhost:8091`.
2. **Cloudflare Zero Trust → Access → Application:** add a policy protecting
   `staging.quandatics.com`, allowing the team's emails.
3. **On the box:** clone a second checkout `~/crm-v2-staging`, `git checkout
   staging`, create `.env.staging` with the values above.
4. (DNS: `staging.quandatics.com` CNAME to the tunnel — usually auto-created by
   the Public Hostname step.)

## 7. Verification

- Push to `staging` → `deploy-staging` runs, `deploy` (prod) does NOT.
- `https://staging.quandatics.com` prompts Cloudflare Access, then serves the
  app; `/api/health` returns 200.
- A demo login (`admin@demo.local` / the staging password) works and shows
  sample data.
- Prod is untouched throughout: `app.quandatics.com/api/health` stays 200; prod
  containers/volumes unchanged (`docker compose -p crm ps` unaffected).
- Deploying staging and prod concurrently doesn't cancel either (separate
  concurrency groups).

## 8. Out of scope

- Per-PR ephemeral previews (future; Coolify is the upgrade path).
- A separate staging box (chosen same-box; revisit if resource contention bites).
- Microsoft Entra on staging (email login only).
- Automatic staging data reset.

## 9. Risks / trade-offs

- **Shared box:** staging load competes with prod. Mitigated by `mem_limit`s;
  revisit with a separate box if it bites.
- **Port/volume drift:** staging must never reuse prod's ports/volumes/project
  name — enforced by the table in §2 and a distinct `.env.staging`.
- **Seed creds on a public host:** mitigated by Cloudflare Access (§4).
