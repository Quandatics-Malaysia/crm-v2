# CC and QAR Quotation Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CRM quotation preview use the supplied CC and QAR layouts with the active tenant logo and correct account/template selection.

**Architecture:** Keep CC/QAR as built-in React renderers in the existing preview route. Extend the quotation document query with account-level template selection and resolve the final code before selecting the renderer; leave the external HTML/CSS API registry available for a later renderer. Use focused tests for resolution and run the production build.

**Tech Stack:** Next.js 16, React, TypeScript, Drizzle ORM, Vitest, Tailwind CSS, PostgreSQL.

## Global Constraints

- Use the existing tenant-scoped authorization and database helpers.
- Use the application tenant logo endpoint; do not add hard-coded customer logo assets.
- Preserve the existing default quotation renderer and legacy `cc`/`qar` aliases.
- Keep this change quotation-template-only; invoice/document modules are not included.
- Run commands through `rtk` and verify before claiming completion.

### Task 1: Record and commit the approved design

**Files:**
- Create: `docs/superpowers/specs/2026-08-16-quotation-templates-design.md`
- Create: `docs/superpowers/plans/2026-08-16-quotation-templates.md`

- [ ] **Step 1: Check the planning documents for placeholders and conflicting scope**

Run:

```bash
rtk rg -n "TODO|TBD|implement later|invoice" docs/superpowers/specs/2026-08-16-quotation-templates-design.md docs/superpowers/plans/2026-08-16-quotation-templates.md
```

Expected: no placeholder matches; invoice appears only in the explicit out-of-scope constraint.

- [ ] **Step 2: Commit the approved design and plan**

```bash
git add docs/superpowers/specs/2026-08-16-quotation-templates-design.md docs/superpowers/plans/2026-08-16-quotation-templates.md
git commit -m "docs: plan cc and qar quotation templates"
```

### Task 2: Load the selected account template

**Files:**
- Modify: `apps/web/app/(app)/quotations/actions.ts`
- Modify: `apps/web/lib/quotation-pdf-template.ts`
- Test: `apps/web/tests/quotation-pdf-template.test.ts`

**Interfaces:**
- `resolveQuotationPdfTemplate(input)` accepts `rawTemplateCode`, legacy identity fields, and optional `allowedCodes`; it returns the selected string code.
- `QuotationDocument` exposes the selected `pdfTemplateKey` to the preview page.

- [ ] **Step 1: Add a failing resolver test for account override**

```ts
it("uses the account template code before tenant identity", () => {
  expect(resolveQuotationPdfTemplate({
    rawTemplateCode: "cc",
    legacyKey: "QAR",
    entityCode: "QAR",
    entitySlug: "q-armour",
    entityName: "Q Armour Sdn Bhd",
  })).toBe("cc")
})
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --dir apps/web exec vitest run tests/quotation-pdf-template.test.ts`

Expected: the new test fails because the document query does not yet provide the account override path in preview data.

- [ ] **Step 3: Extend the quotation document query**

Select `accounts.quotationTemplateCode` with the quotation account, return it as `accountQuotationTemplateCode`, and set `pdfTemplateKey` to that account code when present; otherwise retain the current tenant/entity fallback. Keep the reseller attention-contact behavior unchanged.

- [ ] **Step 4: Resolve the selected code in the preview page**

Pass the account-level code as `rawTemplateCode` and the tenant/entity code as `legacyKey` only for backward compatibility. Keep the default route unchanged when the final result is `default`.

- [ ] **Step 5: Run the focused test and type check**

Run: `pnpm --dir apps/web exec vitest run tests/quotation-pdf-template.test.ts`

Expected: all resolver tests pass.

### Task 3: Align the built-in CC/QAR renderer to the references

**Files:**
- Modify: `apps/web/app/(app)/quotations/[id]/preview/entity-quotation-document.tsx`
- Test: `apps/web/tests/quotation-pdf-template.test.ts`

- [ ] **Step 1: Add renderer contract assertions**

Assert that the source contains the required CC headers and QAR headers, and that the tenant logo uses `/api/tenant-logo`. Keep assertions narrow so they protect the document contract without coupling tests to every CSS class.

- [ ] **Step 2: Update the header/meta layout**

Use the supplied reference proportions: CC places logo left and company details right; QAR keeps the company block in the upper header. Show `Ref. No`, `Date`, `Currency`, `Delivery`, `Payment Term`, `Quote Validity`, and `Price` in the metadata block, using existing quotation/company data and safe em dashes where fields are not stored.

- [ ] **Step 3: Update CC and QAR line tables**

Keep the exact entity-specific headers and widths. Preserve wrapped descriptions, SKU/UOM values, numeric alignment, and blank-row spacing. Use the existing calculated line totals and currency formatter.

- [ ] **Step 4: Update totals/footer behavior**

Render the supplied total labels, notes, prepared-by block, computer-generated disclaimer, and CC footer. Use the tenant company profile for website/email/phone and the tenant logo endpoint for branding.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --dir apps/web exec vitest run tests/quotation-pdf-template.test.ts tests/quotation-math.test.ts`

Expected: all selected tests pass.

### Task 4: Production verification

**Files:**
- Modify: none unless verification exposes a defect.

- [ ] **Step 1: Run the web test suite**

Run: `pnpm --dir apps/web test --run`

Expected: exit code 0 with no failed tests.

- [ ] **Step 2: Run the production build**

Run: `pnpm build`

Expected: exit code 0.

- [ ] **Step 3: Inspect the final diff and working tree**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the intended docs, action, resolver, renderer, and test files changed.
