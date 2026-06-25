# CRM v2

Lightweight, self-hostable multitenant CRM for a services business.
**Next.js 16** (App Router) · **shadcn/ui** (Base UI) · **Better Auth** (Microsoft Entra + email) · **Drizzle ORM** + **PostgreSQL 17** with **Row-Level Security** · **Docker + Caddy**.

## Features
- **Multitenant** — one deployment, many entities; isolation enforced by Postgres RLS (`app.current_tenant`), not just app code.
- **Microsoft Entra** sign-in (single-tenant) + optional per-tenant email/password.
- **RBAC** with seniority tiers and a manager/upline hierarchy.
- **Leads → Accounts → Persons** (accounts have parent hierarchy; persons live under accounts).
- **Funnel** with the 0e/1d/2c/3b/4a/Won/Lost/KIV ladder; **stage-gated approvals** (low-tier users submit a reason + files; upline approves; stage never moves optimistically).
- **Quotations** (services only — description + price), **tax settings**, snapshot-on-send.
- **Billing forecast** — a report-only, net-of-tax, probability-weighted Postgres view.

## Local development
```bash
cp .env.example .env            # fill in secrets (Microsoft optional for email login)
# start a Postgres 17 somewhere and point DATABASE_URL/DATABASE_ADMIN_URL at it
npm install
npm run db:generate             # (already generated; re-run after schema changes)
npm run db:setup                # apply migrations + RLS + views, then seed
npm run dev                     # http://localhost:3000
```
The seed creates a **Demo Entity** and a demo Owner login (printed at the end, default `admin@demo.local` / `Password123!`).

## Production (Docker, internet-exposed)
```bash
# set these in your shell / .env for compose:
#   DOMAIN=crm.example.com  ACME_EMAIL=you@example.com
#   POSTGRES_PASSWORD=…  CRM_APP_PASSWORD=…  BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   BETTER_AUTH_URL=https://crm.example.com  APP_URL=https://crm.example.com
#   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID
#   BOOTSTRAP_OWNER_EMAIL=you@example.com   # first sign-in becomes Owner
docker compose up -d --build
```
- `caddy` terminates HTTPS (automatic Let's Encrypt for `DOMAIN`) and proxies to `web`.
- `migrate` runs once (migrations → RLS → views → seed), then `web` starts.
- Postgres is internal-only; the app connects as the RLS-enforced `crm_app` role.
- Register the Entra redirect URI: `https://<DOMAIN>/api/auth/oauth2/callback/microsoft-entra-id`.
- Health check: `GET /api/health`.

## Architecture notes
- **Data access** flows through `withTenant(permission, (tx, ctx) => …)` (`lib/actions.ts`), which authorizes then opens a tenant-scoped transaction.
- **Business rules** live in `server/services/*` (stage/approval state machine, quotation math, lead conversion) — no `next/*` imports, reusable beyond the web layer.
- Middleware (`proxy.ts`) is optimistic-redirect only; real auth is enforced in every Server Action / Route Handler.
