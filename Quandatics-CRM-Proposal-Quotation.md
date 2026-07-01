# Quandatics CRM

## Proposal and Quotation for the Design, Development and Deployment of a Custom Customer Relationship Management Platform

Prepared by Quandatics · 28 June 2026

---

## 1. Document particulars

Prepared for: [Client Company Name] · Attention: [Client Contact, Title]

Prepared by: Quandatics ("the Developer"), an independent software development practice.

Reference: QDT-CRM-2026-001 · Date of issue: 28 June 2026 · Valid until: 28 July 2026 (30 days)

All amounts are in Malaysian Ringgit (RM) and exclusive of SST where applicable. United States Dollar figures are converted at US$1 to RM 4.10 (June 2026).

---

## 2. Executive summary

The Developer proposes to design, develop, and deploy a bespoke Customer Relationship Management platform, Quandatics CRM, for the exclusive use and ownership of the Client.

Unlike subscription products licensed per user, the platform is delivered as an asset the Client owns outright: upon final payment the source code, data, and infrastructure reside entirely with the Client, with no recurring per-user fees. It provides multi-tenant data isolation at the database layer, Microsoft single sign-on, role-based approval workflows, a structured sales funnel, a quotation and taxation engine, sales-order processing, project tracking, and a probability-weighted revenue forecast.

The fee for the complete scope is RM 58,000, payable once. Comparable bespoke systems are quoted by Malaysian software houses in the region of RM 100,000 to RM 300,000; subscription products such as Salesforce or HubSpot accumulate approximately RM 200,000 to RM 390,000 over three years for a fifteen-user team, with no asset owned at the end. The basis for the fee and these comparisons is set out in Sections 5 to 7.

---

## 3. Objectives

- Establish a single, authoritative record of leads, accounts, contacts, and opportunities, replacing fragmented spreadsheets.
- Enforce a disciplined sales process through a structured funnel with stage-gated approvals.
- Standardise quotations, pricing, and taxation, with a faithful record of every quotation issued.
- Provide management with a real-time, probability-weighted revenue forecast.

---

## 4. Scope of the platform

The platform is delivered as a complete and deployable system. Each functional area below is developed, tested, and handed over to the Client together with the corresponding source code.

### 4.1 Foundation and multi-tenant infrastructure

A contemporary application built on the Next.js framework and the PostgreSQL database, containerised for deployment and served behind a reverse proxy providing automatic encryption. Multi-tenancy is enforced through database-level Row-Level Security, whereby the isolation of each tenant's data is guaranteed by the database itself rather than by application logic alone. The component includes hardened production safeguards and managed handling of credentials.

### 4.2 Authentication and Microsoft sign-in

Single sign-on through Microsoft Entra, together with optional per-tenant electronic-mail and password authentication, secure session management, and a controlled procedure for the first administrative user.

### 4.3 Roles, permissions, and reporting hierarchy

A comprehensive role-based access control framework incorporating seniority tiers, a manager and reporting hierarchy, granular permissions, and safeguards against the unauthorised escalation of privileges.

### 4.4 Customer records: leads, accounts, and contacts

The capture and qualification of leads; the management of accounts, including a parent and subsidiary hierarchy with protection against circular relationships; the management of contacts associated with each account; and the orderly conversion of a lead into an account and contact.

### 4.5 Sales funnel and approval engine

A structured sales funnel progressing through defined stages to a Won, Lost, or Held outcome, governed by a stage-gated approval mechanism. A member of staff submits a justification together with supporting documents; the approving party authorises the transition; and no stage advances prematurely. A complete history of stage transitions, including the stated reasons, is retained.

### 4.6 Quotation engine

The preparation of service-based quotations comprising itemised lines, a configurable taxation engine, validated totals, and the recording of a fixed record at the point of issue, such that the rate, the totals, and the taxation treatment are preserved exactly as presented to the customer.

### 4.7 Sales orders

The conversion of accepted quotations into sales orders, incorporating per-tenant numbering and an approval workflow.

### 4.8 Projects and milestones

The tracking of projects and milestones, enabling won opportunities to proceed to delivery.

### 4.9 Forecasting, dashboard, and reporting

A probability-weighted billing forecast, computed net of taxation and aggregated correctly by currency, together with an executive dashboard and supporting reports.

### 4.10 Audit trail

A protected audit log recording high-risk actions, including changes to access control, configuration, approvals, and financial records, for the purposes of compliance and accountability.

### 4.11 User interface

A clean and responsive interface incorporating a consistent design system, sortable and filterable data tables, a command palette, a document viewer, file attachments, and selectable light and dark themes.

### 4.12 Security and correctness review

A dedicated review of security and correctness. The platform has already undergone a structured remediation of findings relating to authorisation, data integrity, and the handling of financial values, and is therefore hardened to a standard above that customary for systems of this scale.

### 4.13 Quality assurance, deployment, documentation, and training

End-to-end quality assurance, deployment to production, the preparation of operating documentation, and a handover and training session for the Client's personnel.

---

## 5. Why this engagement

