# Phase 2 — Re-layout: change log, constraints & remaining work

Branch: **`relayout-salesforce-parity`** (created off `main`). Nothing committed, pushed, or PR'd.
Spec that drives all of this: `phase1-salesforce-spec/SPEC.md`.

## Important environment constraints (please read)

The sandbox I worked in could **not** run the app's toolchain, so I could not satisfy two of
the brief's hard constraints here — you'll need to do them on your machine:

1. **`node_modules` is not installed and the npm registry is blocked (HTTP 403)** in the sandbox.
   → I could not run `npx tsc --noEmit` (hard constraint #5), could not read
   `node_modules/next/dist/docs` (hard constraint #1), and could not start the dev server / DB.
2. Because of that, **every edit below is unverified by a compiler.** I kept changes to
   *low-risk transformations*: restructuring existing JSX, and reordering/renaming existing
   columns/fields — **no schema changes, no new data queries, no new imports of missing modules.**
   So the type surface is unchanged, but please run the checks below before trusting it.
3. A stale `.git/index.lock` exists that I lack permission to remove — harmless for read-only
   git, but you may want to `rm -f .git/index.lock` before committing.
4. The working tree had every file flagged as modified due to a **CRLF→LF line-ending** mismatch
   (index is LF; checkout was CRLF). I normalized *only the files I edited* to LF so their diffs
   are pure content. The other ~400 files still show as CRLF noise in `git diff` — that pre-existed
   my work. Consider adding a `.gitattributes` (`* text=auto eol=lf`) to settle it.

### Verify before trusting
```
rm -f .git/index.lock          # if you plan to commit
npm install
npm run typecheck              # tsc --noEmit  (hard constraint #5)
# start Postgres (docker) + npm run dev, then eyeball each screen vs Salesforce
```

## What I changed (real edits on the branch)

**Dashboard — `app/(app)/dashboard/page.tsx`** (the calibration piece, done first per your brief)
- Restructured the non-first-run view into the Salesforce two-column home shape: a left
  **"Salesperson's Activity"** column (Follow-ups Due = the "Today's Tasks" analogue) and a right
  **"Salesperson's Funnels"** column (Pending Approvals, Overdue Invoices, Stale Funnels). Added a
  `ColumnHeading` banner component to title each column like the reference.
- Uses **only existing data** from `getDashboardData()` — no new queries. Cards are the originals,
  just relocated. `KpiSection` (funnel value/count/approvals/follow-ups) stays above the two columns.

**List-view column order** (reordered/renamed existing columns to the SPEC order; added a column
only where the field already exists on the row type):
- `app/(app)/leads/leads-table.tsx` — added **Mobile** (`phone`), moved **Owner** up → order now
  Name · Company · Mobile · Email · Status · Owner · (Source · Stage · Converted · Created).
- `app/(app)/products/products-table.tsx` — added **Description** column after Name (SF: Name · Description).
- `app/(app)/funnel/funnels-table.tsx` — reordered to Name · Account · **Est. funnel amount** ·
  **Est. close date** · **Sales stage** · Owner · Status (+ relabels).
- `app/(app)/persons/persons-table.tsx` — moved **Email** above Title → Name · Account · Email · Title · Phone · Primary.
- `app/(app)/accounts/accounts-table.tsx` — moved **Owner** up right after Name.

**Detail body — `app/(app)/products/product-detail-body.tsx`** (representative regrouping)
- Renamed the Details sections to the SF names **"Product Information"** / **"Description Information"**,
  reordered fields to the SF sequence, and added the **Active** field. Existing fields only.

## Remaining work (documented, not yet coded — needs tsc to do safely)

The good news: **this app was already built to mirror Salesforce** (two-column detail, `Field`
helper, `RelatedQuickLinks`, `StagePath`, tabbed `DataTable` related lists — see
`funnel/[id]/funnel-detail-body.tsx`). So most detail pages are already structurally close; the
remaining work is mostly *section names, field order, and tab labels*, which is low-risk but I
didn't want to do 6 more files fully blind. Per-object deltas vs `SPEC.md`:

- **Lead** (`leads/[id]/lead-detail-body.tsx`): group into SF tabs *Company Information* /
  *Lead Information* / *Remarks*; highlights → Full Mobile Number, Email, Lead Designation,
  Lead Department, Company, Request Approval For. (Fields that don't exist in our schema — e.g.
  Marketing Event — stay omitted; **no schema changes**.)
- **Account** (`accounts/[id]/account-detail-body.tsx`): sections *Account Information* +
  *Address Information*; tabs Contacts/Opportunities/Funnels/Contracts to match related lists.
- **Contact** (`persons/[id]/person-detail-body.tsx`): section *Contact Information*; highlights
  Contact Designation · Department · Number · Email · Account.
- **Opportunity** (`opportunities/[id]/opportunity-detail-body.tsx`): tabs *Opportunity Info* /
  *Analysis* (PPVVC: 1-P Power Sponsor … 5-C Control) / *Funnels* / *Remarks*.
- **Funnel** (`funnel/[id]/funnel-detail-body.tsx`): already the richest match. Optional: rename the
  Details sections to *Opportunity Information* / *Funnel Info* / *Procurement Process (PP)* and add
  the Payment Milestones related tab (see module note below).
- **Quote** (`quotations/[id]/page.tsx` + `preview/page.tsx`): section *Quote Information*; the
  Quote Line Items grid columns → Product · Product Category · Description · UOM · Quantity ·
  Unit Price · Item Discount · Sub-total.

**List views still to reorder:** `opportunities/opportunities-table.tsx` (SF shows just the
Opportunity number — ours is a richer superset, arguably fine as-is) and the quotations list
(target: Quote Name · Funnel Name · Synced · Line Items · Ref No · Total Excl Tax · Tax · Total Incl Tax).

**Dashboard charts (needs new aggregate queries — deliberately deferred):** the reference right
column also has two bar charts — *funnel amount by owner × sales stage* and *closed deals by
product category* — plus *recently-viewed* lists and a *sales-activity-by-month* chart. These
require new read queries in `dashboard/actions.ts` and a `recharts` chart component. Sketch:
group `funnels` by `ownerMemberId` + stage summing `amount`; group quote/deal lines by product
category summing amount. I left these out because I couldn't verify new drizzle queries compile.

**Payment Milestone (hard constraint):** its UI is behind the **disabled `projects` module**
(`modules.config.ts`). Per your "don't enable a module without asking" rule, I did **not** enable
it. Surfacing Payment Milestones as a Funnel tab / standalone page needs your go-ahead to flip
that switch.
