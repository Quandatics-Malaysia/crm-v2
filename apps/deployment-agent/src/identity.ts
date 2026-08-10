import { constants } from "node:fs"
import { lstat, open, readFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"

import { fromBase64Url } from "@crm/control-protocol/deployment-auth"
import { z } from "zod"

import type { AgentConfig } from "./config.js"

export const AGENT_STATE_DIRECTORY = "/var/lib/crm-agent"

const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const base64Url32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine((value) => {
  try {
    fromBase64Url(value, 32)
    return true
  } catch {
    return false
  }
})
const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value
    } catch {
      return false
    }
  })

const privateJwkSchema = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: base64Url32Schema,
  d: base64Url32Schema,
}).strict()

const identitySchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: uuidSchema,
  environment: z.enum(["development", "staging", "production"]),
  keyId: uuidSchema.nullable(),
  privateJwk: privateJwkSchema,
}).strict()

const runtimeSchema = z.object({
  schemaVersion: z.literal(1),
  lastAppliedEntitlementVersion: z.number().int().min(1).max(2_147_483_647).nullable(),
  lastAppliedConfigurationVersion: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/).nullable(),
  hasAppliedValidEntitlement: z.boolean(),
  lastHeartbeatSucceededAt: timestampSchema.nullable(),
  lastErrorCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
}).strict()

export type AgentIdentity = z.infer<typeof identitySchema>
export type AgentRuntime = z.infer<typeof runtimeSchema>
export type StateIoHooks = { beforeRename?: (target: "identity" | "runtime") => void | Promise<void> }

const emptyRuntime = (): AgentRuntime => ({
  schemaVersion: 1,
  lastAppliedEntitlementVersion: null,
  lastAppliedConfigurationVersion: null,
  hasAppliedValidEntitlement: false,
  lastHeartbeatSucceededAt: null,
  lastErrorCode: null,
})

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

async function validateDirectory(directory: string): Promise<void> {
  try {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.geteuid?.()) {
      throw new Error()
    }
  } catch {
    throw new Error("Agent state is unsafe")
  }
}

async function validateFile(path: string, label: string, allowMissing: boolean): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.geteuid?.()) {
      throw new Error()
    }
    return true
  } catch (error) {
    if (allowMissing && isMissing(error)) return false
    throw new Error(`Agent ${label} is unsafe`)
  }
}

export async function createStateStore(directory = AGENT_STATE_DIRECTORY, hooks: StateIoHooks = {}) {
  await validateDirectory(directory)
  const identityPath = join(directory, "identity.json")
  const runtimePath = join(directory, "runtime.json")

  async function atomicWrite(
    target: "identity" | "runtime",
    path: string,
    value: unknown,
  ): Promise<void> {
    await validateFile(path, target, true)
    const temporaryPath = join(directory, `.${target}.${process.pid}.${crypto.randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8")
      await handle.sync()
      await handle.close()
      handle = null
      await hooks.beforeRename?.(target)
      await rename(temporaryPath, path)
      await validateFile(path, target, false)
      const directoryHandle = await open(directory, constants.O_RDONLY)
      try {
        await directoryHandle.sync()
      } finally {
        await directoryHandle.close()
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  return {
    directory,
    async loadIdentity(): Promise<AgentIdentity | null> {
      if (!await validateFile(identityPath, "identity", true)) return null
      try {
        return identitySchema.parse(JSON.parse(await readFile(identityPath, "utf8")))
      } catch {
        throw new Error("Agent identity is corrupt")
      }
    },
    async saveIdentity(identity: AgentIdentity): Promise<void> {
      await atomicWrite("identity", identityPath, identitySchema.parse(identity))
    },
    async loadRuntime(): Promise<AgentRuntime> {
      if (!await validateFile(runtimePath, "runtime", true)) return emptyRuntime()
      try {
        return runtimeSchema.parse(JSON.parse(await readFile(runtimePath, "utf8")))
      } catch {
        return emptyRuntime()
      }
    },
    async saveRuntime(runtime: AgentRuntime): Promise<void> {
      await atomicWrite("runtime", runtimePath, runtimeSchema.parse(runtime))
    },
  }
}

export type AgentStateStore = Awaited<ReturnType<typeof createStateStore>>

export async function generateIdentity(config: AgentConfig, store: AgentStateStore): Promise<AgentIdentity> {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const exported = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const identity = identitySchema.parse({
    schemaVersion: 1,
    deploymentId: config.deploymentId,
    environment: config.environment,
    keyId: null,
    privateJwk: { kty: "OKP", crv: "Ed25519", x: exported.x, d: exported.d },
  })
  await store.saveIdentity(identity)
  return identity
}

export function assertIdentityMatches(identity: AgentIdentity, config: AgentConfig): void {
  if (identity.deploymentId !== config.deploymentId || identity.environment !== config.environment) {
    throw new Error("Agent identity does not match configuration")
  }
}
