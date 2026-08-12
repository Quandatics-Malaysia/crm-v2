import "server-only"

import { z } from "zod"

import { env } from "@/lib/env"

const schema = z.object({
  applicationVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  releaseTag: z.string().regex(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  releaseChannel: z.enum(["stable", "beta", "canary"]),
  deploymentEnvironment: z.enum(["production", "staging"]),
  imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  migrationVersion: z.string().regex(/^\d{4}$/),
  deployedAt: z.iso.datetime({ offset: true }),
})

export type ReleaseMetadata = {
  applicationVersion: string
  releaseTag: string
  releaseChannel: "stable" | "beta" | "canary"
  deploymentEnvironment: "production" | "staging"
  imageDigestShort: string
  migrationVersion: string
  deployedAt: string
}

export function getReleaseMetadata(): ReleaseMetadata {
  const value = schema.parse({
    applicationVersion: env.APPLICATION_VERSION,
    releaseTag: env.RELEASE_TAG,
    releaseChannel: env.RELEASE_CHANNEL,
    deploymentEnvironment: env.DEPLOYMENT_ENV,
    imageDigest: env.IMAGE_DIGEST,
    migrationVersion: env.MIGRATION_VERSION,
    deployedAt: env.DEPLOYED_AT,
  })
  return {
    applicationVersion: value.applicationVersion,
    releaseTag: value.releaseTag,
    releaseChannel: value.releaseChannel,
    deploymentEnvironment: value.deploymentEnvironment,
    imageDigestShort: value.imageDigest.slice(7, 19),
    migrationVersion: value.migrationVersion,
    deployedAt: value.deployedAt,
  }
}
