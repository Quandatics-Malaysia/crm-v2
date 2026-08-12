import { readFile } from "node:fs/promises"

import { verifyEnvelope, type SignedEnvelope } from "@crm/control-protocol"
import postgres from "postgres"
import { z } from "zod"

const MAX_BACKUP_PROOF_BYTES = 131_072

const isoTimestamp = z.iso.datetime({ offset: true })
const publicEd25519JwkSchema = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  alg: z.enum(["EdDSA", "Ed25519"]).optional(),
  ext: z.boolean().optional(),
  key_ops: z.array(z.literal("verify")).max(1).optional(),
}).strict()
const trustSetSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.object({
    keyId: z.string().min(1).max(128),
    publicJwk: publicEd25519JwkSchema,
    validFrom: isoTimestamp,
    validUntil: isoTimestamp,
  }).strict()).min(1),
}).strict()
const backupProofPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  keyId: z.string().min(1).max(128),
  deploymentId: z.string().min(1).max(256),
  databaseIdentity: z.string().min(1).max(2_048),
  storageLocation: z.string().min(1).max(2_048),
  createdAt: isoTimestamp,
}).strict()
const signedEnvelopeSchema = z.object({
  keyId: z.string().min(1).max(128),
  payload: z.unknown(),
  signature: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export type LifecycleAction = "archive" | "restore"
export type BackupProofPayload = z.infer<typeof backupProofPayloadSchema>
type BackupProofTrustSet = z.infer<typeof trustSetSchema>

export type OrganizationLifecycleInput = {
  action: LifecycleAction
  slug: string
  actorUserId: string
  backupProof: unknown
}

export type OrganizationLifecycleTransaction = {
  findOrganizationBySlug(slug: string): Promise<{ id: string } | null>
  findServerOperator(userId: string, configuredEmail: string): Promise<{ id: string } | null>
  callLifecycleFunction(
    action: LifecycleAction,
    organizationId: string,
    actorUserId: string,
    actorMemberId: string | null,
    at: Date,
  ): Promise<void>
}

export type OrganizationLifecycleRepository = {
  transaction<T>(operation: (transaction: OrganizationLifecycleTransaction) => Promise<T>): Promise<T>
}

export type OrganizationLifecycleDependencies = {
  deploymentId: string
  databaseIdentity: string
  storageLocation: string
  backupProofMaxAgeMs: number
  trustSet: BackupProofTrustSet
  platformMasterEmail: string
  repository: OrganizationLifecycleRepository
  now?: () => Date
}

function fail(message: string): never {
  throw new Error(`organization lifecycle command: ${message}`)
}

function requireNonEmpty(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) fail(`${name} must be configured`)
  return normalized
}

export function assertCliOnly(nextRuntime = process.env.NEXT_RUNTIME): void {
  if (nextRuntime) fail("CLI-only execution cannot run in a Next.js runtime")
}

export function parseOrganizationLifecycleArgs(args: readonly string[]): Omit<OrganizationLifecycleInput, "backupProof"> & { backupProofPath: string } {
  const action = args[0]
  if (action !== "archive" && action !== "restore") fail("action must be archive or restore")

  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag !== "--slug" && flag !== "--actor-user-id" && flag !== "--backup-proof") fail(`unknown argument ${flag ?? ""}`)
    if (!value || value.startsWith("--") || values.has(flag)) fail(`invalid value for ${flag}`)
    values.set(flag, value)
  }

  const slug = values.get("--slug")?.trim()
  const actorUserId = values.get("--actor-user-id")?.trim()
  const backupProofPath = values.get("--backup-proof")?.trim()
  if (!slug) fail("--slug is required")
  if (!actorUserId) fail("--actor-user-id is required")
  if (!backupProofPath) fail("--backup-proof is required")
  return { action, slug, actorUserId, backupProofPath }
}

