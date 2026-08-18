import { prepareOperatorAuditStatement } from "../audit"
import { isOperatorRole, OPERATOR_ROLES, type OperatorRole } from "../auth/rbac"
import { badRequest, forbidden, notFound } from "../http/errors"
import type { MutationActor } from "./clients"

export interface OperatorUser {
  id: string
  email: string
  status: "active" | "disabled"
  accessSubject: string | null
  roles: OperatorRole[]
  createdAt: string
}

interface OperatorRow {
  id: string
  email: string
  status: string
  access_subject: string | null
  role: string | null
  created_at: string
}

function normalizeOperatorEmail(value: unknown): string {
  if (typeof value !== "string") throw badRequest()
  const email = value.trim().toLowerCase()
  if (
    email.length === 0 || email.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  ) {
    throw badRequest()
  }
  return email
}

function selectedRoles(value: unknown): OperatorRole[] {
  const values = Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value]
  if (values.length === 0 || values.length > OPERATOR_ROLES.length) throw badRequest()
  const selected = new Set<OperatorRole>()
  for (const item of values) {
    if (typeof item !== "string" || !isOperatorRole(item)) throw badRequest()
    selected.add(item as OperatorRole)
  }
  if (selected.size !== values.length) throw badRequest()
  return [...selected]
}

function roleRows(rows: OperatorRow[]): OperatorRow[] {
  const primary = rows[0]
  return primary === undefined ? [] : rows.filter((row) => row.id === primary.id)
}

export async function listOperators(database: D1Database): Promise<OperatorUser[]> {
  const rows = await database.prepare(
    "SELECT u.id, u.email, u.status, u.access_subject, u.created_at, r.role FROM operator_users u LEFT JOIN operator_roles r ON r.operator_id = u.id ORDER BY u.created_at ASC, u.id ASC, r.role",
  ).all<OperatorRow>()
  const byOperator = new Map<string, OperatorUser>()
  for (const row of rows.results) {
    let operator = byOperator.get(row.id)
    if (!operator) {
      operator = {
        id: row.id,
        email: row.email,
        status: row.status === "active" ? "active" : "disabled",
        accessSubject: row.access_subject,
        roles: [],
        createdAt: row.created_at,
      }
      byOperator.set(row.id, operator)
    }
    if (row.role && isOperatorRole(row.role)) operator.roles.push(row.role as OperatorRole)
  }
  return [...byOperator.values()]
}

export async function getOperator(
  database: D1Database,
  operatorId: string,
): Promise<OperatorUser> {
  const rows = await database.prepare(
    "SELECT u.id, u.email, u.status, u.access_subject, u.created_at, r.role FROM operator_users u LEFT JOIN operator_roles r ON r.operator_id = u.id WHERE u.id = ? ORDER BY r.role",
  ).bind(operatorId).all<OperatorRow>()
  const primary = roleRows(rows.results)[0]
  if (!primary) throw notFound()
  const roles: OperatorRole[] = []
  for (const row of roleRows(rows.results)) {
    if (row.role && isOperatorRole(row.role)) roles.push(row.role as OperatorRole)
  }
  return {
    id: primary.id,
    email: primary.email,
    status: primary.status === "active" ? "active" : "disabled",
    accessSubject: primary.access_subject,
    roles,
    createdAt: primary.created_at,
  }
}

async function activeVendorOwnerCount(database: D1Database): Promise<number> {
  const row = await database.prepare(
    "SELECT COUNT(*) AS count FROM operator_roles r JOIN operator_users u ON u.id = r.operator_id WHERE r.role = 'vendor_owner' AND u.status = 'active'",
  ).first<{ count: number }>()
  return row?.count ?? 0
}

export async function createOperator(
  database: D1Database,
  input: { email: unknown; roles: unknown },
  actor: MutationActor,
): Promise<string> {
  const email = normalizeOperatorEmail(input.email)
  const roles = selectedRoles(input.roles)
  const existing = await database.prepare(
    "SELECT id FROM operator_users WHERE lower(trim(email)) = ?",
  ).bind(email).first<{ id: string }>()
  if (existing) throw badRequest("operator_email_exists")

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "operator.create",
    targetType: "operator_user",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { email, roles },
    createdAt: now,
  })
  await database.batch([
    database.prepare(
      "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', NULL, ?, ?)",
    ).bind(id, email, now, now),
    ...roles.map((role) =>
      database.prepare(
        "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, ?, ?)",
      ).bind(id, role, now),
    ),
    audit.statement,
  ])
  return id
}

export async function setOperatorStatus(
  database: D1Database,
  operatorId: string,
  status: unknown,
  actor: MutationActor,
): Promise<void> {
  if (actor.operatorId === operatorId) throw forbidden("operator_self_modification")
  if (status !== "active" && status !== "disabled") throw badRequest()
  const current = await getOperator(database, operatorId)

  if (status === "disabled" && current.roles.includes("vendor_owner")) {
    const remaining = await activeVendorOwnerCount(database)
    if (remaining <= 1) throw badRequest("vendor_owner_required")
  }

  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "operator.status.update",
    targetType: "operator_user",
    targetId: operatorId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { after: { status }, before: { status: current.status } },
    createdAt: now,
  })
  await database.batch([
    database.prepare(
      "UPDATE operator_users SET status = ?, updated_at = ? WHERE id = ?",
    ).bind(status, now, operatorId),
    audit.statement,
  ])
}

export async function setOperatorRoles(
  database: D1Database,
  operatorId: string,
  roles: unknown,
  actor: MutationActor,
): Promise<void> {
  if (actor.operatorId === operatorId) throw forbidden("operator_self_modification")
  const nextRoles = selectedRoles(roles)
  const current = await getOperator(database, operatorId)

  const removingLastOwner = current.roles.includes("vendor_owner") && !nextRoles.includes("vendor_owner")
  if (removingLastOwner) {
    const remaining = await activeVendorOwnerCount(database)
    if (remaining <= 1) throw badRequest("vendor_owner_required")
  }

  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "operator.roles.update",
    targetType: "operator_user",
    targetId: operatorId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { after: { roles: nextRoles }, before: { roles: current.roles } },
    createdAt: now,
  })
  await database.batch([
    database.prepare("DELETE FROM operator_roles WHERE operator_id = ?").bind(operatorId),
    ...nextRoles.map((role) =>
      database.prepare(
        "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, ?, ?)",
      ).bind(operatorId, role, now),
    ),
    audit.statement,
  ])
}
