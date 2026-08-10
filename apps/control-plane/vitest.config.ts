import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        // Pool 0.20.3 injects nodejs_compat_v2 into its test-runner Worker;
        // workerd rejects that now-default flag from 2026-08-04 onward.
        compatibilityDate: "2026-08-03",
        serviceBindings: {
          ASSETS: {
            network: {
              allow: [],
            },
          },
        },
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
})