export async function verifyBackupProof(
  candidate: unknown,
  input: Pick<OrganizationLifecycleDependencies, "deploymentId" | "databaseIdentity" | "storageLocation" | "backupProofMaxAgeMs" | "trustSet"> & { now?: () => Date },
): Promise<BackupProofPayload> {
  if (candidate === undefined || candidate === null) fail("backup proof is missing")
  if (!Number.isFinite(input.backupProofMaxAgeMs) || input.backupProofMaxAgeMs <= 0) fail("backup proof window is invalid")

  const trustSet = trustSetSchema.safeParse(input.trustSet)
  const envelope = signedEnvelopeSchema.safeParse(candidate)
  if (!trustSet.success || !envelope.success) fail("backup proof is malformed")

  const trustKey = trustSet.data.keys.find((key) => key.keyId === envelope.data.keyId)
  if (!trustKey) fail("backup proof uses an unknown trust key")
  const verified = await verifyEnvelope(
    envelope.data as SignedEnvelope<unknown>,
    { [trustKey.keyId]: trustKey.publicJwk },
  )
  if (verified === null) fail("backup proof signature is invalid")

  const proof = backupProofPayloadSchema.safeParse(verified)
  if (!proof.success) fail("backup proof payload is malformed")
  if (proof.data.deploymentId !== input.deploymentId) fail("backup proof deployment identity does not match")
  if (proof.data.databaseIdentity !== input.databaseIdentity) fail("backup proof database identity does not match")
  if (proof.data.storageLocation !== input.storageLocation) fail("backup proof storage location does not match")

  const createdAt = Date.parse(proof.data.createdAt)
  const now = input.now?.() ?? new Date()
  const age = now.getTime() - createdAt
  if (!Number.isFinite(createdAt) || !Number.isFinite(now.getTime()) || age < 0 || age > input.backupProofMaxAgeMs) fail("backup proof is stale")
  if (
    createdAt < Date.parse(trustKey.validFrom) || createdAt >= Date.parse(trustKey.validUntil) ||
    now.getTime() < Date.parse(trustKey.validFrom) || now.getTime() >= Date.parse(trustKey.validUntil)
  ) fail("backup proof trust key is outside its validity window")
  return proof.data
}

export async function executeOrganizationLifecycle(
  input: OrganizationLifecycleInput,
  dependencies: OrganizationLifecycleDependencies,
): Promise<{ action: LifecycleAction; organizationId: string; actorUserId: string }> {
  const platformMasterEmail = requireNonEmpty(dependencies.platformMasterEmail, "PLATFORM_MASTER_EMAIL").toLowerCase()
  await verifyBackupProof(input.backupProof, dependencies)
  const at = dependencies.now?.() ?? new Date()

  return dependencies.repository.transaction(async (transaction) => {
    const organization = await transaction.findOrganizationBySlug(input.slug)
    if (!organization) fail("organization slug not found")
    const operator = await transaction.findServerOperator(input.actorUserId, platformMasterEmail)
    if (!operator || operator.id !== input.actorUserId) fail("actor is not the configured server operator")
    await transaction.callLifecycleFunction(input.action, organization.id, operator.id, null, at)
    return { action: input.action, organizationId: organization.id, actorUserId: operator.id }
  })
}

export function databaseIdentityFromUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail("DATABASE_ADMIN_URL must be a PostgreSQL URL")
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") fail("DATABASE_ADMIN_URL must be a PostgreSQL URL")
  if (!url.hostname) fail("DATABASE_ADMIN_URL must include an explicit hostname")
  const databaseName = decodeURIComponent(url.pathname).replace(/^\/+/, "")
  if (!databaseName || databaseName.includes("/")) fail("DATABASE_ADMIN_URL must include one database name")
  return `postgres://${url.hostname.toLowerCase()}:${url.port || "5432"}/${databaseName}`
}

