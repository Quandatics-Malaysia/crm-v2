import { chmod, lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  deploymentRequestTranscript,
  fromBase64Url,
  lowercaseHex,
  sha256,
} from "@crm/control-protocol/deployment-auth"
import { afterEach, describe, expect, it, vi } from "vitest"

import { loadAgentConfig, type AgentConfig } from "../src/config.js"
import { parseRetryAfterMs } from "../src/client.js"
import {
  createStateStore,
  generateIdentity,
  type AgentIdentity,
} from "../src/identity.js"
import {
  backoffDelayMs,
  createDeploymentAgent,
  heartbeatDelayMs,
  readHealth,
} from "../src/runner.js"

const deploymentId = "11111111-1111-4111-8111-111111111111"
const keyId = "22222222-2222-4222-8222-222222222222"
const token = "A".repeat(43)
const secret = `${"B".repeat(42)}A`
const imageDigest = `sha256:${"a".repeat(64)}`
const temporaryDirectories: string[] = []

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "crm-agent-test-"))
  temporaryDirectories.push(directory)
  await chmod(directory, 0o700)
  return directory
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    controlPlaneUrl: "http://127.0.0.1:1",
    deploymentId,
    environment: "development",
    installationToken: token,
    webInternalUrl: "http://127.0.0.1:2",
    webSecret: secret,
    applicationVersion: "2.3.4",
    agentVersion: "0.1.0",
    imageDigest,
    migrationVersion: "0066",
    ...overrides,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
})

describe("agent configuration", () => {
  const validEnvironment = {
    CONTROL_PLANE_URL: "https://control.example.com/",
    DEPLOYMENT_ID: deploymentId,
    DEPLOYMENT_ENV: "production",
    INSTALLATION_TOKEN: token,
    WEB_INTERNAL_URL: "http://web:3000/",
    AGENT_WEB_SECRET: secret,
    APPLICATION_VERSION: "2.3.4",
    AGENT_VERSION: "0.1.0",
    IMAGE_DIGEST: imageDigest,
    MIGRATION_VERSION: "0066",
  }

  it("normalizes valid origins and keeps secret values out of errors", () => {
    expect(loadAgentConfig(validEnvironment)).toMatchObject({
      controlPlaneUrl: "https://control.example.com",
      webInternalUrl: "http://web:3000",
      deploymentId,
    })
    for (const [name, value] of Object.entries({
      CONTROL_PLANE_URL: "https://user:password@example.com",
      DEPLOYMENT_ID: "NOT-A-UUID",
      INSTALLATION_TOKEN: "short",
      AGENT_WEB_SECRET: "short",
      APPLICATION_VERSION: "latest",
      IMAGE_DIGEST: "sha256:ABC",
      MIGRATION_VERSION: "bad value",
    })) {
      expect(() => loadAgentConfig({ ...validEnvironment, [name]: value })).toThrowError(
        "Invalid deployment agent configuration",
      )
      try {
        loadAgentConfig({ ...validEnvironment, [name]: value })
      } catch (error) {
        expect(String(error)).not.toContain(value)
      }
    }
  })

  it("requires HTTPS control plane outside development and accepts development HTTP", () => {
    expect(() => loadAgentConfig({
      ...validEnvironment,
      CONTROL_PLANE_URL: "http://control.example.com",
    })).toThrowError("Invalid deployment agent configuration")
    expect(loadAgentConfig({
      ...validEnvironment,
      DEPLOYMENT_ENV: "development",
      CONTROL_PLANE_URL: "http://127.0.0.1:8787",
    }).controlPlaneUrl).toBe("http://127.0.0.1:8787")
  })

  it("bounds Retry-After seconds and HTTP dates", () => {
    const now = new Date("2026-08-10T00:00:00.000Z")
    expect(parseRetryAfterMs(new Headers({ "Retry-After": "999" }), now)).toBe(300_000)
    expect(parseRetryAfterMs(new Headers({ "Retry-After": "Sun, 10 Aug 2026 00:00:03 GMT" }), now)).toBe(3_000)
    expect(parseRetryAfterMs(new Headers({ "Retry-After": "invalid" }), now)).toBeNull()
  })
})

