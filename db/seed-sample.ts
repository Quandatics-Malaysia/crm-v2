import "dotenv/config"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { auth } from "@/lib/auth"
import { computeQuotation } from "@/server/services/quotation-math"
import { isModuleEnabled } from "@/lib/modules"

/**
 * Idempotent sample-data seed for role-play / demos.
 *
 * Layers realistic CRM data on top of the base `db/seed.ts` (which must have run
 * first — it creates the demo tenant, roles, the default "Sales Pipeline"
 * funnel + canonical stages, the SST tax setting, and the single superadmin
 * `admin@demo.local`). This script:
 *   - adds four normal members (manager / sales1 / sales2 / viewer), all
 *     email+password sign-in, all `isSuperadmin = false` (the one-superadmin
 *     DB invariant is preserved),
 *   - owns accounts/contacts/pipelines/quotations across sales1 & sales2 so
 *     record-scoped access is actually exercised, and
 *   - files ONE pending stage-approval request (sales1, low tier, advancing a
 *     gated stage) routed to the manager, with the opportunity LEFT at its
 *     current stage — mirroring `server/services/stage.ts`.
 *
 * Re-runnable: every row uses a stable/deterministic id (or a natural unique
 * key) with `onConflictDoNothing()`, so a second run is a no-op.
 */

const {
  organization,
  tenantSettings,
  roles,
  user,
  account,
  member,
  membershipProfiles,
  memberRoles,
  pipelines,
  pipelineStages,
  taxSettings,
  accounts,
  persons,
  opportunities,
  funnels,
  quotations,
  quotationLineItems,
  stageApprovalRequests,
  projects,
  paymentMilestones,
  salesOrders,
  leads,
  products,
  contractYears,
} = schema

const TENANT_ID = "demo-entity"

// All sample logins share one password. The Docker migrate job runs with
// NODE_ENV=production, where a weak/default password is REFUSED — set
// SEED_SAMPLE_PASSWORD, or let it fall back to DEMO_ADMIN_PASSWORD (already
// required to be strong). In local dev it stays the convenient well-known value.
const IS_PROD = process.env.NODE_ENV === "production"
const PASSWORD =
  process.env.SEED_SAMPLE_PASSWORD ||
  (IS_PROD ? process.env.DEMO_ADMIN_PASSWORD ?? "" : "Password123!")
if (!PASSWORD || (IS_PROD && PASSWORD === "Password123!")) {
  throw new Error(
    "sample seed: refusing a weak/empty login password in production — set " +
      "SEED_SAMPLE_PASSWORD (or ensure DEMO_ADMIN_PASSWORD is set to a strong value).",
  )
}

