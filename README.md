# CRM v2

Quandatics' multitenant CRM for the full lead-to-cash lifecycle.

## [Open the documentation →](https://docs-site-eight-umber.vercel.app)

The documentation portal is the canonical product, module, workflow, API, and
architecture directory.

| Go to | Purpose |
| --- | --- |
| **[Documentation](https://docs-site-eight-umber.vercel.app)** | Central platform directory |
| [Production CRM](https://app.quandatics.com) | Live application |
| [PR Preview (per PR)](https://github.com/Quandatics-Malaysia/crm-v2/actions/workflows/pr-preview.yml) | Temporary preview URL in PR workflow summary/comment |
| [Latest staging deployment](https://github.com/Quandatics-Malaysia/crm-v2/actions/workflows/deploy-staging.yml) | Preview URL in the latest run summary |
| [Module directory](https://docs-site-eight-umber.vercel.app/product/module-directory) | Every capability and its code map |
| [Add a module](https://docs-site-eight-umber.vercel.app/extensibility/adding-a-module) | Placement and integration checklist |
| [Contributing](./CONTRIBUTING.md) | Local setup and review rules |
| [Operations](./OPERATIONS.md) | Private operator runbook |

## Module map

| Domain | Capabilities |
| --- | --- |
| CRM | Leads, Accounts, Contacts |
| Sales | Opportunities, Funnel, Approvals, Products, Quotations, Payment Milestones |
| Delivery | Projects, Sales Orders |
| Finance | O2C, P2P, Intercompany, Forecast |
| Platform | Dashboard, Team & RBAC, Settings, Audit, Documentation, Tenancy & Auth |

## Repository map

```text
crm-v2/
├── apps/
│   └── web/                 Next.js application, routes, services, and database
├── docs-site/               Zudoku product and engineering documentation
├── docs/
│   └── superpowers/         Architecture specs and implementation plans
├── ops/                     Operational scripts and operator notes
├── .github/                 CI, production, and staging workflows
├── CONTRIBUTING.md          Development and review workflow
├── MODULES.md               Optional-plugin contract
└── OPERATIONS.md            Private operator runbook
```

The app itself lives in `apps/web` (a pnpm workspace under the repo root). Local-dev
and CI commands run from the repo **root** — the root `package.json` scripts
delegate to `--filter web`, so you don't need to `cd apps/web`.

## Local development
```bash
cp .env.example .env            # sensible localhost defaults; Microsoft optional for email login
docker compose -f docker-compose.dev.yaml up -d   # local Postgres 17 on :5432 (matches .env.example)
pnpm install
pnpm run db:generate             # (already generated; re-run after schema changes)
pnpm run db:setup                # apply migrations + RLS + views, then seed
pnpm run dev                     # http://localhost:3000
```
> `docker-compose.dev.yaml` runs **only** Postgres for local dev; the app itself runs on the host via `pnpm run dev`. If you already have a Postgres 17 elsewhere, point `DATABASE_URL` (the RLS-enforced `crm_app` role) and `DATABASE_ADMIN_URL` (the superuser, for migrations + seed) at it instead. `crm_app` is created by `db:setup`.
The seed creates a **Demo Entity** and a demo Owner login (printed at the end, default `admin@demo.local` / `Password123!`).

To start with a populated demo (extra logins + sample customers/funnels/quotations) instead of an empty entity, use the seeded setup — same as `db:setup`, plus `db/seed-sample.ts` layered on top:
```bash
pnpm run db:setup-seeded         # migrations + RLS + views + base seed + sample data
```
This adds four more logins under the Demo Entity (all password `Password123!`) and a set of sample customers, contacts, funnels, quotations, a won project, and leads to play with:

| Email | Role | Tier |
| --- | --- | --- |
| `admin@demo.local` | Owner (superadmin) | 100 |
| `manager@demo.local` | Manager | 60 |
| `sales1@demo.local` | Rep | 20 |
| `sales2@demo.local` | Rep | 20 |
| `viewer@demo.local` | Viewer | 10 |

The sample seed is idempotent and **dev-only** — don't run it on an internet-exposed deployment (it mints well-known default credentials). It is intentionally not part of the production Docker `migrate` step.

## PR preview workflow (for each pull request)

Every PR automatically gets a temporary, isolated preview stack built on our self-hosted
runner when this workflow runs:
`.github/workflows/pr-preview.yml`.

- Triggered on PR `opened`, `reopened`, `synchronize`, and `closed`.
- PR open/reopen/sync:
  - builds a per-PR Docker stack (`crm-pr-<number>`)
  - seeds a demo tenant and users
  - publishes a temporary `https://*.trycloudflare.com` URL
  - posts the URL + credentials to the PR comment and workflow step summary
  - checks that login and `/api/health` are healthy before reporting success
- PR close:
  - tears down the preview stack and removes preview volumes.

How to use it:
1. Open/update PR from your feature branch.
2. Open the PR check list and wait for **`deploy-preview`** + PR comment.
3. Use the credentials shown in the comment to sign in at the preview URL.
4. Test the full flow in that temporary stack.
5. Close PR to auto-clean the stack and release resources.

Notes:
- Preview stacks are for validation only; Microsoft SSO is unavailable on the tunnel URL.
- If a preview fails, a fresh push to the same PR re-runs the stack.

## Signed client release images

Client releases come from annotated strict SemVer tags such as `v1.2.3`.
`.github/workflows/release-images.yml` builds Linux AMD64 and ARM64 images for
the web runtime, migrator, and encrypted-backup runtime on GitHub-hosted
runners. It pushes each build by immutable digest first, blocks on High or
Critical Trivy findings, creates an SPDX JSON SBOM and maximum-mode BuildKit
provenance, then signs and verifies the digest with GitHub OIDC and Cosign.
Only verified digests receive the version and source-commit tags.

The workflow publishes a `release-manifest-<tag>` artifact containing each
GHCR repository and digest, source commit, workflow signing identity, and build
time. Client deployment values (`WEB_IMAGE`, `MIGRATOR_IMAGE`, and
`BACKUP_IMAGE`) must come from that manifest and retain the
`ghcr.io/...@sha256:...` form. Tags are discovery labels, never deployment
coordinates. The source-free bundle under `deploy/client/` verifies the exact
workflow identity before pulling any image.

### One-command release run

Run this from the repository root after your normal PRs are merged and CI quality is green:

```bash
rtk scripts/release-one-command.sh --bump patch --rc 1 --wait
```

- `--bump patch|minor|major` picks the next version from the latest stable tag.
- `--rc 1` creates `-rc.1`; omit this for stable release tags.
- `--wait` blocks until `release-images.yml` finishes and downloads the manifest.
- `docs/operations/release-log.md` is updated with every successful run.

Direct manual tag mode:

```bash
rtk scripts/release-one-command.sh --tag v1.2.15 --wait
```

### Versioning and verification log

Open the release log file for every immutable image set used in production:

```text
docs/operations/release-log.md
```

Use `release_tag`, image digests, and `workflow_run` as your authoritative
version record during audits and rollback decisions.

### Playground and sanity checks

- API playground: `https://app.quandatics.com/api-playground`
- Health check: `https://app.quandatics.com/api/health`
- Release metadata page (signed immutable runtime): `https://app.quandatics.com/settings/system`

## Production (Docker, internet-exposed)
```bash
# set these in your shell / .env for compose (REQUIRED — compose fails fast if unset):
#   DOMAIN=crm.example.com  ACME_EMAIL=you@example.com
#   POSTGRES_PASSWORD=…  CRM_APP_PASSWORD=…  BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   PLATFORM_MASTER_EMAIL=… PLATFORM_MASTER_PASSWORD=…  # REQUIRED in prod; never use defaults
#   DEPLOYMENT_ID=<vendor-issued UUID>  AGENT_WEB_SECRET=<canonical base64url 32-byte secret>
#   VENDOR_ENTITLEMENT_TRUST_SET=<vendor-issued public-key JSON>
#   APPLICATION_VERSION=<image SemVer>  MIGRATION_VERSION=<bundled/applied migration, e.g. 0067>
#   BETTER_AUTH_URL=https://crm.example.com  APP_URL=https://crm.example.com
#   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID  # tenant GUID, not "common"
#   BOOTSTRAP_OWNER_EMAIL=you@example.com   # first sign-in becomes Owner
docker compose up -d --build
```
- `caddy` terminates HTTPS (automatic Let's Encrypt for `DOMAIN`) and proxies to `web`.
- `migrate` runs once (migrations → RLS → views → seed), then `web` starts.
- Postgres is internal-only; the app connects (`DATABASE_URL`) as the RLS-enforced, non-privileged `crm_app` role — never the superuser (the app refuses to boot otherwise).
- Deployment-control identity, shared secret, trust set, and release versions are required by Compose and are passed only to `web`; pin versions to the deployed image rather than mutable host defaults.
- Register this Entra redirect URI **exactly** (it must match the code's callback): `${BETTER_AUTH_URL}/api/auth/oauth2/callback/microsoft-entra-id` (e.g. `https://<DOMAIN>/api/auth/oauth2/callback/microsoft-entra-id`).
- Health check: `GET /api/health`.

## Upgrade notes

The following are **intentional** behavior changes from this hardening pass. Operators
upgrading an existing deployment should review them before applying migrations.

- **Existing tenants are not locked out of password login.** Migration `0015` backfills
  `tenant_settings.allow_password_login = true` for every tenant that still had the old
  default of `false`, now that the flag is actually enforced at sign-in. SSO-only stays
  opt-in: a tenant can turn password login back off afterward.
- **`MICROSOFT_TENANT_ID` must be a real directory GUID.** The multi-tenant value
  `common` is no longer accepted (single-tenant hardening); in production the app refuses
  to boot if Entra is configured with `common`. Set your Entra directory (tenant) GUID.
- **The Entra redirect URI changed.** It is now
  `${BETTER_AUTH_URL}/api/auth/oauth2/callback/microsoft-entra-id`; the old `/callback/`
  rewrite was removed. **Re-register this exact URI in the Azure app registration** or
  sign-in will fail.
- **Exactly one superadmin is allowed.** A partial unique index permits a single
  superadmin row. **Before applying migration `0012`, demote any extra superadmins**, or
  the migration will fail. For break-glass, use direct DB access to flip the flag.

## Architecture notes
- **Data access** flows through `withTenant(permission, (tx, ctx) => …)` (`lib/actions.ts`), which authorizes then opens a tenant-scoped transaction.
- **Business rules** live in `server/services/*` (stage/approval state machine, quotation math, lead conversion) — no `next/*` imports, reusable beyond the web layer.
- Middleware (`proxy.ts`) is optimistic-redirect only; real auth is enforced in every Server Action / Route Handler.
