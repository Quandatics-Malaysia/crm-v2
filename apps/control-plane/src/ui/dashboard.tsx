/** @jsxImportSource hono/jsx */
import { MODULE_CATALOG, type ContractDetail } from "../repos/contracts"
import type { ClientDetail, ClientListItem } from "../repos/clients"
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

export function ClientList(props: { clients: ClientListItem[]; page: number; pageSize: number }) {
  return (
    <OperatorLayout title="Clients">
      <h1>Clients</h1>
      <form method="post" action="/operator/clients">
        <label>Stable key <input name="clientKey" required maxLength={64} /></label>
        <label>Display name <input name="displayName" required maxLength={160} /></label>
        <button type="submit">Create client</button>
      </form>
      <ul>
        {props.clients.map((client) => (
          <li><a href={`/operator/clients/${client.id}`}>{client.displayName}</a> ({client.clientKey})</li>
        ))}
      </ul>
      <p>Page {props.page}; maximum {props.pageSize} rows.</p>
    </OperatorLayout>
  )
}

export function ClientPage(props: { client: ClientDetail }) {
  const client = props.client
  return (
    <OperatorLayout title={client.displayName}>
      <h1>{client.displayName}</h1>
      <p>Stable key: {client.clientKey}</p>

      <section>
        <h2>Organisations</h2>
        <ul>{client.organisations.map((item) => <li>{item.displayName} ({item.organisationKey})</li>)}</ul>
        <form method="post" action={`/operator/clients/${client.id}/organisations`}>
          <input name="organisationKey" required placeholder="stable-key" />
          <input name="displayName" required placeholder="Display name" />
          <textarea name="metadataJson" required>{"{}"}</textarea>
          <button type="submit">Add organisation</button>
        </form>
      </section>

      <section>
        <h2>Deployments</h2>
        <ul>{client.deployments.map((item) => <li>{item.deploymentKey} ({item.environment})</li>)}</ul>
        <form method="post" action={`/operator/clients/${client.id}/deployments`}>
          <input name="deploymentKey" required placeholder="stable-key" />
          <select name="environment"><option>development</option><option>staging</option><option>production</option></select>
          <select name="status"><option>active</option><option>disabled</option></select>
          <button type="submit">Add deployment</button>
        </form>
      </section>

      <section>
        <h2>Contracts</h2>
        <ul>{client.contracts.map((item) => <li><a href={`/operator/contracts/${item.id}`}>{item.startsAt}–{item.endsAt}</a>, {item.seatLimit} seats</li>)}</ul>
        <form method="post" action={`/operator/clients/${client.id}/contracts`}>
          <input name="planId" required placeholder="Plan ID" />
          <select name="status"><option>active</option><option>past_due</option><option>suspended</option><option>cancelled</option></select>
          <input name="startsAt" required type="date" />
          <input name="endsAt" required type="date" />
          <input name="seatLimit" required type="number" min="1" max="100000" step="1" />
          <input name="monthlySeatPriceCents" required type="number" min="0" step="1" />
          <input name="taxBasisPoints" required type="number" min="0" max="10000" step="1" />
          <select name="collectionFrequency"><option>monthly</option><option>upfront</option></select>
          <fieldset>
            <legend>Modules</legend>
            {Object.entries(MODULE_CATALOG).map(([moduleId, module]) => (
              <label><input type="checkbox" name="moduleIds" value={moduleId} /> {module.displayName}</label>
            ))}
          </fieldset>
          <button type="submit">Add contract</button>
        </form>
      </section>
    </OperatorLayout>
  )
}

export function ContractPage(props: { contract: ContractDetail }) {
  const contract = props.contract
  return (
    <OperatorLayout title="Contract">
      <h1>Contract</h1>
      <p>{contract.startsAt}–{contract.endsAt}; {contract.seatLimit} seats; {contract.totalCents} cents.</p>
      <h2>Invoices</h2>
      <ul>{contract.invoices.map((invoice) => <li>{invoice.invoiceNumber}: {invoice.totalCents} {invoice.currency} cents</li>)}</ul>
      <form method="post" action={`/operator/contracts/${contract.id}/invoices`}>
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
    </OperatorLayout>
  )
}
