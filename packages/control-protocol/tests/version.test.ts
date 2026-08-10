import { describe, expect, it } from "vitest"

import {
  DeploymentHeartbeatSchema,
  DeploymentRegistrationSchema,
} from "../src/heartbeat.js"
import { StrictSemverSchema } from "../src/version.js"

const registration = {
  installationToken: "A".repeat(43),
  deploymentId: "11111111-1111-4111-8111-111111111111",
  environment: "production",
  keyId: "22222222-2222-4222-8222-222222222222",
  publicKey: { kty: "OKP", crv: "Ed25519", x: "A".repeat(43) },
  agentVersion: "1.0.0",
}

const heartbeat = {
  deploymentId: registration.deploymentId,
  environment: "production",
  applicationVersion: "2.3.4",
  imageDigest: `sha256:${"a".repeat(64)}`,
  entitlementVersion: "7",
  configurationVersion: null,
  activeUserCount: 1,
  reservedInvitationCount: 0,
  enabledModuleIds: [],
  healthState: "healthy",
  migrationVersion: "0066",
  lastSuccessfulBackupAt: null,
  lastRestoreTestAt: null,
  agentVersion: "1.0.0",
}

describe("strict SemVer", () => {
  it("accepts valid registration and heartbeat fixtures", () => {
    expect(DeploymentRegistrationSchema.safeParse(registration).success).toBe(true)
    expect(DeploymentHeartbeatSchema.safeParse(heartbeat).success).toBe(true)
  })

  it.each([
    "0.0.0",
    "1.0.0",
    "1.2.3-alpha.1",
    "1.2.3-0A-0+build.5.sha",
  ])("accepts %s", (version) => {
    expect(StrictSemverSchema.safeParse(version).success).toBe(true)
  })

  it.each([
    "01.0.0",
    "1.01.0",
    "1.0.01",
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0+build..1",
    "1.0.0-alpha_1",
    "v1.0.0",
    "1.0",
  ])("rejects %s", (version) => {
    expect(StrictSemverSchema.safeParse(version).success).toBe(false)
    expect(DeploymentRegistrationSchema.safeParse({ ...registration, agentVersion: version }).success).toBe(false)
    expect(DeploymentHeartbeatSchema.safeParse({ ...heartbeat, applicationVersion: version }).success).toBe(false)
  })
})
