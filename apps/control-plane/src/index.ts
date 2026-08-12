import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"

import {
  createOperatorAuthMiddleware,
  type OperatorAuthDependencies,
  type OperatorContext,
} from "./auth/access"
import { verifyControlDatabase } from "./db/client"
import { SafeHttpError } from "./http/errors"
import { createDeploymentRoutes } from "./routes/deployments"
import { createEntitlementRoutes } from "./routes/entitlements"
import { createOperatorRoutes } from "./routes/operator"
import { runEntitlementRenewal } from "./repos/entitlements"

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
      if (context.req.path.startsWith("/operator/") && !context.req.header("Content-Type")?.startsWith("application/json")) {
        const message = error.code === "invalid_request"
          ? "Contract details are invalid. Select an active plan and check the dates and numbers."
          : "The request could not be completed."
        return context.html(`<main style="max-width:680px;margin:48px auto;font:16px system-ui"><h1>Could not save</h1><p>${message}</p><p><a href="javascript:history.back()">Back to form</a></p></main>`, error.status)
      }
      return context.json({ error: error.code }, error.status)
    }
    if (error instanceof HTTPException && error.status === 403) {
      return context.json({ error: "forbidden" }, 403)
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
  app.route("/operator", createOperatorRoutes())
  app.route("/v1/deployments", createDeploymentRoutes())
  app.route("/v1/deployments", createEntitlementRoutes())
  app.get("/", (context) => {
    return context.redirect("/operator", 302)
  })

  return app
}

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled(_controller, environment, context) {
    context.waitUntil(runEntitlementRenewal(environment))
  },
} satisfies ExportedHandler<CloudflareBindings>
