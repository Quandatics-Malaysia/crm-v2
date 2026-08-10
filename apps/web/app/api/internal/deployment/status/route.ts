import { getDeploymentStatus, type DeploymentStatus } from "@/lib/deployment-status"
import {
  authenticateInternalAgent,
  loadInternalDeploymentEnv,
  type InternalAgentAuthentication,
} from "@/lib/internal-agent-auth"
import {
  internalJsonResponse,
  internalRequestMetadata,
  logInternalDeploymentApi,
  type InternalDeploymentApiLog,
} from "@/lib/internal-deployment-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StatusRouteDependencies = {
  authenticate(request: Request): InternalAgentAuthentication
  loadEnvironment(): unknown
  getStatus(): Promise<DeploymentStatus>
  log(entry: InternalDeploymentApiLog): void
}

export type ProductionStatusDal = Pick<StatusRouteDependencies, "getStatus">

const productionDal: ProductionStatusDal = {
  getStatus: getDeploymentStatus,
}

export function createStatusRoute(dependencies: StatusRouteDependencies) {
  return async function get(request: Request): Promise<Response> {
    const metadata = internalRequestMetadata(request)
    const writeLog = (
      outcome: InternalDeploymentApiLog["outcome"],
      reason: string | null,
      revision: number | null,
      status: number,
    ) => dependencies.log({
      event: "internal_deployment_api",
      route: "status",
      method: "GET",
      outcome,
      reason,
      revision,
      status,
      ...metadata,
      bodyBytes: null,
    })

    const authentication = dependencies.authenticate(request)
    if (authentication === "unauthorized") {
      writeLog("unauthorized", null, null, 401)
      return internalJsonResponse(
        { error: { code: "unauthorized" } },
        401,
        { "WWW-Authenticate": "Bearer" },
      )
    }
    if (authentication === "misconfigured") {
      writeLog("error", "server_configuration", null, 500)
      return internalJsonResponse({ error: { code: "internal_error" } }, 500)
    }
    try {
      dependencies.loadEnvironment()
    } catch {
      writeLog("error", "server_configuration", null, 500)
      return internalJsonResponse({ error: { code: "internal_error" } }, 500)
    }

    try {
      const status = await dependencies.getStatus()
      const revision = status.entitlement.revision === null ? null : Number(status.entitlement.revision)
      writeLog("accepted", null, revision, 200)
      return internalJsonResponse(status, 200)
    } catch {
      writeLog("error", "database_unavailable", null, 503)
      return internalJsonResponse({ error: { code: "internal_error" } }, 503)
    }
  }
}

export function createProductionStatusRoute(dal: ProductionStatusDal = productionDal) {
  return createStatusRoute({
    authenticate: authenticateInternalAgent,
    loadEnvironment: loadInternalDeploymentEnv,
    log: logInternalDeploymentApi,
    ...dal,
  })
}

export const GET = createProductionStatusRoute()
