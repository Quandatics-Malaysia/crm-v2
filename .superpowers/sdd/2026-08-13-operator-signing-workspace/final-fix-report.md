# Operator Signing Workspace Final Hardening Report

Date: 2026-08-13

## Outcome

The final hardening pass closes every finding supplied for the operator-signing workspace. Automatic renewal now requires an existing entitlement whose stored contract and schedule revisions exactly match current state. First issuance, migrated rows with missing revision stamps, and stale commercial or schedule controls remain manual review-and-issue operations. Time renewal and signing-key rotation remain automatic when those revision guards match.

Install-token replacement now atomically supersedes every prior unused token. A per-deployment SHA-256 digest of the submitted idempotency key prevents sequential and concurrent duplicate issuance; plaintext tokens and plaintext idempotency keys are never persisted.

## Finding resolution

1. Automatic issuance safety
   - Scheduler does not first-sign.
   - Scheduler compares latest stored `contract_revision` and `schedule_revision` with current revisions before claims or signing.
   - Missing, mismatched, or changed revisions advance to manual review without issuing.
   - Key rotation and lease-time renewal continue automatically only for revision-current entitlements.

2. Install-token replacement and retry safety
   - Migration `0007_install_token_replacement.sql` adds `superseded_at`, digest-only idempotency storage, a unique per-deployment idempotency index, and active-token lookup support.
   - Supersession, replacement insert, and success audit execute in one D1 batch.
   - Registration rejects superseded tokens before and during the atomic claim.
   - Sequential or concurrent idempotency reuse returns `install_token_already_issued`; no second plaintext token is created.

3. Onboarding current-state derivation
   - Latest entitlement carries stored revision stamps into state derivation.
   - Missing or stale stamps select `issue_new_version` and the sign stage.
   - Latest heartbeat selects `entitlement_version` and `configuration_version`; a healthy but old acknowledgement remains in verify.

4. Registration-key validity
   - Workspace registration now requires Ed25519, non-revoked, unreplaced, already valid, and unexpired key state, matching signing eligibility.

5. Atomic issuance prerequisites
   - Migration `0006_entitlement_prerequisite_guard.sql` adds a final-insert trigger for active client/deployment, registration pair, client/contract ownership, and eligible deployment key.
   - Existing revision and renewal-claim trigger guards remain authoritative in the same insert.
   - Trigger SQL avoids remote-D1-incompatible nested `SELECT CASE`, CTE-backed DML, and explicit transactions.

6. Safe signing errors
   - `entitlement_state_changed`, `entitlement_prerequisites_unavailable`, and `signing_configuration_unavailable` are stable `SafeHttpError` codes with operator guidance.
   - Existing JSON response shape remains `{ "error": "<code>" }`; only prior generic failures gain stable safe codes.
   - Crypto and database details remain hidden.

7. Audit and request correlation
   - Failed schedule and signing descriptors parse and store the deployment ID from the pathname, so events appear in the deployment timeline.
   - HTML errors use the same sanitized `Cf-Ray`/`X-Request-Id` correlation value that failure auditing hashes.

8. CSP and RBAC cleanup
   - Copy enhancement moved from inline script to authenticated, same-origin `/operator/install-token-copy.js`; manual selection remains the no-JavaScript fallback.
   - Mutation tests cover owner-only token issuance, owner/billing schedule and signing, billing token denial, and support/release/auditor denial across all signing mutations.

## Strict TDD evidence

### Entitlement revision gates, atomic prerequisites, and safe signing errors

RED:

```text
$ pnpm --filter control-plane test -- entitlements.test.ts
Test Files  1 failed | 5 passed (6)
Tests  12 failed | 175 passed (187)

never automatically first-signs a scheduled deployment:
expected issued: 0; received issued: 2

atomically rejects issuance when client becomes disabled before final insert:
promise resolved instead of rejecting

fails closed for missing/malformed secrets:
expected { status: 503, code: "signing_configuration_unavailable" }
received Error: Entitlement signing configuration is unavailable
```

GREEN:

```text
$ pnpm --filter control-plane exec vitest run tests/entitlements.test.ts
Test Files  1 passed (1)
Tests  37 passed (37)
```

### Install-token supersession and idempotency

RED:

```text
$ pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts tests/operator-onboarding.test.ts
Test Files  2 failed (2)
Tests  3 failed | 77 passed (80)

prior token registration expected 401; received 201
concurrent same-key issuance expected 1 fulfilled; received 2
repeated route idempotency key expected 409; received 200
```

GREEN:

```text
$ pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts tests/operator-onboarding.test.ts
Test Files  2 passed (2)
Tests  80 passed (80)
```

### Onboarding revisions, heartbeat acknowledgements, and key lifecycle

