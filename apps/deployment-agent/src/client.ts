import {
  deploymentRequestTranscript,
  lowercaseHex,
  sha256,
  toBase64Url,
} from "@crm/control-protocol/deployment-auth"
import { ModuleIdSchema, StrictSemverSchema } from "@crm/control-protocol"
import {
  CommandAckSchema,
  CommandEnvelopeSchema,
  DeploymentHeartbeatSchema,
  type DeploymentHeartbeat,
} from "@crm/control-protocol"
import { z } from "zod"

export type DeploymentClientConfig = {
  controlPlaneUrl: string
  deploymentId: string
  environment: "development" | "staging" | "production"
  installationToken?: string
  webInternalUrl: string
  webSecret: string
  applicationVersion: string
  agentVersion: string
  imageDigest: string
  migrationVersion: string
}

export type DeploymentClientIdentity = {
  deploymentId: string
  environment: "development" | "staging" | "production"
  keyId: string
  privateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string }
}

export type ClaimedCommand = z.infer<typeof claimedCommandSchema>

const MAX_RESPONSE_BYTES = 131_072
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value
    } catch {
      return false
    }
  })
const opaqueVersionSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)
const migrationVersionSchema = z.string().regex(/^[0-9]{4}$/)
const decimalRevisionSchema = z.string().regex(/^[1-9]\d{0,9}$/).refine((value) => Number(value) <= 2_147_483_647)

const registrationResponseSchema = z.object({ deploymentId: uuidSchema, keyId: uuidSchema }).strict()
const claimedCommandSchema = z.object({
  id: uuidSchema,
  deploymentId: uuidSchema,
  vendorKeyId: opaqueVersionSchema,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  enqueuedAt: timestampSchema,
  claimedAt: timestampSchema.nullable(),
  envelope: CommandEnvelopeSchema,
}).strict()
const statusResponseSchema = z.object({
  healthState: z.enum(["healthy", "degraded", "unhealthy"]),
  entitlement: z.object({
    revision: decimalRevisionSchema.nullable(),
    configurationVersion: opaqueVersionSchema.nullable(),
    mode: z.enum(["active", "grace", "read_only"]).nullable(),
    enabledModuleIds: z.array(ModuleIdSchema).max(32)
      .refine((values) => new Set(values).size === values.length),
  }).strict(),
  activeUserCount: z.number().int().min(0).max(100_000),
  reservedInvitationCount: z.number().int().min(0).max(100_000),
  applicationVersion: StrictSemverSchema,
  migrationVersion: migrationVersionSchema,
}).strict().superRefine((status, context) => {
  const hasEntitlement = status.entitlement.revision !== null
  if (hasEntitlement && (status.entitlement.mode === null || status.healthState === "unhealthy")) {
    context.addIssue({ code: "custom", path: ["entitlement"], message: "inconsistent entitlement status" })
  }
  if (!hasEntitlement && (
    status.entitlement.mode !== null ||
    status.entitlement.configurationVersion !== null ||
    status.entitlement.enabledModuleIds.length !== 0 ||
    status.healthState !== "unhealthy"
  )) {
    context.addIssue({ code: "custom", path: ["entitlement"], message: "inconsistent missing entitlement" })
  }
})
const heartbeatResponseSchema = z.object({
  accepted: z.literal(true),
  entitlement: z.object({ version: z.number().int().min(1).max(2_147_483_647) }).strict().nullable(),
}).strict()
const entitlementEnvelopeSchema = z.object({
  keyId: z.string().min(1).max(128),
  payload: z.unknown(),
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/).max(512),
}).strict()
const applyResponseSchema = z.object({
  outcome: z.enum(["accepted", "idempotent"]),
  revision: z.number().int().min(1),
  mode: z.enum(["active", "grace", "read_only"]),
}).strict()

const commandAckResponseSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  completedAt: z.string(),
}).strict()

export type CommandAckResult = z.infer<typeof commandAckResponseSchema>

export type WebDeploymentStatus = z.infer<typeof statusResponseSchema>

export class AgentRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly repairRequired = false,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code)
  }
}

