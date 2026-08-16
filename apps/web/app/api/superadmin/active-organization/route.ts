import { headers } from "next/headers"
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { organization, user } from "@/db/schema"
import { SUPERADMIN_TENANT_COOKIE } from "@/lib/superadmin-tenant-access"

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const [platformUser] = await db
    .select({ isSuperadmin: user.isSuperadmin })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)
  if (!platformUser?.isSuperadmin) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    organizationId?: unknown
  } | null
  const organizationId =
    typeof body?.organizationId === "string" ? body.organizationId.trim() : ""
  if (!organizationId) {
    return NextResponse.json({ error: "ORGANIZATION_REQUIRED" }, { status: 400 })
  }

  const [target] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.id, organizationId), eq(organization.status, "active")))
    .limit(1)
  if (!target) {
    return NextResponse.json({ error: "ORGANIZATION_NOT_FOUND" }, { status: 404 })
  }

  const response = NextResponse.json({ organizationId: target.id })
  response.cookies.set({
    name: SUPERADMIN_TENANT_COOKIE,
    value: target.id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
  return response
}
