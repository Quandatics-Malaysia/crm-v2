import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import {
  guardRouteWrite,
  type OperationalWriteOperation,
  type WriteAccessInput,
} from "@/lib/write-access"

type AuthPostOperation = Extract<OperationalWriteOperation, `auth_${string}`>

const AUTH_POST_OPERATIONS = {
  "/sign-in/email": "auth_sign_in",
  "/sign-in/oauth2": "auth_sign_in",
  "/sign-out": "auth_sign_out",
  "/request-password-reset": "auth_account_recovery",
  "/reset-password": "auth_account_recovery",
  "/send-verification-email": "auth_account_recovery",
  "/verify-password": "auth_account_security",
  "/change-password": "auth_account_security",
  "/revoke-session": "auth_session_security",
  "/revoke-sessions": "auth_session_security",
  "/revoke-other-sessions": "auth_session_security",
  "/refresh-token": "auth_session_security",
  "/get-access-token": "auth_session_security",
  "/organization/set-active": "auth_session_context",
} as const satisfies Record<string, AuthPostOperation>

export function resolveAuthPostOperation(pathname: string): AuthPostOperation | null {
  const normalized = pathname.replace(/^\/api\/auth/, "") || "/"
  if (normalized.startsWith("/reset-password/")) return "auth_account_recovery"
  if (normalized.startsWith("/callback/")) return "auth_sign_in"
  return AUTH_POST_OPERATIONS[normalized as keyof typeof AUTH_POST_OPERATIONS] ?? null
}

type AuthPostHandler = (request: Request, ...rest: unknown[]) => Promise<Response>

export function createAuthPostHandler(dependencies: {
  handler: AuthPostHandler
  guardWrite(input: WriteAccessInput): Promise<Response | null>
}): AuthPostHandler {
  return async (request, ...rest) => {
    const operation =
      resolveAuthPostOperation(new URL(request.url).pathname) ??
      "auth_business_mutation"
    const denied = await dependencies.guardWrite({ operation })
    if (denied) return denied
    return dependencies.handler(request, ...rest)
  }
}

const handlers = toNextJsHandler(auth.handler)

export const GET = handlers.GET
export const POST = createAuthPostHandler({
  handler: handlers.POST as AuthPostHandler,
  guardWrite: guardRouteWrite,
})
