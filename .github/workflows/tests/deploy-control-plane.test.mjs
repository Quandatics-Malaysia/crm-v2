import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const workflow = readFileSync(new URL("../deploy-control-plane.yml", import.meta.url), "utf8")
const wrangler = readFileSync(new URL("../../../apps/control-plane/wrangler.jsonc", import.meta.url), "utf8")

for (const gate of ["wrangler types", "d1 migrations apply", "vitest", "deploy --dry-run", "--remote", "wrangler deploy"]) {
  assert.match(workflow, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}
assert.match(workflow, /environment:\s*production/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ENTITLEMENT_SIGNING_PRIVATE_JWK/)
assert.match(wrangler, /"crons"\s*:\s*\["\*\/15 \* \* \* \*"\]/)
assert.match(wrangler, /ENTITLEMENT_SIGNING_KEY_ID/)
