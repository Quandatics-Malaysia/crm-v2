import * as React from "react"
import Link from "next/link"
import { Mermaid } from "@/components/mermaid"
import { SCHEMA_TABLES } from "./schema-data"
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

export const accessControlPage: DocPage = {
  slug: "access-control",
  title: "Access control",
  description:
    "Tenants, RLS, roles and permissions, record-level scoping, and the break-glass switches.",
  body: (
    <>
      <H2>Layers</H2>
      <Mermaid
        chart={`
flowchart TD
  REQ[Request / server action] --> CTX["requireContext()<br/>session + active tenant + permission set"]
  CTX --> PERM{"ctx.can(permission)?"}
  PERM -- no --> DENY[Refused]
  PERM -- yes --> RLS["runInTenant(tenantId)<br/>sets app.current_tenant GUC"]
  RLS --> SCOPE{"record-scoped table?"}
  SCOPE -- yes --> OWNER["owner + managed-subtree filter<br/>(visibleMemberIds)"]
  SCOPE -- no --> DATA[(Tenant rows only)]
  OWNER --> DATA
`}
      />
      <Ul>
        <Li>
          <B>Layer 1 — tenant isolation (RLS).</B> Every tenant-owned table
          has a <Code>FORCE ROW LEVEL SECURITY</Code> policy on{" "}
          <Code>{"tenant_id = current_setting('app.current_tenant')"}</Code>.
          Cross-tenant reads are impossible from application code. Two tables
          have deliberate two-sided policies: <Code>intercompany_deals</Code>{" "}
          and <Code>intercompany_deal_responses</Code> (origin ↔ partner).
        </Li>
        <Li>
          <B>Layer 2 — capabilities.</B> Permission keys (
          <Code>resource.action</Code>) compose into roles. The catalog and
          the system role templates are code-defined and{" "}
          <B>re-synced on every deploy</B>, so new permissions appear in the
          roles matrix automatically.
        </Li>
        <Li>
          <B>Layer 3 — record scope.</B> Owned records (leads, accounts,
          contacts, pipelines, projects) are visible to their owner plus the
          owner’s management chain (transitive reports via{" "}
          <Code>manager_member_id</Code>; cycles are rejected).{" "}
          <Code>records.view_all</Code> / <Code>records.manage_all</Code>{" "}
          remove the filter. Finance documents are capability-scoped only (no
          owner).
        </Li>
      </Ul>

      <H2>System role templates</H2>
      <DocTable
        head={["Role", "Tier", "Summary"]}
        rows={[
          ["Owner / Admin", "100 / 90", "Everything (wildcard grant, kept in sync with the catalog)."],
          ["Manager", "60", "Rep powers + approvals (stage advances, sales orders), send/accept/delete quotes, tax & funnel config, audit, intercompany, finance.manage."],
          ["Senior Rep", "40", "Rep powers + send quotations; advances stages without approval (above the default bypass tier)."],
          ["Rep", "20", "Create/update CRM + sales records; gated stage advances require upline approval."],
          ["Viewer", "10", "Read-only across the workspace (view permissions + records.view_all)."],
        ]}
      />
      <P>
        <Code>approval_bypass_tier</Code> decides which tiers skip
        stage-approval gates. Custom roles are freely editable per tenant in
        Team &amp; roles.
      </P>

      <H2>Membership & entity switches</H2>
      <DocTable
        head={["Control", "Where", "Effect"]}
        rows={[
          [<Code key="c">member.status</Code>, "Team page", <><Code>active / invited / disabled</Code> — disabled members keep history but cannot act.</>],
          [<Code key="c">tenant_settings.status</Code>, "backend SQL", <><Code>suspended</Code> locks the whole entity for every member (enforced in the request context).</>],
          [<Code key="c">user.is_superadmin</Code>, "backend SQL", "Break-glass: bypasses permission checks (not RLS)."],
          [<Code key="c">pending_invites</Code>, "Team → Add member", "Pre-registers an email; membership is claimed automatically on first sign-in."],
          [<Code key="c">auto_join_domains</Code>, "Settings", "Users signing in with a matching email domain auto-join with the configured role."],
        ]}
      />

      <H2>Documentation access</H2>
      <P>
        This documentation is deliberately <B>hidden from end users</B>: there
        is no link to it anywhere in the CRM — it is reached by URL only
        (<Code>/documentation</Code>) and rendered as a standalone site
        outside the app shell. Two gates, both required: the member needs{" "}
        <Code>docs.view</Code> (held only by Owner/Admin by default; grant it
        to a specific role in Team &amp; roles when someone else needs it),
        and the tenant switch <Code>documentation_module</Code> (Settings →
        General → Behavior) must be on.
      </P>
    </>
  ),
}

