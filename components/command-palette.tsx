"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  SearchIcon,
  PlusIcon,
  TargetIcon,
  Building2Icon,
  UsersIcon,
  FilterIcon,
  FileTextIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  TrendingUpIcon,
  ArrowLeftRightIcon,
  ShieldCheckIcon,
  Settings2Icon,
  LoaderIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PERMISSIONS } from "@/lib/permissions"
import { isModuleEnabled, type ModuleId } from "@/lib/modules"
import { globalSearch, type SearchHit } from "@/app/(app)/_shared/search-actions"

/**
 * Permissions for the chrome (search + quick-create) are provided once from the
 * (app) layout so the header actions can gate themselves without every page's
 * `SiteHeader` having to thread the permission set through.
 */
const PermissionsContext = React.createContext<Set<string>>(new Set())

/**
 * Client-side permission set provided by {@link HeaderActionsProvider}. Reuse
 * this to gate UI affordances (edit/create/advance buttons) so the chrome and
 * page components share one permission source. Returns a `Set<string>` of
 * permission keys; call `.has(PERMISSIONS.X)` to check.
 */
export function usePermissions() {
  return React.useContext(PermissionsContext)
}

export function HeaderActionsProvider({
  permissions,
  children,
}: {
  permissions: string[]
  children: React.ReactNode
}) {
  const perms = React.useMemo(() => new Set(permissions), [permissions])
  return (
    <PermissionsContext.Provider value={perms}>
      {children}
    </PermissionsContext.Provider>
  )
}

const ICONS: Record<SearchHit["type"], React.ComponentType<{ className?: string }>> = {
  lead: TargetIcon,
  account: Building2Icon,
  contact: UsersIcon,
  opportunity: FilterIcon,
  quotation: FileTextIcon,
  project: FolderKanbanIcon,
}

const QUICK_CREATE: {
  label: string
  href: string
  permission: string
  module?: ModuleId
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { label: "Lead", href: "/leads?new=1", permission: PERMISSIONS.LEAD_CREATE, icon: TargetIcon },
  { label: "Account", href: "/accounts?new=1", permission: PERMISSIONS.ACCOUNT_CREATE, icon: Building2Icon },
  { label: "Contact", href: "/persons?new=1", permission: PERMISSIONS.PERSON_CREATE, icon: UsersIcon },
  { label: "Funnel", href: "/funnel?new=1", permission: PERMISSIONS.OPPORTUNITY_CREATE, icon: FilterIcon },
  { label: "Quotation", href: "/quotations/new", permission: PERMISSIONS.QUOTATION_CREATE, icon: FileTextIcon },
]

/**
 * Static page-navigation targets for the ⌘K palette so it works as a command
 * bar ("go to Leads / Forecast / Settings"), not just record search. Gated by
 * the same view permissions used by the sidebar; entries without a permission
 * (Dashboard) are always shown.
 */
const NAV_ITEMS: {
  label: string
  href: string
  permission?: string
  module?: ModuleId
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { label: "Leads", href: "/leads", permission: PERMISSIONS.LEAD_VIEW, icon: TargetIcon },
  { label: "Accounts", href: "/accounts", permission: PERMISSIONS.ACCOUNT_VIEW, icon: Building2Icon },
  { label: "Contacts", href: "/persons", permission: PERMISSIONS.PERSON_VIEW, icon: UsersIcon },
  { label: "Funnel", href: "/funnel", permission: PERMISSIONS.OPPORTUNITY_VIEW, icon: FilterIcon },
  { label: "Quotations", href: "/quotations", permission: PERMISSIONS.QUOTATION_VIEW, icon: FileTextIcon },
  { label: "Sales orders", href: "/sales-orders", permission: PERMISSIONS.SALES_ORDER_VIEW, module: "salesOrders", icon: ReceiptIcon },
  { label: "Projects", href: "/projects", permission: PERMISSIONS.PROJECT_VIEW, module: "projects", icon: FolderKanbanIcon },
  { label: "Forecast", href: "/forecast", permission: PERMISSIONS.FORECAST_VIEW, module: "forecast", icon: TrendingUpIcon },
  { label: "Intercompany", href: "/intercompany", permission: PERMISSIONS.INTERCOMPANY_VIEW, module: "finance", icon: ArrowLeftRightIcon },
  { label: "Team", href: "/team", permission: PERMISSIONS.TENANT_MANAGE_USERS, icon: ShieldCheckIcon },
  { label: "Settings", href: "/settings", permission: PERMISSIONS.TENANT_SETTINGS, icon: Settings2Icon },
]

