/** @jsxImportSource hono/jsx */
import { MODULE_CATALOG, type ContractDetail } from "../repos/contracts"
import type { ClientDetail, ClientListItem, PageResult } from "../repos/clients"
import { OperatorLayout } from "./layout"

export function Dashboard(props: { operatorEmail: string }) {
  return (
    <OperatorLayout title="Dashboard">
      <h1>Control plane</h1>
      <p>Signed in as {props.operatorEmail}</p>
      <p><a href="/operator/clients">Manage clients</a></p>
    </OperatorLayout>
  )
}

function CsrfInput(props: { token: string }) {
  return <input type="hidden" name="_csrf" value={props.token} />
}

export function ClientList(props: { clients: ClientListItem[]; page: number; pageSize: number; csrfToken: string }) {
  return (
    <OperatorLayout title="Clients">
      <h1>Clients</h1>
      <section><h2>Create client</h2><form method="post" action="/operator/clients">
        <CsrfInput token={props.csrfToken} />
        <label>Stable key <input name="clientKey" required maxLength={64} /></label>
        <label>Display name <input name="displayName" required maxLength={160} /></label>
        <button type="submit">Create client</button>
      </form></section>
      <section><h2>Customer accounts</h2><ul>
        {props.clients.map((client) => (
          <li><a href={`/operator/clients/${client.id}`}>{client.displayName}</a> ({client.clientKey})</li>
        ))}
      </ul></section>
      <p>Page {props.page}; maximum {props.pageSize} rows.</p>
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
      {props.collection.page > 1 ? (
        <a href={href(props.collection.page - 1)}>Previous</a>
      ) : null}
      {props.collection.hasNext ? (
        <a href={href(props.collection.page + 1)}>Next</a>
      ) : null}
    </nav>
  )
}

export function ClientPage(props: { client: ClientDetail; csrfToken: string }) {
  const client = props.client
  const childPagination = {
    organisations: client.organisations,
    deployments: client.deployments,
    contracts: client.contracts,
  }
  return (
    <OperatorLayout title={client.displayName}>
      <h1>{client.displayName}</h1>
      <p>Stable key: <span class="mono">{client.clientKey}</span> · <span class={`badge ${client.status}`}>{client.status}</span></p>

      <section>
        <h2>Organisations</h2>
        <table><thead><tr><th>Tenant</th><th>Key</th></tr></thead><tbody>{client.organisations.items.map((item) => <tr><td>{item.displayName}</td><td class="mono">{item.organisationKey}</td></tr>)}</tbody></table>
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="organisations" collection={client.organisations} preserved={childPagination} />
        <form method="post" action={`/operator/clients/${client.id}/organisations`}>
          <CsrfInput token={props.csrfToken} />
          <input name="organisationKey" required placeholder="stable-key" />
          <input name="displayName" required placeholder="Display name" />
          <textarea name="metadataJson" required>{"{}"}</textarea>
          <button type="submit">Add organisation</button>
        </form>
      </section>

      <section>
        <h2>Deployments</h2>
        <table><thead><tr><th>Deployment</th><th>Status</th><th>Health</th><th>Seats</th><th>Versions</th><th>Last seen / backup</th></tr></thead><tbody>{client.deployments.items.map((item) => <tr><td><strong>{item.deploymentKey}</strong><div class="muted">{item.environment}</div></td><td><span class={`badge ${item.status}`}>{item.status}</span></td><td><span class={`badge ${item.healthStatus ?? "unknown"}`}>{item.healthStatus ?? "not registered"}</span></td><td>{item.occupiedSeats ?? "—"}</td><td><div>App {item.applicationVersion ?? "—"}</div><div>Agent {item.agentVersion ?? "—"}</div><div class="mono">{item.imageDigest ?? "No digest reported"}</div><div>Entitlement {item.entitlementVersion ?? "—"}</div></td><td><div>{item.observedAt ?? "Never"}</div><div class="muted">Backup {item.lastSuccessfulBackupAt ?? "Never"}</div></td></tr>)}</tbody></table>
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="deployments" collection={client.deployments} preserved={childPagination} />
        <form method="post" action={`/operator/clients/${client.id}/deployments`}>
          <CsrfInput token={props.csrfToken} />
          <input name="deploymentKey" required placeholder="stable-key" />
          <select name="environment"><option>development</option><option>staging</option><option>production</option></select>
          <select name="status"><option>active</option><option>disabled</option></select>
          <button type="submit">Add deployment</button>
        </form>
      </section>

      <section>
        <h2>Contracts</h2>
        <table><thead><tr><th>Term</th><th>Status</th><th>Seats</th></tr></thead><tbody>{client.contracts.items.map((item) => <tr><td><a href={`/operator/contracts/${item.id}`}>{item.startsAt} – {item.endsAt}</a></td><td><span class={`badge ${item.status}`}>{item.status}</span></td><td>{item.seatLimit}</td></tr>)}</tbody></table>
        <CollectionPager basePath={`/operator/clients/${client.id}`} name="contracts" collection={client.contracts} preserved={childPagination} />
        <h3>Create contract</h3>
        <form class="actions" method="post" action={`/operator/clients/${client.id}/contracts`}>
          <CsrfInput token={props.csrfToken} />
          <label>Plan ID<input name="planId" required placeholder="quandatics-demo" /></label>
          <label>Status<select name="status"><option>active</option><option>past_due</option><option>suspended</option><option>cancelled</option></select></label>
          <label>Start date<input name="startsAt" required type="date" /></label>
          <label>End date<input name="endsAt" required type="date" /></label>
          <label>Seat limit<input name="seatLimit" required type="number" min="1" max="100000" step="1" value="4" /></label>
          <label>Monthly seat price (cents)<input name="monthlySeatPriceCents" required type="number" min="0" step="1" value="0" /><small>10000 = 100.00</small></label>
          <label>Tax (basis points)<input name="taxBasisPoints" required type="number" min="0" max="10000" step="1" value="0" /><small>800 = 8%; 0 = no tax</small></label>
          <label>Collection frequency<select name="collectionFrequency"><option>monthly</option><option>upfront</option></select></label>
          <fieldset>
            <legend>Modules</legend>
            {Object.entries(MODULE_CATALOG).map(([moduleId, module]) => (
              <label><input type="checkbox" name="moduleIds" value={moduleId} /> {module.displayName}</label>
            ))}
          </fieldset>
          <button type="submit">Create contract</button>
        </form>
      </section>
    </OperatorLayout>
  )
}

