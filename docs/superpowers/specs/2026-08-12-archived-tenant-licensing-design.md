# Archived Tenant Licensing Design

## Goal

Archive the existing `demo` organization without deleting its data. Archived organizations must be inaccessible to client users and consume no licensed seats.

## Data Model

Add lifecycle fields to `organization`:

- `status`: `active` or `archived`, default `active`, database-constrained.
- `archived_at`: nullable timestamp. Required when status is `archived`; null when status is `active`.

Existing organizations remain active during migration. The production `demo` organization is archived only through an explicit, audited operation after a fresh backup.

## Access Enforcement

Archived organizations are excluded from the authenticated user's tenant list. A stale cookie, URL, server action, API request, or invitation targeting an archived organization must fail closed.

Client users, including existing owners and superadmins, cannot open an archived organization. Archived data remains available only through server-operator database backup and recovery procedures.

Organization creation remains controlled by existing deployment entitlement and privileged bootstrap rules.

## Licensing

Deployment seat calculations count only active memberships belonging to active organizations. Pending invitations and seat reservations belonging to archived organizations do not consume seats.

Seat mutation functions reject invitations, activation, membership changes, and bootstrap operations targeting archived organizations. Archiving does not delete membership, invitation, role, audit, or business records.

After `demo` is archived, only active organizations such as `cc` and `qar` contribute to Quandatics deployment seat usage.

## Operations

Archive and restore are explicit server-operator operations, not controls exposed in Quandatics client UI. Each operation records an audit event with organization ID, actor, previous status, new status, and timestamp.

Production sequence:

1. Create and verify a fresh PostgreSQL backup.
2. Deploy signed images containing schema and enforcement changes.
3. Apply migration.
4. Archive organization with slug `demo` through the privileged operation.
5. Confirm license heartbeat excludes archived memberships.

Rollback restores `demo` to active status. No data reconstruction is needed because archive is non-destructive.

## Failure Behavior

- Unknown status values fail database validation.
- Archived tenant selection redirects to an available active tenant or the no-access screen.
- Archived tenant mutations return a stable access-denied error.
- Agent heartbeat and seat snapshots fail closed if lifecycle state cannot be read.
- Archive operation refuses to run without a matching organization and fresh verified backup evidence.

## Test Coverage

- Migration preserves existing organizations as active.
- Archived organizations disappear from tenant selection.
- Direct page, server action, API, invitation, and membership paths reject archived tenants.
- Archived members, invitations, and reservations consume zero seats.
- Active `cc` and `qar` memberships still count correctly.
- Restore makes tenant accessible and restores seat accounting.
- Existing commercial active, grace, read-only, suspended, and recovery behavior remains unchanged.

## Out of Scope

- Deleting `demo` or any membership/business data.
- Client-facing archive controls.
- Per-organization contracts; licensing remains deployment-wide.
- Source-based production deployment.
