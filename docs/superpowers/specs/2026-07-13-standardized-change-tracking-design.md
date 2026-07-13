# Standardized field-level change tracking

**Date:** 2026-07-13
**Status:** Approved (design)

## Problem

When a user edits a record (funnel, account, lead, …), the activity timeline shows
a generic entry — e.g. `Funnel updated` — with **no indication of what actually
changed, from what value to what value**. The before/after data is only partially
captured, in a place users don't see, and every action does it differently.

### Current behavior (as-built)

Two independent logging systems exist:

1. **`audit_log`** (`server/audit.ts` → `writeAudit`) — a compliance log with
   `before`/`after` `jsonb` columns. But each call hand-picks a **subset** of
   fields (e.g. `funnel/actions.ts#updateOpportunity` logs only `name` +
   `estimatedAmount`), and the only viewer (`/audit`) is behind the `audit`
   module, which is **off**. So the diff is partial and effectively hidden.

2. **`activities`** (`server/services/activity.ts` → `logActivity`) — the
   per-record **timeline** users actually see (`components/activity/activity-timeline.tsx`,
   fed by `app/(app)/_shared/activity-actions.ts` → `listActivities`). On update it
   writes `type: "system", subject: "<Entity> updated"` with **no field detail**.

So the "what changed, from → to" is neither complete nor surfaced, and the logging
is ad-hoc per action.

## Goals

- On every update, capture and display **every user-facing field that changed**,
  as `Label: old → new`, with human-readable formatting (money, dates, enum
  labels, foreign keys resolved to names; internal/computed fields excluded).
- Show it in **two places**: inline in the existing activity **timeline**, and in
  a dedicated per-record **History tab**.
- Make it **one standardized mechanism** used by **all core record types** —
  funnel, opportunity, account, person, lead, quotation, product, project, sales
  order, payment milestone, and settings.

## Non-goals

- Not replacing `audit_log` (compliance) — the helper keeps writing it.
- Not tracking out-of-band/direct-SQL changes (the app is the only writer; a
  WAL/CDC tool like Bemi was evaluated and rejected for this feature — it yields
  raw column JSON and still needs the field registry, while adding
  `wal_level=logical` + extra infra). Revisit only if a compliance-grade audit
  layer becomes a requirement.
- No new permission model in this pass (see Decisions).

## Design (Approach A)

### 1. Field registry — `server/services/changes/registry.ts`

`CHANGE_FIELDS: Record<EntityType, FieldRegistry>` where each entry maps a
user-facing field to how it should be labeled and formatted:

```ts
type FieldSpec = {
  label: string                    // "Estimated amount"
  format?: (value, tx) => Promise<string> | string   // money/date/enum/FK → display
}
type FieldRegistry = Record<string, FieldSpec>
```

- **Convention over configuration:** a field with no `format` shows its raw
  value; its `label` defaults to the column name title-cased. You only write
  explicit entries for fields needing special treatment.
- **Formatters** (shared, in `registry.ts` / a `formatters.ts` sibling):
  - money → `RM 130,000.00` (respects the record's currency)
  - date / timestamp → `31 Oct 2026`
  - enum → label map (stage `2c` → its stage name, status → label)
  - foreign key → resolved name via a per-field `resolve(tx, id)` (e.g.
    `ownerMemberId` → member name, `accountId` → account name). Resolution runs at
    **capture time** so history stays accurate even if the referenced record is
    later renamed.
- **Exclusion by omission:** fields absent from the registry (e.g. `updatedAt`,
  `id`, computed rollups, snapshot caches) are never reported.

### 2. Diff helper — `server/services/changes/record.ts`

```ts
recordChanges(tx, ctx, { entityType, entityId, before, after }): Promise<void>
```

- Iterates the entity's registry; for each field where `before[f] !== after[f]`,
  produces `{ field, label, from, to }` with `from`/`to` already formatted to
  display strings.
- If **no** user-facing field changed → writes **nothing** (no "updated with no
  changes" noise).
- Otherwise writes **both**:
  - `audit_log` (full `before`/`after` objects) — compliance, unchanged intent.
  - one `activities` row: `type: "update"`, `subject: "<Entity> updated"`,
    `changes: [{field,label,from,to}]` (new column).

Update actions call this **once** with the `existing` record (before) they
already fetch and the new values (after). It replaces the current
`writeAudit(partial)` + `logActivity(generic)` pair.

### 3. Data model — migration

- Add `changes jsonb` to `activities` (nullable; populated only on `update` rows).
- Add `'update'` to the `activity_type` enum.
- Verify `activityEntityType` enum covers all core entities in scope; add any
  missing values in the same migration.

### 4. Rendering — both surfaces

- **Timeline** (`components/activity/activity-timeline.tsx`,
  `activity-actions.ts` must select the new `changes` column): an `update` entry
  shows a one-line summary ("Updated 3 fields") that expands to the change list:
  ```
  ● Sara updated this funnel · 2h ago
      Stage        2c → 3b
      Owner        Sam Salesperson → Sara Seller
      Est. amount  RM 120,000.00 → RM 130,000.00
  ```
- **History tab** — a shared `<ChangeHistory entityType entityId />` component
  added as a tab on every core detail page. Lists only the `update` activity rows
  (their diffs), newest first, with actor + timestamp. Reuses the same change-list
  renderer as the timeline.

### 5. Rollout

Replace the ad-hoc pair with `recordChanges` in every core update action:
`funnel`, `opportunity`, `account`, `person`, `lead`, `quotation`, `product`,
`project`, `sales-order`, `payment-milestone`, `settings`. Each also needs its
entity registry entry.

### 6. Testing

The registry, formatters, and diff helper are pure/near-pure → `vitest` unit
tests (matches existing `tests/`):

- changed-field detection (incl. no-op → writes nothing)
- money / date / enum / FK formatting
- `from`/`to` correctness for a representative multi-field update
- a guardrail test asserting each core update action routes through
  `recordChanges` (prevents future actions from regressing to ad-hoc logging)

## Decisions

- **History tab visibility:** visible to anyone who can view the record (parity
  with the existing timeline). Gating behind a permission (e.g. managers/admins
  only) is a trivial follow-up and intentionally out of scope now.
- **FK/enum values are resolved to display strings at capture time**, not render
  time — historical accuracy over live-name reflection.
- **Creates stay as-is** (`type: "system"`, `"<Entity> created"`); only updates
  gain structured diffs.

## Open questions

None blocking. (Currency source for money formatting comes from the record's own
`currency` field where present; default `MYR` otherwise.)
