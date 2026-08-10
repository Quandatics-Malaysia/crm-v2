import { z } from "zod"

import { ModuleIdSchema } from "./entitlement.js"
import { StrictSemverSchema } from "./version.js"

const DeploymentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Base64Url32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const OpaqueVersionSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)
const CanonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value
    } catch {
      return false
    }
  })

export const DeploymentRegistrationSchema = z
  .object({
    installationToken: Base64Url32Schema,
    deploymentId: DeploymentIdSchema,
    environment: z.enum(["development", "staging", "production"]),
    keyId: CanonicalUuidSchema,
    publicKey: z
      .object({
        kty: z.literal("OKP"),
        crv: z.literal("Ed25519"),
        x: Base64Url32Schema,
      })
      .strict(),
    agentVersion: StrictSemverSchema,
  })
  .strict()

export type DeploymentRegistration = z.infer<typeof DeploymentRegistrationSchema>

export const DeploymentHeartbeatSchema = z
  .object({
    deploymentId: DeploymentIdSchema,
    environment: z.enum(["development", "staging", "production"]),
    applicationVersion: StrictSemverSchema,
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    entitlementVersion: OpaqueVersionSchema.nullable(),
    configurationVersion: OpaqueVersionSchema.nullable(),
    activeUserCount: z.number().int().min(0).max(100_000),
    reservedInvitationCount: z.number().int().min(0).max(100_000),
    enabledModuleIds: z
      .array(ModuleIdSchema)
      .max(32)
      .refine((moduleIds) => new Set(moduleIds).size === moduleIds.length),
    healthState: z.enum(["healthy", "degraded", "unhealthy"]),
    migrationVersion: OpaqueVersionSchema,
    lastSuccessfulBackupAt: CanonicalTimestampSchema.nullable(),
    lastRestoreTestAt: CanonicalTimestampSchema.nullable(),
    agentVersion: StrictSemverSchema,
  })
  .strict()

export type DeploymentHeartbeat = z.infer<typeof DeploymentHeartbeatSchema>
