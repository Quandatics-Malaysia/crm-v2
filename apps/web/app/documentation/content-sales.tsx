import Link from "next/link"
import { Mermaid } from "@/components/mermaid"
import {
  B,
  Callout,
  Code,
  DocTable,
  H2,
  Lead,
  Li,
  P,
  Ul,
} from "./doc-kit"
import type { DocPage } from "./registry"

export const leadToCashPage: DocPage = {
  slug: "lead-to-cash",
  title: "The lead-to-cash flow",
  description:
    "The end-to-end path from a raw lead to money received, and how every record links to the next.",
  body: (
    <>
      <Lead>
        Everything in the CRM hangs off this one chain. Each hop is a real
        foreign key, so drill-downs, roll-ups and automation never rely on
        matching names or numbers.
      </Lead>
      <Mermaid
        chart={`
flowchart TD
  L[Lead<br/>new → contacted → qualified] -- "convert" --> A[Account + Contact]
  L -- "convert" --> O[Funnel deal<br/>stage pipeline, open]
  A --> O
  O -- "New quotation" --> Q[Quotation draft<br/>lines, tax, discounts]
  Q -- "submit for approval" --> QP[Pending approval]
  QP -- "approve" --> QA[Approved]
  QA -- "send" --> QS[Quotation sent]
  QS -- "accept or reject" --> QC[Customer decision]
  QA -. "explicit reset" .-> Q
  O -- "stage transition" --> OW[Funnel stage: Closed Won]
  O -- "manual create" --> P[Project<br/>value = quote net]
  O -- "prepare any time" --> M[Payment milestones<br/>Won / Invoiced]
  OW -- "Closed Won marks live" --> MW[Live milestones Won]
  M -- "manual Won → Invoiced" --> MI[Milestone Invoiced]
  P -- "submit for approval" --> SO[Sales order<br/>submitted → approved]
  SO -- "approved unlocks" --> INV[Invoice draft]
  INV -- "issue" --> INVI[Invoice issued]
  INVI -- "receipt + proof" --> RCT[Receipt issued<br/>invoice settled]
`}
      />

      <H2>The linkage, hop by hop</H2>
      <DocTable
        head={["From → to", "Link (column)", "Created by"]}
        rows={[
          [
            "Lead → Account / Contact / Funnel",
            <Code key="c">converted_account_id / converted_opportunity_id</Code>,
            "Lead convert action (qualified leads only).",
          ],
          [
            "Funnel → Account / Contact",
            <Code key="c">funnels.account_id / person_id</Code>,
            "Funnel create form.",
          ],
          [
            "Quotation → Funnel",
            <Code key="c">quotations.funnel_id</Code>,
            "New quotation (from the funnel or the Quotations list).",
          ],
          [
            "Project → Funnel / Quotation / Account",
            <Code key="c">projects.funnel_id / quotation_id / account_id</Code>,
            "Create project manually; quotation acceptance does not create one.",
          ],
          [
            "Payment Milestone → Funnel",
            <Code key="c">payment_milestones.funnel_id</Code>,
            "Prepared from the Funnel before close; Closed Won marks live milestones Won.",
          ],
          [
            "Sales order → Project",
            <Code key="c">sales_orders.project_id</Code>,
            "Submit for approval on the project.",
          ],
          [
            "Billing doc → SO / Project / parent doc",
            <Code key="c">
              finance_docs.sales_order_id / project_id / parent_id
            </Code>,
            "Finance module; Payment Milestones are not Finance document parents.",
          ],
          [
            "Interco mirror → Funnel",
            <Code key="c">intercompany_deals.funnel_id</Code>,
            "Synced automatically on every interco funnel mutation.",
          ],
        ]}
      />

      <H2>Guards that keep the chain honest</H2>
      <Ul>
        <Li>
          One <B>live accepted</B> quotation and one <B>live primary</B>{" "}
          quotation per funnel — enforced by DB partial unique indexes, not
          just application checks.
        </Li>
        <Li>
          Payment Milestones are planning records with only <B>Won</B> and{" "}
          <B>Invoiced</B> statuses and may be prepared before the Funnel closes.
        </Li>
        <Li>
          <B>Closed Won</B> marks live Payment Milestones Won.
        </Li>
        <Li>
          A user manually changes <B>Won → Invoiced</B>; there is no automatic
          invoice or receipt transition.
        </Li>
        <Li>
          Payment Milestones do not create or update invoices or receipts and
          never complete a Project automatically.
        </Li>
      </Ul>

      <H2>Deep dives</H2>
      <Ul>
        <Li>
          <Link className="link" href="/documentation/crm-core">
            CRM core
          </Link>{" "}
          — leads, accounts, contacts and conversion.
        </Li>
        <Li>
          <Link className="link" href="/documentation/funnel-forecast">
            Funnel &amp; forecast
          </Link>{" "}
          — stages, the value model, weighting.
        </Li>
        <Li>
          <Link className="link" href="/documentation/quotations">
            Quotations
          </Link>{" "}
          — lifecycle, math, acceptance automation.
        </Li>
        <Li>
          <Link className="link" href="/documentation/projects-milestones">
            Projects &amp; milestones
          </Link>{" "}
          — delivery, payment split, sales orders.
        </Li>
        <Li>
          <Link className="link" href="/documentation/finance">
            Finance add-on
          </Link>{" "}
          — the billing/purchasing chains and toggling.
        </Li>
        <Li>
          <Link className="link" href="/documentation/intercompany">
            Intercompany
          </Link>{" "}
          — partner share, mirror and handshake.
        </Li>
      </Ul>

      <Callout>
        Statuses across the chain: lead{" "}
        <Code>new → contacted → qualified / disqualified</Code>; funnel{" "}
        <Code>open → won / lost / on_hold</Code>; quotation{" "}
        <Code>draft → pending_approval → approved → sent → accepted / rejected</Code>; project{" "}
        <Code>planning → active → completed</Code> (plus{" "}
        <Code>on_hold / cancelled</Code>); milestone{" "}
        <Code>Won → Invoiced</Code> (manual only); sales order{" "}
        <Code>submitted → approved / rejected</Code>; finance doc{" "}
        <Code>draft → issued → settled / cancelled</Code>.
      </Callout>
    </>
  ),
}

