import { Hono } from "hono"

import { verifyControlDatabase } from "./db/client"

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get("/health", async (context) => {
  const databaseReady = await verifyControlDatabase(context.env.CONTROL_DB)

  if (!databaseReady) {
    return context.json(
      {
        status: "unavailable",
        environment: context.env.ENVIRONMENT,
        database: "unavailable",
      },
      503,
    )
  }

  return context.json({
    status: "ok",
    environment: context.env.ENVIRONMENT,
    database: "ok",
  })
})

export default app
