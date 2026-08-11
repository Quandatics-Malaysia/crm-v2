import { Hono } from "hono"

import {
  deploymentRequestTranscript,
  exactDeploymentHeader,
  fromBase64Url,
  heartbeatNonceDigest,
  importStrictEd25519PublicJwk,
  lowercaseHex,
  parseCanonicalRequestTimestamp,
  publicKeyFingerprint,
  sha256,
  timingSafeDigestEqual,
  toBase64Url,
} from "../auth/deployment"
import type { ControlPlaneEnvironment } from "../index"
import { notFound, unauthorized } from "../http/errors"
import { getActiveDeploymentKey } from "../repos/deployments"
import { getEntitlement } from "../repos/entitlements"
import { isSafeOpaqueLegacyKeyId, storedPublicJwk, uuidPattern } from "./deployments"

const LEGACY_PENDING_FINGERPRINT = "legacy:pending"

async function authenticateRetrieval(
  database: D1Database,
  request: Request,
  deploymentId: string,
): Promise<void> {
  if (!uuidPattern.test(deploymentId)) throw unauthorized()
  const path = new URL(request.url).pathname
  const headers = request.headers
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
  const key = await getActiveDeploymentKey(database, deploymentId, keyId, now.toISOString())
  if (!key || !serverKeyId && key.fingerprint !== LEGACY_PENDING_FINGERPRINT) throw unauthorized()
  try {
    const legacy = key.fingerprint === LEGACY_PENDING_FINGERPRINT
    const jwk = storedPublicJwk(key.public_jwk_json, legacy)
    const fingerprint = await publicKeyFingerprint(jwk.x)
    if (!legacy && !timingSafeDigestEqual(fromBase64Url(fingerprint, 32), fromBase64Url(key.fingerprint, 32))) {
      throw unauthorized()
    }
    const digest = lowercaseHex(await sha256(new Uint8Array()))
    const verified = await crypto.subtle.verify(
      "Ed25519",
      await importStrictEd25519PublicJwk(jwk),
      signature,
      deploymentRequestTranscript({
        method: "GET",
        path,
        deploymentId,
        keyId,
        timestamp: timestampValue,
        nonce: nonceValue,
        bodyDigestHex: digest,
      }),
    )
    if (!verified) throw unauthorized()
    const nonceDigest = await heartbeatNonceDigest(key.id, nonce)
    await database.prepare(
      "INSERT INTO deployment_request_nonces (deployment_key_id, nonce_digest, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(
      key.id,
      nonceDigest,
      new Date(timestamp.getTime() + 10 * 60 * 1_000).toISOString(),
      now.toISOString(),
    ).run()
  } catch {
    throw unauthorized()
  }
}

export function createEntitlementRoutes() {
  const routes = new Hono<ControlPlaneEnvironment>()
  routes.get("/:id/entitlement/:version", async (context) => {
    const deploymentId = context.req.param("id")
    const versionValue = context.req.param("version")
    if (!/^[1-9]\d{0,9}$/.test(versionValue)) throw notFound()
    const expectedPath = `/v1/deployments/${deploymentId}/entitlement/${versionValue}`
    if (new URL(context.req.url).pathname !== expectedPath) throw unauthorized()
    await authenticateRetrieval(context.env.CONTROL_DB, context.req.raw, deploymentId)
    const record = await getEntitlement(context.env.CONTROL_DB, deploymentId, Number(versionValue))
    if (!record) throw notFound()
    const etag = toBase64Url(await sha256(new TextEncoder().encode(record.envelopeJson)))
    return new Response(record.envelopeJson, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        ETag: `"${etag}"`,
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
  return routes
}
