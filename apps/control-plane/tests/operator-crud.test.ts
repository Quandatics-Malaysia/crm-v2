import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { jsx } from "hono/jsx"
import { beforeAll, describe, expect, inject, it } from "vitest"
import { renderToString } from "hono/jsx/dom/server"

import {
  AccessTokenInvalidError,
  type AccessVerifier,
} from "../src/auth/access"
import { createApp } from "../src/index"
import {
  Card,
  DataList,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  ProgressSteps,
  StatusBadge,
} from "../src/ui/components"

const ownerSubject = `owner-${crypto.randomUUID()}`
const billingSubject = `billing-${crypto.randomUUID()}`
const billingOperatorId = crypto.randomUUID()
const clientKey = `client-${crypto.randomUUID()}`
const secondClientKey = `client-${crypto.randomUUID()}`
const deploymentKey = `deployment-${crypto.randomUUID()}`
const invoiceNumber = `INV-${crypto.randomUUID()}`
const hugeFiniteWeight = "1".padEnd(309, "0")
let clientId = ""
let secondClientId = ""
let contractId = ""

const accessVerifier: AccessVerifier = async (token) => {
  if (token === "owner-token") {
    return { subject: ownerSubject, email: "owner@example.com" }
  }
  if (token === "billing-token") {
    return { subject: billingSubject, email: "billing@example.com" }
  }
  throw new AccessTokenInvalidError()
}

const app = createApp({ accessVerifier })

function bindings(database: D1Database = env.CONTROL_DB): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
    OPERATOR_ORIGIN: "https://control.invalid",
  } as unknown as CloudflareBindings
}

function operatorRequest(
  path: string,
  options: {
    token?: "owner-token" | "billing-token"
    method?: "GET" | "POST"
    form?: Record<string, string | readonly string[]>
    json?: Record<string, unknown>
    origin?: string | null
    jsonGuard?: boolean
    accept?: string
    host?: string
    database?: D1Database
  } = {},
) {
  const method = options.method ?? "GET"
  const headers = new Headers({
    "Cf-Access-Jwt-Assertion": options.token ?? "owner-token",
  })
  let body: BodyInit | undefined

  if (options.form) {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(options.form)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        form.append(key, item)
      }
    }
    headers.set("Content-Type", "application/x-www-form-urlencoded")
    body = form
  } else if (options.json) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.json)
  }

  if (method === "POST" && options.origin !== null) {
    headers.set("Origin", options.origin ?? "https://control.invalid")
    headers.set("Sec-Fetch-Site", "same-origin")
  }
  if (options.jsonGuard) {
    headers.set("X-Control-Request", "same-origin")
  }
  if (options.accept) {
    headers.set("Accept", options.accept)
  }

  return app.fetch(
    new Request(`${options.host ?? "https://control.invalid"}${path}`, { method, headers, body }),
    bindings(options.database),
  )
}

function trackBatchSizes(batchSizes: number[]): D1Database {
  return new Proxy(env.CONTROL_DB, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          batchSizes.push(statements.length)
          return target.batch(statements)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

async function countRows(sql: string, value: string): Promise<number> {
  const row = await env.CONTROL_DB.prepare(sql).bind(value).first<{ count: number }>()
  return row?.count ?? 0
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])

  expect((await operatorRequest("/operator")).status).toBe(200)

  const now = new Date().toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
    ).bind(billingOperatorId, "billing@example.com", billingSubject, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, 'billing_operator', ?)",
    ).bind(billingOperatorId, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('plan-basic', 'basic', 'Basic', 1, ?, ?)",
    ).bind(now, now),
  ])
})

