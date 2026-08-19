import type { DeploymentHeartbeat } from "@crm/control-protocol/heartbeat"

import { AgentRequestError, createDeploymentClient, type ClaimedCommand } from "./client.js"
import type { AgentConfig } from "./config.js"
import {
  assertIdentityMatches,
  generateIdentity,
  type AgentIdentity,
  type AgentRuntime,
  type AgentStateStore,
} from "./identity.js"

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1_000
const RETRY_CAP_MS = 5 * 60 * 1_000
const DEFAULT_ENTITLEMENT_POLL_MS = 60 * 1_000
const MIN_ENTITLEMENT_POLL_MS = 100
const MAX_ENTITLEMENT_POLL_MS = Math.floor(HEARTBEAT_INTERVAL_MS / 2)

type Logger = { info(message: string): void; error(message: string): void }
type AttemptOptions = { maxAttempts?: number }

export function heartbeatDelayMs(random: () => number = Math.random): number {
  return Math.round(HEARTBEAT_INTERVAL_MS * (0.85 + 0.3 * Math.min(1, Math.max(0, random()))))
}

export function entitlementPollDelayMs(
  intervalMs: number,
  random: () => number = Math.random,
): number {
  const basis = Math.max(MIN_ENTITLEMENT_POLL_MS, intervalMs)
  return Math.round(basis * (0.85 + 0.3 * Math.min(1, Math.max(0, random()))))
}

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(RETRY_CAP_MS, 1_000 * 2 ** Math.max(0, attempt))
  return Math.round(cap * Math.min(1, Math.max(0, random())))
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })
}

function errorCode(error: unknown): string {
  if (error instanceof AgentRequestError) return error.code
  if (error instanceof DOMException && error.name === "AbortError") return "aborted"
  return "agent_error"
}

