import "server-only"

import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"

import { StrictSemverSchema } from "@crm/control-protocol"

import { env } from "@/lib/env"

const CANONICAL_BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const APPLIED_MIGRATION_VERSION = /^[0-9]{4}$/

export type InternalAgentAuthentication = "authenticated" | "unauthorized" | "misconfigured"

export type InternalDeploymentEnv = {
  deploymentId: string
  agentWebSecret: string
  applicationVersion: string
  migrationVersion: string
}

type FixedLengthCompare = (left: Uint8Array, right: Uint8Array) => boolean

function decodeCanonicalSecret(value: string | undefined): Uint8Array | null {
  if (value === undefined || !CANONICAL_BASE64URL_32.test(value)) return null
  try {
    const decoded = Buffer.from(value, "base64url")
    if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) return null
    return decoded
  } catch {
    return null
  }
}

export function createInternalAgentAuthenticator(
  configuredSecret: string | undefined,
  compare: FixedLengthCompare = timingSafeEqual,
): (request: Request) => InternalAgentAuthentication {
  const expected = decodeCanonicalSecret(configuredSecret)
  if (expected === null) return () => "misconfigured"

  return (request) => {
    const authorization = request.headers.get("authorization")
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)
    if (!match) return "unauthorized"
    const candidate = decodeCanonicalSecret(match[1])
    if (candidate === null) return "unauthorized"
    return compare(expected, candidate) ? "authenticated" : "unauthorized"
  }
}

let cachedSecret: string | undefined
let cachedAuthenticator: ReturnType<typeof createInternalAgentAuthenticator> | undefined

export function authenticateInternalAgent(request: Request): InternalAgentAuthentication {
  if (cachedAuthenticator === undefined || cachedSecret !== env.AGENT_WEB_SECRET) {
    cachedSecret = env.AGENT_WEB_SECRET
    cachedAuthenticator = createInternalAgentAuthenticator(cachedSecret)
  }
  return cachedAuthenticator(request)
}

export function loadInternalDeploymentEnv(
  source: Record<string, string | undefined> = env,
): InternalDeploymentEnv {
  const deploymentId = source.DEPLOYMENT_ID
  const agentWebSecret = source.AGENT_WEB_SECRET
  const applicationVersion = source.APPLICATION_VERSION
  const migrationVersion = source.MIGRATION_VERSION
  if (
    deploymentId === undefined || !CANONICAL_UUID.test(deploymentId) ||
    agentWebSecret === undefined || decodeCanonicalSecret(agentWebSecret) === null ||
    applicationVersion === undefined || !StrictSemverSchema.safeParse(applicationVersion).success ||
    migrationVersion === undefined || !APPLIED_MIGRATION_VERSION.test(migrationVersion)
  ) {
    throw new TypeError("Invalid internal deployment configuration")
  }
  return { deploymentId, agentWebSecret, applicationVersion, migrationVersion }
}
