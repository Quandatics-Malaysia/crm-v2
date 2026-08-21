import { PERMISSIONS } from "@/lib/permissions"

/**
 * A single settings sub-nav destination. `permission` (when set) gates whether
 * the item is *shown* — every section page keeps its own server-side gate, so
 * this only controls visibility, never access.
 */
export type SettingsNavItem = {
  label: string
  href: string
  permission?: string
  superadminOnly?: boolean
}

/** A labelled group of {@link SettingsNavItem}s, rendered as a header + items. */
export type SettingsNavGroup = {
  label: string
  items: SettingsNavItem[]
}

/**
 * Grouped settings sub-nav. Pure + server-importable (no client imports) so the
 * layout can read it too. Invoicing remains finance-gated in-page; quotation
 * defaults live in Documents so CRM tenants have a non-finance route.
 */
export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "General",
    items: [
      {
        label: "General",
        href: "/settings/general",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
    ],
  },
  {
    label: "Documents",
    items: [
      {
        label: "Documents",
        href: "/settings/documents",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
    ],
  },
  {
    label: "Billing",
    items: [
      {
        label: "Numbering",
        href: "/settings/billing/numbering",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
      {
        label: "Tax",
        href: "/settings/billing/tax",
        permission: PERMISSIONS.TAX_VIEW,
      },
    ],
  },
  {
    label: "Taxonomy",
    items: [
      {
        label: "Industries",
        href: "/settings/taxonomy/industries",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
      {
        label: "Project Natures",
        href: "/settings/taxonomy/project-natures",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
      {
        label: "Product Codes",
        href: "/settings/taxonomy/product-codes",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
      {
        label: "Funnel Stages",
        href: "/settings/taxonomy/funnel-stages",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        label: "People",
        href: "/settings/people",
        permission: PERMISSIONS.TENANT_MANAGE_USERS,
      },
    ],
  },
  {
    label: "Developers",
    items: [
      {
        label: "API Keys",
        href: "/settings/access",
        permission: PERMISSIONS.TENANT_SETTINGS,
      },
    ],
  },
]
