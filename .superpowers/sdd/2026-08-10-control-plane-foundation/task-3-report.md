# Task 3 report: Cloudflare Access authentication, RBAC, and audit

## Status and commit

- Status: implementation, self-review, migration, and verification complete.
- Commit: `feat(control): secure operator access and audit` (this task commit).
- Branch: `feat/client-hosted-platform`.

## Files

- `apps/control-plane/src/auth/access.ts`: lazy Access verifier, exact issuer/audience verification, operator resolution, subject binding, and bootstrap-owner provisioning.
- `apps/control-plane/src/auth/rbac.ts`: closed role allowlist and role middleware.
- `apps/control-plane/src/audit.ts`: request-ID hashing, canonical bounded metadata, secret-field rejection, and audit inserts/batch statements.
- `apps/control-plane/src/http/errors.ts`: generic safe HTTP errors.
- `apps/control-plane/src/index.ts`: injectable `createApp`, authenticated operator session route, and safe error mapping.
- `apps/control-plane/src/db/schema.ts`: operator status/subject and audit outcome/index definitions.
- `apps/control-plane/migrations/0002_operator_access_audit.sql`: schema hardening and append-only triggers.
- `apps/control-plane/tests/operator-auth.test.ts`: Access, bootstrap, RBAC, subject-binding, and audit integration tests.
- `apps/control-plane/vitest.config.ts`: D1 migration injection and explicit test-only required-secret values; Task 2 compatibility-date override preserved.
- `apps/control-plane/package.json`, `pnpm-lock.yaml`: direct `jose@6.2.3` dependency.

## RTK TDD evidence

- RED 1: `rtk pnpm --filter control-plane test -- operator-auth.test.ts` — missing assertion/spoofed email test failed with `expected 404 to be 401`.
- GREEN 1: same command — 2/2 existing tests passed after minimal route guard.
- RED 2: expanded Task 3 suite failed because `../src/auth/access` did not exist.
- GREEN 2: same command — 10/10 tests passed after auth/RBAC/audit implementation.
- RED 3: stable-subject test failed with `expected null to be 'bound-…'`.
- GREEN 3: same command — 11/11 tests passed after atomic subject-bind + audit batch.

The prescribed focused command passes an extra `--` to Vitest, so Vitest runs both test files. The focused Task 3 file contains 10 tests; combined suite contains 11 tests.

## Test matrix

- Missing Access assertion remains `401` even with spoofed `Cf-Access-Authenticated-User-Email`.
- Locally signed Ed25519 Access JWT with wrong audience is rejected by the verifier and route with `401`; no network is used.
- Verified bootstrap email is trimmed/lowercased, provisions exactly one operator and `vendor_owner` role, and resolves idempotently.
- Unregistered non-bootstrap identity fails closed with `403`.
- Disabled operator and unknown stored role fail closed with `403`.
- Existing active operator receives a stable Access subject only in an atomic mutation + audit batch.
- Audit writer stores `success` outcome, SHA-256 request-ID hash, and deterministic canonical metadata.
- Secret-bearing, oversized, non-canonical, or unsupported audit metadata is rejected.
- Audit rows reject `UPDATE` and `DELETE` through SQLite triggers.
- Existing `/health` behavior remains covered.

Production uses only `Cf-Access-Jwt-Assertion`. Default app constructs no test identity path; tests inject a verifier into `createApp`. Real verification uses `jose` remote JWKS with exact `https://${ACCESS_TEAM_DOMAIN}` issuer, exact audience, `RS256`, required `sub`/`email`/`iat`/`exp`, and lazy request-environment setup. JOSE/token failures map to generic `401`; JWKS/infrastructure failures map to generic `503` with no fallback.

## Migration

- Added `0002_operator_access_audit.sql`.
- Adds `operator_users.status` (`active|disabled`) and unique nullable `access_subject`.
- Removes legacy unknown roles before application-level closed-allowlist enforcement.
- Adds `operator_audit_log.outcome` (`success|denied|error`) and `(action, created_at)` index.
- Adds `BEFORE UPDATE` and `BEFORE DELETE` abort triggers for append-only application access.
- `rtk pnpm --filter control-plane db:migrate:local`: 9 commands executed; migration applied successfully.
- SQLite triggers do not protect against Cloudflare account-level database administration. Hash chaining or remote immutable export remains required if tamper evidence becomes mandatory.

## Verification

- `rtk pnpm --filter control-plane test`: 2 files, 11 tests passed; no missing-secret warnings after explicit test-only values.
- `rtk pnpm --filter control-plane typecheck`: no TypeScript errors.
- `git diff --check`: clean.

## Self-review

- Header/cookie trust boundary: only verified assertion reaches operator resolution; email/test headers and cookies are never authority.
- Identity binding: exact verified subject wins; normalized email is only fallback for pre-provisioned unbound operators and is atomically bound with audit.
- RBAC: any disabled, roleless, mixed-operator, or unknown-role result is rejected rather than filtered.
- Audit: request IDs are hashed; metadata is canonical, depth/node/string/byte bounded, and sensitive keys are rejected. Audit statements use prepared bindings.
- Mutation integrity: bootstrap role/subject and pre-provisioned subject binding share D1 atomic batches with audit statements; audit failure rolls back mutation.
- Compatibility: Worker/Hono module shape, request-scoped D1 binding, Wrangler compatibility date, and Worker-test compatibility override remain unchanged.
