import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { AccessTokenInvalidError, type AccessVerifier } from "../src/auth/access"
import { createApp } from "../src/index"

const ownerSubject = `owner-${crypto.randomUUID()}`
const supportSubject = `support-${crypto.randomUUID()}`
const supportOperatorId = crypto.randomUUID()
const clientKey = `client-${crypto.randomUUID()}`
const deploymentKey = `deployment-${crypto.randomUUID()}`
let clientId = ""
let deploymentId = ""
let contractId = ""

const accessVerifier: AccessVerifier = async (token) => {
  if (token === "owner-token") {
    return { subject: ownerSubject, email: "owner@example.com" }
  }
  if (token === "support-token") {
    return { subject: supportSubject, email: "support@example.com" }
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
    token?: "owner-token" | "support-token"
    method?: "GET" | "POST"
    form?: Record<string, string | readonly string[]>
    json?: Record<string, unknown>
    origin?: string | null
    jsonGuard?: boolean
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
    new Request(`https://control.invalid${path}`, { method, headers, body }),
    bindings(),
  )
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
    ).bind(supportOperatorId, "support@example.com", supportSubject, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, 'vendor_support', ?)",
    ).bind(supportOperatorId, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('plan-basic', 'basic', 'Basic', 1, ?, ?)",
    ).bind(now, now),
  ])

  expect((await operatorRequest("/operator/clients", {
    method: "POST",
    form: { clientKey, displayName: "Lifecycle Client" },
  })).status).toBe(303)
  const client = await env.CONTROL_DB.prepare(
    "SELECT id FROM clients WHERE client_key = ?",
  ).bind(clientKey).first<{ id: string }>()
  clientId = client?.id ?? ""

  expect((await operatorRequest(`/operator/clients/${clientId}/contracts`, {
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
  })).status).toBe(303)
  const contract = await env.CONTROL_DB.prepare(
    "SELECT id FROM contracts WHERE client_id = ? ORDER BY created_at DESC LIMIT 1",
  ).bind(clientId).first<{ id: string }>()
  contractId = contract?.id ?? ""

  expect((await operatorRequest(`/operator/clients/${clientId}/deployments`, {
    method: "POST",
    form: { deploymentKey, environment: "production", status: "active" },
  })).status).toBe(303)
  const deployment = await env.CONTROL_DB.prepare(
    "SELECT id FROM deployments WHERE deployment_key = ?",
  ).bind(deploymentKey).first<{ id: string }>()
  deploymentId = deployment?.id ?? ""
})

