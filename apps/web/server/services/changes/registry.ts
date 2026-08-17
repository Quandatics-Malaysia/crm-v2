import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { member, user, accounts, persons, pipelineStages } from "@/db/schema"
import { money, date, enumLabel, fk, bool } from "./formatters"
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
async function personName(tx: Tx, id: string) {
  const [r] = await tx.select({ firstName: persons.firstName, lastName: persons.lastName })
    .from(persons).where(eq(persons.id, id)).limit(1)
  return r ? `${r.firstName} ${r.lastName ?? ""}`.trim() : null
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
    lostReason: { label: "Lost reason" },
    kivReviewDate: { label: "KIV review", format: date() },
    isRenewal: { label: "Renewal", format: bool() },
    pain: { label: "Pain" },
    power: { label: "Power" },
    vision: { label: "Vision" },
    value: { label: "Value" },
    control: { label: "Control" },
  },
  account: {
    name: { label: "Name" },
    code: { label: "Code" },
    accountType: { label: "Type" },
    industry: { label: "Industry" },
    isCustomer: { label: "Customer", format: bool() },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    parentAccountId: { label: "Parent account", format: fk(accountName) },
    website: { label: "Website" },
    phone: { label: "Phone" },
    registrationNumber: { label: "Registration no." },
    billingAddress: { label: "Billing address" },
  },
  person: {
    firstName: { label: "First name" },
    lastName: { label: "Last name" },
    title: { label: "Title" },
    email: { label: "Email" },
    phone: { label: "Phone" },
    isPrimary: { label: "Primary contact", format: bool() },
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
    ownerBudgetLimit: { label: "Owner budget", format: money() },
    powerSponsorBudgetLimit: { label: "Sponsor budget", format: money() },
    estimatedBudget: { label: "Estimated budget", format: money() },
    estimatedCloseDate: { label: "Est. close date", format: date() },
    isRenewal: { label: "Renewal", format: bool() },
    competitor: { label: "Competitor" },
    projectNatureCode: { label: "Project nature" },
    pain: { label: "Pain" },
    power: { label: "Power" },
    vision: { label: "Vision" },
    value: { label: "Value" },
    control: { label: "Control" },
    ownerContactId: { label: "Owner contact", format: fk(personName) },
    powerSponsorContactId: { label: "Power sponsor", format: fk(personName) },
    assignedPresales: { label: "Assigned pre-sales", format: fk(memberName) },
  },
  project: {
    name: { label: "Name" },
    status: { label: "Status", format: enumLabel({ planning: "Planning", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" }) },
    value: { label: "Value", format: money() },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    startDate: { label: "Start date", format: date() },
    projectNatureCode: { label: "Project nature" },
    accountId: { label: "Account", format: fk(accountName) },
    notes: { label: "Notes" },
  },
  // Other entities added in later tasks.
  finance_doc: {},
}
