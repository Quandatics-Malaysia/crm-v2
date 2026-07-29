import type { ZudokuConfig } from "zudoku";

const config: ZudokuConfig = {
  site: {
    title: "Quandatics CRM Docs",
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
      copyright: `© ${new Date().getFullYear()} Quandatics`,
      position: "start",
    },
  },
  metadata: {
    title: "Quandatics CRM Docs",
    description:
      "Developer & operator documentation for the Quandatics CRM.",
    logo: "/quandatics.png",
    favicon: "/quandatics.png",
  },
  docs: { files: "/pages/**/*.{md,mdx}" },
  search: { type: "pagefind" },
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
        label: "Open App",
        to: "https://app.quandatics.com",
        icon: "external-link",
        target: "_blank",
      },
    ],
  },
  navigation: [
    // The landing page (pages/index.mdx) — registered here so it resolves to
    // "/", but hidden from the sidebar/top nav (it's reached via the logo,
    // the header link, or by visiting "/" directly), and kept outside every
    // category below so it never becomes a tab's "first page" target.
    { type: "doc", file: "index", path: "/", display: "hide" },
    {
      type: "category",
      label: "Get Started",
      icon: "rocket",
      items: [
        { type: "doc", file: "overview", label: "Overview" },
        { type: "doc", file: "contributing", label: "Contributing" },
      ],
    },
    {
      type: "category",
      label: "Guides",
      icon: "book-open",
      items: [
        {
          type: "category",
          label: "Modules",
          icon: "puzzle",
          items: [
            { type: "doc", file: "modules", label: "Plugin System" },
            { type: "doc", file: "modules/overview", label: "Overview" },
            { type: "doc", file: "modules/contributing", label: "Contributing" },
          ],
        },
        {
          type: "category",
          label: "Codebase",
          icon: "folder-tree",
          items: [
            { type: "doc", file: "codebase/overview", label: "Overview" },
            { type: "doc", file: "codebase/app", label: "app/" },
            { type: "doc", file: "codebase/lib", label: "lib/" },
            { type: "doc", file: "codebase/server-services", label: "server/services" },
            { type: "doc", file: "codebase/db", label: "db/" },
            {
              type: "doc",
              file: "codebase/components-and-tests",
              label: "components & tests",
            },
            { type: "doc", file: "codebase/adding-a-module", label: "Adding a module" },
          ],
        },
      ],
    },
    {
      type: "category",
      label: "API",
      icon: "server",
      items: [
        { type: "doc", file: "api-reference", label: "API Reference" },
        { type: "doc", file: "api-guide", label: "Using the REST API", icon: "terminal" },
        { type: "link", to: "/api-playground", label: "API Playground", icon: "flask-conical" },
      ],
    },
    {
      type: "category",
      label: "Operations",
      icon: "settings",
      items: [
        { type: "doc", file: "operations", label: "Operations" },
        { type: "doc", file: "architecture", label: "Architecture" },
      ],
    },
  ],
};

export default config;