Ownership and no per-user fees. Upon final payment, the source code, data, and infrastructure belong to the Client, with no supplier lock-in and no charge for additional users. The cost of the asset does not increase as the team grows.

Direct delivery and a favourable cost structure. The platform is delivered by the engineer who designed and built it, without the account-management layer or overhead of an agency. A system comparable to one quoted elsewhere at RM 100,000 or more is therefore delivered at a considerably lower fee, with no reduction in quality.

A platform already built and reviewed. This is not speculative development from a blank page. The platform exists, has been subjected to a security and correctness review, and is ready for deployment and tailoring, which materially reduces project risk.

No dependence on one individual. The complete source code is transferred to the Client and built upon a mainstream technology stack, so any competent developer or firm can maintain and extend it. A technical walk-through, code review, references, and a source-code escrow arrangement are available on request.

Security, sovereignty, and compliance. The platform is self-hosted with tenant isolation at the database layer, keeping the Client's data under its own control, which is advantageous for compliance with the Personal Data Protection Act. Training and implementation may also be claimable under the Human Resources Development Corporation scheme for eligible employers.

---

## 6. Comparative market pricing

Figures are drawn from each vendor's published pricing or public 2026 pricing guides (Section 11). Subscription totals assume fifteen users over thirty-six months at list prices; actual discounts and charges vary.

### 6.1 Subscription and off-the-shelf products (licensed, not owned)

