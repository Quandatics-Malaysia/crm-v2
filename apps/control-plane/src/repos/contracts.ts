import {
  calculateContractTotal,
  getMonthlyBillingPeriods,
  type CollectionFrequency,
} from "@crm/control-protocol/billing"

import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, notFound } from "../http/errors"
import type { MutationActor, PageRequest, PageResult } from "./clients"

export const MODULE_CATALOG = {
  projects: { displayName: "Projects", dependencies: [] },
  salesOrders: { displayName: "Sales Orders", dependencies: ["projects"] },
  finance: { displayName: "Billing & Purchasing", dependencies: ["projects", "salesOrders"] },
  forecast: { displayName: "Forecast", dependencies: [] },
  audit: { displayName: "Audit log", dependencies: [] },
  advancedRoles: { displayName: "Advanced roles", dependencies: [] },
  documentation: { displayName: "Documentation", dependencies: [] },
} as const

export type ModuleId = keyof typeof MODULE_CATALOG

export interface ContractInput {
  planId: unknown
  status: unknown
  startsAt: unknown
  endsAt: unknown
  seatLimit: unknown
  monthlySeatPriceCents: unknown
  taxBasisPoints: unknown
  collectionFrequency: unknown
  moduleIds: unknown
}

export interface ContractDetail {
  id: string
  clientId: string
  planId: string
  status: string
  startsAt: string
  endsAt: string
  seatLimit: number
  monthlySeatPriceCents: number
  taxBasisPoints: number
  collectionFrequency: CollectionFrequency
  totalCents: number
  renewalPolicy: string
  suspensionAt: string | null
  entitlementRevision: number
  modules: string[]
  audit: Array<{ action: string; outcome: string; createdAt: string }>
  invoices: PageResult<{ id: string; invoiceNumber: string; status: string; currency: string; totalCents: number }>
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw badRequest()
  const text = value.trim()
  if (text.length === 0 || text.length > maximum) throw badRequest()
  return text
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw badRequest()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw badRequest()
  return parsed
}

export function strictDateOnly(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest()
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest()
  }
  return value
}

function collectionFrequency(value: unknown): CollectionFrequency {
  if (value !== "monthly" && value !== "upfront") throw badRequest()
  return value
}

function selectedModules(value: unknown): ModuleId[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  if (values.length > Object.keys(MODULE_CATALOG).length) throw badRequest()
  const selected = new Set<ModuleId>()
  for (const item of values) {
    if (typeof item !== "string" || !(item in MODULE_CATALOG)) throw badRequest()
    selected.add(item as ModuleId)
  }
  if (selected.size !== values.length) throw badRequest()

  for (const moduleId of selected) {
    const pending = [...MODULE_CATALOG[moduleId].dependencies] as ModuleId[]
    while (pending.length > 0) {
      const dependency = pending.pop()!
      if (!selected.has(dependency)) throw badRequest()
      pending.push(...MODULE_CATALOG[dependency].dependencies)
    }
  }
  return [...selected]
}

function validatedContract(input: ContractInput) {
  const planId = boundedText(input.planId, 128)
  const status = boundedText(input.status, 32)
  if (!["active", "past_due", "suspended", "cancelled"].includes(status)) throw badRequest()
  const startsAt = strictDateOnly(input.startsAt)
  const endsAt = strictDateOnly(input.endsAt)
  if (endsAt < startsAt) throw badRequest()
  const seatLimit = integer(input.seatLimit, 1, 100_000)
  const monthlySeatPriceCents = integer(input.monthlySeatPriceCents, 0, 1_000_000_000_000)
  const taxBasisPoints = integer(input.taxBasisPoints, 0, 10_000)
  const frequency = collectionFrequency(input.collectionFrequency)
  const moduleIds = selectedModules(input.moduleIds)
  const periods = getMonthlyBillingPeriods(startsAt, endsAt)
  if (periods.length === 0 || periods.length >= 1_200 && periods.at(-1)?.endsAt !== endsAt) throw badRequest()
  const billingFactor = periods.reduce((sum, period) => sum + period.factor, 0)
  const total = calculateContractTotal(monthlySeatPriceCents / 100, seatLimit, billingFactor, taxBasisPoints / 100)
  const totalCents = Math.round(total.total * 100)
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw badRequest()
  return { planId, status, startsAt, endsAt, seatLimit, monthlySeatPriceCents, taxBasisPoints, frequency, moduleIds, totalCents }
}

export async function createContract(
  database: D1Database,
  clientId: string,
  input: ContractInput,
  actor: MutationActor,
): Promise<string> {
  const { planId, status, startsAt, endsAt, seatLimit, monthlySeatPriceCents, taxBasisPoints, frequency, moduleIds, totalCents } = validatedContract(input)

  const client = await database.prepare("SELECT 1 FROM clients WHERE id = ?").bind(clientId).first()
  if (!client) throw notFound()
  const plan = await database.prepare("SELECT active FROM plans WHERE id = ?").bind(planId).first<{
    active: number
  }>()
  if (!plan || plan.active !== 1) throw badRequest()

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "contract.create",
    targetType: "contract",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { clientId, moduleIds, planId, seatLimit },
    createdAt: now,
  })
  const catalogStatements = moduleIds.map((moduleId) =>
    database.prepare(
      "INSERT OR IGNORE INTO module_catalog (module_id, display_name, dependency_ids_json, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(
      moduleId,
      MODULE_CATALOG[moduleId].displayName,
      JSON.stringify(MODULE_CATALOG[moduleId].dependencies),
      now,
      now,
    ),
  )
  const moduleStatements = moduleIds.map((moduleId) =>
    database.prepare(
      "INSERT INTO contract_modules (contract_id, module_id, created_at) VALUES (?, ?, ?)",
    ).bind(id, moduleId, now),
  )

  await database.batch([
    ...catalogStatements,
    database.prepare(
      "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      clientId,
      planId,
      status,
      startsAt,
      endsAt,
      seatLimit,
      monthlySeatPriceCents,
      taxBasisPoints,
      frequency,
      totalCents,
      now,
      now,
    ),
    ...moduleStatements,
    audit.statement,
  ])
  return id
}

