# REST API v1 (read-only, API-key auth) — design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation plan
**Scope:** A versioned, read-only HTTP REST API for the core CRM entities
(leads, accounts, persons, funnels, opportunities, quotations), authenticated by
per-tenant API keys, enforcing the same tenant isolation (RLS) and permissions
as the existing UI. Writes, rate-limit tuning, and webhooks are out of v1.

---

## 1. Problem

The CRM's "API" today is Next.js **server actions** (`"use server"`,
`createLead`, `listLeads`, guarded by `withTenant(PERMISSIONS.LEAD_VIEW, …)`) —
callable only from the app's own React forms, not by scripts or integrations.
There is no programmatic HTTP surface for leads/accounts/funnels/etc. We want a
real, testable REST API so external tools (reporting, integrations, the docs
playground) can read CRM data securely.

## 2. Non-negotiable security model

The API must expose **nothing** the UI wouldn't, for the same caller:

- **Per-tenant API keys.** A key belongs to one tenant + one member; it inherits
  that member's role and effective permissions. A key can never see another
  tenant's data, nor more than its member's role allows.
- **Same RLS path.** Every data read runs inside a tenant-scoped transaction
  (`app.current_tenant`, the non-privileged `crm_app` role) — byte-for-byte the
  same isolation the UI uses. No admin/superuser connection at request time.
- **Same permission gates.** Each endpoint requires the entity's existing
  `PERMISSIONS.*_VIEW` and checks it against the key's effective permissions.
- **Read-only.** v1 has no mutation endpoints — smaller, safer surface.
- **Keys hashed at rest.** Store a SHA-256 hash + a short display prefix; the
  full key is shown exactly once, at creation.

## 3. Architecture

```
  Authorization: Bearer qdk_<random>
        │
        ▼
  getApiContext(req)                      apps/web/lib/api-auth.ts (NEW)
    hash → verify_api_key(hash)  ── SECURITY DEFINER pg fn (bypasses RLS
    → { organizationId, memberId }         safely, returns only the tuple)
    → load member's effective permissions (same query as getServerContext)
    → ServerContext { tenantId, memberId, roleName, permissions }  |  null → 401
        │
        ▼
  withApiTenant(ctx, PERMISSIONS.X_VIEW, (tx, ctx) => reader(tx, ctx, params))
    mirrors withTenant: 403 if !permissions.has(X_VIEW); opens the RLS tx.
        │
        ▼
  shared reader (extracted from the existing list/get action bodies — DRY)
    → JSON
```

**Key resolution under RLS.** The `api_keys` table lookup happens *before* we
know the tenant, so it can't itself be a normal RLS-scoped read. A Postgres
`verify_api_key(p_hash text) RETURNS TABLE(organization_id uuid, member_id uuid)`
function marked **`SECURITY DEFINER`** (owned by the migrator role, `EXECUTE`
granted to `crm_app`) does the lookup, returns only the minimal tuple for a
non-revoked key, and updates `last_used_at`. The app never reads `api_keys`
directly at request time and never uses the superuser connection to serve a
request.

## 4. Data model

