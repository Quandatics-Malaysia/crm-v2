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

export const overviewPage: DocPage = {
  slug: "overview",
  title: "Overview",
  description:
    "What this CRM is, how the modules fit together, and the conventions every module follows.",
  body: (
    <>
      <Lead>
        A multi-entity (multi-tenant) CRM covering the full lead-to-cash cycle:
        leads → funnel (funnels) → quotations → projects & payment
        milestones → sales orders → billing documents — with intercompany
        deal-sharing between sibling entities and a weighted revenue forecast
        on top.
      </Lead>

      <H2>Module map</H2>
      <Mermaid
        chart={`
flowchart LR
  subgraph CRM
    LEAD[Leads]
    ACC[Accounts]
    PER[Contacts]
  end
  subgraph Sales
    OPP[Funnel<br/>funnels]
    QUO[Quotations]
    PRJ[Projects]
    MIL[Payment milestones]
    SO[Sales orders]
  end
  subgraph Finance["Finance add-on (toggle)"]
    BILL[Billing<br/>DO / INV / CN / RCT]
    PUR[Purchasing<br/>RFQ / PO / PINV / PAY]
  end
  subgraph Insights
    FC[Forecast]
    IC[Intercompany]
  end
  LEAD -- convert --> ACC
  LEAD -- convert --> OPP
  ACC --- PER
  OPP -- quote --> QUO
  QUO -- accept --> PRJ
  OPP --- MIL
  PRJ -- submit --> SO
  SO -- approved --> BILL
  SO -- approved --> PUR
  OPP -- weighted --> FC
  BILL -- billed margin --> FC
  OPP -- interco deal --> IC
  IC -- partner share --> FC
`}
      />

      <H2>Conventions every module follows</H2>
      <Ul>
        <Li>
          <B>Tenant isolation by RLS.</B> Every tenant-owned table has a
          Postgres row-level-security policy keyed on the{" "}
          <Code>app.current_tenant</Code> setting; server code always runs
          inside <Code>runInTenant(tenantId, fn)</Code>, so a forgotten{" "}
          <Code>WHERE tenant_id = …</Code> cannot leak data across entities.
        </Li>
        <Li>
          <B>Capability + record scoping.</B> Actions check a permission key
          (e.g. <Code>quotation.update</Code>) and, for owned records, the
          owner/managed-subtree scope. Optional modules also require a signed
          deployment entitlement. See{" "}
          <Link className="link" href="/documentation/access-control">
            Access control
          </Link>
          .
        </Li>
        <Li>
          <B>Settings-driven behavior.</B> Automation, picklists, numbering and
          entity behavior settings live in <Code>tenant_settings</Code> — one
          row per entity, editable in Settings. See{" "}
          <Link className="link" href="/documentation/settings-reference">
            Settings reference
          </Link>
          .
        </Li>
        <Li>
          <B>Add-on access is signed at runtime.</B> Every optional route and
          action rechecks deployment entitlement; this documentation also
          requires the <Code>docs.view</Code> permission.
        </Li>
        <Li>
          <B>Every mutation leaves a trail.</B> Server actions write an audit
          row and, for business events, an activity-timeline entry on the
          record.
        </Li>
      </Ul>

      <H2>The five money numbers</H2>
      <P>
        Amounts are deliberately distinct — do not conflate them when reading
        screens or building reports:
      </P>
      <DocTable
        head={["Number", "Lives on", "Meaning"]}
        rows={[
          [
            <B key="1">Estimated amount</B>,
            <Code key="2">funnels.estimated_amount</Code>,
            "The rep's manual estimate. Headline value on the funnel board and the basis of the weighted forecast.",
          ],
          [
            <B key="1">Quoted amount</B>,
            <Code key="2">funnels.amount</Code>,
            "Synced from the primary quotation's net total. Display only; null until a quote exists.",
          ],
          [
            <B key="1">Recognized amount</B>,
            "derived, not stored",
            "basis × recognized % — the entity's own cut on intercompany deals (basis = quoted once a primary quote exists, else estimated).",
          ],
          [
            <B key="1">Project value</B>,
            <Code key="2">projects.value</Code>,
            "The delivery budget milestones must reconcile to (prefilled from the accepted quote's net).",
          ],
          [
            <B key="1">Billed amounts</B>,
            <Code key="2">finance_docs.amount</Code>,
            "What was actually invoiced / received, rolled up as billed margin (invoices − credit notes − purchase invoices).",
          ],
        ]}
      />

      <Callout>
        Start with{" "}
        <Link className="link" href="/documentation/lead-to-cash">
          The lead-to-cash flow
        </Link>{" "}
        for the end-to-end picture, then dive into each module page.
      </Callout>
    </>
  ),
}