export async function updateContract(
  database: D1Database,
  contractId: string,
  input: ContractInput,
  actor: MutationActor,
): Promise<string> {
  const values = validatedContract(input)
  const existing = await database.prepare(
    "SELECT client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency FROM contracts WHERE id = ?",
  ).bind(contractId).first<Record<string, unknown>>()
  if (!existing) throw notFound()
  const plan = await database.prepare("SELECT active FROM plans WHERE id = ?").bind(values.planId).first<{ active: number }>()
  if (!plan || plan.active !== 1) throw badRequest()
  const previousModules = await database.prepare(
    "SELECT module_id FROM contract_modules WHERE contract_id = ? ORDER BY module_id",
  ).bind(contractId).all<{ module_id: string }>()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "contract.update",
    targetType: "contract",
    targetId: contractId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { before: { ...existing, moduleIds: previousModules.results.map((row) => row.module_id) }, after: values },
    createdAt: now,
  })
  const catalogStatements = values.moduleIds.map((moduleId) => database.prepare(
    "INSERT OR IGNORE INTO module_catalog (module_id, display_name, dependency_ids_json, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  ).bind(moduleId, MODULE_CATALOG[moduleId].displayName, JSON.stringify(MODULE_CATALOG[moduleId].dependencies), now, now))
  const moduleStatements = values.moduleIds.map((moduleId) => database.prepare(
    "INSERT INTO contract_modules (contract_id, module_id, created_at) VALUES (?, ?, ?)",
  ).bind(contractId, moduleId, now))
  await database.batch([
    ...catalogStatements,
    database.prepare(
      "UPDATE contracts SET plan_id = ?, status = ?, starts_at = ?, ends_at = ?, seat_limit = ?, monthly_seat_price_cents = ?, tax_basis_points = ?, collection_frequency = ?, total_cents = ?, entitlement_revision = entitlement_revision + 1, updated_at = ? WHERE id = ?",
    ).bind(values.planId, values.status, values.startsAt, values.endsAt, values.seatLimit, values.monthlySeatPriceCents, values.taxBasisPoints, values.frequency, values.totalCents, now, contractId),
    database.prepare("DELETE FROM contract_modules WHERE contract_id = ?").bind(contractId),
    ...moduleStatements,
    audit.statement,
  ])
  return contractId
}

export async function getContractDetail(
  database: D1Database,
  contractId: string,
  invoicePagination: PageRequest,
): Promise<ContractDetail> {
  const contract = await database.prepare(
    "SELECT id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, suspension_at, entitlement_revision FROM contracts WHERE id = ?",
  ).bind(contractId).first<{
    id: string
    client_id: string
    plan_id: string
    status: string
    starts_at: string
    ends_at: string
    seat_limit: number
    monthly_seat_price_cents: number
    tax_basis_points: number
    collection_frequency: CollectionFrequency
    total_cents: number
    renewal_policy: string
    suspension_at: string | null
    entitlement_revision: number
  }>()
  if (!contract) throw notFound()
  const [invoices, modules, audit] = await Promise.all([database.prepare(
    "SELECT id, invoice_number, status, currency, total_cents FROM invoices WHERE contract_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
  ).bind(
    contractId,
    invoicePagination.pageSize + 1,
    invoicePagination.offset,
  ).all<{
    id: string
    invoice_number: string
    status: string
    currency: string
    total_cents: number
  }>(), database.prepare(
    "SELECT module_id FROM contract_modules WHERE contract_id = ? ORDER BY module_id",
  ).bind(contractId).all<{ module_id: string }>(), database.prepare(
    "SELECT action, outcome, created_at FROM operator_audit_log WHERE target_id = ? ORDER BY created_at DESC LIMIT 20",
  ).bind(contractId).all<{ action: string; outcome: string; created_at: string }>()])
  return {
    id: contract.id,
    clientId: contract.client_id,
    planId: contract.plan_id,
    status: contract.status,
    startsAt: contract.starts_at,
    endsAt: contract.ends_at,
    seatLimit: contract.seat_limit,
    monthlySeatPriceCents: contract.monthly_seat_price_cents,
    taxBasisPoints: contract.tax_basis_points,
    collectionFrequency: contract.collection_frequency,
    totalCents: contract.total_cents,
    renewalPolicy: contract.renewal_policy,
    suspensionAt: contract.suspension_at,
    entitlementRevision: contract.entitlement_revision,
    modules: modules.results.map((row) => row.module_id),
    audit: audit.results.map((row) => ({ action: row.action, outcome: row.outcome, createdAt: row.created_at })),
    invoices: {
      items: invoices.results.slice(0, invoicePagination.pageSize).map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: invoice.status,
        currency: invoice.currency,
        totalCents: invoice.total_cents,
      })),
      page: invoicePagination.page,
      pageSize: invoicePagination.pageSize,
      hasNext: invoices.results.length > invoicePagination.pageSize,
    },
  }
}