export const settingsReferencePage: DocPage = {
  slug: "settings-reference",
  title: "Settings reference",
  description:
    "Every tenant setting, its default, and exactly where it takes effect.",
  body: (
    <>
      <Lead>
        One row per entity in <Code>tenant_settings</Code>. Everything below
        is self-service for holders of <Code>tenant.settings</Code>; the last
        table lists the deliberately backend-only knobs.
      </Lead>

      <H2>General & money</H2>
      <DocTable
        head={["Setting", "Default", "Effect"]}
        rows={[
          [<Code key="s">entity_name / entity_code</Code>, "—", "Display name + the prefix minted into project and finance-document numbers."],
          [<Code key="s">default_currency</Code>, "MYR", "Prefill for new pipelines/quotes/projects."],
          [<Code key="s">currencies / payment_terms</Code>, "built-ins", "Picklists for money fields and SO submission."],
          [<Code key="s">fiscal_year_start_month</Code>, "1", "FY windows on /forecast."],
          [<Code key="s">tax_inclusive</Code>, "off", "Quotation math treats unit prices as tax-inclusive."],
          [<Code key="s">approval_bypass_tier</Code>, "40", "Role tiers ≥ this skip stage-approval gates."],
          [<Code key="s">default_country / phone_prefix</Code>, "—", "Prefills on new account/lead/contact forms (create only)."],
          [<Code key="s">company_* / bank_details / quote_footer / logo</Code>, "—", "Letterhead + payment block on the customer-facing quotation document."],
        ]}
      />

      <H2>Picklists</H2>
      <DocTable
        head={["Setting", "Used by"]}
        rows={[
          [<Code key="s">industries</Code>, "Account form"],
          [<Code key="s">countries</Code>, "Address country selects"],
          [<Code key="s">product_types / product_codes</Code>, "Project natures (codes drive project numbering)"],
          [<Code key="s">lead_sources</Code>, "Lead form"],
          [<Code key="s">loss_reasons</Code>, "Deal-lost + lead-disqualify dialogs"],
          [<Code key="s">so_document_kinds</Code>, "Sales-order submission"],
          [<Code key="s">custom_funnel_fields</Code>, "Extra funnel fields"],
        ]}
      />

      <H2>Numbering</H2>
      <DocTable
        head={["Setting", "Default", "Effect"]}
        rows={[
          [<Code key="s">quote_prefix / quote_next_number / quote_pad_width</Code>, <Code key="d">Q- / 1 / 4</Code>, "Quotation numbers."],
          [<Code key="s">so_next_number / so_pad_width</Code>, "1 / 4", "Sales-order numbers (minted on approval)."],
          [<Code key="s">project_next_number / project_pad_width</Code>, "1 / 3", "Project codes ({account}{nature}-NNN)."],
          [<Code key="s">quote_valid_days</Code>, "—", 'Prefills "Valid until" on new quotations.'],
          [<Code key="s">invoice_due_days</Code>, "30", "Invoice due date = doc date + N."],
          [<Code key="s">invoice_reminder_days</Code>, "7 / 14 / 30", "Reminder stages, days after due."],
        ]}
      />

      <H2>Automation & behavior</H2>
      <DocTable
        head={["Setting", "Default", "Effect"]}
        rows={[
          [<Code key="s">auto_win_on_quote_accept</Code>, "off", "Accepted primary quote moves the funnel to Won (bypasses the Won approval gate)."],
          [<Code key="s">auto_create_project_on_accept</Code>, "off", "Accepted quote creates the delivery project + seeds the milestone template."],
          [<Code key="s">milestone_template</Code>, "—", "Percent split seeded onto new projects with a value."],
          [<Code key="s">follow_up_due_days</Code>, "7", 'Dashboard "due soon" window.'],
          [<Code key="s">stale_deal_days</Code>, "off", "Dashboard stale-funnel nudges."],
          [<Code key="s">lead_follow_up_days</Code>, "off", 'Auto "First contact" follow-up on new leads.'],
          [<Code key="s">auto_complete_project_on_paid</Code>, "off", "All milestones paid → project Completed (finance-gated switch)."],
          [<Code key="s">interco_auto_mirror</Code>, "on", "Auto-draft the intercompany invoice pair (finance-gated switch)."],
          [<Code key="s">documentation_module</Code>, "on", "Show /documentation to members holding docs.view."],
          [<Code key="s">allow_password_login</Code>, "on", "Permit email+password sign-in (vs SSO only)."],
          [<Code key="s">auto_join_domains / auto_join_role</Code>, "—", "Email-domain auto-membership."],
          [<Code key="s">intercompany_partner_ids</Code>, "any sibling", "Strict partner allow-list when configured."],
        ]}
      />

      <H2>Backend-only knobs (deliberately no UI)</H2>
      <DocTable
        head={["Knob", "How", "Effect"]}
        rows={[
          [<Code key="s">Signed entitlement</Code>, "Deployment control API", "Runtime ownership for every optional module; accepted revisions apply to fresh requests without rebuilding the image."],
          [<Code key="s">tenant_settings.status</Code>, "SQL", "suspended locks the entity; active restores it."],
          [<Code key="s">user.is_superadmin</Code>, "SQL", "Permission bypass (break-glass)."],
        ]}
      />
    </>
  ),
}

