# Control-plane CSRF token design

## Goal

Make operator form submissions reliable behind Cloudflare Access without weakening mutation protection or adding operational state.

## Design

Use the double-submit-cookie pattern. On an authenticated operator GET, create a random CSRF token when the request has no valid token cookie. Set it as a `Secure`, `HttpOnly`, `SameSite=Strict`, path-scoped cookie and render the same token into every mutation form as a hidden field.

For form POST requests, require the cookie and hidden field to exist and match exactly before RBAC or mutation execution. JSON mutations continue requiring the existing `X-Control-Request: same-origin` header and also use the token header/cookie pair. Browser `Origin`, `Referer`, and `Sec-Fetch-Site` are no longer authorization inputs.

The token is stateless and needs no D1 table, configuration, signing key, rotation job, or operator action. A new token is created automatically when the cookie is absent.

## Security boundaries

- Cloudflare Access continues authenticating the operator.
- Existing operator status and role checks remain unchanged.
- Mutations remain audited, including denied token validation.
- Cookie scope is limited to `/operator`.
- Cross-site pages cannot read the HttpOnly cookie or submit the matching hidden token.
- Tokens and cookie values are never written to logs or audit metadata.

## Error handling

Missing or mismatched tokens return `403 forbidden` and do not execute a mutation. Invalid or expired Access sessions continue returning `401` through existing authentication middleware.

## Tests

Cover successful form and JSON mutations, missing cookie, missing field/header, mismatched token, role denial, and unchanged audit behavior. Remove tests tied to unreliable browser request metadata.
