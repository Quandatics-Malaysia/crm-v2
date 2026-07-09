# Salesforce ↔ Custom CRM — side-by-side comparison

**Purpose:** paste screenshots side by side later to compare our Salesforce reference org
("Quandatics Sales", `connect-momentum-5641.lightning.force.com`) against the custom CRM (`crm-v2`).
The **Salesforce** column is filled from the captured spec (`SPEC.md`) plus a screenshot placeholder.
The **Custom CRM** column is a **placeholder** — paste the crm-v2 screenshot and notes there later.

**How to use:** for each object, drop the Salesforce screenshot in the left placeholder and the
crm-v2 screenshot in the right placeholder, then tick off differences under each row.
Status key: ✅ re-layout applied · 🟡 partial · ⬜ to build.

---

## 1. Dashboard / Home  ✅
**Custom CRM route:** `/dashboard` · file `app/(app)/dashboard/page.tsx`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Home screenshot]_ | 🖼️ _[paste crm-v2 /dashboard screenshot]_ |
| **Layout:** two columns — "Salesperson's Activity" (left), "Salesperson's Funnels" (right); rich-text banner on top | _[compare — two-column Activity / Funnels implemented]_ |
| **Left cards:** Today's Tasks, Sales Activity This Year (bar), Recently-Viewed Leads | _[Follow-ups Due placed here; charts + recently-viewed deferred]_ |
| **Right cards:** dashboard filters, "QM Sales Report by Salesperson" (bar by owner × stage), "Closed Deals by Products" (bar), Recently-Viewed Funnels | _[Approvals, Overdue Invoices, Stale Funnels; SF bar charts deferred]_ |
| **Notes** | _[ ]_ |

---

## 2. Lead  🟡
**SF object:** `Lead` · **Custom CRM:** `/leads`, `/leads/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Lead record + list]_ | 🖼️ _[paste crm-v2 lead screenshots]_ |
| **List columns:** Lead Name · Company · Mobile · Email · Lead Status · Owner Alias | _[✅ reordered; Name · Company · Mobile · Email · Status · Owner]_ |
| **Highlights:** Full Mobile Number · Email · Lead Designation · Lead Department · Company · Request Approval For | _[compare]_ |
| **Path:** Unqualified → Working → Nurturing → Converted | _[compare]_ |
| **Tabs/sections:** Company Information · Lead Information · Remarks | _[⬜ regroup detail body]_ |
| **Related lists:** Campaign History · Notes · Files · Lead History · Approval History | _[compare]_ |
| **Notes** | _[ ]_ |

---

## 3. Opportunity  ⬜
**SF object:** `Opportunity_ID__c` (deal-number header) · **Custom CRM:** `/opportunities`, `/opportunities/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Opportunity record + list]_ | 🖼️ _[paste crm-v2 opportunity screenshots]_ |
| **List columns:** Opportunity (deal number) | _[superset today: Code · Opportunity · Account · Owner · Funnels · Est. amount]_ |
| **Highlights:** Account Name · Opportunity Nature · Opportunity Owner Contact · Owner Budget Limit · New Business? · Total Estimated Funnel Amount | _[compare]_ |
| **Tabs:** Opportunity Info · Analysis (PPVVC 1-P…5-C) · Funnels · Remarks | _[⬜ regroup]_ |
| **Related lists:** Funnels · Notes · Files · Opportunity History | _[compare]_ |
| **Notes** | _[ ]_ |

---

