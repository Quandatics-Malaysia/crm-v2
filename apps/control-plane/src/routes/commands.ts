import { CommandAckSchema, type CommandEnvelope } from "@crm/control-protocol"
import { Hono } from "hono"
import { z } from "zod"

import {
  deploymentRequestTranscript,
  fromBase64Url as decodeBase64Url,
  heartbeatNonceDigest as recordNonceDigest,
  HEARTBEAT_NONCE_TTL_MS,
  importStrictEd25519PublicJwk as importPublicJwk,
  lowercaseHex,
  parseCanonicalRequestTimestamp,
  publicKeyFingerprint,
  readBoundedRequestBody,
  sha256,
  timingSafeDigestEqual,
} from "../auth/deployment"
import type { ControlPlaneEnvironment } from "../index"
import { badRequest, notFound, unauthorized } from "../http/errors"
import {
  acknowledgeCommand,
  claimNextPendingCommand,
  enqueueCommand,
  readCommandEnvelope,
} from "../repos/commands"
import { getActiveDeploymentKey } from "../repos/deployments"

const LEGACY_PENDING_FINGERPRINT = "legacy:pending"

function replayGuardHeader(headers: Headers, name: string): string {
  const value = headers.get(name)
  if (value === null || value.includes(",")) throw unauthorized()
  return value
}

function guardedFromBase64Url(value: string, expectedBytes: number): Uint8Array<ArrayBuffer> {
  try {
    return decodeBase64Url(value, expectedBytes)
  } catch {
    throw unauthorized()
  }
}

function guardedDigestEqual(left: Uint8Array<ArrayBuffer>, right: Uint8Array<ArrayBuffer>): boolean {
  try {
    return timingSafeDigestEqual(left, right)
  } catch {
    throw unauthorized()
  }
}

function guardedTimestamp(value: string, now: Date): Date {
  return parseCanonicalRequestTimestamp(value, now)
}

async function authenticatedRequest(
  database: D1Database,
  request: Request,
  deploymentId: string,
  method: "GET" | "POST",
  path: string,
  bodyBytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const headers = request.headers
  const keyId = replayGuardHeader(headers, "X-Deployment-Key-Id")
  const timestampValue = replayGuardHeader(headers, "X-Deployment-Timestamp")
  const nonceValue = replayGuardHeader(headers, "X-Deployment-Nonce")
  const signatureValue = replayGuardHeader(headers, "X-Deployment-Signature")
  const now = new Date()
  guardedTimestamp(timestampValue, now)
  const nonce = guardedFromBase64Url(nonceValue, 32)
  const signature = guardedFromBase64Url(signatureValue, 64)
  const key = await getActiveDeploymentKey(database, deploymentId, keyId, now.toISOString())
  if (!key) throw unauthorized()
  if (key.fingerprint === LEGACY_PENDING_FINGERPRINT) throw unauthorized()
  const jwk = JSON.parse(key.public_jwk_json) as { kty: "OKP"; crv: "Ed25519"; x: string }
  const fingerprint = await publicKeyFingerprint(jwk.x)
  if (!guardedDigestEqual(guardedFromBase64Url(fingerprint, 32), guardedFromBase64Url(key.fingerprint, 32))) {
    throw unauthorized()
  }
  const digest = lowercaseHex(await sha256(bodyBytes))
  const verified = await crypto.subtle.verify(
    "Ed25519",
    await importPublicJwk(jwk),
    signature,
    deploymentRequestTranscript({
      method,
      path,
      deploymentId,
      keyId,
      timestamp: timestampValue,
      nonce: nonceValue,
      bodyDigestHex: digest,
    }),
  )
  if (!verified) throw unauthorized()
  const nonceDigest = await recordNonceDigest(key.id, nonce)
  await database.prepare(
    "INSERT INTO deployment_request_nonces (deployment_key_id, nonce_digest, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).bind(
    key.id,
    nonceDigest,
    new Date(Date.parse(timestampValue) + HEARTBEAT_NONCE_TTL_MS).toISOString(),
    now.toISOString(),
  ).run()
}

