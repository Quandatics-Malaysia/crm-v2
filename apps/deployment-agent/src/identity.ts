import { constants } from "node:fs"
import { link, lstat, open, readFile, rename, unlink } from "node:fs/promises"
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
  keyId: uuidSchema,
  privateJwk: privateJwkSchema,
}).strict()

const registrationSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: uuidSchema,
  keyId: uuidSchema,
  registeredAt: timestampSchema,
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
type DurableTarget = "identity" | "registration" | "runtime"
type PublishTarget = Exclude<DurableTarget, "runtime">
export type StateIoHooks = {
  beforeRename?: (target: "runtime") => void | Promise<void>
  beforeIdentityInstall?: () => void | Promise<void>
  beforeDirectorySync?: (target: DurableTarget) => void | Promise<void>
  beforePublishDirectorySync?: (target: PublishTarget) => void | Promise<void>
}

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

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"
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
  const registrationPath = join(directory, "registration.json")
  const runtimePath = join(directory, "runtime.json")

  async function syncDirectory(target: DurableTarget): Promise<void> {
    await hooks.beforeDirectorySync?.(target)
    const directoryHandle = await open(directory, constants.O_RDONLY)
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  }

  async function parseStored<T>(
    target: PublishTarget,
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      return schema.parse(JSON.parse(await readFile(path, "utf8")))
    } catch {
      throw new Error(`Agent ${target} is corrupt`)
    }
  }

  async function installExclusive<T>(
    target: PublishTarget,
    path: string,
    value: T,
    schema: z.ZodType<T>,
  ): Promise<boolean> {
    if (await validateFile(path, target, true)) {
      await parseStored(target, path, schema)
      await syncDirectory(target)
      return false
    }
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
      if (target === "identity") await hooks.beforeIdentityInstall?.()
      await link(temporaryPath, path)
      await unlink(temporaryPath)
      await validateFile(path, target, false)
      await parseStored(target, path, schema)
      await hooks.beforePublishDirectorySync?.(target)
      await syncDirectory(target)
      return true
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      if (isExists(error)) {
        await validateFile(path, target, false)
        await parseStored(target, path, schema)
        await syncDirectory(target)
        return false
      }
      throw error
    }
  }

  async function atomicWrite(
    target: "runtime",
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
      await syncDirectory(target)
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
      const identity = await parseStored("identity", identityPath, identitySchema)
      await syncDirectory("identity")
      return identity
    },
    async installIdentity(identity: AgentIdentity): Promise<boolean> {
      return installExclusive("identity", identityPath, identitySchema.parse(identity), identitySchema)
    },
    async isRegistered(identity: AgentIdentity): Promise<boolean> {
      if (!await validateFile(registrationPath, "registration", true)) return false
      const registration = await parseStored("registration", registrationPath, registrationSchema)
      if (registration.deploymentId !== identity.deploymentId || registration.keyId !== identity.keyId) {
        throw new Error("Agent registration does not match identity")
      }
      await syncDirectory("registration")
      return true
    },
    async markRegistered(identity: AgentIdentity): Promise<void> {
      const candidate = registrationSchema.parse({
        schemaVersion: 1,
        deploymentId: identity.deploymentId,
        keyId: identity.keyId,
        registeredAt: new Date().toISOString(),
      })
      if (await installExclusive("registration", registrationPath, candidate, registrationSchema)) return
      if (!await this.isRegistered(identity)) throw new Error("Agent registration update failed")
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
    keyId: crypto.randomUUID(),
    privateJwk: { kty: "OKP", crv: "Ed25519", x: exported.x, d: exported.d },
  })
  if (await store.installIdentity(identity)) return identity
  const installed = await store.loadIdentity()
  if (installed === null) throw new Error("Agent identity installation failed")
  assertIdentityMatches(installed, config)
  return installed
}

export function assertIdentityMatches(identity: AgentIdentity, config: AgentConfig): void {
  if (identity.deploymentId !== config.deploymentId || identity.environment !== config.environment) {
    throw new Error("Agent identity does not match configuration")
  }
}
