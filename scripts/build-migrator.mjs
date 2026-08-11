import { cp, mkdir, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = path.join(repoRoot, "apps/web")
const outdir = path.join(repoRoot, "dist/migrator")
const { build } = createRequire(path.join(webRoot, "package.json"))("esbuild")

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: {
    migrate: path.join(webRoot, "db/migrate.ts"),
    seed: path.join(webRoot, "db/seed.ts"),
  },
  absWorkingDir: webRoot,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  bundle: true,
  conditions: ["react-server", "node"],
  format: "esm",
  outdir,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  sourcemap: false,
  target: "node22",
  tsconfig: path.join(webRoot, "tsconfig.json"),
})

await mkdir(path.join(outdir, "db"), { recursive: true })
await cp(path.join(webRoot, "db/migrations"), path.join(outdir, "db/migrations"), {
  recursive: true,
})
await cp(path.join(webRoot, "db/sql"), path.join(outdir, "db/sql"), { recursive: true })