New migration (JOURNALED — register in `db/migrations/meta/_journal.json`, per
the repo's journal gotcha):

```
api_keys
  id             uuid pk
  organization_id uuid  not null   -> tenant (FK)
  member_id      uuid  not null    -> the member whose role/perms the key inherits
  name           text  not null    -> human label
  key_prefix     text  not null    -> e.g. "qdk_a1b2" for display/lookup narrowing
  key_hash       text  not null    -> sha256(full key), unique
  created_by     uuid              -> member who minted it
  created_at     timestamptz default now()
  last_used_at   timestamptz
  revoked_at     timestamptz       -> null = active
  RLS: tenant-scoped like other tables (owner/admin manages its own tenant's keys)
```

Plus the `verify_api_key(text)` SECURITY DEFINER function.

## 5. Endpoints (v1)

Base: `/api/v1`. All require `Authorization: Bearer <key>`.

| Resource | List | Detail | Permission |
|---|---|---|---|
| `leads` | `GET /api/v1/leads` | `GET /api/v1/leads/{id}` | `LEAD_VIEW` |
| `accounts` | `GET /api/v1/accounts` | `GET /api/v1/accounts/{id}` | `ACCOUNT_VIEW` |
| `persons` | `GET /api/v1/persons` | `GET /api/v1/persons/{id}` | `PERSON_VIEW` |
| `funnels` | `GET /api/v1/funnels` | `GET /api/v1/funnels/{id}` | `FUNNEL_VIEW` |
| `opportunities` | `GET /api/v1/opportunities` | `GET /api/v1/opportunities/{id}` | `OPPORTUNITY_VIEW` |
| `quotations` | `GET /api/v1/quotations` | `GET /api/v1/quotations/{id}` | `QUOTATION_VIEW` |

(Confirm each `*_VIEW` key exists in `lib/permissions.ts` during implementation;
use the exact constants the matching server actions already use.)

**Implementation shape — a resource registry, not 12 files.** Two catch-all
route files:
- `app/api/v1/[resource]/route.ts` — GET list
- `app/api/v1/[resource]/[id]/route.ts` — GET detail

dispatch via a registry `API_RESOURCES = { leads: { permission, list, get }, … }`
where `list`/`get` are the **shared readers** extracted from the existing action
query bodies. Unknown resource → 404. This keeps the logic in one place and
reuses the existing queries (no duplication).

**List conventions:** `?limit=50&offset=0` (limit capped at 100). Response:
```json
{ "data": [ ... ], "pagination": { "limit": 50, "offset": 0, "total": 123 } }
```
**Detail:** the object, or 404. **Errors:** `{ "error": { "code", "message" } }`
with the right status (400 bad param, 401 missing/invalid key, 403 lacks
permission, 404 not found).

## 6. Key management (minimal, so keys are obtainable/testable)

A **Settings → API Keys** surface (fits the settings sub-nav; gated by
`TENANT_SETTINGS`, i.e. owner/admin):
- `listApiKeys()` — name, prefix, created, last used, status (never the secret).
- `createApiKey(name, memberId?)` — mints a key, returns the **full key once**
  (the UI shows it in a copy-once dialog), stores only the hash + prefix. Default
  the key's member to the creator unless an admin picks another member.
- `revokeApiKey(id)` — sets `revoked_at`.

These are server actions (`withModule`/`withTenant` gated) + a small client page.
UI is intentionally minimal in v1.

## 7. Docs / playground

Add the six resources + the auth header to `docs-site/apis/crm-api.yaml` (a
`securityScheme` of type `http` `bearer`), so the API Playground can call them
with a real key. Add a short "Using the REST API" docs page (get a key, auth
header, pagination, errors). Honest note retained: mutations are server actions,
not REST, in v1.

## 8. Verification

- **Unit tests:** the shared readers (shape), key hashing + `verify_api_key`
  behavior (valid → tuple; revoked → none; unknown → none), the pagination
  clamp, the permission-denied path.
- **Staging test (before prod):** mint a key on staging → `GET /api/v1/leads`
  with it returns 200 + only that tenant's leads; a revoked key returns 401; a
  key whose member lacks `LEAD_VIEW` returns 403; `?limit=1000` is clamped to
  100.
- `pnpm lint/typecheck/test/build` green; Docker builds; deploy staging-first.

## 9. Out of scope (v1)

- Writes (POST/PATCH/DELETE) — added later, each going through the existing
  guarded mutation actions.
- Fine-grained per-key scopes/rate-limit tuning (a basic per-key `last_used_at`
  is recorded; real rate limiting is a follow-up).
- Webhooks / streaming.
- Cursor pagination (offset is fine for v1).

## 10. Risks / trade-offs

- **Outward data surface:** mitigated by read-only + per-tenant key + identical
  RLS/permission path + staging-first rollout. The SECURITY DEFINER function is
  the one privileged element — it returns only `(organization_id, member_id)`
  for a valid key and nothing else.
- **DRY vs. coupling:** extracting shared readers from the action bodies touches
  the existing action files; done carefully (the action keeps calling the same
  reader), it is behavior-preserving for the UI.
- **Key leakage:** shown once, hashed at rest, revocable; a leaked key is
  tenant- and permission-bounded and read-only.
