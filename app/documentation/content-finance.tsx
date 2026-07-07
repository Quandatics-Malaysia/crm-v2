import Link from "next/link"
import { Mermaid } from "@/components/mermaid"
import {
  B,
  Callout,
  Code,
  DocTable,
  H2,
  H3,
  Lead,
  Li,
  P,
  Pre,
  Ul,
} from "./doc-kit"
import type { DocPage } from "./registry"

export const financePage: DocPage = {
  slug: "finance",
  title: "Finance add-on — Billing & Purchasing",
  description:
    "The O2C and P2P document chains: kinds, status machine, milestone tie, proof gate, reminders, and how to toggle the module safely in production.",
  body: (
    <>
      <Lead>
        An <B>add-on module</B>: one <Code>finance_docs</Code> table carries
        both chains — order-to-cash (Billing) and procure-to-pay (Purchasing) —
        with the chain rules defined as data in{" "}
        <Code>lib/finance-kinds.ts</Code>. It ships gated and can be toggled
        per entity at any time without touching existing CRM data.
      </Lead>

      <H2>Document chains</H2>
      <Mermaid
        chart={`
flowchart LR
  SO[Approved sales order]
  subgraph O2C["Billing (sale)"]
    DO[Delivery order DO]
    INV[Invoice INV]
    CN[Credit note CN]
    RCT[Payment receipt RCT]
  end
  subgraph P2P["Purchasing (purchase)"]
    RFQ[RFQ]
    PO[Purchase order PO]
    PINV[Purchase invoice PINV]
    PAY[Payment PAY]
  end
  SO --> DO --> INV
  SO --> INV
  INV --> CN
  INV --> RCT
  SO --> RFQ --> PO --> PINV --> PAY
  SO --> PO
`}
      />
      <DocTable
        head={["Kind", "Direction", "Created from", "Number", "Special"]}
        rows={[
          ["Delivery order", "sale", "approved SO", <Code key="n">{"{ENT}"}DO-0001</Code>, "optional hop"],
          ["Invoice", "sale", "SO or DO", <Code key="n">{"{ENT}"}INV-0001</Code>, "can tie to a payment milestone"],
          ["Credit note", "sale", "invoice", <Code key="n">{"{ENT}"}CN-0001</Code>, "—"],
          ["Payment receipt", "sale", "issued invoice", <Code key="n">{"{ENT}"}RCT-0001</Code>, "settles its parent; proof required"],
          ["RFQ", "purchase", "approved SO", <Code key="n">{"{ENT}"}RFQ-0001</Code>, "—"],
          ["Purchase order", "purchase", "SO or RFQ", <Code key="n">{"{ENT}"}PO-0001</Code>, "—"],
          ["Purchase invoice", "purchase", "PO", <Code key="n">{"{ENT}"}PINV-0001</Code>, "auto-created by the interco mirror"],
          ["Payment", "purchase", "issued purchase invoice", <Code key="n">{"{ENT}"}PAY-0001</Code>, "settles its parent; proof required"],
        ]}
      />

      <H2>Status machine</H2>
      <Mermaid
        chart={`
stateDiagram-v2
  [*] --> draft : create
  draft --> issued : issue (receipt/payment need attached proof)
  draft --> cancelled : cancel
  issued --> settled : payments cover the amount, or Mark settled
  issued --> cancelled : cancel (compensating side effects run)
  settled --> [*]
  cancelled --> [*]
`}
      />
      <P>Issuing and cancelling are not just status flips — they keep the chain honest:</P>
      <DocTable
        head={["Transition", "Side effects"]}
        rows={[
          [
            <B key="t">Invoice issued</B>,
            "Its milestone → invoiced. On an intercompany project, the auto-mirror drafts the partner-share pair (below).",
          ],
          [
            <B key="t">Receipt/payment issued</B>,
            <>
              Requires ≥1 attachment (the proof) and an <B>issued</B> parent.
              The parent settles only when cumulative live payments cover its
              full amount — a partial payment leaves it issued and logs the
              outstanding balance. Settling an invoice marks its milestone
              paid and can auto-complete the project.
            </>,
          ],
          [
            <B key="t">Invoice “Mark settled”</B>,
            "Money received without a receipt document: milestone → paid + project auto-complete, same as the receipt path.",
          ],
          [
            <B key="t">Issued invoice cancelled</B>,
            "Blocked while live receipts exist. Frees its milestone back to pending so it can be re-invoiced.",
          ],
          [
            <B key="t">Issued receipt cancelled</B>,
            "If remaining payments no longer cover the invoice, the invoice reverts to issued and the milestone to invoiced. An auto-completed project stays completed (reopen manually).",
          ],
        ]}
      />
      <Callout>
        Concurrency-safe by construction: the status update is compare-and-set
        (a second concurrent click fails loudly), one milestone can carry only
        one live invoice (DB partial unique index), and number minting retries
        inside savepoints.
      </Callout>

      <H2>Streamlined issuance</H2>
      <P>
        The{" "}
        <Link className="link" href="/documentation/projects-milestones">
          project
        </Link>
        ’s <B>Billing tab</B> shows an invoiced/paid progress bar
        against the project value, the billed margin, and a “Ready to invoice”
        list: one click drafts the invoice for a pending milestone with
        amount, customer, currency, sales order and due date all derived —
        the salesperson types nothing. The due date defaults to{" "}
        <Code>doc date + invoice_due_days</Code>.
      </P>

      <H2>Reminders (in-app)</H2>
      <P>
        Issued invoices past due surface on the dashboard with “N d overdue”
        and “Reminder N due” chips computed from the{" "}
        <Code>invoice_reminder_days</Code> schedule (default 7/14/30 days
        after due). “Log reminder” increments the stage and stamps the
        activity trail — the schedule is fully editable in Settings →
        Numbering.
      </P>

      <H2>Toggling the module</H2>
      <P>
        One switch, deployment-wide: set <Code>finance</Code> in{" "}
        <Code>modules.config.ts</Code> at the repo root, then rebuild + redeploy.
        Finance depends on <Code>projects</Code> and <Code>salesOrders</Code>, so
        enable those too (the app validates this at boot).
      </P>
      <Pre>{`// modules.config.ts
export const MODULE_CONFIG = {
  projects: true,
  salesOrders: true,
  finance: true,   // billing + purchasing + intercompany
  // …
} as const`}</Pre>

      <H3>Is toggling safe in production?</H3>
      <P>
        <B>Yes — the flag only gates access, never data.</B> What OFF does,
        concretely:
      </P>
      <Ul>
        <Li>
          Nav section disappears; <Code>/billing</Code>,{" "}
          <Code>/purchasing</Code> and every document detail page redirect to
          the dashboard.
        </Li>
        <Li>
          Every finance server action re-checks the flag and refuses — no
          writes can happen while off. Attachments/activity on finance
          documents are refused too.
        </Li>
        <Li>
          Derived surfaces vanish cleanly: the project Billing tab, dashboard
          overdue-invoices card, forecast billed-margin card and the two
          finance Behavior switches in Settings all hide (each checks the flag
          server-side).
        </Li>
        <Li>
          The intercompany auto-mirror never writes into a tenant whose flag
          is off — the pair is skipped with a visible activity note on the
          origin invoice.
        </Li>
      </Ul>
      <P>
        <B>Nothing is deleted or mutated by toggling.</B> All documents,
        attachments, reminder counters and milestone states are retained;
        toggling back ON shows everything exactly as it was. Numbering
        continues where it left off (count-based, and documents are never
        hard-deleted). Milestone statuses already reached (invoiced/paid) stay
        put while off — milestones simply can’t move further until the module
        returns.
      </P>
      <Callout tone="warn">
        The only irreversible action in the module is business-level, not
        toggle-level: issued documents are real financial records. Toggling
        OFF mid-month simply freezes the chains; it does not un-issue
        anything.
      </Callout>

      <H2>Permissions</H2>
      <DocTable
        head={["Permission", "Grants"]}
        rows={[
          [<Code key="p">finance.view</Code>, "See Billing/Purchasing lists and document detail pages (all templates include it)."],
          [<Code key="p">finance.manage</Code>, "Create, issue, settle, cancel documents and log reminders; also required to load the create-dialog sources (Manager and above)."],
        ]}
      />
    </>
  ),
}

