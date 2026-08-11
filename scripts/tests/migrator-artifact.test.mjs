import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { access, readdir } from "node:fs/promises"

await access("dist/migrator/migrate.mjs")
await access("dist/migrator/seed.mjs")

const names = await readdir("dist/migrator", { recursive: true })
assert.equal(names.some((name) => /\.(ts|tsx|map)$/.test(name)), false)

for (const entrypoint of ["migrate.mjs", "seed.mjs"]) {
  const result = spawnSync(process.execPath, [entrypoint, "--help"], {
    cwd: "dist/migrator",
    encoding: "utf8",
    env: {
      ...process.env,
      APP_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "01234567890123456789012345678901",
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_ADMIN_URL: "postgres://postgres:postgres@127.0.0.1:1/crm",
    },
    timeout: 10_000,
  })
  assert.equal(result.error, undefined, `${entrypoint} did not reach its entrypoint`)
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /Dynamic require|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|\.(?:ts|tsx)(?:\W|$)/,
    `${entrypoint} depends on a missing module or source file`,
  )
}
