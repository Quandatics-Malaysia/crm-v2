# Salesforce ↔ Custom CRM — side-by-side comparison & gap flags

**Reference org:** "Quandatics Sales" (`connect-momentum-5641.lightning.force.com`)
**Target app:** custom CRM (`crm-v2`), running locally at `http://localhost:3000`.

**How this was produced.** The Salesforce column is captured from the live org (Dashboard, Lead
list+record, Funnel list+record, Payment Milestone list+record viewed directly; the remaining objects
confirmed against `SPEC.md`, which was verified accurate against the live org). The **Custom CRM**
column reflects the app's *current* layout read directly from source (`*-detail-body.tsx`,
`*-table.tsx`, `dashboard/page.tsx`) — this is more precise for field order / section names than a
screenshot. Screenshot image files could not be persisted from the automation session, so each row
is described in structured text rather than embedded PNGs.

**🚩 Flag** = something Salesforce has that our CRM should adopt. Status key: ✅ done · 🟡 partial · ⬜ to build.

---

## 1. Dashboard / Home  — 🟡 partial

**CRM route:** `/dashboard` · `app/(app)/dashboard/page.tsx`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| Rich-text banner "Quandatics Malaysia \| Engage, Envision, Elevate" across the top, then **two columns**: **Salesperson's Activity** (left) / **Salesperson's Funnels** (right). | ✅ Two-column layout with `ColumnHeading` "Salesperson's Activity" / "Salesperson's Funnels", above a `KpiSection` funnel rollup and a Getting-Started checklist. |
| **Left:** Today's Tasks · "Sales Activity This Year" vertical bar chart (records/month) · Recently-Viewed Leads card. | Left column shows **Follow-ups Due** card only. |
| **Right:** dashboard filters (Expected Close Year/Month) · **QM Sales Report by Salesperson** horizontal bar (funnel amount by owner × sales stage) · **Closed Deals by Products** horizontal bar (amount by product category) · Recently-Viewed Funnels grid. | Right column shows **Pending Approvals**, **Overdue Invoices** (conditional), **Stale Funnels** cards. No charts. |

**🚩 Flags for CRM**

- ⬜ Add **"Funnel amount by owner × sales stage"** bar chart (group `funnels` by `ownerMemberId` + stage, sum `amount`).
- ⬜ Add **"Closed deals by product category"** bar chart.
- ⬜ Add **Sales-activity-by-month** chart and **Recently-Viewed Leads / Funnels** cards.
- Note: charts need *new aggregate read queries* in `dashboard/actions.ts` + a `recharts`/`@/components/ui/chart` component. Two-column shell is already done.

---

## 2. Lead  — 🟡 partial

**SF object:** `Lead` · **CRM:** `/leads`, `/leads/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Lead Name · Company · Mobile · Email · Lead Status · Owner Alias. | ✅ Name · Company · Mobile · Email · Status · Owner · Source · Stage · Converted · Created. |
| **Highlights:** Full Mobile Number · Email · Lead Designation · Lead Department · Company · Request Approval For. | Left **Details** card (dynamic `label/value` list) + related quick-links (Account, Contact, Opportunity, Documents). |
| **Path:** Unqualified → Working → Nurturing → Converted. | ✅ `StagePathView` for lead status (+ funnel path once converted). |
| **Tabs/sections:** *Company Information* (Company Name, Address, Website, Phone, Lead Owner) · *Lead Information* (Name, Designation, Department, Country, Country Code, Email, Mobile / Industry, Source, Currency, Marketing Event, Request Approval For) · *Remarks* (Notes + Files). | Right card tabs: **Activity** · **Documents**. No SF-named field sections. |
| **Related lists:** Campaign History · Notes · Files · Lead History · Approval History. | Activity timeline + Documents. |

**🚩 Flags for CRM**

- ⬜ Regroup the detail body into **Company Information / Lead Information / Remarks** tabs matching SF.
- ⬜ Set the highlight strip to **Full Mobile Number · Email · Lead Designation · Lead Department · Company · Request Approval For** (using fields we have).
- Omit SF fields with no column in our schema (e.g. *Marketing Event*) — no schema changes.

---

## 3. Opportunity  — 🟡 partial

**SF object:** `Opportunity_ID__c` (deal-number header) · **CRM:** `/opportunities`, `/opportunities/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** single column **Opportunity** (deal number, e.g. `QMOP28122-BRNM`). | Superset: Code · Opportunity · Account · Owner · Funnels · Est. funnel amount. |
| **Highlights:** Account Name · Opportunity Nature · Opportunity Owner Contact · Owner Budget Limit · New Business? · Total Estimated Funnel Amount. | Left Details card: Code · Account · Owner · Total est. funnel amount · Funnels count. |
| **Tabs:** *Opportunity Info* (Account, Owner, Nature, Year, Description, New Business? / Owner Contact, Designation, Currency, Budget Limit, Assigned Presales, Competitor) · *Analysis* PPVVC (1-P Power Sponsor · 2-P Pain · 3-V Vision · 4-V Value · 5-C Control) · *Funnels* · *Remarks*. | Tabs: **Funnels** · **Quotations** · **Products** · **Analysis (PPVVC)** — the analysis grid already has Pain/Power/Vision/Value/Control. |
| **Related lists:** Funnels · Notes · Files · Opportunity History. | Funnels / Quotations / Products related tables. |

