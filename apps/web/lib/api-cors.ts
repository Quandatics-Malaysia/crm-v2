import "server-only"

/**
 * CORS for the public REST API (`/api/v1/*` + `/api/health`), so the docs
 * playground (hosted on a different origin) can call these endpoints with
 * `fetch(..., { headers: { authorization: "Bearer qdk_..." } })`.
 *
 * Auth is a bearer API key, never a cookie, so we deliberately do NOT set
 * `Access-Control-Allow-Credentials` — allowing arbitrary origins to read
 * bearer-authenticated responses is safe precisely because the browser never
 * attaches credentials automatically for this scheme.
 *
 * `API_CORS_ORIGINS` is a comma-separated allowlist of exact origins (e.g.
 * `https://docs-site-eight-umber.vercel.app,https://app.quandatics.com`). If
 * unset, we default to allowing just the docs playground's origin so the
 * "Send" button works out of the box in every environment.
 */
const DEFAULT_ALLOWED_ORIGIN = "https://docs-site-eight-umber.vercel.app"

function allowedOrigins(): string[] {
  const raw = process.env.API_CORS_ORIGINS
  if (!raw || raw.trim() === "") return [DEFAULT_ALLOWED_ORIGIN]
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    Vary: "Origin",
  }

  const origin = req.headers.get("origin")
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}
