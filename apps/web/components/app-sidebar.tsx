"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboardIcon,
  TargetIcon,
  Building2Icon,
  UsersIcon,
  FilterIcon,
  BriefcaseIcon,
  StampIcon,
  FileTextIcon,
  FolderKanbanIcon,
  PackageIcon,
  ReceiptIcon,
  CreditCardIcon,
  TrendingUpIcon,
  ArrowLeftRightIcon,
  FileStackIcon,
  ShoppingCartIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  Settings2Icon,
  ChevronsUpDownIcon,
  LogOutIcon,
  CheckIcon,
  BuildingIcon,
  PlusIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { CreateEntityDialog } from "@/components/create-entity-dialog"
import { authClient } from "@/lib/auth-client"
import { PERMISSIONS } from "@/lib/permissions"
import type { ModuleId } from "@/lib/modules"
import { cn } from "@/lib/utils"

type NavItem = {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  /** Salesforce-style object tile colour (Tailwind bg-* class). */
  tile: string
  permission?: string
  /** Optional plugin gate (modules.config.ts), on top of permission. */
  module?: ModuleId
}

type NavSection = { label: string | null; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon, tile: "bg-blue-500" }],
  },
  {
    label: "CRM",
    items: [
      { title: "Leads", url: "/leads", icon: TargetIcon, tile: "bg-teal-500", permission: PERMISSIONS.LEAD_VIEW },
      { title: "Accounts", url: "/accounts", icon: Building2Icon, tile: "bg-orange-500", permission: PERMISSIONS.ACCOUNT_VIEW },
      { title: "Contacts", url: "/persons", icon: UsersIcon, tile: "bg-violet-500", permission: PERMISSIONS.PERSON_VIEW },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Opportunities", url: "/opportunities", icon: BriefcaseIcon, tile: "bg-amber-600", permission: PERMISSIONS.OPPORTUNITY_VIEW },
      { title: "Funnel", url: "/funnel", icon: FilterIcon, tile: "bg-amber-500", permission: PERMISSIONS.OPPORTUNITY_VIEW },
      { title: "Quotations", url: "/quotations", icon: FileTextIcon, tile: "bg-green-600", permission: PERMISSIONS.QUOTATION_VIEW },
      { title: "Products", url: "/products", icon: PackageIcon, tile: "bg-sky-500", permission: PERMISSIONS.PRODUCT_VIEW },
      { title: "Payment Milestones", url: "/payment-milestones", icon: CreditCardIcon, tile: "bg-yellow-600", permission: PERMISSIONS.PAYMENT_MILESTONE_VIEW },
      { title: "Projects", url: "/projects", icon: FolderKanbanIcon, tile: "bg-indigo-500", permission: PERMISSIONS.PROJECT_VIEW, module: "projects" },
      { title: "Sales Orders", url: "/sales-orders", icon: ReceiptIcon, tile: "bg-pink-600", permission: PERMISSIONS.SALES_ORDER_VIEW, module: "salesOrders" },
      { title: "Approvals", url: "/approvals", icon: StampIcon, tile: "bg-rose-500", permission: PERMISSIONS.STAGE_ADVANCE },
    ],
  },
  {
    // O2C + P2P document chains — an add-on, shown only when the tenant's
    // finance_module backend flag is on.
    label: "Finance",
    items: [
      { title: "Billing", url: "/billing", icon: FileStackIcon, tile: "bg-lime-600", permission: PERMISSIONS.FINANCE_VIEW, module: "finance" },
      { title: "Purchasing", url: "/purchasing", icon: ShoppingCartIcon, tile: "bg-yellow-600", permission: PERMISSIONS.FINANCE_VIEW, module: "finance" },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Forecast", url: "/forecast", icon: TrendingUpIcon, tile: "bg-emerald-500", permission: PERMISSIONS.FORECAST_VIEW, module: "forecast" },
      { title: "Intercompany", url: "/intercompany", icon: ArrowLeftRightIcon, tile: "bg-fuchsia-600", permission: PERMISSIONS.INTERCOMPANY_VIEW, module: "finance" },
      { title: "Audit", url: "/audit", icon: ScrollTextIcon, tile: "bg-slate-500", permission: PERMISSIONS.AUDIT_VIEW, module: "audit" },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Team & roles", url: "/team", icon: ShieldCheckIcon, tile: "bg-cyan-600", permission: PERMISSIONS.TENANT_MANAGE_USERS },
      { title: "Settings", url: "/settings/general", icon: Settings2Icon, tile: "bg-gray-500", permission: PERMISSIONS.TENANT_SETTINGS },
    ],
  },
  // /documentation is deliberately NOT in the nav — internal docs, reached by
  // URL only (docs.view holders; hidden from end users).
]

export type SidebarUser = { name: string; email: string }
export type SidebarTenant = { id: string; name: string }

export function AppSidebar({
  user,
  activeTenant,
  tenants,
  permissions,
  modules = {},
  ...props
}: {
  user: SidebarUser
  activeTenant: SidebarTenant | null
  tenants: SidebarTenant[]
  permissions: string[]
  /** Enabled plugins (from modules.config.ts, computed in the layout). */
  modules?: Partial<Record<ModuleId, boolean>>
} & React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const perms = React.useMemo(() => new Set(permissions), [permissions])
  const [createOpen, setCreateOpen] = React.useState(false)

  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter(
      (i) =>
        (!i.permission || perms.has(i.permission)) &&
        (!i.module || modules[i.module])
    ),
  })).filter((s) => s.items.length > 0)

  async function switchTenant(id: string) {
    if (id === activeTenant?.id) return
    await authClient.organization.setActive({ organizationId: id })
    // Land on the dashboard rather than refreshing the current URL: a record
    // deep-link (e.g. /projects/<id>) belongs to the previous tenant and would
    // 404 under the newly-active one. push() re-renders the layout with the new
    // tenant; refresh() re-fetches server data for the destination.
    router.push("/dashboard")
    router.refresh()
  }

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
  }

  const initials = (user.name || user.email).slice(0, 2).toUpperCase()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="rounded-[8px] border border-transparent hover:border-sidebar-border data-[state=open]:border-sidebar-border data-[state=open]:bg-sidebar-accent"
                  />
                }
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-[8px] bg-sidebar-primary text-sidebar-primary-foreground">
                  <BuildingIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {activeTenant?.name ?? "Select organization"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    CRM
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Organizations
                  </DropdownMenuLabel>
                  {tenants.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onClick={() => switchTenant(t.id)}
                    >
                      <BuildingIcon className="size-4" />
                      <span className="flex-1 truncate">{t.name}</span>
                      {t.id === activeTenant?.id ? (
                        <CheckIcon className="size-4" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                  <PlusIcon className="size-4" />
                  Create organization
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section, idx) => (
          <SidebarGroup key={section.label ?? `s-${idx}`}>
            {section.label ? (
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active =
                    pathname === item.url || pathname.startsWith(item.url + "/")
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.title}
                        render={
                          <Link
                            href={item.url}
                            aria-current={active ? "page" : undefined}
                          />
                        }
                      >
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-[5px] text-white",
                            item.tile
                          )}
                        >
                          <item.icon className="size-3.5" />
                        </span>
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="rounded-[8px] border border-transparent hover:border-sidebar-border data-[state=open]:border-sidebar-border data-[state=open]:bg-sidebar-accent"
                  />
                }
              >
                <Avatar className="size-8 rounded-full border border-sidebar-border">
                  <AvatarFallback className="rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">
                    {user.email}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOutIcon className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <CreateEntityDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Sidebar>
  )
}
