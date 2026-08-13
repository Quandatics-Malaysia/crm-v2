/** @jsxImportSource hono/jsx */
import { Hono, type Context, type MiddlewareHandler } from "hono"
import { csrf } from "hono/csrf"
import { HTTPException } from "hono/http-exception"

import { prepareOperatorAuditStatement } from "../audit"
import { requireOperatorRole } from "../auth/rbac"
import type { ControlPlaneEnvironment } from "../index"
import { badRequest, forbidden, SafeHttpError } from "../http/errors"
import {
  createClient,
  createClientOrganisation,
  createDeployment,
  getDashboardSummary,
  getClientDetail,
  listClients,
  parseClientChildPagination,
  parseNamedPagination,
  parsePagination,
} from "../repos/clients"
import { createContract, getContractDetail } from "../repos/contracts"
import { createInvoice } from "../repos/invoices"
import { issueInstallToken } from "../repos/deployments"
import { getDeploymentWorkspace } from "../repos/onboarding"
import {
  assignEntitlementSchedule,
  issueEntitlement,
  updateEntitlementControls,
} from "../repos/entitlements"
import { ClientList, ClientPage, ContractPage, Dashboard, type OperatorNotice } from "../ui/dashboard"
import { DeploymentPage, EntitlementReviewPage, InstallTokenResultPage } from "../ui/deployment"
import { OPERATOR_STYLES } from "../ui/styles"

type OperatorContext = Context<ControlPlaneEnvironment>
type MutationData = Record<string, unknown>

const INSTALL_TOKEN_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000

const OPERATOR_NOTICES = {
  client_created: { tone: "success", title: "Client created", message: "Add contract terms to continue onboarding." },
  organisation_created: { tone: "success", title: "Organisation added", message: "Organisation details are optional and saved." },
  deployment_created: { tone: "success", title: "Deployment created", message: "Open deployment signing workspace to continue setup." },
  contract_created: { tone: "success", title: "Contract created", message: "Create deployment when commercial terms are confirmed." },
  invoice_created: { tone: "success", title: "Invoice issued", message: "Collection milestones are ready for review." },
  entitlement_schedule_updated: { tone: "success", title: "Entitlement schedule updated", message: "Configuration changes are ready for the deployment." },
  changes_saved: { tone: "success", title: "Changes saved", message: "The requested update completed." },
} as const satisfies Record<string, OperatorNotice>

function requestNotice(context: OperatorContext): OperatorNotice | undefined {
  const parameters = new URL(context.req.url).searchParams
  const code = parameters.get("notice")
  if (code === "entitlement_issued") {
    const version = parameters.get("version")
    if (version !== null && /^[1-9]\d*$/.test(version)) {
      return {
        tone: "success",
        title: `Entitlement version ${version} issued`,
        message: "Immutable history now includes the issued version.",
      }
    }
    return undefined
  }
  if (!code || !Object.hasOwn(OPERATOR_NOTICES, code)) return undefined
  return OPERATOR_NOTICES[code as keyof typeof OPERATOR_NOTICES]
}

export function requestId(context: Pick<OperatorContext, "req">): string {
  const candidate = context.req.header("Cf-Ray") ?? context.req.header("X-Request-Id")
  return candidate && /^[\x21-\x7e]{1,256}$/.test(candidate) ? candidate : crypto.randomUUID()
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
    return {
      action: "entitlement.schedule.assign",
      targetType: "deployment",
      targetId: pathname.split("/")[3]!,
    }
  }
  if (/^\/operator\/deployments\/[^/]+\/entitlements\/issue$/.test(pathname)) {
    return {
      action: "entitlement.issue",
      targetType: "deployment",
      targetId: pathname.split("/")[3]!,
    }
  }
  const installToken = /^\/operator\/deployments\/([^/]+)\/install-tokens$/.exec(pathname)
  if (installToken) {
    return { action: "install_token.issue", targetType: "deployment", targetId: installToken[1]! }
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
  return context.redirect(htmlSuccessRedirect(context), 303)
}