export const intercompanyPage: DocPage = {
  slug: "intercompany",
  title: "Intercompany",
  description:
    "Deal sharing between sibling entities: the mirror, the handshake, partner forecast share, and the auto-mirrored invoice pair.",
  body: (
    <>
      <Lead>
        An intercompany deal is one the selling entity contracts but a sibling
        entity delivers. The seller recognizes its cut (
        <Code>recognized_percent</Code>); the remainder is the{" "}
        <B>partner share</B>. The deal’s account stays the end customer — the
        partner link is an <B>entity</B> link, validated against the tenant’s
        partner allow-list.
      </Lead>

      <H2>The mirror</H2>
      <P>
        <Code>intercompany_deals</Code> is a read-only snapshot row per interco
        deal, visible to <B>both</B> tenants via a custom two-sided RLS policy
        (origin writes, partner reads). It carries name, customer name,
        amounts, stage probability and forecast eligibility — so the partner
        needs no access to the origin’s protected tables. It is upserted on
        every relevant funnel mutation and reconciled on deploy.
      </P>

      <H2>The handshake</H2>
      <P>
        The partner sees inbound deals on <Code>/intercompany</Code> and
        responds <B>accept</B> or <B>decline</B> (with a reason) — stored in{" "}
        <Code>intercompany_deal_responses</Code>, shown as a badge on the
        origin’s funnel page. A partner can create its own{" "}
        <B>delivery project</B> from an accepted inbound deal (value prefilled
        to the share, linked via <Code>projects.intercompany_deal_id</Code>).
      </P>

      <H2>Forecast contribution</H2>
      <Ul>
        <Li>
          <B>Origin:</B> forecast rows expose recognized-weighted value
          (weighted × recognized %), so the middle-man forecasts only its cut.
        </Li>
        <Li>
          <B>Partner:</B> inbound deals contribute{" "}
          <Code>share × origin stage probability</Code> as{" "}
          <Code>source: inbound</Code> forecast rows.
        </Li>
      </Ul>

      <H2>Auto-mirrored invoice pair (Finance module)</H2>
      <Mermaid
        chart={`
sequenceDiagram
  participant O as Origin entity
  participant P as Partner entity
  O->>O: Issue customer invoice INV-0007 (interco project)
  Note over O: checks — auto-mirror on, deal not declined,<br/>partner finance module ON, share > 0
  O->>O: draft PINV (partner share, linked to the project)
  O->>P: draft INV to origin (partner share)
  Note over O,P: one atomic transaction — both sides or neither;<br/>linked via counterpart_doc_id + denormalized number
  P->>P: partner reviews & issues its invoice
  O->>O: origin reviews & issues its purchase invoice
`}
      />
      <P>
        Share = <Code>invoice amount × (100 − recognized %) / 100</Code>{" "}
        (recognized % is set on the{" "}
        <Link className="link" href="/documentation/funnel-forecast">
          funnel deal
        </Link>
        ). Both
        documents are created as <B>drafts</B> — each side reviews and issues
        its own. The origin’s purchase invoice carries the project, so the
        project’s billed margin includes the interco cost. If the mirror is
        skipped or fails, an activity note on the origin invoice says so —
        nothing is ever half-written.
      </P>

      <H2>Settings that govern it</H2>
      <DocTable
        head={["Setting", "Effect"]}
        rows={[
          [<Code key="s">intercompany_partner_ids</Code>, "Partner allow-list. Empty = any sibling entity the user belongs to; configured = strict."],
          [<Code key="s">interco_auto_mirror</Code>, "Master toggle for the invoice pair (Settings → Behavior, finance-gated)."],
          [<Code key="s">recognized_percent</Code>, "Per deal, on the funnel form when the intercompany toggle is on."],
        ]}
      />
    </>
  ),
}
