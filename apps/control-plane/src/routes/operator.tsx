/** @jsxImportSource hono/jsx */
import { Hono, type Context, type MiddlewareHandler } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { HTTPException } from "hono/http-exception"

import { prepareOperatorAuditStatement } from "../audit"
import { requireOperatorRole } from "../auth/rbac"
import type { ControlPlaneEnvironment } from "../index"
import { badRequest, forbidden, SafeHttpError } from "../http/errors"
import {
  createClient,
  createClientOrganisation,
  createDeployment,
  getClientDetail,
  listClients,
  parseClientChildPagination,
  parseNamedPagination,
  parsePagination,
} from "../repos/clients"
import { createContract, getContractDetail } from "../repos/contracts"
import { createInvoice } from "../repos/invoices"
import {
  assignEntitlementSchedule,
  issueEntitlement,
  updateEntitlementControls,
} from "../repos/entitlements"
import { ClientList, ClientPage, ContractPage, Dashboard } from "../ui/dashboard"

type OperatorContext = Context<ControlPlaneEnvironment>
type MutationData = Record<string, unknown>
const CSRF_COOKIE = "operator_csrf"
const csrfTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requestId(context: OperatorContext): string {
  return context.req.header("Cf-Ray") ?? context.req.header("X-Request-Id") ?? crypto.randomUUID()
}

function isJson(context: OperatorContext): boolean {
  return context.req.header("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === "application/json"
}

function csrfToken(context: OperatorContext): string {
  const current = getCookie(context, CSRF_COOKIE)
  if (current && csrfTokenPattern.test(current)) return current
  const token = crypto.randomUUID()
  setCookie(context, CSRF_COOKIE, token, {
    httpOnly: true,
    path: "/operator",
    sameSite: "Strict",
    secure: true,
  })
  return token
}

const requireCsrfToken: MiddlewareHandler<ControlPlaneEnvironment> = async (context, next) => {
  const cookieToken = getCookie(context, CSRF_COOKIE)
  if (!cookieToken || !csrfTokenPattern.test(cookieToken)) throw forbidden()

  let requestToken: string | undefined
  if (isJson(context)) {
    if (context.req.header("X-Control-Request") !== "same-origin") throw forbidden()
    requestToken = context.req.header("X-CSRF-Token")
  } else {
    const contentType = context.req.header("Content-Type")?.toLowerCase() ?? ""
    if (!contentType.startsWith("application/x-www-form-urlencoded")) throw forbidden()
    const form = await context.req.raw.clone().formData().catch(() => null)
    const value = form?.get("_csrf")
    requestToken = typeof value === "string" ? value : undefined
  }
  if (requestToken !== cookieToken) throw forbidden()
  await next()
}

async function mutationData(context: OperatorContext): Promise<MutationData> {
  const contentLength = Number(context.req.header("Content-Length") ?? "0")
  if (!Number.isFinite(contentLength) || contentLength > 32_768) throw badRequest()

  if (isJson(context)) {
    const body: unknown = await context.req.json().catch(() => null)
    if (body === null || Array.isArray(body) || typeof body !== "object") throw badRequest()
    return body as MutationData
  }

  const contentType = context.req.header("Content-Type")?.toLowerCase() ?? ""
  if (!contentType.startsWith("application/x-www-form-urlencoded")) throw badRequest()
  const body = await context.req.parseBody({ all: true })
  const result: MutationData = {}
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      if (value.some((item) => typeof item !== "string")) throw badRequest()
      result[key] = value
    } else {
      if (typeof value !== "string") throw badRequest()
      result[key] = value
    }
  }
  return result
}