function htmlSuccessRedirect(context: OperatorContext): string {
  const pathname = new URL(context.req.url).pathname
  const withNotice = (path: string, notice: keyof typeof OPERATOR_NOTICES) => `${path}?notice=${notice}`
  if (pathname === "/operator/clients") return withNotice("/operator/clients", "client_created")

  const clientMutation = /^\/operator\/clients\/([^/]+)\/(organisations|deployments|contracts)$/.exec(pathname)
  if (clientMutation) {
    const notice = clientMutation[2] === "organisations"
      ? "organisation_created"
      : clientMutation[2] === "deployments"
        ? "deployment_created"
        : "contract_created"
    return withNotice(`/operator/clients/${clientMutation[1]}`, notice)
  }

  const invoiceMutation = /^\/operator\/contracts\/([^/]+)\/invoices$/.exec(pathname)
  if (invoiceMutation) return withNotice(`/operator/contracts/${invoiceMutation[1]}`, "invoice_created")
  const scheduleMutation = /^\/operator\/deployments\/([^/]+)\/entitlements\/schedule$/.exec(pathname)
  if (scheduleMutation) {
    return withNotice(`/operator/deployments/${scheduleMutation[1]}`, "entitlement_schedule_updated")
  }
  return withNotice("/operator/clients", "changes_saved")
}

function actor(context: OperatorContext) {
  return {
    operatorId: context.get("operator").operatorId,
    requestId: requestId(context),
  }
}

function installTokenExpiry(value: unknown, now = new Date()): string {
  if (typeof value !== "string") throw badRequest()
  const utcMinute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  const utcSecond = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  if (!utcMinute && !utcSecond) throw badRequest()
  const expiresAt = Date.parse(utcMinute ? `${value}:00.000Z` : value)
  if (!Number.isFinite(expiresAt)) throw badRequest()
  const canonical = new Date(expiresAt).toISOString()
  if (
    utcMinute && canonical.slice(0, 16) !== value ||
    utcSecond && canonical !== value && canonical.replace(".000Z", "Z") !== value
  ) {
    throw badRequest()
  }
  const current = now.getTime()
  if (expiresAt <= current || expiresAt > current + INSTALL_TOKEN_MAX_LIFETIME_MS) {
    throw badRequest()
  }
  return new Date(expiresAt).toISOString()
}

