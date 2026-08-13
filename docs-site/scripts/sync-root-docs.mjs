// Refreshes the canonical root Markdown into pages/ so the docs site and GitHub
// show ONE source. Runs on predev/prebuild. The generated copies ARE committed
// (so an isolated Vercel CLI upload of docs-site/ still builds), and this script
// refreshes them from the root whenever the parent repo is present. If the
// parent files aren't present (isolated build context), it keeps the committed
// copies and exits cleanly.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const pagesDir = resolve(here, "../pages");
mkdirSync(pagesDir, { recursive: true });
mkdirSync(resolve(pagesDir, "extensibility"), { recursive: true });

if (!existsSync(resolve(repoRoot, "README.md"))) {
  console.log("root docs not present (isolated build) — using the committed page copies");
  process.exit(0);
}

const map = [
  ["README.md", "overview.md"],
  ["CONTRIBUTING.md", "contributing.md"],
  ["MODULES.md", "extensibility/plugin-system.md"],
];

const repoUrl = "https://github.com/Super-ERP/crm-v2";

// Rewrite cross-doc links to site routes and source-file links to GitHub so
// generated pages still work regardless of how deeply they are nested.
const rewrite = (s) =>
  s
    .replace(/\]\(\.\/CONTRIBUTING\.md(#[^)]+)?\)/g, "](/contributing$1)")
    .replace(/\]\(\.\/MODULES\.md(#[^)]+)?\)/g, "](/extensibility/plugin-system$1)")
    .replace(/\]\(\.\/README\.md(#[^)]+)?\)/g, "](/overview$1)")
    .replace(/\]\(\.\/OPERATIONS\.md(#[^)]+)?\)/g, "](/operations$1)")
    .replace(/\]\(\.\/([^)]+)\)/g, `](${repoUrl}/blob/main/$1)`);

// Lift the doc's leading `# H1` into Zudoku frontmatter `title:` and drop it
// from the body, so the site renders exactly one visible title (from
// frontmatter) instead of the H1 duplicating the page/category label above
// it. JSON.stringify gives a YAML-safe double-quoted scalar (handles `:`, `"`).
const liftTitle = (s) => {
  const match = s.match(/^#\s+(.+?)\s*\n+/);
  if (!match) return s;
  const title = match[1].trim();
  const rest = s.slice(match[0].length);
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${rest}`;
};

for (const [src, dst] of map) {
  const body = readFileSync(resolve(repoRoot, src), "utf8");
  writeFileSync(resolve(pagesDir, dst), liftTitle(rewrite(body)));
  console.log(`synced ${src} -> pages/${dst}`);
}
