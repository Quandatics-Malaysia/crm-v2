import { canonicalJson } from "./canonical-json.js"

export type SigningKey = CryptoKey | JsonWebKey

export type SignedEnvelope<T> = {
  keyId: string
  payload: T
  signature: string
}

/** Signs the canonical payload with an Ed25519 private key. */
export async function signEnvelope<T>(
  payload: T,
  keyId: string,
  privateKey: SigningKey,
): Promise<SignedEnvelope<T>> {
  if (keyId.length === 0) {
    throw new TypeError("A signing key ID is required")
  }

  const signature = await crypto.subtle.sign(
    "Ed25519",
    await importEd25519Key(privateKey, ["sign"]),
    new TextEncoder().encode(canonicalJson(payload)),
  )

  return { keyId, payload, signature: toBase64Url(new Uint8Array(signature)) }
}

/**
 * Verifies an envelope against a pinned vendor key set. A deployment ID can be
 * supplied by the recipient to prevent a valid lease being replayed elsewhere.
 */
export async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>,
  publicKeys: Record<string, SigningKey>,
  expectedDeploymentId?: string,
): Promise<T | null> {
  if (isKeyBound(envelope.payload) && envelope.payload.keyId !== envelope.keyId) {
    return null
  }

  const publicKey = publicKeys[envelope.keyId]
  if (publicKey === undefined) {
    return null
  }

  if (
    expectedDeploymentId !== undefined &&
    (!isDeploymentScoped(envelope.payload) || envelope.payload.deploymentId !== expectedDeploymentId)
  ) {
    return null
  }

  try {
    const verified = await crypto.subtle.verify(
      "Ed25519",
      await importEd25519Key(publicKey, ["verify"]),
      fromBase64Url(envelope.signature),
      new TextEncoder().encode(canonicalJson(envelope.payload)),
    )
    return verified ? envelope.payload : null
  } catch {
    return null
  }
}

function isKeyBound(value: unknown): value is { keyId: string } {
  return typeof value === "object" && value !== null && "keyId" in value && typeof value.keyId === "string"
}

function isDeploymentScoped(value: unknown): value is { deploymentId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "deploymentId" in value &&
    typeof value.deploymentId === "string"
  )
}

async function importEd25519Key(key: SigningKey, usages: KeyUsage[]): Promise<CryptoKey> {
  if (isJsonWebKey(key)) {
    return crypto.subtle.importKey("jwk", key, { name: "Ed25519" }, false, usages)
  }
  return key
}

function isJsonWebKey(key: SigningKey): key is JsonWebKey {
  return !("type" in key && "algorithm" in key && "usages" in key)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError("Invalid base64url signature")
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}
