import {
  calculateContractTotal,
  getMonthlyBillingPeriods,
  type CollectionFrequency,
} from "@crm/control-protocol/billing"

import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, notFound } from "../http/errors"
import type { MutationActor } from "./clients"

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
  totalCents: number
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; totalCents: number }>
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
  if (values.length === 0 || values.length > Object.keys(MODULE_CATALOG).length) throw badRequest()
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

export async function createContract(
  database: D1Database,
  clientId: string,
  input: ContractInput,
  actor: MutationActor,
): Promise<string> {
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

  const client = await database.prepare("SELECT 1 FROM clients WHERE id = ?").bind(clientId).first()
  if (!client) throw notFound()
  const plan = await database.prepare("SELECT active FROM plans WHERE id = ?").bind(planId).first<{
    active: number
  }>()
  if (!plan || plan.active !== 1) throw badRequest()

  const periods = getMonthlyBillingPeriods(startsAt, endsAt)
  if (periods.length === 0 || periods.length >= 1_200 && periods.at(-1)?.endsAt !== endsAt) {
    throw badRequest()
  }
  const billingFactor = periods.reduce((sum, period) => sum + period.factor, 0)
  const total = calculateContractTotal(
    monthlySeatPriceCents / 100,
    seatLimit,
    billingFactor,
    taxBasisPoints / 100,
  )
  const totalCents = Math.round(total.total * 100)
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw badRequest()

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

export async function getContractDetail(
  database: D1Database,
  contractId: string,
): Promise<ContractDetail> {
  const contract = await database.prepare(
    "SELECT id, client_id, plan_id, status, starts_at, ends_at, seat_limit, total_cents FROM contracts WHERE id = ?",
  ).bind(contractId).first<{
    id: string
    client_id: string
    plan_id: string
    status: string
    starts_at: string
    ends_at: string
    seat_limit: number
    total_cents: number
  }>()
  if (!contract) throw notFound()
  const invoices = await database.prepare(
    "SELECT id, invoice_number, status, currency, total_cents FROM invoices WHERE contract_id = ? ORDER BY created_at DESC LIMIT 500",
  ).bind(contractId).all<{
    id: string
    invoice_number: string
    status: string
    currency: string
    total_cents: number
  }>()
  return {
    id: contract.id,
    clientId: contract.client_id,
    planId: contract.plan_id,
    status: contract.status,
    startsAt: contract.starts_at,
    endsAt: contract.ends_at,
    seatLimit: contract.seat_limit,
    totalCents: contract.total_cents,
    invoices: invoices.results.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      currency: invoice.currency,
      totalCents: invoice.total_cents,
    })),
  }
}
