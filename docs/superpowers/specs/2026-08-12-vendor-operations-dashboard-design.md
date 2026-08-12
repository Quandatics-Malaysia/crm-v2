# Vendor operations dashboard design

## Goal

Turn the vendor-only control plane into a compact operational console for managing multiple customers and their licensed tenants without adding a frontend framework or client-side application.

## Information architecture

The dashboard summarizes clients, active/suspended contracts, deployments, unhealthy or stale agents, and seats used versus licensed. Client detail groups tenant records, contracts, and deployments under one customer. Deployment rows show environment, status, registration, last heartbeat, health, application and agent versions, immutable image digest, entitlement version, occupied seats, enabled modules, and backup timestamps. Contract detail shows status, term, seat limit, modules, entitlement revision, suspension state, invoices, and recent immutable audit activity.

## Controls

Existing audited mutation endpoints remain the only write path. The UI exposes contract status, suspension date, seat changes, entitlement scheduling, and entitlement issuance with clear labels. Destructive commercial states (`suspended`, `cancelled`) require an explicit confirmation checkbox submitted with the form and validated server-side. Tenant enable/disable is represented through licensed organisation records and entitlement issuance; installation secrets and raw signed payloads are never rendered.

## Visual system

Use one embedded stylesheet in `OperatorLayout`: warm neutral canvas, navy header, white panels, compact responsive grids, accessible focus states, status badges, data tables, and blue primary actions. No Bootstrap, JavaScript, external fonts, icons, or assets.

## Data and boundaries

Extend existing D1 read queries only; no new migration is needed. Queries remain bounded and select only display-safe operational fields. Cloudflare Access, operator status, RBAC, CSRF, append-only audit logging, and existing mutation transactions remain unchanged.

## Validation

Add repository/UI tests for summary counts, latest-heartbeat selection, stale/healthy rendering, seat calculations, absence of secrets, and confirmation enforcement. Run control-plane tests, typecheck, workflow tests, and production Worker dry run before deployment.
