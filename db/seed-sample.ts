import "dotenv/config"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { auth } from "@/lib/auth"
import { computeQuotation } from "@/server/services/quotation-math"

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
 *   - owns accounts/contacts/funnels/quotations across sales1 & sales2 so
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
  funnels,
  funnelStages,
  taxSettings,
  accounts,
  persons,
  opportunities,
  quotations,
  quotationLineItems,
  stageApprovalRequests,
  projects,
  paymentMilestones,
  salesOrders,
  leads,
} = schema

const TENANT_ID = "demo-entity"
const PASSWORD = "Password123!"

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
    .from(funnels)
    .where(and(eq(funnels.tenantId, TENANT_ID), eq(funnels.isDefault, true)))
    .limit(1)
  if (!funnel) throw new Error("Default funnel not found — run `npm run db:seed` first.")
  const stageRows = await db
    .select()
    .from(funnelStages)
    .where(eq(funnelStages.funnelId, funnel.id))
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
  }

  const MEM_MGR = memberIdOf("mgr")
  const MEM_S1 = memberIdOf("s1")
  const MEM_S2 = memberIdOf("s2")

  // ── 2. accounts (customer companies) ──────────────────────────────────────
  const accId = (k: string) => det(`account:${k}`)
  const accountValues = [
    { k: "acme", name: "Acme Corporation", code: "ACME", accountType: "client", industry: "Manufacturing", owner: MEM_S1 },
    { k: "globex", name: "Globex Industries", code: "GLOBEX", accountType: "client", industry: "Energy", owner: MEM_S2 },
    { k: "initech", name: "Initech Sdn Bhd", code: "INITECH", accountType: "client", industry: "Technology", owner: MEM_S1 },
    { k: "umbrella", name: "Umbrella Group", code: "UMBRELLA", accountType: "client", industry: "Healthcare", owner: MEM_S2 },
    // child of Umbrella Group (parent hierarchy)
    { k: "umbpharma", name: "Umbrella Pharma", code: "UMBPH", accountType: "client", industry: "Healthcare", owner: MEM_S2, parent: "umbrella" },
    // reseller pointing at an end-user client (channel relationship)
    { k: "stark", name: "Stark Reseller Partners", code: "STARKR", accountType: "reseller", industry: "Technology", owner: MEM_S1, endUser: "acme" },
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
    { k: "initech-david", account: "initech", firstName: "David", lastName: "Ng", title: "CISO", email: "david.ng@initech.example", phone: "+60 12-300 3001", primary: true },
    { k: "umbrella-eva", account: "umbrella", firstName: "Eva", lastName: "Wong", title: "Head of Digital", email: "eva.wong@umbrella.example", phone: "+60 12-300 4001", primary: true },
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

  // ── 4. opportunities (funnels) across stages ──────────────────────────────
  const oppId = (k: string) => det(`opportunity:${k}`)
  const oppValues = [
    { k: "acme-erp", name: "Acme ERP Implementation", account: "acme", person: "acme-alice", owner: MEM_S1, stage: "0e", status: "open", amount: "120000.00", expected: "2026-10-31" },
    { k: "globex-cloud", name: "Globex Cloud Migration", account: "globex", person: "globex-carol", owner: MEM_S2, stage: "1d", status: "open", amount: "85000.00", expected: "2026-09-30" },
    // sales1-owned, currently at gated 2c → the pending approval below advances it to 3b
    { k: "initech-audit", name: "Initech Security Audit", account: "initech", person: "initech-david", owner: MEM_S1, stage: "2c", status: "open", amount: "22260.00", expected: "2026-08-15" },
    { k: "umbrella-crm", name: "Umbrella CRM Rollout", account: "umbrella", person: "umbrella-eva", owner: MEM_S2, stage: "3b", status: "open", amount: "47700.00", expected: "2026-08-31" },
    { k: "acme-data", name: "Acme Data Platform", account: "acme", person: "acme-alice", owner: MEM_S1, stage: "4a", status: "open", amount: "210000.00", expected: "2026-07-31" },
    // Won — carries the accepted primary quote + project + milestones + SO
    { k: "stark-msp", name: "Stark Managed Services", account: "stark", person: null, owner: MEM_S2, stage: "won", status: "won", amount: "40280.00", closed: true },
    // Lost
    { k: "globex-legacy", name: "Globex Legacy Upgrade", account: "globex", person: "globex-carol", owner: MEM_S1, stage: "lost", status: "lost", amount: "60000.00", closed: true, lostReason: "Budget deferred to next fiscal year" },
    // KIV / parked
    { k: "umbpharma-pilot", name: "Umbrella Pharma Pilot", account: "umbpharma", person: null, owner: MEM_S2, stage: "kiv", status: "on_hold", amount: "30000.00", kivReview: "2026-09-01" },
  ]
  for (const o of oppValues) {
    const closeTs = o.closed ? new Date("2026-06-01T08:00:00Z") : null
    await db
      .insert(opportunities)
      .values({
        id: oppId(o.k),
        tenantId: TENANT_ID,
        name: o.name,
        accountId: accId(o.account),
        primaryPersonId: o.person ? perId(o.person) : null,
        funnelId: funnel.id,
        currentStageId: stage.get(o.stage)!,
        ownerMemberId: o.owner,
        amount: o.amount,
        currency: "MYR",
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
  type QLine = { description: string; quantity: number; unitPrice: number; discountPercent?: number }
  const quoteSpecs: {
    k: string
    opp: string
    number: string
    status: "draft" | "sent" | "accepted"
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
  ]
  for (const q of quoteSpecs) {
    const totals = computeQuotation({ lines: q.lines, ratePercent: taxRate, taxInclusive: false })
    await db
      .insert(quotations)
      .values({
        id: quoteId(q.k),
        tenantId: TENANT_ID,
        opportunityId: oppId(q.opp),
        quoteNumber: q.number,
        version: 1,
        isPrimary: q.isPrimary,
        status: q.status,
        currency: "MYR",
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
          discountPercent: String(line.discountPercent ?? 0),
          taxSettingId: tax.id,
          lineSubtotal: String(lc.lineSubtotal),
          lineTax: String(lc.lineTax),
          lineTotal: String(lc.lineTotal),
          sortOrder: i,
        })
        .onConflictDoNothing()
    }
  }
  // point the won opportunity at its accepted primary quote
  await db
    .update(opportunities)
    .set({ primaryQuotationId: quoteId("stark-accepted") })
    .where(eq(opportunities.id, oppId("stark-msp")))

  // ── 6. project off the accepted quote (won deal) ──────────────────────────
  const PROJECT_ID = det("project:stark-msp")
  await db
    .insert(projects)
    .values({
      id: PROJECT_ID,
      tenantId: TENANT_ID,
      projectCode: "26-DEMO-STARKR-901",
      codeNature: "manual",
      name: "Stark Managed Services — Year 1",
      accountId: accId("stark"),
      opportunityId: oppId("stark-msp"),
      quotationId: quoteId("stark-accepted"),
      ownerMemberId: MEM_S2,
      status: "active",
      startDate: "2026-06-05",
      value: "40280.00",
      currency: "MYR",
      notes: "Delivery kicked off after quote acceptance.",
    })
    .onConflictDoNothing()

  // ── 7. payment milestones reconciling to the accepted quote total ─────────
  const milestones = [
    { k: "deposit", title: "Deposit (50%)", amount: "20140.00", percentage: "50.00", due: "2026-06-15", status: "invoiced", sort: 0 },
    { k: "completion", title: "On completion (50%)", amount: "20140.00", percentage: "50.00", due: "2026-12-15", status: "pending", sort: 1 },
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
        percentage: m.percentage,
        dueDate: m.due,
        status: m.status as "pending" | "invoiced" | "paid",
        sortOrder: m.sort,
      })
      .onConflictDoNothing()
  }

  // ── 8. sales order submitted against the project (awaits manager review) ──
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
      opportunityId: oppId("initech-audit"),
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
        status: l.status as "new" | "contacted" | "qualified",
        ownerMemberId: l.owner,
      })
      .onConflictDoNothing()
  }

  await sql.end()
  console.log("✓ sample seed complete")
  console.log("  login (all password 'Password123!'):")
  for (const p of people) console.log(`    ${p.email.padEnd(20)} ${p.roleName} (tier ${p.tier})`)
  console.log(`  pending approval id: ${APPROVAL_ID} (Initech Security Audit, 2c → 3b, routed to manager@demo.local)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
