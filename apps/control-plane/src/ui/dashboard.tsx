/** @jsxImportSource hono/jsx */
import { MODULE_CATALOG, type ContractDetail } from "../repos/contracts"
import type { ClientDetail, ClientListItem, DashboardSummary, PageResult } from "../repos/clients"
import { Button, Card, DataList, EmptyState, Field, NoticePanel, PageHeader, ProgressSteps, StatusBadge, type NoticeTone, type StatusTone } from "./components"
import { statusTone, titleCase } from "./presenters"
import { OperatorLayout } from "./layout"

export interface OperatorNotice {
  tone: NoticeTone
  title: string
  message: string
}

export function Dashboard(props: { operatorEmail: string; summary: DashboardSummary; notice?: OperatorNotice }) {
  const { summary } = props
  return (
    <OperatorLayout title="Dashboard" operatorEmail={props.operatorEmail}>
      <PageHeader
        eyebrow="Operations overview"
        title="Client portfolio"
        description="Review customer setup and resolve work that needs an operator."
        actions={<a class="button-link" href="/operator/clients#new-client">Create client</a>}
      />
      <NoticePanel notice={props.notice} />
      <div class="summary-cards" aria-label="Portfolio summary">
        <Card title="Clients">
          <p class="summary-value">{summary.activeClientCount}</p>
          <p>{summary.activeClientCount === 1 ? "active client record" : "active client records"}</p>
        </Card>
        <Card title="Deployments">
          <p class="summary-value">{summary.deploymentCount}</p>
          <p>{summary.deploymentCount === 1 ? "deployment" : "deployments"}</p>
        </Card>
      </div>
      <section class="dashboard-section" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        {summary.attentionItems.length === 0 ? (
          <EmptyState title="Nothing needs attention">Contracts and deployments are in a healthy state.</EmptyState>
        ) : (
          <div class="attention-list">
            {summary.attentionItems.map((item) => (
              <article class="attention-item">
                <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                <div>
                  <h3><a href={item.href}>{item.title}</a></h3>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </OperatorLayout>
  )
}

export function ClientList(props: {
  clients: ClientListItem[]
  page: number
  pageSize: number
  operatorEmail: string
  notice?: OperatorNotice
}) {
  return (
    <OperatorLayout title="Clients" operatorEmail={props.operatorEmail}>
      <PageHeader
        eyebrow="Client administration"
        title="Clients"
        description="Create a customer record, then add its contract before setting up a deployment."
        actions={<a class="button-link" href="#new-client">Create client</a>}
      />
      <NoticePanel notice={props.notice} />
      <section id="new-client" class="form-section" aria-label="Create client">
        <Card title="Create client">
          <p>Start each onboarding flow with the customer account.</p>
          <form class="form-grid" method="post" action="/operator/clients">
            <Field name="clientKey" label="Stable key" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="acme" title="Lowercase letters, numbers, underscores, and hyphens only." hint={<>Example: <code>acme</code>. Used in internal references and cannot be changed later.</>} />
            <Field name="displayName" label="Display name" required maxLength={160} placeholder="Acme Services" hint="Name operators recognise in this control plane." />
            <div><Button type="submit">Create client</Button></div>
          </form>
        </Card>
      </section>
      <section class="dashboard-section" aria-labelledby="client-list-heading">
        <h2 id="client-list-heading">Client records</h2>
        {props.clients.length === 0 ? (
          <EmptyState title="No clients yet" action={{ href: "/operator/clients#new-client", label: "Create client" }}>
            Create a customer record to begin contract and deployment setup.
          </EmptyState>
        ) : (
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th scope="col">Client</th><th scope="col">Stable key</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {props.clients.map((client) => (
                  <tr>
                    <th scope="row"><a href={`/operator/clients/${client.id}`}>{client.displayName}</a></th>
                    <td><code>{client.clientKey}</code></td>
                    <td><StatusBadge tone={statusTone(client.status)}>{titleCase(client.status)}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p class="field-hint">Page {props.page}; maximum {props.pageSize} rows.</p>
      </section>
    </OperatorLayout>
  )
}

function CollectionPager(props: {
  basePath: string
  name: string
  collection: Pick<PageResult<unknown>, "page" | "pageSize" | "hasNext">
  preserved: Record<string, Pick<PageResult<unknown>, "page" | "pageSize">>
}) {
  const href = (page: number) => {
    const parameters = new URLSearchParams()
    for (const [name, collection] of Object.entries(props.preserved)) {
      parameters.set(`${name}Page`, String(name === props.name ? page : collection.page))
      parameters.set(`${name}PageSize`, String(collection.pageSize))
    }
    return `${props.basePath}?${parameters.toString()}`
  }
  return (
    <nav aria-label={`${props.name} pagination`}>
      {props.collection.page > 1 ? <a href={href(props.collection.page - 1)}>Previous</a> : null}
      {props.collection.hasNext ? <a href={href(props.collection.page + 1)}>Next</a> : null}
    </nav>
  )
}

export function ClientPage(props: { client: ClientDetail; operatorEmail: string; notice?: OperatorNotice }) {
  const client = props.client
  const childPagination = {
    organisations: client.organisations,
    deployments: client.deployments,
    contracts: client.contracts,
  }
  const hasContract = client.contracts.hasAny
  const hasDeployment = client.deployments.hasAny
  return (
    <OperatorLayout title={client.displayName} operatorEmail={props.operatorEmail}>
      <PageHeader
        eyebrow="Client workspace"
        title={client.displayName}
        description={`Stable key: ${client.clientKey}`}
        actions={<StatusBadge tone={statusTone(client.status)}>{titleCase(client.status)}</StatusBadge>}
      />
      <NoticePanel notice={props.notice} />
      <ProgressSteps
        label="Client onboarding"
        steps={[
          { label: "Client", state: "complete", href: `/operator/clients/${client.id}` },
          { label: "Contract", state: hasContract ? "complete" : "current" },
          { label: "Deployment", state: hasDeployment ? "complete" : hasContract ? "current" : "upcoming" },
        ]}
      />

      <section class="workspace-section" aria-labelledby="contracts-heading">
        <h2 id="contracts-heading">Contracts</h2>
        <Card title="Add contract" headingLevel={3}>
          <p>Set commercial terms before configuring deployment access.</p>
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/contracts`}>
            <Field name="planId" label="Plan ID" required placeholder="plan-basic" hint="Use an existing plan identifier." />
            <Field name="status" label="Status" required options={["active", "past_due", "suspended", "cancelled"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="startsAt" label="Starts on" required type="date" />
            <Field name="endsAt" label="Ends on" required type="date" />
            <Field name="seatLimit" label="Seat limit" required type="number" min={1} max={100000} step={1} placeholder="25" />
            <Field name="monthlySeatPriceCents" label="Monthly seat price, cents" required type="number" min={0} step={1} placeholder="25000" />
            <Field name="taxBasisPoints" label="Tax, basis points" required type="number" min={0} max={10000} step={1} placeholder="600" />
            <Field name="collectionFrequency" label="Collection frequency" required options={["monthly", "upfront"].map((value) => ({ value, label: titleCase(value) }))} />
            <fieldset class="module-fieldset">
              <legend>Modules</legend>
              <p class="field-hint">Select the modules covered by this contract.</p>
              {Object.entries(MODULE_CATALOG).map(([moduleId, module]) => <label><input type="checkbox" name="moduleIds" value={moduleId} /> {module.displayName}</label>)}
            </fieldset>
            <div><Button type="submit">Add contract</Button></div>
          </form>
        </Card>
        {!client.contracts.hasAny ? (
          <EmptyState title="No contracts yet">Add contract terms before creating a deployment.</EmptyState>
        ) : client.contracts.items.length === 0 ? (
          <p class="field-hint">No contracts on this page.</p>
        ) : (
          <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Term</th><th scope="col">Seats</th><th scope="col">Status</th></tr></thead><tbody>{client.contracts.items.map((item) => <tr><th scope="row"><a href={`/operator/contracts/${item.id}`}>{item.startsAt} to {item.endsAt}</a></th><td>{item.seatLimit}</td><td><StatusBadge tone={statusTone(item.status)}>{titleCase(item.status)}</StatusBadge></td></tr>)}</tbody></table></div>
        )}
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="contracts" collection={client.contracts} preserved={childPagination} />
      </section>

      <section class="workspace-section" aria-labelledby="deployments-heading">
        <h2 id="deployments-heading">Deployments</h2>
        <Card title="Add deployment" headingLevel={3}>
          <p>Connect this client to an environment after its contract is in place.</p>
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/deployments`}>
            <Field name="deploymentKey" label="Deployment key" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="acme-production" title="Lowercase letters, numbers, underscores, and hyphens only." hint={<>Example: <code>acme-production</code>. This key is unique across deployments.</>} />
            <Field name="environment" label="Environment" required options={["development", "staging", "production"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="status" label="Status" required options={["active", "disabled"].map((value) => ({ value, label: titleCase(value) }))} />
            <div><Button type="submit">Add deployment</Button></div>
          </form>
        </Card>
        {!client.deployments.hasAny ? (
          <EmptyState title="No deployments yet">Create a deployment after contract terms are confirmed.</EmptyState>
        ) : client.deployments.items.length === 0 ? (
          <p class="field-hint">No deployments on this page.</p>
        ) : (
          <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Deployment</th><th scope="col">Environment</th><th scope="col">Status</th></tr></thead><tbody>{client.deployments.items.map((item) => <tr><th scope="row"><a href={item.href}>{item.deploymentKey}</a></th><td>{item.environment}</td><td><StatusBadge tone={statusTone(item.status)}>{titleCase(item.status)}</StatusBadge></td></tr>)}</tbody></table></div>
        )}
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="deployments" collection={client.deployments} preserved={childPagination} />
      </section>

      <section class="workspace-section secondary-section" aria-labelledby="organisations-heading">
        <h2 id="organisations-heading">Organisations</h2>
        <p class="section-description">Optional organisation details do not block contract or deployment onboarding.</p>
        <Card title="Add organisation" headingLevel={3}>
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/organisations`}>
            <Field name="organisationKey" label="Organisation key" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="hq" title="Lowercase letters, numbers, underscores, and hyphens only." hint={<>Example: <code>hq</code>.</>} />
            <Field name="displayName" label="Display name" required maxLength={160} placeholder="Headquarters" />
            <Field name="metadataJson" label="Metadata JSON" textarea required defaultValue="{}" hint={<>Provide one JSON object, for example <code>{'{"region":"my"}'}</code>.</>} />
            <div><Button type="submit">Add organisation</Button></div>
          </form>
        </Card>
        {!client.organisations.hasAny ? (
          <EmptyState title="No organisations yet">Add these optional records when account structure needs them.</EmptyState>
        ) : client.organisations.items.length === 0 ? (
          <p class="field-hint">No organisations on this page.</p>
        ) : (
          <DataList items={client.organisations.items.map((item) => ({ term: item.displayName, details: <code>{item.organisationKey}</code> }))} />
        )}
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="organisations" collection={client.organisations} preserved={childPagination} />
      </section>
    </OperatorLayout>
  )
}

export function ContractPage(props: { contract: ContractDetail; operatorEmail: string; notice?: OperatorNotice }) {
  const contract = props.contract
  return (
    <OperatorLayout title="Contract" operatorEmail={props.operatorEmail}>
      <PageHeader eyebrow="Billing" title="Contract" description={`${contract.startsAt} to ${contract.endsAt}; ${contract.seatLimit} seats; ${contract.totalCents} cents.`} />
      <NoticePanel notice={props.notice} />
      <section class="workspace-section" aria-labelledby="contract-terms-heading">
        <h2 id="contract-terms-heading">Contract terms</h2>
        <Card title="Edit commercial terms" headingLevel={3}>
          <p>Changing terms bumps the entitlement revision, so the deployment must receive a freshly signed entitlement version.</p>
          <form class="form-grid" method="post" action={`/operator/contracts/${contract.id}/edit`}>
            <Field name="planId" label="Plan ID" required placeholder="plan-basic" value={contract.planId} />
            <Field name="status" label="Status" required options={["active", "past_due", "suspended", "cancelled"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="startsAt" label="Starts on" required type="date" value={contract.startsAt} />
            <Field name="endsAt" label="Ends on" required type="date" value={contract.endsAt} />
            <Field name="seatLimit" label="Seat limit" required type="number" min={1} max={100000} step={1} value={contract.seatLimit} />
            <Field name="monthlySeatPriceCents" label="Monthly seat price, cents" required type="number" min={0} step={1} value={contract.monthlySeatPriceCents} />
            <Field name="taxBasisPoints" label="Tax, basis points" required type="number" min={0} max={10000} step={1} value={contract.taxBasisPoints} />
            <Field name="collectionFrequency" label="Collection frequency" required options={["monthly", "upfront"].map((value) => ({ value, label: titleCase(value) }))} />
            <fieldset class="module-fieldset">
              <legend>Modules</legend>
              <p class="field-hint">Select the modules covered by this contract.</p>
              {Object.entries(MODULE_CATALOG).map(([moduleId, module]) => <label><input type="checkbox" name="moduleIds" value={moduleId} checked={contract.modules.some((item) => item.id === moduleId)} /> {module.displayName}</label>)}
            </fieldset>
            <div><Button type="submit">Save contract terms</Button></div>
          </form>
        </Card>
      </section>
      <section class="workspace-section" aria-labelledby="entitlement-controls-heading">
        <h2 id="entitlement-controls-heading">Entitlement controls</h2>
        <Card title="Subscription control" headingLevel={3}>
          <p>Changes here also bump the entitlement revision and are picked up by the renewal cycle.</p>
          <form class="form-grid" method="post" action={`/operator/contracts/${contract.id}/entitlement-controls`}>
            <Field name="status" label="Subscription status" required options={["active", "past_due", "suspended", "cancelled"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="renewalPolicy" label="Renewal policy" required options={["auto_renew", "non_renewing"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="suspensionAt" label="Schedule suspension at" type="datetime-local" hint="Leave empty to clear a scheduled suspension." />
            <Field name="seatLimit" label="Seat limit" type="number" min={1} max={100000} step={1} value={contract.scheduledSeatLimit ?? contract.seatLimit} hint="A lower limit applies immediately; a higher limit requires the current heartbeat to confirm enough free seats." />
            <Field name="effectiveAt" label="Effective at (UTC)" type="datetime-local" hint="Optional future-dated change. Leave empty to apply now." />
            <div><Button type="submit">Save entitlement controls</Button></div>
          </form>
        </Card>
      </section>
      <section class="workspace-section" aria-labelledby="invoices-heading">
        <h2 id="invoices-heading">Invoices</h2>
        <Card title="Issue invoice">
          <form class="form-grid" method="post" action={`/operator/contracts/${contract.id}/invoices`}>
            <Field name="invoiceNumber" label="Invoice number" required placeholder="INV-2026-001" />
            <Field name="status" label="Status" required options={["draft", "issued", "paid", "void"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="issuedAt" label="Issued at" required placeholder="2026-08-10T00:00:00.000Z" />
            <Field name="dueAt" label="Due at" required placeholder="2026-08-31T00:00:00.000Z" />
            <Field name="currency" label="Currency" required maxLength={3} value="MYR" pattern="[A-Z]{3}" />
            <Field name="totalCents" label="Total, cents" required type="number" min={0} step={1} placeholder="75000" />
            <Field name="collectionFrequency" label="Collection frequency" required options={["monthly", "upfront"].map((value) => ({ value, label: titleCase(value) }))} />
            <Field name="billingPeriods" label="Billing periods" required type="number" min={1} max={1200} step={1} placeholder="3" />
            <Field name="firstDueAt" label="First due date" required type="date" />
            <Field name="weights" label="Period weights" required placeholder="1,1,1" hint="One positive weight per billing period." />
            <div><Button type="submit">Issue invoice</Button></div>
          </form>
        </Card>
        {contract.invoices.items.length === 0 ? <EmptyState title="No invoices yet">Issue an invoice when this contract is ready for collection.</EmptyState> : <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead><tbody>{contract.invoices.items.map((invoice) => <tr><th scope="row">{invoice.invoiceNumber}</th><td>{invoice.totalCents} {invoice.currency} cents</td><td><StatusBadge tone={statusTone(invoice.status)}>{titleCase(invoice.status)}</StatusBadge></td></tr>)}</tbody></table></div>}
        <CollectionPager basePath={`/operator/contracts/${contract.id}`} name="invoices" collection={contract.invoices} preserved={{ invoices: contract.invoices }} />
      </section>
    </OperatorLayout>
  )
}