## 4. Funnel  🟡
**SF object:** `Opportunity` (label "Funnels") · **Custom CRM:** `/funnel`, `/funnel/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Funnel record + list]_ | 🖼️ _[paste crm-v2 funnel screenshots]_ |
| **List columns:** Funnel Name · Account · Power Sponsor Contact · Estimated Funnel Amount · Estimated Close Date · Sales Stage · Created · Procurement Stage · Probability | _[✅ reordered: Name · Account · Est. funnel amount · Est. close date · Sales stage · Owner · Status]_ |
| **Highlights:** Opportunity · Estimated Funnel Close Date · Funnel Owner · Account · Estimated Funnel Amount · Sales Stage | _[compare]_ |
| **Path:** 0E → 1D → 2C → 3B → 4A → Closed Lost → KIV → Closed Won | _[compare]_ |
| **Tabs:** Activity · Details · Quote · Project Items List · Payment Milestones · Remarks · Sales Stage History · Approval History | _[⬜ add Payment Milestones tab]_ |
| **Details sections:** Opportunity Information · Funnel Info · Procurement Process (PP) · Supporting Documents | _[⬜ rename sections]_ |
| **Notes** | _[ ]_ |

---

## 5. Quote  ⬜
**SF object:** `Quote` · **Custom CRM:** `/quotations`, `/quotations/[id]`, `/quotations/[id]/preview`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Quote record + list]_ | 🖼️ _[paste crm-v2 quotation screenshots]_ |
| **List columns:** Quote Name · Funnel Name · Synced · Line Items · Ref No · Total Excluding Tax · Tax Amount · Total Including Tax | _[⬜ reorder]_ |
| **Highlights:** Quote Number · Account · Syncing · Funnel Name · Total Excluding Tax · Tax Amount | _[compare]_ |
| **Path:** Draft → In Review → Approved → Finalized | _[compare]_ |
| **Tabs:** Quote Line Items · Quote PDFs · Details · Remarks | _[compare]_ |
| **Details section:** Quote Information | _[⬜ align]_ |
| **Notes** | _[ ]_ |

---

## 6. Account  🟡
**SF object:** `Account` · **Custom CRM:** `/accounts`, `/accounts/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Account record + list]_ | 🖼️ _[paste crm-v2 account screenshots]_ |
| **List columns:** Account Name · Phone · Account Owner Alias | _[✅ Owner moved up after Name]_ |
| **Highlights:** Owner · Phone · Billing Address · Website | _[compare]_ |
| **Tabs:** Activity · Account Details · Contacts · Opportunities · Funnels · Contracts · Remarks · Approval History | _[compare]_ |
| **Details sections:** Account Information · Address Information | _[⬜ align]_ |
| **Notes** | _[ ]_ |

---

## 7. Contact  🟡
**SF object:** `Contact` · **Custom CRM:** `/persons`, `/persons/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Contact record + list]_ | 🖼️ _[paste crm-v2 person screenshots]_ |
| **List columns:** Contact Name · Account Name · Contact Email · Contact Owner Alias | _[✅ Email moved above Title]_ |
| **Highlights:** Contact Designation · Department · Number · Email · Account | _[compare]_ |
| **Section:** Contact Information | _[⬜ align]_ |
| **Related lists:** Quotes · Cases · Files · Notes · Contact History | _[compare]_ |
| **Notes** | _[ ]_ |

---

## 8. Product  ✅
**SF object:** `Product2` · **Custom CRM:** `/products`, `/products/[id]`

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Product record + list]_ | 🖼️ _[paste crm-v2 product screenshots]_ |
| **List columns:** Product Name · Product Description | _[✅ Description column added]_ |
| **Highlights:** Product Category · Subcategory · UOM · Currency | _[compare]_ |
| **Details sections:** Product Information · Description Information | _[✅ renamed + Active field added]_ |
| **Related lists:** Product History · Price Books · Opportunities · Notes · Files | _[compare]_ |
| **Notes** | _[ ]_ |

---

## 9. Payment Milestone  ⬜ (to build as CORE — decoupled from projects module)
**SF object:** `Payment_Milestone__c` · **Custom CRM:** _new_ `/payment-milestones` (see CHANGE-LIST §4)

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Payment Milestone record + list]_ | 🖼️ _[paste crm-v2 screenshot once built]_ |
| **List column:** Payment Milestone Name | _[⬜ build list view]_ |
| **Highlights:** Quote Number · Invoice Number · Amount · Actual Invoice Date · Payment Received? | _[⬜]_ |
| **Path:** pending → invoiced → paid | _[⬜]_ |
| **Sections:** Payment Milestone · Invoice Details · Remarks | _[⬜]_ |
| **Notes:** schema already has funnelId + all fields; build funnel-scoped, no module flip | _[ ]_ |

---

## 10. Quote Line Item  ⬜
**SF:** related list on Quote/Product/Funnel · **Custom CRM:** inside quotation detail/preview

| Salesforce (reference) | Custom CRM (crm-v2) — *placeholder* |
|---|---|
| 🖼️ _[paste Salesforce Quote Line Items grid]_ | 🖼️ _[paste crm-v2 line-items grid]_ |
| **Grid columns:** Product · Product Category · Description · UOM · Quantity · Unit Price · Item Discount · Sub-total | _[⬜ align columns]_ |
| **Actions:** Add Products · Edit Products | _[compare]_ |
| **Notes** | _[ ]_ |

---

_Reference: full spec in `SPEC.md`; remaining work in `CHANGE-LIST.md`._