RED:

```text
$ pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts tests/deployment-protocol.test.ts
Test Files  2 failed (2)
Tests  8 failed | 80 passed (88)

stale stored revisions received progress=complete,nextAction=none
old heartbeat acknowledgements received progress=complete,nextAction=none
replaced/not-yet-valid/expired keys still produced non-null registration
```

GREEN:

```text
$ pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts tests/deployment-protocol.test.ts
Test Files  2 passed (2)
Tests  88 passed (88)
```

### Safe UI errors, audit targeting/correlation, external script, and RBAC

RED:

```text
$ pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts
Test Files  1 failed (1)
Tests  6 failed | 57 passed (63)

token result contained inline navigator.clipboard script
HTML error showed a random request ID instead of submitted correlation
known signing errors rendered generic internal guidance
failed schedule/sign audit query returned [] for the deployment ID
```

GREEN:

```text
$ pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts
Test Files  1 passed (1)
Tests  63 passed (63)
```

## Final verification

Focused behavioral suites:

```text
$ pnpm --filter control-plane exec vitest run tests/entitlements.test.ts tests/deployment-protocol.test.ts tests/operator-onboarding.test.ts
Test Files  3 passed (3)
Tests  136 passed (136)
```

Migration compatibility:

```text
$ node --test apps/control-plane/tests-node/*.test.mjs
tests 2
pass 2
fail 0
```

Full control suite:

```text
$ pnpm --filter control-plane test
Node migration tests: 2 passed, 0 failed
Vitest: 6 files passed; 209 tests passed
Combined: 211 passed, 0 failed
```

Type and diff gates:

```text
$ pnpm --filter control-plane typecheck
$ tsc --noEmit
exit 0

$ git diff --check
exit 0
```

## Remaining concern

No known code or control-suite blocker remains. The migrations were applied and behavior-tested through the Workers D1 test pool and checked for known remote-D1-incompatible forms; an actual remote/staging D1 migration was outside this local hardening scope.

---

# Final hardening fix round 2

## Resolution

1. Cron review/sign TOCTOU
   - Renewal passes the reviewed contract and schedule revisions into `issueEntitlement`.
   - The existing pre-sign comparison rejects a changed revision with `entitlement_state_changed`; final-insert revision triggers still cover changes after signing begins.
   - Deterministic post-claim interleavings cover both schedule and contract changes. Neither path creates a new entitlement; the claim records the safe state-change failure.

2. Historical install-token migration state
   - Migration `0007_install_token_replacement.sql` supersedes every unused token that existed before replacement tracking by setting `superseded_at = created_at`.
   - Used token history remains unchanged. A real `0001`-through-`0003` seeded database is upgraded through all migrations and verifies both duplicate unused rows are invalidated.

3. One request correlation per request
   - A lazy Hono context cache now supplies one request correlation to auth audits, mutation audits, and HTML errors.
   - Header selection validates `Cf-Ray` first, falls through invalid values to a valid `X-Request-Id`, and otherwise generates and caches one UUID.

4. Atomic install-token registration prerequisite
   - Migration `0008_install_token_issuance_guard.sql` rejects unused-token insertion unless client/deployment are active and registration remains absent at the insert boundary.
   - Trigger failure maps to the existing safe `not_found` response. The issuance batch rollback preserves the prior token as active and emits no replacement token.
   - The trigger uses the same remote-D1-compatible `SELECT RAISE(...) WHERE ...` form as existing guards.

## Strict TDD evidence

### Cron revision interleaving

RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/entitlements.test.ts -t 'rejects automatic issuance'
Test Files  1 failed (1)
Tests  2 failed | 37 skipped (39)

schedule interleave: expected issued=0,failed=1; received issued=1,failed=0
contract interleave: expected issued=0,failed=1; received issued=1,failed=0
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/entitlements.test.ts -t 'rejects automatic issuance'
Test Files  1 passed (1)
Tests  2 passed | 37 skipped (39)
```

### Migration 0007 upgrade-state backfill

RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts -t 'invalidates every unused install token'
Test Files  1 failed (1)
Tests  1 failed | 36 skipped (37)

Both seeded pre-migration unused rows had superseded_at=null.
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts -t 'invalidates every unused install token'
Test Files  1 passed (1)
Tests  1 passed | 36 skipped (37)
```

### Request-correlation cache and fallback

RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'generated request correlation|falls through an invalid Cf-Ray'
Test Files  1 failed (1)
Tests  2 failed | 63 skipped (65)

