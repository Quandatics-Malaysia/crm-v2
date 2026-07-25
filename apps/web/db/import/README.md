# Salesforce → crm-v2 bulk import

Imports the client's existing Salesforce data into a crm-v2 tenant (e.g. QM),
CSV per object. **Dry-run by default** — it never writes until you pass `--commit`.

## 1. Get the Salesforce export (per object, CSV)

Two ways to produce one CSV per object:

- **Data Loader** (recommended, controlled): *Export* each object (Account,
  Contact, Lead, Opportunity, Funnel, Product, Quote, Quote Line Item, …) to a
  CSV. Keep the **field API names** as headers.
- **Setup → Data Export** ("weekly export"): Salesforce emails a ZIP of every
  object as CSV. Unzip and keep the objects you need.

Name each file `<Object>.csv` (e.g. `Account.csv`, `Opportunity.csv`,
`Funnel.csv`) and drop them in an import folder, e.g. `./import-data/`.
Optionally add `owner-map.json` = `{ "<SalesforceUserId>": "<crm-v2 memberId>" }`
so record owners map to the right people (import your Users first, or map by hand).

## 2. Dry-run (validate + see the parity gaps — no writes)

```bash
npm run db:import -- --tenant=<organizationId> --dir=./import-data
```

For each object it prints: rows, headers, **UNMAPPED columns** (Salesforce fields
with no crm-v2 home — your parity gap), and any `mapping.ts` target column that
doesn't exist on the live table. Reconcile `db/import/mapping.ts` against the
`UNMAPPED` list until you're happy.

## 3. Commit (idempotent)

```bash
npm run db:import -- --tenant=<organizationId> --dir=./import-data --owner=<defaultMemberId> --commit
```

- Inserts in FK order (Account → Contact/Lead → Opportunity → Funnel → Product →
  Quote → Quote Line Item).
- Deterministic UUIDs (`det(object:sfId)`) + `ON CONFLICT (id) DO NOTHING`, so
  **re-running is safe** and picks up only new/changed files.
- In a Docker deploy, run it inside the app image:
  `docker compose run --rm -v $PWD/import-data:/app/import-data migrate npm run db:import -- --tenant=… --dir=/app/import-data --commit`

## Files

- `csv.ts` — dependency-free RFC-4180 CSV parser.
- `mapping.ts` — the per-object field map (`SF field → crm-v2 column` + transforms
  + picklist maps). **This is the file you tune** for the client's real headers.
- `import.ts` — the runner (dry-run/commit, coverage report, schema validation,
  FK ordering, owner/stage resolution).

## Scope & known gaps

Phase-1 targets the PROP-0003 core objects (accounts, contacts, leads,
opportunities/funnels, quotations, products). Deferred objects (Contract,
Project Item List, Payment Milestone, Opportunity Product, Lead's Company) need
schema parity work first — see the field-parity gap analysis. `mapping.ts` uses
best-guess Salesforce API names; the dry-run's UNMAPPED report is the source of
truth once you have the real export.