export function parseRetryAfterMs(headers: Headers, now: Date): number | null {
  const value = headers.get("Retry-After")
  if (value === null) return null
  let milliseconds: number
  if (/^\d+$/.test(value)) milliseconds = Number(value) * 1_000
  else milliseconds = Date.parse(value) - now.getTime()
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null
  return Math.min(300_000, milliseconds)
}

async function fetchResponse(
  fetchImplementation: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  now: () => Date,
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImplementation(input, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new AgentRequestError("network_error", true)
  }
  if (response.status === 401 || response.status === 403) {
    throw new AgentRequestError("identity_rejected", false, true)
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new AgentRequestError(
      `http_${response.status}`,
      true,
      false,
      response.status === 429 ? parseRetryAfterMs(response.headers, now()) : null,
    )
  }
  return response
}

async function readBounded(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length")
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
    throw new AgentRequestError("response_too_large", false)
  }
  if (response.body === null) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AgentRequestError("response_too_large", false)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new AgentRequestError("invalid_response", false)
  }
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new AgentRequestError("invalid_response", false)
  }
  try {
    return schema.parse(JSON.parse(await readBounded(response)))
  } catch (error) {
    if (error instanceof AgentRequestError) throw error
    throw new AgentRequestError("invalid_response", false)
  }
}

async function importPrivateKey(identity: DeploymentClientIdentity): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { ...identity.privateJwk, ext: true, key_ops: ["sign"] },
      "Ed25519",
      false,
      ["sign"],
    )
  } catch {
    throw new Error("Agent identity is corrupt")
  }
}

export function createDeploymentClient(input: {
  config: DeploymentClientConfig
  fetch?: typeof globalThis.fetch
  now?: () => Date
  randomBytes?: (length: number) => Uint8Array<ArrayBuffer>
}) {
  const fetchImplementation = input.fetch ?? globalThis.fetch
  const now = input.now ?? (() => new Date())
  const randomBytes = input.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)))

  async function signedHeaders(
    identity: DeploymentClientIdentity,
    method: "GET" | "POST",
    path: string,
    bodyBytes: Uint8Array<ArrayBuffer>,
  ): Promise<Headers> {
    const timestamp = now().toISOString()
    const nonce = toBase64Url(randomBytes(32))
    const transcript = deploymentRequestTranscript({
      method,
      path,
      deploymentId: input.config.deploymentId,
      keyId: identity.keyId,
      timestamp,
      nonce,
      bodyDigestHex: lowercaseHex(await sha256(bodyBytes)),
    })
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      await importPrivateKey(identity),
      transcript,
    )))
    return new Headers({
      "X-Deployment-Key-Id": identity.keyId,
      "X-Deployment-Timestamp": timestamp,
      "X-Deployment-Nonce": nonce,
      "X-Deployment-Signature": signature,
    })
  }

  return {
    async register(identity: DeploymentClientIdentity, signal: AbortSignal): Promise<{ deploymentId: string; keyId: string }> {
      if (!input.config.installationToken) throw new Error("Installation token is required")
      const body = JSON.stringify({
        installationToken: input.config.installationToken,
        deploymentId: input.config.deploymentId,
        environment: input.config.environment,
        keyId: identity.keyId,
        publicKey: { kty: "OKP", crv: "Ed25519", x: identity.privateJwk.x },
        agentVersion: input.config.agentVersion,
      })
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.controlPlaneUrl}/v1/deployments/register`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal },
        now,
      )
      if (response.status !== 201) throw new AgentRequestError(`http_${response.status}`, false)
      const result = await parseJson(response, registrationResponseSchema)
      if (result.deploymentId !== input.config.deploymentId || result.keyId !== identity.keyId) {
        throw new AgentRequestError("deployment_mismatch", false)
      }
      return result
    },

    async status(signal: AbortSignal): Promise<WebDeploymentStatus> {
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.webInternalUrl}/api/internal/deployment/status`,
        { headers: { Authorization: `Bearer ${input.config.webSecret}` }, signal },
        now,
      )
      if (response.status !== 200) throw new AgentRequestError(`http_${response.status}`, false)
      return parseJson(response, statusResponseSchema)
    },

    async heartbeat(
      identity: DeploymentClientIdentity,
      heartbeat: DeploymentHeartbeat,
      signal: AbortSignal,
    ): Promise<z.infer<typeof heartbeatResponseSchema>> {
      const parsed = DeploymentHeartbeatSchema.parse(heartbeat)
      const body = JSON.stringify(parsed)
      const bytes = new TextEncoder().encode(body)
      const path = `/v1/deployments/${input.config.deploymentId}/heartbeat`
      const headers = await signedHeaders(identity, "POST", path, bytes)
      headers.set("Content-Type", "application/json")
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.controlPlaneUrl}${path}`,
        { method: "POST", headers, body, signal },
        now,
      )
      if (response.status !== 202) throw new AgentRequestError(`http_${response.status}`, false)
      return parseJson(response, heartbeatResponseSchema)
    },

    async entitlement(
      identity: DeploymentClientIdentity,
      version: number,
      signal: AbortSignal,
    ): Promise<{ raw: string; envelope: z.infer<typeof entitlementEnvelopeSchema> }> {
      const path = `/v1/deployments/${input.config.deploymentId}/entitlement/${version}`
      const headers = await signedHeaders(identity, "GET", path, new Uint8Array())
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.controlPlaneUrl}${path}`,
        { headers, signal },
        now,
      )
      if (response.status !== 200) throw new AgentRequestError(`http_${response.status}`, false)
      if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        throw new AgentRequestError("invalid_response", false)
      }
      const raw = await readBounded(response)
      try {
        return { raw, envelope: entitlementEnvelopeSchema.parse(JSON.parse(raw)) }
      } catch {
        throw new AgentRequestError("invalid_response", false)
      }
    },

    async applyEntitlement(raw: string, expectedVersion: number, signal: AbortSignal): Promise<void> {
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.webInternalUrl}/api/internal/deployment/entitlement`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${input.config.webSecret}`,
            "Content-Type": "application/json",
          },
          body: raw,
          signal,
        },
        now,
      )
      if (response.status !== 200) {
        throw new AgentRequestError(`http_${response.status}`, false)
      }
      const result = await parseJson(response, applyResponseSchema)
      if (result.revision !== expectedVersion) {
        throw new AgentRequestError("entitlement_not_accepted", false)
      }
    },

