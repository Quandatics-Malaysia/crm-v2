import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import {
  AccessTokenInvalidError,
  type AccessVerifier,
} from "../src/auth/access"
import { createApp } from "../src/index"

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

  it("bounds operator list pagination", async () => {
    expect((await operatorRequest("/operator/clients?pageSize=500")).status).toBe(400)
    const page = await operatorRequest("/operator/clients?page=1&pageSize=25")
    expect(page.status).toBe(200)
    expect(page.headers.get("Cache-Control")).toBe("no-store")
  })
})