export function ContractPage(props: { contract: ContractDetail; csrfToken: string }) {
  const contract = props.contract
  return (
    <OperatorLayout title="Contract">
      <h1>Contract</h1>
      <section><h2>License</h2><p><span class={`badge ${contract.status}`}>{contract.status}</span> · {contract.startsAt} – {contract.endsAt} · {contract.seatLimit} seats · revision {contract.entitlementRevision}</p><p>Renewal: {contract.renewalPolicy} · Suspension: {contract.suspensionAt ?? "not scheduled"}</p><p>Modules: {contract.modules.join(", ") || "none"}</p></section>
      <section><h2>Edit contract</h2><form class="actions" method="post" action={`/operator/contracts/${contract.id}`}><CsrfInput token={props.csrfToken} /><label>Plan ID<input name="planId" required value={contract.planId} /></label><label>Status<select name="status">{["active", "past_due", "suspended", "cancelled"].map((status) => <option selected={contract.status === status}>{status}</option>)}</select></label><label>Start date<input name="startsAt" required type="date" value={contract.startsAt} /></label><label>End date<input name="endsAt" required type="date" value={contract.endsAt} /></label><label>Seat limit<input name="seatLimit" required type="number" min="1" max="100000" value={contract.seatLimit} /></label><label>Monthly seat price (cents)<input name="monthlySeatPriceCents" required type="number" min="0" value={contract.monthlySeatPriceCents} /></label><label>Tax (basis points)<input name="taxBasisPoints" required type="number" min="0" max="10000" value={contract.taxBasisPoints} /><small>800 = 8%</small></label><label>Collection frequency<select name="collectionFrequency"><option selected={contract.collectionFrequency === "monthly"}>monthly</option><option selected={contract.collectionFrequency === "upfront"}>upfront</option></select></label><fieldset><legend>Licensed modules</legend>{Object.entries(MODULE_CATALOG).map(([moduleId, module]) => <label><input type="checkbox" name="moduleIds" value={moduleId} checked={contract.modules.includes(moduleId)} /> {module.displayName}</label>)}</fieldset><label><input type="checkbox" name="confirmCommercialState" value="confirmed" /> Confirm suspension/cancellation</label><button type="submit">Save contract</button></form></section>
      <h2>Invoices</h2>
      <ul>{contract.invoices.items.map((invoice) => <li>{invoice.invoiceNumber}: {invoice.totalCents} {invoice.currency} cents</li>)}</ul>
      <CollectionPager basePath={`/operator/contracts/${contract.id}`} name="invoices" collection={contract.invoices} preserved={{ invoices: contract.invoices }} />
      <form method="post" action={`/operator/contracts/${contract.id}/invoices`}>
        <CsrfInput token={props.csrfToken} />
        <input name="invoiceNumber" required placeholder="Invoice number" />
        <select name="status"><option>draft</option><option>issued</option><option>paid</option><option>void</option></select>
        <input name="issuedAt" required placeholder="2026-08-10T00:00:00.000Z" />
        <input name="dueAt" required placeholder="2026-08-31T00:00:00.000Z" />
        <input name="currency" required maxLength={3} value="MYR" />
        <input name="totalCents" required type="number" min="0" step="1" />
        <select name="collectionFrequency"><option>monthly</option><option>upfront</option></select>
        <input name="billingPeriods" required type="number" min="1" max="1200" step="1" />
        <input name="firstDueAt" required type="date" />
        <input name="weights" required placeholder="1,1,1" />
        <button type="submit">Issue invoice</button>
      </form>
      <section><h2>Recent audit</h2><table><thead><tr><th>Time</th><th>Action</th><th>Outcome</th></tr></thead><tbody>{contract.audit.map((entry) => <tr><td>{entry.createdAt}</td><td>{entry.action}</td><td><span class={`badge ${entry.outcome}`}>{entry.outcome}</span></td></tr>)}</tbody></table></section>
    </OperatorLayout>
  )
}
