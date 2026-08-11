import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("GET /health", () => {
  it("reports the configured environment after verifying its D1 binding", async () => {
    const response = await SELF.fetch("https://control.invalid/health")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      environment: "development",
      database: "ok",
    })
  })
})
