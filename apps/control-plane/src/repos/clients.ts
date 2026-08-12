import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, conflict, notFound } from "../http/errors"

export interface MutationActor {
  operatorId: string
  requestId: string
}

export interface ClientInput {
  clientKey: unknown
  displayName: unknown
}

export interface OrganisationInput {
  organisationKey: unknown
  displayName: unknown
  metadataJson: unknown
}

export interface DeploymentInput {
  deploymentKey: unknown
  environment: unknown
  status: unknown
}

export interface ClientListItem {
  id: string
  clientKey: string
  displayName: string
  status: string
}

export interface PageRequest {
  page: number
  pageSize: number
  offset: number
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  hasNext: boolean
}

export interface ClientChildPagination {
  organisations: PageRequest
  deployments: PageRequest
  contracts: PageRequest
}

export interface ClientDetail extends ClientListItem {
  activePlans: Array<{ id: string; planKey: string; displayName: string }>
  organisations: PageResult<{ id: string; organisationKey: string; displayName: string }>
  deployments: PageResult<{
    id: string
    deploymentKey: string
    environment: string
    status: string
    registeredAt: string | null
    observedAt: string | null
    healthStatus: string | null
    occupiedSeats: number | null
    applicationVersion: string | null
    agentVersion: string | null
    imageDigest: string | null
    entitlementVersion: string | null
    lastSuccessfulBackupAt: string | null
  }>
  contracts: PageResult<{ id: string; status: string; startsAt: string; endsAt: string; seatLimit: number }>
}

function textField(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw badRequest()
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maximum) throw badRequest()
  return trimmed
}

function stableKey(value: unknown): string {
  const key = textField(value, 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) throw badRequest()
  return key
}

function parseMetadata(value: unknown): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 8_192) {
    throw badRequest()
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw badRequest()
    }
    return JSON.stringify(parsed)
  } catch (error) {
    if (error instanceof Error && error.name === "SafeHttpError") throw error
    throw badRequest()
  }
}

async function rowExists(database: D1Database, sql: string, ...values: unknown[]): Promise<boolean> {
  return (await database.prepare(sql).bind(...values).first()) !== null
}

export async function createClient(
  database: D1Database,
  input: ClientInput,
  actor: MutationActor,
): Promise<string> {
  const clientKey = stableKey(input.clientKey)
  const displayName = textField(input.displayName, 160)
  if (await rowExists(database, "SELECT 1 FROM clients WHERE client_key = ?", clientKey)) {
    throw conflict()
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "client.create",
    targetType: "client",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { clientKey },
    createdAt: now,
  })

  try {
    await database.batch([
      database.prepare(
        "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).bind(id, clientKey, displayName, now, now),
      audit.statement,
    ])
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw conflict()
    throw error
  }
  return id
}

export async function createClientOrganisation(
  database: D1Database,
  clientId: string,
  input: OrganisationInput,
  actor: MutationActor,
): Promise<string> {
  if (!(await rowExists(database, "SELECT 1 FROM clients WHERE id = ?", clientId))) {
    throw notFound()
  }
  const organisationKey = stableKey(input.organisationKey)
  const displayName = textField(input.displayName, 160)
  const metadataJson = parseMetadata(input.metadataJson)
  if (
    await rowExists(
      database,
      "SELECT 1 FROM client_organisations WHERE client_id = ? AND organisation_key = ?",
      clientId,
      organisationKey,
    )
  ) {
    throw conflict()
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "client_organisation.create",
    targetType: "client_organisation",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { clientId, organisationKey },
    createdAt: now,
  })
  try {
    await database.batch([
      database.prepare(
        "INSERT INTO client_organisations (id, client_id, organisation_key, display_name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, clientId, organisationKey, displayName, metadataJson, now, now),
      audit.statement,
    ])
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw conflict()
    throw error
  }
  return id
}

export async function createDeployment(
  database: D1Database,
  clientId: string,
  input: DeploymentInput,
  actor: MutationActor,
): Promise<string> {
  if (!(await rowExists(database, "SELECT 1 FROM clients WHERE id = ?", clientId))) {
    throw notFound()
  }
  const deploymentKey = stableKey(input.deploymentKey)
  const environment = textField(input.environment, 32)
  const status = textField(input.status, 32)
  if (!["development", "staging", "production"].includes(environment)) throw badRequest()
  if (!["active", "disabled"].includes(status)) throw badRequest()
  if (await rowExists(database, "SELECT 1 FROM deployments WHERE deployment_key = ?", deploymentKey)) {
    throw conflict()
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "deployment.create",
    targetType: "deployment",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { clientId, deploymentKey, environment },
    createdAt: now,
  })
  try {
    await database.batch([
      database.prepare(
        "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, clientId, deploymentKey, environment, status, now, now),
      audit.statement,
    ])
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw conflict()
    throw error
  }
  return id
}

