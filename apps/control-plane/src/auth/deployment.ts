import {
  deploymentNonceDigest,
  deploymentRequestTranscript,
  fromBase64Url as decodeBase64Url,
  heartbeatTranscript,
  importStrictEd25519PublicJwk as importPublicJwk,
  installTokenDigest,
  lowercaseHex,
  parseCanonicalRequestTimestamp as parseRequestTimestamp,
  publicKeyFingerprint,
  sha256,
  toBase64Url,
} from "@crm/control-protocol/deployment-auth"

import { unauthorized } from "../http/errors"

export const MAX_DEPLOYMENT_BODY_BYTES = 32_768
export const HEARTBEAT_MAX_SKEW_MS = 5 * 60 * 1_000
export const HEARTBEAT_NONCE_TTL_MS = 10 * 60 * 1_000

export {
  deploymentRequestTranscript,
  heartbeatTranscript,
  installTokenDigest,
  lowercaseHex,
  publicKeyFingerprint,
  sha256,
  toBase64Url,
}

export function fromBase64Url(value: string, expectedBytes: number): Uint8Array<ArrayBuffer> {
  try {
    return decodeBase64Url(value, expectedBytes)
  } catch {
    throw unauthorized()
  }
}

export async function heartbeatNonceDigest(keyId: string, nonce: Uint8Array): Promise<string> {
  return deploymentNonceDigest(keyId, nonce)
}

export async function importStrictEd25519PublicJwk(jwk: {
  kty: "OKP"
  crv: "Ed25519"
  x: string
}): Promise<CryptoKey> {
  try {
    return await importPublicJwk(jwk)
  } catch {
    throw unauthorized()
  }
}

export async function readBoundedRequestBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = request.headers.get("Content-Length")
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_DEPLOYMENT_BODY_BYTES) {
      throw new TypeError("Request body is invalid")
    }
  }
  if (request.body === null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_DEPLOYMENT_BODY_BYTES) {
      await reader.cancel()
      throw new TypeError("Request body is invalid")
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export function parseCanonicalRequestTimestamp(value: string, now: Date): Date {
  try {
    return parseRequestTimestamp(value, now, HEARTBEAT_MAX_SKEW_MS)
  } catch {
    throw unauthorized()
  }
}

export function exactDeploymentHeader(headers: Headers, name: string): string {
  const value = headers.get(name)
  if (value === null || value.includes(",")) throw unauthorized()
  return value
}

export function timingSafeDigestEqual(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): boolean {
  if (left.byteLength !== 32 || right.byteLength !== 32) throw new TypeError("Digest size is invalid")
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(left: BufferSource, right: BufferSource): boolean
  }
  return subtle.timingSafeEqual(left, right)
}
