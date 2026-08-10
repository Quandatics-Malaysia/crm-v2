import {
  DeploymentHeartbeatSchema,
  DeploymentRegistrationSchema,
} from "@crm/control-protocol/heartbeat"
import { Hono } from "hono"

import {
  exactDeploymentHeader,
  fromBase64Url,
  HEARTBEAT_NONCE_TTL_MS,
  heartbeatNonceDigest,
  heartbeatTranscript,
  importStrictEd25519PublicJwk,
  lowercaseHex,
  parseCanonicalRequestTimestamp,
  publicKeyFingerprint,
  readBoundedRequestBody,
  sha256,
  timingSafeDigestEqual,
} from "../auth/deployment"
import type { ControlPlaneEnvironment } from "../index"
import { badRequest, unauthorized } from "../http/errors"
import {
  getActiveDeploymentKey,
  recordHeartbeat,
  registerDeployment,
} from "../repos/deployments"

const decoder = new TextDecoder("utf-8", { fatal: true })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const legacyKeyIdPattern = /^[A-Za-z0-9._-]{1,128}$/
const LEGACY_PENDING_FINGERPRINT = "legacy:pending"
const MAX_JSON_DEPTH = 64

export function isSafeOpaqueLegacyKeyId(value: string): boolean {
  return legacyKeyIdPattern.test(value)
}

function requestId(headers: Headers): string | null {
  return headers.get("Cf-Ray") ?? headers.get("X-Request-Id")
}

function requireJsonContentType(headers: Headers): void {
  if (headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw badRequest()
  }
}

function decodeUtf8(body: Uint8Array): string {
  try {
    return decoder.decode(body)
  } catch {
    throw badRequest()
  }
}

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0
  const whitespace = /[\t\n\r ]/

  function skipWhitespace(): void {
    while (index < text.length && whitespace.test(text[index]!)) index += 1
  }

  function parseString(): string {
    if (text[index] !== '"') throw badRequest()
    const start = index
    index += 1
    while (index < text.length) {
      const character = text[index]!
      if (character === '"') {
        index += 1
        try {
          return JSON.parse(text.slice(start, index)) as string
        } catch {
          throw badRequest()
        }
      }
      if (character === "\\") {
        index += 2
      } else {
        index += 1
      }
    }
    throw badRequest()
  }

  function parseValue(depth: number): void {
    if (depth > MAX_JSON_DEPTH) throw badRequest()
    skipWhitespace()
    if (text[index] === '"') {
      parseString()
      return
    }
    if (text[index] === "{") {
      index += 1
      skipWhitespace()
      if (text[index] === "}") {
        index += 1
        return
      }
      const keys = new Set<string>()
      while (index < text.length) {
        skipWhitespace()
        const key = parseString()
        if (keys.has(key)) throw badRequest()
        keys.add(key)
        skipWhitespace()
        if (text[index] !== ":") throw badRequest()
        index += 1
        parseValue(depth + 1)
        skipWhitespace()
        if (text[index] === "}") {
          index += 1
          return
        }
        if (text[index] !== ",") throw badRequest()
        index += 1
      }
      throw badRequest()
    }
    if (text[index] === "[") {
      index += 1
      skipWhitespace()
      if (text[index] === "]") {
        index += 1
        return
      }
      while (index < text.length) {
        parseValue(depth + 1)
        skipWhitespace()
        if (text[index] === "]") {
          index += 1
          return
        }
        if (text[index] !== ",") throw badRequest()
        index += 1
      }
      throw badRequest()
    }

    const start = index
    while (index < text.length && !/[\t\n\r ,}\]]/.test(text[index]!)) index += 1
    if (index === start) throw badRequest()
  }

  parseValue(0)
  skipWhitespace()
  if (index !== text.length) throw badRequest()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw badRequest()
  }
}

async function requestJson(request: Request): Promise<{ bytes: Uint8Array; value: unknown }> {
  let bytes: Uint8Array
  try {
    bytes = await readBoundedRequestBody(request)
  } catch {
    throw badRequest()
  }
  return { bytes, value: parseJsonWithoutDuplicateKeys(decodeUtf8(bytes)) }
}

function storedPublicJwk(
  value: string,
  allowLegacyMetadata: boolean,
): { kty: "OKP"; crv: "Ed25519"; x: string } {
  try {
    const candidate: unknown = JSON.parse(value)
    if (
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate !== "object"
    ) {
      throw unauthorized()
    }
    const parsed = candidate as Record<string, unknown>
    const keys = Object.keys(parsed)
    if (
      parsed.kty !== "OKP" ||
      parsed.crv !== "Ed25519" ||
      typeof parsed.x !== "string" ||
      Object.hasOwn(parsed, "d")
    ) {
      throw unauthorized()
    }
    if (
      !allowLegacyMetadata &&
      (keys.length !== 3 || keys.some((key) => !["kty", "crv", "x"].includes(key)))
    ) {
      throw unauthorized()
    }
    if (allowLegacyMetadata) {
      const allowedKeys = new Set(["kty", "crv", "x", "key_ops", "ext", "alg", "use", "kid"])
      if (keys.some((key) => !allowedKeys.has(key))) throw unauthorized()
      if (
        parsed.key_ops !== undefined &&
        (!Array.isArray(parsed.key_ops) ||
          parsed.key_ops.length !== 1 ||
          parsed.key_ops[0] !== "verify")
      ) {
        throw unauthorized()
      }
      if (parsed.ext !== undefined && typeof parsed.ext !== "boolean") throw unauthorized()
      if (parsed.alg !== undefined && parsed.alg !== "EdDSA") throw unauthorized()
      if (parsed.use !== undefined && parsed.use !== "sig") throw unauthorized()
      if (
        parsed.kid !== undefined &&
        (typeof parsed.kid !== "string" || !/^[\x21-\x7e]{1,128}$/.test(parsed.kid))
      ) {
        throw unauthorized()
      }
    }
    return { kty: "OKP", crv: "Ed25519", x: parsed.x }
  } catch {
    throw unauthorized()
  }
}

