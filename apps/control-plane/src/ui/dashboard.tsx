/** @jsxImportSource hono/jsx */
import { MODULE_CATALOG, type ContractDetail } from "../repos/contracts"
import type { ClientDetail, ClientListItem, DashboardSummary, PageResult } from "../repos/clients"
import { Card, DataList, EmptyState, Notice, PageHeader, ProgressSteps, StatusBadge, type NoticeTone, type StatusTone } from "./components"
import { OperatorLayout } from "./layout"

export interface OperatorNotice {
  tone: NoticeTone
  title: string
  message: string
}

function statusTone(status: string): StatusTone {
  if (status === "active") return "success"
  if (status === "past_due") return "warning"
  if (status === "suspended" || status === "cancelled" || status === "disabled") return "error"
  return "neutral"
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function NoticePanel(props: { notice?: OperatorNotice }) {
  return props.notice ? <Notice tone={props.notice.tone} title={props.notice.title}>{props.notice.message}</Notice> : null
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
            <div class="field">
              <label for="client-key">Stable key</label>
              <input id="client-key" name="clientKey" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="acme" title="Lowercase letters, numbers, underscores, and hyphens only." />
              <p class="field-hint">Example: <code>acme</code>. Used in internal references and cannot be changed later.</p>
            </div>
            <div class="field">
              <label for="client-display-name">Display name</label>
              <input id="client-display-name" name="displayName" required maxLength={160} placeholder="Acme Services" />
              <p class="field-hint">Name operators recognise in this control plane.</p>
            </div>
            <div><button type="submit">Create client</button></div>
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
                    <td><StatusBadge tone={statusTone(client.status)}>{statusLabel(client.status)}</StatusBadge></td>
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
  const hasContract = client.contracts.items.length > 0
  const hasDeployment = client.deployments.items.length > 0
  return (
    <OperatorLayout title={client.displayName} operatorEmail={props.operatorEmail}>
      <PageHeader
        eyebrow="Client workspace"
        title={client.displayName}
        description={`Stable key: ${client.clientKey}`}
        actions={<StatusBadge tone={statusTone(client.status)}>{statusLabel(client.status)}</StatusBadge>}
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
        <Card title="Add contract">
          <p>Set commercial terms before configuring deployment access.</p>
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/contracts`}>
            <div class="field"><label for="plan-id">Plan ID</label><input id="plan-id" name="planId" required placeholder="plan-basic" /><p class="field-hint">Use an existing plan identifier.</p></div>
            <div class="field"><label for="contract-status">Status</label><select id="contract-status" name="status"><option>active</option><option>past_due</option><option>suspended</option><option>cancelled</option></select></div>
            <div class="field"><label for="starts-at">Starts on</label><input id="starts-at" name="startsAt" required type="date" /></div>
            <div class="field"><label for="ends-at">Ends on</label><input id="ends-at" name="endsAt" required type="date" /></div>
            <div class="field"><label for="seat-limit">Seat limit</label><input id="seat-limit" name="seatLimit" required type="number" min="1" max="100000" step="1" placeholder="25" /></div>
            <div class="field"><label for="monthly-seat-price">Monthly seat price, cents</label><input id="monthly-seat-price" name="monthlySeatPriceCents" required type="number" min="0" step="1" placeholder="25000" /></div>
            <div class="field"><label for="tax-basis-points">Tax, basis points</label><input id="tax-basis-points" name="taxBasisPoints" required type="number" min="0" max="10000" step="1" placeholder="600" /></div>
            <div class="field"><label for="collection-frequency">Collection frequency</label><select id="collection-frequency" name="collectionFrequency"><option>monthly</option><option>upfront</option></select></div>
            <fieldset class="module-fieldset">
              <legend>Modules</legend>
              <p class="field-hint">Select the modules covered by this contract.</p>
              {Object.entries(MODULE_CATALOG).map(([moduleId, module]) => <label><input type="checkbox" name="moduleIds" value={moduleId} /> {module.displayName}</label>)}
            </fieldset>
            <div><button type="submit">Add contract</button></div>
          </form>
        </Card>
        {client.contracts.items.length === 0 ? (
          <EmptyState title="No contracts yet">Add contract terms before creating a deployment.</EmptyState>
        ) : (
          <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Term</th><th scope="col">Seats</th><th scope="col">Status</th></tr></thead><tbody>{client.contracts.items.map((item) => <tr><th scope="row"><a href={`/operator/contracts/${item.id}`}>{item.startsAt} to {item.endsAt}</a></th><td>{item.seatLimit}</td><td><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td></tr>)}</tbody></table></div>
        )}
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="contracts" collection={client.contracts} preserved={childPagination} />
      </section>

      <section class="workspace-section" aria-labelledby="deployments-heading">
        <h2 id="deployments-heading">Deployments</h2>
        <Card title="Add deployment">
          <p>Connect this client to an environment after its contract is in place.</p>
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/deployments`}>
            <div class="field"><label for="deployment-key">Deployment key</label><input id="deployment-key" name="deploymentKey" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="acme-production" title="Lowercase letters, numbers, underscores, and hyphens only." /><p class="field-hint">Example: <code>acme-production</code>. This key is unique across deployments.</p></div>
            <div class="field"><label for="deployment-environment">Environment</label><select id="deployment-environment" name="environment"><option>development</option><option>staging</option><option>production</option></select></div>
            <div class="field"><label for="deployment-status">Status</label><select id="deployment-status" name="status"><option>active</option><option>disabled</option></select></div>
            <div><button type="submit">Add deployment</button></div>
          </form>
        </Card>
        {client.deployments.items.length === 0 ? (
          <EmptyState title="No deployments yet">Create a deployment after contract terms are confirmed.</EmptyState>
        ) : (
          <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Deployment</th><th scope="col">Environment</th><th scope="col">Status</th></tr></thead><tbody>{client.deployments.items.map((item) => <tr><th scope="row"><a href={item.href}>{item.deploymentKey}</a></th><td>{item.environment}</td><td><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td></tr>)}</tbody></table></div>
        )}
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="deployments" collection={client.deployments} preserved={childPagination} />
      </section>

      <section class="workspace-section secondary-section" aria-labelledby="organisations-heading">
        <h2 id="organisations-heading">Organisations</h2>
        <p class="section-description">Optional organisation details do not block contract or deployment onboarding.</p>
        <Card title="Add organisation">
          <form class="form-grid" method="post" action={`/operator/clients/${client.id}/organisations`}>
            <div class="field"><label for="organisation-key">Organisation key</label><input id="organisation-key" name="organisationKey" required maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" placeholder="hq" title="Lowercase letters, numbers, underscores, and hyphens only." /><p class="field-hint">Example: <code>hq</code>.</p></div>
            <div class="field"><label for="organisation-display-name">Display name</label><input id="organisation-display-name" name="displayName" required maxLength={160} placeholder="Headquarters" /></div>
            <div class="field"><label for="organisation-metadata">Metadata JSON</label><textarea id="organisation-metadata" name="metadataJson" required>{"{}"}</textarea><p class="field-hint">Provide one JSON object, for example <code>{'{"region":"my"}'}</code>.</p></div>
            <div><button type="submit">Add organisation</button></div>
          </form>
        </Card>
        {client.organisations.items.length === 0 ? (
          <EmptyState title="No organisations yet">Add these optional records when account structure needs them.</EmptyState>
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
      <section class="workspace-section" aria-labelledby="invoices-heading">
        <h2 id="invoices-heading">Invoices</h2>
        <Card title="Issue invoice">
          <form class="form-grid" method="post" action={`/operator/contracts/${contract.id}/invoices`}>
            <div class="field"><label for="invoice-number">Invoice number</label><input id="invoice-number" name="invoiceNumber" required placeholder="INV-2026-001" /></div>
            <div class="field"><label for="invoice-status">Status</label><select id="invoice-status" name="status"><option>draft</option><option>issued</option><option>paid</option><option>void</option></select></div>
            <div class="field"><label for="issued-at">Issued at</label><input id="issued-at" name="issuedAt" required placeholder="2026-08-10T00:00:00.000Z" /></div>
            <div class="field"><label for="due-at">Due at</label><input id="due-at" name="dueAt" required placeholder="2026-08-31T00:00:00.000Z" /></div>
            <div class="field"><label for="invoice-currency">Currency</label><input id="invoice-currency" name="currency" required maxLength={3} value="MYR" pattern="[A-Z]{3}" /></div>
            <div class="field"><label for="invoice-total">Total, cents</label><input id="invoice-total" name="totalCents" required type="number" min="0" step="1" placeholder="75000" /></div>
            <div class="field"><label for="invoice-frequency">Collection frequency</label><select id="invoice-frequency" name="collectionFrequency"><option>monthly</option><option>upfront</option></select></div>
            <div class="field"><label for="billing-periods">Billing periods</label><input id="billing-periods" name="billingPeriods" required type="number" min="1" max="1200" step="1" placeholder="3" /></div>
            <div class="field"><label for="first-due-at">First due date</label><input id="first-due-at" name="firstDueAt" required type="date" /></div>
            <div class="field"><label for="invoice-weights">Period weights</label><input id="invoice-weights" name="weights" required placeholder="1,1,1" /><p class="field-hint">One positive weight per billing period.</p></div>
            <div><button type="submit">Issue invoice</button></div>
          </form>
        </Card>
        {contract.invoices.items.length === 0 ? <EmptyState title="No invoices yet">Issue an invoice when this contract is ready for collection.</EmptyState> : <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead><tbody>{contract.invoices.items.map((invoice) => <tr><th scope="row">{invoice.invoiceNumber}</th><td>{invoice.totalCents} {invoice.currency} cents</td><td><StatusBadge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</StatusBadge></td></tr>)}</tbody></table></div>}
        <CollectionPager basePath={`/operator/contracts/${contract.id}`} name="invoices" collection={contract.invoices} preserved={{ invoices: contract.invoices }} />
      </section>
    </OperatorLayout>
  )
}
