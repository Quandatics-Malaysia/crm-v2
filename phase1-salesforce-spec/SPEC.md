# Phase 1 — Salesforce Reference Spec (Quandatics Sales org)

Reference org: `connect-momentum-5641.lightning.force.com` — app **"Quandatics Sales"**.
Goal: re-layout the TARGET app (`crm-v2`) so list views, detail layouts, related lists,
and the home dashboard *more or less* match this reference, using our own components.

> Note on screenshots: this browser session can't persist screenshots to image files,
> so each object below is documented in structured text captured directly from the live org.
> I can re-open any screen on request.

Nav bar (object order in the Quandatics Sales app):
**Home · Leads · Lead's Companies · Accounts · Contacts · Opportunities · Funnels · Quotes · Project Items List · Payment Milestones · Reports · Dashboards · Products**

---

## 1. Dashboard / Home

**Layout:** Full-width rich-text banner across the top, then a **two-column** region.
Left column header **"Salesperson's Activity"**, right column header **"Salesperson's Funnels"**.

**Top banner (rich text component):** `Quandatics Malaysia | Engage, Envision, Elevate`

### Left column — "Salesperson's Activity"
1. **Today's Tasks** — task list component ("Nothing due today…", with a **View All** button). Header shows a filter caret.
2. **Quandatics: Sales Activity This Year** — report chart (vertical bar). X-axis = Month (1–7), Y-axis = Record Count. "View Report" link + "As of Today at …" timestamp.
3. **Recently-Viewed Leads (2)** — recent-records list card. Each row shows a lead avatar + linked **Name**, then fields: **Full Mobile Number, Email, Lead Designation, Lead Department, Company, Request Approval Status**.

### Right column — "Salesperson's Funnels"
1. **Dashboard: "Home Page"** — subtitle "Overview for Salesperson". Two dashboard filters at top: **Expected Close Year** and **Expected Close Month** (both default "All"). Open / Refresh buttons.
   - **Chart A — "QM Sales Report by Salesperson"**: horizontal bar. Rows grouped by **Funnel Owner** then **Sales Stage**; measure = **Sum of Estimated Funnel Amount (converted) (MYR)**. Legend = Sales Stage (0E Qualification, 1D Qualified Condition, 2C Evaluation Condition, 3B High Chance To Proceed Condition, 4A Almost Win, Closed Won, Renewal).
   - **Chart B — "Quandatics Closed Deals by Products"**: horizontal bar. Rows grouped by **Product Category** (Renewal, PS, NPS, Training, Coaching); measure = **Sum of Amount**.
2. **Recently-Viewed Funnels (6)** — recent-records grid (3 across). Each card: crown icon + linked **Funnel Name**, then fields: **Opportunity (number), Estimated Funnel Close Date, Funnel Owner, Account Name, Estimated Funnel Amount, Sales Stage**.

**Target mapping:** `app/(app)/dashboard/page.tsx` — build a two-column dashboard: left = tasks + activity bar chart + recently-viewed leads; right = the two funnel charts (by owner/stage, by product category) + recently-viewed funnels. Reuse existing chart/card components.

---

## 2. Lead

**List view** (`Leads` tab, "Recently Viewed"). Columns in order:
**Lead Name · Company · Mobile · Email · Lead Status · Owner Alias**
List actions: **Import · Change Owner · New Lead**.

**Detail page — Highlights panel.** Avatar + Lead Name. Actions: **Edit · Submit Approval for Lead Conversion · Delete** (+ caret). Compact highlight fields:
**Full Mobile Number · Email · Lead Designation · Lead Department · Company · Request Approval For**.

**Path component** (Lead Status): **Unqualified → Working → Nurturing → Converted**, with "Mark Status as Complete".

**Detail tabs & field sections** (right/main region):
- **Company Information** tab → section *Company Information*: **Company Name** (link), **Company Address**, **Company Website**, **Company Phone**, **Lead Owner**.
- **Lead Information** tab → section *Lead Information* (2 cols):
  - col 1: **Lead Name, Lead Designation, Lead Department, Country, Country Code, Email, Mobile**
  - col 2: **Industry, Lead Source, Lead Currency, Marketing Event, Request Approval For**