export const crmCorePage: DocPage = {
  slug: "crm-core",
  title: "CRM core — leads, accounts, contacts",
  description:
    "Capturing demand, deduplicating companies and people, and converting into the funnel.",
  body: (
    <>
      <H2>Leads</H2>
      <P>
        A lead is an unqualified inbound: name, company, email, phone, source
        (tenant picklist). Status runs{" "}
        <Code>new → contacted → qualified → disqualified</Code> (disqualify
        captures a reason from the{" "}
        <Link className="link" href="/documentation/settings-reference">
          loss-reasons picklist
        </Link>
        ).{" "}
        <B>Convert</B> turns a qualified lead into an account + contact +{" "}
        <Link className="link" href="/documentation/funnel-forecast">
          funnel deal
        </Link>{" "}
        in one step and stamps the back-links so the lead shows
        where it went.
      </P>
      <P>
        Lead forms contain no Funnel or Stage fields. Conversion resolves the
        tenant&apos;s single default <B>Sales Funnel</B> and its first open{" "}
        <Code>0E</Code> stage; the user supplies descriptive Funnel data only.
      </P>
      <Ul>
        <Li>
          <B>Duplicate guard:</B> creating a lead with the email of an existing
          live lead is rejected.
        </Li>
        <Li>
          <B>Auto follow-up:</B> if <Code>lead_follow_up_days</Code> is set, a
          “First contact” activity with a due date is logged automatically on
          creation.
        </Li>
      </Ul>

      <H2>Accounts</H2>
      <P>
        The customer company. Each account gets an <B>account code</B> used in
        project codes. Creating an account with a name that matches an existing
        one (case-insensitive) is rejected; similar names (trigram match, e.g.
        “Acme Sdn Bhd” vs “ACME”) produce a warn-only banner on the form.
        Address country and phone prefix prefill from the tenant presets.
      </P>
      <P>
        Account <Code>currency</Code> is required and must be selected from
        Settings&apos; configured ISO currencies. New Opportunities and
        Quotations inherit it, with configured-currency overrides allowed.
      </P>

      <H2>Contacts</H2>
      <P>
        People at accounts (<Code>persons</Code> table). Contacts link to an
        account and can be named on funnel deals. The detail page shows the
        person’s pipelines, activities and documents.
      </P>

      <H2>Ownership</H2>
      <P>
        Leads, accounts, contacts, pipelines and projects carry an{" "}
        <Code>owner_member_id</Code>. Who can see/edit which records is
        governed by the owner + managed-subtree scope described in{" "}
        <Link className="link" href="/documentation/access-control">
          Access control
        </Link>
        .
      </P>
    </>
  ),
}

