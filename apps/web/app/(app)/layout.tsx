import type { CSSProperties } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { HeaderActionsProvider } from "@/components/command-palette"
import { getServerContext } from "@/lib/server-context"
import { ensureBootstrap } from "@/lib/bootstrap"
import { db } from "@/db"
import { member, organization } from "@/db/schema"
import { MODULE_IDS, isModuleEnabled, type ModuleId } from "@/lib/modules"

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

  // Plugin gates for the nav — read straight from the global config
  // (modules.config.ts). No per-request DB query.
  const modules = Object.fromEntries(
    MODULE_IDS.map((id) => [id, isModuleEnabled(id)])
  ) as Record<ModuleId, boolean>

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
        {process.env.DEMO_MODE === "true" ? (
          <div className="border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
            Interactive demo · All companies, people and transactions are fictional.
          </div>
        ) : null}
        <HeaderActionsProvider permissions={[...ctx.permissions]}>
          {children}
        </HeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}
