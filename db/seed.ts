import "dotenv/config"
import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { ALL_PERMISSION_KEYS, ROLE_TEMPLATES } from "@/lib/permissions"
import { CANONICAL_STAGES } from "@/lib/funnel-stages"
import { auth } from "@/lib/auth"

const {
  permissions,
  roles,
  rolePermissions,
  organization,
  tenantSettings,
  funnels,
  funnelStages,
  taxSettings,
  user,
  account,
  member,
  membershipProfiles,
} = schema

const TENANT_ID = "demo-entity"
const TENANT_NAME = "Demo Entity"

async function main() {
  const url =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/crm"
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql, { schema })

  // 1. global permission catalog
  await db
    .insert(permissions)
    .values(ALL_PERMISSION_KEYS.map((key) => ({ key })))
    .onConflictDoNothing()
  const permRows = await db.select().from(permissions)
  const permId = new Map(permRows.map((p) => [p.key, p.id]))

  // 2. demo entity + settings (email login enabled so you can sign in locally)
  await db
    .insert(organization)
    .values({ id: TENANT_ID, name: TENANT_NAME, slug: "demo", createdAt: new Date() })
    .onConflictDoNothing()
  await db
    .insert(tenantSettings)
    .values({
      organizationId: TENANT_ID,
      allowPasswordLogin: true,
      entityCode: "DEMO",
      industries: [
        "Agriculture",
        "Construction",
        "Consulting",
        "Education",
        "Energy",
        "Finance",
        "Government",
        "Healthcare",
        "Hospitality",
        "Manufacturing",
        "Media",
        "Real Estate",
        "Retail",
        "Technology",
        "Telecommunications",
        "Transportation",
        "Other",
      ],
    })
    .onConflictDoNothing()

  // 3. roles
  for (const rt of ROLE_TEMPLATES) {
    await db
      .insert(roles)
      .values({
        tenantId: TENANT_ID,
        name: rt.name,
        description: rt.description,
        isSystem: true,
        defaultTierLevel: rt.tier,
      })
      .onConflictDoNothing()
  }
  const roleRows = await db
    .select()
    .from(roles)
    .where(eq(roles.tenantId, TENANT_ID))
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]))

  // 4. role → permissions
  for (const rt of ROLE_TEMPLATES) {
    const rid = roleId.get(rt.name)
    if (!rid) continue
    const keys = rt.permissions === "*" ? ALL_PERMISSION_KEYS : rt.permissions
    const values = keys
      .map((k) => ({ tenantId: TENANT_ID, roleId: rid, permissionId: permId.get(k) }))
      .filter((v): v is { tenantId: string; roleId: string; permissionId: string } =>
        Boolean(v.permissionId)
      )
    if (values.length) {
      await db.insert(rolePermissions).values(values).onConflictDoNothing()
    }
  }

  // 5. default funnel + canonical stages
  let [funnel] = await db
    .select()
    .from(funnels)
    .where(and(eq(funnels.tenantId, TENANT_ID), eq(funnels.name, "Sales Pipeline")))
    .limit(1)
  if (!funnel) {
    ;[funnel] = await db
      .insert(funnels)
      .values({ tenantId: TENANT_ID, name: "Sales Pipeline", isDefault: true, isActive: true })
      .returning()
  }
  const existingStages = await db
    .select({ id: funnelStages.id })
    .from(funnelStages)
    .where(eq(funnelStages.funnelId, funnel.id))
  if (existingStages.length === 0) {
    await db.insert(funnelStages).values(
      CANONICAL_STAGES.map((s) => ({
        tenantId: TENANT_ID,
        funnelId: funnel.id,
        code: s.code,
        name: s.name,
        probability: String(s.probability),
        kind: s.kind,
        sortOrder: s.sortOrder,
        requiresApprovalToEnter: s.requiresApprovalToEnter,
        includeInForecast: s.includeInForecast,
      }))
    )
  }

  // 6. default tax setting
  const [tax] = await db
    .select({ id: taxSettings.id })
    .from(taxSettings)
    .where(and(eq(taxSettings.tenantId, TENANT_ID), eq(taxSettings.name, "SST 6%")))
    .limit(1)
  if (!tax) {
    await db.insert(taxSettings).values({
      tenantId: TENANT_ID,
      name: "SST 6%",
      ratePercent: "6.000",
      isDefault: true,
      isActive: true,
    })
  }

  // 7. demo admin (email/password) — for local sign-in without Microsoft
  const email = (process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local").toLowerCase()
  const password = process.env.DEMO_ADMIN_PASSWORD ?? "Password123!"
  let [u] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (!u) {
    const uid = randomUUID()
    await db.insert(user).values({
      id: uid,
      name: "Demo Admin",
      email,
      emailVerified: true,
      isSuperadmin: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    try {
      const ctx = await auth.$context
      const hashed = await ctx.password.hash(password)
      await db.insert(account).values({
        id: randomUUID(),
        accountId: uid,
        providerId: "credential",
        userId: uid,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    } catch (e) {
      console.warn("⚠ could not set demo password:", (e as Error).message)
    }
    ;[u] = await db.select().from(user).where(eq(user.id, uid)).limit(1)
  }

  // 8. demo admin → Owner membership
  const [mem] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, u.id), eq(member.organizationId, TENANT_ID)))
    .limit(1)
  if (!mem) {
    const mid = randomUUID()
    await db.insert(member).values({
      id: mid,
      organizationId: TENANT_ID,
      userId: u.id,
      role: "owner",
      createdAt: new Date(),
    })
    await db.insert(membershipProfiles).values({
      memberId: mid,
      tenantId: TENANT_ID,
      roleId: roleId.get("Owner") ?? null,
      tierLevel: 100,
      status: "active",
    })
  }

  await sql.end()
  console.log("✓ seed complete")
  console.log(`  entity:   ${TENANT_NAME} (${TENANT_ID})`)
  console.log(`  login:    ${email} / ${password}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
