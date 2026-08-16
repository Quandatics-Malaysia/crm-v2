# Vendor Quotation Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship reference-faithful CC/QAR external quotation templates as organization defaults and allow platform superadmins to manage tenant membership without fake tenant seats.

**Architecture:** CRM keeps authorization, tenant-default selection, sanitization, and rendering. The public external repository keeps vendor-editable HTML/CSS, SDK, validation, fixtures, and injection scripts. PostgreSQL explicitly authorizes either an active tenant Owner/Admin or a verified non-support platform superadmin.

**Tech Stack:** PostgreSQL/PLpgSQL, Drizzle, Next.js 16, TypeScript, Vitest, Node.js, HTML/CSS, Chrome headless PDF.

## Global Constraints

- Preserve active-organization, seat-limit, signed entitlement, RLS, and audit protections.
- Platform superadmin must not receive a tenant membership or consume a seat.
- External developers must not require CRM source access.
- Never commit API keys or production credentials.
- CC uses `citruscloud`; QAR uses `qarmour`; both become organization defaults.
- Account template override remains higher priority than organization default.
- Templates may use only the documented escaped token contract and sanitized HTML/CSS.
- Run all shell commands through `rtk`.

---

### Task 1: Superadmin deployment-seat authority

**Files:**
- Create: `apps/web/db/migrations/0075_superadmin_deployment_seat_actor.sql`
- Modify: `apps/web/db/migrations/meta/_journal.json`
- Modify: `apps/web/tests/deployment-seats-db.test.ts`

**Interfaces:**
- Produces: `require_deployment_seat_actor(text, text, text)` accepting a non-support `user.is_superadmin = true` actor with null member ID.

- [ ] Add a failing DB test that activates a membership using a superadmin actor user and null actor member.
- [ ] Add rejection coverage for ordinary and vendor-support users with null actor member.
- [ ] Run `rtk pnpm --dir apps/web exec vitest run tests/deployment-seats-db.test.ts`; expect the superadmin case to fail with the current Owner/Admin error.
- [ ] Add migration `0075` using `CREATE OR REPLACE FUNCTION`; call `require_active_organization` first, accept verified non-support superadmin, otherwise retain the exact existing Owner/Admin membership predicate.
- [ ] Append migration metadata without modifying prior migration files.
- [ ] Re-run the focused DB test; expect all cases to pass.
- [ ] Commit with `fix: authorize superadmin seat administration`.

### Task 2: Tenant quotation-default API

**Files:**
- Create: `apps/web/app/api/v1/quotation-templates/default/route.ts`
- Modify: `apps/web/lib/quotation-template-api.ts`
- Modify: `apps/web/tests/quotation-template-api.routes.test.ts`
- Modify: `apps/web/app/documentation/content-reference.tsx`

**Interfaces:**
- Produces: `GET /api/v1/quotation-templates/default` returning `{ quotationTemplateCode }`.
- Produces: `PATCH /api/v1/quotation-templates/default` accepting `{ quotationTemplateCode: string | null }`.

- [ ] Add failing route tests for reading, setting an active tenant template, clearing the default, rejecting an unknown/inactive code, and tenant isolation.
- [ ] Run `rtk pnpm --dir apps/web exec vitest run tests/quotation-template-api.routes.test.ts`; expect missing-route failures.
- [ ] Add a Zod request schema and tenant-scoped read/update helpers.
- [ ] Implement GET/PATCH using existing API-key authentication, request IDs, normalized codes, and tenant-scoped transactions.
- [ ] Document curl examples and precedence: account override, tenant default, legacy fallback.
- [ ] Re-run focused tests; expect all cases to pass.
- [ ] Commit with `feat: expose tenant quotation default API`.

### Task 3: CRM verification

**Files:**
- Modify only files exposed by verification defects.

- [ ] Run `rtk pnpm test`.
- [ ] Run `rtk pnpm test:workflows`.
- [ ] Run `rtk pnpm lint`.
- [ ] Run `rtk pnpm build`.
- [ ] Run `rtk git diff --check` and inspect the complete branch diff.
- [ ] Commit only targeted verification fixes, if any.

### Task 4: External vendor template pack

**Repository:** `Super-ERP/external-platform-customizations`

**Files:**
- Modify: `modules/quotation/templates/cc/template.html`
- Modify: `modules/quotation/templates/cc/styles.css`
- Modify: `modules/quotation/templates/qar/template.html`
- Modify: `modules/quotation/templates/qar/styles.css`
- Modify: `modules/quotation/definitions/templates.json`
- Create: `modules/quotation/fixtures/cc.json`
- Create: `modules/quotation/fixtures/qar.json`
- Create: `scripts/render-quotation-fixtures.mjs`
- Modify: `scripts/validate-quotation-templates.mjs`
- Modify: `sdk/quotation-templates.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: `client.getDefault()` and `client.setDefault(code)`.
- Produces: reference-faithful A4 fixture HTML/PDF for `citruscloud` and `qarmour`.

- [ ] Create an isolated external-repository branch from `origin/main` and run the existing validation baseline.
- [ ] Add SDK tests for default GET/PATCH before implementation; verify failure.
- [ ] Implement `getDefault()` and `setDefault(quotationTemplateCode)` against the CRM endpoint.
- [ ] Rewrite CC HTML/CSS to match the supplied one-page PDF geometry and labels.
- [ ] Rewrite QAR HTML/CSS to match the supplied Excel print layout geometry and labels.
- [ ] Add fixture data and a renderer that expands documented tokens/line loops into standalone A4 HTML and optionally calls `CHROME_BIN --headless --print-to-pdf`.
- [ ] Extend validation for required root classes, required labels, default codes, forbidden constructs, and fixture completeness.
- [ ] Document vendor edit, validate, render, stage, activate, verify, and rollback commands.
- [ ] Run `rtk pnpm test`, `rtk pnpm validate`, render both PDFs, and inspect every page against the references.
- [ ] Commit with `feat: match CC and QAR quotation references`.

### Task 5: Pull requests and merge

- [ ] Push the CRM branch and open a PR referencing the approved spec and verification results.
- [ ] Push the external branch and open a PR referencing both supplied templates and vendor workflow.
- [ ] Wait for both CI suites; fix only evidenced failures.
- [ ] Review both diffs for credentials, unsafe template content, SQL authority widening, and unrelated changes.
- [ ] Squash-merge both PRs into `main` and confirm remote main SHAs.

### Task 6: Release, production injection, and canary

- [ ] Tag the next CRM patch release from exact `origin/main` and run signed release-images workflow.
- [ ] Create and restore-verify a fresh pre-deploy PostgreSQL backup; generate signed backup evidence for the currently deployed release.
- [ ] Run and approve the production deployment workflow; require successful migration and healthy containers.
- [ ] Obtain separate tenant-scoped API credentials for the intended QAR and CC organizations without committing or logging them.
- [ ] Apply `qarmour` to Q Armour and `citruscloud` to Citrus Cloud; set each as the tenant default.
- [ ] Read templates and defaults back through the API and compare source hashes.
- [ ] Generate representative production quotation previews and visually inspect A4 output against both references.
- [ ] Verify `/api/health`, release/migration identity, active entitlement, container health, and absence of new web/database errors.
- [ ] Confirm the previously failing superadmin membership activation succeeds and produces an audit row without a superadmin tenant membership.