/** Full generated schema listing — native <details> per table. */
function SchemaModuleTables() {
  const modules = [...new Set(SCHEMA_TABLES.map((t) => t.module))]
  return (
    <>
      {modules.map((m) => (
        <React.Fragment key={m}>
          <H3>{m}</H3>
          {SCHEMA_TABLES.filter((t) => t.module === m).map((t) => (
            <details key={t.name} className="my-2 rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium hover:bg-accent/40">
                <span className="font-mono">{t.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t.columns.length} columns
                </span>
              </summary>
              <div className="border-t px-3 pb-1">
                <DocTable
                  head={["Column", "Type", "Null", "Default"]}
                  rows={t.columns.map((c) => [
                    <Code key="n">{c.name}</Code>,
                    c.type,
                    c.nullable ? "yes" : "no",
                    c.def ? <Code key="d">{c.def}</Code> : "—",
                  ])}
                />
              </div>
            </details>
          ))}
        </React.Fragment>
      ))}
    </>
  )
}

export const schemaReferencePage: DocPage = {
  slug: "schema-reference",
  title: "Schema reference",
  description:
    "The tables behind each module, their key columns, and the relationships that wire the system together.",
  body: (
    <>
      <Lead>
        Drizzle ORM over Postgres; schema lives in <Code>db/schema/</Code>,
        migrations in <Code>db/migrations/</Code> (applied by{" "}
        <Code>npm run db:migrate</Code>, which also reapplies RLS policies,
        report views and the permission sync). The listing below is generated
        from the live database — every public table, every column.
      </Lead>

      <H2>Entity relationship (core spine)</H2>
      <Mermaid
        chart={`
erDiagram
  ORGANIZATION ||--o{ TENANT_SETTINGS : "1 row each"
  ORGANIZATION ||--o{ MEMBER : has
  LEADS }o--|| ORGANIZATION : tenant
  LEADS |o--o| ACCOUNTS : "converted to"
  LEADS |o--o| OPPORTUNITIES : "converted to"
  ACCOUNTS ||--o{ PERSONS : contacts
  ACCOUNTS ||--o{ OPPORTUNITIES : deals
  OPPORTUNITIES ||--o{ QUOTATIONS : quotes
  QUOTATIONS ||--o{ QUOTATION_LINE_ITEMS : lines
  OPPORTUNITIES ||--o{ PROJECTS : delivers
  QUOTATIONS |o--o{ PROJECTS : "value source"
  PROJECTS ||--o{ PAYMENT_MILESTONES : split
  PROJECTS ||--o{ SALES_ORDERS : approval
  SALES_ORDERS ||--o{ FINANCE_DOCS : "chain root"
  FINANCE_DOCS |o--o{ FINANCE_DOCS : "parent chain"
  PAYMENT_MILESTONES |o--o| FINANCE_DOCS : "one live invoice"
  OPPORTUNITIES |o--o| INTERCOMPANY_DEALS : mirror
  INTERCOMPANY_DEALS ||--o{ INTERCOMPANY_DEAL_RESPONSES : handshake
`}
      />

      <H2>Every table, every column</H2>
      <P>
        Regenerate with <Code>npm run docs:schema</Code> after any migration
        so this never drifts from production. Click a table for its full
        column list; column <B>semantics</B> live on the module pages (
        <Link className="link" href="/documentation/funnel-forecast">
          funnel
        </Link>
        ,{" "}
        <Link className="link" href="/documentation/quotations">
          quotations
        </Link>
        ,{" "}
        <Link className="link" href="/documentation/projects-milestones">
          projects
        </Link>
        ,{" "}
        <Link className="link" href="/documentation/finance">
          finance
        </Link>
        ,{" "}
        <Link className="link" href="/documentation/intercompany">
          intercompany
        </Link>
        ).
      </P>
      <SchemaModuleTables />

      <H2>RLS model</H2>
      <P>
        <Code>db/sql/rls.sql</Code> loops over every tenant-owned table and
        applies <Code>FORCE ROW LEVEL SECURITY</Code> with{" "}
        <Code>{"tenant_id = current_setting('app.current_tenant')"}</Code>. The
        GUC is set transaction-locally by <Code>runInTenant</Code>.
        Exceptions: <Code>organization</Code> (RLS-excluded, sibling-entity
        names must be readable) and the two intercompany tables (two-sided
        SELECT policies). Cross-tenant work (the interco mirror) switches the
        GUC inside a single transaction — never disables RLS.
      </P>
    </>
  ),
}

