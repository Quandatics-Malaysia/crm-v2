import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

import { afterAll, describe, expect, it } from "vitest"

import {
  signEnvelope,
  type EntitlementLease,
  type SignedEnvelope,
} from "../../packages/control-protocol/src/index"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const runLifecycle = process.env.RUN_LICENSING_E2E === "1"

type CommandResult = { stdout: string; stderr: string; code: number }

function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => {
      const result = { stdout, stderr, code: code ?? 1 }
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`${command} ${args.join(" ")} failed (${result.code}): ${stderr || stdout}`))
        return
      }
      resolvePromise(result)
    })
  })
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Could not reserve port")
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify(value))
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 60_000
  let last: T | undefined
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (accept(last)) return last
    } catch {
      // Containers and routes are expected to be unavailable during startup.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`)
}

function iso(time: number): string {
  return new Date(time).toISOString()
}

describe.runIf(runLifecycle)("client Compose deployment entitlement lifecycle", () => {
  const ownedImages: string[] = []
  let composeArguments: string[] = []
  let project = ""
  let scratch = ""

  afterAll(async () => {
    if (composeArguments.length > 0) {
      await run("docker", [...composeArguments, "down", "--volumes", "--remove-orphans"], { allowFailure: true })
    }
    for (const image of ownedImages) {
      await run("docker", ["image", "rm", image], { allowFailure: true })
    }
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it("registers, enforces seats/modules/grace/read-only, and restores a signed lease", async () => {
    scratch = await mkdtemp(join(tmpdir(), "crm-licensing-e2e-"))
    project = `crmlicensing${process.pid}${Date.now()}`.toLowerCase()
    const webImage = `${project}-web:e2e`
    const migratorImage = `${project}-migrator:e2e`
    const agentImage = `${project}-agent:e2e`
    ownedImages.push(webImage, migratorImage, agentImage)

    const deploymentId = crypto.randomUUID()
    const signingKeyId = "vendor-e2e-1"
    const installationToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const webSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const signingKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const publicJwk = await crypto.subtle.exportKey("jwk", signingKeys.publicKey)
    const now = Date.now()
    const trustSet = {
      version: 1,
      keys: [{
        keyId: signingKeyId,
        publicJwk: { kty: "OKP", crv: "Ed25519", x: publicJwk.x },
        validFrom: iso(now - 365 * 24 * 60 * 60 * 1_000),
        validUntil: iso(now + 365 * 24 * 60 * 60 * 1_000),
      }],
    }

    let currentEnvelope: SignedEnvelope<EntitlementLease> | null = null
    let outage = false
    let outageRequests = 0
    const registrations: unknown[] = []
    const heartbeats: unknown[] = []
    const controlServer = createServer(async (request, response) => {
      const path = request.url ?? ""
      if (outage) {
        outageRequests += 1
        response.writeHead(503)
        response.end()
        return
      }
      if (request.method === "POST" && path === "/v1/deployments/register") {
        const registration = JSON.parse(await readBody(request)) as { deploymentId: string; keyId: string }
        registrations.push(registration)
        json(response, 201, { deploymentId: registration.deploymentId, keyId: registration.keyId })
        return
      }
      if (request.method === "POST" && path === `/v1/deployments/${deploymentId}/heartbeat`) {
        expect(request.headers["x-deployment-signature"]).toMatch(/^[A-Za-z0-9_-]+$/)
        heartbeats.push(JSON.parse(await readBody(request)))
        json(response, 202, {
          accepted: true,
          entitlement: currentEnvelope === null ? null : { version: currentEnvelope.payload.revision },
        })
        return
      }
      const match = path.match(new RegExp(`^/v1/deployments/${deploymentId}/entitlement/(\\d+)$`))
      if (request.method === "GET" && match && currentEnvelope?.payload.revision === Number(match[1])) {
        json(response, 200, currentEnvelope)
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolveListen, reject) => {
      controlServer.once("error", reject)
      controlServer.listen(0, "0.0.0.0", resolveListen)
    })
    const controlAddress = controlServer.address()
    if (controlAddress === null || typeof controlAddress === "string") throw new Error("Missing control address")

    const gatewayPort = await availablePort()
    const databasePort = await availablePort()
    const webPort = await availablePort()
    const envFile = join(scratch, "stack.env")
    const overrideFile = join(scratch, "compose.e2e.yaml")
    const digest = `sha256:${"a".repeat(64)}`
    await writeFile(envFile, [
      `COMPOSE_PROJECT_NAME=${project}`,
      `DEPLOYMENT_ID=${deploymentId}`,
      `STORAGE_ID=${project}`,
      "DB_NAME=crm",
      "RELEASE_TAG=v1.2.3",
      `SOURCE_COMMIT_SHA=${"1".repeat(40)}`,
      `WEB_IMAGE=${webImage}`,
      `MIGRATOR_IMAGE=${migratorImage}`,
      `BACKUP_IMAGE=${migratorImage}`,
      `AGENT_IMAGE=${agentImage}`,
      "POSTGRES_IMAGE=postgres:17-alpine",
      "CADDY_IMAGE=caddy:2-alpine",
      "POSTGRES_PASSWORD=e2e-postgres-password",
      "CRM_APP_PASSWORD=e2e-app-password",
      "BETTER_AUTH_SECRET=e2e-better-auth-secret-with-at-least-32-bytes",
      `BETTER_AUTH_URL=http://127.0.0.1:${gatewayPort}`,
      `APP_URL=http://127.0.0.1:${gatewayPort}`,
      "PLATFORM_MASTER_EMAIL=owner@example.test",
      "PLATFORM_MASTER_PASSWORD=e2e-platform-master-password",
      "BOOTSTRAP_OWNER_EMAIL=owner@example.test",
      `AGENT_WEB_SECRET=${webSecret}`,
      "APPLICATION_VERSION=1.2.3",
      "MIGRATION_VERSION=0069",
      `VENDOR_ENTITLEMENT_TRUST_SET=${JSON.stringify(trustSet)}`,
      `CONTROL_PLANE_URL=http://host.docker.internal:${controlAddress.port}`,
      "DEPLOYMENT_ENV=development",
      `INSTALLATION_TOKEN=${installationToken}`,
      "AGENT_VERSION=0.1.0",
      `IMAGE_DIGEST=${digest}`,
      "DEMO_TENANT_ID=e2e-entity",
      "DEMO_TENANT_NAME=E2E Entity",
      `GATEWAY_HOST_PORT=${gatewayPort}`,
      `DB_HOST_PORT=${databasePort}`,
      "DATABASE_ADMIN_URL=postgres://postgres:e2e-postgres-password@db:5432/crm",
      "MIGRATOR_DATABASE_URL=postgres://postgres:e2e-postgres-password@db:5432/crm",
      "APP_DATABASE_URL=postgres://crm_app:e2e-app-password@db:5432/crm",
    ].join("\n") + "\n", { mode: 0o600 })
    await writeFile(overrideFile, `services:\n  db:\n    image: postgres:17-alpine\n  migrate:\n    image: ${migratorImage}\n  web:\n    image: ${webImage}\n    ports:\n      - "127.0.0.1:${webPort}:3000"\n  agent:\n    image: ${agentImage}\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    healthcheck:\n      interval: 1s\n      timeout: 3s\n      retries: 3\n  gateway:\n    image: caddy:2-alpine\n`, "utf8")

    composeArguments = [
      "compose", "--project-name", project,
      "--file", join(repositoryRoot, "deploy/client/compose.yaml"),
      "--file", overrideFile,
      "--env-file", envFile,
      "--profile", "deploy",
    ]
    const compose = (args: string[], allowFailure = false) =>
      run("docker", [...composeArguments, ...args], { allowFailure })

    const lease = async (input: {
      revision: number
      status?: EntitlementLease["subscriptionStatus"]
      modules?: EntitlementLease["moduleIds"]
      issuedAt?: number
    }) => {
      const issuedAt = input.issuedAt ?? Date.now()
      currentEnvelope = await signEnvelope({
        schemaVersion: 2,
        revision: input.revision,
        keyId: signingKeyId,
        leaseId: `lease-${input.revision}`,
        clientId: "client-e2e",
        deploymentId,
        issuedAt: iso(issuedAt),
        leaseExpiresAt: iso(issuedAt + 24 * 60 * 60 * 1_000),
        contractStartsAt: iso(now - 365 * 24 * 60 * 60 * 1_000),
        contractEndsAt: iso(now + 365 * 24 * 60 * 60 * 1_000),
        graceUntil: iso(issuedAt + 8 * 24 * 60 * 60 * 1_000),
        subscriptionStatus: input.status ?? "active",
        planId: "e2e",
        maxActiveUsers: 2,
        moduleIds: input.modules ?? ["projects"],
        addonIds: [],
        configurationVersion: `config-${input.revision}`,
        releaseChannel: "stable",
        minimumSupportedAppVersion: "1.2.3",
        approvedImageDigest: digest,
      } satisfies EntitlementLease, signingKeyId, signingKeys.privateKey)
    }

    const internalStatus = async () => {
      const response = await fetch(`http://127.0.0.1:${webPort}/api/internal/deployment/status`, {
        headers: { Authorization: `Bearer ${webSecret}` },
      })
      if (!response.ok) throw new Error(`status ${response.status}`)
      return response.json() as Promise<{ entitlement: { revision: string | null; mode: string | null; enabledModuleIds: string[] } }>
    }

    try {
      await run("docker", ["build", "--file", "apps/deployment-agent/Dockerfile", "--tag", agentImage, "."])
      await run("docker", ["build", "--target", "runner", "--tag", webImage, "."])
      await run("docker", ["build", "--target", "migrator", "--tag", migratorImage, "."])
      await compose(["up", "-d", "db"])
      await eventually(
        async () => (await compose(["exec", "-T", "db", "pg_isready", "-U", "postgres", "-d", "crm"], true)).code,
        (code) => code === 0,
        "database readiness",
      )
      await compose(["run", "--rm", "--no-deps", "migrate"])
      await compose(["up", "-d", "web", "gateway", "agent"])
      await eventually(async () => registrations.length, (count) => count === 1, "agent registration")
      expect((await compose(["exec", "-T", "agent", "/usr/local/bin/agent-health"], true)).code).not.toBe(0)

      await lease({ revision: 1, modules: ["projects"] })
      await compose(["restart", "agent"])
      await eventually(internalStatus, (status) => status.entitlement.revision === "1", "active entitlement")
      expect((await compose(["exec", "-T", "agent", "/usr/local/bin/agent-health"], true)).code).toBe(0)

      const inspection = JSON.parse((await run("docker", ["inspect", `${project}-agent-1`])).stdout) as Array<{
        Config: { User: string; Env: string[] }
        HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; SecurityOpt: string[] }
        Mounts: Array<{ Destination: string; Type: string; Source: string }>
        NetworkSettings: { Networks: Record<string, unknown> }
      }>
      const container = inspection[0]!
      expect(container.Config.User).not.toMatch(/^(|0|root)(:0|:root)?$/)
      expect(container.Config.Env.some((value) => /^(DATABASE|POSTGRES|DB_)/.test(value))).toBe(false)
      expect(container.HostConfig.ReadonlyRootfs).toBe(true)
      expect(container.HostConfig.CapDrop).toContain("ALL")
      expect(container.HostConfig.SecurityOpt).toContain("no-new-privileges:true")
      expect(container.Mounts).toEqual([
        expect.objectContaining({ Destination: "/var/lib/crm-agent", Type: "volume" }),
      ])
      expect(Object.keys(container.NetworkSettings.Networks).sort()).toEqual([
        `${project}_agent-egress`, `${project}_agent-web`,
      ])
      expect(container.Mounts.some((mount) => mount.Source.includes("docker.sock") || mount.Source.includes(repositoryRoot))).toBe(false)

      const actor = (await compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "crm", "-At", "-F", "|", "-c",
        "select u.id,m.id,r.id from \"user\" u join member m on m.user_id=u.id join roles r on r.tenant_id=m.organization_id and r.name='Rep' where u.email='owner@example.test' and m.organization_id='e2e-entity' limit 1",
      ])).stdout.trim().split("|")
      expect(actor).toHaveLength(3)
      const reserve = async (email: string) => {
        const invitationId = crypto.randomUUID()
        const query = `select allowed,reason,reserved_invitation_count,seat_limit from reserve_deployment_invitation('${invitationId}'::uuid,'e2e-entity','${email}','${actor[2]}'::uuid,0,'${actor[1]}','${actor[0]}','${actor[1]}',now()+interval '1 day',now())`
        return (await compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "crm", "-At", "-F", "|", "-c", query])).stdout.trim()
      }
      expect(await reserve("seat-one@example.test")).toMatch(/^t\|allowed\|1\|2$/)
      expect(await reserve("seat-two@example.test")).toMatch(/^t\|allowed\|2\|2$/)
      expect(await reserve("seat-overflow@example.test")).toMatch(/^f\|seat_limit\|3\|2$/)
      const seatUsage = (await compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "crm", "-At", "-F", "|", "-c",
        "select occupied_user_count,reserved_invitation_count,seat_limit from read_deployment_seat_usage(now())",
      ])).stdout.trim()
      expect(seatUsage).toBe("0|2|2")

      const signIn = await fetch(`http://127.0.0.1:${gatewayPort}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${gatewayPort}` },
        body: JSON.stringify({ email: "owner@example.test", password: "e2e-platform-master-password" }),
      })
      expect(signIn.status).toBe(200)
      const cookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
      expect((await fetch(`http://127.0.0.1:${gatewayPort}/projects`, { headers: { Cookie: cookie } })).status).toBe(200)

      await lease({ revision: 2, modules: [] })
      await compose(["restart", "agent"])
      const disabledStatus = await eventually(internalStatus, (status) => status.entitlement.revision === "2", "module-disable entitlement")
      expect(disabledStatus.entitlement.enabledModuleIds).toEqual([])
      const disabledProjects = await fetch(`http://127.0.0.1:${gatewayPort}/projects`, {
        headers: { Cookie: cookie },
        redirect: "manual",
      })
      const disabledProjectsBody = await disabledProjects.text()
      const directRedirect = disabledProjects.status === 307 && disabledProjects.headers.get("location") === "/dashboard"
      const streamedRedirect = disabledProjects.status === 200 &&
        disabledProjectsBody.includes('http-equiv="refresh"') &&
        disabledProjectsBody.includes("url=/dashboard")
      expect(directRedirect || streamedRedirect).toBe(true)

      await lease({ revision: 3, modules: [], issuedAt: Date.now() - 25 * 60 * 60 * 1_000 })
      await compose(["restart", "agent"])
      await eventually(internalStatus, (status) => status.entitlement.mode === "grace", "offline grace")
      outage = true
      await compose(["restart", "agent"])
      await eventually(async () => outageRequests, (count) => count >= 1, "outage heartbeat attempt")
      expect((await internalStatus()).entitlement.mode).toBe("grace")
      expect((await compose(["exec", "-T", "agent", "/usr/local/bin/agent-health"], true)).code).toBe(0)

      outage = false
      await lease({ revision: 4, status: "suspended", modules: [] })
      await compose(["restart", "agent"])
      await eventually(internalStatus, (status) => status.entitlement.mode === "read_only", "commercial read-only")
      const denied = await fetch(`http://127.0.0.1:${gatewayPort}/api/auth/organization/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      })
      expect(denied.status).toBe(403)
      await expect(denied.json()).resolves.toMatchObject({ error: { code: "LICENSE_READ_ONLY" } })

      await lease({ revision: 5, modules: ["projects"] })
      await compose(["restart", "agent"])
      await eventually(internalStatus, (status) => status.entitlement.mode === "active" && status.entitlement.revision === "5", "restored lease")
      const restored = await fetch(`http://127.0.0.1:${gatewayPort}/api/auth/organization/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      })
      if (restored.status === 403) {
        await expect(restored.json()).resolves.not.toMatchObject({ error: { code: "LICENSE_READ_ONLY" } })
      }
      expect((await fetch(`http://127.0.0.1:${gatewayPort}/projects`, { headers: { Cookie: cookie } })).status).toBe(200)
      expect((await compose(["exec", "-T", "agent", "/usr/local/bin/agent-health"], true)).code).toBe(0)
    } finally {
      await new Promise<void>((resolveClose) => controlServer.close(() => resolveClose()))
    }
  }, 15 * 60 * 1_000)
})
