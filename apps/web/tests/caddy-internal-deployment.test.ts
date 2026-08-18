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
    expect(caddyfile).toContain("max_size 16MB")
    expect(caddyfile).toContain("dial_timeout 10s")
    expect(caddyfile).toContain("response_header_timeout 30s")
    expect(caddyfile).toContain("Content-Security-Policy")
    expect(caddyfile).toContain("Permissions-Policy")
  })

  it("keeps production gateway configuration aligned with root configuration", async () => {
    const productionCaddyfile = await readFile(
      fileURLToPath(new URL("../../../deploy/client/Caddyfile", import.meta.url)),
      "utf8",
    )
    const caddyfile = await readFile(fileURLToPath(new URL("../../../Caddyfile", import.meta.url)), "utf8")
    expect(productionCaddyfile).toBe(caddyfile)
  })
})
