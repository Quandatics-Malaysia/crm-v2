import { chmod, lstat, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises"
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
  type StateIoHooks,
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

function status(
  revision: string | null = null,
  overrides: Record<string, unknown> = {},
) {
  return {
    healthState: revision === null ? "unhealthy" : "healthy",
    entitlement: {
      revision,
      configurationVersion: null,
      mode: revision === null ? null : "active",
      enabledModuleIds: [],
    },
    activeUserCount: 0,
    reservedInvitationCount: 0,
    applicationVersion: "2.3.4",
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
      AGENT_VERSION: "1.0.0-01",
      IMAGE_DIGEST: "sha256:ABC",
      MIGRATION_VERSION: "6",
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

    expect(identity.keyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await store.isRegistered(identity)).toBe(false)
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

  it("concurrent first boot installs one immutable identity and both processes converge", async () => {
    const directory = await stateDirectory()
    let waiting = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const beforeIdentityInstall = async () => {
      waiting += 1
      if (waiting === 2) release()
      await barrier
    }
    const firstStore = await createStateStore(directory, { beforeIdentityInstall })
    const secondStore = await createStateStore(directory, { beforeIdentityInstall })

    const [first, second] = await Promise.all([
      generateIdentity(config(), firstStore),
      generateIdentity(config(), secondStore),
    ])

    expect(first).toEqual(second)
    expect(await firstStore.loadIdentity()).toEqual(first)
    expect(await firstStore.isRegistered(first)).toBe(false)
  })

  it("does not register an observed identity until its directory entry is durable", async () => {
    const directory = await stateDirectory()
    let releaseFirstLink!: () => void
    let releaseObserverLink!: () => void
    let releasePublisherSync!: () => void
    let releaseObserverSync!: () => void
    let signalFirstReady!: () => void
    let signalObserverReady!: () => void
    let signalPublished!: () => void
    let signalObserverBarrier!: () => void
    let signalServerAttempt!: () => void
    const firstReady = new Promise<void>((resolve) => { signalFirstReady = resolve })
    const firstMayLink = new Promise<void>((resolve) => { releaseFirstLink = resolve })
    const observerReady = new Promise<void>((resolve) => { signalObserverReady = resolve })
    const observerMayLink = new Promise<void>((resolve) => { releaseObserverLink = resolve })
    const published = new Promise<void>((resolve) => { signalPublished = resolve })
    const publisherMaySync = new Promise<void>((resolve) => { releasePublisherSync = resolve })
    const observerBarrier = new Promise<void>((resolve) => { signalObserverBarrier = resolve })
    const observerMaySync = new Promise<void>((resolve) => { releaseObserverSync = resolve })
    const serverAttempt = new Promise<void>((resolve) => { signalServerAttempt = resolve })
    let observerSyncPaused = false
    let serverCommits = 0
    const firstHooks: StateIoHooks = {
      beforeIdentityInstall: async () => {
        signalFirstReady()
        await firstMayLink
      },
      beforePublishDirectorySync: async (target) => {
        if (target !== "identity") return
        signalPublished()
        await publisherMaySync
      },
    }
    const observerHooks: StateIoHooks = {
      beforeIdentityInstall: async () => {
        signalObserverReady()
        await observerMayLink
      },
      beforeDirectorySync: async (target) => {
        if (target !== "identity" || observerSyncPaused) return
        observerSyncPaused = true
        signalObserverBarrier()
        await observerMaySync
      },
    }
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const registration = await request.json() as { keyId: string }
      serverCommits += 1
      signalServerAttempt()
      return Response.json({ deploymentId, keyId: registration.keyId }, { status: 201 })
    }
    const firstStore = await createStateStore(directory, firstHooks)
    const first = createDeploymentAgent({ config: config(), store: firstStore, fetch })
    const firstInitialization = first.initialize({ maxAttempts: 1 })

    await firstReady
    const observerStore = await createStateStore(directory, observerHooks)
    const observer = createDeploymentAgent({ config: config(), store: observerStore, fetch })
    const observerInitialization = observer.initialize({ maxAttempts: 1 })
    await observerReady
    releaseFirstLink()
    const firstEvent = await Promise.race([
      published.then(() => "published" as const),
      serverAttempt.then(() => "server" as const),
    ])

    try {
      expect(firstEvent).toBe("published")
      expect(serverCommits).toBe(0)

      releaseObserverLink()
      const observerEvent = await Promise.race([
        observerBarrier.then(() => "durability" as const),
        serverAttempt.then(() => "server" as const),
      ])
      expect(observerEvent).toBe("durability")
      expect(serverCommits).toBe(0)

      releaseObserverSync()
      await observerInitialization
      expect(serverCommits).toBe(1)
      releasePublisherSync()
      await firstInitialization
      expect(serverCommits).toBe(1)
    } finally {
      releaseObserverLink()
      releaseObserverSync()
      releasePublisherSync()
      await observerInitialization.catch(() => undefined)
      await firstInitialization.catch(() => undefined)
    }
  })

  it("does not accept an observed registration marker until its directory entry is durable", async () => {
    const directory = await stateDirectory()
    const identity = await generateIdentity(config(), await createStateStore(directory))
    let releasePublisherSync!: () => void
    let releaseObserverSync!: () => void
    let signalPublished!: () => void
    let signalObserverBarrier!: () => void
    const published = new Promise<void>((resolve) => { signalPublished = resolve })
    const publisherMaySync = new Promise<void>((resolve) => { releasePublisherSync = resolve })
    const observerBarrier = new Promise<void>((resolve) => { signalObserverBarrier = resolve })
    const observerMaySync = new Promise<void>((resolve) => { releaseObserverSync = resolve })
    const publisherHooks: StateIoHooks = {
      beforePublishDirectorySync: async (target) => {
        if (target !== "registration") return
        signalPublished()
        await publisherMaySync
      },
    }
    const observerHooks: StateIoHooks = {
      beforeDirectorySync: async (target) => {
        if (target !== "registration") return
        signalObserverBarrier()
        await observerMaySync
      },
    }
    const publisherStore = await createStateStore(directory, publisherHooks)
    const observerStore = await createStateStore(directory, observerHooks)
    const publisher = publisherStore.markRegistered(identity)
    const firstEvent = await Promise.race([
      published.then(() => "published" as const),
      publisher.then(() => "accepted" as const),
    ])

    try {
      expect(firstEvent).toBe("published")
      const observer = observerStore.markRegistered(identity)
      const observerEvent = await Promise.race([
        observerBarrier.then(() => "durability" as const),
        observer.then(() => "accepted" as const),
      ])
      expect(observerEvent).toBe("durability")

      releaseObserverSync()
      await observer
      releasePublisherSync()
      await publisher
      expect(await observerStore.isRegistered(identity)).toBe(true)
    } finally {
      releaseObserverSync()
      releasePublisherSync()
      await publisher.catch(() => undefined)
    }
  })

  it("does not register or leave temporary files when identity directory sync fails", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory, {
      beforePublishDirectorySync(target) {
        if (target === "identity") throw new Error("simulated directory sync failure")
      },
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init)
      const registration = await request.json() as { keyId: string }
      return Response.json({ deploymentId, keyId: registration.keyId }, { status: 201 })
    })
    const agent = createDeploymentAgent({ config: config(), store, fetch })

    await expect(agent.initialize({ maxAttempts: 1 })).rejects.toThrow("simulated directory sync failure")
    expect(fetch).not.toHaveBeenCalled()
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([])
    expect(JSON.parse(await readFile(join(directory, "identity.json"), "utf8"))).toMatchObject({
      deploymentId,
      keyId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })

  it("serializes registration state without overwriting a conflicting key ID", async () => {
    const directory = await stateDirectory()
    const firstStore = await createStateStore(directory)
    const secondStore = await createStateStore(directory)
    const identity = await generateIdentity(config(), firstStore)

    await Promise.all([
      firstStore.markRegistered(identity),
      secondStore.markRegistered(identity),
    ])
    expect(await firstStore.isRegistered(identity)).toBe(true)
    await expect(secondStore.markRegistered({
      ...identity,
      keyId: "33333333-3333-4333-8333-333333333333",
    })).rejects.toThrow("does not match identity")
    expect(await firstStore.isRegistered(identity)).toBe(true)
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
    await registeredStore.markRegistered(registeredIdentity)
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
    let registeredKeyId: string | null = null
    let webRevision: string | null = null
    const envelope = { keyId: "vendor-key", payload: { revision: 4 }, signature: "signed-envelope" }

    const control = await listen(async (request, response) => {
      const body = await readRequest(request)
      const path = request.url ?? ""
      controlRequests.push({ method: request.method ?? "", path, body, headers: request.headers })
      if (path === "/v1/deployments/register") {
        const registration = JSON.parse(body) as { keyId: string; publicKey: JsonWebKey }
        registeredPublicKey = registration.publicKey
        registeredKeyId = registration.keyId
        json(response, 201, { deploymentId, keyId: registration.keyId })
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
          keyId: registeredKeyId!,
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
          entitlementVersion: webRevision,
          configurationVersion: webRevision === null ? null : "config-3",
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
        json(response, 200, status(webRevision, {
          healthState: webRevision === null ? "unhealthy" : "healthy",
          entitlement: {
            revision: webRevision,
            configurationVersion: webRevision === null ? null : "config-3",
            mode: webRevision === null ? null : "active",
            enabledModuleIds: webRevision === null ? [] : ["projects"],
          },
          activeUserCount: 9,
          reservedInvitationCount: 1,
        }))
      } else {
        expect(body).toBe(JSON.stringify(envelope))
        webRevision = "4"
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
      const persistedIdentity = await store.loadIdentity()
      expect(persistedIdentity?.keyId).toBe(registeredKeyId)
      expect(await store.isRegistered(persistedIdentity!)).toBe(true)
      expect((await lstat(join(directory, "registration.json"))).mode & 0o777).toBe(0o600)
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
    const seenKeyIds: string[] = []
    let attempts = 0
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      attempts += 1
      const body = JSON.parse(String(init?.body)) as { keyId: string; publicKey: { x: string } }
      seenKeys.push(body.publicKey.x)
      seenKeyIds.push(body.keyId)
      if (attempts === 1) throw new TypeError("connection reset after response")
      return Response.json({ deploymentId, keyId: body.keyId }, { status: 201 })
    }

    const first = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await expect(first.initialize({ maxAttempts: 1 })).rejects.toThrow()
    const pending = await store.loadIdentity()
    expect(pending?.keyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await store.isRegistered(pending!)).toBe(false)
    const restarted = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await restarted.initialize({ maxAttempts: 1 })
    expect(seenKeys).toEqual([pending?.privateJwk.x, pending?.privateJwk.x])
    expect(new Set(seenKeyIds)).toEqual(new Set([pending!.keyId]))
    expect(await store.isRegistered((await store.loadIdentity())!)).toBe(true)
  })

  it("does not advance runtime after fetch or apply failure and fails closed on control 401", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    const responses = [
      Response.json(status()),
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
    await store.markRegistered(identity)
    const responses = [
      Response.json(status()),
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
    await store.markRegistered(identity)
    const responses = [
      Response.json(status(null, { activeUserCount: 1 })),
      Response.json({ accepted: true, entitlement: { version: 5 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 5 }, signature: "valid" }),
      Response.json({ outcome: "idempotent", revision: 5, mode: "active" }, { status: 200 }),
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

  it.each([201, 409])("does not advance runtime unless web apply returns exactly 200, got %i", async (statusCode) => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    const responses = [
      Response.json(status()),
      Response.json({ accepted: true, entitlement: { version: 5 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 5 }, signature: "valid" }),
      Response.json({ outcome: "idempotent", revision: 5, mode: "active" }, { status: statusCode }),
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
  })

  it("rejects status responses containing identity data before heartbeat", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(status(null, {
      activeUserCount: 1,
      users: ["person@example.com"],
    })))
    const agent = createDeploymentAgent({ config: config(), store, fetch })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow("invalid_response")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("rejects status responses with a noncanonical migration version before heartbeat", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(status(null, {
      migrationVersion: "6",
    })))
    const agent = createDeploymentAgent({ config: config(), store, fetch })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow("invalid_response")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("repairs web entitlement loss even when runtime telemetry already has that revision", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    await store.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 5,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: null,
      lastErrorCode: null,
    })
    const responses = [
      Response.json(status()),
      Response.json({ accepted: true, entitlement: { version: 5 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 5 }, signature: "valid" }),
      Response.json({ outcome: "accepted", revision: 5, mode: "active" }),
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift()!)
    const agent = createDeploymentAgent({ config: config(), store, fetch, random: () => 0 })
    await agent.initialize()
    await agent.runOnce({ maxAttempts: 1 })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(await readHealth(store)).toBe(true)
  })

  it("repairs from authoritative lower web revision and rejects control regression", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    await store.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 9,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: null,
      lastErrorCode: null,
    })
    const repairResponses = [
      Response.json(status("3")),
      Response.json({ accepted: true, entitlement: { version: 4 } }, { status: 202 }),
      Response.json({ keyId: "vendor", payload: { revision: 4 }, signature: "valid" }),
      Response.json({ outcome: "accepted", revision: 4, mode: "active" }),
    ]
    const repair = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => repairResponses.shift()!,
      random: () => 0,
    })
    await repair.initialize()
    await repair.runOnce({ maxAttempts: 1 })
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBe(4)

    const regressionFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(status("5")))
      .mockResolvedValueOnce(Response.json({ accepted: true, entitlement: { version: 4 } }, { status: 202 }))
    const regression = createDeploymentAgent({ config: config(), store, fetch: regressionFetch })
    await regression.initialize()
    await expect(regression.runOnce({ maxAttempts: 1 })).rejects.toThrow("control_entitlement_regressed")
    expect(regressionFetch).toHaveBeenCalledTimes(2)
  })

  it("marks health false as soon as authenticated web status reports lost LKG", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    await store.saveRuntime({
      schemaVersion: 1,
      lastAppliedEntitlementVersion: 5,
      lastAppliedConfigurationVersion: null,
      hasAppliedValidEntitlement: true,
      lastHeartbeatSucceededAt: null,
      lastErrorCode: null,
    })
    const responses = [
      Response.json(status()),
      Response.json({ accepted: true, entitlement: { version: 5 } }, { status: 202 }),
      new Response(null, { status: 503 }),
    ]
    const agent = createDeploymentAgent({
      config: config(),
      store,
      fetch: async () => responses.shift()!,
      random: () => 0,
    })
    await agent.initialize()
    await expect(agent.runOnce({ maxAttempts: 1 })).rejects.toThrow("http_503")
    expect(await readHealth(store)).toBe(false)
    expect((await store.loadRuntime()).lastAppliedEntitlementVersion).toBeNull()
  })

  it("retries transient failures with injected full-jitter delay", async () => {
    const directory = await stateDirectory()
    const store = await createStateStore(directory)
    const identity = await generateIdentity(config(), store)
    await store.markRegistered(identity)
    const currentStatus = status()
    const responses = [
      new Response(null, { status: 503 }),
      Response.json(currentStatus),
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
    await store.markRegistered(identity)
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