function createPostgresRepository(databaseUrl: string): OrganizationLifecycleRepository & { close(): Promise<void> } {
  const client = postgres(databaseUrl, { max: 1 })
  return {
    transaction: async <T>(operation: (transaction: OrganizationLifecycleTransaction) => Promise<T>): Promise<T> => {
      const [result] = await client.begin(async (sql) => [await operation({
        findOrganizationBySlug: async (slug) => {
          const rows = await sql<{ id: string }[]>`
            select id from organization where slug = ${slug} limit 2
          `
          return rows[0] ?? null
        },
        findServerOperator: async (userId, configuredEmail) => {
          const rows = await sql<{ id: string }[]>`
            select id from public."user"
            where id = ${userId} and lower(email) = ${configuredEmail} and is_superadmin = true
            limit 2
          `
          return rows[0] ?? null
        },
        callLifecycleFunction: async (action, organizationId, actorUserId, actorMemberId, at) => {
          if (action === "archive") {
            await sql`select archive_organization(${organizationId}, ${actorUserId}, ${actorMemberId}, ${at.toISOString()}::timestamp with time zone)`
          } else {
            await sql`select restore_organization(${organizationId}, ${actorUserId}, ${actorMemberId}, ${at.toISOString()}::timestamp with time zone)`
          }
        },
      })] as [T])
      return result
    },
    close: () => client.end(),
  }
}

async function readBackupProof(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8")
  if (Buffer.byteLength(raw, "utf8") > MAX_BACKUP_PROOF_BYTES) fail("backup proof is too large")
  try {
    return JSON.parse(raw) as unknown
  } catch {
    fail("backup proof is malformed")
  }
}

function runtimeDependencies(): Omit<OrganizationLifecycleDependencies, "repository"> & { databaseUrl: string } {
  const databaseUrl = requireNonEmpty(process.env.DATABASE_ADMIN_URL, "DATABASE_ADMIN_URL")
  const deploymentId = requireNonEmpty(process.env.DEPLOYMENT_ID, "DEPLOYMENT_ID")
  const storageLocation = requireNonEmpty(process.env.BACKUP_STORAGE_LOCATION, "BACKUP_STORAGE_LOCATION")
  const platformMasterEmail = requireNonEmpty(process.env.PLATFORM_MASTER_EMAIL, "PLATFORM_MASTER_EMAIL")
  const maxAgeSeconds = Number(requireNonEmpty(process.env.BACKUP_PROOF_MAX_AGE_SECONDS, "BACKUP_PROOF_MAX_AGE_SECONDS"))
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) fail("BACKUP_PROOF_MAX_AGE_SECONDS must be a positive integer")

  let trustSet: unknown
  try {
    trustSet = JSON.parse(requireNonEmpty(process.env.VENDOR_ENTITLEMENT_TRUST_SET, "VENDOR_ENTITLEMENT_TRUST_SET"))
  } catch {
    fail("VENDOR_ENTITLEMENT_TRUST_SET must be valid JSON")
  }
  const parsedTrustSet = trustSetSchema.safeParse(trustSet)
  if (!parsedTrustSet.success) fail("VENDOR_ENTITLEMENT_TRUST_SET is invalid")
  return {
    deploymentId,
    databaseIdentity: databaseIdentityFromUrl(databaseUrl),
    storageLocation,
    backupProofMaxAgeMs: maxAgeSeconds * 1_000,
    trustSet: parsedTrustSet.data,
    platformMasterEmail,
    databaseUrl,
  }
}

async function main(): Promise<void> {
  assertCliOnly()
  const { backupProofPath, ...input } = parseOrganizationLifecycleArgs(process.argv.slice(2))
  const runtime = runtimeDependencies()
  const repository = createPostgresRepository(runtime.databaseUrl)
  try {
    await executeOrganizationLifecycle({ ...input, backupProof: await readBackupProof(backupProofPath) }, { ...runtime, repository })
    process.stdout.write(`organization ${input.action} completed for ${input.slug}\n`)
  } finally {
    await repository.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