export function parsePagination(url: string): { page: number; pageSize: number; offset: number } {
  const search = new URL(url).searchParams
  const pageValue = search.get("page") ?? "1"
  const pageSizeValue = search.get("pageSize") ?? "25"
  if (!/^\d+$/.test(pageValue) || !/^\d+$/.test(pageSizeValue)) throw badRequest()
  const page = Number(pageValue)
  const pageSize = Number(pageSizeValue)
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || pageSize < 1 || pageSize > 50) {
    throw badRequest()
  }
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export function parseNamedPagination(url: string, name: string): PageRequest {
  if (!/^[a-z]+$/i.test(name)) throw badRequest()
  const search = new URL(url).searchParams
  const pageValue = search.get(`${name}Page`) ?? "1"
  const pageSizeValue = search.get(`${name}PageSize`) ?? "25"
  if (!/^\d+$/.test(pageValue) || !/^\d+$/.test(pageSizeValue)) throw badRequest()
  const page = Number(pageValue)
  const pageSize = Number(pageSizeValue)
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || pageSize < 1 || pageSize > 50) {
    throw badRequest()
  }
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export function parseClientChildPagination(url: string): ClientChildPagination {
  return {
    organisations: parseNamedPagination(url, "organisations"),
    deployments: parseNamedPagination(url, "deployments"),
    contracts: parseNamedPagination(url, "contracts"),
  }
}

function pageResult<T>(rows: T[], request: PageRequest): PageResult<T> {
  return {
    items: rows.slice(0, request.pageSize),
    page: request.page,
    pageSize: request.pageSize,
    hasNext: rows.length > request.pageSize,
  }
}

export async function listClients(
  database: D1Database,
  pageSize: number,
  offset: number,
): Promise<ClientListItem[]> {
  const result = await database.prepare(
    "SELECT id, client_key, display_name, status FROM clients ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
  ).bind(pageSize, offset).all<{
    id: string
    client_key: string
    display_name: string
    status: string
  }>()
  return result.results.map((row) => ({
    id: row.id,
    clientKey: row.client_key,
    displayName: row.display_name,
    status: row.status,
  }))
}

export async function getClientDetail(
  database: D1Database,
  clientId: string,
  pagination: ClientChildPagination,
): Promise<ClientDetail> {
  const client = await database.prepare(
    "SELECT id, client_key, display_name, status FROM clients WHERE id = ?",
  ).bind(clientId).first<{
    id: string
    client_key: string
    display_name: string
    status: string
  }>()
  if (!client) throw notFound()

  const [organisations, deployments, contracts, activePlans] = await Promise.all([
    database.prepare(
      "SELECT id, organisation_key, display_name FROM client_organisations WHERE client_id = ? ORDER BY organisation_key LIMIT ? OFFSET ?",
    ).bind(
      clientId,
      pagination.organisations.pageSize + 1,
      pagination.organisations.offset,
    ).all<{ id: string; organisation_key: string; display_name: string }>(),
    database.prepare(
      "SELECT d.id, d.deployment_key, d.environment, d.status, d.registered_at, h.observed_at, h.health_status, h.occupied_seats, h.application_version, h.agent_version, h.image_digest, h.entitlement_version, h.last_successful_backup_at FROM deployments d LEFT JOIN heartbeat_rollups h ON h.id = (SELECT latest.id FROM heartbeat_rollups latest WHERE latest.deployment_id = d.id ORDER BY latest.observed_at DESC, latest.id DESC LIMIT 1) WHERE d.client_id = ? ORDER BY d.deployment_key LIMIT ? OFFSET ?",
    ).bind(
      clientId,
      pagination.deployments.pageSize + 1,
      pagination.deployments.offset,
    ).all<{
      id: string
      deployment_key: string
      environment: string
      status: string
      registered_at: string | null
      observed_at: string | null
      health_status: string | null
      occupied_seats: number | null
      application_version: string | null
      agent_version: string | null
      image_digest: string | null
      entitlement_version: string | null
      last_successful_backup_at: string | null
    }>(),
    database.prepare(
      "SELECT id, status, starts_at, ends_at, seat_limit FROM contracts WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    ).bind(
      clientId,
      pagination.contracts.pageSize + 1,
      pagination.contracts.offset,
    ).all<{
      id: string
      status: string
      starts_at: string
      ends_at: string
      seat_limit: number
    }>(),
    database.prepare(
      "SELECT id, plan_key, display_name FROM plans WHERE active = 1 ORDER BY display_name, plan_key",
    ).all<{ id: string; plan_key: string; display_name: string }>(),
  ])

  return {
    id: client.id,
    clientKey: client.client_key,
    displayName: client.display_name,
    status: client.status,
    activePlans: activePlans.results.map((row) => ({
      id: row.id,
      planKey: row.plan_key,
      displayName: row.display_name,
    })),
    organisations: pageResult(
      organisations.results.map((row) => ({
        id: row.id,
        organisationKey: row.organisation_key,
        displayName: row.display_name,
      })),
      pagination.organisations,
    ),
    deployments: pageResult(
      deployments.results.map((row) => ({
        id: row.id,
        deploymentKey: row.deployment_key,
        environment: row.environment,
        status: row.status,
        registeredAt: row.registered_at,
        observedAt: row.observed_at,
        healthStatus: row.health_status,
        occupiedSeats: row.occupied_seats,
        applicationVersion: row.application_version,
        agentVersion: row.agent_version,
        imageDigest: row.image_digest,
        entitlementVersion: row.entitlement_version,
        lastSuccessfulBackupAt: row.last_successful_backup_at,
      })),
      pagination.deployments,
    ),
    contracts: pageResult(
      contracts.results.map((row) => ({
        id: row.id,
        status: row.status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        seatLimit: row.seat_limit,
      })),
      pagination.contracts,
    ),
  }
}
