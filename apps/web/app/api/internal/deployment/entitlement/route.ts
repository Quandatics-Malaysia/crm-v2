import {
  applySignedEntitlement,
  getDeploymentAccess,
  type EntitlementApplicationResult,
} from "@/lib/deployment-control"
import {
  authenticateInternalAgent,
  loadInternalDeploymentEnv,
  type InternalAgentAuthentication,
  type InternalDeploymentEnv,
} from "@/lib/internal-agent-auth"
import {
  internalJsonResponse,
  internalRequestMetadata,
  logInternalDeploymentApi,
  type InternalDeploymentApiLog,
} from "@/lib/internal-deployment-api"
import { InternalJsonRequestError, readInternalJsonObject } from "@/lib/internal-json"
import {
  assertWriteAllowed,
  type OperationalWriteAccessCheck,
} from "@/lib/write-access"
import { revalidatePath } from "next/cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SAFE_REJECTION_REASONS = new Set([
  "revision_downgrade",
  "revision_conflict",
  "deployment_binding_conflict",
  "deployment_mismatch",
  "malformed_envelope",
  "unknown_key",
  "invalid_signature",
  "invalid_payload",
  "trust_key_not_valid",
  "expired_lease",
  "invalid_modules",
  "noncanonical_payload",
  "envelope_too_large",
  "trust_set_invalid",
])

type EntitlementRouteDependencies = {
  authorizeWrite: OperationalWriteAccessCheck
  authenticate(request: Request): InternalAgentAuthentication
  loadEnvironment(): InternalDeploymentEnv
  readBody(request: Request): Promise<{ value: Record<string, unknown>; bodyBytes: number }>
  apply(value: unknown, deploymentId: string): Promise<EntitlementApplicationResult>
  getAccess(): Promise<{ mode: "active" | "grace" | "read_only"; revision: number | null }>
  invalidate(): void
  log(entry: InternalDeploymentApiLog): void
}

export type ProductionEntitlementDal = Pick<EntitlementRouteDependencies, "apply" | "getAccess">

const productionDal: ProductionEntitlementDal = {
  apply: applySignedEntitlement,
  getAccess: getDeploymentAccess,
}

export function createEntitlementRoute(dependencies: EntitlementRouteDependencies) {
  return async function put(request: Request): Promise<Response> {
    const metadata = internalRequestMetadata(request)
    let bodyBytes: number | null = null
    const writeLog = (
      outcome: InternalDeploymentApiLog["outcome"],
      reason: string | null,
      revision: number | null,
      status: number,
    ) => dependencies.log({
      event: "internal_deployment_api",
      route: "entitlement",
      method: "PUT",
      outcome,
      reason,
      revision,
      status,
      ...metadata,
      bodyBytes,
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

    // Entitlement apply is an explicit recovery operation. Keeping this call at
    // the direct route boundary proves it bypasses commercial read-only mode
    // without bypassing agent authentication or envelope verification.
    await dependencies.authorizeWrite({ operation: "license_apply" })

    let environment: InternalDeploymentEnv
    try {
      environment = dependencies.loadEnvironment()
    } catch {
      writeLog("error", "server_configuration", null, 500)
      return internalJsonResponse({ error: { code: "internal_error" } }, 500)
    }

    let candidate: Record<string, unknown>
    try {
      const parsed = await dependencies.readBody(request)
      candidate = parsed.value
      bodyBytes = parsed.bodyBytes
    } catch (error) {
      if (error instanceof InternalJsonRequestError) {
        writeLog("invalid_request", error.code, null, error.status)
        return internalJsonResponse({ error: { code: error.code } }, error.status)
      }
      writeLog("error", "body_read_failed", null, 500)
      return internalJsonResponse({ error: { code: "internal_error" } }, 500)
    }

    let result: EntitlementApplicationResult
    try {
      result = await dependencies.apply(candidate, environment.deploymentId)
    } catch {
      writeLog("error", "database_unavailable", null, 503)
      return internalJsonResponse({ error: { code: "internal_error" } }, 503)
    }

    if (result.outcome === "rejected") {
      if (!SAFE_REJECTION_REASONS.has(result.reason)) {
        writeLog("error", "invalid_apply_result", null, 503)
        return internalJsonResponse({ error: { code: "internal_error" } }, 503)
      }
      const status = result.reason === "revision_downgrade" || result.reason === "revision_conflict" ? 409 : 422
      writeLog("rejected", result.reason, result.revision, status)
      return internalJsonResponse({
        error: { code: "entitlement_rejected", reason: result.reason },
        currentRevision: result.revision,
      }, status)
    }

    try {
      const access = await dependencies.getAccess()
      if (result.revision === null || access.revision !== result.revision) {
        throw new Error("Inconsistent applied entitlement state")
      }
      dependencies.invalidate()
      writeLog(result.outcome, null, result.revision, 200)
      return internalJsonResponse({
        outcome: result.outcome,
        revision: result.revision,
        mode: access.mode,
      }, 200)
    } catch {
      writeLog("error", "database_unavailable", result.revision, 503)
      return internalJsonResponse({ error: { code: "internal_error" } }, 503)
    }
  }
}

export function createProductionEntitlementRoute(
  dal: ProductionEntitlementDal = productionDal,
) {
  return createEntitlementRoute({
    authorizeWrite: assertWriteAllowed,
    authenticate: authenticateInternalAgent,
    loadEnvironment: loadInternalDeploymentEnv,
    readBody: readInternalJsonObject,
    log: logInternalDeploymentApi,
    invalidate: () => {
      // Cache invalidation is a freshness hint only; every server entrypoint
      // still rechecks entitlement. Applying a valid bundle must not fail if
      // the current runtime has no revalidation context.
      try {
        revalidatePath("/", "layout")
      } catch {
        // No-op: stale client navigation is non-authoritative.
      }
    },
    ...dal,
  })
}

export const PUT = createProductionEntitlementRoute()