describe("operator roster administration", () => {
  it("renders the roster page with the current operator marked", async () => {
    const page = await operatorRequest("/operator/operators")
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('href="/operator/operators"')
    expect(html).toContain("owner@example.com")
    expect(html).toContain("(you)")
    expect(html).toContain("Self-editing locked")
  })

  it("creates an operator and lists it with assigned roles", async () => {
    const email = `billing-${crypto.randomUUID()}@example.com`
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      form: { email, roles: ["billing_operator"] },
    })).status).toBe(303)

    const operator = await env.CONTROL_DB.prepare(
      "SELECT id FROM operator_users WHERE lower(email) = ?",
    ).bind(email).first<{ id: string }>()
    expect(operator?.id).toBeTruthy()
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'operator.create' AND target_id = ? AND outcome = 'success'",
      operator?.id ?? "",
    )).toBe(1)

    const page = await operatorRequest("/operator/operators")
    expect(await page.text()).toContain(email)
  })

  it("rejects duplicate operator emails and unknown roles", async () => {
    const email = `dupe-${crypto.randomUUID()}@example.com`
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      form: { email, roles: ["auditor"] },
    })).status).toBe(303)
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      form: { email, roles: ["auditor"] },
    })).status).toBe(400)
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      form: { email: `unknown-${crypto.randomUUID()}@example.com`, roles: ["superuser"] },
    })).status).toBe(400)
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      form: { email: `noroles-${crypto.randomUUID()}@example.com`, roles: [] },
    })).status).toBe(400)
  })

  it("allows a vendor owner to disable and re-enable another account", async () => {
    expect((await operatorRequest(`/operator/operators/${supportOperatorId}/status`, {
      method: "POST",
      form: { status: "disabled" },
    })).status).toBe(400)
    expect((await operatorRequest(`/operator/operators/${supportOperatorId}/status`, {
      method: "POST",
      form: { status: "disabled", confirmation: "disable_operator" },
    })).status).toBe(303)
    const disabled = await env.CONTROL_DB.prepare(
      "SELECT status FROM operator_users WHERE id = ?",
    ).bind(supportOperatorId).first<{ status: string }>()
    expect(disabled?.status).toBe("disabled")

    const denied = await operatorRequest("/operator", { token: "support-token" })
    expect(denied.status).toBe(403)

    expect((await operatorRequest(`/operator/operators/${supportOperatorId}/status`, {
      method: "POST",
      form: { status: "active" },
    })).status).toBe(303)
    expect((await operatorRequest("/operator", { token: "support-token" })).status).toBe(200)
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'operator.status.update' AND target_id = ? AND outcome = 'success'",
      supportOperatorId,
    )).toBe(2)
  })

  it("blocks self-modification", async () => {
    const owner = await env.CONTROL_DB.prepare(
      "SELECT id FROM operator_users WHERE email = ?",
    ).bind("owner@example.com").first<{ id: string }>()
    expect((await operatorRequest(`/operator/operators/${owner?.id}/status`, {
      method: "POST",
      form: { status: "disabled", confirmation: "disable_operator" },
    })).status).toBe(403)
    expect((await operatorRequest(`/operator/operators/${owner?.id}/roles`, {
      method: "POST",
      form: { roles: ["auditor"] },
    })).status).toBe(403)
  })

  it("allows vendor owners to change another owner's role set while an owner remains", async () => {
    expect((await operatorRequest(`/operator/operators/${supportOperatorId}/roles`, {
      method: "POST",
      form: { roles: ["vendor_owner", "vendor_support"] },
    })).status).toBe(303)
    expect((await operatorRequest(`/operator/operators/${supportOperatorId}/roles`, {
      method: "POST",
      form: { roles: ["vendor_support"] },
    })).status).toBe(303)
  })

  it("requires vendor_owner authority for roster mutations", async () => {
    expect((await operatorRequest("/operator/operators", { token: "support-token" })).status).toBe(403)
    expect((await operatorRequest("/operator/operators", {
      method: "POST",
      token: "support-token",
      form: { email: `denied-${crypto.randomUUID()}@example.com`, roles: ["auditor"] },
    })).status).toBe(403)
  })
})

describe("deployment lifecycle controls", () => {
  it("disables and re-enables a deployment", async () => {
    expect((await operatorRequest(`/operator/deployments/${deploymentId}/status`, {
      method: "POST",
      form: { status: "disabled", confirmation: "disable_deployment" },
    })).status).toBe(303)
    const disabled = await env.CONTROL_DB.prepare(
      "SELECT status FROM deployments WHERE id = ?",
    ).bind(deploymentId).first<{ status: string }>()
    expect(disabled?.status).toBe("disabled")

    expect((await operatorRequest(`/operator/deployments/${deploymentId}/status`, {
      method: "POST",
      form: { status: "active" },
    })).status).toBe(303)
    const enabled = await env.CONTROL_DB.prepare(
      "SELECT status FROM deployments WHERE id = ?",
    ).bind(deploymentId).first<{ status: string }>()
    expect(enabled?.status).toBe("active")
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'deployment.status.update' AND target_id = ? AND outcome = 'success'",
      deploymentId,
    )).toBe(2)
  })

  it("rejects invalid deployment status transitions", async () => {
    expect((await operatorRequest(`/operator/deployments/${deploymentId}/status`, {
      method: "POST",
      form: { status: "frozen" },
    })).status).toBe(400)
    expect((await operatorRequest(`/operator/deployments/${crypto.randomUUID()}/status`, {
      method: "POST",
      form: { status: "active" },
    })).status).toBe(404)
  })

  it("revokes pending install tokens", async () => {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1_000).toISOString().slice(0, 16)
    expect((await operatorRequest(`/operator/deployments/${deploymentId}/install-tokens`, {
      method: "POST",
      form: { expiresAt, idempotencyKey: crypto.randomUUID() },
    })).status).toBe(200)

    const token = await env.CONTROL_DB.prepare(
      "SELECT id, superseded_at FROM install_tokens WHERE deployment_id = ? AND superseded_at IS NULL",
    ).bind(deploymentId).first<{ id: string; superseded_at: string | null }>()
    expect(token).toBeTruthy()

    expect((await operatorRequest(`/operator/deployments/${deploymentId}/install-tokens/revoke`, {
      method: "POST",
      form: { confirmation: "revoke_install_tokens" },
    })).status).toBe(303)
    const revoked = await env.CONTROL_DB.prepare(
      "SELECT superseded_at FROM install_tokens WHERE id = ?",
    ).bind(token?.id).first<{ superseded_at: string | null }>()
    expect(revoked?.superseded_at).not.toBeNull()
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'install_token.revoke' AND target_id = ? AND outcome = 'success'",
      deploymentId,
    )).toBe(1)
  })

})

