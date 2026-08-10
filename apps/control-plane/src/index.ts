import { Hono } from "hono"

import {
  createOperatorAuthMiddleware,
  type OperatorAuthDependencies,
  type OperatorContext,
} from "./auth/access"
import { verifyControlDatabase } from "./db/client"
import { SafeHttpError } from "./http/errors"

export interface ControlPlaneEnvironment {
  Bindings: CloudflareBindings
  Variables: {
    operator: OperatorContext
  }
}

export interface ControlPlaneDependencies extends OperatorAuthDependencies {}

export function createApp(dependencies: ControlPlaneDependencies = {}) {
  const app = new Hono<ControlPlaneEnvironment>()

  app.onError((error, context) => {
    if (error instanceof SafeHttpError) {
      return context.json({ error: error.code }, error.status)
    }

    return context.json({ error: "internal_error" }, 500)
  })

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

  app.use("/operator/*", createOperatorAuthMiddleware(dependencies))
  app.get("/operator/session", (context) => {
    const operator = context.get("operator")

    return context.json({
      operatorId: operator.operatorId,
      email: operator.email,
      roles: [...operator.roles].sort(),
    })
  })

  return app
}

const app = createApp()

export default app
