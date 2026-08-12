# Vendor control plane console

## Goal

Operate every customer deployment from the vendor-owned Cloudflare console. Customer applications consume signed entitlements and cannot change plans, seats, modules, or commercial status.

## Lifecycle

- Clients and organisations are archived and restored, never deleted.
- Plans are activated and deactivated. A referenced plan cannot be deactivated.
- Deployments are enabled or disabled. Disabled deployments stop receiving active entitlements.
- Contracts retain commercial history. Cancellation or suspension changes signed entitlement state; archival only hides old records.
- Every mutation remains behind Cloudflare Access, CSRF protection, role checks, and the operator audit log.

## Console

- Dashboard: customer, deployment, contract, and health totals.
- Clients: edit client identity/status and manage organisations.
- Plans: create, edit, activate, and deactivate.
- Deployments: edit environment/status/image and inspect heartbeat/contract state.
- Contracts: labelled create/edit workflow supporting Core CRM with no optional modules.
- Audit: operator mutation history.

## Safety

- No hard-delete endpoint.
- Archive/deactivate operations fail when active references would become invalid.
- Production migration seeds the Core CRM plan idempotently.
- Existing machine APIs and signed entitlement protocol are unchanged.
