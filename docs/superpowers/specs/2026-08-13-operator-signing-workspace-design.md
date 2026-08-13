# Operator Signing Workspace

- **Date:** 2026-08-13
- **Status:** Approved design
- **Scope:** Guided client onboarding and entitlement signing

## Decision

Replace the control plane's stacked raw forms with a server-rendered onboarding workspace:

1. Create client
2. Create contract
3. Create deployment
4. Issue one-time install token
5. Register the deployment
6. Configure and review entitlement
7. Issue signed entitlement
8. Verify heartbeat

The implementation stays on Hono JSX and D1. It adds a small CSS system and minimal progressive enhancement only where useful, such as copying a one-time token. No SPA framework or new design-system dependency is needed.

## Information architecture

### Dashboard

Show operator identity, client/deployment totals, deployments needing action, and recent activity. The primary action is **Add client**.

### Client list and client workspace

Use a searchable-looking, readable table layout with status badges. The client workspace has a summary header, onboarding progress, contracts, deployments, organisations, and one prominent next action. Existing create forms remain available but move into focused cards rather than one long page.

Organisations remain optional and do not block deployment onboarding.

### Deployment workspace

Add `/operator/deployments/:deploymentId` as the main signing workspace. It contains:

- Client, environment, registration, licence, and heartbeat status
- A progress stepper with complete, current, and blocked states
- One next-action panel
- Install-token issuance and one-time reveal
- Entitlement configuration and review
- Signed entitlement history
- Latest heartbeat and deployment health
- A compact audit timeline

## State model

The UI derives state from existing durable records; it does not add a second workflow-state table.

| Step | Complete when | Blocked when |
| --- | --- | --- |
| Client | Client exists and is active | Client disabled |
| Contract | Compatible active contract exists | Missing, expired, suspended, or cancelled |
| Deployment | Active deployment exists | Deployment disabled |
| Install | `registered_at` and deployment key exist | No usable install token or token expired |
| Configure | Entitlement schedule exists | No compatible contract |
| Sign | Current signed entitlement exists | Deployment unregistered or schedule missing |
| Verify | Recent healthy heartbeat acknowledges current state | Heartbeat missing, stale, or unhealthy |

Display licence state separately as Active, Grace, or Read-only by evaluating the latest signed lease. Display connectivity separately as Online, Stale, or Never connected. This avoids misleading operators into treating licensing and connectivity as the same condition.

## Signing interaction

Signing uses a review-before-issue flow:

1. Select a contract and configure version, release channel, minimum app version, and optional approved image digest.
2. Validate and save the schedule.
3. Show a human-readable signing summary: client, deployment, contract dates/status, seats, modules, release controls, and expected lease/grace period.
4. Require an explicit confirmation and submit **Issue signed entitlement**.
5. Return to the deployment workspace with the new immutable version and issue time.

Renewal/re-signing is visually separated from first issuance and labelled **Issue new version**. The private signing key and raw signed envelope are never rendered. Existing idempotency and stale-state checks remain authoritative.

## Install-token interaction

The operator chooses a short expiry and confirms issuance. The plaintext token is returned once on a no-store result page with:

- Deployment and expiry
- Copy action with manual-selection fallback
- Warning that the token cannot be recovered
- Link back to deployment status

Only the digest remains in D1. Tokens never appear in URLs, logs, or audit metadata.

## Visual system

- Neutral page background, white content surfaces, strong text contrast
- Restrained accent colour for primary actions
- Green, amber, red, blue, and grey semantic badges with text labels
- 44px minimum interactive targets and visible keyboard focus
- Consistent labels, help text, field errors, and button hierarchy
- Responsive one-column layout on narrow screens
- Tables become readable stacked rows where necessary
- Destructive or commercial-impact actions use confirmation panels

CSS is local to the operator interface and served by the Worker. System fonts keep deployment small and private.

## Error handling

HTML requests receive a styled error page with a safe message, request ID, back link, and retry guidance. JSON routes preserve their current JSON contracts and status codes. Validation remains server-authoritative; browser input attributes provide early feedback only.

Expected conflicts, stale signing state, expired tokens, missing prerequisites, and unavailable signing configuration receive distinct operator-safe messages. Detailed database or cryptographic errors remain hidden.

## Security and audit

- Keep Cloudflare Access, application RBAC, CSRF, same-origin checks, and `Cache-Control: no-store`
- Install-token issuance requires `vendor_owner`
- Entitlement configuration and issuance retain current owner/billing permissions
- Audit token issuance without recording plaintext token
- Audit schedule and entitlement issuance through existing mechanisms
- Never expose signing secrets, deployment private keys, or raw exception details
- Preserve immutable entitlement history

## Testing and acceptance

Tests cover state derivation, role restrictions, token one-time handling, signing prerequisites, HTML redirects, escaping, error rendering, and accessibility landmarks. Existing deployment protocol, entitlement, authentication, and CRUD tests must stay green.

Acceptance requires:

- A new client can be taken from creation to a healthy heartbeat without calling a hidden operator API
- The next required action is obvious at every state
- Signing cannot occur before registration and configuration
- Operators can distinguish offline, grace, and read-only states
- The interface works without client JavaScript except the optional copy enhancement
- Control-plane tests, typecheck, repository tests, and production build pass