export const operationsPage: DocPage = {
  slug: "operations",
  title: "Operations",
  description:
    "Running, migrating and toggling the system: commands, environment variables, and troubleshooting.",
  body: (
    <>
      <H2>Cheat sheet</H2>
      <Pre>{`npm run dev              # dev server (Postgres up + migrations applied first)
npm run db:migrate       # migrations + RLS + views + permission sync + backfills
npm run db:seed          # base data (roles, funnel stages, tax, demo admin)
npm run db:seed-sample   # sample CRM data
# optional modules: apply a vendor-signed deployment entitlement revision
npm test                 # vitest suite (money math, milestone split, reminders…)
npx tsc --noEmit && npm run lint && npm run build
docker compose up -d --build   # full stack; migrate runs automatically`}</Pre>
      <Callout tone="warn">
        Golden rule: after every pull that touches{" "}
        <Code>db/migrations/</Code>, run <Code>npm run db:migrate</Code>{" "}
        before starting the app. <Code>{'column "…" does not exist'}</Code> always
        means a pending migration.
      </Callout>

      <H2>Environment variables</H2>
      <DocTable
        head={["Variable", "Purpose"]}
        rows={[
          [<Code key="v">DATABASE_URL</Code>, "Postgres connection (app role; RLS applies)."],
          [<Code key="v">BETTER_AUTH_SECRET / BETTER_AUTH_URL</Code>, "Auth signing secret + canonical URL."],
          [<Code key="v">ENTRA_* (client id/secret/tenant)</Code>, "Microsoft Entra SSO (optional)."],
          [<Code key="v">DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD</Code>, "Seeded demo admin (dev only)."],
        ]}
      />

      <H2>Module toggles in production</H2>
      <P>
        Per-tenant flags are plain columns — flipping them requires no
        restart and touches no data. The finance flag has a helper script;
        documentation is self-service in Settings. Full safety analysis:{" "}
        <Link className="link" href="/documentation/finance">
          Finance → Toggling the module
        </Link>
        .
      </P>

      <H2>Troubleshooting</H2>
      <DocTable
        head={["Symptom", "Cause → fix"]}
        rows={[
          [<Code key="t">{'column "…" does not exist'}</Code>, "Pending migration → npm run db:migrate."],
          ["Dev terminal spams GET /dashboard + ChunkLoadError", "A browser tab left open across a dev-server restart reload-loops → close/hard-refresh every tab."],
          [<Code key="t">npm ci</Code> + " lock file out of sync (Docker)", "Lockfile written by a newer npm → npx npm@10.9.8 install --package-lock-only, commit, rebuild."],
          ["Finance pages redirect though the flag is on", "Master switch off in lib/modules.ts, or the user lacks finance.view."],
          ["Sign-in works but the user sees nothing", "Membership disabled/invited, or the tenant is suspended."],
        ]}
      />
    </>
  ),
}

