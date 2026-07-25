import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

/**
 * Optimistic redirects only — NOT the security boundary. Real auth + RBAC are
 * enforced in every Server Action / Route Handler / Server Component. This just
 * spares unauthenticated users a flash of protected UI. (Next 16: proxy.ts)
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  const { pathname } = request.nextUrl
  const isAuthRoute = pathname === "/sign-in"

  if (!sessionCookie && !isAuthRoute) {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }
  if (sessionCookie && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  return NextResponse.next()
}

export const config = {
  // Exclude framework internals AND static public files (anything with a file
  // extension, e.g. /prefs-init.js) — redirecting those to /sign-in breaks
  // beforeInteractive scripts and images for logged-out visitors.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