describe("durable identity and runtime state", () => {
  it("persists only private identity material before registration with strict permissions", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)

    expect(identity.keyId).toBeNull()
    expect(identity.privateJwk).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      d: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect((await lstat(directory)).mode & 0o777).toBe(0o700)
    expect((await lstat(join(directory, "identity.json"))).mode & 0o777).toBe(0o600)
    const disk = await readFile(join(directory, "identity.json"), "utf8")
    expect(disk).not.toContain(token)
    expect(await store.loadIdentity()).toEqual(identity)
  })

  it("rejects unsafe directory, symlink, permissions, and corrupt identity", async () => {
    const unsafeDirectory = await stateDirectory()
    await chmod(unsafeDirectory, 0o755)
    await expect(createStateStore(unsafeDirectory)).rejects.toThrow("Agent state is unsafe")

    const directory = await stateDirectory()
    await writeFile(join(directory, "target"), "{}", { mode: 0o600 })
    await symlink(join(directory, "target"), join(directory, "identity.json"))
    const symlinkStore = await createStateStore(directory)
    await expect(symlinkStore.loadIdentity()).rejects.toThrow("Agent identity is unsafe")

    const permissionsDirectory = await stateDirectory()
    await writeFile(join(permissionsDirectory, "identity.json"), "{}", { mode: 0o644 })
    const permissionsStore = await createStateStore(permissionsDirectory)
    await expect(permissionsStore.loadIdentity()).rejects.toThrow("Agent identity is unsafe")

    const corruptDirectory = await stateDirectory()
    await writeFile(join(corruptDirectory, "identity.json"), "{bad", { mode: 0o600 })
    const corruptStore = await createStateStore(corruptDirectory)
    await expect(corruptStore.loadIdentity()).rejects.toThrow("Agent identity is corrupt")
  })

  it("starts clean for corrupt runtime and preserves old state when atomic replacement fails", async () => {
    const directory = await stateDirectory()
    await writeFile(join(directory, "runtime.json"), "{bad", { mode: 0o600 })
    const store = await createStateStore(directory)
    expect(await store.loadRuntime()).toMatchObject({
      lastAppliedEntitlementVersion: null,
      hasAppliedValidEntitlement: false,
    })

    await store.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 7,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: "2026-08-10T00:00:00.000Z",
      lastErrorCode: null,
    })
    const failing = await createStateStore(directory, {
      beforeRename: () => { throw new Error("injected write failure") },
    })
    await expect(failing.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 8,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: "2026-08-10T00:01:00.000Z",
      lastErrorCode: null,
    })).rejects.toThrow("injected write failure")
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBe(7)
  })

  it("health fails only until one valid entitlement has been applied", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    expect(await readHealth(store)).toBe(false)
    await store.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 1,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: null,
      lastErrorCode: "control_unavailable",
    })
    expect(await readHealth(store)).toBe(true)
  })
})

type RecordedRequest = { method: string; path: string; body: string; headers: IncomingMessage["headers"] }

async function readRequest(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(value))
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (typeof address === "string" || address === null) throw new Error("Missing server address")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

