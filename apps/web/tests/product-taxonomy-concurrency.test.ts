import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

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
