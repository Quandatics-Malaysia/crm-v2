import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

describe("public ingress internal deployment denial", () => {
  it("matches the full internal subtree and denies it before the web proxy", async () => {
    const caddyfile = await readFile(fileURLToPath(new URL("../../../Caddyfile", import.meta.url)), "utf8")
    const matcher = caddyfile.indexOf("path /api/internal/deployment/*")
    const denial = caddyfile.indexOf("respond @internal_deployment 404")
    const proxy = caddyfile.indexOf("reverse_proxy web:3000")

    expect(matcher).toBeGreaterThanOrEqual(0)
    expect(denial).toBeGreaterThan(matcher)
    expect(proxy).toBeGreaterThan(denial)
    expect(caddyfile).not.toContain("handle_path /api/internal/deployment")
  })
})