**🚩 Flags for CRM**

- ⬜ Relabel the Analysis tab into the SF **PPVVC** section headings (**1-P: Power Sponsor · 2-P: Pain · 3-V: Vision · 4-V: Value · 5-C: Control**).
- ⬜ Add an **Opportunity Info** section grouping the header fields we have; add a **Remarks** tab (Notes/Files/Documents).
- List can stay a superset (richer than SF) or optionally lead with **Opportunity · Account · Total Estimated Funnel Amount**.
- Omit SF fields absent from schema (Opportunity Nature, Owner Budget Limit, New Business?, Competitor) unless a column exists.

---

## 4. Funnel  — 🟡 partial (flagship)

**SF object:** `Opportunity` (label "Funnels") · **CRM:** `/funnel`, `/funnel/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Funnel Name · Account · Power Sponsor Contact · Est. Funnel Amount · Est. Close Date · Sales Stage · Created · Procurement Stage · Probability. | ✅ Name · Account · Est. funnel amount · Est. close date · Sales stage · Owner · Status. |
| **Highlights:** Opportunity · Est. Funnel Close Date · Funnel Owner · Account · Est. Funnel Amount · Sales Stage. | Left Details card carries Account, Opportunity, Stage, Status, amounts, Owner, Contact, nature, close date. |
| **Sales Path:** 0E → 1D → 2C → 3B → 4A → Closed Lost → KIV → Closed Won, with Key Fields + Guidance panel. | ✅ `StagePath` (interactive, with stage-gate validation). |
| **Tabs:** Activity · Details · Quote · Project Items List · **Payment Milestones** · Remarks · Sales Stage History · Approval History. | Tabs: **Activity · Quotations · Products · Projects · Costs & margin · Contract · Stage history · Documents** — **no Payment Milestones tab**. |
| **Details sections:** *Opportunity Information* · *Funnel Info* · *Procurement Process (PP)* · *Supporting Documents & Remarks*. | Fields live in the left Details card (not SF-named sections). |
| **Related quick links:** Quotes · Products · Project Items List · **Payment Milestones** · Contracts · Stage History. | Quick links via related tabs; no Payment Milestones link. |

**🚩 Flags for CRM**

- ⬜ **Add a "Payment Milestones" related tab** on the Funnel (DataTable: Name · Amount · Status · Invoice Number · Invoice Date) + a `RelatedQuickLinks` entry. *(This is the big one — see §9.)*
- ⬜ Optionally rename the Details grouping to **Opportunity Information / Funnel Info / Procurement Process (PP)** to mirror SF section names.

---

## 5. Quote  — ⬜ to build

**SF object:** `Quote` · **CRM:** `/quotations`, `/quotations/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Quote Name · Funnel Name · Synced · Line Items (count) · Ref No · Total Excluding Tax · Tax Amount · Total Including Tax. | Number · Funnel · Status · Total · Primary · Valid until. |
| **Highlights:** Quote Number · Account · Syncing · Funnel Name · Total Excluding Tax · Tax Amount. | Header with quote number + funnel/opportunity links + action buttons (`QuotationForm`). |
| **Path:** Draft → In Review → Approved → Finalized. | (form-based, status field). |
| **Tabs:** Quote Line Items · Quote PDFs · Details · Remarks. | Form sections. |
| **Line-item grid:** Product · Product Category · Description · UOM · Quantity · Unit Price · Item Discount · Sub-total. | Line-items grid inside the quotation form/preview. |

