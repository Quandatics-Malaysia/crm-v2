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
  Q -- "send" --> QS[Quotation sent]
  QS -- "accept (one live accepted per funnel)" --> QA[Quotation accepted]
  QA -- "auto-win toggle" --> OW[Funnel won]
  QA -- "auto-create-project toggle" --> P[Project<br/>value = quote net]
  P --> M[Payment milestones<br/>split by exact amount]
  P -- "submit for approval" --> SO[Sales order<br/>submitted → approved]
  SO -- "approved unlocks" --> INV[Invoice draft]
  M -- "one-click draft" --> INV
  INV -- "issue" --> INVI[Invoice issued<br/>milestone → invoiced]
  INVI -- "receipt + proof" --> RCT[Receipt issued<br/>invoice settled, milestone paid]
  RCT -- "all milestones paid + toggle" --> PC[Project completed]
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
            <Code key="c">opportunities.account_id / person_id</Code>,
            "Funnel create form.",
          ],
          [
            "Quotation → Funnel",
            <Code key="c">quotations.opportunity_id</Code>,
            "New quotation (from the funnel or the Quotations list).",
          ],
          [
            "Project → Funnel / Quotation / Account",
            <Code key="c">projects.opportunity_id / quotation_id / account_id</Code>,
            "Create project (manual or auto on quote accept).",
          ],
          [
            "Milestones → Project",
            <Code key="c">payment_milestones.project_id</Code>,
            "Milestones panel or the milestone template.",
          ],
          [
            "Sales order → Project",
            <Code key="c">sales_orders.project_id</Code>,
            "Submit for approval on the project.",
          ],
          [
            "Billing doc → SO / Project / Milestone / parent doc",
            <Code key="c">
              finance_docs.sales_order_id / project_id / milestone_id /
              parent_id
            </Code>,
            "Finance module (chains from the approved SO).",
          ],
          [
            "Interco mirror → Funnel",
            <Code key="c">intercompany_deals.opportunity_id</Code>,
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
          Milestones <B>reconcile to the project value</B> — edits that would
          push the total above <Code>projects.value</Code> are rejected.
        </Li>
        <Li>
          Invoicing requires an <B>approved sales order</B> on the project.
        </Li>
        <Li>
          One <B>live invoice per milestone</B> (DB partial unique index) — a
          milestone can never be double-billed.
        </Li>
        <Li>
          A receipt/payment cannot be issued without an <B>attached proof</B>,
          and its parent invoice must itself be issued.
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
        <Code>draft → sent → accepted / rejected</Code>; project{" "}
        <Code>planning → active → completed</Code> (plus{" "}
        <Code>on_hold / cancelled</Code>); milestone{" "}
        <Code>pending → invoiced → paid</Code> (forward-only); sales order{" "}
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

      <H2>Contacts</H2>
      <P>
        People at accounts (<Code>persons</Code> table). Contacts link to an
        account and can be named on funnel deals. The detail page shows the
        person’s funnels, activities and documents.
      </P>

      <H2>Ownership</H2>
      <P>
        Leads, accounts, contacts, funnels and projects carry an{" "}
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
      <H2>Pipeline</H2>
      <P>
        Deals (“funnels”) move through tenant-configurable stages, each with a{" "}
        <B>probability</B> and a kind (<Code>OPEN / WON / LOST / PARKED</Code>).
        Stages can require <B>approval to enter</B>: reps below the bypass tier
        raise a stage-approval request that a manager approves on /approvals.
        Deal status (<Code>open / won / lost / on_hold</Code>) follows the
        stage kind.
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
        <Code>opportunities.project_natures</Code>; the first is the primary
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
          <B>Stale funnels:</B> deals untouched for{" "}
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
  draft --> sent : send
  draft --> [*] : delete
  sent --> accepted : accept
  sent --> rejected : reject
  accepted --> [*]
  note right of accepted
    max ONE live accepted +
    ONE live primary per funnel
    (DB partial unique indexes)
  end note
`}
      />
      <P>
        Sent and accepted quotations are <B>read-only</B> — pricing changes
        happen by creating a <B>revision</B> from the funnel, which becomes the
        new primary. Numbers are minted from the tenant’s configurable
        prefix/sequence/padding.
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

      <H2>What acceptance automates</H2>
      <Ul>
        <Li>
          The funnel’s <B>quoted amount</B> re-syncs from the accepted (primary)
          quote’s net.
        </Li>
        <Li>
          <Code>auto_win_on_quote_accept</Code>: the funnel moves to Won
          (bypassing the Won stage’s approval gate — deliberate).
        </Li>
        <Li>
          <Code>auto_create_project_on_accept</Code>: the{" "}
          <Link className="link" href="/documentation/projects-milestones">
            delivery project
          </Link>{" "}
          is created with value/currency/nature carried over and the{" "}
          <B>milestone template</B> seeded (last row absorbs cent rounding).
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
    "Delivery projects, the milestone payment split, sales-order approval, and project status automation.",
  body: (
    <>
      <H2>Creating a project</H2>
      <P>
        Two paths: manually (optionally prefilled from a funnel/quote) or
        automatically on quote acceptance. The project code derives from the
        account code + primary nature; <Code>projects.value</Code> prefills
        from the accepted quote’s net and becomes the reconciliation ceiling
        for milestones.
      </P>

      <H2>Payment milestones</H2>
      <Mermaid
        chart={`
stateDiagram-v2
  [*] --> pending : created (manual or template)
  pending --> invoiced : linked invoice ISSUED
  invoiced --> paid : receipt settles the invoice
  invoiced --> pending : invoice cancelled (auto-freed)
  paid --> invoiced : receipt cancelled and cover lost
  note right of pending : one LIVE invoice per milestone (DB unique index)
`}
      />
      <Ul>
        <Li>
          Milestones split by <B>exact amount</B> (not percent); the total may
          never exceed the project value.
        </Li>
        <Li>
          The <B>milestone template</B> in Settings seeds new projects
          automatically (percent split of the value; the last row absorbs
          rounding).
        </Li>
        <Li>
          Manual status moves are <B>forward-only</B>{" "}
          (<Code>pending → invoiced → paid</Code>); only billing-document
          events move a milestone backwards (invoice/receipt cancellation).
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

      <H2>Status automation</H2>
      <Ul>
        <Li>
          With <Code>auto_complete_project_on_paid</Code> on, a project moves
          to <B>Completed</B> when its last milestone is paid — via receipts,
          manual invoice settlement, or manual milestone edits/deletes.
        </Li>
        <Li>
          The project Billing tab shows invoiced/paid progress against the
          value and one-click drafts an invoice per unclaimed pending
          milestone (see{" "}
          <Link className="link" href="/documentation/finance">
            Finance
          </Link>
          ).
        </Li>
      </Ul>
    </>
  ),
}