function mutationDescriptor(pathname: string): {
  action: string
  targetType: string
  targetId: string
} {
  if (pathname === "/operator/clients") {
    return { action: "client.create", targetType: "client", targetId: "pending" }
  }
  if (/^\/operator\/clients\/[^/]+\/organisations$/.test(pathname)) {
    return {
      action: "client_organisation.create",
      targetType: "client_organisation",
      targetId: "request-target",
    }
  }
  if (/^\/operator\/clients\/[^/]+\/deployments$/.test(pathname)) {
    return { action: "deployment.create", targetType: "deployment", targetId: "request-target" }
  }
  if (/^\/operator\/clients\/[^/]+\/contracts$/.test(pathname)) {
    return { action: "contract.create", targetType: "contract", targetId: "request-target" }
  }
  if (/^\/operator\/contracts\/[^/]+\/invoices$/.test(pathname)) {
    return { action: "invoice.create", targetType: "invoice", targetId: "request-target" }
  }
  if (/^\/operator\/deployments\/[^/]+\/entitlements\/schedule$/.test(pathname)) {
    return { action: "entitlement.schedule.assign", targetType: "deployment", targetId: "request-target" }
  }
  if (/^\/operator\/deployments\/[^/]+\/entitlements\/issue$/.test(pathname)) {
    return { action: "entitlement.issue", targetType: "deployment", targetId: "request-target" }
  }
  if (/^\/operator\/contracts\/[^/]+\/entitlement-controls$/.test(pathname)) {
    return { action: "entitlement.controls.update", targetType: "contract", targetId: "request-target" }
  }
  return { action: "operator.mutation", targetType: "operator_route", targetId: "unmatched" }
}

function safeFailure(error: unknown): { code: string; outcome: "denied" | "error" } {
  if (error instanceof SafeHttpError) {
    return {
      code: error.code,
      outcome: error.status === 401 || error.status === 403 ? "denied" : "error",
    }
  }
  if (error instanceof HTTPException) {
    return {
      code: error.status === 403 ? "forbidden" : "invalid_request",
      outcome: error.status === 401 || error.status === 403 ? "denied" : "error",
    }
  }
  return { code: "internal_error", outcome: "error" }
}

function responseFailure(status: number): { code: string; outcome: "denied" | "error" } {
  if (status === 401) return { code: "unauthorized", outcome: "denied" }
  if (status === 403) return { code: "forbidden", outcome: "denied" }
  if (status === 404) return { code: "not_found", outcome: "error" }
  if (status === 409) return { code: "conflict", outcome: "error" }
  if (status >= 400 && status < 500) return { code: "invalid_request", outcome: "error" }
  return { code: "internal_error", outcome: "error" }
}

async function writeFailureAudit(
  context: OperatorContext,
  failure: { code: string; outcome: "denied" | "error" },
): Promise<void> {
  const descriptor = mutationDescriptor(new URL(context.req.url).pathname)
  const audit = await prepareOperatorAuditStatement(context.env.CONTROL_DB, {
    operatorId: context.get("operator").operatorId,
    action: descriptor.action,
    targetType: descriptor.targetType,
    targetId: descriptor.targetId,
    outcome: failure.outcome,
    requestId: requestId(context),
    metadata: { errorCode: failure.code },
  })
  await context.env.CONTROL_DB.batch([audit.statement])
}

const auditMutationFailures: MiddlewareHandler<ControlPlaneEnvironment> = async (context, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
    await next()
    return
  }

  try {
    await next()
  } catch (error) {
    await writeFailureAudit(context, safeFailure(error))
    throw error
  }

  if (context.res.status >= 400) {
    await writeFailureAudit(context, responseFailure(context.res.status))
  }
}

async function runMutation(
  context: OperatorContext,
  run: (data: MutationData) => Promise<string>,
) {
  const data = await mutationData(context)
  const id = await run(data)
  if (isJson(context)) return context.json({ id }, 201)
  return context.redirect(context.req.header("Referer") ?? "/operator/clients", 303)
}

function actor(context: OperatorContext) {
  return {
    operatorId: context.get("operator").operatorId,
    requestId: requestId(context),
  }
}

