import type { ZudokuConfig } from "zudoku";

const config: ZudokuConfig = {
  site: {
    title: "Quandatics CRM — Docs",
  },
  metadata: {
    title: "Quandatics CRM Docs",
    description:
      "Developer & operator documentation for the Quandatics CRM.",
  },
  docs: { files: "/pages/**/*.{md,mdx}" },
  search: { type: "pagefind" },
  navigation: [
    { type: "doc", file: "overview", label: "Overview" },
    { type: "doc", file: "contributing", label: "Contributing" },
    { type: "doc", file: "modules", label: "Modules" },
    { type: "doc", file: "operations", label: "Operations" },
    { type: "doc", file: "architecture", label: "Architecture" },
    { type: "doc", file: "api-reference", label: "API Reference" },
    {
      type: "category",
      label: "Modules Guide",
      icon: "puzzle",
      items: [
        { type: "doc", file: "modules/overview", label: "Overview" },
        { type: "doc", file: "modules/contributing", label: "Contributing" },
      ],
    },
  ],
  redirects: [{ from: "/", to: "/overview" }],
};

export default config;
