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

## Fix round 2/5

### Findings addressed

- Added explicit-vs-inherited currency resolution. Nonblank user overrides are strict and reject currencies outside Settings; blank/whitespace values inherit Account/Funnel currency, while invalid inherited legacy values fall back to configured default, first configured currency, or MYR.
- Applied the same production resolver to `updateOpportunity`, including the primary-quotation lock path.
- Added tenant-scoped conversion resolution inputs to the production funnel/stage resolver; actual conversion remains tenant-filtered in its database queries.
- Added `jsonb_typeof(...)= 'array'` guards and safe CASE inputs around every 0077 `jsonb_array_elements_text` call, so malformed scalar/object Settings cannot abort migration.
- Removed action-module test re-exports. Tests now import the shared production currency service directly; the service is called by Account, Opportunity, Quotation, conversion, and migration-related paths.

### Fix-round TDD

RED command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts --reporter verbose
```

Result: new failures covered missing explicit/inherited resolver behavior and tenant-aware conversion inputs before production fixes were applied.

GREEN command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts tests/migration-journal.test.ts --reporter verbose
```

Result: 2 files passed, 15 tests passed.

### Fix-round verification

- Full web suite: `49 passed`, `4 skipped`; `478 passed`, `37 skipped`.
- Typecheck: `TypeScript: No errors found`.
- Lint: passed cleanly.
- Migration journal tests: included in focused run, 3 passed.
- `rtk git diff --check`: passed.

### Fix-round coverage and residual

- `account-lead-rules.test.ts` covers explicit invalid Account create/update, explicit invalid Opportunity/Quotation overrides, inherited valid/invalid currency, blank/whitespace inheritance, malformed Settings input, and tenant-isolated conversion inputs.
- `migration-journal.test.ts` covers the executable backfill seam and malformed-settings fallback; journal identity remains checked structurally.
- No live database was available in this run, so direct SQL execution of 0077 remains a deployment-time residual. The production backfill rule and malformed JSON branch are covered without source-text behavior assertions.

Final post-cleanup rerun: focused tests `2 files / 15 passed`; full web suite `49 passed / 4 skipped`, `478 passed / 37 skipped`; typecheck, lint, and diff check all passed.

## Fix round 3/5

### Findings addressed

- Source-equal submitted currency is now treated as inherited, including when that legacy source currency is not configured; resolver falls back to configured default, first configured currency, or MYR.
- Nonblank submitted currency different from the inherited source remains an explicit override and rejects when outside Settings.
- Blank/omitted inheritance is consistent across nested Opportunity create, Quotation create/edit, and Funnel edit.
- Funnel edit now resolves and checks effective currency against the locked primary quotation regardless of raw input presence. Fallback-induced changes are rejected; valid unchanged locked currency passes.
- Quotation edit now accepts the optional currency input and runs through the same production tenant resolver before persistence.

### Fix-round TDD

RED command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts --reporter verbose
```

Result: 3 expected failures, 10 passes. Failures covered source-equal invalid inheritance and the missing effective currency lock seam.

GREEN command:

```text
rtk pnpm --filter web exec vitest run tests/account-lead-rules.test.ts tests/migration-journal.test.ts --reporter verbose
```

Result: 2 files passed, 16 tests passed.

### Fix-round verification

- Full web suite: `49 passed`, `4 skipped`; `479 passed`, `37 skipped`.
- Typecheck: `TypeScript: No errors found`.
- Lint: passed cleanly.
- Migration journal tests: included in focused run, 3 passed.
- `rtk git diff --check`: passed.

### Fix-round coverage

- Production resolver tests cover submitted value equal to invalid inherited currency, different invalid explicit override, blank invalid inheritance, and valid inheritance.
- Production lock seam tests cover fallback-induced lock rejection and valid unchanged locked currency.

## Fix round 4/5

### Finding addressed

- Quotation edit now uses the stored quotation currency as the inheritance source when no currency override is submitted. A draft quote created in another configured currency is no longer reset to its Funnel currency by an unrelated edit.
- Added an action-level regression through the production `updateQuotation` seam with distinct stored quotation and Funnel currencies.

### Fix-round TDD

RED command:

```text
rtk pnpm --filter web exec vitest run tests/quotation-edit-currency.test.ts --reporter verbose
```

Result: 1 test failed as expected; the production edit persisted `MYR` from the Funnel while the existing draft quotation currency was `USD`.

GREEN command:

```text
rtk pnpm --filter web exec vitest run tests/quotation-edit-currency.test.ts --reporter verbose
```

Result: 1 test passed after changing only the quotation edit inheritance source.

### Fix-round verification

- Focused Task 3 + regression + migration tests: 3 files passed, 17 tests passed.
- Full web suite: `50 passed`, `4 skipped`; `480 passed`, `37 skipped`.
- Typecheck: `TypeScript: No errors found`.
- Lint: passed cleanly.
- Migration journal tests: 2 passed, 3 tests passed.
- `rtk git diff --check`: passed.

### Fix-round files

- `app/(app)/quotations/actions.ts`: preserve the existing quotation currency on edit when the optional override is omitted.
- `tests/quotation-edit-currency.test.ts`: production action regression for distinct quotation/Funnel currencies.
- `task-3-report.md`: round 4 TDD and verification evidence.
