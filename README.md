# CRM v2

Lightweight, self-hostable multitenant CRM for a services business.
**Next.js 16** (App Router) · **shadcn/ui** (Base UI) · **Better Auth** (Microsoft Entra + email) · **Drizzle ORM** + **PostgreSQL 17** with **Row-Level Security** · **Docker + Caddy**.

> **Joining the team?** Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)** — setup, the five rules that keep the module system working, and how to open a PR.

## Features
- **Multitenant** — one deployment, many entities; isolation enforced by Postgres RLS (`app.current_tenant`), not just app code.
- **Microsoft Entra** sign-in (single-tenant) + optional per-tenant email/password.
- **RBAC** with seniority tiers and a manager/upline hierarchy.
- **Leads → Accounts → Persons** (accounts have parent hierarchy; persons live under accounts).
- **Funnel** with the 0e/1d/2c/3b/4a/Won/Lost/KIV ladder; **stage-gated approvals** (low-tier users submit a reason + files; upline approves; stage never moves optimistically).
- **Quotations** (services only — description + price), **tax settings**, snapshot-on-send.
- **Billing forecast** — a report-only, net-of-tax, probability-weighted Postgres view.

## Documentation

| Doc | What's in it |
|---|---|
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | **Start here.** Day-one setup, the five invariants, the PR checklist, who reviews what. |
| [MODULES.md](./MODULES.md) | The module (plugin) system — enabling/disabling a module, and the 9-step recipe for adding one. |
| [OPERATIONS.md](./OPERATIONS.md) | Production: cheat sheet, backups & restore, DB access, hardening, troubleshooting. |
| [AUDIT.md](./AUDIT.md) | Security & correctness audit — what was found, fixed, and consciously deferred. |
| [AGENTS.md](./AGENTS.md) | Rules for AI coding agents working in this repo. |
| [docs/superpowers/specs/](./docs/superpowers/specs/) | Architecture decisions. Current: [monorepo, org structure, and the module contribution model](./docs/superpowers/specs/2026-07-17-monorepo-org-structure-design.md). |

## Local development
```bash
cp .env.example .env            # fill in secrets (Microsoft optional for email login)
# start a Postgres 17 somewhere. DATABASE_ADMIN_URL = the superuser (migrations +
# seed); DATABASE_URL = the non-privileged, RLS-enforced crm_app role the app
# connects as (crm_app is created by db:setup).
npm install
npm run db:generate             # (already generated; re-run after schema changes)
npm run db:setup                # apply migrations + RLS + views, then seed
npm run dev                     # http://localhost:3000
```
The seed creates a **Demo Entity** and a demo Owner login (printed at the end, default `admin@demo.local` / `Password123!`).

To start with a populated demo (extra logins + sample customers/funnels/quotations) instead of an empty entity, use the seeded setup — same as `db:setup`, plus `db/seed-sample.ts` layered on top:
```bash
npm run db:setup-seeded         # migrations + RLS + views + base seed + sample data
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

## Production (Docker, internet-exposed)
```bash
# set these in your shell / .env for compose (REQUIRED — compose fails fast if unset):
#   DOMAIN=crm.example.com  ACME_EMAIL=you@example.com
#   POSTGRES_PASSWORD=…  CRM_APP_PASSWORD=…  BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   DEMO_ADMIN_PASSWORD=…   # REQUIRED in prod; must NOT be the default Password123!
#   BETTER_AUTH_URL=https://crm.example.com  APP_URL=https://crm.example.com
#   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID  # tenant GUID, not "common"
#   BOOTSTRAP_OWNER_EMAIL=you@example.com   # first sign-in becomes Owner
docker compose up -d --build
```
- `caddy` terminates HTTPS (automatic Let's Encrypt for `DOMAIN`) and proxies to `web`.
- `migrate` runs once (migrations → RLS → views → seed), then `web` starts.
- Postgres is internal-only; the app connects (`DATABASE_URL`) as the RLS-enforced, non-privileged `crm_app` role — never the superuser (the app refuses to boot otherwise).
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
