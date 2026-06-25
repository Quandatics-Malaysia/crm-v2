import type { CSSProperties } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { getServerContext } from "@/lib/server-context"
import { ensureBootstrap } from "@/lib/bootstrap"
import { db } from "@/db"
import { member, organization } from "@/db/schema"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getServerContext()
  if (!ctx) redirect("/sign-in")

  async function loadTenants(userId: string) {
    return db
      .select({ id: organization.id, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId))
  }

  let tenants = await loadTenants(ctx.userId)
  if (tenants.length === 0) {
    const provisioned = await ensureBootstrap(ctx.userId, ctx.userEmail)
    if (provisioned) tenants = await loadTenants(ctx.userId)
  }

  if (tenants.length === 0) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">No entity access yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account isn&apos;t a member of any entity. Ask an administrator to
          invite you, then sign in again.
        </p>
      </div>
    )
  }

  const activeTenant =
    tenants.find((t) => t.id === ctx.tenantId) ?? tenants[0] ?? null

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar
        user={{ name: ctx.userName, email: ctx.userEmail }}
        activeTenant={activeTenant}
        tenants={tenants}
        permissions={[...ctx.permissions]}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
