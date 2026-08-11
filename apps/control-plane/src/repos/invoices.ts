import {
  buildCollectionMilestones,
  type CollectionFrequency,
} from "@crm/control-protocol/billing"

import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, conflict, notFound } from "../http/errors"
import type { MutationActor } from "./clients"
import { strictDateOnly } from "./contracts"

const CURRENCIES = new Set(["AUD", "EUR", "GBP", "MYR", "SGD", "USD"])

export interface InvoiceInput {
  invoiceNumber: unknown
  status: unknown
  issuedAt: unknown
  dueAt: unknown
  currency: unknown
  totalCents: unknown
  collectionFrequency: unknown
  billingPeriods: unknown
  firstDueAt: unknown
  weights: unknown
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

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string") throw badRequest()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw badRequest()
  return value
}

function frequency(value: unknown): CollectionFrequency {
  if (value !== "monthly" && value !== "upfront") throw badRequest()
  return value
}

function parseWeights(value: unknown, expectedCount: number, selectedFrequency: CollectionFrequency) {
  if (selectedFrequency === "upfront") return undefined
  if (typeof value !== "string") throw badRequest()
  const tokens = value.split(",")
  if (tokens.length !== expectedCount) throw badRequest()

  const weights: number[] = []
  let totalWeight = 0
  for (const token of tokens) {
    const normalized = token.trim()
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(normalized)) throw badRequest()
    const weight = Number(normalized)
    if (!Number.isFinite(weight) || weight < 0 || weight > 1_000_000) throw badRequest()
    totalWeight += weight
    if (!Number.isFinite(totalWeight)) throw badRequest()
    weights.push(weight)
  }
  if (totalWeight <= 0) throw badRequest()
  return weights
}

export async function createInvoice(
  database: D1Database,
  contractId: string,
  input: InvoiceInput,
  actor: MutationActor,
): Promise<string> {
  const invoiceNumber = boundedText(input.invoiceNumber, 96)
  const status = boundedText(input.status, 32)
  if (!["draft", "issued", "paid", "void"].includes(status)) throw badRequest()
  const issuedAt = isoTimestamp(input.issuedAt)
  const dueAt = isoTimestamp(input.dueAt)
  if (dueAt < issuedAt) throw badRequest()
  const currency = boundedText(input.currency, 3).toUpperCase()
  if (!CURRENCIES.has(currency)) throw badRequest()
  const totalCents = integer(input.totalCents, 0, Number.MAX_SAFE_INTEGER)
  const selectedFrequency = frequency(input.collectionFrequency)
  const billingPeriods = integer(input.billingPeriods, 1, 1_200)
  const firstDueAt = strictDateOnly(input.firstDueAt)
  const weights = parseWeights(input.weights, billingPeriods, selectedFrequency)

  const contract = await database.prepare("SELECT 1 FROM contracts WHERE id = ?").bind(contractId).first()
  if (!contract) throw notFound()
  const duplicate = await database.prepare(
    "SELECT 1 FROM invoices WHERE invoice_number = ?",
  ).bind(invoiceNumber).first()
  if (duplicate) throw conflict()

  const milestones = buildCollectionMilestones({
    frequency: selectedFrequency,
    billingPeriods,
    firstDueAt,
    total: totalCents / 100,
    weights,
  }).map((milestone) => ({
    ...milestone,
    amountCents: Math.round(milestone.amount * 100),
  }))
  if (
    milestones.length === 0 ||
    milestones.some((milestone) => !Number.isSafeInteger(milestone.amountCents) || milestone.amountCents < 0) ||
    milestones.reduce((sum, milestone) => sum + milestone.amountCents, 0) !== totalCents
  ) {
    throw badRequest()
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "invoice.create",
    targetType: "invoice",
    targetId: id,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { contractId, currency, invoiceNumber, totalCents },
    createdAt: now,
  })
  const milestoneRowsJson = JSON.stringify(
    milestones.map((milestone) => ({
      id: crypto.randomUUID(),
      sequence: milestone.sequence,
      title: milestone.title,
      dueAt: milestone.dueAt,
      amountCents: milestone.amountCents,
    })),
  )
  const milestoneStatement = database.prepare(
    "INSERT INTO invoice_collection_milestones (id, invoice_id, sequence, title, due_at, amount_cents, created_at) SELECT json_extract(value, '$.id'), ?, CAST(json_extract(value, '$.sequence') AS INTEGER), json_extract(value, '$.title'), json_extract(value, '$.dueAt'), CAST(json_extract(value, '$.amountCents') AS INTEGER), ? FROM json_each(?)",
  ).bind(id, now, milestoneRowsJson)

  try {
    await database.batch([
      database.prepare(
        "INSERT INTO invoices (id, contract_id, invoice_number, status, issued_at, due_at, paid_at, currency, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      ).bind(id, contractId, invoiceNumber, status, issuedAt, dueAt, currency, totalCents, now, now),
      milestoneStatement,
      audit.statement,
    ])
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw conflict()
    throw error
  }
  return id
}
