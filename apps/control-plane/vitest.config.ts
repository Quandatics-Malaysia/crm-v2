import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

process.env.ENTITLEMENT_SIGNING_PRIVATE_JWK ??= "test-only-private-jwk"
process.env.INSTALL_TOKEN_PEPPER ??= "test-only-install-token-pepper"

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations")

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          // Pool 0.20.3 injects nodejs_compat_v2 into its test-runner Worker;
          // workerd rejects that now-default flag from 2026-08-04 onward.
          compatibilityDate: "2026-08-03",
        },
      }),
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      provide: { migrations },
    },
  }
})
