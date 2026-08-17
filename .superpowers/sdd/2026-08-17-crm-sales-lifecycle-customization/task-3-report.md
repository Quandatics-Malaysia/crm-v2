# Task 3 — Account currency and Lead simplification

## Status

Implemented. Account currency is required and Settings-backed; opportunity and quotation creation use account/funnel currency defaults while allowing configured-currency selection. Lead create/edit no longer exposes or accepts funnel, pipeline, or stage fields. Lead conversion resolves the single default Sales Funnel and its first OPEN `0E` stage. Legacy pipeline/stage data remains readable.

## TDD evidence

### RED

Command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts --reporter verbose
```

Result: 1 file failed, 4 tests failed. The expected missing exports were reported for `resolveAccountCurrency`, `normalizeLeadInput`, and `resolveDefaultSalesFunnel`.

### GREEN

Command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts --reporter verbose
```

Result: 1 file passed, 4 tests passed.

## Files changed

- Account currency: `db/schema/crm.ts`, `db/schema/rbac.ts`, `db/migrations/0077_account_currency.sql`, migration journal, `db/seed.ts`, account actions/forms/tables/detail pages, and lookup currency options.
- Opportunity/quotation currency propagation: funnel opportunity form and quotation actions/forms/pages.
- Lead simplification: lead actions/form/table/detail edit wiring; historical pipeline/stage display remains available.
- Conversion defaults: `server/services/conversion.ts` now resolves the default Sales Funnel and first OPEN `0E` stage, with account currency propagation.
- Tests: `tests/account-lead-rules.test.ts` and migration journal assertions.

## Verification

- Focused rules + migration tests: 2 files passed, 7 tests passed.
- Full web suite (run once): `49 passed`, `4 skipped`; `470 passed`, `37 skipped`.
- Typecheck: `TypeScript: No errors found`.
- Lint: passed cleanly.
- Migration journal assertions: passed.
- `rtk git diff --check`: passed.

## Concerns

- Related account, opportunity, quotation, and legacy-display callers were updated because the Settings-backed currency and historical-readability requirements cross those interfaces; no unrelated product scope was added.
- No generated schema snapshot was added because this repository tracks migration journal entries for the active migration history rather than a matching generated snapshot.
