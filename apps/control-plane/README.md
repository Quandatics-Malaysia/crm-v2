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

Migration `0005_entitlement_issuance.sql` supports both fresh `0001`–`0005` databases and upgrades from Task 5. Entitlement rows and operator audit rows are append-only. Cron runs every 15 minutes and renews only missing leases, leases within six hours of expiry, or materially changed effective inputs.

## Signing keys

- Configure non-secret `ENTITLEMENT_SIGNING_KEY_ID` in Wrangler per environment.
- Store `ENTITLEMENT_SIGNING_PRIVATE_JWK` only with `wrangler secret put`; it must be an Ed25519 private JWK.
- Keep every retired public verification key trusted by deployments for at least eight days after its final issuance (24-hour lease plus seven-day grace).
- Rotate by installing the new private secret and active key ID, deploying, then retaining old public trust. Historical envelopes remain byte-identical.

## Deployment

Replace placeholder D1, R2, service, Access, origin, and signing-key IDs for staging and production. Configure protected GitHub environments named `staging` and `production`, each with scoped `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ENTITLEMENT_SIGNING_PRIVATE_JWK`, and `INSTALL_TOKEN_PEPPER` secrets. Workflow applies remote migrations before deploying code and cron.

After staging deployment, allow up to 15 minutes for cron propagation. Confirm one synthetic registered deployment receives an entitlement version reference from heartbeat, fetches that version with deployment authentication, verifies its signature, and has matching `entitlement.renew` audit evidence before promoting production.

Rollback deploys a previously verified Worker version without reverting D1 migrations or editing immutable entitlement/audit history. Issuance and claim idempotency make scheduler retries safe.