No-header request: audit hash differed from the UUID rendered by the HTML error.
Invalid Cf-Ray plus valid X-Request-Id: HTML rendered a generated UUID instead of the X-Request-Id.
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'generated request correlation|falls through an invalid Cf-Ray'
Test Files  1 passed (1)
Tests  2 passed | 63 skipped (65)
```

### Atomic registration prerequisite

RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'registration wins after prerequisite review'
Test Files  1 failed (1)
Tests  1 failed | 65 skipped (66)

The promise resolved with a second plaintext token after registration won the interleave.
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'registration wins after prerequisite review'
Test Files  1 passed (1)
Tests  1 passed | 65 skipped (66)
```

## Round-2 verification

Focused behavioral suites:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/entitlements.test.ts tests/deployment-protocol.test.ts tests/operator-onboarding.test.ts
Test Files  3 passed (3)
Tests  142 passed (142)
```

Migration compatibility:

```text
$ rtk pnpm --filter control-plane exec node --test tests-node/migrations-compatibility.test.mjs
tests 2
pass 2
fail 0
```

Full control suite:

```text
$ rtk pnpm --filter control-plane test
Node migration tests: 2 passed, 0 failed
Vitest: 6 files passed; 215 tests passed
Combined: 217 passed, 0 failed
```

Type and diff gates:

```text
$ (apps/control-plane) rtk pnpm typecheck
TypeScript: No errors found
exit 0

$ rtk git diff --check
exit 0
```

## Round-2 remaining concern

No known code or control-suite blocker remains. The actual D1 upgrade-state and new trigger execute successfully in the Workers D1 test pool, and the migration source passes the remote-D1 compatibility checks. A remote/staging D1 apply remains outside this local hardening scope.

---

# Final hardening fix round 3

## Resolution

1. Applied migration immutability
   - `0007_install_token_replacement.sql` is restored byte-for-byte to commit `7c0eac1cfdf898c0b78c4ed7765562a791cb9712`.
   - New migration `0009_install_token_historical_backfill.sql` performs the idempotent backfill only where `used_at IS NULL AND superseded_at IS NULL`.
   - `0008_install_token_issuance_guard.sql` remains unchanged and active.

2. True staged upgrade coverage
   - The upgrade fixture first applies `0001`-`0003`, seeds historical duplicate unused tokens, then applies through and records `0007`.
   - It captures that `0007` leaves those rows untouched, then applies only pending `0008`-`0009` and verifies both unused rows are superseded while used history remains unchanged.

3. Truthful workspace token state
   - Workspace token selection now includes `superseded_at` and exposes `supersededAt` in the internal workspace model.
   - The deployment workspace renders used, superseded, expired, and awaiting states in that precedence order, and displays the superseded timestamp.

## Strict TDD evidence

### Recorded 0007 followed by pending 0008-0009

RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts -t 'recorded 0007'
Test Files  1 failed (1)
Tests  1 failed | 36 skipped (37)

After applying through 0007, both historical unused rows already had superseded_at=created_at.
Expected both to remain null until pending migrations applied.
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts -t 'recorded 0007'
Test Files  1 passed (1)
Tests  1 passed | 36 skipped (37)
```

### Workspace selection and token-state rendering

Initial RED:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'install token truthfully'
Test Files  1 failed (1)
Tests  2 failed | 66 skipped (68)

Both superseded and expired fixtures were missing token.supersededAt from the workspace result.
```

Independent UI mutation RED after workspace selection was fixed:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'install token truthfully'
Test Files  1 failed (1)
Tests  1 failed | 1 passed | 66 skipped (68)

Superseded token expected "Install token superseded" but rendered "Install token awaiting use".
The expired case remained green.
```

GREEN:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts -t 'install token truthfully'
Test Files  1 passed (1)
Tests  2 passed | 66 skipped (68)
```

## Round-3 verification

Focused behavioral suites:

```text
$ rtk pnpm --filter control-plane exec vitest run tests/deployment-protocol.test.ts tests/operator-onboarding.test.ts
Test Files  2 passed (2)
Tests  105 passed (105)
```

Full control suite:

```text
$ rtk pnpm --filter control-plane test
Node migration compatibility: 2 passed, 0 failed
Vitest: 6 files passed; 217 tests passed
Combined: 219 passed, 0 failed
```

Type, migration-history, and diff gates:

```text
$ (apps/control-plane) rtk pnpm typecheck
TypeScript: No errors found
exit 0

$ rtk git diff 7c0eac1cfdf898c0b78c4ed7765562a791cb9712 -- apps/control-plane/migrations/0007_install_token_replacement.sql
no output; 0007 identical
exit 0

$ rtk git diff --check
exit 0
```

## Round-3 remaining concern

No known code or control-suite blocker remains. The staged Workers D1 test proves the recorded-`0007` upgrade path through `0008` and `0009`; a remote/staging D1 apply remains outside this local hardening scope.
