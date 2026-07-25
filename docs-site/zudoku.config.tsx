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
  navigation: [
    { type: "doc", file: "overview", label: "Overview" },
    { type: "doc", file: "contributing", label: "Contributing" },
    { type: "doc", file: "modules", label: "Modules" },
    { type: "doc", file: "operations", label: "Operations" },
    { type: "doc", file: "architecture", label: "Architecture" },
  ],
  redirects: [{ from: "/", to: "/overview" }],
};

export default config;