| Vendor or product | Plan (typical SME tier) | List price | Approx. RM / user / month | 3-year cost, 15 users | Source owned | Self-hosted |
|---|---|---|---:|---:|:---:|:---:|
| [Zoho CRM](https://www.zoho.com/crm/zohocrm-pricing.html) | Professional | US$23 per user/month | 94 | 50,900 | No | No |
| [Zoho CRM](https://www.zoho.com/crm/zohocrm-pricing.html) | Enterprise | US$40 per user/month | 164 | 88,600 | No | No |
| [HubSpot Sales Hub](https://blog.hubspot.com/sales/hubspot-sales-hub-pricing) | Professional | US$90 per seat/month + US$1,500 onboarding | 369 | 205,400 | No | No |
| [Salesforce Sales Cloud](https://www.salesforce.com/sales/pricing/) | Enterprise | US$175 per user/month | 718 | 387,500 | No | No |
| [TargetCRM](https://targetcrm.com.my/crm-pricing) (Xantec, Malaysia) | Cloud subscription | from RM 200/month | local | from 7,200 | No | No |
| [MyPoint CRM](https://crmsystem.com.my/pricing/) (Malaysia) | Setup + subscription | RM 8,000 setup + RM 199/month | local | 15,200 | No | Shared |

The Malaysian products are economical but standardised, with limited customisation. The international products are capable but licensed per user, so cost increases with every hire and each year, and no asset is owned at the end of the term.

### 6.2 Bespoke, owned systems of comparable scope

| Provider | Offering | Quoted price for comparable scope | Notes |
|---|---|---|---|
| [Zoomo Tech](https://www.zoomotech.com.my/blog/why-custom-software-cost-in-malaysia-varies-from-rm30k-to-rm300k/) (Malaysia) | Custom ERP and CRM | RM 100,000 to RM 300,000 | RM 30,000 procures a single workflow only |
| [Gotchaa Lab](https://gotchaa-lab.com/blog/2026-03-05-how-much-does-custom-software-cost-malaysia) (Malaysia) | Custom software | RM 15,000 to RM 300,000+ | Maintenance 15–25% per annum |
| [Xantec Solutions](https://xantec.com.my/) (Malaysia) | Bespoke engineering | Enterprise, quoted on application | Parent company of TargetCRM |
| Quandatics CRM (this proposal) | Bespoke, fully owned, multi-module, security-reviewed | RM 58,000, payable once | Unlimited users; self-hosted; source transferred |

On capability, the proposed platform is consistent with systems quoted by agencies at RM 100,000 and above; the fee here is substantially lower for the reasons in Section 5. For a small team needing only a generic CRM, an off-the-shelf product may be cheaper at the outset; for a platform aligned to the Client's process, owned outright, and free of per-user charges, this quotation is competitively priced and recovers its one-time cost within the first contract period.

---

## 7. Quotation

| # | Deliverable or module | Amount (RM) |
|---:|---|---:|
| 1 | Foundation and multi-tenant infrastructure | 8,100 |
| 2 | Authentication and Microsoft Entra single sign-on | 5,400 |
| 3 | Roles, permissions, and reporting hierarchy | 6,300 |
| 4 | Customer records: leads, accounts, and contacts | 8,100 |
| 5 | Sales funnel and stage-gated approval engine | 7,200 |
| 6 | Quotation engine, taxation, and record retention | 6,300 |
| 7 | Sales orders and numbering | 4,000 |
| 8 | Projects and milestones | 3,600 |
| 9 | Billing forecast, dashboard, and reporting | 5,100 |
| 10 | Audit trail and compliance log | 2,300 |
| 11 | User interface and design system | 8,100 |
| 12 | Security and correctness review | 5,400 |
| 13 | Quality assurance, deployment, documentation, and training | 5,100 |
| | **Subtotal (professional value)** | **75,000** |

| Item | Amount (RM) |
|---|---:|
| Subtotal | 75,000 |
| Less: independent-developer and SME engagement discount (20%) | −15,000 |
| Less: early-commitment goodwill adjustment | −2,000 |
| **Net fee, payable once (exclusive of SST)** | **58,000** |

Phased alternative: Phase 1 (Core platform) RM 38,000 and Phase 2 (Operations and intelligence) RM 20,000, with Phase 2 confirmed once Phase 1 is in service.

---

## 8. Delivery, optional services, and payment

### 8.1 Timeline

| Phase | Scope | Duration |
|---|---|---|
| 0. Discovery and design | Requirements, data model and processes, interface direction | 1–2 weeks |
| 1. Core platform | Infrastructure, authentication, access control, customer records, funnel and approvals, quotation engine, interface | 6–8 weeks |
| 2. Operations and intelligence | Sales orders, projects, forecasting and reporting, audit trail, security hardening, quality assurance | 4–6 weeks |
| Go-live and training | Deployment, documentation, training, initial support | 1 week |

Indicative total: twelve to seventeen weeks from commencement, subject to timely feedback and content from the Client.

### 8.2 Optional services

| Service | Charge (RM) |
|---|---:|
| LHDN MyInvois electronic-invoicing integration | charged at the hourly rate |
| Data migration from existing systems or spreadsheets | charged at the hourly rate |
| Annual maintenance and support plan | 9,600 per annum (800/month) |
| Managed hosting (backups, monitoring, certificates) | from 350 per month |
| Additional training session (on site or remote) | 1,000 per session |
| Ad-hoc development and change requests after go-live | 120 per hour |

The hourly professional services rate is RM 120. Data migration and integration work are charged at this rate, with effort confirmed after assessment of the source data and requirements.

### 8.3 Payment schedule

| Milestone | Percentage | Amount (RM) |
|---|---:|---:|
| Upon execution of the agreement (deposit) | 40% | 23,200 |
| Upon acceptance at staging | 30% | 17,400 |
| Upon deployment to production and handover | 30% | 17,400 |
| **Total** | **100%** | **58,000** |

Invoices are payable within fourteen (14) days of issue.

---

## 9. Assumptions and exclusions

- The quotation assumes the scope in Section 4; material additions are quoted separately or charged at the hourly rate.
- The Client provides timely feedback, content and branding materials, and a single authorised point of contact.
- Third-party costs (hosting, domain, Microsoft licensing, electronic-mail or messaging providers) are borne by the Client.
- Integrations other than those listed are excluded and quoted on request.
- One consolidated round of revisions is included per phase; further rounds are charged at the hourly rate.

---

## 10. Terms and conditions

1. Intellectual property. Upon full and final payment, all custom source code and deliverables transfer to the Client. Pre-existing open-source components remain under their respective licences.
2. Deposit. The 40 percent deposit is required before work commences and is non-refundable once work has begun.
3. Variation. Any change to the agreed scope is documented and quoted before work proceeds.
4. Acceptance. Each phase is deemed accepted upon sign-off at staging, or seven (7) days after delivery absent written objection.
5. Warranty. Defects against the agreed scope are corrected at no charge for thirty (30) days after go-live; thereafter under the maintenance plan.
6. Governing law. This engagement is governed by the laws of Malaysia.

---

## 11. Acceptance

By signing below, the Client accepts this proposal and quotation and authorises the Developer to commence work in accordance with the terms herein.

Accepted for and on behalf of the Client:

- Name: _______________________________
- Title: _______________________________
- Signature: _______________________________
- Date: _______________________________

For and on behalf of the Developer (Quandatics):

- Name: _______________________________
- Title: _______________________________
- Signature: _______________________________
- Date: _______________________________

---

## 12. Sources and references

- Zoomo Tech Malaysia, custom software cost (2026): <https://www.zoomotech.com.my/blog/why-custom-software-cost-in-malaysia-varies-from-rm30k-to-rm300k/>
- Gotchaa Lab, custom software cost guide (2026): <https://gotchaa-lab.com/blog/2026-03-05-how-much-does-custom-software-cost-malaysia>
- Xantec Solutions (bespoke engineering): <https://xantec.com.my/>
- Zoho CRM pricing: <https://www.zoho.com/crm/zohocrm-pricing.html>
- HubSpot Sales Hub pricing: <https://blog.hubspot.com/sales/hubspot-sales-hub-pricing>
- Salesforce Sales Cloud pricing: <https://www.salesforce.com/sales/pricing/>
- TargetCRM pricing: <https://targetcrm.com.my/crm-pricing>
- MyPoint CRM pricing: <https://crmsystem.com.my/pricing/>
- Lemon.io, Malaysia developer rates: <https://lemon.io/rate-calculator/malaysia/>
- USD/MYR exchange rate (June 2026): <https://tradingeconomics.com/malaysia/currency>

Subscription totals are estimates based on published list prices for fifteen users over thirty-six months, for comparison only; actual pricing varies by region, term, and negotiation.
