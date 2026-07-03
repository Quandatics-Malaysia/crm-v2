import type { CSSProperties } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { HeaderActionsProvider } from "@/components/command-palette"
import { getServerContext } from "@/lib/server-context"
import { ensureBootstrap } from "@/lib/bootstrap"
import { db, runInTenant } from "@/db"
import { member, organization, tenantSettings } from "@/db/schema"
import { FINANCE_MODULE } from "@/lib/modules"

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
        <h1 className="text-lg font-semibold">No organization access yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account isn&apos;t a member of any organization. Ask an
          administrator to invite you, then sign in again.
        </p>
      </div>
    )
  }

  const activeTenant =
    tenants.find((t) => t.id === ctx.tenantId) ?? tenants[0] ?? null

  // Add-on module gates for the nav: the code-level master switch
  // (lib/modules.ts) AND the tenant's backend flag must both be on.
  const modules =
    FINANCE_MODULE && activeTenant
      ? await runInTenant(activeTenant.id, async (tx) => {
          const [s] = await tx
            .select({ finance: tenantSettings.financeModule })
            .from(tenantSettings)
            .where(eq(tenantSettings.organizationId, activeTenant.id))
            .limit(1)
          return { finance: s?.finance ?? false }
        })
      : { finance: false }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 text-sm font-medium shadow ring-2 ring-ring focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <AppSidebar
        user={{ name: ctx.userName, email: ctx.userEmail }}
        activeTenant={activeTenant}
        tenants={tenants}
        permissions={[...ctx.permissions]}
        modules={modules}
      />
      <SidebarInset id="main-content">
        <HeaderActionsProvider permissions={[...ctx.permissions]}>
          {children}
        </HeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}
