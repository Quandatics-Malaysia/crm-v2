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

## Fix round 1/5

### Findings addressed

1. Conversion now resolves every new Account/opportunity currency through tenant Settings currencies, including existing Account currency; invalid legacy values fall back to the configured default/first currency/MYR.
2. New Opportunity creation validates submitted currency server-side before creating the container or funnel.
3. Nested Opportunity creation now receives the actual Account currency from `funnelsGet`; server orchestration also defaults from the inherited Account when no override is submitted.
4. Migration `0077_account_currency.sql` first normalizes each tenant setting to a configured default, first configured currency, or MYR, then backfills Accounts from that normalized setting before enforcing `NOT NULL`.
5. Currency tests now exercise the production validation/orchestration seams for Account create/update, Opportunity, Quotation, migration backfill, lead normalization, and conversion defaults. The 0077 behavior test no longer asserts SQL source text.

### Fix-round TDD

RED command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts --reporter verbose
```

Result: 5 expected failures and 6 existing passes. Missing production seams were reported for `resolveOpportunityCurrency`, `resolveQuotationCurrency`, `resolveAccountCurrencyBackfill`, and `resolveConfiguredCurrency`.

GREEN command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts tests/migration-journal.test.ts --reporter verbose
```

Result: 2 files passed, 14 tests passed.

### Fix-round verification

- Full web suite: `49 passed`, `4 skipped`; `477 passed`, `37 skipped`.
- Typecheck: `TypeScript: No errors found`.
- Lint: passed cleanly.
- Migration journal tests: included in the focused run, 3 passed.
- `rtk git diff --check`: passed.

### Fix-round files

- `server/services/tenant-currency.ts`: configured allow-list and fallback seams used by persistence paths.
- `app/(app)/accounts/actions.ts`: Account validation delegates to the shared tenant resolver.
- `app/(app)/funnel/actions.ts`: server-side Opportunity validation and Account-derived defaulting.
- `app/(app)/quotations/actions.ts`: server-side Quotation validation/defaulting seam.
- `lib/api-readers.ts` and `app/(app)/opportunities/[id]/page.tsx`: pass Account currency into nested creation.
- `db/migrations/0077_account_currency.sql`: Settings normalization and consistent Account backfill.
- `tests/account-lead-rules.test.ts` and `tests/migration-journal.test.ts`: executable fix-round coverage.
