# CRM-v2 Security & Correctness Audit — Remediation Record

A full audit of the codebase (linkage gaps, business-logic flaws, and improvements)
was run, followed by a remediation pass. This document records what was found, what
was changed, and what was consciously deferred.

**Status:** `typecheck` ✅ · `build` ✅ · migrations `0000–0013` applied ✅ ·
`/api/health` 200 ✅ · demo login 200 ✅

---

## Summary of findings

The architecture was sound (the `withTenant`/RLS pattern, the `next`-free service
layer, snapshot-on-send, the probability-weighted forecast view). The risk was
concentrated in **authorization/bootstrap** and the **money path**. 62 findings were
triaged (1 critical, 12 high, 24 medium, 25 low) and remediated.

The "duplicate table" smell was investigated and found benign: `account` is Better
Auth's OAuth table, `accounts` is the CRM customer table, `organization` is the
tenant — nothing was mis-wired.

---

## What changed

### Security & bootstrap
- **Singleton superadmin.** Exactly one superadmin is allowed, enforced by a partial
  unique index `user_singleton_superadmin_uq` (`UNIQUE (is_superadmin) WHERE is_superadmin`).
  The seed creates one superadmin and, in production, **requires** `DEMO_ADMIN_PASSWORD`
  to be set and non-default (dev keeps `Password123!`).
- **Boot guard** (`instrumentation.ts`): in production, refuses to start if
  `BETTER_AUTH_SECRET` is the public default, if the app DB role is a
  superuser/BYPASSRLS role (which would silently void RLS), or if Microsoft Entra is
  configured without a real `MICROSOFT_TENANT_ID` (no `common`).
- **Compose/`.env.example`** no longer ship insecure password defaults; `DATABASE_URL`
  documents the RLS-enforced `crm_app` role.
- **RBAC escalation closed.** `updateMember` enforces a tier ceiling, a self-guard, and
  last-Owner protection; `setRolePermissions` can only grant a subset the actor already
  holds and cannot edit system roles or the actor's own role.
- **Authorization holes closed.** Attachment and activity actions now enforce the
  per-type permission + record-scope (`canAccessAttachable`); the unguarded duplicate
  attachment actions were removed and the UI repointed to the hardened `_shared` ones.
- **`allowPasswordLogin`** is now actually enforced at sign-in; **Entra** requires a
  single tenant and the redirect URI is reconciled between code and docs.

### Linkage & data integrity
- Added missing foreign keys and **retargeted account-child FKs to tenant-safe
  composites** `(tenant_id, account_id) → accounts(tenant_id, id)`.
- Validated caller-supplied destination ids (`accountId` in lead-convert &
  `updatePerson`; `endUserAccountId` in account create/update) for existence + ownership.
- Soft-delete cascade/guards so deleted accounts/opportunities don't leave live,
  editable children; account hierarchy **cycle prevention**.
- Partial-unique constraints: SO number per tenant, one default tax setting, one
  default funnel. Secondary indexes on hot FK/filter columns.
- RLS `audit_log` `tenant_id IS NULL` cross-tenant hole removed; report views are
  `security_invoker` with an explicit tenant predicate, and the forecast view ignores
  rejected/deleted primary quotes.

### Business logic
- **Money:** tax-inclusive grand total fixed; server-side numeric validation
  (`lib/validation-quotation.ts`) prevents negative totals; **faithful snapshot-on-send**
  (rate, totals, and a new `quotations.tax_inclusive` flag are frozen at send and the
  detail view renders the snapshot, not live settings); the opportunity's
  `primary_quotation_id` is maintained on delete/reject and re-synced.
- **Stage machine:** transition guard prevents arbitrary jumps and silent reopening of
  Won/Lost/KIV deals; auto-win on quote-accept respects status + the Won-stage approval
  gate; `decideApproval`/SO transitions use row locks + conditional updates (TOCTOU);
  stage history now records a reason.
- **Forecast** aggregates per currency instead of summing mixed currencies as MYR.

### Audit trail
- `writeAudit` now covers the highest-risk mutations it previously missed: team/RBAC
  (role/permission/member/tier), settings (stage/numbering/tenant settings), sales-order
  approvals, and project/milestone CRUD.

### Quality / UX
- Server Action error messages now survive in production via an `ActionResult`
  return-value pattern (`lib/action-result.ts`) instead of being masked to a generic
  digest. Includes attachment actions.
- Added `error.tsx`, `loading.tsx`, `not-found.tsx`, and `global-error.tsx` boundaries.
- Removed 6 orphaned dashboard-template components; removed the dead
  `CUSTOM_FIELD_MANAGE` permission (the `custom_field_defs` table/columns are retained
  with deprecation notes to avoid a destructive migration); capped unbounded list
  queries.

---

## Consciously deferred (non-blocking)

- **Server-side pagination** — list queries were capped with sane limits; cursor/offset
  pagination through the data table remains a future enhancement.
- **`custom_field_defs`** table/columns retained (feature unimplemented, permission
  removed) — marked deprecated rather than dropped.
- Two **pre-existing** ESLint warnings (`react-hooks/set-state-in-effect` in
  `quotation-create-dialog.tsx` and `use-mobile.ts`) — not introduced here; do not block
  the Next 16 build.
