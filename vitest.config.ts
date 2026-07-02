import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside a React Server environment; tests only
      // exercise pure functions, so stub it out.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
