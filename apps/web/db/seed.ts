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
  pipelines,
  pipelineStages,
  taxSettings,
  user,
  account,
  member,
  membershipProfiles,
  memberRoles,
} = schema

const TENANT_ID = "demo-entity"
const TENANT_NAME = process.env.DEMO_TENANT_NAME?.trim() || "Demo Workspace"
const DEMO_CURRENCY = (process.env.DEMO_CURRENCY?.trim().toUpperCase() || "USD").slice(0, 3)
const DEMO_TAX_NAME = process.env.DEMO_TAX_NAME?.trim() || "VAT 5%"
const DEMO_TAX_RATE = process.env.DEMO_TAX_RATE?.trim() || "5.000"

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
  // ponytail: onConflictDoNothing means these picklist defaults only ever
  // apply to a brand-new tenant row — an existing row's projectNatures/
  // productCodes/industries never get backfilled on re-seed (same shape as
  // the pipeline_stages.required_fields bug fixed above). Not fixed here
  // since these are meant to be tenant-editable via Settings and there's no
  // safe "still at default" signal to backfill against. If a future change
  // to these defaults needs to reach existing tenants, add a targeted
  // UPDATE ... WHERE <column> = <old literal default> here.
  await db
    .insert(tenantSettings)
    .values({
      organizationId: TENANT_ID,
      allowPasswordLogin: true,
      entityCode: "DEMO",
      defaultCurrency: DEMO_CURRENCY,
      projectNatures: [
        { code: "L", name: "License" },
        { code: "H", name: "Hardware" },
        { code: "PS", name: "Professional Services" },
        { code: "T", name: "Training" },
        { code: "M", name: "Mixed" },
      ],
      productCodes: [
        { code: "RENEWAL", name: "Renewal" },
        { code: "PS", name: "PS" },
        { code: "TRAINING", name: "Training" },
        { code: "COACHING", name: "Coaching" },
        { code: "HARDWARE", name: "Hardware" },
        { code: "NPS", name: "NPS" },
        { code: "OTHERS", name: "Others" },
      ],
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

  // Demo master switch: SEED_SAMPLE_DATA governs the whole demo. When OFF, the
  // Demo Entity is SUSPENDED — the built-in tenant lock hides + locks it for
  // everyone (server-context enforces `tenant_settings.status`), so a real
  // deployment surfaces no demo. When ON it is (re)activated. Reconciled on
  // every migrate, so flipping the env var + redeploy is the whole toggle.
  // NB: suspending locks out anyone whose ONLY entity is the demo — only turn
  // it off once you have another entity to work in.
  const demoActive = process.env.SEED_SAMPLE_DATA === "true"
  await db
    .update(tenantSettings)
    .set({ status: demoActive ? "active" : "suspended" })
    .where(eq(tenantSettings.organizationId, TENANT_ID))

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
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, TENANT_ID), eq(pipelines.name, "Sales Pipeline")))
    .limit(1)
  if (!funnel) {
    ;[funnel] = await db
      .insert(pipelines)
      .values({ tenantId: TENANT_ID, name: "Sales Pipeline", isDefault: true, isActive: true })
      .returning()
  }
  // Entry requirements matching the ACTIVE Salesforce validation rules only
  // (Sales_Stage_to_3B and Sales_Stage_to_Closed_Won are "Not Checked" —
  // inactive — in the live org, so they stay unrequired here too).
  const STAGE_REQUIRED_FIELDS: Partial<Record<string, string[]>> = {
    "0e": ["vision"],
    "1d": [
      "vision",
      "objective",
      "ownerBudgetLimit",
      "oppEstimatedBudget",
      "oppEstimatedCloseDate",
      "ownerContact",
    ],
    "4a": [
      "vision",
      "objective",
      "ownerBudgetLimit",
      "oppEstimatedBudget",
      "oppEstimatedCloseDate",
      "ownerContact",
      "value",
      "procurementStage",
      "powerSponsorContact",
      "powerSponsorBudgetLimit",
      "negotiationDone",
      "negotiationDate",
      "expectedInvoice",
    ],
  }
  const existingStages = await db
    .select({ id: pipelineStages.id, code: pipelineStages.code, requiredFields: pipelineStages.requiredFields })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, funnel.id))
  if (existingStages.length === 0) {
    await db.insert(pipelineStages).values(
      CANONICAL_STAGES.map((s) => ({
        tenantId: TENANT_ID,
        pipelineId: funnel.id,
        code: s.code,
        name: s.name,
        probability: String(s.probability),
        kind: s.kind,
        sortOrder: s.sortOrder,
        requiresApprovalToEnter: s.requiresApprovalToEnter,
        includeInForecast: s.includeInForecast,
        requiredFields: STAGE_REQUIRED_FIELDS[s.code] ?? [],
      }))
    )
  } else {
    // Backfill only — stages seeded before this field existed are stuck at
    // its column default ([]), silently disabling the gate. Never touch a
    // stage whose requiredFields is non-empty: that's a tenant customization
    // made in Settings, and re-running seed must not clobber it.
    for (const stage of existingStages) {
      const defaults = STAGE_REQUIRED_FIELDS[stage.code]
      if (defaults && (stage.requiredFields?.length ?? 0) === 0) {
        await db
          .update(pipelineStages)
          .set({ requiredFields: defaults })
          .where(eq(pipelineStages.id, stage.id))
      }
    }
  }

  // 6. default tax setting
  const [tax] = await db
    .select({ id: taxSettings.id })
    .from(taxSettings)
    .where(and(eq(taxSettings.tenantId, TENANT_ID), eq(taxSettings.name, DEMO_TAX_NAME)))
    .limit(1)
  if (!tax) {
    const [existingDefault] = await db
      .select({ id: taxSettings.id })
      .from(taxSettings)
      .where(and(eq(taxSettings.tenantId, TENANT_ID), eq(taxSettings.isDefault, true)))
      .limit(1)
    await db.insert(taxSettings).values({
      tenantId: TENANT_ID,
      name: DEMO_TAX_NAME,
      ratePercent: DEMO_TAX_RATE,
      // Preserve an existing tenant default (for example SST 6% in an
      // established production tenant); the seed must remain idempotent.
      isDefault: !existingDefault,
      isActive: true,
    })
  }

  // 7. platform master (email/password) — the single break-glass operator for
  // tenant, licensing and subscription administration. Exactly ONE superadmin
  // ever exists (DB enforces this via a partial unique index).
  const email = (
    process.env.PLATFORM_MASTER_EMAIL ??
    process.env.DEMO_ADMIN_EMAIL ??
    "admin@demo.local"
  ).trim().toLowerCase()
  const DEFAULT_DEMO_PASSWORD = "Password123!"
  // In production a real password is mandatory — never mint a default-credentials
  // superadmin on an internet-exposed deployment.
  if (process.env.NODE_ENV === "production") {
    const provided = process.env.PLATFORM_MASTER_PASSWORD ?? process.env.DEMO_ADMIN_PASSWORD
    if (!process.env.PLATFORM_MASTER_EMAIL || !provided || provided === DEFAULT_DEMO_PASSWORD) {
      throw new Error(
        "PLATFORM_MASTER_EMAIL and PLATFORM_MASTER_PASSWORD must be set to non-default " +
          "values in production (refusing to seed a public default superadmin)."
      )
    }
  }
  const password =
    process.env.PLATFORM_MASTER_PASSWORD ??
    process.env.DEMO_ADMIN_PASSWORD ??
    DEFAULT_DEMO_PASSWORD
  const [existingMaster] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.isSuperadmin, true))
    .limit(1)
  if (existingMaster && existingMaster.email.toLowerCase() !== email) {
    throw new Error(
      `A platform master already exists (${existingMaster.email}); refusing to create or reassign another superadmin.`
    )
  }
  let [u] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (u && !u.isSuperadmin) {
    await db.update(user).set({ isSuperadmin: true, updatedAt: new Date() }).where(eq(user.id, u.id))
    ;[u] = await db.select().from(user).where(eq(user.id, u.id)).limit(1)
  }
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
    const ownerRoleId = roleId.get("Owner")
    if (ownerRoleId) {
      await db.insert(memberRoles).values({
        tenantId: TENANT_ID,
        memberId: mid,
        roleId: ownerRoleId,
      })
    }
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
