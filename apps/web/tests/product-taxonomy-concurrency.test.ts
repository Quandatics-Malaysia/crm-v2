import { drizzle } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Tx } from "@/db"
import { PERMISSIONS } from "@/lib/permissions"
import { lockProductTaxonomy } from "@/server/services/product-taxonomy-lock"

function queryChain(rows: unknown[]) {
  const result = Promise.resolve(rows)
  const query: Record<string, unknown> = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    for: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: result.then.bind(result),
  }
  return query
}

describe("product taxonomy mutation boundary", () => {
  it("locks the authenticated tenant row for update", async () => {
    const query = queryChain([{ id: "tenant-1" }])
    const tx = {
      select: vi.fn(() => query),
    } as unknown as Tx

    await lockProductTaxonomy(tx, "tenant-1")

    expect(query.for).toHaveBeenCalledWith("update")
  })
})

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const integration = adminUrl ? describe.sequential : describe.skip
const actionDatabaseUrl = process.env.TEST_DATABASE_URL
const actionIntegration = adminUrl && actionDatabaseUrl ? describe.sequential : describe.skip
let actionUserId = ""
let actionMemberId = ""
let actionSession: {
  user: { id: string; name: string; email: string }
  session: { activeOrganizationId: string }
} | null = null

type GlobalDb = typeof globalThis & { __pgClient?: Sql }

type ActionRepository<T> = {
  value: T
  client: Sql
  close: () => Promise<void>
}

async function openActionRepository<T>(
  databaseUrl: string,
  load: () => Promise<T>,
): Promise<ActionRepository<T>> {
  const globalForDb = globalThis as GlobalDb
  const previousClient = globalForDb.__pgClient
  const previousDatabaseUrl = process.env.DATABASE_URL
  let actionClient: Sql | undefined

  process.env.DATABASE_URL = databaseUrl
  delete globalForDb.__pgClient

  const restore = () => {
    if (previousClient === undefined) delete globalForDb.__pgClient
    else globalForDb.__pgClient = previousClient
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }

  try {
    const value = await load()
    actionClient = globalForDb.__pgClient
    if (!actionClient) throw new Error("Action repository did not create a database client")
    restore()

    return {
      value,
      client: actionClient,
      close: async () => closeClient(actionClient),
    }
  } catch (error) {
    actionClient = globalForDb.__pgClient
    restore()
    if (actionClient && actionClient !== previousClient) await closeClient(actionClient)
    throw error
  }
}

describe("taxonomy action repository isolation", () => {
  it("restores the exact prior env and shared client without closing it", async () => {
    const globalForDb = globalThis as GlobalDb
    const priorClient = { end: vi.fn() } as unknown as Sql
    const actionClient = { end: vi.fn().mockResolvedValue(undefined) } as unknown as Sql
    const priorDatabaseUrl = process.env.DATABASE_URL
    const priorGlobalClient = globalForDb.__pgClient

    globalForDb.__pgClient = priorClient
    process.env.DATABASE_URL = "postgres://shared-client.example/crm"

    try {
      const repository = await openActionRepository(
        "postgres://isolated-action.example/crm",
        async () => {
          globalForDb.__pgClient = actionClient
          return "loaded"
        },
      )

      expect(repository.value).toBe("loaded")
      expect(globalForDb.__pgClient).toBe(priorClient)
      expect(process.env.DATABASE_URL).toBe("postgres://shared-client.example/crm")
      expect(priorClient.end).not.toHaveBeenCalled()

      await repository.close()

      expect(actionClient.end).toHaveBeenCalledOnce()
      expect(globalForDb.__pgClient).toBe(priorClient)
      expect(process.env.DATABASE_URL).toBe("postgres://shared-client.example/crm")
    } finally {
      if (priorGlobalClient === undefined) delete globalForDb.__pgClient
      else globalForDb.__pgClient = priorGlobalClient
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
    }
  })
})

async function closeClient(client: Sql | undefined): Promise<void> {
  if (!client) return
  try {
    await client.end({ timeout: 5 })
  } catch {
    // A prior serial suite may already have closed its cached client.
  }
}

vi.doMock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => actionSession),
      setActiveOrganization: vi.fn(),
    },
  },
}))

vi.doMock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
  headers: vi.fn(async () => new Headers()),
}))

vi.doMock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({ finance: false })),
  requireEntitledModule: vi.fn(async () => undefined),
  withEntitledModule: vi.fn(async (_moduleId: string, work: () => unknown) => work()),
}))

