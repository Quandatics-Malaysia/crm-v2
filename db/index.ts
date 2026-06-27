import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { sql } from "drizzle-orm"
import * as schema from "./schema"
import { env, isProd } from "@/lib/env"

// Reuse a single postgres pool across Next.js dev HMR reloads. Without this, each
// hot reload re-evaluates this module and opens a fresh pool (max: 10) while the
// old ones linger, quickly exhausting Postgres `max_connections`. In production
// the module is evaluated once, so the global cache is a harmless no-op.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>
}

const client = globalForDb.__pgClient ?? postgres(env.DATABASE_URL, { max: 10 })
if (!isProd) globalForDb.__pgClient = client

export const db = drizzle(client, { schema })

export type Schema = typeof schema
export type AppDB = PostgresJsDatabase<Schema>
export type Tx = Parameters<Parameters<AppDB["transaction"]>[0]>[0]

/**
 * Run `fn` inside a transaction scoped to `tenantId`. Sets the
 * `app.current_tenant` GUC (transaction-local) that every RLS policy reads,
 * so any query inside is automatically constrained to the tenant — even if a
 * `WHERE tenant_id = …` is forgotten. This is the primary data-access path for
 * all tenant-owned tables.
 */
export async function runInTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_tenant', ${tenantId}, true)`
    )
    return fn(tx)
  })
}

export { schema }
