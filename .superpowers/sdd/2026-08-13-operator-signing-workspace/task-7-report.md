# Task 7 Report: Safe Operator HTML Errors

## RED

Command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-crud.test.ts tests/operator-onboarding.test.ts -t 'negotiates safe|keeps internal errors safe'
```

Result: `2 failed` test files; `5 failed | 1 passed | 78 skipped` tests.

Expected missing-behavior failures: `Accept: text/html` received `application/json` for 400, 403, 404, 409, and 500 errors.

## GREEN

Focused command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-crud.test.ts tests/operator-onboarding.test.ts -t 'negotiates safe|keeps internal errors safe'
```

Result: `2 passed` test files; `6 passed | 78 skipped` tests.

The first full-suite run found one test-isolation regression: the conflict fixture retained two client rows, making a later dashboard-count assertion receive `4` instead of `2`. Fixture cleanup was added.

Final verification:

```sh
rtk pnpm --filter control-plane test
```

Node migration suite: `1 pass`, `0 fail`.

Vitest: `6 passed` test files; `173 passed` tests.

```sh
rtk proxy pnpm --filter control-plane typecheck
```

Exit `0`; `tsc --noEmit` produced no errors.

```sh
rtk git diff --check
```

Exit `0`; no whitespace errors.

## Fix 1/5: Unknown Operator Routes and Media Ranges

### RED

Command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-crud.test.ts -t 'unknown operator-route|unmatched API'
```

Result: `1 failed` test file; `6 failed | 1 passed | 40 skipped` tests.

Expected missing-behavior failures: every unmatched `/operator/*` route returned bare `text/plain; charset=UTF-8`, bypassing error negotiation and safe headers. The API-preservation test passed before implementation.

### GREEN

Focused command:

```sh
rtk pnpm --filter control-plane exec vitest run tests/operator-crud.test.ts -t 'unknown operator-route|unmatched API'
```

Result: `1 passed` test file; `7 passed | 40 skipped` tests.

Initial typecheck found two `TS2769` errors because the shared operator-error helper widened response status to `number`. Its status type was narrowed to `ReturnType<typeof safeErrorResponse>`.

Final verification:

```sh
rtk pnpm --filter control-plane test
```

Node migration suite: `1 pass`, `0 fail`.

Vitest: `6 passed` test files; `180 passed` tests.

```sh
rtk proxy pnpm --filter control-plane typecheck
```

Exit `0`; `tsc --noEmit` produced no errors.

```sh
rtk git diff --check
```

Exit `0`; no whitespace errors.