export function createDeploymentRoutes() {
  const routes = new Hono<ControlPlaneEnvironment>()

  routes.post("/register", async (context) => {
    requireJsonContentType(context.req.raw.headers)
    const { value } = await requestJson(context.req.raw)
    const parsed = DeploymentRegistrationSchema.safeParse(value)
    if (!parsed.success) throw badRequest()
    const result = await registerDeployment(
      context.env.CONTROL_DB,
      parsed.data,
      context.env.INSTALL_TOKEN_PEPPER,
      requestId(context.req.raw.headers),
    )
    return context.json(result, 201, { "Cache-Control": "no-store" })
  })

  routes.post("/:id/heartbeat", async (context) => {
    requireJsonContentType(context.req.raw.headers)
    const deploymentId = context.req.param("id")
    if (!uuidPattern.test(deploymentId)) throw unauthorized()
    if (new URL(context.req.url).pathname !== `/v1/deployments/${deploymentId}/heartbeat`) {
      throw unauthorized()
    }
    const headers = context.req.raw.headers
    const keyId = exactDeploymentHeader(headers, "X-Deployment-Key-Id")
    const serverKeyId = uuidPattern.test(keyId)
    if (!serverKeyId && !isSafeOpaqueLegacyKeyId(keyId)) throw unauthorized()
    const timestampValue = exactDeploymentHeader(headers, "X-Deployment-Timestamp")
    const nonceValue = exactDeploymentHeader(headers, "X-Deployment-Nonce")
    const signatureValue = exactDeploymentHeader(headers, "X-Deployment-Signature")
    const now = new Date()
    const timestamp = parseCanonicalRequestTimestamp(timestampValue, now)
    const nonce = fromBase64Url(nonceValue, 32)
    const signature = fromBase64Url(signatureValue, 64)

    let bodyBytes: Uint8Array<ArrayBuffer>
    try {
      bodyBytes = await readBoundedRequestBody(context.req.raw)
    } catch {
      throw badRequest()
    }
    const key = await getActiveDeploymentKey(
      context.env.CONTROL_DB,
      deploymentId,
      keyId,
      now.toISOString(),
    )
    if (!key) throw unauthorized()
    if (!serverKeyId && key.fingerprint !== LEGACY_PENDING_FINGERPRINT) throw unauthorized()
    const bodyDigest = await sha256(bodyBytes)
    let verified = false
    try {
      const legacyKey = key.fingerprint === LEGACY_PENDING_FINGERPRINT
      const jwk = storedPublicJwk(key.public_jwk_json, legacyKey)
      const derivedFingerprint = await publicKeyFingerprint(jwk.x)
      if (legacyKey) {
        key.fingerprint = derivedFingerprint
      } else {
        const fingerprintMatches = timingSafeDigestEqual(
          fromBase64Url(derivedFingerprint, 32),
          fromBase64Url(key.fingerprint, 32),
        )
        if (!fingerprintMatches) throw unauthorized()
      }
      verified = await crypto.subtle.verify(
        "Ed25519",
        await importStrictEd25519PublicJwk(jwk),
        signature,
        heartbeatTranscript({
          deploymentId,
          keyId,
          timestamp: timestampValue,
          nonce: nonceValue,
          bodyDigestHex: lowercaseHex(bodyDigest),
        }),
      )
    } catch {
      throw unauthorized()
    }
    if (!verified) throw unauthorized()

    const value = parseJsonWithoutDuplicateKeys(decodeUtf8(bodyBytes))
    const parsed = DeploymentHeartbeatSchema.safeParse(value)
    if (!parsed.success) throw badRequest()
    if (parsed.data.deploymentId !== deploymentId || parsed.data.environment !== key.environment) {
      throw badRequest()
    }

    await recordHeartbeat(context.env.CONTROL_DB, {
      key,
      heartbeat: parsed.data,
      timestamp: timestampValue,
      nonceDigest: await heartbeatNonceDigest(key.id, nonce),
      nonceExpiresAt: new Date(timestamp.getTime() + HEARTBEAT_NONCE_TTL_MS).toISOString(),
      observedAt: now.toISOString(),
      requestCorrelationId: requestId(headers),
      payloadBytes: bodyBytes.byteLength,
    })
    return context.json({ accepted: true }, 202, { "Cache-Control": "no-store" })
  })

  return routes
}
