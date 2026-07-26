import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { db } from "@/db"
import { corsHeaders, preflight } from "@/lib/api-cors"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    await db.execute(sql`select 1`)
    return NextResponse.json({ status: "ok" }, { headers: corsHeaders(req) })
  } catch {
    return NextResponse.json(
      { status: "degraded" },
      { status: 503, headers: corsHeaders(req) }
    )
  }
}

export const OPTIONS = (req: Request) => preflight(req)