export function createDeploymentAgent(input: {
  config: AgentConfig
  store: AgentStateStore
  fetch?: typeof globalThis.fetch
  now?: () => Date
  random?: () => number
  randomBytes?: (length: number) => Uint8Array<ArrayBuffer>
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  logger?: Logger
  entitlementPollMs?: number
}) {
  const now = input.now ?? (() => new Date())
  const random = input.random ?? Math.random
  const logger = input.logger ?? console
  const sleep = input.sleep ?? defaultSleep
  const entitlementPollMs = clampEntitlementPollMs(input.entitlementPollMs ?? DEFAULT_ENTITLEMENT_POLL_MS)
  const client = createDeploymentClient({
    config: input.config,
    fetch: input.fetch,
    now,
    randomBytes: input.randomBytes,
  })
  let identity: AgentIdentity | null = null
  let currentAbort: AbortController | null = null
  let currentWork: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollAbort: AbortController | null = null
  let pollWork: Promise<void> | null = null
  let applyTail: Promise<void> = Promise.resolve()
  let stopped = false
  let repairRequired = false

  async function attempt<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: AttemptOptions = {},
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 6
    currentAbort = new AbortController()
    try {
      for (let attemptNumber = 0; attemptNumber < maxAttempts; attemptNumber += 1) {
        try {
          return await operation(currentAbort.signal)
        } catch (error) {
          if (error instanceof AgentRequestError && error.repairRequired) {
            repairRequired = true
            throw error
          }
          if (
            !(error instanceof AgentRequestError) ||
            !error.retryable ||
            attemptNumber + 1 >= maxAttempts ||
            currentAbort.signal.aborted
          ) {
            throw error
          }
          const delay = error.retryAfterMs ?? backoffDelayMs(attemptNumber, random)
          await sleep(delay, currentAbort.signal)
        }
      }
      throw new Error("Retry attempts exhausted")
    } finally {
      currentAbort = null
    }
  }

  async function initialize(options: AttemptOptions = {}): Promise<void> {
    identity = await input.store.loadIdentity()
    if (identity === null) {
      if (!input.config.installationToken) throw new Error("Installation token is required")
      identity = await generateIdentity(input.config, input.store)
    }
    assertIdentityMatches(identity, input.config)
    if (await input.store.isRegistered(identity)) return
    if (!input.config.installationToken) throw new Error("Installation token is required")
    try {
      const registration = await attempt((signal) => client.register(identity!, signal), options)
      if (registration.keyId !== identity.keyId) throw new Error("Registration key does not match identity")
      await input.store.markRegistered(identity)
      logger.info("deployment_registration_succeeded")
    } catch (error) {
      logger.error(`deployment_registration_failed code=${errorCode(error)}`)
      throw error
    }
  }

  async function applyLatest(version: number, signal: AbortSignal): Promise<void> {
    const candidate = await client.entitlement(identity!, version, signal)
    await client.applyEntitlement(candidate.raw, version, signal)
    const runtime = await input.store.loadRuntime()
    await input.store.saveRuntime({
      ...runtime,
      lastAppliedEntitlementVersion: version,
      hasAppliedValidEntitlement: true,
      lastErrorCode: null,
    })
  }

  function withApplyLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = applyTail
    let release!: () => void
    applyTail = new Promise<void>((resolve) => { release = resolve })
    return previous
      .catch(() => undefined)
      .then(() => work())
      .finally(() => { release() })
  }

  async function pollOnceInternal(signal: AbortSignal): Promise<void> {
    if (identity === null || !await input.store.isRegistered(identity)) throw new Error("Agent is not initialized")
    const statusResult = await client.status(signal)
    const webRevision = statusResult.entitlement.revision === null
      ? null
      : Number(statusResult.entitlement.revision)
    if (webRevision === null) return
    const runtime = await input.store.loadRuntime()
    if (webRevision === runtime.lastAppliedEntitlementVersion) return
    await withApplyLock(() => applyLatest(webRevision, signal))
  }

  async function pollCommandsOnce(signal: AbortSignal): Promise<void> {
    if (identity === null || !await input.store.isRegistered(identity)) throw new Error("Agent is not initialized")
    const envelopeRecord = await client.nextCommand(identity, signal)
    if (envelopeRecord === null) return
    const ack = await executeCommand(identity, envelopeRecord, signal)
    await client.acknowledgeCommand(identity, envelopeRecord.id, ack, signal)
  }

  async function executeCommand(
    identity: AgentIdentity,
    envelopeRecord: ClaimedCommand,
    signal: AbortSignal,
  ): Promise<unknown> {
    const ackTemplate = {
      commandId: envelopeRecord.id,
      deploymentId: input.config.deploymentId,
      status: "ok" as const,
      outcome: "completed" as const,
      output: null,
      errorCode: null,
      errorMessage: null,
      artifact: null,
      completedAt: now().toISOString(),
      agentVersion: input.config.agentVersion,
    }
    const kind = envelopeRecord.envelope.payload.payload.kind
    if (kind === "echo") {
      return { ...ackTemplate, output: { received: "echo" } }
    }
    return {
      ...ackTemplate,
      status: "error",
      outcome: "skipped",
      errorCode: "command_not_implemented",
      errorMessage: `command kind ${kind ?? "unknown"} is not implemented in this agent build`,
    }
  }

  async function cycle(signal: AbortSignal): Promise<void> {
    if (identity === null || !await input.store.isRegistered(identity)) throw new Error("Agent is not initialized")
    let runtime = await input.store.loadRuntime()
    const status = await client.status(signal)
    if (
      status.applicationVersion !== input.config.applicationVersion ||
      status.migrationVersion !== input.config.migrationVersion
    ) {
      throw new AgentRequestError("web_metadata_mismatch", false)
    }
    const webRevision = status.entitlement.revision === null
      ? null
      : Number(status.entitlement.revision)
    runtime = {
      ...runtime,
      lastAppliedEntitlementVersion: webRevision,
      lastAppliedConfigurationVersion: status.entitlement.configurationVersion,
      hasAppliedValidEntitlement: webRevision !== null,
      lastErrorCode: null,
    }
    await input.store.saveRuntime(runtime)
    const heartbeat: DeploymentHeartbeat = {
      deploymentId: input.config.deploymentId,
      environment: input.config.environment,
      applicationVersion: status.applicationVersion,
      imageDigest: input.config.imageDigest,
      entitlementVersion: status.entitlement.revision,
      configurationVersion: status.entitlement.configurationVersion,
      activeUserCount: status.activeUserCount,
      reservedInvitationCount: status.reservedInvitationCount,
      enabledModuleIds: status.entitlement.enabledModuleIds,
      healthState: status.healthState,
      migrationVersion: status.migrationVersion,
      lastSuccessfulBackupAt: null,
      lastRestoreTestAt: null,
      agentVersion: input.config.agentVersion,
    }
    const response = await client.heartbeat(identity, heartbeat, signal)
    runtime = {
      ...runtime,
      lastHeartbeatSucceededAt: now().toISOString(),
      lastErrorCode: null,
    }
    await input.store.saveRuntime(runtime)

    const version = response.entitlement?.version
    if (version === undefined) {
      if (webRevision !== null) throw new AgentRequestError("control_entitlement_regressed", false)
      return
    }
    if (webRevision !== null && webRevision > version) {
      throw new AgentRequestError("control_entitlement_regressed", false)
    }
    if (webRevision === version) return
    await withApplyLock(() => applyLatest(version, signal))
  }

  async function runOnce(options: AttemptOptions = {}): Promise<void> {
    if (repairRequired) throw new Error("Agent requires operator repair")
    try {
      await attempt(cycle, options)
      logger.info("deployment_heartbeat_succeeded")
    } catch (error) {
      const runtime = await input.store.loadRuntime()
      await input.store.saveRuntime({ ...runtime, lastErrorCode: errorCode(error) }).catch(() => undefined)
      logger.error(`deployment_heartbeat_failed code=${errorCode(error)}`)
      throw error
    }
  }

  async function runPollOnce(options: AttemptOptions = {}): Promise<void> {
    if (repairRequired) throw new Error("Agent requires operator repair")
    try {
      await attempt(pollOnceInternal, options)
      logger.info("deployment_entitlement_poll_succeeded")
    } catch (error) {
      const runtime = await input.store.loadRuntime()
      await input.store.saveRuntime({ ...runtime, lastErrorCode: errorCode(error) }).catch(() => undefined)
      logger.error(`deployment_entitlement_poll_failed code=${errorCode(error)}`)
      throw error
    }
  }

  async function runCommandPollOnce(options: AttemptOptions = {}): Promise<void> {
    if (repairRequired) throw new Error("Agent requires operator repair")
    try {
      await attempt(pollCommandsOnce, options)
      logger.info("deployment_command_poll_succeeded")
    } catch (error) {
      logger.error(`deployment_command_poll_failed code=${errorCode(error)}`)
      throw error
    }
  }

  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => {
      currentWork = runOnce().catch(() => undefined).finally(() => {
        currentWork = null
        schedule()
      })
    }, heartbeatDelayMs(random))
  }

  function schedulePoll(): void {
    if (stopped) return
    pollTimer = setTimeout(() => {
      pollAbort = new AbortController()
      pollWork = runPollOnce().catch(() => undefined).finally(() => {
        pollWork = null
        pollAbort = null
        schedulePoll()
      })
    }, entitlementPollDelayMs(entitlementPollMs, random))
  }

  function start(): void {
    if (currentWork !== null || timer !== null) return
    stopped = false
    currentWork = runOnce().catch(() => undefined).finally(() => {
      currentWork = null
      schedule()
      schedulePoll()
    })
  }

  async function stop(timeoutMs = 5_000): Promise<void> {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
    currentAbort?.abort()
    pollAbort?.abort()
    const work = currentWork
    if (work !== null) {
      await Promise.race([
        work,
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, timeoutMs))),
      ])
    }
    const poll = pollWork
    if (poll !== null) {
      await Promise.race([
        poll,
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, timeoutMs))),
      ])
    }
    await applyTail.catch(() => undefined)
  }

  return {
    initialize,
    runOnce,
    pollOnce: runPollOnce,
    pollCommands: runCommandPollOnce,
    start,
    stop,
    get repairRequired() { return repairRequired },
  }
}

function clampEntitlementPollMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ENTITLEMENT_POLL_MS
  const rounded = Math.round(value)
  if (rounded < MIN_ENTITLEMENT_POLL_MS) return MIN_ENTITLEMENT_POLL_MS
  if (rounded > MAX_ENTITLEMENT_POLL_MS) return MAX_ENTITLEMENT_POLL_MS
  return rounded
}

export async function readHealth(store: AgentStateStore): Promise<boolean> {
  return (await store.loadRuntime()).hasAppliedValidEntitlement === true
}