**🚩 Flags for CRM**

- ⬜ Reorder the **list** toward: Quote Name · Funnel Name · Synced · Line Items · Ref No · Total Excl Tax · Tax Amount · Total Incl Tax (add the columns whose data the row already carries; no schema changes).
- ⬜ Align the **line-item grid** column order/labels to SF: Product · Product Category · Description · UOM · Quantity · Unit Price · Item Discount · Sub-total.
- ⬜ Name the details section **Quote Information**.

---

## 6. Account  — 🟡 partial

**SF object:** `Account` · **CRM:** `/accounts`, `/accounts/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Account Name · Phone · Account Owner Alias. | ✅ Name · Owner · Code · Type · Industry · Parent account · Created. |
| **Highlights:** Owner · Phone · Billing Address · Website. | Left Details card (dynamic list) + quick links (Contacts/Opportunities/Funnels/Projects/Quotations/Child accounts). |
| **Tabs:** Activity · Account Details · Contacts · Opportunities · Funnels · Contracts · Remarks · Approval History. | Tabs: **Contacts · Opportunities · Funnels · Projects · Quotations · Child accounts · Activity · Documents**. |
| **Account Details sections:** *Account Information* (Company Name, Code, Reg No 1/2, Employees, Phone, Website, Budgeting Date / Type, Industry, Currency, Owner, Description) · *Address Information* (Billing Address). | Fields in left Details card; no SF-named sections. |

**🚩 Flags for CRM**

- ⬜ Group the account fields into **Account Information** + **Address Information** sections (add a Billing Address block using the fields we have).
- Tabs already closely match SF (Contacts/Opportunities/Funnels present).

---

## 7. Contact  — 🟡 partial

**SF object:** `Contact` · **CRM:** `/persons`, `/persons/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Contact Name · Account Name · Contact Email · Contact Owner Alias. | ✅ Name · Account · Email · Title · Phone · Primary. |
| **Highlights:** Contact Designation · Department · Number · Email · Account. | Left Details card + quick links (Funnels/Projects). |
| **Section:** *Contact Information* (Name, Designation, Department, Email / Country, Country Code, Mobile, Currency). | Fields in Details card; no SF-named section. |
| **Tabs:** Activity · Contact Details · Account Details · Opportunities · Quotes · Remarks. | Tabs: **Funnels · Projects · Activity · Documents**. |

**🚩 Flags for CRM**

- ⬜ Name the section **Contact Information** and set highlights to Designation · Department · Number · Email · Account.
- ⬜ Consider adding a **Quotes** related tab (SF shows one on Contact).

---

## 8. Product  — ✅ done

**SF object:** `Product2` · **CRM:** `/products`, `/products/[id]`

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** Product Name · Product Description. | ✅ Name · Description · Product code · Subcategory · UOM · Standard price · Status. |
| **Highlights:** Product Category · Subcategory · UOM · Currency. | "At a glance" card (Product line, Subcategory, Unit) + price card. |
| **Details sections:** *Product Information* · *Description Information*. | ✅ **Product Information** (Name, UOM, Category, Currency, Subcategory, Active, Standard price) + **Description Information**. |

**🚩 Flags for CRM** — none outstanding; product layout already matches SF. (Optional: "Price Books" tab has no schema equivalent — omit.)