describe("deployment agent flow", () => {
  it("allows registered startup without token but rejects unregistered startup without token", async () => {
    const registeredDirectory = await stateDirectory()
    const registeredStore = await createStateStore(registeredDirectory)
    const registeredIdentity = await generateIdentity(config(), registeredStore)
    await registeredStore.saveIdentity({ ...registeredIdentity, keyId })
    await expect(createDeploymentAgent({
      config: config({ installationToken: undefined }),
      store: registeredStore,
    }).initialize()).resolves.toBeUndefined()

    const newDirectory = await stateDirectory()
    const newStore = await createStateStore(newDirectory)
    await expect(createDeploymentAgent({
      config: config({ installationToken: undefined }),
      store: newStore,
    }).initialize()).rejects.toThrow("Installation token is required")
  })

  it("registers persisted key, signs interoperable requests, applies only newer entitlement, and reports config only", async () => {
    const controlRequests: RecordedRequest[] = []
    const webRequests: RecordedRequest[] = []
    let registeredPublicKey: JsonWebKey | null = null
    const envelope = { keyId: "vendor-key", payload: { revision: 4 }, signature: "signed-envelope" }

    const control = await listen(async (request, response) => {
      const body = await readRequest(request)
      const path = request.url ?? ""
      controlRequests.push({ method: request.method ?? "", path, body, headers: request.headers })
      if (path === "/v1/deployments/register") {
        const registration = JSON.parse(body) as { publicKey: JsonWebKey }
        registeredPublicKey = registration.publicKey
        json(response, 201, { deploymentId, keyId })
        return
      }
      const timestamp = request.headers["x-deployment-timestamp"]
      const nonce = request.headers["x-deployment-nonce"]
      const signature = request.headers["x-deployment-signature"]
      expect(typeof timestamp).toBe("string")
      expect(typeof nonce).toBe("string")
      expect(typeof signature).toBe("string")
      const verified = await crypto.subtle.verify(
        "Ed25519",
        await crypto.subtle.importKey("jwk", registeredPublicKey!, "Ed25519", false, ["verify"]),
        fromBase64Url(signature as string, 64),
        deploymentRequestTranscript({
          method: request.method as "GET" | "POST",
          path,
          deploymentId,
          keyId,
          timestamp: timestamp as string,
          nonce: nonce as string,
          bodyDigestHex: lowercaseHex(await sha256(new TextEncoder().encode(body))),
        }),
      )
      expect(verified).toBe(true)
      if (request.method === "POST") {
        const heartbeat = JSON.parse(body) as Record<string, unknown>
        expect(heartbeat).toMatchObject({
          deploymentId,
          applicationVersion: "2.3.4",
          migrationVersion: "0066",
          entitlementVersion: null,
          configurationVersion: "config-3",
          activeUserCount: 9,
        })
        json(response, 202, { accepted: true, entitlement: { version: 4 } })
      } else {
        json(response, 200, envelope)
      }
    })
    const web = await listen(async (request, response) => {
      const body = await readRequest(request)
      const path = request.url ?? ""
      webRequests.push({ method: request.method ?? "", path, body, headers: request.headers })
      expect(request.headers.authorization).toBe(`Bearer ${secret}`)
      if (request.method === "GET") {
        json(response, 200, {
          applicationVersion: "2.3.4",
          migrationVersion: "0066",
          entitlementVersion: null,
          configurationVersion: "config-3",
          activeUserCount: 9,
          reservedInvitationCount: 1,
          enabledModuleIds: ["projects"],
          healthState: "healthy",
          lastSuccessfulBackupAt: null,
          lastRestoreTestAt: null,
        })
      } else {
        expect(body).toBe(JSON.stringify(envelope))
        json(response, 200, { outcome: "accepted", revision: 4, mode: "active" })
      }
    })

    try {
      const directory = await stateDirectory()
      const store = await createStateStore(directory)
      const agent = createDeploymentAgent({
        config: config({ controlPlaneUrl: control.origin, webInternalUrl: web.origin }),
        store,
        random: () => 0,
      })
      await agent.initialize()
      expect((await store.loadIdentity())?.keyId).toBe(keyId)
      await agent.runOnce()
      expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBe(4)
      await agent.runOnce()
      expect(controlRequests.filter((request) => request.method === "GET")).toHaveLength(1)
      expect(webRequests.filter((request) => request.method === "PUT")).toHaveLength(1)
      expect(controlRequests.some((request) => request.path.includes("configuration"))).toBe(false)
      const nonces = controlRequests
        .map((request) => request.headers["x-deployment-nonce"])
        .filter((value): value is string => typeof value === "string")
      expect(new Set(nonces).size).toBe(nonces.length)
    } finally {
      await Promise.all([control.close(), web.close()])
    }
  })

  it("recovers registration after a lost first response without generating a new key", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const seenKeys: string[] = []
    let attempts = 0
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      attempts += 1
      const body = JSON.parse(String(init?.body)) as { publicKey: { x: string } }
      seenKeys.push(body.publicKey.x)
      if (attempts === 1) throw new TypeError("connection reset after response")
      return Response.json({ deploymentId, keyId }, { status: 201 })
    }

    const first = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await expect(first.initialize({ maxAttempts: 1 })).rejects.toThrow()
    const pending = await store.loadIdentity()
    expect(pending?.keyId).toBeNull()
    const restarted = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await restarted.initialize({ maxAttempts: 1 })
    expect(seenKeys).toEqual([pending?.privateJwk.x, pending?.privateJwk.x])
    expect((await store.loadIdentity())?.keyId).toBe(keyId)
  })

  it("does not advance runtime after fetch or apply failure and fails closed on control 401", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    const responses = [
      Response.json({
        applicationVersion: "2.3.4",
        migrationVersion: "0066",
        entitlementVersion: null,
        configurationVersion: null,
        activeUserCount: 0,
        reservedInvitationCount: 0,
        enabledModuleIds: [],
        healthState: "healthy",
        lastSuccessfulBackupAt: null,
        lastRestoreTestAt: null,
      }),
      Response.json({ accepted: true, entitlement: { version: 2 } }, { status: 202 }),
      new Response("unavailable", { status: 503 }),
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift() ?? new Response(null, { status: 401 }))
    const agent = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow()
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBeNull()

    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow()
    expect(agent.repairRequired).toBe(true)
    const calls = fetch.mock.calls.length
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow("repair")
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it("does not advance runtime when web rejects an entitlement application", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    const responses = [
      Response.json({
        applicationVersion: "2.3.4",
        migrationVersion: "0066",
        entitlementVersion: null,
        configurationVersion: null,
        activeUserCount: 0,
        reservedInvitationCount: 0,
        enabledModuleIds: [],
        healthState: "healthy",
        lastSuccessfulBackupAt: null,
        lastRestoreTestAt: null,
      }),
      Response.json({ accepted: true, entitlement: { version: 3 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 3 }, signature: "valid" }),
      new Response("rejected", { status: 400 }),
    ]
    const agent = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => responses.shift()!,
      random: () => 0,
    })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow()
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBeNull()
    expect(await readHealth(store)).toBe(false)
  })

  it("advances runtime for an idempotent same-revision web replay", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    const responses = [
      Response.json({
        applicationVersion: "2.3.4",
        migrationVersion: "0066",
        entitlementVersion: 5,
        configurationVersion: null,
        activeUserCount: 1,
        reservedInvitationCount: 0,
        enabledModuleIds: [],
        healthState: "healthy",
        lastSuccessfulBackupAt: null,
        lastRestoreTestAt: null,
      }),
      Response.json({ accepted: true, entitlement: { version: 5 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 5 }, signature: "valid" }),
      Response.json({ outcome: "idempotent", revision: 5, mode: "active" }, { status: 409 }),
    ]
    const agent = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => responses.shift()!,
      random: () => 0,
    })
    await agent.initialize()
    await agent.runOnce({ maxAttempts: 1 })
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBe(5)
  })

  it("rejects status responses containing identity data before heartbeat", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      applicationVersion: "2.3.4",
      migrationVersion: "0066",
      entitlementVersion: null,
      configurationVersion: null,
      activeUserCount: 1,
      reservedInvitationCount: 0,
      enabledModuleIds: [],
      healthState: "healthy",
      lastSuccessfulBackupAt: null,
      lastRestoreTestAt: null,
      users: ["person@example.com"],
    }))
    const agent = createDeploymentAgent({ config: config(), store, fetch })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow("invalid_response")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("retries transient failures with injected full-jitter delay", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    const status = {
      applicationVersion: "2.3.4",
      migrationVersion: "0066",
      entitlementVersion: null,
      configurationVersion: null,
      activeUserCount: 0,
      reservedInvitationCount: 0,
      enabledModuleIds: [],
      healthState: "healthy",
      lastSuccessfulBackupAt: null,
      lastRestoreTestAt: null,
    }
    const responses = [
      new Response(null, { status: 503 }),
      Response.json(status),
      Response.json({ accepted: true, entitlement: null }, { status: 202 }),
    ]
    const delays: number[] = []
    const agent = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => responses.shift()!,
      random: () => 0.5,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })
    await agent.initialize()
    await agent.runOnce({ maxAttempts: 2 })
    expect(delays).toEqual([500])
  })

  it("uses bounded full jitter, 15 minute cadence, and aborts in-flight work on shutdown", async () => {
    expect(heartbeatDelayMs(() => 0)).toBe(765_000)
    expect(heartbeatDelayMs(() => 1)).toBe(1_035_000)
    expect(backoffDelayMs(0, () => 0.5)).toBe(500)
    expect(backoffDelayMs(20, () => 1)).toBe(300_000)

    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.saveIdentity({ ...identity, keyId })
    let aborted = false
    const fetch: typeof globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true
        reject(new DOMException("Aborted", "AbortError"))
      })
    })
    const agent = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await agent.initialize()
    agent.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await agent.stop(500)
    expect(aborted).toBe(true)
  })

  it("never logs token, bearer secret, or private key", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity: AgentIdentity = await generateIdentity(config(), store)
    const logs: string[] = []
    const agent = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => { throw new TypeError(`${token} ${secret} ${identity.privateJwk.d}`) },
      logger: { info: (message) => logs.push(message), error: (message) => logs.push(message) },
      random: () => 0,
    })
    await expect(agent.initialize({ maxAttempts: 1 })).rejects.toThrow()
    const output = logs.join(" ")
    expect(output).not.toContain(token)
    expect(output).not.toContain(secret)
    expect(output).not.toContain(identity.privateJwk.d)
  })
})