export const funnelForecastPage: DocPage = {
  slug: "funnel-forecast",
  title: "Funnel & forecast",
  description:
    "The deal pipeline, the three-amount value model, stage gates, and how the weighted forecast is computed.",
  body: (
    <>
      <H2>Sales Funnel and stages</H2>
      <P>
        New deals use the default <B>Sales Funnel</B>; legacy pipeline rows stay
        readable, but new pipeline creation and editing are disabled. Each
        stage has a probability and kind (<Code>OPEN / WON / LOST / PARKED</Code>).
        Forward movement validates every entered stage&apos;s PPVVC and approval
        requirements, including skipped stages. Rollback to any nonterminal
        stage skips gates; forward movement after rollback validates again.
        <Code>Closed Won</Code> and <Code>Closed Lost</Code> are permanent.
      </P>
      <P>
        Opportunity code and name are the same generated value,
        <Code>ORGCODEOPP-YYYY-NNNN</Code>. A project code stays empty until a
        child Funnel first enters <Code>4A</Code>; rollback and re-entry reuse
        the original code and never create a Project record.
      </P>

      <H2>PPVVC</H2>
      <P>
        The Opportunity owns the authoritative five-field value model:{" "}
        <B>1 Power Sponsor, 2 Pain, 3 Vision, 4 Value, 5 Control</B>. Editing from an
        Opportunity or Funnel synchronizes the Opportunity and all live child
        Funnels in one transaction. Funnel cards show compact complete/missing
        badges; stage dialogs expose only the requirements for the entered
        stages.
      </P>

      <H2>The value model</H2>
      <DocTable
        head={["Amount", "Source", "Used for"]}
        rows={[
          [
            <B key="a">Estimated</B>,
            "typed by the rep",
            "board headline + weighted forecast",
          ],
          [
            <B key="a">Quoted</B>,
            "synced from the primary quotation's net",
            "display; becomes the recognized basis",
          ],
          [
            <B key="a">Recognized</B>,
            "basis × recognized %",
            "the entity's own cut on intercompany deals",
          ],
        ]}
      />
      <P>
        The quoted amount syncs from the{" "}
        <Link className="link" href="/documentation/quotations">
          primary quotation
        </Link>
        ; intercompany deals recognize only the entity’s cut (see{" "}
        <Link className="link" href="/documentation/intercompany">
          Intercompany
        </Link>
        ). Multiple <B>project natures</B> per deal are held in{" "}
        <Code>funnels.project_natures</Code>; the first is the primary
        and drives the project code. A deal may also carry a description and a
        project/license year.
      </P>

      <H2>Forecast</H2>
      <P>
        /forecast weights <Code>estimated_amount × stage probability</Code> per
        deal (SQL views <Code>v_billing_forecast</Code> /{" "}
        <Code>v_pipeline_summary</Code>), with a time-frame selector
        (month/quarter/FY/next-FY/6m/12m — fiscal-year aware via{" "}
        <Code>fiscal_year_start_month</Code>). Three layers stack on top:
      </P>
      <Ul>
        <Li>
          <B>Recognized weighting:</B> each row also exposes{" "}
          <Code>recognized_weighted_value</Code> (weighted × recognized %,
          treating null as 100%) — what the entity itself expects to keep.
        </Li>
        <Li>
          <B>Inbound intercompany share:</B> for entities holding{" "}
          <Code>intercompany.view</Code>, deals assigned by sibling entities
          contribute <Code>share × origin stage probability</Code> as{" "}
          <Code>source: inbound</Code> rows.
        </Li>
        <Li>
          <B>Billed margin:</B> with the{" "}
          <Link className="link" href="/documentation/finance">
            Finance module
          </Link>{" "}
          on, a per-currency card shows issued+settled invoices − credit notes
          − purchase invoices — actuals next to the forecast.
        </Li>
      </Ul>

      <H2>Hygiene automation</H2>
      <Ul>
        <Li>
          <B>Stale pipelines:</B> deals untouched for{" "}
          <Code>stale_deal_days</Code> surface on the dashboard.
        </Li>
        <Li>
          <B>Due soon:</B> activities due within{" "}
          <Code>follow_up_due_days</Code> appear in the dashboard follow-up
          card.
        </Li>
      </Ul>
    </>
  ),
}

