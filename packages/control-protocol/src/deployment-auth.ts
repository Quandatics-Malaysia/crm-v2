const encoder = new TextEncoder()

export const DEPLOYMENT_REQUEST_MAX_SKEW_MS = 5 * 60 * 1_000

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function fromBase64Url(value: string, expectedBytes: number): Uint8Array<ArrayBuffer> {
  const expectedLength = Math.ceil(expectedBytes * 8 / 6)
  if (value.length !== expectedLength || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid base64url value")
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  let binary: string
  try {
    binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4))
  } catch {
    throw new TypeError("Invalid base64url value")
  }
  if (binary.length !== expectedBytes) throw new TypeError("Invalid base64url value")
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (toBase64Url(bytes) !== value) throw new TypeError("Invalid base64url value")
  return bytes
}

export async function sha256(bytes: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
}

export function lowercaseHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function installTokenDigest(
  rawToken: string,
  pepper: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const tokenBytes = fromBase64Url(rawToken, 32)
  const domain = encoder.encode("install-token-v1\0")
  const pepperBytes = encoder.encode(pepper)
  const input = new Uint8Array(domain.length + pepperBytes.length + tokenBytes.length)
  input.set(domain)
  input.set(pepperBytes, domain.length)
  input.set(tokenBytes, domain.length + pepperBytes.length)
  return sha256(input)
}

export async function deploymentNonceDigest(keyId: string, nonce: Uint8Array): Promise<string> {
  const domain = encoder.encode("heartbeat-nonce-v1\0")
  const keyBytes = encoder.encode(keyId)
  const input = new Uint8Array(domain.length + keyBytes.length + nonce.length)
  input.set(domain)
  input.set(keyBytes, domain.length)
  input.set(nonce, domain.length + keyBytes.length)
  return toBase64Url(await sha256(input))
}

export async function publicKeyFingerprint(x: string): Promise<string> {
  return toBase64Url(await sha256(fromBase64Url(x, 32)))
}

export async function importStrictEd25519PublicJwk(jwk: {
  kty: "OKP"
  crv: "Ed25519"
  x: string
}): Promise<CryptoKey> {
  fromBase64Url(jwk.x, 32)
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: jwk.x },
      "Ed25519",
      false,
      ["verify"],
    )
  } catch {
    throw new TypeError("Invalid Ed25519 public key")
  }
}

export function heartbeatTranscript(input: {
  deploymentId: string
  keyId: string
  timestamp: string
  nonce: string
  bodyDigestHex: string
}): Uint8Array<ArrayBuffer> {
  return deploymentRequestTranscript({
    method: "POST",
    path: `/v1/deployments/${input.deploymentId}/heartbeat`,
    ...input,
  })
}

export function deploymentRequestTranscript(input: {
  method: "GET" | "POST"
  path: string
  deploymentId: string
  keyId: string
  timestamp: string
  nonce: string
  bodyDigestHex: string
}): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `crm-deployment-request-v1\n${input.method}\n${input.path}\n${input.deploymentId}\n${input.keyId}\n${input.timestamp}\n${input.nonce}\nsha-256=${input.bodyDigestHex}\n`,
  )
}

export function parseCanonicalRequestTimestamp(
  value: string,
  now: Date,
  maxSkewMs = DEPLOYMENT_REQUEST_MAX_SKEW_MS,
): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new TypeError("Invalid deployment request timestamp")
  }
  const timestamp = new Date(value)
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.toISOString() !== value ||
    !Number.isFinite(maxSkewMs) ||
    maxSkewMs < 0 ||
    Math.abs(now.getTime() - timestamp.getTime()) > maxSkewMs
  ) {
    throw new TypeError("Invalid deployment request timestamp")
  }
  return timestamp
}
