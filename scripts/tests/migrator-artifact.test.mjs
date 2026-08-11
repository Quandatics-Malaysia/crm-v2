import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { access, readdir } from "node:fs/promises"

await access("dist/migrator/migrate.mjs")
await access("dist/migrator/seed.mjs")
await access("dist/migrator/db/migrations/meta/_journal.json")
await access("dist/migrator/db/sql/rls.sql")
await access("dist/migrator/db/sql/views.sql")

const migrations = await readdir("dist/migrator/db/migrations")
assert.equal(
  migrations.some((name) => name.endsWith(".sql")),
  true,
  "migrator artifact must include at least one migration SQL file",
)

const names = await readdir("dist/migrator", { recursive: true })
assert.equal(names.some((name) => /\.(ts|tsx|map)$/.test(name)), false)

const entrypoints = new Map([
  ["migrate.mjs", /→ applying drizzle migrations…/],
  ["seed.mjs", /Failed query: insert into "permissions"/],
])

for (const [entrypoint, reachedApplication] of entrypoints) {
  const result = spawnSync(process.execPath, [entrypoint, "--help"], {
    cwd: "dist/migrator",
    encoding: "utf8",
    env: {
      ...process.env,
      APP_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "01234567890123456789012345678901",
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_ADMIN_URL: "postgres://postgres:postgres@127.0.0.1:1/crm?connect_timeout=1",
      NODE_ENV: "production",
      PLATFORM_MASTER_EMAIL: "admin@example.com",
      PLATFORM_MASTER_PASSWORD: "non-default-test-password",
    },
    timeout: 10_000,
  })
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.error, undefined, `${entrypoint} did not reach its entrypoint`)
  assert.equal(result.signal, null, `${entrypoint} terminated by signal`)
  assert.equal(result.status, 1, `${entrypoint} returned an unexpected status:\n${output}`)
  assert.match(output, reachedApplication, `${entrypoint} failed before application startup`)
  assert.match(
    output,
    /\b(?:ECONNREFUSED|EPERM|CONNECT_TIMEOUT)\b/,
    `${entrypoint} did not reach the offline database boundary`,
  )
  assert.doesNotMatch(
    output,
    /Dynamic require|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|\.(?:ts|tsx)(?:\W|$)/,
    `${entrypoint} depends on a missing module or source file`,
  )
}
