import { HTTPException } from "hono/http-exception"

export type LifecycleStatus = "active" | "archived"

export interface DashboardSummary {
  clients: number
  organisations: number
  deployments: number
  activeContracts: number
  unhealthyDeployments: number
}

export interface PlanRecord {
  id: string
  planKey: string
  displayName: string
  active: boolean
  contractCount: number
}

export interface DeploymentRecord {
  id: string
  clientId: string
  clientName: string
  deploymentKey: string
  environment: string
  status: string
  imageDigest: string | null
  contractId: string | null
  contractStatus: string | null
  lastHeartbeat: string | null
  healthStatus: string | null
  occupiedSeats: number | null
}

export interface AuditRecord {
  id: string
  operatorEmail: string | null
  action: string
  targetType: string
  targetId: string
  createdAt: string
}

type Input = Record<string, unknown>

const required = (value: unknown, label: string) => {
  const result = typeof value === "string" ? value.trim() : ""
  if (!result) throw new HTTPException(400, { message: `${label} is required` })
  return result
}

const now = () => new Date().toISOString()

export async function dashboardSummary(db: D1Database): Promise<DashboardSummary> {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM clients WHERE status = 'active') clients,
    (SELECT COUNT(*) FROM client_organisations WHERE status = 'active') organisations,
    (SELECT COUNT(*) FROM deployments WHERE status = 'active') deployments,
    (SELECT COUNT(*) FROM contracts WHERE status = 'active' AND archived_at IS NULL) active_contracts,
    (SELECT COUNT(*) FROM deployments d WHERE d.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM heartbeat_rollups h WHERE h.deployment_id = d.id
      AND h.observed_at >= datetime('now', '-15 minutes') AND h.health_status = 'healthy'
    )) unhealthy_deployments`).first<Record<string, number>>()
  return {
    clients: row?.clients ?? 0,
    organisations: row?.organisations ?? 0,
    deployments: row?.deployments ?? 0,
    activeContracts: row?.active_contracts ?? 0,
    unhealthyDeployments: row?.unhealthy_deployments ?? 0,
  }
}

export async function listPlans(db: D1Database): Promise<PlanRecord[]> {
  const result = await db.prepare(`SELECT p.id, p.plan_key, p.display_name, p.active,
    COUNT(c.id) contract_count FROM plans p LEFT JOIN contracts c ON c.plan_id = p.id
    GROUP BY p.id ORDER BY p.active DESC, p.display_name`).all<Record<string, string | number>>()
  return result.results.map((row) => ({ id: String(row.id), planKey: String(row.plan_key), displayName: String(row.display_name), active: row.active === 1, contractCount: Number(row.contract_count) }))
}

export async function savePlan(db: D1Database, form: Input, id?: string): Promise<string> {
  const planKey = required(form.planKey, "Plan key")
  const displayName = required(form.displayName, "Display name")
  const recordId = id ?? crypto.randomUUID()
  if (id) await db.prepare("UPDATE plans SET plan_key = ?, display_name = ?, updated_at = ? WHERE id = ?").bind(planKey, displayName, now(), id).run()
  else await db.prepare("INSERT INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind(recordId, planKey, displayName, now(), now()).run()
  return recordId
}

export async function setPlanActive(db: D1Database, id: string, active: boolean): Promise<void> {
  if (!active) {
    const used = await db.prepare("SELECT 1 FROM contracts WHERE plan_id = ? AND status IN ('active','past_due','suspended') AND archived_at IS NULL LIMIT 1").bind(id).first()
    if (used) throw new HTTPException(409, { message: "Plan is used by a current contract and cannot be deactivated" })
  }
  await db.prepare("UPDATE plans SET active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, now(), id).run()
}

export async function listDeployments(db: D1Database): Promise<DeploymentRecord[]> {
  const result = await db.prepare(`SELECT d.id, d.client_id, c.display_name client_name, d.deployment_key,
    d.environment, d.status, d.image_digest, s.contract_id, ct.status contract_status,
    h.observed_at last_heartbeat, h.health_status, h.occupied_seats
    FROM deployments d JOIN clients c ON c.id = d.client_id
    LEFT JOIN deployment_entitlement_schedules s ON s.deployment_id = d.id
    LEFT JOIN contracts ct ON ct.id = s.contract_id
    LEFT JOIN heartbeat_rollups h ON h.id = (SELECT id FROM heartbeat_rollups WHERE deployment_id = d.id ORDER BY observed_at DESC LIMIT 1)
    ORDER BY c.display_name, d.environment`).all<Record<string, string | number | null>>()
  return result.results.map((r) => ({ id: String(r.id), clientId: String(r.client_id), clientName: String(r.client_name), deploymentKey: String(r.deployment_key), environment: String(r.environment), status: String(r.status), imageDigest: r.image_digest ? String(r.image_digest) : null, contractId: r.contract_id ? String(r.contract_id) : null, contractStatus: r.contract_status ? String(r.contract_status) : null, lastHeartbeat: r.last_heartbeat ? String(r.last_heartbeat) : null, healthStatus: r.health_status ? String(r.health_status) : null, occupiedSeats: r.occupied_seats == null ? null : Number(r.occupied_seats) }))
}

export async function updateDeployment(db: D1Database, id: string, form: Input): Promise<void> {
  const environment = required(form.environment, "Environment")
  const status = required(form.status, "Status")
  if (!['active', 'disabled'].includes(status)) throw new HTTPException(400, { message: "Invalid deployment status" })
  const digest = typeof form.imageDigest === "string" ? form.imageDigest.trim() || null : null
  await db.prepare("UPDATE deployments SET environment = ?, status = ?, image_digest = ?, archived_at = ?, updated_at = ? WHERE id = ?").bind(environment, status, digest, status === 'disabled' ? now() : null, now(), id).run()
}

export async function listAudit(db: D1Database): Promise<AuditRecord[]> {
  const result = await db.prepare(`SELECT a.id, u.email operator_email, a.action, a.target_type, a.target_id, a.created_at
    FROM operator_audit_log a LEFT JOIN operator_users u ON u.id = a.operator_id
    ORDER BY a.created_at DESC LIMIT 100`).all<Record<string, string | null>>()
  return result.results.map((r) => ({ id: String(r.id), operatorEmail: r.operator_email, action: String(r.action), targetType: String(r.target_type), targetId: String(r.target_id), createdAt: String(r.created_at) }))
}
