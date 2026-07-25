// Copies the canonical root Markdown into pages/ so the docs site and GitHub
// show ONE source. Runs on predev/prebuild. Copied files are git-ignored.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const pagesDir = resolve(here, "../pages");
mkdirSync(pagesDir, { recursive: true });

const map = [
  ["README.md", "overview.md"],
  ["CONTRIBUTING.md", "contributing.md"],
  ["MODULES.md", "modules.md"],
];

// Rewrite the common cross-doc relative links to site routes so they don't 404.
const rewrite = (s) =>
  s
    .replace(/\]\(\.\/CONTRIBUTING\.md\)/g, "](/contributing)")
    .replace(/\]\(\.\/MODULES\.md\)/g, "](/modules)")
    .replace(/\]\(\.\/README\.md\)/g, "](/overview)")
    .replace(/\]\(\.\/OPERATIONS\.md\)/g, "](/operations)");

for (const [src, dst] of map) {
  const body = readFileSync(resolve(repoRoot, src), "utf8");
  writeFileSync(resolve(pagesDir, dst), rewrite(body));
  console.log(`synced ${src} -> pages/${dst}`);
}
