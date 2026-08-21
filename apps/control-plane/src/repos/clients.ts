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

export interface CollectionResult<T> extends PageResult<T> {
  hasAny: boolean
}

export interface ClientChildPagination {
  organisations: PageRequest
  deployments: PageRequest
  contracts: PageRequest
}

export interface ClientDetail extends ClientListItem {
  organisations: CollectionResult<{ id: string; organisationKey: string; displayName: string }>
  deployments: CollectionResult<{ id: string; deploymentKey: string; environment: string; status: string; href: string }>
  contracts: CollectionResult<{ id: string; status: string; startsAt: string; endsAt: string; seatLimit: number }>
}

export interface DashboardSummary {
  activeClientCount: number
  deploymentCount: number
  onlineDeploymentCount: number
  attentionCount: number
  attentionItems: {
    href: string
    title: string
    description: string
    clientName: string
    deploymentKey: string | null
    status: "Past due" | "Suspended" | "Disabled" | "Offline" | "Unhealthy" | "Stale" | "Mismatch"
    tone: "warning" | "error"
  }[]
}

type AttentionItem = DashboardSummary["attentionItems"][number]

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

function pageResult<T>(rows: T[], request: PageRequest, hasAny: boolean): CollectionResult<T> {
  return {
    items: rows.slice(0, request.pageSize),
    page: request.page,
    pageSize: request.pageSize,
    hasNext: rows.length > request.pageSize,
    hasAny,
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

export async function getDashboardSummary(database: D1Database): Promise<DashboardSummary> {
  const [clients, deployments, contractRows, deploymentRows] = await Promise.all([
    database.prepare("SELECT COUNT(*) AS count FROM clients WHERE status = 'active'").first<{ count: number }>(),
    database.prepare("SELECT COUNT(*) AS count FROM deployments").first<{ count: number }>(),
    database.prepare(
      "SELECT id, client_id, status FROM contracts WHERE status IN ('past_due', 'suspended') ORDER BY updated_at DESC, id DESC LIMIT 20",
    ).all<{ id: string; client_id: string; status: "past_due" | "suspended" }>(),
    database.prepare(
      `SELECT d.id, d.deployment_key, d.status, c.display_name,
        h.observed_at, h.health_status, h.entitlement_version, h.configuration_version,
        s.latest_version, s.configuration_version AS scheduled_configuration_version
       FROM deployments d
       JOIN clients c ON c.id = d.client_id
       LEFT JOIN heartbeat_rollups h ON h.id = (
         SELECT h2.id FROM heartbeat_rollups h2
         WHERE h2.deployment_id = d.id ORDER BY h2.observed_at DESC, h2.id DESC LIMIT 1
       )
       LEFT JOIN deployment_entitlement_schedules s ON s.deployment_id = d.id
       ORDER BY d.updated_at DESC, d.id DESC`,
    ).all<{
      id: string
      deployment_key: string
      status: string
      display_name: string
      observed_at: string | null
      health_status: string | null
      entitlement_version: string | null
      configuration_version: string | null
      latest_version: number | null
      scheduled_configuration_version: string | null
    }>(),
  ])

  const clientNames = new Map<string, string>()
  const clientRows = await database.prepare("SELECT id, display_name FROM clients").all<{ id: string; display_name: string }>()
  for (const row of clientRows.results) clientNames.set(row.id, row.display_name)

  const now = Date.now()
  const attentionItems: AttentionItem[] = [
    ...contractRows.results.map((contract) => ({
      href: `/operator/contracts/${contract.id}`,
      title: contract.status === "past_due" ? "Contract is past due" : "Contract is suspended",
      description: "Review commercial terms and entitlement controls.",
      clientName: clientNames.get(contract.client_id) ?? "Unknown client",
      deploymentKey: null,
      status: contract.status === "past_due" ? "Past due" as const : "Suspended" as const,
      tone: contract.status === "past_due" ? "warning" as const : "error" as const,
    })),
    ...deploymentRows.results.flatMap<AttentionItem>((deployment): AttentionItem[] => {
      const href = `/operator/deployments/${deployment.id}`
      if (deployment.status === "disabled") return [{ href, title: "Deployment is disabled", description: "Enable it only after checking the customer environment.", clientName: deployment.display_name, deploymentKey: deployment.deployment_key, status: "Disabled" as const, tone: "error" as const }]
      if (deployment.observed_at === null) return [{ href, title: "No heartbeat received", description: "The deployment has not connected to the control plane.", clientName: deployment.display_name, deploymentKey: deployment.deployment_key, status: "Offline" as const, tone: "error" as const }]
      const age = now - Date.parse(deployment.observed_at)
      if (!Number.isFinite(age) || age > 30 * 60 * 1_000) return [{ href, title: "Heartbeat is stale", description: "The last heartbeat is older than 30 minutes.", clientName: deployment.display_name, deploymentKey: deployment.deployment_key, status: "Stale" as const, tone: "warning" as const }]
      if (deployment.health_status !== "healthy") return [{ href, title: "Deployment health needs attention", description: `The latest heartbeat reports ${deployment.health_status ?? "unknown"} health.`, clientName: deployment.display_name, deploymentKey: deployment.deployment_key, status: "Unhealthy" as const, tone: "error" as const }]
      if (deployment.latest_version !== null && deployment.entitlement_version !== String(deployment.latest_version) || deployment.scheduled_configuration_version !== null && deployment.configuration_version !== deployment.scheduled_configuration_version) {
        return [{ href, title: "Deployment is out of sync", description: "The heartbeat has not acknowledged the current entitlement or configuration.", clientName: deployment.display_name, deploymentKey: deployment.deployment_key, status: "Mismatch" as const, tone: "warning" as const }]
      }
      return []
    }),
  ]

  return {
    activeClientCount: clients?.count ?? 0,
    deploymentCount: deployments?.count ?? 0,
    onlineDeploymentCount: deploymentRows.results.filter((row) => row.observed_at !== null && Date.now() - Date.parse(row.observed_at) <= 30 * 60 * 1_000 && row.health_status === "healthy").length,
    attentionCount: attentionItems.length,
    attentionItems: attentionItems.slice(0, 20),
  }
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

  const [organisations, deployments, contracts, hasOrganisation, hasDeployment, hasContract] = await Promise.all([
    database.prepare(
      "SELECT id, organisation_key, display_name FROM client_organisations WHERE client_id = ? ORDER BY organisation_key LIMIT ? OFFSET ?",
    ).bind(
      clientId,
      pagination.organisations.pageSize + 1,
      pagination.organisations.offset,
    ).all<{ id: string; organisation_key: string; display_name: string }>(),
    database.prepare(
      "SELECT id, deployment_key, environment, status FROM deployments WHERE client_id = ? ORDER BY deployment_key LIMIT ? OFFSET ?",
    ).bind(
      clientId,
      pagination.deployments.pageSize + 1,
      pagination.deployments.offset,
    ).all<{ id: string; deployment_key: string; environment: string; status: string }>(),
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
    database.prepare("SELECT 1 FROM client_organisations WHERE client_id = ? LIMIT 1").bind(clientId).first(),
    database.prepare("SELECT 1 FROM deployments WHERE client_id = ? LIMIT 1").bind(clientId).first(),
    database.prepare("SELECT 1 FROM contracts WHERE client_id = ? LIMIT 1").bind(clientId).first(),
  ])

  return {
    id: client.id,
    clientKey: client.client_key,
    displayName: client.display_name,
    status: client.status,
    organisations: pageResult(
      organisations.results.map((row) => ({
        id: row.id,
        organisationKey: row.organisation_key,
        displayName: row.display_name,
      })),
      pagination.organisations,
      hasOrganisation !== null,
    ),
    deployments: pageResult(
      deployments.results.map((row) => ({
        id: row.id,
        deploymentKey: row.deployment_key,
        environment: row.environment,
        status: row.status,
        href: `/operator/deployments/${row.id}`,
      })),
      pagination.deployments,
      hasDeployment !== null,
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
      hasContract !== null,
    ),
  }
}