export const quotationsPage: DocPage = {
  slug: "quotations",
  title: "Quotations",
  description:
    "Line-item quoting: lifecycle, money math, acceptance guards, and what acceptance automates.",
  body: (
    <>
      <H2>Lifecycle</H2>
      <Mermaid
        chart={`
stateDiagram-v2
  [*] --> draft : create (from funnel or list)
  draft --> pending_approval : submit
  pending_approval --> approved : approve
  pending_approval --> draft : reject (reason)
  approved --> sent : send
  approved --> draft : explicit edit reset
  draft --> [*] : delete
  sent --> accepted : accept
  sent --> rejected : reject
  accepted --> [*]
  sent --> draft : create revision
  accepted --> draft : create revision
  rejected --> draft : create revision
  expired --> draft : create revision
  void --> draft : create revision
  note right of accepted
    max ONE live accepted +
    ONE live primary per funnel
    (DB partial unique indexes)
  end note
`}
      />
      <P>
        Approved quotations are read-only until an explicit reset to Draft;
        reset clears approval metadata and requires approval again. Send is
        available only from Approved. Customer Accept/Reject is available only
        from Sent and never changes Funnel stage.
      </P>
      <P>
        Any non-Draft or soft-deleted quotation can create a Draft revision.
        The revision copies recipient, Attention, currency, tax inputs, dates,
        Notes, Delivery, Payment Term, header discount and lines; it increments
        the Funnel&apos;s running version/number and keeps <Code>revisionOfId</Code>.
        The source remains unchanged.
      </P>

      <H2>Money math</H2>
      <Ul>
        <Li>
          <B>Line:</B> <Code>after&nbsp;discount = max(0, qty × unit price −
          line discount)</Code>. The line discount is an{" "}
          <B>absolute amount</B>, not a percent.
        </Li>
        <Li>
          <B>Header discount</B> (absolute) is applied on the subtotal, then
          tax at the selected tax setting’s rate — <B>inclusive</B> or{" "}
          <B>exclusive</B> per the tenant’s <Code>tax_inclusive</Code> switch.
        </Li>
        <Li>
          Lines may reference a <B>catalog product</B> (description, price and
          UOM prefill; price stays editable) or be free-text custom lines.
        </Li>
      </Ul>

      <H2>Quotation content and permissions</H2>
      <Ul>
        <Li>
          Settings provides default Notes, Delivery and Payment Term. New
          quotations copy editable snapshots; Delivery and Payment Term are
          available to built-in and external templates.
        </Li>
        <Li>
          Attention is selected from the recipient account and defaults to its
          primary contact; cross-account contacts are rejected.
        </Li>
        <Li>
          Approval uses <Code>quotation.approve</Code>. Assign it in Team &amp;
          roles to the approval role; quotation-create permission is still
          required to create revisions.
        </Li>
      </Ul>

      <H2>Customer-facing document</H2>
      <P>
        Preview/print renders the tenant’s{" "}
        <Link className="link" href="/documentation/settings-reference">
          company profile
        </Link>{" "}
        (letterhead, logo, registration, bank details, quote footer) from
        Settings → General. The “Valid until” date prefills from{" "}
        <Code>quote_valid_days</Code>.
      </P>

      <Callout>
        Per-line <B>project nature</B> was removed from the forms — a line’s
        nature follows its product. The header-level nature (or the funnel
        default) drives the project code.
      </Callout>
    </>
  ),
}

export const projectsPage: DocPage = {
  slug: "projects-milestones",
  title: "Projects & payment milestones",
  description:
    "Delivery projects, payment-milestone planning, sales-order approval, and project status.",
  body: (
    <>
      <H2>Creating a project</H2>
      <P>
        Projects are created manually (optionally prefilled from a
        funnel/quote). Quotation acceptance never creates a Project. The
        project code derives from account code + primary nature;{" "}
        <Code>projects.value</Code> may be prefilled from the quote&apos;s net.
        Payment Milestones are separate planning records attached to the Funnel.
      </P>

      <H2>Payment milestones</H2>
      <P>
        Payment Milestones are planning records with only two statuses:{" "}
        <B>Won</B> and <B>Invoiced</B>. They may be prepared before a Funnel
        closes. When the Funnel reaches <B>Closed Won</B>, its live milestones
        are marked Won. A user manually changes Won to Invoiced; there is no
        backward move.
      </P>
      <Mermaid
        chart={`
stateDiagram-v2
  [*] --> won : prepared (before or after close)
  won --> invoiced : manual status change
  note right of won : Closed Won marks live milestones Won
`}
      />
      <Ul>
        <Li>
          Milestones split by <B>exact amount</B> (not percent) for planning.
        </Li>
        <Li>
          The <B>milestone template</B> in Settings seeds new projects
          with a percent split of the value; the last row absorbs rounding.
        </Li>
        <Li>
          Manual status moves are <B>forward-only</B> (<Code>Won → Invoiced</Code>).
          Finance invoices and receipts do not change milestone status.
        </Li>
        <Li>
          Payment Milestones do not create or update invoices or receipts and
          never complete a Project automatically.
        </Li>
      </Ul>

      <H2>Sales orders</H2>
      <P>
        A sales order is the project’s internal approval to bill:{" "}
        <B>submit</B> (captures document kind + payment term from tenant
        picklists) → a holder of <Code>sales_order.approve</Code> approves or
        rejects with a reason. The SO number is minted on approval, and an{" "}
        <B>
          approved SO is the root every{" "}
          <Link className="link" href="/documentation/finance">
            billing chain
          </Link>{" "}
          hangs off
        </B>
        .
      </P>

      <H2>Project status</H2>
      <Ul>
        <Li>
          Project status is managed independently of Payment Milestones; a
          milestone transition never completes a Project automatically.
        </Li>
        <Li>
          Finance invoices and receipts follow the separate Finance lifecycle
          and do not depend on Payment Milestones (see{" "}
          <Link className="link" href="/documentation/finance">
            Finance
          </Link>
          ).
        </Li>
      </Ul>
    </>
  ),
}
