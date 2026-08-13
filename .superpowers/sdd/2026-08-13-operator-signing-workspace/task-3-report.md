# Task 3: Dashboard, Client List, and Client Workspace Report

## Outcome

Redesigned the server-rendered operator dashboard, client list, client workspace, and contract invoice surface with the Task 2 primitives and scoped styles. The workspace now guides operators through Client, Contract, then Deployment. Organisations remain visible in a secondary optional section and do not block onboarding.

The dashboard shows active-client and deployment counts plus actionable past-due, suspended, and disabled attention items. Client, contract, and deployment collections use readable status tables with intentional empty states. Forms are grouped into focused cards with labels, examples, hints, browser constraints, and the existing server-side validation.

Ordinary HTML mutation success now uses fixed POST/redirect/GET targets with an allowlisted notice code. The renderer only displays notices from the fixed server-side map. JSON response shapes and statuses remain unchanged, and the existing Cloudflare Access, RBAC, CSRF, same-origin, audit, `no-store`, and response-security middleware remain in place.

## RED evidence

The following new tests were added before production edits. They name the regressions they catch: missing guided empty state, unsafe/non-notice PRG behavior, and unreadable client rows.

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "(guides an empty|requires same-origin|renders client rows)"
```

Output:

```text
Test Files  1 failed (1)
Tests  3 failed | 32 skipped (35)
```

Failing test names and expected failure causes:

1. `guides an empty client list to its primary creation action`
   - Failed because the rendered list had an empty raw `<ul>` and did not contain `No clients yet`.
2. `requires same-origin protection and owner authority for client creation`
   - Failed at the new PRG assertion. Expected `Location: /operator/clients?notice=client_created`; received `/operator/clients`.
3. `renders client rows with readable status and ignores unallowlisted notices`
   - Failed because the page did not contain `<table class="data-table">`.

The first whole-file RED run also exercised the new workspace and dashboard tests before any production edit. Its later failures cascaded after the PRG assertion prevented fixture IDs from being assigned. The focused RED command above isolates the intended missing behavior.

## GREEN evidence

### CRUD and UI regression suite

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  35 passed (35)
```

This includes the new tests:

- `guides an empty client list to its primary creation action`
- `renders client rows with readable status and ignores unallowlisted notices`
- `orders client onboarding as contract then deployment, with optional organisations secondary`
- `renders dashboard counts and actionable attention items`

It also retains existing JSON contract/security coverage, including `accepts guarded same-origin JSON but rejects unguarded JSON`, role checks, conflict handling, audit writes, pagination, and validation failures.

### Authentication suite

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-auth.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  25 passed (25)
```

### Full control-plane suite

Command:

```sh
pnpm --dir apps/control-plane test
```

Output:

```text
✔ control migrations avoid nested SELECT CASE trigger expressions rejected by remote D1
Test Files  6 passed (6)
Tests  133 passed (133)
```

### Typecheck

Command:

```sh
pnpm --dir apps/control-plane typecheck
```

Output:

```text
$ tsc --noEmit
```

Exit status: `0`.

### Diff check

Command:

```sh
git diff --check
```

Output: no output. Exit status: `0`.

## Changed files

- `apps/control-plane/src/repos/clients.ts`
  - Adds dashboard summary counts and bounded actionable attention records.
- `apps/control-plane/src/routes/operator.tsx`
  - Loads dashboard summary data.
  - Adds an allowlisted success-notice registry and deterministic HTML PRG targets.
  - Preserves JSON mutation behavior and security middleware.
- `apps/control-plane/src/ui/dashboard.tsx`
  - Reuses Task 2 page header, card, status, progress, notice, empty-state, and data-list primitives across dashboard/client/contract surfaces.
  - Reorders primary onboarding to Client, Contract, Deployment, with organisations secondary.
- `apps/control-plane/src/ui/styles.ts`
  - Adds responsive summary, form, attention, and table styles within the existing operator scope.
- `apps/control-plane/tests/operator-crud.test.ts`
  - Adds route-level UI and PRG regression coverage.

## Concerns

- No browser visual-regression harness exists for the control-plane package. Verification covers server-rendered semantic HTML, scoped CSS contracts, and responsive CSS rules rather than screenshots.
- Dashboard attention is intentionally bounded to five records and currently prioritises past-due/suspended contracts and disabled deployments. Additional attention categories need an explicit product rule before inclusion.