/** Deterministic UUID (v5-shaped) from a stable key → idempotent uuid columns. */
const NS = "crm-v2::seed-sample::"
function det(key: string): string {
  const h = createHash("sha1").update(NS + key).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const x = b.toString("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

async function main() {
  const url =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/crm"
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql, { schema })

  // ── 0. preconditions: tenant + base seed must exist ───────────────────────
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, TENANT_ID))
    .limit(1)
  if (!org) throw new Error(`Tenant ${TENANT_ID} not found — run \`npm run db:seed\` first.`)

  // Ensure password login is on (it is by default) so these users can sign in.
  await db
    .update(tenantSettings)
    .set({ allowPasswordLogin: true })
    .where(eq(tenantSettings.organizationId, TENANT_ID))

  const roleRows = await db.select().from(roles).where(eq(roles.tenantId, TENANT_ID))
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]))

  // Default funnel + stage code→id map.
  const [funnel] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, TENANT_ID), eq(pipelines.isDefault, true)))
    .limit(1)
  if (!funnel) throw new Error("Default funnel not found — run `npm run db:seed` first.")
  const stageRows = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, funnel.id))
  const stage = new Map<string, string>(stageRows.map((s) => [s.code, s.id]))

  // Default tax setting (SST 6%).
  const [tax] = await db
    .select()
    .from(taxSettings)
    .where(and(eq(taxSettings.tenantId, TENANT_ID), eq(taxSettings.isDefault, true)))
    .limit(1)
  if (!tax) throw new Error("Default tax setting not found — run `npm run db:seed` first.")
  const taxRate = tax.ratePercent // numeric string, e.g. "6.000"

  // ── 1. users → credential account → member → membership profile ───────────
  const ctx = await auth.$context
  const hashed = await ctx.password.hash(PASSWORD)

  type Seeded = {
    key: string
    email: string
    name: string
    roleName: string
    tier: number
    upline?: string // key of the upline member
  }
  const people: Seeded[] = [
    { key: "mgr", email: "manager@demo.local", name: "Morgan Manager", roleName: "Manager", tier: 60 },
    { key: "s1", email: "sales1@demo.local", name: "Sam Salesperson", roleName: "Rep", tier: 20, upline: "mgr" },
    { key: "s2", email: "sales2@demo.local", name: "Sara Seller", roleName: "Rep", tier: 20, upline: "mgr" },
    { key: "vw", email: "viewer@demo.local", name: "Vic Viewer", roleName: "Viewer", tier: 10 },
  ]

  const memberIdOf = (key: string) => `sample-mem-${key}`

  for (const p of people) {
    const uid = `sample-usr-${p.key}`
    const mid = memberIdOf(p.key)
    // user (isSuperadmin stays false — invariant preserved)
    await db
      .insert(user)
      .values({
        id: uid,
        name: p.name,
        email: p.email,
        emailVerified: true,
        isSuperadmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
    // credential account (email/password sign-in)
    await db
      .insert(account)
      .values({
        id: `sample-acct-${p.key}`,
        accountId: uid,
        providerId: "credential",
        userId: uid,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
    // org membership
    await db
      .insert(member)
      .values({
        id: mid,
        organizationId: TENANT_ID,
        userId: uid,
        role: "member",
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  }
  // membership profiles in a second pass so upline member rows already exist
  for (const p of people) {
    await db
      .insert(membershipProfiles)
      .values({
        id: det(`mp:${p.key}`),
        memberId: memberIdOf(p.key),
        tenantId: TENANT_ID,
        roleId: roleId.get(p.roleName) ?? null,
        tierLevel: p.tier,
        managerMemberId: p.upline ? memberIdOf(p.upline) : null,
        status: "active",
      })
      .onConflictDoNothing()
    // member_roles = effective-permission source (union of assigned roles).
    const rid = roleId.get(p.roleName)
    if (rid) {
      await db
        .insert(memberRoles)
        .values({
          id: det(`mr:${p.key}`),
          tenantId: TENANT_ID,
          memberId: memberIdOf(p.key),
          roleId: rid,
        })
        .onConflictDoNothing()
    }
  }

  const MEM_MGR = memberIdOf("mgr")
  const MEM_S1 = memberIdOf("s1")
  const MEM_S2 = memberIdOf("s2")

  // ── 2. accounts (customer companies) ──────────────────────────────────────
  const accId = (k: string) => det(`account:${k}`)
  const accountValues = [
    { k: "acme", name: "Acme Corporation", code: "ACME", accountType: "client", industry: "Manufacturing", owner: MEM_S1, isCustomer: true },
    { k: "globex", name: "Globex Industries", code: "GLOBEX", accountType: "client", industry: "Energy", owner: MEM_S2, isCustomer: true },
    { k: "initech", name: "Initech Sdn Bhd", code: "INITECH", accountType: "client", industry: "Technology", owner: MEM_S1, isCustomer: true },
    { k: "umbrella", name: "Umbrella Group", code: "UMBRELLA", accountType: "client", industry: "Healthcare", owner: MEM_S2, isCustomer: true },
    // child of Umbrella Group (parent hierarchy)
    { k: "umbpharma", name: "Umbrella Pharma", code: "UMBPH", accountType: "client", industry: "Healthcare", owner: MEM_S2, parent: "umbrella", isCustomer: true },
    // reseller pointing at an end-user client (channel relationship)
    { k: "stark", name: "Stark Reseller Partners", code: "STARKR", accountType: "reseller", industry: "Technology", owner: MEM_S1, endUser: "acme" },
    // ── more customers ──
    { k: "wayne", name: "Wayne Enterprises", code: "WAYNE", accountType: "client", industry: "Finance", owner: MEM_S1, isCustomer: true },
    { k: "soylent", name: "Soylent Foods Bhd", code: "SOYLENT", accountType: "client", industry: "Food & Beverage", owner: MEM_S2, isCustomer: true },
    { k: "wonka", name: "Wonka Industries", code: "WONKA", accountType: "client", industry: "Food & Beverage", owner: MEM_S1, isCustomer: true },
    // child of Stark's channel (reseller's end-user division)
    { k: "starkretail", name: "Stark Retail Division", code: "STARKRD", accountType: "client", industry: "Retail", owner: MEM_S1, parent: "stark", isCustomer: true },
    // ── prospects (not yet customers — isCustomer=false) ──
    { k: "hooli", name: "Hooli Ventures", code: "HOOLI", accountType: "prospect", industry: "Technology", owner: MEM_S1, isCustomer: false },
    { k: "cyberdyne", name: "Cyberdyne Systems", code: "CYBER", accountType: "prospect", industry: "Robotics", owner: MEM_S2, isCustomer: false },
  ]
  for (const a of accountValues) {
    await db
      .insert(accounts)
      .values({
        id: accId(a.k),
        tenantId: TENANT_ID,
        name: a.name,
        code: a.code,
        accountType: a.accountType,
        industry: a.industry,
        isCustomer: a.isCustomer ?? (a.accountType === "client"),
        ownerMemberId: a.owner,
        parentAccountId: a.parent ? accId(a.parent) : null,
        endUserAccountId: a.endUser ? accId(a.endUser) : null,
      })
      .onConflictDoNothing()
  }

  // ── 3. persons (contacts under several accounts) ──────────────────────────
  const perId = (k: string) => det(`person:${k}`)
  const personValues = [
    { k: "acme-alice", account: "acme", firstName: "Alice", lastName: "Tan", title: "IT Director", email: "alice.tan@acme.example", phone: "+60 12-300 1001", primary: true },
    { k: "acme-bob", account: "acme", firstName: "Bob", lastName: "Lee", title: "Procurement Lead", email: "bob.lee@acme.example", phone: "+60 12-300 1002", primary: false },
    { k: "globex-carol", account: "globex", firstName: "Carol", lastName: "Lim", title: "Operations Manager", email: "carol.lim@globex.example", phone: "+60 12-300 2001", primary: true },
    { k: "globex-dan", account: "globex", firstName: "Dan", lastName: "Ong", title: "Procurement Officer", email: "dan.ong@globex.example", phone: "+60 12-300 2002", primary: false },
    { k: "initech-david", account: "initech", firstName: "David", lastName: "Ng", title: "CISO", email: "david.ng@initech.example", phone: "+60 12-300 3001", primary: true },
    { k: "umbrella-eva", account: "umbrella", firstName: "Eva", lastName: "Wong", title: "Head of Digital", email: "eva.wong@umbrella.example", phone: "+60 12-300 4001", primary: true },
    // ── more contacts across the added accounts ──
    { k: "wayne-victor", account: "wayne", firstName: "Victor", lastName: "Chen", title: "Chief Financial Officer", email: "victor.chen@wayne.example", phone: "+60 12-300 5001", primary: true },
    { k: "wayne-bruce", account: "wayne", firstName: "Bruce", lastName: "Tan", title: "Head of IT", email: "bruce.tan@wayne.example", phone: "+60 12-300 5002", primary: false },
    { k: "soylent-nina", account: "soylent", firstName: "Nina", lastName: "Rao", title: "Chief Operating Officer", email: "nina.rao@soylent.example", phone: "+60 12-300 6001", primary: true },
    { k: "wonka-willy", account: "wonka", firstName: "Willy", lastName: "Loh", title: "Managing Director", email: "willy.loh@wonka.example", phone: "+60 12-300 7001", primary: true },
    { k: "hooli-gavin", account: "hooli", firstName: "Gavin", lastName: "Belson", title: "Chief Executive Officer", email: "gavin.belson@hooli.example", phone: "+60 12-300 8001", primary: true },
    { k: "cyberdyne-miles", account: "cyberdyne", firstName: "Miles", lastName: "Dyson", title: "Chief Technology Officer", email: "miles.dyson@cyberdyne.example", phone: "+60 12-300 9001", primary: true },
  ]
  for (const c of personValues) {
    await db
      .insert(persons)
      .values({
        id: perId(c.k),
        tenantId: TENANT_ID,
        accountId: accId(c.account),
        firstName: c.firstName,
        lastName: c.lastName,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isPrimary: c.primary,
      })
      .onConflictDoNothing()
  }

  // ── 4. funnels (pipelines) across stages ──────────────────────────────
  const oppId = (k: string) => det(`opportunity:${k}`)
  // projectNature codes below come from the tenant's project-nature picklist
  // seeded in seed.ts (L/H/PS/T/M). The funnel's project_nature_code is
  // inherited by its quotations (see section 5).
  const oppValues = [
    { k: "acme-erp", name: "Acme ERP Implementation", account: "acme", person: "acme-alice", owner: MEM_S1, stage: "0e", status: "open", amount: "120000.00", expected: "2026-10-31", projectNature: "L" },
    { k: "globex-cloud", name: "Globex Cloud Migration", account: "globex", person: "globex-carol", owner: MEM_S2, stage: "1d", status: "open", amount: "85000.00", expected: "2026-09-30", projectNature: "H" },
    // sales1-owned, currently at gated 2c → the pending approval below advances it to 3b
    { k: "initech-audit", name: "Initech Security Audit", account: "initech", person: "initech-david", owner: MEM_S1, stage: "2c", status: "open", amount: "22260.00", expected: "2026-08-15", projectNature: "PS" },
    { k: "umbrella-crm", name: "Umbrella CRM Rollout", account: "umbrella", person: "umbrella-eva", owner: MEM_S2, stage: "3b", status: "open", amount: "47700.00", expected: "2026-08-31", projectNature: "PS" },
    { k: "acme-data", name: "Acme Data Platform", account: "acme", person: "acme-alice", owner: MEM_S1, stage: "4a", status: "open", amount: "210000.00", expected: "2026-07-31", projectNature: "M" },
    // Won — carries the accepted primary quote + project + milestones + SO
    { k: "stark-msp", name: "Stark Managed Services", account: "stark", person: null, owner: MEM_S2, stage: "won", status: "won", amount: "40280.00", closed: true, projectNature: "PS" },
    // Lost
    { k: "globex-legacy", name: "Globex Legacy Upgrade", account: "globex", person: "globex-carol", owner: MEM_S1, stage: "lost", status: "lost", amount: "60000.00", closed: true, lostReason: "Budget deferred to next fiscal year", projectNature: "H" },
    // KIV / parked
    { k: "umbpharma-pilot", name: "Umbrella Pharma Pilot", account: "umbpharma", person: null, owner: MEM_S2, stage: "kiv", status: "on_hold", amount: "30000.00", kivReview: "2026-09-01", projectNature: "T" },
    // ── more deals across every stage / owner (fuller pipeline board + charts) ──
    { k: "wonka-portal", name: "Wonka Customer Portal", account: "wonka", person: "wonka-willy", owner: MEM_S1, stage: "0e", status: "open", amount: "54000.00", expected: "2026-12-15", projectNature: "L" },
    { k: "wayne-analytics", name: "Wayne Analytics Platform", account: "wayne", person: "wayne-victor", owner: MEM_S1, stage: "1d", status: "open", amount: "95000.00", expected: "2026-11-30", projectNature: "H" },
    { k: "soylent-bi", name: "Soylent BI Dashboards", account: "soylent", person: "soylent-nina", owner: MEM_S2, stage: "2c", status: "open", amount: "68000.00", expected: "2026-10-15", projectNature: "PS" },
    // renewal deal (isRenewal flag)
    { k: "acme-support", name: "Acme Support Renewal FY27", account: "acme", person: "acme-bob", owner: MEM_S1, stage: "3b", status: "open", amount: "36000.00", expected: "2026-09-20", projectNature: "M", isRenewal: true },
    { k: "globex-expansion", name: "Globex Platform Expansion", account: "globex", person: "globex-carol", owner: MEM_S2, stage: "4a", status: "open", amount: "130000.00", expected: "2026-08-25", projectNature: "H" },
    // second Won deal (carries its own accepted primary quote)
    { k: "initech-mssp", name: "Initech Managed SecOps", account: "initech", person: "initech-david", owner: MEM_S1, stage: "won", status: "won", amount: "88000.00", closed: true, projectNature: "PS" },
    // second Lost
    { k: "wayne-legacy", name: "Wayne Legacy Migration", account: "wayne", person: null, owner: MEM_S1, stage: "lost", status: "lost", amount: "45000.00", closed: true, lostReason: "Lost to incumbent vendor", projectNature: "T" },
    // second KIV
    { k: "soylent-audit", name: "Soylent Compliance Audit", account: "soylent", person: "soylent-nina", owner: MEM_S2, stage: "kiv", status: "on_hold", amount: "25000.00", kivReview: "2026-10-01", projectNature: "PS" },
  ]
  const oppProjectNature = new Map(oppValues.map((o) => [o.k, o.projectNature]))

  // Opportunity CONTAINERS (parent of funnels). Acme's two deals share ONE
  // container to demo the Total-Estimated-Funnel-Amount rollup (1 opp → N funnels).
  const containerOf: Record<string, string> = {
    "acme-erp": "acme-platform",
    "acme-data": "acme-platform",
    "acme-support": "acme-platform", // third funnel under Acme's programme container
    "globex-cloud": "globex-cloud",
    "initech-audit": "initech-audit",
    "umbrella-crm": "umbrella-crm",
    "stark-msp": "stark-msp",
    "globex-legacy": "globex-legacy",
    "umbpharma-pilot": "umbpharma-pilot",
    "wonka-portal": "wonka-portal",
    // Wayne container groups two funnels (analytics + legacy) → rollup demo
    "wayne-analytics": "wayne-programme",
    "wayne-legacy": "wayne-programme",
    "soylent-bi": "soylent-bi",
    "globex-expansion": "globex-expansion",
    "initech-mssp": "initech-mssp",
    "soylent-audit": "soylent-audit",
  }
  const containerId = (ck: string) => det(`opportunity-container:${ck}`)
  const containerName: Record<string, string> = {
    "acme-platform": "Acme Digital Platform Programme",
    "globex-cloud": "Globex Cloud Migration",
    "initech-audit": "Initech Security Audit",
    "umbrella-crm": "Umbrella CRM Rollout",
    "stark-msp": "Stark Managed Services",
    "globex-legacy": "Globex Legacy Upgrade",
    "umbpharma-pilot": "Umbrella Pharma Pilot",
    "wonka-portal": "Wonka Customer Portal",
    "wayne-programme": "Wayne Digital Programme",
    "soylent-bi": "Soylent BI Programme",
    "globex-expansion": "Globex Platform Expansion",
    "initech-mssp": "Initech Managed SecOps",
    "soylent-audit": "Soylent Compliance Audit",
  }
  const containerKeys = [...new Set(Object.values(containerOf))]
  let cnum = 0
  for (const ck of containerKeys) {
    cnum++
    const members = oppValues.filter((o) => containerOf[o.k] === ck)
    const first = members[0]
    const total = members
      .reduce((s, o) => s + Number(o.amount), 0)
      .toFixed(2)
    await db
      .insert(opportunities)
      .values({
        id: containerId(ck),
        tenantId: TENANT_ID,
        accountId: accId(first.account),
        primaryPersonId: first.person ? perId(first.person) : null,
        ownerMemberId: first.owner,
        opportunityYear: 2026,
        opportunityNumber: cnum,
        code: `OPP-2026-${String(cnum).padStart(4, "0")}`,
        name: containerName[ck] ?? ck,
        totalEstimatedFunnelAmount: total,
        currency: "MYR",
      })
      .onConflictDoNothing()
  }

  for (const o of oppValues) {
    const closeTs = o.closed ? new Date("2026-06-01T08:00:00Z") : null
    await db
      .insert(funnels)
      .values({
        id: oppId(o.k),
        tenantId: TENANT_ID,
        opportunityId: containerId(containerOf[o.k]),
        name: o.name,
        accountId: accId(o.account),
        primaryPersonId: o.person ? perId(o.person) : null,
        pipelineId: funnel.id,
        currentStageId: stage.get(o.stage)!,
        ownerMemberId: o.owner,
        isRenewal: o.isRenewal ?? false,
        amount: o.amount,
        // Estimated Funnel Amount drives the forecast; seed it from the deal value.
        estimatedAmount: o.amount,
        // Demo an intercompany middle-man deal: a partner handles delivery and
        // we recognize only 10% as the contracting middle-man.
        isIntercompany: o.k === "umbrella-crm",
        // Intercompany partner must be another ENTITY (org); the sample seed has
        // only one, so no intercompany_deal_parties row is seeded. The badge +
        // recognized % (manual, no party) still demo the flag.
        recognizedPercent: o.k === "umbrella-crm" ? "10.00" : null,
        projectYear: o.expected ? Number(o.expected.slice(0, 4)) : null,
        currency: "MYR",
        projectNatureCode: o.projectNature,
        // Demo a multi-nature deal (Professional Services + License + Mixed).
        projectNatures:
          o.k === "umbrella-crm" ? ["PS", "L", "M"] : null,
        status: o.status as "open" | "won" | "lost" | "on_hold",
        expectedCloseDate: o.expected ?? null,
        actualCloseDate: closeTs ? "2026-06-01" : null,
        closedAt: closeTs,
        lostReason: o.lostReason ?? null,
        kivReviewDate: o.kivReview ?? null,
      })
      .onConflictDoNothing()
  }

  // ── 5. quotations (draft / sent / accepted) + line items ──────────────────
  const quoteId = (k: string) => det(`quotation:${k}`)
  type QLine = { description: string; quantity: number; unitPrice: number; discountAmount?: number }
  const quoteSpecs: {
    k: string
    opp: string
    number: string
    status: "draft" | "sent" | "accepted" | "rejected" | "expired" | "void"
    isPrimary: boolean
    sent?: boolean
    accepted?: boolean
    lines: QLine[]
  }[] = [
    {
      k: "initech-draft",
      opp: "initech-audit",
      number: "Q-SMP-0001",
      status: "draft",
      isPrimary: true,
      lines: [
        { description: "Security audit — discovery & scoping", quantity: 1, unitPrice: 12000 },
        { description: "Penetration testing", quantity: 1, unitPrice: 9000 },
      ],
    },
    {
      k: "umbrella-sent",
      opp: "umbrella-crm",
      number: "Q-SMP-0002",
      status: "sent",
      isPrimary: true,
      sent: true,
      lines: [
        { description: "CRM platform licence (per seat / yr)", quantity: 50, unitPrice: 600 },
        { description: "Implementation & configuration services", quantity: 1, unitPrice: 15000 },
      ],
    },
    {
      k: "stark-accepted",
      opp: "stark-msp",
      number: "Q-SMP-0003",
      status: "accepted",
      isPrimary: true,
      sent: true,
      accepted: true,
      lines: [
        { description: "Managed services — monthly retainer", quantity: 12, unitPrice: 2500 },
        { description: "Onboarding & environment setup", quantity: 1, unitPrice: 8000 },
      ],
    },
    // accepted primary on the second Won deal
    {
      k: "initech-mssp-accepted",
      opp: "initech-mssp",
      number: "Q-SMP-0004",
      status: "accepted",
      isPrimary: true,
      sent: true,
      accepted: true,
      lines: [
        { description: "Managed SecOps — 24x7 monitoring (annual)", quantity: 1, unitPrice: 72000 },
        { description: "SIEM onboarding & tuning", quantity: 1, unitPrice: 16000 },
      ],
    },
    // sent, awaiting decision
    {
      k: "wayne-sent",
      opp: "wayne-analytics",
      number: "Q-SMP-0005",
      status: "sent",
      isPrimary: true,
      sent: true,
      lines: [
        { description: "Analytics platform — build & deploy", quantity: 1, unitPrice: 78000 },
        { description: "Data pipeline integration", quantity: 1, unitPrice: 17000 },
      ],
    },
    // rejected by the customer
    {
      k: "soylent-rejected",
      opp: "soylent-bi",
      number: "Q-SMP-0006",
      status: "rejected",
      isPrimary: true,
      sent: true,
      lines: [
        { description: "BI dashboards — design & build", quantity: 1, unitPrice: 52000 },
        { description: "Training & handover", quantity: 2, unitPrice: 8000 },
      ],
    },
    // lapsed past validity
    {
      k: "globex-expired",
      opp: "globex-expansion",
      number: "Q-SMP-0007",
      status: "expired",
      isPrimary: true,
      sent: true,
      lines: [
        { description: "Platform expansion — additional modules", quantity: 1, unitPrice: 110000 },
        { description: "Capacity upgrade", quantity: 1, unitPrice: 20000 },
      ],
    },
    // a superseded revision sitting alongside the SENT primary on Umbrella (non-primary)
    {
      k: "umbrella-revised",
      opp: "umbrella-crm",
      number: "Q-SMP-0008",
      status: "void",
      isPrimary: false,
      lines: [
        { description: "CRM platform licence (revised seat count)", quantity: 40, unitPrice: 600 },
      ],
    },
  ]
  for (const q of quoteSpecs) {
    const totals = computeQuotation({ lines: q.lines, ratePercent: taxRate, taxInclusive: false })
    await db
      .insert(quotations)
      .values({
        id: quoteId(q.k),
        tenantId: TENANT_ID,
        funnelId: oppId(q.opp),
        quoteNumber: q.number,
        version: 1,
        isPrimary: q.isPrimary,
        status: q.status,
        currency: "MYR",
        // inherited from the source funnel on create (editable thereafter)
        projectNatureCode: oppProjectNature.get(q.opp) ?? null,
        taxSettingId: tax.id,
        taxRateSnapshot: taxRate,
        taxInclusive: false,
        subtotal: String(totals.subtotal),
        headerDiscount: "0",
        discountTotal: String(totals.discountTotal),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
        validUntil: "2026-12-31",
        notes: q.status === "draft" ? "Pending internal review." : null,
        sentAt: q.sent ? new Date("2026-05-20T03:00:00Z") : null,
        acceptedAt: q.accepted ? new Date("2026-06-01T07:30:00Z") : null,
      })
      .onConflictDoNothing()
    for (let i = 0; i < q.lines.length; i++) {
      const lc = totals.lines[i]
      const line = q.lines[i]
      await db
        .insert(quotationLineItems)
        .values({
          id: det(`qli:${q.k}:${i}`),
          tenantId: TENANT_ID,
          quotationId: quoteId(q.k),
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          discountAmount: String(line.discountAmount ?? 0),
          taxSettingId: tax.id,
          lineSubtotal: String(lc.lineSubtotal),
          lineTax: String(lc.lineTax),
          lineTotal: String(lc.lineTotal),
          sortOrder: i,
        })
        .onConflictDoNothing()
    }
  }
  // point each won opportunity at its accepted primary quote
  await db
    .update(funnels)
    .set({ primaryQuotationId: quoteId("stark-accepted") })
    .where(eq(funnels.id, oppId("stark-msp")))
  await db
    .update(funnels)
    .set({ primaryQuotationId: quoteId("initech-mssp-accepted") })
    .where(eq(funnels.id, oppId("initech-mssp")))

  // ── 6+7. project + milestones off the accepted quote (won deal) ───────────
  // Only when the projects plugin is enabled — otherwise a core-only seed would
  // create orphan project/milestone rows. The PROJECT_ID string is declared
  // unconditionally (a deterministic id, harmless) so section 8 can reference it.
  const PROJECT_ID = det("project:stark-msp")
  if (isModuleEnabled("projects")) {
    await db
      .insert(projects)
      .values({
        id: PROJECT_ID,
        tenantId: TENANT_ID,
        projectCode: "2026-DEMO-STARKR-PS-001",
        codeNature: "manual",
        projectNatureCode: "PS",
        name: "Stark Managed Services — Year 1",
        accountId: accId("stark"),
        funnelId: oppId("stark-msp"),
        quotationId: quoteId("stark-accepted"),
        ownerMemberId: MEM_S2,
        status: "active",
        startDate: "2026-06-05",
        value: "40280.00",
        currency: "MYR",
        notes: "Delivery kicked off after quote acceptance.",
      })
      .onConflictDoNothing()

    // payment milestones reconciling to the accepted quote total
    const milestones = [
      { k: "deposit", title: "Deposit", amount: "20140.00", due: "2026-06-15", status: "invoiced", sort: 0 },
      { k: "completion", title: "On completion", amount: "20140.00", due: "2026-12-15", status: "pending", sort: 1 },
    ]
    for (const m of milestones) {
      await db
        .insert(paymentMilestones)
        .values({
          id: det(`milestone:${m.k}`),
          tenantId: TENANT_ID,
          projectId: PROJECT_ID,
          quotationId: quoteId("stark-accepted"),
          title: m.title,
          amount: m.amount,
          dueDate: m.due,
          status: m.status as "pending" | "invoiced" | "paid",
          sortOrder: m.sort,
        })
        .onConflictDoNothing()
    }
  }

  // ── 8. sales order submitted against the project (awaits manager review) ──
  // Requires BOTH projects (for the parent row) and salesOrders plugins.
  if (isModuleEnabled("projects") && isModuleEnabled("salesOrders")) {
    await db
      .insert(salesOrders)
      .values({
        id: det("so:stark"),
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        soNumber: null, // issued only on approval
        documentKind: "po",
        paymentTerm: "30 days",
        status: "submitted",
        submittedByMemberId: MEM_S2,
        notes: "Customer PO attached; awaiting sales-admin approval.",
        submittedAt: new Date("2026-06-03T02:00:00Z"),
      })
      .onConflictDoNothing()
  }

  // ── 9. PENDING stage-approval request (the key item for manager's inbox) ──
  // sales1 (tier 20, below the bypass tier 40) advancing the gated 2c→3b move
  // on a deal they own. The opportunity STAYS at 2c (not optimistically moved),
  // exactly as server/services/stage.ts#requestStageAdvance does. Routed to the
  // upline (manager) who holds STAGE_ADVANCE_APPROVE and tier ≥ requester.
  const APPROVAL_ID = det("sar:initech-audit:2c->3b")
  await db
    .insert(stageApprovalRequests)
    .values({
      id: APPROVAL_ID,
      tenantId: TENANT_ID,
      funnelId: oppId("initech-audit"),
      requesterMemberId: MEM_S1,
      fromStageId: stage.get("2c")!,
      targetStageId: stage.get("3b")!,
      reason: "Customer verbally agreed; ready to move into negotiation.",
      status: "pending",
      approverMemberId: MEM_MGR,
      requestedAt: new Date("2026-06-25T06:00:00Z"),
    })
    .onConflictDoNothing()

  // ── 10. leads (unconverted) ───────────────────────────────────────────────
  const leadValues = [
    { k: "nimbus", name: "Frank Aziz", companyName: "Nimbus Tech", email: "frank@nimbustech.example", phone: "+60 13-555 0001", source: "Website", status: "new", owner: MEM_S1 },
    { k: "orbit", name: "Grace Teo", companyName: "Orbit Logistics", email: "grace@orbitlogistics.example", phone: "+60 13-555 0002", source: "Referral", status: "contacted", owner: MEM_S2 },
    { k: "peak", name: "Henry Goh", companyName: "Peak Retail", email: "henry@peakretail.example", phone: "+60 13-555 0003", source: "Trade Show", status: "qualified", owner: MEM_S1 },
    // ── more inbound across every status ──
    { k: "delta", name: "Jack Ho", companyName: "Delta Freight", email: "jack@deltafreight.example", phone: "+60 13-555 0004", source: "Cold Call", status: "new", owner: MEM_S2 },
    { k: "apex", name: "Kelly Yeo", companyName: "Apex Media", email: "kelly@apexmedia.example", phone: "+60 13-555 0005", source: "LinkedIn", status: "contacted", owner: MEM_S1 },
    { k: "vertex", name: "Leon Chua", companyName: "Vertex Labs", email: "leon@vertexlabs.example", phone: "+60 13-555 0006", source: "Webinar", status: "qualified", owner: MEM_S2 },
    // disqualified (carries a reason)
    { k: "zenith", name: "Ivy Sim", companyName: "Zenith Corp", email: "ivy@zenithcorp.example", phone: "+60 13-555 0007", source: "Website", status: "disqualified", disqualifyReason: "No budget this cycle", owner: MEM_S2 },
    // converted (links to the account + contact it became)
    { k: "acme-inbound", name: "Alice Tan", companyName: "Acme Corporation", email: "alice.tan@acme.example", phone: "+60 12-300 1001", source: "Referral", status: "converted", owner: MEM_S1, convertedAccount: "acme", convertedPerson: "acme-alice", converted: true },
  ]
  for (const l of leadValues) {
    await db
      .insert(leads)
      .values({
        id: det(`lead:${l.k}`),
        tenantId: TENANT_ID,
        name: l.name,
        companyName: l.companyName,
        email: l.email,
        phone: l.phone,
        source: l.source,
        status: l.status as "new" | "contacted" | "qualified" | "disqualified" | "converted",
        disqualifyReason: l.disqualifyReason ?? null,
        convertedAccountId: l.convertedAccount ? accId(l.convertedAccount) : null,
        convertedPersonId: l.convertedPerson ? perId(l.convertedPerson) : null,
        convertedAt: l.converted ? new Date("2026-05-10T02:00:00Z") : null,
        ownerMemberId: l.owner,
      })
      .onConflictDoNothing()
  }

  // ── 11. products (standardised catalog) ───────────────────────────────────
  const productValues = [
    { k: "coaching-bi", name: "Coaching - Business Intelligence", productCode: "COACHING", subcategory: "Data Analytics", uom: "Day", price: "15000.00", description: "HRDF Claimable RM10,500" },
    { k: "training-pbi", name: "Training - Power BI Fundamentals", productCode: "TRAINING", subcategory: "Data Analytics", uom: "Day", price: "8000.00", description: "2-day instructor-led course" },
    { k: "license-annual", name: "Platform License - Annual", productCode: "LICENSE", subcategory: "Subscription", uom: "Year", price: "36000.00", description: "Per-tenant annual subscription" },
    { k: "support-prem", name: "Premium Support", productCode: "SUPPORT", subcategory: "Managed Services", uom: "Month", price: "5000.00", description: "Priority SLA, 8x5 coverage" },
    { k: "consulting-strategy", name: "Consulting - Data Strategy", productCode: "CONSULT", subcategory: "Advisory", uom: "Day", price: "18000.00", description: "Executive data-strategy advisory" },
    { k: "impl-crm", name: "Implementation - CRM Rollout", productCode: "IMPL", subcategory: "Professional Services", uom: "Project", price: "45000.00", description: "End-to-end CRM implementation" },
    { k: "integration-api", name: "Integration - API Connector", productCode: "INTEG", subcategory: "Professional Services", uom: "Each", price: "12000.00", description: "Bespoke API integration" },
    { k: "managed-cloud", name: "Managed Cloud Operations", productCode: "MCLOUD", subcategory: "Managed Services", uom: "Month", price: "7000.00", description: "24x7 managed cloud ops" },
    { k: "workshop-ai", name: "Workshop - AI for Business", productCode: "WORKSHOP", subcategory: "Data Analytics", uom: "Day", price: "9000.00", description: "1-day executive AI workshop" },
  ]
  for (const p of productValues) {
    await db
      .insert(products)
      .values({
        id: det(`product:${p.k}`),
        tenantId: TENANT_ID,
        name: p.name,
        productCode: p.productCode,
        subcategory: p.subcategory,
        uom: p.uom,
        currency: "MYR",
        standardPrice: p.price,
        description: p.description,
        isActive: true,
      })
      .onConflictDoNothing()
  }

  // ── 12. multi-year contract on the interco deal ───────────────────────────
  const umbrellaOppId = oppId("umbrella-crm")
  const contractYearValues = [
    { y: 2024, t: "Y1 — License + PS + AMS", a: "47700.00", s: "invoiced" },
    { y: 2025, t: "Y2 — License + AMS", a: "42000.00", s: "planned" },
    { y: 2026, t: "Y3 — License + AMS", a: "42000.00", s: "planned" },
    { y: 2027, t: "Y4 — License + AMS", a: "43500.00", s: "planned" },
    { y: 2028, t: "Y5 (subject to change)", a: "45000.00", s: "planned" },
  ]
  for (const cy of contractYearValues) {
    await db
      .insert(contractYears)
      .values({
        id: det(`contractyear:umbrella:${cy.y}`),
        tenantId: TENANT_ID,
        funnelId: umbrellaOppId,
        year: cy.y,
        title: cy.t,
        amount: cy.a,
        currency: "MYR",
        status: cy.s,
        sortOrder: cy.y,
      })
      .onConflictDoNothing()
  }

  await sql.end()
  console.log("✓ sample seed complete")
  const pwHint = process.env.SEED_SAMPLE_PASSWORD
    ? "SEED_SAMPLE_PASSWORD"
    : IS_PROD
      ? "DEMO_ADMIN_PASSWORD"
      : "'Password123!'"
  console.log(`  login (all share password: ${pwHint}):`)
  for (const p of people) console.log(`    ${p.email.padEnd(20)} ${p.roleName} (tier ${p.tier})`)
  console.log(`  pending approval id: ${APPROVAL_ID} (Initech Security Audit, 2c → 3b, routed to manager@demo.local)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
