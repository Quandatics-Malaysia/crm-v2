import { z } from "zod"

import { ModuleIdSchema } from "./entitlement.js"

const IsoTimestampSchema = z.iso.datetime({ offset: true })

export const DeploymentRegistrationSchema = z
  .object({
    installationToken: z.string().min(1),
    deploymentId: z.string().min(1),
    environment: z.enum(["development", "staging", "production"]),
    publicKey: z
      .object({
        kty: z.literal("OKP"),
        crv: z.literal("Ed25519"),
        x: z.string().min(1),
      })
      .strict(),
    agentVersion: z.string().min(1),
  })
  .strict()

export type DeploymentRegistration = z.infer<typeof DeploymentRegistrationSchema>

export const DeploymentHeartbeatSchema = z
  .object({
    deploymentId: z.string().min(1),
    environment: z.enum(["development", "staging", "production"]),
    applicationVersion: z.string().min(1),
    imageDigest: z.string().min(1),
    entitlementVersion: z.string().min(1).nullable(),
    configurationVersion: z.string().min(1).nullable(),
    activeUserCount: z.number().int().min(0),
    reservedInvitationCount: z.number().int().min(0),
    enabledModuleIds: z.array(ModuleIdSchema),
    healthState: z.enum(["healthy", "degraded", "unhealthy"]),
    migrationVersion: z.string().min(1),
    lastSuccessfulBackupAt: IsoTimestampSchema.nullable(),
    lastRestoreTestAt: IsoTimestampSchema.nullable(),
    agentVersion: z.string().min(1),
  })
  .strict()

export type DeploymentHeartbeat = z.infer<typeof DeploymentHeartbeatSchema>