- **Remarks** tab → **Notes** + **Files** related lists.

**Related List Quick Links** (object-tile card, left col): **Campaign History · Notes · Files · Lead History · Approval History**.
Plus an **Approval History** card rendered in the left column.

**Target mapping:** `app/(app)/leads/leads-table.tsx` (list cols) and `[id]/lead-detail-body.tsx` (highlights + path + 3 tabs + quick links).

---

## 3. Opportunity  (Salesforce object `Opportunity_ID__c`, label **"Opportunities"**)

> IMPORTANT naming: in this org the **standard `Opportunity` object is labelled "Funnels"**
> (the deal-level records). The nav **"Opportunities"** tab is a *custom* object
> `Opportunity_ID__c` — a lightweight **deal-number header** (e.g. `QMOP28122-BRNM`) that
> groups one or more Funnels. This matches the target app's split of `opportunities/` vs `funnel/`.

**List view** (`Opportunities` tab): single column **Opportunity** (the deal number).
List actions: **New · Import · Change Owner · Assign Label · New Opportunity**.

**Detail page.** Top: collapsible **"Show Dashboards"** region (embedded dashboard, collapsed by default).
**Highlights panel** — Name = deal number. Actions **Edit · Delete · Clone · Change Owner**. Highlight fields:
**Account Name · Opportunity Nature · Opportunity Owner Contact · Opportunity Owner Budget Limit · New Business? · Total Estimated Funnel Amount**.

**Tabs & sections:**
- **Opportunity Info** → section (unnamed) *Renewal Opportunity?*; then section *Information* (2 cols):
  - col1: **Account Name, Owner, Opportunity Nature, Opportunity Year, Opportunity Description, New Business?**
  - col2: **Opportunity Owner Contact, Opportunity Owner Designation, Currency, Opportunity Owner Budget Limit, Assigned Presales, Competitor**
- **Analysis** → PPVVC methodology sections:
  - **1-P: Power Sponsor (PS)**: Power Sponsor Contact, Power Sponsor Designation, Power Sponsor Budget Limit
  - **2-P: Pain (Objective)**: Objective
  - **3-V: Vision**: Vision
  - **4-V: Value**: Value
  - **5-C: Control**: Estimated Budget, Estimated Close Date
- **Funnels** → related list. Columns: **Funnel Name · Sales Stage · Estimated Funnel Amount · Estimated Funnel Close Date · Funnel Owner** (New button).
- **Remarks** → Notes + Files.

**Related List Quick Links:** **Funnels · Notes · Files · Opportunity History**. Plus **Opportunity History** card in left column.

**Target mapping:** `app/(app)/opportunities/...` list + `[id]/opportunity-detail-body.tsx`.

---

## 4. Funnel  (Salesforce standard `Opportunity`, label **"Funnels"**)

**List view** (`Funnels` tab). Columns in order:
**Funnel Name · Account Name · Power Sponsor Contact · Estimated Funnel Amount · Estimated Funnel Close Date · Sales Stage · Created Date · Procurement Process Stage** (values RFI/RFQ/RFP/KIV/Direct) **· Probability**.
List actions: **New · Pipeline Inspection**.

