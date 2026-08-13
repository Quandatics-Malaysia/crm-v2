# Task 6 Report: Entitlement Configuration, Review, and Signing

## Delivered

- Added workspace schedule controls for compatible contract, configuration version, channel, minimum app version, and optional lowercase SHA-256 image digest.
- Enforced active client/deployment, completed registration with a non-revoked deployment key, client ownership, and current compatible contract before schedule assignment.
- Added `GET /operator/deployments/:deploymentId/entitlements/review` with authoritative contract status/period, seats, modules, release controls, 24-hour lease, and seven-day post-expiry grace.
- Added HTML-only explicit confirmation and reviewed contract/schedule revision checks. Existing JSON signing remains compatible.
- Preserved backend authority: submitted HTML carries only identity/revision expectations; signing reloads durable state and existing database guards reject races before commit.
- Added HTML PRG after issuance with issued-version notice. Later issuance is labelled **Issue new version**.
- Showed prior immutable versions without signing key, signature, payload, or raw envelope data.
- Linked configure, sign, and renewal next actions to real controls.
- Replaced false reactivation claims with truthful guidance and links to existing client/deployment records.

## RED

Initial command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts tests/entitlements.test.ts
```

Initial result: `2 failed` test files; `34 failed | 35 passed` tests. This run exposed a test-fixture error: the new registration-key fixture violated the existing 43-character fingerprint trigger, causing all 28 entitlement tests to error before reaching behavior assertions. The fixture was corrected before production implementation.

Corrected RED command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts tests/entitlements.test.ts
```

Corrected RED result: `2 failed` test files; `9 failed | 60 passed` tests.

Expected missing-behavior failures:

1. Scheduling accepted an unregistered deployment.
2. Signing accepted a stale reviewed revision.
3. Workspace lacked schedule form and friendly controls.
4. Review route returned `404`.
5. HTML signing did not require confirmation.
6. HTML stale review signed instead of returning `409`.
7. Configure/sign/renew links did not reach real controls.
8. Disabled-state copy claimed unavailable reactivation actions.

One existing renewal assertion also observed extra due schedules left by the new failing tests; test cleanup was added so isolated fixtures do not leak due renewal work.

## GREEN

Combined focused command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts tests/entitlements.test.ts
```

Result: `2 passed` test files; `69 passed` tests.

Required focused suites:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-onboarding.test.ts
```

`1 passed` test file; `41 passed` tests.

```sh
rtk pnpm --filter control-plane exec vitest run tests/entitlements.test.ts
```

`1 passed` test file; `28 passed` tests.

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-auth.test.ts
```

`1 passed` test file; `25 passed` tests.

Typecheck:

```sh
rtk proxy pnpm --filter control-plane typecheck
```

Exit `0`; `tsc --noEmit` produced no errors. The optimized `rtk pnpm` wrapper had previously returned exit `1` despite printing `TypeScript: No errors found`, so raw execution was intentionally rerun through `rtk proxy` for authoritative status.

Full control-plane suite, run once:

```sh
rtk pnpm --filter control-plane test
```

Node migration suite: `1 pass`, `0 fail`.

Vitest: `6 passed` test files; `164 passed` tests.

Diff check:

```sh
rtk git diff --check
```

Exit `0`; no whitespace errors.
