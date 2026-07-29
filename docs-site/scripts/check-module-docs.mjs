import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..");
const repoRoot = resolve(docsRoot, "..");
const catalogPath = resolve(docsRoot, "catalog/modules.json");
const configPath = resolve(docsRoot, "zudoku.config.tsx");
const moduleConfigPath = resolve(repoRoot, "apps/web/modules.config.ts");

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const zudokuConfig = readFileSync(configPath, "utf8");
const hasRepositorySource = existsSync(moduleConfigPath);
const moduleConfig = hasRepositorySource
  ? readFileSync(moduleConfigPath, "utf8")
  : "";

const errors = [];
const ids = new Set();

for (const entry of catalog) {
  if (ids.has(entry.id)) errors.push(`duplicate catalog id: ${entry.id}`);
  ids.add(entry.id);

  for (const key of ["id", "label", "domain", "kind", "route", "doc"]) {
    if (!entry[key]) errors.push(`${entry.id ?? "<unknown>"}: missing ${key}`);
  }

  const docPath = resolve(docsRoot, entry.doc);
  if (!existsSync(docPath)) errors.push(`${entry.id}: missing ${entry.doc}`);

  const navFile = entry.doc
    .replace(/^pages\//, "")
    .replace(/\.(md|mdx)$/, "");
  if (!zudokuConfig.includes(`file: "${navFile}"`)) {
    errors.push(`${entry.id}: ${navFile} is not registered in Zudoku navigation`);
  }

  if (hasRepositorySource) {
    const routeRoot = entry.route.split("/").filter(Boolean)[0];
    const authenticatedRoute = resolve(
      repoRoot,
      "apps/web/app/(app)",
      routeRoot,
    );
    const topLevelRoute = resolve(repoRoot, "apps/web/app", routeRoot);
    if (!existsSync(authenticatedRoute) && !existsSync(topLevelRoute)) {
      errors.push(`${entry.id}: route root does not exist: /${routeRoot}`);
    }
  }
}

const documentedFlags = new Set(
  catalog.map((entry) => entry.flag).filter(Boolean),
);
const configuredFlags = hasRepositorySource
  ? new Set(
      [...moduleConfig.matchAll(/^\s{2}([A-Za-z]\w*):\s*(?:true|false),/gm)].map(
        (match) => match[1],
      ),
    )
  : documentedFlags;

for (const flag of configuredFlags) {
  if (!documentedFlags.has(flag)) {
    errors.push(`plugin flag is missing from the documentation catalog: ${flag}`);
  }
}

for (const flag of documentedFlags) {
  if (!configuredFlags.has(flag)) {
    errors.push(`catalog references an unknown plugin flag: ${flag}`);
  }
}

if (errors.length > 0) {
  console.error("Module documentation coverage failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Module documentation coverage OK: ${catalog.length} capabilities, ` +
    `${configuredFlags.size} plugin flags` +
    `${hasRepositorySource ? "." : " (catalog-only isolated build)."}`,
);