describe("operator mutation protection and client administration", () => {
  it("serves an accessible no-store operator shell and local stylesheet", async () => {
    const page = await operatorRequest("/operator")

    expect(page.status).toBe(200)
    expect(page.headers.get("Cache-Control")).toBe("no-store")
    const html = await page.text()
    expect(html).toContain('<link href="/operator/styles.css" rel="stylesheet"/>')
    expect(html).toContain('<a href="#operator-content" class="skip-link">Skip to content</a>')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('<p class="operator-identity">owner@example.com</p>')
    expect(html).toContain('aria-label="Breadcrumb"')

    const styles = await operatorRequest("/operator/styles.css")
    expect(styles.status).toBe(200)
    expect(styles.headers.get("Cache-Control")).toBe("no-store")
    expect(styles.headers.get("Content-Type")).toContain("text/css")
    expect(await styles.text()).toContain("--operator-space-4")
  })

  it("styles navigational links and selectable-control labels as touch targets", async () => {
    const styles = await operatorRequest("/operator/styles.css")
    const css = await styles.text()

    expect(css).toMatch(/\.operator-shell :is\(\.operator-brand, \.operator-navigation a, \.operator-breadcrumbs a, nav\[aria-label\$="pagination"\] a, \.button-link\) \{[^}]*display: inline-flex;[^}]*min-block-size: 2\.75rem;[^}]*\}/)
    expect(css).toMatch(/\.operator-shell label:has\(:is\(input\[type="checkbox"\], input\[type="radio"\]\)\) \{[^}]*min-block-size: 2\.75rem;[^}]*\}/)
    expect(css).toContain('.operator-shell :is(input[type="checkbox"], input[type="radio"])')
  })

  it("renders escaped semantic headers, status badges, and progress steps", () => {
    const html = renderToString([
      PageHeader({ title: "Workspace <admin>", eyebrow: "Signing", description: "Review details" }),
      StatusBadge({ tone: "success", children: "Active" }),
      ProgressSteps({
        label: "Signing progress",
        steps: [
          { label: "Client", state: "complete" },
          { label: "Contract", state: "current" },
          { label: "Review", state: "upcoming" },
        ],
      }),
    ])

    expect(html).toContain('<header class="page-header">')
    expect(html).toContain("Workspace &lt;admin&gt;")
    expect(html).toContain('class="status-badge status-badge-success"')
    expect(html).toContain('<nav class="progress-steps" aria-label="Signing progress">')
    expect(html).toContain('aria-current="step"')
  })

  it("renders labelled fields and cards with an accessible validation error", () => {
    const html = renderToString(jsx(Card, {
      title: "Client details",
      children: jsx(Field, {
        label: "Client name",
        name: "displayName",
        required: true,
        error: "Enter a client name",
      }),
    }))

    const card = /<section class="card" aria-labelledby="([^"]+)">/.exec(html)
    expect(card?.[1]).toBeTruthy()
    expect(html).toContain(`<h2 id="${card?.[1]}">Client details</h2>`)
    const label = /<label for="([^"]+)">Client name/.exec(html)
    expect(label?.[1]).toBeTruthy()
    const fieldId = label?.[1] ?? ""
    expect(html).toContain(`<input id="${fieldId}"`)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain(`aria-describedby="${fieldId}-error"`)
    expect(html).toContain(`id="${fieldId}-error" class="field-error" role="alert"`)
  })

  it("assigns unique IDs when repeated primitives share names and titles", () => {
    const html = renderToString([
      jsx(Field, { label: "Client name", name: "displayName" }),
      jsx(Field, { label: "Client name", name: "displayName" }),
      jsx(Card, { title: "Client details", children: "First card" }),
      jsx(Card, { title: "Client details", children: "Second card" }),
      jsx(Notice, { tone: "info", title: "Saved", children: "First notice" }),
      jsx(Notice, { tone: "info", title: "Saved", children: "Second notice" }),
    ])
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])

    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(ids.length)
    expect(html).toMatch(/<label for="([^"]+)">Client name<\/label><input id="\1"/)
  })

  it("renders empty, notice, error-panel, and data-list states without raw content", () => {
    const html = renderToString([
      EmptyState({ title: "No clients", children: "Create first client.", action: { href: "/operator/clients/new", label: "Create client" } }),
      Notice({ tone: "info", title: "Saved", children: "Changes saved." }),
      Notice({ tone: "error", title: "Could not save", children: "Try <again>." }),
      DataList({ items: [{ term: "Owner", details: "Ada <admin>" }] }),
    ])

    expect(html).toContain('<section class="empty-state">')
    expect(html).toContain('<a class="button-link" href="/operator/clients/new">Create client</a>')
    expect(html).toContain('class="notice notice-info" role="status"')
    expect(html).toContain('class="notice notice-error" role="alert"')
    expect(html).toContain("Try &lt;again&gt;.")
    expect(html).toContain('<dl class="data-list">')
    expect(html).toContain("Ada &lt;admin&gt;")
  })

  it("guides an empty client list to its primary creation action", async () => {
    const page = await operatorRequest("/operator/clients")
    const html = await page.text()

    expect(html).toContain("No clients yet")
    expect(html).toContain('href="/operator/clients#new-client"')
    expect(html).toContain('id="new-client"')
  })

  it("requires same-origin protection and owner authority for client creation", async () => {
    const form = { clientKey, displayName: "<script>alert(1)</script>" }

    expect((await operatorRequest("/operator/clients", { method: "POST", form, origin: null })).status).toBe(403)
    expect((await operatorRequest("/operator/clients", {
      method: "POST",
      form: { clientKey: `host-${crypto.randomUUID()}`, displayName: "Host injection" },
      host: "https://attacker.invalid",
      origin: "https://attacker.invalid",
    })).status).toBe(403)
    expect((await operatorRequest("/operator/clients", { method: "POST", form, token: "billing-token" })).status).toBe(403)

    const denialAudits = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'client.create' AND outcome = 'denied'",
    ).first<{ count: number }>()
    expect(denialAudits?.count).toBe(3)

    const response = await operatorRequest("/operator/clients", { method: "POST", form })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/operator/clients?notice=client_created")

    const row = await env.CONTROL_DB.prepare(
      "SELECT id, display_name FROM clients WHERE client_key = ?",
    ).bind(clientKey).first<{ id: string; display_name: string }>()
    clientId = row?.id ?? ""
    expect(row?.display_name).toBe("<script>alert(1)</script>")
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'client.create' AND target_id = ? AND outcome = 'success'",
      clientId,
    )).toBe(1)

    const detail = await operatorRequest(`/operator/clients/${clientId}`, { token: "billing-token" })
    expect(detail.status).toBe(200)
    expect(detail.headers.get("Cache-Control")).toBe("no-store")
    const html = await detail.text()
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
  })

  it("renders client rows with readable status and ignores unallowlisted notices", async () => {
    const page = await operatorRequest("/operator/clients")
    const html = await page.text()

    expect(html).toContain('<table class="data-table">')
    expect(html).toContain(`href="/operator/clients/${clientId}"`)
    expect(html).toContain('class="status-badge status-badge-success">Active</span>')

    const unallowlisted = await operatorRequest("/operator/clients?notice=not-a-notice")
    expect(await unallowlisted.text()).not.toContain("not-a-notice")
  })

  it("returns conflict for duplicate keys and never exposes database details", async () => {
    const response = await operatorRequest("/operator/clients", {
      method: "POST",
      form: { clientKey, displayName: "Duplicate" },
    })

    expect(response.status).toBe(409)
    expect(await response.text()).not.toContain("UNIQUE constraint")
    const failureAudits = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'client.create' AND outcome = 'error'",
    ).first<{ count: number }>()
    expect(failureAudits?.count).toBe(1)
  })

  it.each([
    [
      "invalid request",
      (accept: string) => operatorRequest(`/operator/clients/${crypto.randomUUID()}/contracts`, {
        method: "POST",
        form: { planId: "plan-basic" },
        accept,
      }),
      400,
      "invalid_request",
      "Check the submitted values and try again.",
    ],
    [
      "forbidden request",
      (accept: string) => operatorRequest("/operator/clients", {
        method: "POST",
        form: { clientKey: `denied-${crypto.randomUUID()}`, displayName: "Denied" },
        origin: null,
        accept,
      }),
      403,
      "forbidden",
      "You do not have permission to complete this action.",
    ],
    [
      "missing record",
      (accept: string) => operatorRequest(`/operator/clients/${crypto.randomUUID()}/contracts`, {
        method: "POST",
        form: {
          planId: "plan-basic",
          status: "active",
          startsAt: "2026-08-05",
          endsAt: "2026-09-19",
          seatLimit: "2",
          monthlySeatPriceCents: "25000",
          taxBasisPoints: "0",
          collectionFrequency: "monthly",
          moduleIds: ["projects", "salesOrders", "finance"],
        },
        accept,
      }),
      404,
      "not_found",
      "The requested record is unavailable. Return to the dashboard and choose it again.",
    ],
    [
      "conflicting change",
      async (accept: string) => {
        const key = `conflict-${crypto.randomUUID()}`
        const form = { clientKey: key, displayName: "Conflict" }
        try {
          await operatorRequest("/operator/clients", { method: "POST", form })
          return await operatorRequest("/operator/clients", { method: "POST", form, accept })
        } finally {
          await env.CONTROL_DB.prepare("DELETE FROM clients WHERE client_key = ?").bind(key).run()
        }
      },
      409,
      "conflict",
      "This change conflicts with current data. Refresh the page and try again.",
    ],
  ])("negotiates safe %s errors", async (_label, request, status, code, guidance) => {
    const html = await request("text/html")

    expect(html.status).toBe(status)
    expect(html.headers.get("Content-Type")).toContain("text/html")
    expect(html.headers.get("Cache-Control")).toBe("no-store")
    expect(html.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(html.headers.get("Referrer-Policy")).toBe("no-referrer")
    const htmlBody = await html.text()
    expect(htmlBody).toContain(guidance)
    expect(htmlBody).toMatch(/Request ID: <code>[0-9a-f-]{36}<\/code>/)
    expect(htmlBody).toContain('href="/operator"')
    expect(htmlBody).not.toContain("SELECT ")
    expect(htmlBody).not.toContain("PRIVATE KEY")

    const json = await request("application/json")
    expect(json.status).toBe(status)
    expect(json.headers.get("Content-Type")).toContain("application/json")
    await expect(json.json()).resolves.toEqual({ error: code })
  })

  it.each([
    ["JSON by default", undefined, "application/json"],
    ["HTML for exact text/html", "text/html", "text/html"],
    ["HTML for preferred text range", "text/*;q=0.8, application/json;q=0.7", "text/html"],
    ["JSON when exact HTML exclusion overrides text range", "text/*;q=1, text/html;q=0", "application/json"],
    ["JSON when text range excludes HTML", "text/*;q=0, application/json;q=0.2", "application/json"],
    ["JSON for equal representation quality", "text/*;q=0.8, application/json;q=0.8", "application/json"],
  ])("returns safe unknown operator-route 404 as $0", async (_label, accept, contentType) => {
    const response = await operatorRequest(`/operator/unknown-${crypto.randomUUID()}`, { accept })

    expect(response.status).toBe(404)
    expect(response.headers.get("Content-Type")).toContain(contentType)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
    const body = await response.text()
    if (contentType === "text/html") {
      expect(body).toContain("The requested record is unavailable. Return to the dashboard and choose it again.")
      expect(body).toMatch(/Request ID: <code>[0-9a-f-]{36}<\/code>/)
    } else {
      expect(JSON.parse(body)).toEqual({ error: "not_found" })
    }
  })

  it("leaves unmatched API routes on their default response", async () => {
    const response = await app.fetch(
      new Request(`https://control.invalid/v1/unknown-${crypto.randomUUID()}`, {
        headers: { Accept: "text/html" },
      }),
      bindings(),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get("Content-Type")).toContain("text/plain")
    expect(response.headers.get("Cache-Control")).toBeNull()
    expect(await response.text()).toBe("404 Not Found")
  })

  it("accepts guarded same-origin JSON but rejects unguarded JSON", async () => {
    const unguarded = await operatorRequest("/operator/clients", {
      method: "POST",
      json: { clientKey: secondClientKey, displayName: "Second client" },
    })
    expect(unguarded.status).toBe(403)

    const guarded = await operatorRequest("/operator/clients", {
      method: "POST",
      json: { clientKey: secondClientKey, displayName: "Second client" },
      jsonGuard: true,
    })
    expect(guarded.status).toBe(201)
    secondClientId = (await guarded.json() as { id: string }).id
  })

  it("creates unlimited client organisations with stable keys unique within each client", async () => {
    for (const organisationKey of ["hq", "delivery"] as const) {
      expect((await operatorRequest(`/operator/clients/${clientId}/organisations`, {
        method: "POST",
        form: { organisationKey, displayName: organisationKey.toUpperCase(), metadataJson: '{"region":"my"}' },
      })).status).toBe(303)
    }

    expect((await operatorRequest(`/operator/clients/${clientId}/organisations`, {
      method: "POST",
      form: { organisationKey: "hq", displayName: "Duplicate", metadataJson: "{}" },
    })).status).toBe(409)
    expect((await operatorRequest(`/operator/clients/${secondClientId}/organisations`, {
      method: "POST",
      form: { organisationKey: "hq", displayName: "Second HQ", metadataJson: "{}" },
    })).status).toBe(303)

    const laterPage = await operatorRequest(
      `/operator/clients/${clientId}?organisationsPage=2&organisationsPageSize=1&deploymentsPage=1&deploymentsPageSize=1&contractsPage=1&contractsPageSize=1`,
    )
    const html = await laterPage.text()
    expect(html).toContain("HQ")
    expect(html).not.toContain("DELIVERY")
    expect(html).toContain("organisationsPage=1")
    expect(html).toContain("deploymentsPage=1")
  })

  it("creates deployments with prepared values and rejects duplicate deployment keys", async () => {
    const form = {
      deploymentKey,
      environment: "production",
      status: "active",
    }
    expect((await operatorRequest(`/operator/clients/${clientId}/deployments`, {
      method: "POST",
      form,
    })).status).toBe(303)
    expect((await operatorRequest(`/operator/clients/${clientId}/deployments`, {
      method: "POST",
      form,
    })).status).toBe(409)
  })
})