---

## 9. Payment Milestone  — ⬜ BUILD AS CORE (decoupled from `projects` module)

**SF object:** `Payment_Milestone__c` · **CRM:** *new* `/payment-milestones` + Funnel tab

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **List:** single column **Payment Milestone Name**. | None — the only milestone UI today is `projects/[id]/milestones-panel.tsx`, hidden behind the disabled `projects` module. |
| **Highlights:** Quote Number · Invoice Number · Amount · Actual Invoice Date · Payment Received? | — |
| **Invoice Status Path:** pending → invoiced → paid (Key Fields: Actual Invoice Date, Invoice Number). | — |
| **Tabs/sections:** *Payment Milestone* (Name, Funnels, Company End User, Company Reseller, PO/Ref No, SO Number, Project Items List / Product Name, Category, Subcategory, Quote Name, Quote Number, Project Code) · *Invoice Details* · *Remarks*. | — |
| **Related quick links:** Notes · Files · Payment Milestone History. | — |

**🚩 Flags for CRM** (feasible with **no schema change** — `payment_milestones` already has `funnelId`, `quotationId`, `title`, `amount`, `status`, `invoiceNumber`, `invoiceDate`, `soNumber`, `productCategory`, `productSubcategory`, etc.)

- ⬜ Add a **core** `PAYMENT_MILESTONE_VIEW` permission (no `module` tag) granted to the same roles as `OPPORTUNITY_VIEW`.
- ⬜ New route `app/(app)/payment-milestones/` — actions (`listPaymentMilestones`, `listFunnelMilestones`, `getPaymentMilestone`), list view (single **Payment Milestone Name** column), and detail page (highlights + status path + sections).
- ⬜ Add a **Payment Milestones** tab + quick-link on the Funnel detail.
- ⬜ Add a **Payment Milestones** nav item (tile `milestone`, yellow).
- Do NOT enable the `projects` module; leave `projects/[id]/milestones-panel.tsx` untouched. Omit SF fields with no column (Company End User/Reseller, PO/Ref No, Project Items List, Project Code).

---

## 10. Quote Line Item  — ⬜ align

**SF:** related list on Quote/Product/Funnel · **CRM:** inside quotation detail/preview.

| Salesforce (reference) | Custom CRM (current) |
|---|---|
| **Grid columns:** Product · Product Category · Description · UOM · Quantity · Unit Price · Item Discount · Sub-total. | Line-items grid rendered in the quotation form/preview. |
| **Actions:** Add Products · Edit Products. | Add/edit within the quotation form. |

**🚩 Flag for CRM** — ⬜ align the line-item grid columns/labels to the SF order above (covered under §5).

---

## Summary of flags (what to bring into our CRM)

| # | Object | Flag | Effort | Status |
|---|---|---|---|---|
| 1 | Dashboard | Two owner×stage / product-category bar charts, activity chart, recently-viewed cards | new aggregate queries + chart | ⬜ |
| 2 | Lead | Regroup detail into Company Information / Lead Information / Remarks tabs + SF highlights | layout only | ⬜ |
| 3 | Opportunity | PPVVC section headings (1-P…5-C) + Opportunity Info + Remarks | layout only | 🟡 |
| 4 | Funnel | **Payment Milestones tab** + optional Details section renames | layout + wire query | ⬜ |
| 5 | Quote | List columns (Ref No, Excl/Tax/Incl totals, Line Items) + line-item grid order | layout only | ⬜ |
| 6 | Account | Account Information + Address Information sections | layout only | ⬜ |
| 7 | Contact | Contact Information section + highlights + Quotes tab | layout only | ⬜ |
| 8 | Product | — (already matches) | — | ✅ |
| 9 | Payment Milestone | **Build as core**: permission + route + list + detail + Funnel tab + nav | new feature (no schema change) | ⬜ |
| 10 | Quote Line Item | Align grid columns to SF | layout only | ⬜ |

_Reference: full SF spec in `SPEC.md`; actionable checklist in `CHANGE-LIST.md`._
