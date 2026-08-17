import { drizzle } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Tx } from "@/db"
import { lockProductTaxonomy } from "@/server/services/product-taxonomy-lock"

function transactionDb(connection: unknown): Tx {
  return drizzle(connection as never) as unknown as Tx
}

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
let actionTenantId = ""
let actionUserId = ""
let actionMemberId = ""

type GlobalDb = typeof globalThis & { __pgClient?: Sql }

async function closeClient(client: Sql | undefined): Promise<void> {
  if (!client) return
  try {
    await client.end({ timeout: 5 })
  } catch {
    // A prior serial suite may already have closed its cached client.
  }
}

vi.doMock("@/lib/server-context", () => ({
  requireContext: vi.fn(async () => ({
    userId: actionUserId,
    userName: "Taxonomy test",
    userEmail: "taxonomy-test@example.com",
    isSuperadmin: true,
    tenantId: actionTenantId,
    memberId: actionMemberId,
    tierLevel: 100,
    roleName: "Owner",
    status: "active",
    tenantSuspended: false,
    subscriptionInactive: false,
    permissions: new Set(),
    can: () => true,
  })),
  assertCan: vi.fn(),
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

    const first = sql.begin(async (connection) => {
      await lockProductTaxonomy(transactionDb(connection), tenantId)
      firstLocked()
      await firstHeld
    })
    await firstLockedPromise

    const second = sql.begin(async (connection) => {
      await lockProductTaxonomy(transactionDb(connection), tenantId)
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
  let actionClient: Sql | undefined
  let previousDatabaseUrl: string | undefined
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
  const withoutSubcategory = [
    { code: "PS", name: "Professional Services", subcategories: [] },
  ]

  beforeAll(async () => {
    if (!adminUrl || !actionDatabaseUrl) {
      throw new Error("Production taxonomy boundary tests require both database URLs")
    }

    previousDatabaseUrl = process.env.DATABASE_URL
    const globalForDb = globalThis as GlobalDb
    const previousClient = globalForDb.__pgClient
    delete globalForDb.__pgClient
    await closeClient(previousClient)

    admin = postgres(adminUrl, { max: 4 })
    process.env.DATABASE_URL = actionDatabaseUrl
    vi.resetModules()
    const settingsActions = await import("@/app/(app)/settings/actions")
    const productActions = await import("@/app/(app)/products/actions")
    updateProductCodes = settingsActions.updateProductCodes
    createProduct = productActions.createProduct
    updateProduct = productActions.updateProduct
    actionClient = globalForDb.__pgClient
  })

  afterAll(async () => {
    try {
      if (admin) {
        await admin`delete from organization where id like ${`${prefix}%`}`
        await admin`delete from "user" where id like ${`${prefix}%`}`
      }
    } finally {
      const globalForDb = globalThis as GlobalDb
      const cachedClient = globalForDb.__pgClient
      delete globalForDb.__pgClient
      await closeClient(cachedClient)
      if (actionClient && actionClient !== cachedClient) await closeClient(actionClient)
      await admin?.end()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      actionTenantId = ""
      actionUserId = ""
      actionMemberId = ""
      vi.resetModules()
    }
  })

  async function createTenant(withProduct = false) {
    const tenantId = `${prefix}-${crypto.randomUUID()}`
    const productId = crypto.randomUUID()
    const userId = `${prefix}-user-${crypto.randomUUID()}`
    const memberId = `${prefix}-member-${crypto.randomUUID()}`
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
      insert into membership_profiles (member_id, tenant_id, tier_level, status)
      values (${memberId}, ${tenantId}, 100, 'active')
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
    actionTenantId = tenantId
    actionUserId = userId
    actionMemberId = memberId
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
    const holder = admin.begin(async (connection) => {
      await lockProductTaxonomy(transactionDb(connection), tenantId)
      locked()
      await released
    })
    await lockedPromise

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
      expect(result).toMatchObject({ ok: true })
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
