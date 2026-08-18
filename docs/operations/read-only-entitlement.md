# Read-Only Deployment Repair

Web deployment enters read-only mode when no valid signed entitlement is available or its lease is beyond grace. Business writes fail with `LICENSE_READ_ONLY`.

## Vendor Console

1. Open `/operator/deployments/{deploymentId}`.
2. Confirm deployment status is `active`.
3. Check heartbeat state. `Online` means agent heartbeat arrived within 30 minutes. `Stale` or `Never connected` means agent connectivity needs repair.
4. Review contract status, dates, seat limit, modules, and entitlement schedule.
5. Open `Review entitlement terms`.
6. Confirm current terms and issue a new signed entitlement version.
7. Wait for the deployment agent heartbeat. Agent polls control-plane about every 15 minutes, fetches the newest version, and applies it through the internal web route.

## Failure Reasons

- `unknown_key`: web `VENDOR_ENTITLEMENT_TRUST_SET` does not contain control-plane signing key ID.
- `trust_set_invalid`: web trust-set JSON is malformed or violates schema.
- `invalid_signature`: signing private key and web trust set do not match.
- `expired_lease`: entitlement lease is outside its grace window, or contract is outside its valid dates.
- `invalid_modules`: contract module dependency closure is invalid.
- `web_metadata_mismatch`: agent and web application or migration versions differ.
- `identity_rejected`: deployment key was revoked, expired, or deployment disabled. Agent enters repair-required state.

## Key Repair

Current deployment-agent identity recovery still requires customer-host access. Do not revoke an active deployment key until the customer can remove `/var/lib/crm-agent/registration.json` and `identity.json`, install a fresh token, and restart the agent. Remote key rotation ships with the signed command channel.

## Gateway Checks

Customer gateway must keep `/api/internal/deployment/*` inaccessible from public ingress. Public TLS terminator must enforce:

- HSTS: `max-age=31536000; includeSubDomains` after HTTPS is confirmed for every subdomain.
- Request body limit: 16 MB or lower where business requirements allow.
- Per-source rate limits on sign-in, auth recovery, API, and file upload routes.
- TLS 1.2+ and current cipher policy.

The shipped Caddy gateway enforces a 16 MB request body limit, upstream timeouts, security headers, and read-only container hardening. Rate limiting and HSTS belong on public Nginx/HAProxy because Caddy listens on an internal HTTP socket and the shipped `caddy:2-alpine` image has no rate-limit plugin.