export const apiIntegrationsPage: DocPage = {
  slug: "api-integrations",
  title: "API integrations",
  description:
    "API-only workflow for external developers: add templates, assign per account, and verify.",
  body: (
    <>
      <Lead>
        External developers do not need source access for quotation-template updates.
        Use the CRM API only. The public path is{" "}
        <Code>/api/v1</Code> behind bearer API keys.
      </Lead>

      <H2>Auth + base</H2>
      <DocTable
        head={["Item", "Value"]}
        rows={[
          ["Auth", <Code key="auth">{`Authorization: Bearer qdk_...`}</Code>],
          ["Base URL", <Code key="base">{`https://{tenant-domain}/api/v1`}</Code>],
          ["Tenant isolation", "All writes are tenant-scoped from API key"],
          ["Error shape", <Code key="error">{`{ error: { code, message } }`}</Code>],
        ]}
      />
      <Pre>{`curl -H "Authorization: Bearer qdk_xxx" \
  https://app.quandatics.com/api/v1/quotation-templates`}</Pre>

      <H2>Create template</H2>
      <P>
        Template registration is API-only for partners. Keep one template per company
        pattern. Set <Code>renderMode: &quot;html&quot;</Code> only when you provide
        <Code> htmlTemplate</Code>.
      </P>
      <DocTable
        head={["Method", "Path", "Permission", "Body / note"]}
        rows={[
          [
            <Code key="create-method">POST</Code>,
            <Code key="create-path">/api/v1/quotation-templates</Code>,
            <Code key="create-perm">tenant.settings</Code>,
            "Create template with code,label,render mode, legacy mapping, css/html/body."
          ],
          [
            <Code key="list-method">GET</Code>,
            <Code key="list-path">/api/v1/quotation-templates</Code>,
            <Code key="list-perm">tenant.settings</Code>,
            "List templates for the tenant (active + inactive)."
          ],
          [
            <Code key="update-method">PATCH</Code>,
            <Code key="update-path">/api/v1/quotation-templates/{`{code}`}</Code>,
            <Code key="update-perm">tenant.settings</Code>,
            "Update label, mode, template code mapping, active flag, markup/CSS."
          ],
          [
            <Code key="delete-method">DELETE</Code>,
            <Code key="delete-path">/api/v1/quotation-templates/{`{code}`}</Code>,
            <Code key="delete-perm">tenant.settings</Code>,
            "Soft-disable template (sets isActive = false).",
          ],
        ]}
      />

      <H2>Assign to account</H2>
      <DocTable
        head={["Method", "Path", "Permission", "Body / note"]}
        rows={[
          [
            <Code key="acct-get-method">GET</Code>,
            <Code key="acct-get-path">/api/v1/accounts/{`{id}`}/quotation-template-code</Code>,
            <Code key="acct-get-perm">account.update</Code>,
            "Read assigned template code for one account.",
          ],
          [
            <Code key="acct-patch-method">PATCH</Code>,
            <Code key="acct-patch-path">/api/v1/accounts/{`{id}`}/quotation-template-code</Code>,
            <Code key="acct-patch-perm">account.update</Code>,
            "{`{ \"quotationTemplateCode\": \"qar\" }`}",
          ],
        ]}
      />
      <Pre>{`curl -X PATCH \
  -H "Authorization: Bearer qdk_xxx" -H "content-type: application/json" \
  -d '{ "quotationTemplateCode": "cc" }' \
  https://app.quandatics.com/api/v1/accounts/acc-123/quotation-template-code`}</Pre>

      <H2>Resolution flow (what system uses)</H2>
      <DocTable
        head={["Order", "Selector"]}
        rows={[
          ["1st", "Account override: accounts.quotation_template_code"],
          ["2nd", "Tenant fallback: tenant_settings.quotation_template_code"],
          ["3rd", "Entity code map (legacy) and default fallback"]
        ]}
      />

      <H2>Failure checks</H2>
      <Ul>
        <Li><Code>401</Code>: bad/missing key.</Li>
        <Li><Code>403</Code>: key lacks permission.</Li>
        <Li><Code>404</Code>: unknown tenant resource or account not visible for key scope.</Li>
        <Li><Code>400</Code>: validation error, e.g. HTML mode without htmlTemplate.</Li>
      </Ul>
      <Callout>
        If a change fails, keep the same flow: validate with GET LIST + GET ACCOUNT,
        then POST/PATCH, then confirm again with GET ACCOUNT.
      </Callout>

      <H2>Versioning and release notes</H2>
      <Ul>
        <Li>Any template workflow change belongs to a migration + docs update in same PR.</Li>
        <Li>Mirror behavior in <Link className="link" href="/documentation/changelog">changelog</Link> before merge.</Li>
        <Li>On staging, run health + the route smoke list from the API key.</Li>
      </Ul>
    </>
  ),
}