**Detail page — Highlights panel.** Name = funnel name. Actions **Edit · Clone · Delete · Sharing**. Highlight fields:
**Opportunity (deal #) · Estimated Funnel Close Date · Funnel Owner · Account Name · Estimated Funnel Amount · Sales Stage**.

**Sales Path** (Sales Stage): **0E - Qualification Stage → 1D - Qualified Condition → 2C - Evaluation Condition → 3B - High Chance To Proceed → 4A - Almost Win → Closed Lost → KIV → Closed Won**. Path shows **Key Fields** (Vision, Estimated Funnel Close Date) + **Guidance for Success** panel per stage.

**Tabs:** **Activity · Details · Quote · Project Items List · Payment Milestones · Remarks · Sales Stage History · Approval History**.

**Details tab — field sections:**
- **Opportunity Information** (2 cols):
  - col1: **Opportunity, Opportunity Nature, Opportunity Year, Assigned Presales, Opportunity Owner Contact, Opportunity Owner Designation, Opportunity Owner Budget Limit**
  - col2: **Point of Contact, Contact Department, Contact Designation, New Business?, Bypass Validation**
- **Funnel Info** (2 cols):
  - col1: **Funnel Name, Funnel Description, Funnel Currency, Estimated Funnel Amount, Quoted Amount, Recognized Percentage, Recognized Amount, Project Year/License Year, Estimated Funnel Close Date**
  - col2: **Sales Stage, Next Stage (for Approval), Stage Approval Status, Probability, Cross Deal?, Has Project Items List?**
- **Procurement Process (PP)**: **Procurement Process Stage, Tender Release Date, Tender Submission Date, POC Date**
- **Supporting Documents and Remarks** (collapsed section; docs + remarks)

**Related List Quick Links:** **Quotes · Products · Project Items List · Payment Milestones · Contracts · Stage History** (+ Show All = 10 total). Plus **Approval History** and **Funnel Field History** cards in left column.

**Target mapping:** `app/(app)/funnel/funnel-table.tsx` + `[id]/funnel-detail-body.tsx`. This is the flagship object — highlights + sales path + the multi-tab body with the field sections above + quick links.

---

## 5. Quote  (Salesforce `Quote`)

**List view** (`Quotes` tab). Columns in order:
**Quote Name · Funnel Name · Synced · Line Items (count) · Ref No · Total Excluding Tax · Tax Amount · Total Including Tax**.
List action: **New Quote**.

**Detail page — Highlights panel.** Name = quote name. Actions **Create PDF · Duplicate Quote · Easy Sort · Start Sync · Change Owner · Edit** (+caret).
Compact highlight fields: **Quote Number · Account Name · Syncing · Funnel Name · Total Excluding Tax · Tax Amount**.

**Status Path** (Quote Status): 4 segments ending **Finalized** (Draft → In Review → Approved → Finalized). Info banner: "Please upload the Calculation File to the Remarks tab to proceed to submitting request for approval!".

**Tabs:** **Quote Line Items · Quote PDFs · Details · Remarks**.

**Details tab — section *Quote Information*** (2 cols):
- col1: **OldRecord(Don't touch!), Quote Running Number, Quote Number, Quote Name, Ref No, Funnel Name, Note**
- col2: **Quote Validity, Date, Status, Approval Status, Delivery, Payment Term, Syncing, Quote Record Type**

**Related List Quick Links:** **Quote Line Items · Quote PDFs · Notes · Files · Approval History · Quote History**. Plus **Approval History** card in left column.

**Target mapping:** `app/(app)/quotations/quotations-table.tsx` + `[id]/page.tsx` (detail) + `[id]/preview/page.tsx` (the "Create PDF"/preview surface). Line-item related list = Quote Line Items.

---

## 6. Account  (Salesforce `Account`)

**List view** (`Accounts` tab). Columns in order: **Account Name · Phone · Account Owner Alias**.
List actions: **New · Import**.

**Detail page — Highlights panel.** Name. Actions **Edit · Reassign Owner · Delete · Sharing**.
Highlight fields: **Owner · Phone · Billing Address · Website**.

**Tabs:** **Activity · Account Details · Contacts · Opportunities · Funnels · Contracts · Remarks · Approval History**.

**Account Details tab — field sections:**
- **Account Information** (2 cols):
  - col1: **Company Name, Company Code, Company Registration No 1, Company Registration No 2, Employees, Phone, Website, Budgeting Date**
  - col2: **Account Type, Industry, Account Currency, Owner, Description**
- **Address Information**: **Billing Address**

**Related List Quick Links:** **Contacts · Opportunities · Funnels · Contracts · Cases · Notes** (Show All = 9). Plus **Account History** card in left column.

**Target mapping:** `app/(app)/accounts/accounts-table.tsx` + `[id]/account-detail-body.tsx`.

---

## 7. Contact  (Salesforce `Contact`)

**List view** (`Contacts` tab). Columns in order: **Contact Name · Account Name · Contact Email · Contact Owner Alias**.
List actions: **New · Import · Send Email**.

**Detail page — Highlights panel.** Name (salutation prefix, e.g. "Mr."). Actions **Edit · Delete · Clone · Change Owner**.
Highlight fields: **Contact Designation · Contact Department · Contact Number · Contact Email · Account Name**.

**Tabs:** **Activity · Contact Details · Account Details · Opportunities · Quotes · Remarks**.

**Contact Details tab — section *Contact Information*** (2 cols):
- col1: **Contact Name, Contact Designation, Contact Department, Contact Email**
- col2: **Country, Country Code, Mobile, Contact Currency**

**Related List Quick Links:** **Quotes · Cases · Files · Notes · Contact History**. Plus **Contact History** card in left column.

**Target mapping:** `app/(app)/persons/persons-table.tsx` + `[id]/person-detail-body.tsx`.

---

## 8. Product  (Salesforce `Product2`)

**List view** (`Products` tab). Columns in order: **Product Name · Product Description**.
List action: **New**.

**Detail page — Highlights panel.** Name. Actions **Clone · Edit · Delete**.
Highlight fields: **Product Category · Product Subcategory · UOM · Product Currency**.

**Tabs:** **Product Details · Price Books · Remarks · Quote Line Items**.

**Product Details tab — field sections:**
- **Product Information** (2 cols):
  - col1: **Product Name, Product Category, Product Subcategory**
  - col2: **UOM, Product Currency, Active**
- **Description Information**: **Product Description, Product Remarks**

**Related List Quick Links:** **Product History · Price Books · Opportunities · Notes · Files**. Plus **Product History** card in left column.

**Target mapping:** `app/(app)/products/products-table.tsx` + `[id]/product-detail-body.tsx`.

---

## 9. Payment Milestone  (Salesforce `Payment_Milestone__c`)

> ⚠️ Core-Edition note: in the TARGET app the Payment Milestone UI lives behind the
> **disabled `projects` module** (`modules.config.ts`). Per the brief + your "don't enable a
> module without asking" hard constraint, I will **not** enable it. Where the reference shows
> Payment Milestones as a **related list/tab** on Funnel, I'll add that tab **only if** the data is
> already available without enabling a module; a standalone Payment Milestone page is deferred.

**List view** (`Payment Milestones` tab): single column **Payment Milestone Name**.
List actions: **New · Import · Change Owner · Assign Label**.

**Detail page — Highlights panel.** Name. Actions **Edit · Clone · Delete · Change Owner · New Note**.
Highlight fields: **Quote Number · Invoice Number · Amount · Actual Invoice Date · Payment Received?**.

**Invoice Status Path**: 4 segments ending **Invoiced**; Key Fields (Actual Invoice Date, Invoice Number) + Guidance for Success.

**Tabs:** **Payment Milestone Details · Invoice Details · Remarks**.

**Payment Milestone Details tab — section *Payment Milestone*** (2 cols):
- col1: **Payment Milestone Name, Funnels, Company (End User), Company (Reseller), PO or Ref No., SO Number, Project Items List**
- col2: **Product Name, Product Category, Product Subcategory, Quote Name, Quote Number, Project Code**

**Related List Quick Links:** **Notes · Files · Payment Milestone History**.

**Target mapping:** schema exists under `billing`; UI gated by disabled `projects` module. Add as a Funnel related tab only if feasible without enabling a module — otherwise note as deferred.

---

## 10. Quote Line Item  (related list on Quote / Product / Funnel)

Appears as the **Quote Line Items** tab & related list on the Quote record (also a related list on
Product and a quick-link on Funnel). No dedicated nav tab. Grid columns in order:
**Product · Product Category · Description · UOM · Quantity · Unit Price · Item Discount · Sub-total**
(+ tax/total columns off to the right). List actions: **Add Products · Edit Products**.
The line-item grid rolls up into the Quote's **Total Excluding Tax / Tax Amount / Total Including Tax**.

**Target mapping:** rendered inside the quotation detail/preview (`quotations/[id]/page.tsx`,
`[id]/preview/page.tsx`) as the line-items table — not a standalone list view.

---