export function createOperatorRoutes() {
  const routes = new Hono<ControlPlaneEnvironment>()

  routes.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store")
    context.header("X-Content-Type-Options", "nosniff")
    context.header("Referrer-Policy", "no-referrer")
    await next()
  })
  routes.use("*", auditMutationFailures)
  routes.get("/", (context) =>
    context.html(<Dashboard operatorEmail={context.get("operator").email} />),
  )
  routes.get("/clients", async (context) => {
    const pagination = parsePagination(context.req.url)
    const clients = await listClients(
      context.env.CONTROL_DB,
      pagination.pageSize,
      pagination.offset,
    )
    return context.html(
      <ClientList clients={clients} page={pagination.page} pageSize={pagination.pageSize} csrfToken={csrfToken(context)} />,
    )
  })
  routes.get("/clients/:clientId", async (context) => {
    const client = await getClientDetail(
      context.env.CONTROL_DB,
      context.req.param("clientId"),
      parseClientChildPagination(context.req.url),
    )
    return context.html(<ClientPage client={client} csrfToken={csrfToken(context)} />)
  })
  routes.get("/contracts/:contractId", async (context) => {
    const contract = await getContractDetail(
      context.env.CONTROL_DB,
      context.req.param("contractId"),
      parseNamedPagination(context.req.url, "invoices"),
    )
    return context.html(<ContractPage contract={contract} csrfToken={csrfToken(context)} />)
  })

  routes.post(
    "/clients",
    requireCsrfToken,
    requireOperatorRole("vendor_owner"),
    (context) => runMutation(
      context,
      (data) => createClient(context.env.CONTROL_DB, data as never, actor(context)),
    ),
  )
  routes.post(
    "/clients/:clientId/organisations",
    requireCsrfToken,
    requireOperatorRole("vendor_owner"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(
        context,
        (data) => createClientOrganisation(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      )
    },
  )
  routes.post(
    "/clients/:clientId/deployments",
    requireCsrfToken,
    requireOperatorRole("vendor_owner"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(
        context,
        (data) => createDeployment(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      )
    },
  )
  routes.post(
    "/clients/:clientId/contracts",
    requireCsrfToken,
    requireOperatorRole("vendor_owner", "billing_operator"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(
        context,
        (data) => createContract(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      )
    },
  )
  routes.post(
    "/contracts/:contractId/invoices",
    requireCsrfToken,
    requireOperatorRole("vendor_owner", "billing_operator"),
    (context) => {
      const contractId = context.req.param("contractId")
      return runMutation(
        context,
        (data) => createInvoice(context.env.CONTROL_DB, contractId, data as never, actor(context)),
      )
    },
  )
  routes.post(
    "/deployments/:deploymentId/entitlements/schedule",
    requireCsrfToken,
    requireOperatorRole("vendor_owner", "billing_operator"),
    async (context) => {
      const deploymentId = context.req.param("deploymentId")
      const data = await mutationData(context)
      await assignEntitlementSchedule(context.env.CONTROL_DB, {
        deploymentId,
        contractId: String(data.contractId ?? ""),
        configurationVersion: String(data.configurationVersion ?? ""),
        releaseChannel: String(data.releaseChannel ?? "") as "stable" | "beta" | "canary",
        minimumSupportedAppVersion: String(data.minimumSupportedAppVersion ?? ""),
        approvedImageDigest: data.approvedImageDigest === undefined || data.approvedImageDigest === ""
          ? null
          : String(data.approvedImageDigest),
      }, actor(context))
      return isJson(context) ? context.json({ id: deploymentId }, 201) : context.redirect(context.req.header("Referer") ?? "/operator/clients", 303)
    },
  )
  routes.post(
    "/deployments/:deploymentId/entitlements/issue",
    requireCsrfToken,
    requireOperatorRole("vendor_owner", "billing_operator"),
    async (context) => {
      const deploymentId = context.req.param("deploymentId")
      const data = await mutationData(context)
      const issued = await issueEntitlement(context.env, {
        deploymentId,
        contractId: typeof data.contractId === "string" ? data.contractId : undefined,
        issuanceKey: typeof data.idempotencyKey === "string" ? `manual:${data.idempotencyKey}` : `manual:${crypto.randomUUID()}`,
        actor: { ...actor(context), source: "operator" },
      })
      return context.json({ id: issued.id, version: issued.version }, 201)
    },
  )
  routes.post(
    "/contracts/:contractId/entitlement-controls",
    requireCsrfToken,
    requireOperatorRole("vendor_owner", "billing_operator"),
    async (context) => {
      const contractId = context.req.param("contractId")
      const data = await mutationData(context)
      const seatLimit = data.seatLimit === undefined || data.seatLimit === ""
        ? undefined
        : Number(data.seatLimit)
      await updateEntitlementControls(context.env.CONTROL_DB, contractId, {
        status: data.status === undefined ? undefined : String(data.status) as "active" | "past_due" | "suspended" | "cancelled",
        renewalPolicy: data.renewalPolicy === undefined ? undefined : String(data.renewalPolicy) as "auto_renew" | "non_renewing",
        suspensionAt: data.suspensionAt === undefined ? undefined : data.suspensionAt === "" ? null : String(data.suspensionAt),
        seatLimit,
        effectiveAt: data.effectiveAt === undefined || data.effectiveAt === "" ? undefined : String(data.effectiveAt),
      }, actor(context))
      return context.json({ id: contractId }, 200)
    },
  )

  return routes
}