describe("contract and invoice administration", () => {
  const validContract = {
    planId: "plan-basic",
    status: "active",
    startsAt: "2026-08-05",
    endsAt: "2026-09-19",
    seatLimit: "2",
    monthlySeatPriceCents: "25000",
    taxBasisPoints: "0",
    collectionFrequency: "monthly",
    moduleIds: ["projects", "salesOrders", "finance"],
  }

  it.each([
    ["malformed calendar date", { startsAt: "2026-02-30", endsAt: "2026-03-30" }],
    ["non-integer seats", { seatLimit: "2.5" }],
    ["end before start", { startsAt: "2026-09-01", endsAt: "2026-08-31" }],
    ["invalid money", { monthlySeatPriceCents: "-1" }],
    ["invalid tax", { taxBasisPoints: "10001" }],
    ["missing transitive module dependencies", { moduleIds: ["finance"] }],
  ])("rejects %s before billing math or persistence", async (_label, override) => {
    const response = await operatorRequest(`/operator/clients/${clientId}/contracts`, {
      method: "POST",
      form: { ...validContract, ...override },
    })

    expect(response.status).toBe(400)
  })

  it("allows owner or billing operator to create a validated contract", async () => {
    const response = await operatorRequest(`/operator/clients/${clientId}/contracts`, {
      method: "POST",
      token: "billing-token",
      form: validContract,
    })
    expect(response.status).toBe(303)

    const contract = await env.CONTROL_DB.prepare(
      "SELECT id, total_cents FROM contracts WHERE client_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(clientId).first<{ id: string; total_cents: number }>()
    contractId = contract?.id ?? ""
    expect(contract?.total_cents).toBe(75_000)

    const modules = await env.CONTROL_DB.prepare(
      "SELECT module_id FROM contract_modules WHERE contract_id = ? ORDER BY module_id",
    ).bind(contractId).all<{ module_id: string }>()
    expect(modules.results.map((row) => row.module_id)).toEqual(["finance", "projects", "salesOrders"])
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'contract.create' AND target_id = ? AND outcome = 'success'",
      contractId,
    )).toBe(1)

    const detail = await operatorRequest(`/operator/contracts/${contractId}`)
    expect(detail.status).toBe(200)
    expect(detail.headers.get("Cache-Control")).toBe("no-store")
    expect(await detail.text()).toContain(`/operator/contracts/${contractId}/invoices`)
  })

  it("orders client onboarding as contract then deployment, with optional organisations secondary", async () => {
    const page = await operatorRequest(`/operator/clients/${clientId}`)
    const html = await page.text()

    expect(html).toContain('aria-label="Client onboarding"')
    expect(html).toContain(`href="/operator/deployments/`)
    expect(html.indexOf("Contracts")).toBeLessThan(html.indexOf("Deployments"))
    expect(html.indexOf("Deployments")).toBeLessThan(html.indexOf("Organisations"))
    expect(html).toContain("Optional organisation details")
  })

  it("keeps collection state and onboarding progress on out-of-range child pages", async () => {
    const page = await operatorRequest(
      `/operator/clients/${clientId}?organisationsPage=3&organisationsPageSize=1&deploymentsPage=2&deploymentsPageSize=1&contractsPage=2&contractsPageSize=1`,
    )
    const html = await page.text()

    expect(html).toContain("No contracts on this page.")
    expect(html).toContain("No deployments on this page.")
    expect(html).toContain("No organisations on this page.")
    expect(html).not.toContain("No contracts yet")
    expect(html).not.toContain("No deployments yet")
    expect(html).not.toContain("No organisations yet")
    expect(html).toContain('<li class="progress-step progress-step-complete"><span>Contract</span></li>')
    expect(html).toContain('<li class="progress-step progress-step-complete"><span>Deployment</span></li>')
  })

  it("rejects empty and unknown-only entitlement controls without state or success-audit churn", async () => {
    const before = await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number }>()
    for (const json of [{}, { unknownControl: true }]) {
      const response = await operatorRequest(`/operator/contracts/${contractId}/entitlement-controls`, {
        method: "POST",
        token: "billing-token",
        json,
        jsonGuard: true,
      })
      expect(response.status).toBe(400)
    }
    expect(await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number }>()).toEqual(before)
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM entitlement_control_operations WHERE contract_id = ?",
      contractId,
    )).toBe(0)
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'entitlement.controls.update' AND target_id = ? AND outcome = 'success'",
      contractId,
    )).toBe(0)
  })

  it.each([
    ["invalid currency", { currency: "XXX" }],
    ["invalid money", { totalCents: "-1" }],
    ["invalid tax-like floating amount", { totalCents: "1.5" }],
    ["invalid weights", { weights: "1,-1,1" }],
    ["empty lexical weight segment", { weights: "1,,1" }],
    ["whitespace lexical weight segment", { weights: "1,   ,1" }],
    ["NaN weight", { weights: "1,NaN,1" }],
    ["Infinity weight", { weights: "1,Infinity,1" }],
    ["overflowing finite decimal weight sum", { weights: `${hugeFiniteWeight},${hugeFiniteWeight},${hugeFiniteWeight}` }],
  ])("rejects invoice %s", async (_label, override) => {
    const response = await operatorRequest(`/operator/contracts/${contractId}/invoices`, {
      method: "POST",
      form: {
        invoiceNumber: `${invoiceNumber}-${_label}`,
        status: "issued",
        issuedAt: "2026-08-10T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        currency: "MYR",
        totalCents: "100",
        collectionFrequency: "monthly",
        billingPeriods: "3",
        firstDueAt: "2026-08-31",
        weights: "1,1,1",
        ...override,
      },
    })
    expect(response.status).toBe(400)
  })

  it("issues an invoice with exact final-cent allocation and one audit event", async () => {
    const form = {
      invoiceNumber,
      status: "issued",
      issuedAt: "2026-08-10T00:00:00.000Z",
      dueAt: "2026-08-31T00:00:00.000Z",
      currency: "MYR",
      totalCents: "100",
      collectionFrequency: "monthly",
      billingPeriods: "3",
      firstDueAt: "2026-08-31",
      weights: "1,1,1",
    }
    expect((await operatorRequest(`/operator/contracts/${contractId}/invoices`, {
      method: "POST",
      token: "billing-token",
      form,
    })).status).toBe(303)

    const invoice = await env.CONTROL_DB.prepare(
      "SELECT id, total_cents FROM invoices WHERE invoice_number = ?",
    ).bind(invoiceNumber).first<{ id: string; total_cents: number }>()
    expect(invoice?.total_cents).toBe(100)
    const milestones = await env.CONTROL_DB.prepare(
      "SELECT amount_cents FROM invoice_collection_milestones WHERE invoice_id = ? ORDER BY sequence",
    ).bind(invoice?.id).all<{ amount_cents: number }>()
    expect(milestones.results.map((row) => row.amount_cents)).toEqual([33, 33, 34])
    expect(milestones.results.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(100)
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'invoice.create' AND target_id = ? AND outcome = 'success'",
      invoice?.id ?? "",
    )).toBe(1)

    expect((await operatorRequest(`/operator/contracts/${contractId}/invoices`, {
      method: "POST",
      form,
    })).status).toBe(409)
  })

  it("persists a 1,200-period schedule with a bounded atomic batch", async () => {
    const batchSizes: number[] = []
    const database = trackBatchSizes(batchSizes)
    const largeInvoiceNumber = `INV-LARGE-${crypto.randomUUID()}`
    const response = await operatorRequest(`/operator/contracts/${contractId}/invoices`, {
      method: "POST",
      token: "billing-token",
      database,
      form: {
        invoiceNumber: largeInvoiceNumber,
        status: "issued",
        issuedAt: "2026-08-10T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        currency: "MYR",
        totalCents: "100",
        collectionFrequency: "monthly",
        billingPeriods: "1200",
        firstDueAt: "2026-08-31",
        weights: Array.from({ length: 1_200 }, () => "1").join(","),
      },
    })

    expect(response.status).toBe(303)
    expect(batchSizes).toEqual([3])
    const invoice = await env.CONTROL_DB.prepare(
      "SELECT id FROM invoices WHERE invoice_number = ?",
    ).bind(largeInvoiceNumber).first<{ id: string }>()
    const schedule = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count, SUM(amount_cents) AS total FROM invoice_collection_milestones WHERE invoice_id = ?",
    ).bind(invoice?.id).first<{ count: number; total: number }>()
    expect(schedule).toEqual({ count: 1_200, total: 100 })
  })

  it("renders dashboard counts and actionable attention items", async () => {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("UPDATE contracts SET status = 'past_due' WHERE id = ?").bind(contractId),
      env.CONTROL_DB.prepare("UPDATE deployments SET status = 'disabled' WHERE client_id = ?").bind(clientId),
    ])

    const page = await operatorRequest("/operator")
    const html = await page.text()

    expect(html).toContain("Client portfolio")
    expect(html).toContain('<p class="summary-value">2</p><p>active client records</p>')
    expect(html).toContain('<p class="summary-value">1</p><p>deployment</p>')
    expect(html).toContain("Needs attention")
    expect(html).toContain("Contract is past due")
    expect(html).toContain("Deployment is disabled")
    expect(html).toContain('href="/operator/clients#new-client"')
  })

  it("bounds operator list pagination", async () => {
    expect((await operatorRequest("/operator/clients?pageSize=500")).status).toBe(400)
    const page = await operatorRequest("/operator/clients?page=1&pageSize=25")
    expect(page.status).toBe(200)
    expect(page.headers.get("Cache-Control")).toBe("no-store")
  })
})
