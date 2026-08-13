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
