import type { ZudokuConfig } from "zudoku";
import { remarkMermaid } from "./remark-mermaid";
import "./styles.css";

const config: ZudokuConfig = {
  site: {
    title: "CRM Documentation",
    logo: {
      src: {
        light: "/quandatics.png",
        dark: "/quandatics.png",
      },
      alt: "Quandatics",
      width: "120px",
      href: "/",
      reloadDocument: false,
    },
    showPoweredBy: false,
    sidebar: {
      collapsible: true,
      toggleVisibility: "hover",
      togglePosition: "bottom",
    },
    footer: {
      logo: {
        src: {
          light: "/quandatics.png",
          dark: "/quandatics.png",
        },
        alt: "Quandatics",
        width: "100px",
        href: "/",
      },
      copyright: `© ${new Date().getFullYear()} Quandatics. Internal product documentation.`,
      position: "start",
      links: [
        {
          label: "Source",
          href: "https://github.com/Quandatics-Malaysia/crm-v2",
        },
        {
          label: "Production",
          href: "https://app.quandatics.com",
        },
      ],
    },
  },
  metadata: {
    title: "Quandatics CRM Documentation",
    description:
      "Lifecycle-first product, developer, API, and operations documentation for Quandatics CRM.",
    logo: "/quandatics.png",
    favicon: "/quandatics.png",
  },
  docs: { files: "/pages/**/*.{md,mdx}" },
  build: {
    remarkPlugins: [remarkMermaid],
  },
  search: { type: "pagefind" },
  theme: {
    fonts: {
      sans: "Geist",
      mono: "Geist Mono",
    },
    light: {
      background: "#f7f8fa",
      foreground: "#202124",
      card: "#fcfcfd",
      cardForeground: "#202124",
      popover: "#fcfcfd",
      popoverForeground: "#202124",
      primary: "#1769aa",
      primaryForeground: "#fcfcfd",
      secondary: "#eef1f4",
      secondaryForeground: "#202124",
      muted: "#eef1f4",
      mutedForeground: "#626971",
      accent: "#e8f3fb",
      accentForeground: "#104b7a",
      destructive: "#b42318",
      destructiveForeground: "#fcfcfd",
      border: "#dfe3e8",
      input: "#dfe3e8",
      ring: "#1769aa",
      radius: "0.5rem",
    },
    dark: {
      background: "#151719",
      foreground: "#f1f3f5",
      card: "#202327",
      cardForeground: "#f1f3f5",
      popover: "#202327",
      popoverForeground: "#f1f3f5",
      primary: "#2f87d4",
      primaryForeground: "#f7f8fa",
      secondary: "#292d32",
      secondaryForeground: "#f1f3f5",
      muted: "#292d32",
      mutedForeground: "#a8afb7",
      accent: "#17354d",
      accentForeground: "#afd1ee",
      destructive: "#f97066",
      destructiveForeground: "#151719",
      border: "#363b41",
      input: "#363b41",
      ring: "#2f87d4",
      radius: "0.5rem",
    },
  },
  apis: [
    {
      type: "file",
      input: "./apis/crm-api.yaml",
      path: "/api-playground",
    },
  ],
  header: {
    navigation: [
      {
        label: "Module directory",
        to: "/product/module-directory",
        icon: "layout-list",
      },
      {
        label: "Source",
        to: "https://github.com/Quandatics-Malaysia/crm-v2",
        icon: "git-branch",
        target: "_blank",
      },
      {
        label: "Open app",
        to: "https://app.quandatics.com",
        icon: "external-link",
        target: "_blank",
      },
    ],
  },
  navigation: [
    { type: "doc", file: "index", path: "/", display: "hide" },
    {
      type: "category",
      label: "Start here",
      icon: "compass",
      items: [
        { type: "doc", file: "product/index", path: "/product", label: "Product overview" },
        { type: "doc", file: "product/lifecycle", label: "Customer lifecycle" },
        { type: "doc", file: "product/module-directory", label: "Module directory" },
        { type: "doc", file: "overview", label: "Repository overview" },
        { type: "doc", file: "contributing", label: "Contributing" },
      ],
    },
    {
      type: "category",
      label: "Product",
      icon: "workflow",
      items: [
        {
          type: "category",
          label: "CRM",
          icon: "contact-round",
          items: [
            { type: "doc", file: "product/crm/leads", label: "Leads" },
            { type: "doc", file: "product/crm/accounts", label: "Accounts" },
            { type: "doc", file: "product/crm/contacts", label: "Contacts" },
          ],
        },
        {
          type: "category",
          label: "Sales",
          icon: "chart-no-axes-combined",
          items: [
            { type: "doc", file: "product/sales/opportunities", label: "Opportunities" },
            { type: "doc", file: "product/sales/funnel", label: "Funnel & stages" },
            { type: "doc", file: "product/sales/approvals", label: "Approvals" },
            { type: "doc", file: "product/sales/products", label: "Products" },
            { type: "doc", file: "product/sales/quotations", label: "Quotations & tax" },
            { type: "doc", file: "product/sales/payment-milestones", label: "Payment milestones" },
          ],
        },
        {
          type: "category",
          label: "Delivery",
          icon: "briefcase-business",
          items: [
            { type: "doc", file: "product/delivery/projects", label: "Projects" },
            { type: "doc", file: "product/delivery/sales-orders", label: "Sales orders" },
          ],
        },
        {
          type: "category",
          label: "Finance & insights",
          icon: "landmark",
          items: [
            { type: "doc", file: "product/finance/index", path: "/product/finance", label: "Finance overview" },
            { type: "doc", file: "product/finance/order-to-cash", label: "Order to cash" },
            { type: "doc", file: "product/finance/procure-to-pay", label: "Procure to pay" },
            { type: "doc", file: "product/finance/intercompany", label: "Intercompany" },
            { type: "doc", file: "product/finance/forecast", label: "Forecast" },
          ],
        },
        {
          type: "category",
          label: "Platform",
          icon: "blocks",
          items: [
            { type: "doc", file: "product/platform/dashboard", label: "Dashboard" },
            { type: "doc", file: "product/platform/team-and-rbac", label: "Team & access" },
            { type: "doc", file: "product/platform/settings", label: "Settings" },
            { type: "doc", file: "product/platform/tenancy-and-auth", label: "Tenancy & auth" },
            { type: "doc", file: "product/platform/audit", label: "Audit & activity" },
            { type: "doc", file: "product/platform/documentation", label: "In-app documentation" },
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Developers",
      icon: "code-xml",
      items: [
        {
          type: "category",
          label: "Codebase",
          icon: "folder-tree",
          items: [
            { type: "doc", file: "codebase/overview", label: "Overview" },
            { type: "doc", file: "codebase/app", label: "Routes & actions" },
            { type: "doc", file: "codebase/lib", label: "Platform libraries" },
            { type: "doc", file: "codebase/server-services", label: "Business services" },
            { type: "doc", file: "codebase/db", label: "Database" },
            { type: "doc", file: "codebase/components-and-tests", label: "Components & tests" },
          ],
        },
        {
          type: "category",
          label: "Extensibility",
          icon: "puzzle",
          items: [
            { type: "doc", file: "extensibility/plugin-system", label: "Plugin contract" },
            { type: "doc", file: "extensibility/overview", label: "Plugin registry" },
            { type: "doc", file: "extensibility/adding-a-module", label: "Adding a module" },
            { type: "doc", file: "extensibility/code-walkthrough", label: "Worked examples" },
          ],
        },
      ],
    },
    {
      type: "category",
      label: "API",
      icon: "server",
      items: [
        { type: "doc", file: "api-guide", label: "Using the REST API", icon: "terminal" },
        { type: "doc", file: "api-reference", label: "Architecture reference" },
        { type: "link", to: "/api-playground", label: "API playground", icon: "flask-conical" },
      ],
    },
    {
      type: "category",
      label: "Operations & architecture",
      icon: "settings",
      items: [
        { type: "doc", file: "operations", label: "Operations" },
        { type: "doc", file: "architecture", label: "Architecture" },
      ],
    },
  ],
};

export default config;
