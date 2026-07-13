import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { member, user, accounts, pipelineStages } from "@/db/schema"
import { money, date, enumLabel, fk } from "./formatters"
import type { FieldRegistry, RegistryKey } from "./types"

async function memberName(tx: Tx, id: string) {
  const [r] = await tx.select({ n: user.name }).from(member)
    .leftJoin(user, eq(member.userId, user.id)).where(eq(member.id, id)).limit(1)
  return r?.n ?? null
}
async function accountName(tx: Tx, id: string) {
  const [r] = await tx.select({ n: accounts.name }).from(accounts).where(eq(accounts.id, id)).limit(1)
  return r?.n ?? null
}
async function stageLabel(tx: Tx, id: string) {
  const [r] = await tx.select({ n: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1)
  return r?.n ?? null
}

const STATUS = { open: "Open", won: "Won", lost: "Lost", on_hold: "On hold" }

export const CHANGE_FIELDS: Record<RegistryKey, FieldRegistry> = {
  funnel: {
    name: { label: "Name" },
    amount: { label: "Amount", format: money() },
    estimatedAmount: { label: "Estimated amount", format: money() },
    currentStageId: { label: "Stage", format: fk(stageLabel) },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    accountId: { label: "Account", format: fk(accountName) },
    status: { label: "Status", format: enumLabel(STATUS) },
    expectedCloseDate: { label: "Expected close", format: date() },
    projectNatureCode: { label: "Project nature" },
    lostReason: { label: "Lost reason" },
    kivReviewDate: { label: "KIV review", format: date() },
    isRenewal: { label: "Renewal" },
  },
  account: {
    name: { label: "Name" },
    code: { label: "Code" },
    accountType: { label: "Type" },
    industry: { label: "Industry" },
    isCustomer: { label: "Customer" },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    parentAccountId: { label: "Parent account", format: fk(accountName) },
  },
  person: {
    firstName: { label: "First name" },
    lastName: { label: "Last name" },
    title: { label: "Title" },
    email: { label: "Email" },
    phone: { label: "Phone" },
    isPrimary: { label: "Primary contact" },
    accountId: { label: "Account", format: fk(accountName) },
  },
  lead: {
    name: { label: "Name" },
    companyName: { label: "Company" },
    email: { label: "Email" },
    phone: { label: "Phone" },
    source: { label: "Source" },
    status: { label: "Status", format: enumLabel({ new: "New", contacted: "Contacted", qualified: "Qualified", disqualified: "Disqualified", converted: "Converted" }) },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    disqualifyReason: { label: "Disqualify reason" },
  },
  opportunity: {
    name: { label: "Name" },
    accountId: { label: "Account", format: fk(accountName) },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    totalEstimatedFunnelAmount: { label: "Est. funnel amount", format: money() },
    description: { label: "Description" },
  },
  // Other entities added in later tasks.
  project: {}, finance_doc: {},
}