vi.doMock("@/lib/action-result", () => ({
  runAction: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      }
    }
  },
}))

vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }))

integration("product taxonomy lock concurrency", () => {
  const tenantId = `task7-lock-${process.pid}`
  const sql = adminUrl ? postgres(adminUrl, { max: 2 }) : null
  const db = sql ? drizzle(sql) : null

  afterAll(async () => {
    if (sql) await sql.end()
  })

  it("blocks a concurrent taxonomy operation until the first operation commits", async () => {
    if (!db || !sql) throw new Error("TEST_DATABASE_ADMIN_URL is required")

    await sql`
      INSERT INTO organization (id, name, slug)
      VALUES (${tenantId}, ${tenantId}, ${tenantId})
      ON CONFLICT (id) DO NOTHING
    `

    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstLocked!: () => void
    const firstLockedPromise = new Promise<void>((resolve) => {
      firstLocked = resolve
    })
    let secondLocked!: () => void
    const secondLockedPromise = new Promise<void>((resolve) => {
      secondLocked = resolve
    })

    const first = db.transaction(async (tx) => {
      await lockProductTaxonomy(tx as unknown as Tx, tenantId)
      firstLocked()
      await firstHeld
    })
    await Promise.race([firstLockedPromise, first.then(() => undefined)])

    const second = db.transaction(async (tx) => {
      await lockProductTaxonomy(tx as unknown as Tx, tenantId)
      secondLocked()
    })

    const secondPassedBeforeCommit = await Promise.race([
      secondLockedPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    expect(secondPassedBeforeCommit).toBe(false)

    releaseFirst()
    await first
    await second
    await secondLockedPromise

    await sql`DELETE FROM organization WHERE id = ${tenantId}`
  }, 30_000)
})

actionIntegration("production product taxonomy mutation boundaries", () => {
  const prefix = `task7-action-${process.pid}-${crypto.randomUUID().slice(0, 8)}`
  let admin: Sql
  let adminDb: ReturnType<typeof drizzle>
  let actionRepository: ActionRepository<{
    updateProductCodes: typeof import("@/app/(app)/settings/actions").updateProductCodes
    createProduct: typeof import("@/app/(app)/products/actions").createProduct
    updateProduct: typeof import("@/app/(app)/products/actions").updateProduct
  }> | undefined
  let updateProductCodes: typeof import("@/app/(app)/settings/actions").updateProductCodes
  let createProduct: typeof import("@/app/(app)/products/actions").createProduct
  let updateProduct: typeof import("@/app/(app)/products/actions").updateProduct

  const taxonomy = [
    {
      code: "PS",
      name: "Professional Services",
      subcategories: [{ code: "DATA", name: "Data Analytics" }],
    },
  ]
  const distinctTaxonomy = [
    {
      code: "CONSULTING",
      name: "Consulting",
      subcategories: [{ code: "ADVISORY", name: "Advisory" }],
    },
  ]
  const withoutSubcategory = [
    { code: "PS", name: "Professional Services", subcategories: [] },
  ]

  beforeAll(async () => {
    if (!adminUrl || !actionDatabaseUrl) {
      throw new Error("Production taxonomy boundary tests require both database URLs")
    }

    admin = postgres(adminUrl, { max: 4 })
    adminDb = drizzle(admin)
    actionRepository = await openActionRepository(actionDatabaseUrl, async () => {
      vi.resetModules()
      const settingsActions = await import("@/app/(app)/settings/actions")
      const productActions = await import("@/app/(app)/products/actions")
      return {
        updateProductCodes: settingsActions.updateProductCodes,
        createProduct: productActions.createProduct,
        updateProduct: productActions.updateProduct,
      }
    })
    updateProductCodes = actionRepository.value.updateProductCodes
    createProduct = actionRepository.value.createProduct
    updateProduct = actionRepository.value.updateProduct
  })

  afterAll(async () => {
    try {
      if (admin) {
        await admin`delete from organization where id like ${`${prefix}%`}`
        await admin`delete from "user" where id like ${`${prefix}%`}`
      }
    } finally {
      await actionRepository?.close()
      await admin?.end()
      actionUserId = ""
      actionMemberId = ""
      actionSession = null
      vi.resetModules()
    }
  })

  async function createTenant(withProduct = false) {
    const tenantId = `${prefix}-${crypto.randomUUID()}`
    const productId = crypto.randomUUID()
    const userId = `${prefix}-user-${crypto.randomUUID()}`
    const memberId = `${prefix}-member-${crypto.randomUUID()}`
    const roleId = crypto.randomUUID()
    await admin`
      insert into organization (id, name, slug)
      values (${tenantId}, ${tenantId}, ${tenantId})
    `
    await admin`
      insert into "user" (id, name, email, email_verified, is_superadmin, is_vendor_support)
      values (${userId}, 'Taxonomy test actor', ${`${userId}@example.com`}, true, false, false)
    `
    await admin`
      insert into member (id, organization_id, user_id, role)
      values (${memberId}, ${tenantId}, ${userId}, 'member')
    `
    await admin`
      insert into roles (id, tenant_id, name, description, is_system, default_tier_level)
      values (${roleId}::uuid, ${tenantId}, 'Task 7 Taxonomy Operator', 'Least-privilege taxonomy test role', false, 20)
    `
    const requiredPermissions = [
      PERMISSIONS.TENANT_SETTINGS,
      PERMISSIONS.PRODUCT_CREATE,
      PERMISSIONS.PRODUCT_UPDATE,
    ]
    const permissionRows = await admin`
      select id, key from permissions where key = any(${requiredPermissions})
    `
    expect(new Set(permissionRows.map((row) => row.key))).toEqual(
      new Set(requiredPermissions)
    )
    for (const permission of permissionRows) {
      await admin`
        insert into role_permissions (tenant_id, role_id, permission_id)
        values (${tenantId}, ${roleId}::uuid, ${permission.id}::uuid)
      `
    }
    await admin`
      insert into membership_profiles (member_id, tenant_id, role_id, tier_level, status)
      values (${memberId}, ${tenantId}, ${roleId}::uuid, 20, 'active')
    `
    await admin`
      insert into member_roles (tenant_id, member_id, role_id)
      values (${tenantId}, ${memberId}, ${roleId}::uuid)
    `
    await admin`
      insert into tenant_settings (organization_id, product_codes)
      values (${tenantId}, ${JSON.stringify(taxonomy)}::jsonb)
    `
    if (withProduct) {
      await admin`
        insert into products (id, tenant_id, name, product_code, subcategory, currency, standard_price)
        values (${productId}::uuid, ${tenantId}, 'Analytics', 'PS', 'DATA', 'MYR', '20.00')
      `
    }
    actionUserId = userId
    actionMemberId = memberId
    actionSession = {
      user: {
        id: userId,
        name: "Taxonomy test actor",
        email: `${userId}@example.com`,
      },
      session: { activeOrganizationId: tenantId },
    }
    return { tenantId, productId }
  }

  async function withHeldTaxonomyLock<T>(tenantId: string, operation: () => Promise<T>) {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const lockedPromise = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holder = adminDb.transaction(async (tx) => {
      await lockProductTaxonomy(tx as unknown as Tx, tenantId)
      locked()
      await released
    })
    await Promise.race([lockedPromise, holder.then(() => undefined)])

    const pending = operation()
    const passedBeforeRelease = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
    ])
    expect(passedBeforeRelease).toBe(false)

    release()
    await holder
    return pending
  }

  async function expectAudit(input: {
    tenantId: string
    action: string
    entityType: string
    entityId: string
  }) {
    const [row] = await admin<{
      actor_user_id: string | null
      actor_member_id: string | null
      action: string
      entity_type: string
      entity_id: string
    }[]>`
      select actor_user_id, actor_member_id, action, entity_type, entity_id
      from audit_log
      where tenant_id = ${input.tenantId}
      order by created_at desc, id desc
      limit 1
    `
    expect(row).toEqual({
      actor_user_id: actionUserId,
      actor_member_id: actionMemberId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
    })
  }

  const lockCases: Array<[
    string,
    (tenantId: string, productId: string) => Promise<unknown>,
  ]> = [
    ["updateProductCodes", async (_tenantId: string, _productId?: string) => updateProductCodes(withoutSubcategory)],
    ["createProduct", async (_tenantId: string, _productId?: string) => createProduct({
      name: "New analytics",
      productCode: "PS",
      subcategory: "DATA",
      currency: "MYR",
      standardPrice: "10",
    })],
    ["updateProduct", async (_tenantId: string, productId: string) => updateProduct(productId, {
      name: "Updated analytics",
      productCode: "PS",
      subcategory: "DATA",
      currency: "MYR",
      standardPrice: "25",
    })],
  ]

  it.each(lockCases)("%s waits for the shared taxonomy lock", async (name, operation) => {
    const fixture = await createTenant(name === "updateProduct")
    try {
      const result = await withHeldTaxonomyLock(
        fixture.tenantId,
        () => operation(fixture.tenantId, fixture.productId)
      )
      const actionResult = result as { ok: boolean; data?: { id?: string } }
      expect(actionResult.ok).toBe(true)
      if (name === "updateProductCodes") {
        await expectAudit({
          tenantId: fixture.tenantId,
          action: "settings.product_codes_updated",
          entityType: "tenant_settings",
          entityId: fixture.tenantId,
        })
      } else {
        await expectAudit({
          tenantId: fixture.tenantId,
          action: name === "createProduct" ? "product.created" : "product.updated",
          entityType: "product",
          entityId: actionResult.data?.id ?? fixture.productId,
        })
      }
    } finally {
      await admin`delete from organization where id = ${fixture.tenantId}`
    }
  })

  it("denies taxonomy settings mutation when member lacks its real permission", async () => {
    const fixture = await createTenant()
    try {
      await admin`
        delete from role_permissions
        where tenant_id = ${fixture.tenantId}
          and permission_id = (select id from permissions where key = ${PERMISSIONS.TENANT_SETTINGS})
      `

      const [beforeSettings] = await admin<{
        product_codes: typeof taxonomy
        product_codes_bytes: string
      }[]>`
        select
          product_codes,
          encode(convert_to(product_codes::text, 'UTF8'), 'hex') as product_codes_bytes
        from tenant_settings
        where organization_id = ${fixture.tenantId}
      `

      const result = await updateProductCodes(distinctTaxonomy)

      expect(result).toMatchObject({ ok: false })
      expect(result).toMatchObject({ error: `FORBIDDEN: missing ${PERMISSIONS.TENANT_SETTINGS}` })
      const [afterSettings] = await admin<{
        product_codes: typeof taxonomy
        product_codes_bytes: string
      }[]>`
        select
          product_codes,
          encode(convert_to(product_codes::text, 'UTF8'), 'hex') as product_codes_bytes
        from tenant_settings
        where organization_id = ${fixture.tenantId}
      `
      expect(afterSettings).toEqual(beforeSettings)
      const auditRows = await admin`
        select id from audit_log where tenant_id = ${fixture.tenantId}
      `
      expect(auditRows).toHaveLength(0)
    } finally {
      await admin`delete from organization where id = ${fixture.tenantId}`
    }
  })

  it.each([
    ["createProduct", async (_productId: string) => createProduct({
      name: "Concurrent analytics",
      productCode: "PS",
      subcategory: "DATA",
      currency: "MYR",
      standardPrice: "15",
    })],
    ["updateProduct", async (productId: string) => updateProduct(productId, {
      name: "Concurrent update",
      productCode: "PS",
      subcategory: "DATA",
      currency: "MYR",
      standardPrice: "30",
    })],
  ] as const)("removal races safely with production %s", async (name, mutation) => {
    const fixture = await createTenant(name === "updateProduct")
    try {
      await withHeldTaxonomyLock(fixture.tenantId, async () => {
        const [removal, productMutation] = await Promise.all([
          updateProductCodes(withoutSubcategory),
          mutation(fixture.productId),
        ])
        expect(removal.ok || productMutation.ok).toBe(true)
      })

      const rows = await admin<{ product_code: string | null; subcategory: string | null }[]>`
        select product_code, subcategory from products
        where tenant_id = ${fixture.tenantId} and deleted_at is null
      `
      const [settings] = await admin<{ product_codes: typeof taxonomy }[]>`
        select product_codes from tenant_settings where organization_id = ${fixture.tenantId}
      `
      const validPairs = new Set(
        settings.product_codes.flatMap((category) =>
          category.subcategories.map((subcategory) => `${category.code}:${subcategory.code}`)
        )
      )
      expect(rows.filter((row) => row.product_code && row.subcategory)
        .map((row) => `${row.product_code}:${row.subcategory}`)
        .every((pair) => validPairs.has(pair))).toBe(true)
    } finally {
      await admin`delete from organization where id = ${fixture.tenantId}`
    }
  })
})