describe("contract editing and entitlement controls form", () => {
  it("edits contract terms and bumps the entitlement revision", async () => {
    const before = await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision, total_cents FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number; total_cents: number }>()

    expect((await operatorRequest(`/operator/contracts/${contractId}/edit`, {
      method: "POST",
      form: {
        planId: "plan-basic",
        status: "active",
        startsAt: "2026-08-05",
        endsAt: "2026-10-19",
        seatLimit: "3",
        monthlySeatPriceCents: "30000",
        taxBasisPoints: "0",
        collectionFrequency: "monthly",
        moduleIds: ["projects", "salesOrders", "finance"],
      },
    })).status).toBe(303)

    const after = await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision, total_cents, seat_limit FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number; total_cents: number; seat_limit: number }>()
    expect(after?.entitlement_revision).toBe((before?.entitlement_revision ?? 0) + 1)
    expect(after?.seat_limit).toBe(3)
    expect(after?.total_cents).not.toBe(before?.total_cents)
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'contract.update' AND target_id = ? AND outcome = 'success'",
      contractId,
    )).toBe(1)
  })

  it("rejects malformed contract edits without revision churn", async () => {
    const before = await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number }>()
    expect((await operatorRequest(`/operator/contracts/${contractId}/edit`, {
      method: "POST",
      form: {
        planId: "plan-basic",
        status: "active",
        startsAt: "2026-10-01",
        endsAt: "2026-08-31",
        seatLimit: "2",
        monthlySeatPriceCents: "25000",
        taxBasisPoints: "0",
        collectionFrequency: "monthly",
        moduleIds: ["projects"],
      },
    })).status).toBe(400)
    const after = await env.CONTROL_DB.prepare(
      "SELECT entitlement_revision FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ entitlement_revision: number }>()
    expect(after?.entitlement_revision).toBe(before?.entitlement_revision)
  })

  it("updates entitlement controls through the HTML form", async () => {
    expect((await operatorRequest(`/operator/contracts/${contractId}/entitlement-controls`, {
      method: "POST",
      form: {
        status: "past_due",
        renewalPolicy: "non_renewing",
      },
    })).status).toBe(303)

    const contract = await env.CONTROL_DB.prepare(
      "SELECT status, renewal_policy, seat_limit FROM contracts WHERE id = ?",
    ).bind(contractId).first<{ status: string; renewal_policy: string; seat_limit: number }>()
    expect(contract?.status).toBe("past_due")
    expect(contract?.renewal_policy).toBe("non_renewing")
    expect(await countRows(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE action = 'entitlement.controls.update' AND target_id = ? AND outcome = 'success'",
      contractId,
    )).toBe(1)

    const page = await operatorRequest(`/operator/contracts/${contractId}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain("Edit commercial terms")
    expect(html).toContain("Entitlement controls")
  })
})
