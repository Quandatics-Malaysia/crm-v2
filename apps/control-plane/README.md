# CRM control plane

Vendor-operated Cloudflare Worker for client/deployment metadata, commercial controls, deployment identity, heartbeat rollups, and immutable signed entitlement leases. Client CRM rows, plaintext backups, install tokens, and signing private keys must never enter D1, logs, or audit metadata.

## Local verification

```sh
pnpm --filter control-plane exec wrangler types --env-interface CloudflareBindings
pnpm --filter control-plane exec wrangler d1 migrations apply CONTROL_DB --local
pnpm --filter control-plane typecheck
pnpm --filter control-plane test
pnpm --filter control-plane exec wrangler deploy --dry-run
```

Migration `0005_entitlement_issuance.sql` supports both fresh `0001`–`0005` databases and upgrades from Task 5. Entitlement rows and operator audit rows are append-only. Contract and schedule revisions serialize signing against commercial controls, while renewal claims serialize scheduler ownership. Cron runs every 15 minutes and renews missing leases, leases within six hours of expiry, materially changed effective inputs, and envelopes signed by a non-current key.

The Worker serves two boundaries: Cloudflare Access protects `/operator`, while
deployment agents call the signed machine endpoints for registration, heartbeat,
and entitlement retrieval. A custom vendor domain is optional. Without one, the
generated production config explicitly keeps the `*.workers.dev` endpoint enabled.

## Signing keys

- Configure non-secret `ENTITLEMENT_SIGNING_KEY_ID` in Wrangler per environment.
- Store `ENTITLEMENT_SIGNING_PRIVATE_JWK` only with `wrangler secret put`; it must be an Ed25519 private JWK.
- Keep every retired public verification key trusted by deployments for at least eight days after its final issuance (24-hour lease plus seven-day grace).
- Rotate by installing the new private secret and active key ID, deploying, then retaining old public trust. The next cron promptly replaces every current envelope signed by the old key; historical envelopes remain byte-identical.

## New client and deployment

1. In `/operator/clients`, create the vendor client.
2. Add organisation metadata, an active dated contract, modules/seats, and a
   deployment for the target environment.
3. Assign the deployment entitlement schedule and issue its first signed lease.
4. Issue a short-lived, one-time installation token through approved vendor
   provisioning, with an expiry no more than 24 hours ahead. Place it only in
   the new host's protected `.env`, then deploy the signed client bundle.
5. Confirm agent registration, heartbeat, signed entitlement, application health,
   and matching release identity. Delete the plaintext token after registration.

Current limitation: client, organisation, deployment, and contract forms exist,
but install-token issuance is not exposed in the operator UI or public API. New
production onboarding is therefore not self-service. Do not use direct D1 edits
or reuse another deployment's identity/token; complete the vendor-only issuance
surface before onboarding a new host.

## Deployment

The committed Wrangler file is local/test-only and intentionally contains no deployable D1 ID or staging/production blocks. Configure protected GitHub environments named `staging` and `production`. Each requires `CONTROL_DB_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ENTITLEMENT_SIGNING_PRIVATE_JWK`, and `INSTALL_TOKEN_PEPPER` secrets, plus `CONTROL_DB_NAME`, `BACKUP_BUCKET_NAME`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `BOOTSTRAP_OWNER_EMAIL`, `OPERATOR_ORIGIN`, `ENTITLEMENT_SIGNING_KEY_ID` variables.

Optional:
- `CONTROL_PLANE_ROUTE` (for example `control.quandatics.com/*`) replaces the
  `*.workers.dev` endpoint with a dedicated control domain. The Cloudflare API
  token must have Workers Routes edit permission for that zone; otherwise leave
  the variable unset.
- `OPERATOR_ORIGIN` is required and must match the browser-facing operator
  origin so CSRF checks and same-origin form posts work.

The workflow validates every protected value, rejects missing, malformed, nil, or placeholder identifiers, and writes a temporary mode-0600 Wrangler config that contains no secret material. Only that config is used for remote secret installation, migrations, and deployment; it is never committed. Remote migrations run before code and cron deployment.

After staging deployment, allow up to 15 minutes for cron propagation. Confirm one synthetic registered deployment receives an entitlement version reference from heartbeat, fetches that version with deployment authentication, verifies its signature, and has matching `entitlement.renew` audit evidence before promoting production.

Rollback deploys a previously verified Worker version without reverting D1 migrations or editing immutable entitlement/audit history. Issuance and claim idempotency make scheduler retries safe.