function rejectCrossOrigin(method: string, request: Request): void {
  if (method === "GET" || method === "HEAD") return
  const origin = request.headers.get("Origin")
  if (origin !== null && origin !== "") throw unauthorized()
}

const enqueuePayloadSchema = z.object({
  envelope: z.unknown(),
}).strict()

export function createCommandRoutes() {
  const routes = new Hono<ControlPlaneEnvironment>()

  routes.post("/:id/commands/enqueue", async (context) => {
    const deploymentId = context.req.param("id")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deploymentId)) {
      throw notFound()
    }
    rejectCrossOrigin(context.req.method, context.req.raw)
    const path = new URL(context.req.url).pathname
    const bodyBytes = await readBoundedRequestBody(context.req.raw)
    await authenticatedRequest(
      context.env.CONTROL_DB,
      context.req.raw,
      deploymentId,
      "POST",
      path,
      bodyBytes,
    )
    const decoded = JSON.parse(new TextDecoder().decode(bodyBytes))
    const payload = enqueuePayloadSchema.parse(decoded)
    const envelope = payload.envelope as CommandEnvelope
    const stored = await enqueueCommand(context.env.CONTROL_DB, { envelope, actor: null })
    return context.json({ id: stored.id, createdAt: stored.createdAt }, 202)
  })

  routes.post("/:id/commands/:cid/ack", async (context) => {
    const deploymentId = context.req.param("id")
    const commandId = context.req.param("cid")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deploymentId)) {
      throw notFound()
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(commandId)) {
      throw notFound()
    }
    rejectCrossOrigin(context.req.method, context.req.raw)
    const expectedPath = `/v1/deployments/${deploymentId}/commands/${commandId}/ack`
    if (new URL(context.req.url).pathname !== expectedPath) throw unauthorized()
    const bodyBytes = await readBoundedRequestBody(context.req.raw)
    await authenticatedRequest(
      context.env.CONTROL_DB,
      context.req.raw,
      deploymentId,
      "POST",
      expectedPath,
      bodyBytes,
    )
    const decoded = JSON.parse(new TextDecoder().decode(bodyBytes))
    const ack = CommandAckSchema.parse(decoded)
    if (ack.commandId !== commandId || ack.deploymentId !== deploymentId) {
      throw badRequest("ack_target_mismatch")
    }
    const stored = await readCommandEnvelope(context.env.CONTROL_DB, commandId)
    if (stored?.deploymentId !== deploymentId) throw notFound()
    const result = await acknowledgeCommand(context.env.CONTROL_DB, {
      commandId,
      deploymentId,
      ack,
    })
    return context.json({ id: result.id, completedAt: result.completedAt }, 200)
  })

  routes.get("/:id/commands/next", async (context) => {
    const deploymentId = context.req.param("id")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deploymentId)) {
      throw notFound()
    }
    const expectedPath = `/v1/deployments/${deploymentId}/commands/next`
    const requestedPath = new URL(context.req.url).pathname
    if (requestedPath !== expectedPath) throw unauthorized()
    await authenticatedRequest(
      context.env.CONTROL_DB,
      context.req.raw,
      deploymentId,
      "GET",
      expectedPath,
      new Uint8Array(),
    )
    const claimed = await claimNextPendingCommand(
      context.env.CONTROL_DB,
      deploymentId,
      new Date().toISOString(),
    )
    if (claimed === null) return context.json(null, 200)
    return context.json({
      id: claimed.id,
      deploymentId: claimed.deploymentId,
      vendorKeyId: claimed.vendorKeyId,
      issuedAt: claimed.issuedAt,
      expiresAt: claimed.expiresAt,
      enqueuedAt: claimed.createdAt,
      claimedAt: claimed.claimedAt,
      envelope: claimed.envelope,
    }, 200)
  })

  return routes
}
