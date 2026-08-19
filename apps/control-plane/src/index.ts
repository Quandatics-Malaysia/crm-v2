import { Hono, type Context } from "hono"

import {
  createOperatorAuthMiddleware,
  type OperatorAuthDependencies,
  type OperatorContext,
} from "./auth/access"
import { verifyControlDatabase } from "./db/client"
import { acceptsOperatorHtml, isOperatorRequest, safeErrorResponse } from "./http/errors"
import { requestId } from "./http/request-id"
import { createCommandRoutes } from "./routes/commands"
import { createDeploymentRoutes } from "./routes/deployments"
import { createEntitlementRoutes } from "./routes/entitlements"
import { createOperatorRoutes } from "./routes/operator"
import { runEntitlementRenewal } from "./repos/entitlements"
import { OperatorErrorPage } from "./ui/error"

export interface ControlPlaneEnvironment {
  Bindings: CloudflareBindings
  Variables: {
    operator: OperatorContext
    requestCorrelationId: string
  }
}

export interface ControlPlaneDependencies extends OperatorAuthDependencies {}

function safeOperatorError(
  context: Context<ControlPlaneEnvironment>,
  response: ReturnType<typeof safeErrorResponse>,
) {
  context.header("Cache-Control", "no-store")
  context.header("X-Content-Type-Options", "nosniff")
  context.header("Referrer-Policy", "no-referrer")

  if (acceptsOperatorHtml(context.req.raw)) {
    return context.html(OperatorErrorPage({
      code: response.code,
      requestId: requestId(context),
    }), response.status)
  }

  return context.json({ error: response.code }, response.status)
}

export function createApp(dependencies: ControlPlaneDependencies = {}) {
  const app = new Hono<ControlPlaneEnvironment>()

  app.onError((error, context) => safeOperatorError(context, safeErrorResponse(error)))
  app.notFound((context) => isOperatorRequest(context.req.raw)
    ? safeOperatorError(context, { code: "not_found", status: 404 })
    : context.text("404 Not Found", 404))

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
  app.route("/v1/deployments", createCommandRoutes())
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
