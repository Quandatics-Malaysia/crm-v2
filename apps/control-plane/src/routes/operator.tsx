/** @jsxImportSource hono/jsx */
import { Hono, type Context, type MiddlewareHandler } from "hono"
import { csrf } from "hono/csrf"

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
  parsePagination,
} from "../repos/clients"
import { createContract, getContractDetail } from "../repos/contracts"
import { createInvoice } from "../repos/invoices"
import { ClientList, ClientPage, ContractPage, Dashboard } from "../ui/dashboard"

type OperatorContext = Context<ControlPlaneEnvironment>
type MutationData = Record<string, unknown>

function requestId(context: OperatorContext): string {
  return context.req.header("Cf-Ray") ?? context.req.header("X-Request-Id") ?? crypto.randomUUID()
}

function isJson(context: OperatorContext): boolean {
  return context.req.header("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === "application/json"
}

const sameOriginMutation: MiddlewareHandler<ControlPlaneEnvironment> = async (context, next) => {
  const origin = context.req.header("Origin")
  const fetchSite = context.req.header("Sec-Fetch-Site")
  let allowedOrigin: string
  try {
    allowedOrigin = new URL(context.env.OPERATOR_ORIGIN).origin
  } catch {
    throw forbidden()
  }
  if (origin !== allowedOrigin || fetchSite && fetchSite !== "same-origin") {
    throw forbidden()
  }
  if (isJson(context) && context.req.header("X-Control-Request") !== "same-origin") {
    throw forbidden()
  }
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

async function auditMutationFailure(
  context: OperatorContext,
  action: string,
  targetType: string,
  targetId: string,
  error: SafeHttpError,
): Promise<void> {
  const audit = await prepareOperatorAuditStatement(context.env.CONTROL_DB, {
    operatorId: context.get("operator").operatorId,
    action,
    targetType,
    targetId,
    outcome: error.status === 403 ? "denied" : "error",
    requestId: requestId(context),
    metadata: { errorCode: error.code },
  })
  await context.env.CONTROL_DB.batch([audit.statement])
}

async function runMutation(
  context: OperatorContext,
  options: { action: string; targetType: string; targetId: string; run: (data: MutationData) => Promise<string> },
) {
  try {
    const data = await mutationData(context)
    const id = await options.run(data)
    if (isJson(context)) return context.json({ id }, 201)
    return context.redirect(context.req.header("Referer") ?? "/operator/clients", 303)
  } catch (error) {
    if (error instanceof SafeHttpError) {
      await auditMutationFailure(context, options.action, options.targetType, options.targetId, error)
    }
    throw error
  }
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
  routes.use("*", csrf())

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
      <ClientList clients={clients} page={pagination.page} pageSize={pagination.pageSize} />,
    )
  })
  routes.get("/clients/:clientId", async (context) => {
    const client = await getClientDetail(context.env.CONTROL_DB, context.req.param("clientId"))
    return context.html(<ClientPage client={client} />)
  })
  routes.get("/contracts/:contractId", async (context) => {
    const contract = await getContractDetail(
      context.env.CONTROL_DB,
      context.req.param("contractId"),
    )
    return context.html(<ContractPage contract={contract} />)
  })

  routes.post(
    "/clients",
    sameOriginMutation,
    requireOperatorRole("vendor_owner"),
    (context) => runMutation(context, {
      action: "client.create",
      targetType: "client",
      targetId: "pending",
      run: (data) => createClient(context.env.CONTROL_DB, data as never, actor(context)),
    }),
  )
  routes.post(
    "/clients/:clientId/organisations",
    sameOriginMutation,
    requireOperatorRole("vendor_owner"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(context, {
        action: "client_organisation.create",
        targetType: "client",
        targetId: clientId,
        run: (data) => createClientOrganisation(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      })
    },
  )
  routes.post(
    "/clients/:clientId/deployments",
    sameOriginMutation,
    requireOperatorRole("vendor_owner"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(context, {
        action: "deployment.create",
        targetType: "client",
        targetId: clientId,
        run: (data) => createDeployment(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      })
    },
  )
  routes.post(
    "/clients/:clientId/contracts",
    sameOriginMutation,
    requireOperatorRole("vendor_owner", "billing_operator"),
    (context) => {
      const clientId = context.req.param("clientId")
      return runMutation(context, {
        action: "contract.create",
        targetType: "client",
        targetId: clientId,
        run: (data) => createContract(context.env.CONTROL_DB, clientId, data as never, actor(context)),
      })
    },
  )
  routes.post(
    "/contracts/:contractId/invoices",
    sameOriginMutation,
    requireOperatorRole("vendor_owner", "billing_operator"),
    (context) => {
      const contractId = context.req.param("contractId")
      return runMutation(context, {
        action: "invoice.create",
        targetType: "contract",
        targetId: contractId,
        run: (data) => createInvoice(context.env.CONTROL_DB, contractId, data as never, actor(context)),
      })
    },
  )

  return routes
}
