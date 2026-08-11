import { drizzle } from "drizzle-orm/d1"

import * as schema from "./schema"

export function createControlDatabase(database: D1Database) {
  return drizzle(database, { schema })
}

export async function verifyControlDatabase(database: D1Database): Promise<boolean> {
  const result = await database.prepare("SELECT 1 AS ok").first<{ ok: number }>()

  return result?.ok === 1
}