function positiveRevision(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw badRequest()
  const revision = Number(value)
  if (!Number.isSafeInteger(revision)) throw badRequest()
  return revision
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
  routes.use("*", csrf())

  routes.get("/styles.css", (context) => context.body(OPERATOR_STYLES, 200, {
    "Content-Type": "text/css; charset=UTF-8",
  }))
  routes.get("/install-token-copy.js", (context) => context.body(
    "document.getElementById('copy-install-token')?.addEventListener('click', async () => { const value = document.getElementById('install-token-value')?.textContent; if (value && navigator.clipboard) await navigator.clipboard.writeText(value) })",
    200,
    { "Content-Type": "text/javascript; charset=UTF-8" },
  ))

  routes.get("/", async (context) => context.html(
    <Dashboard
      operatorEmail={context.get("operator").email}
      summary={await getDashboardSummary(context.env.CONTROL_DB)}
      notice={requestNotice(context)}
    />,
  ))
  routes.get("/clients", async (context) => {
    const pagination = parsePagination(context.req.url)
    const clients = await listClients(
      context.env.CONTROL_DB,
      pagination.pageSize,
      pagination.offset,
    )
    return context.html(
      <ClientList
        clients={clients}
        page={pagination.page}
        pageSize={pagination.pageSize}
        operatorEmail={context.get("operator").email}
        notice={requestNotice(context)}
      />,
    )
  })
  routes.get("/clients/:clientId", async (context) => {
    const client = await getClientDetail(
      context.env.CONTROL_DB,
      context.req.param("clientId"),
      parseClientChildPagination(context.req.url),
    )
    return context.html(<ClientPage client={client} operatorEmail={context.get("operator").email} notice={requestNotice(context)} />)
  })
  routes.get("/contracts/:contractId", async (context) => {
    const contract = await getContractDetail(
      context.env.CONTROL_DB,
      context.req.param("contractId"),
      parseNamedPagination(context.req.url, "invoices"),
    )
    return context.html(<ContractPage contract={contract} operatorEmail={context.get("operator").email} notice={requestNotice(context)} />)
  })
  routes.get("/deployments/:deploymentId", async (context) => {
    const workspace = await getDeploymentWorkspace(
      context.env.CONTROL_DB,
      context.req.param("deploymentId"),
      new Date(),
    )
    return context.html(<DeploymentPage workspace={workspace} operatorEmail={context.get("operator").email} notice={requestNotice(context)} />)
  })
  routes.get("/deployments/:deploymentId/entitlements/review", async (context) => {
    const workspace = await getDeploymentWorkspace(
      context.env.CONTROL_DB,
      context.req.param("deploymentId"),
      new Date(),
    )
    return context.html(<EntitlementReviewPage
      workspace={workspace}
      operatorEmail={context.get("operator").email}
      idempotencyKey={crypto.randomUUID()}
    />)
  })

  routes.post(
    "/clients",
    sameOriginMutation,
    requireOperatorRole("vendor_owner"),
    (context) => runMutation(
      context,
      (data) => createClient(context.env.CONTROL_DB, data as never, actor(context)),
    ),
  )
  routes.post(
    "/clients/:clientId/organisations",
    sameOriginMutation,
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
    sameOriginMutation,
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
    sameOriginMutation,
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
    sameOriginMutation,
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
    sameOriginMutation,
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
      return isJson(context) ? context.json({ id: deploymentId }, 201) : context.redirect(htmlSuccessRedirect(context), 303)
    },
  )
  routes.post(
    "/deployments/:deploymentId/install-tokens",
    sameOriginMutation,
    requireOperatorRole("vendor_owner"),
    async (context) => {
      const data = await mutationData(context)
      const issued = await issueInstallToken(
        context.env.CONTROL_DB,
        context.req.param("deploymentId"),
        context.env.INSTALL_TOKEN_PEPPER,
        installTokenExpiry(data.expiresAt),
        actor(context),
        typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
      )
      return context.html(<InstallTokenResultPage deploymentId={context.req.param("deploymentId")} token={issued.token} expiresAt={issued.expiresAt} operatorEmail={context.get("operator").email} />)
    },
  )
  routes.post(
    "/deployments/:deploymentId/entitlements/issue",
    sameOriginMutation,
    requireOperatorRole("vendor_owner", "billing_operator"),
    async (context) => {
      const deploymentId = context.req.param("deploymentId")
      const data = await mutationData(context)
      const json = isJson(context)
      const contractId = typeof data.contractId === "string" && data.contractId.length > 0
        ? data.contractId
        : undefined
      if (!json && (data.confirmation !== "issue_entitlement" || contractId === undefined)) {
        throw badRequest()
      }
      const issued = await issueEntitlement(context.env, {
        deploymentId,
        contractId,
        issuanceKey: typeof data.idempotencyKey === "string" ? `manual:${data.idempotencyKey}` : `manual:${crypto.randomUUID()}`,
        actor: { ...actor(context), source: "operator" },
        ...json ? {} : {
          expectedContractRevision: positiveRevision(data.expectedContractRevision),
          expectedScheduleRevision: positiveRevision(data.expectedScheduleRevision),
        },
      })
      if (json) return context.json({ id: issued.id, version: issued.version }, 201)
      return context.redirect(
        `/operator/deployments/${deploymentId}?notice=entitlement_issued&version=${issued.version}`,
        303,
      )
    },
  )
  routes.post(
    "/contracts/:contractId/entitlement-controls",
    sameOriginMutation,
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