async nextCommand(identity: DeploymentClientIdentity, signal: AbortSignal): Promise<ClaimedCommand | null> {
      const path = `/v1/deployments/${input.config.deploymentId}/commands/next`
      const headers = await signedHeaders(identity, "GET", path, new Uint8Array())
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.controlPlaneUrl}${path}`,
        { headers, signal },
        now,
      )
      if (response.status === 204) return null
      if (response.status !== 200) {
        throw new AgentRequestError(`http_${response.status}`, response.status >= 500 || response.status === 429)
      }
      const text = await readBounded(response)
      const trimmed = text.trim()
      if (trimmed === "" || trimmed === "null") return null
      const parsed = claimedCommandSchema.safeParse(JSON.parse(trimmed))
      if (!parsed.success) {
        throw new AgentRequestError("invalid_response", false)
      }
      return parsed.data
    },

    async acknowledgeCommand(
      identity: DeploymentClientIdentity,
      commandId: string,
      ack: unknown,
      signal: AbortSignal,
    ): Promise<CommandAckResult> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(commandId)) {
        throw new AgentRequestError("command_id_invalid", false)
      }
      const path = `/v1/deployments/${input.config.deploymentId}/commands/${commandId}/ack`
      const body = JSON.stringify(ack)
      const bytes = new TextEncoder().encode(body)
      const headers = await signedHeaders(identity, "POST", path, bytes)
      headers.set("Content-Type", "application/json")
      const response = await fetchResponse(
        fetchImplementation,
        `${input.config.controlPlaneUrl}${path}`,
        { method: "POST", headers, body, signal },
        now,
      )
      if (response.status !== 200) {
        throw new AgentRequestError(`http_${response.status}`, response.status >= 500 || response.status === 429)
      }
      return parseJson(response, commandAckResponseSchema)
    },
  }
}

export type DeploymentClient = ReturnType<typeof createDeploymentClient>
