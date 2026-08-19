import { z } from "zod"

import {
  signEnvelope,
  verifyEnvelope,
  type SignedEnvelope,
  type SigningKey,
} from "./crypto.js"
import { StrictSemverSchema } from "./version.js"

const IsoTimestampSchema = z.iso.datetime({ offset: true })
const DeploymentIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const CommandIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const VendorKeyIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)
const CommandKindSchema = z.enum([
  "echo",
  "diagnostics",
  "trigger_backup",
  "verify_restore",
  "restart_web",
  "restart_gateway",
  "log_stream",
])

const CommandPayloadEchoSchema = z.object({
  message: z.string().min(1).max(1024),
}).strict()

const CommandPayloadDiagnosticsSchema = z.object({
  includeLogs: z.boolean().default(false),
  maxLogBytes: z.number().int().min(0).max(65_536).default(0),
  includeContainerStatus: z.boolean().default(true),
  requestedAt: IsoTimestampSchema,
}).strict()

const CommandPayloadTriggerBackupSchema = z.object({
  requestedAt: IsoTimestampSchema,
  artifactTag: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
}).strict()

const CommandPayloadVerifyRestoreSchema = z.object({
  artifactTag: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
  requestedAt: IsoTimestampSchema,
}).strict()

const CommandPayloadRestartServiceSchema = z.object({
  service: z.enum(["web", "gateway"]),
  reason: z.string().min(1).max(256),
}).strict()

const CommandPayloadLogStreamSchema = z.object({
  service: z.enum(["web", "gateway", "agent"]),
  lines: z.number().int().min(1).max(2_000),
}).strict()

export const CommandPayloadSchema = z.discriminatedUnion("kind", [
  CommandPayloadEchoSchema.extend({ kind: z.literal("echo") }),
  CommandPayloadDiagnosticsSchema.extend({ kind: z.literal("diagnostics") }),
  CommandPayloadTriggerBackupSchema.extend({ kind: z.literal("trigger_backup") }),
  CommandPayloadVerifyRestoreSchema.extend({ kind: z.literal("verify_restore") }),
  CommandPayloadRestartServiceSchema.extend({ kind: z.literal("restart_web") }),
  CommandPayloadRestartServiceSchema.extend({ kind: z.literal("restart_gateway") }),
  CommandPayloadLogStreamSchema.extend({ kind: z.literal("log_stream") }),
])

export type CommandPayload = z.infer<typeof CommandPayloadSchema>

export const CommandEnvelopePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  id: CommandIdSchema,
  deploymentId: DeploymentIdSchema,
  payload: CommandPayloadSchema,
  issuedAt: IsoTimestampSchema,
  expiresAt: IsoTimestampSchema,
  agentVersionMin: StrictSemverSchema.nullable(),
}).strict()

export type CommandEnvelopePayload = z.infer<typeof CommandEnvelopePayloadSchema>

export const CommandEnvelopeSchema = z.object({
  keyId: VendorKeyIdSchema,
  payload: CommandEnvelopePayloadSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{43,1024}$/),
}).strict()

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>

export const CommandAckSchema = z.object({
  commandId: CommandIdSchema,
  deploymentId: DeploymentIdSchema,
  status: z.enum(["ok", "error"]),
  outcome: z.enum(["completed", "skipped", "failed_dependencies"]).default("completed"),
  output: z.unknown().optional(),
  errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable().default(null),
  errorMessage: z.string().max(1_024).nullable().default(null),
  artifact: z.object({
    kind: z.enum(["diagnostic_bundle", "backup_evidence", "restore_evidence", "log_tail"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().min(0).max(134_217_728),
    contentType: z.string().min(1).max(128),
    storageKey: z.string().min(1).max(512),
  }).strict().nullable().default(null),
  completedAt: IsoTimestampSchema,
  agentVersion: StrictSemverSchema,
}).strict()

export type CommandAck = z.infer<typeof CommandAckSchema>

export type SignedCommandEnvelope = SignedEnvelope<CommandEnvelopePayload>

export async function signCommandEnvelope(input: {
  payload: CommandEnvelopePayload
  keyId: string
  privateKey: SigningKey
}): Promise<SignedCommandEnvelope> {
  const envelope = await signEnvelope(input.payload, input.keyId, input.privateKey)
  return CommandEnvelopeSchema.parse(envelope)
}

export async function verifyCommandEnvelope(input: {
  envelope: unknown
  publicKeys: Record<string, SigningKey>
  now: Date
}): Promise<CommandEnvelopePayload | null> {
  const parsed = CommandEnvelopeSchema.safeParse(input.envelope)
  if (!parsed.success) return null
  const payload = await verifyEnvelope(parsed.data, input.publicKeys, parsed.data.payload.deploymentId)
  if (payload === null) return null
  const expiresAt = Date.parse(payload.expiresAt)
  const issuedAt = Date.parse(payload.issuedAt)
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) return null
  if (expiresAt <= input.now.getTime()) return null
  if (issuedAt > input.now.getTime()) return null
  if (payload.expiresAt <= payload.issuedAt) return null
  return payload
}

export function isCommandExpired(payload: CommandEnvelopePayload, now: Date): boolean {
  return Date.parse(payload.expiresAt) <= now.getTime()
}

export const DEFAULT_COMMAND_TTL_MS = 5 * 60 * 1_000
export const MAX_COMMAND_TTL_MS = 24 * 60 * 60 * 1_000

export function commandTtlBounds(now: Date, requestedTtlMs = DEFAULT_COMMAND_TTL_MS): {
  issuedAt: string
  expiresAt: string
} {
  const ttl = Math.min(Math.max(1_000, requestedTtlMs), MAX_COMMAND_TTL_MS)
  const issuedAtDate = new Date(now.getTime() - (now.getTime() % 1_000))
  const expiresAt = new Date(issuedAtDate.getTime() + ttl)
  return {
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}
