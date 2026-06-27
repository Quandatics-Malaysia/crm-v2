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
  StampIcon,
  FileTextIcon,
  FolderKanbanIcon,
  ReceiptIcon,
  TrendingUpIcon,
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

type NavItem = {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  permission?: string
}

type NavSection = { label: string | null; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon }],
  },
  {
    label: "CRM",
    items: [
      { title: "Leads", url: "/leads", icon: TargetIcon, permission: PERMISSIONS.LEAD_VIEW },
      { title: "Accounts", url: "/accounts", icon: Building2Icon, permission: PERMISSIONS.ACCOUNT_VIEW },
      { title: "Contacts", url: "/persons", icon: UsersIcon, permission: PERMISSIONS.PERSON_VIEW },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Funnel", url: "/funnel", icon: FilterIcon, permission: PERMISSIONS.OPPORTUNITY_VIEW },
      { title: "Quotations", url: "/quotations", icon: FileTextIcon, permission: PERMISSIONS.QUOTATION_VIEW },
      { title: "Projects", url: "/projects", icon: FolderKanbanIcon, permission: PERMISSIONS.PROJECT_VIEW },
      { title: "Sales Orders", url: "/sales-orders", icon: ReceiptIcon, permission: PERMISSIONS.SALES_ORDER_VIEW },
      { title: "Approvals", url: "/approvals", icon: StampIcon, permission: PERMISSIONS.STAGE_ADVANCE },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Forecast", url: "/forecast", icon: TrendingUpIcon, permission: PERMISSIONS.FORECAST_VIEW },
      { title: "Audit", url: "/audit", icon: ScrollTextIcon, permission: PERMISSIONS.AUDIT_VIEW },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Team & roles", url: "/team", icon: ShieldCheckIcon, permission: PERMISSIONS.TENANT_MANAGE_USERS },
      { title: "Settings", url: "/settings", icon: Settings2Icon, permission: PERMISSIONS.TENANT_SETTINGS },
    ],
  },
]

export type SidebarUser = { name: string; email: string }
export type SidebarTenant = { id: string; name: string }

export function AppSidebar({
  user,
  activeTenant,
  tenants,
  permissions,
  ...props
}: {
  user: SidebarUser
  activeTenant: SidebarTenant | null
  tenants: SidebarTenant[]
  permissions: string[]
} & React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const perms = React.useMemo(() => new Set(permissions), [permissions])
  const [createOpen, setCreateOpen] = React.useState(false)

  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || perms.has(i.permission)),
  })).filter((s) => s.items.length > 0)

  async function switchTenant(id: string) {
    if (id === activeTenant?.id) return
    await authClient.organization.setActive({ organizationId: id })
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
                    className="data-[state=open]:bg-sidebar-accent"
                  />
                }
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
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
                        render={<Link href={item.url} />}
                      >
                        <item.icon className="size-4" />
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
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
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
