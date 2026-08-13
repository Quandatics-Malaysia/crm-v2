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