export const changelogPage: DocPage = {
  slug: "changelog",
  title: "Versioning & changelog",
  description:
    "How the system is versioned, and — per version — exactly what changed: schema, settings, permissions and behavior.",
  body: (
    <>
      <Lead>
        The migration sequence (<Code>db/migrations/0001…</Code>) is the
        version line — every deploy applies pending migrations plus the
        idempotent re-syncs (RLS, views, permission catalog, intercompany
        backfill). Each functional version below states its schema, settings,
        permission and behavior changes so an upgrade is auditable end to end.
      </Lead>

      <H2>vX.Y — API-driven quotation template customizations</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>quotation_templates</Code> seeded support for
          html/css custom rendering, plus account-level <Code>quotation_template_code</Code>
          persistence and tenant-wide registry listing.
        </Li>
        <Li>
          <B>Permissions:</B> API routes use <Code>tenant.settings</Code> for
          template registry management and <Code>account.update</Code> for account overrides.
        </Li>
        <Li>
          <B>Behavior:</B> API now owns create/update/delete for quotation templates
          and account assignments; external integrations can onboard new entities without source.
        </Li>
        <Li>
          <B>Docs:</B> added API integration guide and endpoint behavior for third-party
          implementations.
        </Li>
      </Ul>

      <H2>v1 — Core CRM (migrations 0001–0021)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> the multi-tenant foundation — Better Auth tables
          (user/session/organization/member), <Code>tenant_settings</Code>,
          RBAC (roles/permissions/role_permissions),{" "}
          <Code>leads / accounts / persons</Code>,{" "}
          <Code>funnels + pipeline_stages + stage_approval_requests</Code>,{" "}
          <Code>quotations + quotation_line_items + tax_settings +
          products</Code>, <Code>projects + payment_milestones +
          sales_orders</Code>, polymorphic{" "}
          <Code>activities / attachments / audit_log</Code>. RLS applied to
          every tenant-owned table.
        </Li>
        <Li>
          <B>Behavior:</B> lead convert, stage approvals with role tiers,
          quotation math (absolute discounts, tax inclusive/exclusive),
          milestone reconciliation to project value, SO approval minting the
          SO number, record-level owner + managed-subtree scoping.
        </Li>
      </Ul>

      <H2>v2 — Value model & intercompany (0022–0033)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>funnels.estimated_amount</Code>{" "}
          (backfilled from <Code>amount</Code> so forecasts did not reset),{" "}
          <Code>project_natures</Code> (multi-nature),{" "}
          <Code>is_intercompany / handling_partner_entity_id /
          recognized_percent</Code>; new{" "}
          <Code>intercompany_deals</Code> (two-sided RLS) +{" "}
          <Code>intercompany_deal_responses</Code>;{" "}
          <Code>pending_invites</Code>; quotation partial unique indexes (one
          live accepted + one live primary per funnel);{" "}
          <Code>quotation_line_items.project_nature_code</Code>;{" "}
          <Code>projects.intercompany_deal_id</Code>.
        </Li>
        <Li>
          <B>Settings:</B> <Code>intercompany_partner_ids</Code> allow-list,{" "}
          <Code>fiscal_year_start_month</Code> put to work by the forecast
          time-frame selector.
        </Li>
        <Li>
          <B>Permissions:</B> <Code>intercompany.view</Code>.
        </Li>
        <Li>
          <B>Behavior:</B> recognized-amount model (basis × recognized %),
          forecast views expose recognized-weighted value, partner handshake
          (accept/decline), partner delivery project from inbound deals,
          inbound forecast contribution, tenant suspension enforced,
          invite-claim on first sign-in.
        </Li>
      </Ul>

      <H2>v2.5 — Settings & automation (0034–0039)</H2>
      <Ul>
        <Li>
          <B>Schema/settings:</B> <Code>currencies</Code>,{" "}
          <Code>payment_terms</Code>, <Code>quote_valid_days</Code>, company
          profile block (<Code>company_* / bank_details / quote_footer /
          logo_storage_key</Code>), <Code>lead_sources</Code>,{" "}
          <Code>loss_reasons</Code>, <Code>so_document_kinds</Code>,{" "}
          <Code>milestone_template</Code>,{" "}
          <Code>auto_create_project_on_accept</Code>,{" "}
          <Code>default_country / phone_prefix</Code>,{" "}
          <Code>stale_deal_days / lead_follow_up_days /
          follow_up_due_days</Code>; <Code>pg_trgm</Code> extension for fuzzy
          duplicate warnings.
        </Li>
        <Li>
          <B>Behavior:</B> quote letterhead from the company profile,
          SO submit captures document kind + payment term, auto project on
          accept (+ milestone template seeding, last row absorbs rounding),
          create-form presets, duplicate guards (exact + trigram warn-only),
          dashboard stale-funnel and follow-up nudges, standardized{" "}
          <Code>StatusBadge</Code> + shared <Code>PicklistCard</Code>,
          per-user text-size accessibility toggle, first vitest suite.
        </Li>
      </Ul>

      <H2>v3 — Finance add-on (0040)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>finance_docs</Code> (8 kinds, chain via{" "}
          <Code>parent_id</Code>, root <Code>sales_order_id</Code>, unique
          number per tenant); <Code>tenant_settings.finance_module</Code>{" "}
          (default off).
        </Li>
        <Li>
          <B>Permissions:</B> <Code>finance.view</Code> (all templates),{" "}
          <Code>finance.manage</Code> (Manager+).
        </Li>
        <Li>
          <B>Behavior:</B> O2C + P2P chains as data
          (<Code>lib/finance-kinds.ts</Code>), status machine
          draft→issued→settled/cancelled, count-based numbering, gated by the{" "}
          signed <Code>finance</Code> deployment entitlement.
        </Li>
      </Ul>

      <H2>v3.1 — Finance streamlining (0041)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>finance_docs.reminder_stage /
          last_reminder_at / intercompany_deal_id / counterpart_doc_id</Code>;{" "}
          <Code>tenant_settings.invoice_reminder_days / invoice_due_days /
          auto_complete_project_on_paid / interco_auto_mirror</Code>;{" "}
          <Code>finance_doc</Code> added to the attachable + activity enums.
        </Li>
        <Li>
          <B>Behavior:</B> document detail pages (chain, attachments,
          activity), project Billing tab with one-click milestone invoicing,
          proof-gated receipts/payments, in-app reminder stages, intercompany
          invoice auto-mirror, auto-complete project on fully paid, billed
          margin on the forecast.
        </Li>
      </Ul>

      <H2>v3.2 — Finance hardening (0042)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>finance_docs.counterpart_number</Code>{" "}
          (denormalized — RLS blocks the cross-tenant join);{" "}
          <Code>finance_docs_live_milestone_uq</Code> partial unique index
          (one live invoice per milestone).
        </Li>
        <Li>
          <B>Behavior (post adversarial review):</B> compare-and-set status
          transitions; payments must be &gt; 0 against an issued parent;
          settlement only when cumulative payments cover the amount (partial
          payments tracked); manual settle runs the milestone/project side
          effects; cancel compensation (milestone freed / parent un-settled);
          atomic interco mirror with partner-module + declined-handshake
          checks and a visible failure trail; payment-proof deletion blocked;
          source-list endpoint tightened to <Code>finance.manage</Code>;
          mint retries in savepoints.
        </Li>
      </Ul>

      <H2>v3.3 — Internal documentation (0043)</H2>
      <Ul>
        <Li>
          <B>Schema:</B>{" "}
          <Code>tenant_settings.documentation_module</Code> (default on).
        </Li>
        <Li>
          <B>Permissions:</B> <Code>docs.view</Code> — Owner/Admin only by
          default, deliberately absent from all other templates.
        </Li>
        <Li>
          <B>Behavior:</B> this standalone documentation site (no nav link —
          URL only), full-text ⌘K search, zoomable/full-screen Mermaid flow
          maps, generated schema reference
          (<Code>npm run docs:schema</Code>), per-version changelog.
        </Li>
      </Ul>

      <H2>v4 — Multi-party intercompany + permission UX (0044–0046)</H2>
      <Ul>
        <Li>
          <B>Schema:</B> <Code>user.last_login_at</Code>; new{" "}
          <Code>intercompany_deal_parties</Code> junction table (
          <Code>funnel_id, partner_entity_id, share_type
          (percent | amount), share_value, currency, manual_fx_rate</Code>) —
          replaces the old <Code>funnels.handling_partner_entity_id /
          handling_partner_name / interco_leg_amount</Code> scalar columns, so
          a deal can now split across multiple sibling entities (capped at
          10) instead of exactly one.{" "}
          <Code>intercompany_deals</Code> becomes one mirror row per{" "}
          <Code>(opportunity, partner)</Code> pair, carrying that party&apos;s own{" "}
          <Code>share_type / share_value / partner_currency /
          manual_fx_rate</Code> instead of a single origin-side{" "}
          <Code>recognized_percent</Code> complement.{" "}
          <Code>funnels.recognized_percent</Code> stays, now a cache of
          the origin&apos;s remainder after every party&apos;s share. This is the one
          deliberately destructive migration in the project&apos;s history — the
          usual additive/no-rename practice below didn&apos;t fit a genuine 2-to-N
          shape change; the migration backfills existing 1-partner deals into
          the new table before dropping the old columns.
        </Li>
        <Li>
          <B>Behavior:</B> N-party share math is independent per party (not a
          complement — see <Code>lib/interco-share.ts</Code>{" "}
          <Code>partyShare</Code> / <Code>validatePartyShares</Code> /{" "}
          <Code>deriveOriginRecognizedPercent</Code>); the billing auto-mirror
          loops over parties minting one document pair per party; the funnel
          form gained a repeatable party editor; permission-denial toasts
          (<Code>runAction</Code>) now resolve and name a contact — the
          user&apos;s manager or an Owner/Admin — instead of surfacing a raw{" "}
          <Code>FORBIDDEN: ...</Code> string.
        </Li>
      </Ul>

      <H2>Versioning practice</H2>
      <Ul>
        <Li>
          <B>Migrations are additive</B> — destructive renames are avoided
          (e.g. the line-discount column kept its legacy name when its meaning
          widened). Backfills ship inside the migration or the deploy-time
          reconciler.
        </Li>
        <Li>
          <B>Deploy = migrate + resync.</B> <Code>db/migrate.ts</Code> runs
          migrations, reapplies <Code>rls.sql</Code> and{" "}
          <Code>views.sql</Code>, re-syncs the permission catalog into every
          tenant, and reconciles intercompany mirrors — all idempotent.
        </Li>
        <Li>
          <B>Add-ons ship dark.</B> New modules land behind a per-tenant flag
          defaulting off (finance) or on (documentation), so deploying is
          decoupled from enabling.
        </Li>
        <Li>
          <B>Docs move with the code.</B> When a version adds schema or
          settings, this changelog, the{" "}
          <Link className="link" href="/documentation/settings-reference">
            settings reference
          </Link>{" "}
          and the generated{" "}
          <Link className="link" href="/documentation/schema-reference">
            schema reference
          </Link>{" "}
          are updated in the same change.
        </Li>
      </Ul>
    </>
  ),
}