/** Search button + ⌘K palette + "+ New" quick-create menu for the site header. */
export function HeaderActions() {
  const perms = React.useContext(PermissionsContext)
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [hits, setHits] = React.useState<SearchHit[]>([])
  const [pending, startTransition] = React.useTransition()
  const reqId = React.useRef(0)

  const createItems = QUICK_CREATE.filter(
    (i) => perms.has(i.permission) && (!i.module || isModuleEnabled(i.module))
  )
  const navItems = React.useMemo(
    () =>
      NAV_ITEMS.filter(
        (i) =>
          (!i.permission || perms.has(i.permission)) &&
          (!i.module || isModuleEnabled(i.module))
      ),
    [perms]
  )

  // Resets the query on close so the next open starts clean.
  function changeOpen(o: boolean) {
    if (!o) {
      setQuery("")
      setHits([])
    }
    setOpen(o)
  }

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        changeOpen(!open)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  function changeQuery(v: string) {
    setQuery(v)
    if (v.trim().length < 2) setHits([])
  }

  React.useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    const id = ++reqId.current
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await globalSearch(q)
        // Ignore out-of-order responses.
        if (id === reqId.current) setHits(res)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  function go(href: string) {
    changeOpen(false)
    router.push(href)
  }

  // Group hits by their group label, preserving insertion order.
  const groups = React.useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of hits) {
      const arr = map.get(h.group)
      if (arr) arr.push(h)
      else map.set(h.group, [h])
    }
    return [...map.entries()]
  }, [hits])

  // Page-navigation entries filter on the typed query (matching their label);
  // with no query we show the whole nav so the palette opens as a command bar.
  const navMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return navItems
    return navItems.filter((i) => i.label.toLowerCase().includes(q))
  }, [navItems, query])

  const showEmpty =
    query.trim().length >= 2 &&
    !pending &&
    hits.length === 0 &&
    navMatches.length === 0

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <SearchIcon className="size-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-2 hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>

      {createItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" aria-label="Create new record">
                <PlusIcon className="size-4" />
                <span className="hidden sm:inline">New</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-44">
            {createItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                nativeButton={false}
                render={<Link href={item.href} />}
              >
                <item.icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <CommandDialog open={open} onOpenChange={changeOpen}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search leads, accounts, contacts, Funnels…"
            value={query}
            onValueChange={changeQuery}
            aria-label="Search records and pages"
          />
          {/* Off-screen status so screen readers hear search progress/results. */}
          <div className="sr-only" role="status" aria-live="polite">
            {query.trim().length < 2
              ? ""
              : pending
                ? "Searching…"
                : `${hits.length} ${hits.length === 1 ? "result" : "results"} found`}
          </div>
          <CommandList>
            {showEmpty ? <CommandEmpty>No results found.</CommandEmpty> : null}

            {navMatches.length > 0 ? (
              <CommandGroup heading="Go to">
                {navMatches.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.label}`}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon className="size-4 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {pending ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <LoaderIcon className="size-4 animate-spin" />
                Searching…
              </div>
            ) : null}

            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((hit) => {
                  const Icon = ICONS[hit.type]
                  return (
                    <CommandItem
                      key={`${hit.type}-${hit.id}`}
                      value={`${hit.type}-${hit.id}`}
                      onSelect={() => go(hit.href)}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="truncate">{hit.title}</span>
                      {hit.subtitle ? (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {hit.subtitle}
                        </span>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
