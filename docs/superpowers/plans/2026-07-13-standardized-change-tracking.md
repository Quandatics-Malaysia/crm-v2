# Standardized Field-Level Change Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a record is updated, show every changed field as `Label: old → new` in the activity timeline and a per-record History tab, via one standardized helper across all timeline-backed entities.

**Architecture:** A per-entity **field registry** (labels + formatters, convention-over-configuration) drives a shared **`recordChanges`** helper that diffs `before`/`after`, resolves FK/enum/money/date values to display strings at capture time, then writes both the compliance `audit_log` (full before/after) and one `activities` row of `type:'update'` carrying a structured `changes` array. The timeline and a new `<ChangeHistory>` tab both render that array.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Postgres 17, TypeScript, vitest. Server actions run inside `withTenant`/`runInTenant` transactions.

## Global Constraints

- All DB access runs inside a tenant transaction (`Tx` from `@/db`); helpers take `(tx, ctx, …)`. Copy this shape from `server/services/activity.ts`.
- `recordChanges` must be a drop-in replacement for the existing `writeAudit(partial)` + `logActivity(generic)` pair — one call, same transaction.
- Money uses `formatMoney(value, currency)` and dates use `formatDate(value)` from `lib/format.ts`. Never hand-roll formatting.
- FK/enum values are resolved to display strings **at capture time** (store the string), not at render time.
- If no user-facing field changed, `recordChanges` writes **nothing**.
- **Scope (this pass):** the 6 entities backed by the `activity_entity_type` enum — `account`, `person`, `lead`, `opportunity` (the container), `funnel` (logged under `opportunity`), `project`, `finance_doc`. Records without a timeline surface today (product, quotation, sales_order, payment_milestone, settings) are an explicit follow-up (see final section) — do NOT add timelines to them here.
- Migrations are hand-written SQL in `db/migrations/NNNN_*.sql` with a matching `db/schema/*.ts` edit; apply with `npm run db:migrate`. Next migration number is `0059`.

---

## File Structure

- Create `server/services/changes/types.ts` — `ChangeEntry`, `FieldSpec`, `FieldRegistry`, `FormatCtx`, `RegistryKey`.
- Create `server/services/changes/formatters.ts` — shared value formatters (money/date/enum-label/fk-resolver builders).
- Create `server/services/changes/registry.ts` — `CHANGE_FIELDS: Record<RegistryKey, FieldRegistry>`; convention defaults; the per-entity field sets.
- Create `server/services/changes/record.ts` — `recordChanges(tx, ctx, args)` and `diffFields(...)` (pure, exported for tests).
- Create `components/activity/change-list.tsx` — presentational `<ChangeList changes={…} />` (shared by timeline + History tab).
- Create `components/activity/change-history.tsx` — `<ChangeHistory entityType entityId items />` History tab body.
- Create `app/(app)/_shared/change-actions.ts` — `listChanges(entityType, entityId)` server action for the History tab.
- Modify `db/schema/activities.ts` — add `'update'` to `activityType`; add `changes` jsonb column.
- Create `db/migrations/0059_activity_changes.sql`.
- Modify `server/services/activity.ts` — add `'update'` to `ActivityKind`.
- Modify `app/(app)/_shared/activity-actions.ts` — select `changes`; add it to `ActivityRow`.
- Modify `components/activity/activity-timeline.tsx` — render `update` rows via `<ChangeList>`; add icon + label.
- Modify each entity's `actions.ts` (funnel, opportunity, account, person, lead, project, billing) — swap to `recordChanges`.
- Modify each entity's `*-detail-body.tsx` — add the History tab.
- Create `tests/change-tracking.test.ts`.

---

## Task 1: Migration — `changes` column + `update` activity type

**Files:**
- Modify: `db/schema/activities.ts`
- Create: `db/migrations/0059_activity_changes.sql`

**Interfaces:**
- Produces: `activities.changes` (jsonb, nullable) and `activityType` value `'update'`, consumed by every later task.

- [ ] **Step 1: Edit the schema.** In `db/schema/activities.ts`, add `jsonb` to the drizzle import, add `"update"` to the `activityType` enum array (after `"stage_change"`), and add the column inside the table after `body`:

```ts
// import: import { pgTable, pgEnum, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core"
// activityType array gains: "update",
    changes: jsonb("changes"), // [{ field, label, from, to }] — set only on type='update'
```

- [ ] **Step 2: Write the migration** `db/migrations/0059_activity_changes.sql`:

```sql
ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'update';
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "changes" jsonb;
```

- [ ] **Step 3: Apply and verify.**

Run: `npm run db:migrate`
Expected: completes; `\d activities` shows a `changes | jsonb` column and `'update'` is a valid `activity_type`.

- [ ] **Step 4: Commit.**

```bash
git add db/schema/activities.ts db/migrations/0059_activity_changes.sql
git commit -m "feat(changes): add activities.changes column + 'update' activity type"
```

---

## Task 2: Types + formatters

**Files:**
- Create: `server/services/changes/types.ts`
- Create: `server/services/changes/formatters.ts`
- Test: `tests/change-tracking.test.ts`

**Interfaces:**
- Produces:
  - `type ChangeEntry = { field: string; label: string; from: string; to: string }`
  - `type FormatCtx = { tx: Tx; record: Record<string, unknown> }`
  - `type FieldSpec = { label: string; format?: (value: unknown, c: FormatCtx) => string | Promise<string> }`
  - `type FieldRegistry = Record<string, FieldSpec>`
  - `type RegistryKey = "account" | "person" | "lead" | "opportunity" | "funnel" | "project" | "finance_doc"`
  - formatters: `money(currencyField?: string)`, `date()`, `enumLabel(map: Record<string,string>)`, `fk(loader)` — each returns a `FieldSpec["format"]`.

- [ ] **Step 1: Write `types.ts`:**

```ts
import type { Tx } from "@/db"

export type ChangeEntry = { field: string; label: string; from: string; to: string }
export type FormatCtx = { tx: Tx; record: Record<string, unknown> }
export type FieldSpec = {
  label: string
  format?: (value: unknown, c: FormatCtx) => string | Promise<string>
}
export type FieldRegistry = Record<string, FieldSpec>
export type RegistryKey =
  | "account" | "person" | "lead" | "opportunity" | "funnel" | "project" | "finance_doc"
```

- [ ] **Step 2: Write the failing test** in `tests/change-tracking.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { money, date, enumLabel } from "@/server/services/changes/formatters"

const noCtx = { tx: {} as any, record: {} }
describe("change formatters", () => {
  it("formats money with default currency", async () => {
    expect(await money()("130000.00", { tx: {} as any, record: { currency: "MYR" } }))
      .toBe("RM 130,000.00")
  })
  it("formats dates", async () => {
    expect(await date()("2026-10-31", noCtx)).toBe("31 Oct 2026")
  })
  it("maps enum labels, falling back to the raw value", async () => {
    const f = enumLabel({ "2c": "Qualified", "3b": "Proposal" })
    expect(await f("2c", noCtx)).toBe("Qualified")
    expect(await f("zz", noCtx)).toBe("zz")
  })
})
```

- [ ] **Step 3: Run it — expect FAIL.** Run: `npx vitest run tests/change-tracking.test.ts` → FAIL (module not found).

- [ ] **Step 4: Write `formatters.ts`:**

```ts
import { formatMoney, formatDate } from "@/lib/format"
import type { FieldSpec, FormatCtx, Tx } from "./types"

type Fmt = NonNullable<FieldSpec["format"]>

export function money(currencyField = "currency"): Fmt {
  return (v, c) => formatMoney(v as string, (c.record[currencyField] as string) ?? "MYR")
}
export function date(): Fmt {
  return (v) => formatDate(v as string)
}
export function enumLabel(map: Record<string, string>): Fmt {
  return (v) => (v == null ? "—" : (map[String(v)] ?? String(v)))
}
/** loader(tx, id) → display name (or null). Resolves at capture time. */
export function fk(loader: (tx: Tx, id: string) => Promise<string | null>): Fmt {
  return async (v, c) => (v == null ? "—" : (await loader(c.tx, String(v))) ?? String(v))
}
```

- [ ] **Step 5: Run tests — expect PASS.** Run: `npx vitest run tests/change-tracking.test.ts` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add server/services/changes/types.ts server/services/changes/formatters.ts tests/change-tracking.test.ts
git commit -m "feat(changes): change-entry types + shared formatters"
```

---

## Task 3: `diffFields` + `recordChanges` helper

**Files:**
- Create: `server/services/changes/record.ts`
- Modify: `server/services/activity.ts` (add `'update'` to `ActivityKind`)
- Test: `tests/change-tracking.test.ts`

**Interfaces:**
- Consumes: `FieldRegistry`, `ChangeEntry`, formatters (Task 2); `logActivity`, `writeAudit`.
- Produces:
  - `diffFields(registry, before, after, ctxForFormat): Promise<ChangeEntry[]>` (pure, testable)
  - `recordChanges(tx, ctx, args: { entityType: ActivityEntity; registryKey: RegistryKey; entityId: string; before: Record<string, unknown>; after: Record<string, unknown>; subject: string }): Promise<void>`

- [ ] **Step 1: Add `'update'` to `ActivityKind`** in `server/services/activity.ts` (append `| "update"` to the union).

- [ ] **Step 2: Write the failing test** (append to `tests/change-tracking.test.ts`):

```ts
import { diffFields } from "@/server/services/changes/record"

describe("diffFields", () => {
  const reg = {
    name: { label: "Name" },
    amount: { label: "Amount", format: (v: any) => `RM ${v}` },
  }
  it("reports only changed fields, formatted", async () => {
    const out = await diffFields(reg as any, { name: "A", amount: "1" }, { name: "A", amount: "2" }, { tx: {} as any })
    expect(out).toEqual([{ field: "amount", label: "Amount", from: "RM 1", to: "RM 2" }])
  })
  it("returns [] when nothing user-facing changed", async () => {
    const out = await diffFields(reg as any, { name: "A", amount: "1", updatedAt: 1 }, { name: "A", amount: "1", updatedAt: 2 }, { tx: {} as any })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 3: Run it — expect FAIL.** Run: `npx vitest run tests/change-tracking.test.ts` → FAIL.

- [ ] **Step 4: Write `record.ts`:**

```ts
import "server-only"
import type { Tx } from "@/db"
import type { ServerContext } from "@/lib/server-context"
import { logActivity, type ActivityEntity } from "@/server/services/activity"
import { writeAudit } from "@/server/audit"
import { CHANGE_FIELDS } from "./registry"
import type { ChangeEntry, FieldRegistry, RegistryKey } from "./types"

function raw(v: unknown): string {
  return v == null || v === "" ? "—" : String(v)
}

export async function diffFields(
  registry: FieldRegistry,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fmtBase: { tx: Tx }
): Promise<ChangeEntry[]> {
  const out: ChangeEntry[] = []
  for (const [field, spec] of Object.entries(registry)) {
    const b = before[field], a = after[field]
    if (String(b ?? "") === String(a ?? "")) continue
    const fmt = spec.format
    const from = fmt ? await fmt(b, { tx: fmtBase.tx, record: before }) : raw(b)
    const to = fmt ? await fmt(a, { tx: fmtBase.tx, record: after }) : raw(a)
    if (from === to) continue
    out.push({ field, label: spec.label, from, to })
  }
  return out
}

export async function recordChanges(
  tx: Tx,
  ctx: ServerContext,
  args: {
    entityType: ActivityEntity
    registryKey: RegistryKey
    entityId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
    subject: string
  }
): Promise<void> {
  const registry = CHANGE_FIELDS[args.registryKey]
  const changes = await diffFields(registry, args.before, args.after, { tx })
  if (changes.length === 0) return
  await writeAudit(tx, ctx, {
    action: `${args.registryKey}.updated`,
    entityType: args.registryKey,
    entityId: args.entityId,
    before: args.before,
    after: args.after,
  })
  await logActivity(tx, ctx, {
    entityType: args.entityType,
    entityId: args.entityId,
    type: "update",
    subject: args.subject,
    changes,
  })
}
```

- [ ] **Step 5: Extend `logActivity`** in `server/services/activity.ts` to accept and persist `changes`: add `changes?: ChangeEntry[] | null` to its `input` type and `changes: input.changes ?? null` to the `tx.insert(activities).values({…})`. Import `type { ChangeEntry } from "./changes/types"`.

- [ ] **Step 6: Run tests — expect PASS.** Run: `npx vitest run tests/change-tracking.test.ts` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add server/services/changes/record.ts server/services/activity.ts tests/change-tracking.test.ts
git commit -m "feat(changes): diffFields + recordChanges helper"
```

---

## Task 4: Registry + funnel rollout (the vertical slice)

**Files:**
- Create: `server/services/changes/registry.ts`
- Modify: `app/(app)/funnel/actions.ts` (`updateOpportunity`, ~L917–932)
- Test: `tests/change-tracking.test.ts`

**Interfaces:**
- Consumes: formatters, `diffFields` (Tasks 2–3).
- Produces: `CHANGE_FIELDS` with a `funnel` entry; FK loaders `memberName`, `accountName`, `stageLabel`.

- [ ] **Step 1: Write `registry.ts`** with the shared FK loaders and the funnel field set. (Confirm exact column names against `db/schema/pipeline.ts` while implementing; the fields below are the user-facing set.)

```ts
import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { member, user, accounts, pipelineStages } from "@/db/schema"
import { money, date, enumLabel, fk } from "./formatters"
import type { FieldRegistry, RegistryKey } from "./types"

async function memberName(tx: Tx, id: string) {
  const [r] = await tx.select({ n: user.name }).from(member)
    .leftJoin(user, eq(member.userId, user.id)).where(eq(member.id, id)).limit(1)
  return r?.n ?? null
}
async function accountName(tx: Tx, id: string) {
  const [r] = await tx.select({ n: accounts.name }).from(accounts).where(eq(accounts.id, id)).limit(1)
  return r?.n ?? null
}
async function stageLabel(tx: Tx, id: string) {
  const [r] = await tx.select({ n: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1)
  return r?.n ?? null
}

const STATUS = { open: "Open", won: "Won", lost: "Lost", on_hold: "On hold" }

export const CHANGE_FIELDS: Record<RegistryKey, FieldRegistry> = {
  funnel: {
    name: { label: "Name" },
    amount: { label: "Amount", format: money() },
    estimatedAmount: { label: "Estimated amount", format: money() },
    currentStageId: { label: "Stage", format: fk(stageLabel) },
    ownerMemberId: { label: "Owner", format: fk(memberName) },
    accountId: { label: "Account", format: fk(accountName) },
    status: { label: "Status", format: enumLabel(STATUS) },
    expectedCloseDate: { label: "Expected close", format: date() },
    projectNatureCode: { label: "Project nature" },
    lostReason: { label: "Lost reason" },
    kivReviewDate: { label: "KIV review", format: date() },
    isRenewal: { label: "Renewal" },
  },
  // Other entities added in later tasks.
  opportunity: {}, account: {}, person: {}, lead: {}, project: {}, finance_doc: {},
}
```

- [ ] **Step 2: Swap the funnel update action.** In `app/(app)/funnel/actions.ts#updateOpportunity`, the block that currently reads `existing` then writes `writeAudit({… before:{name,estimatedAmount} …})` + `logActivity({type:"system", subject:"Funnel updated"})` (~L917–932) becomes a single call. `existing` is the pre-update row already fetched above; build the `after` from the same values written in the `.set({…})`:

```ts
import { recordChanges } from "@/server/services/changes/record"
// … replace the writeAudit + logActivity pair with:
await recordChanges(tx, ctx, {
  entityType: "opportunity",
  registryKey: "funnel",
  entityId: id,
  before: existing,
  after: { ...existing, ...updated }, // `updated` = the object passed to .set()
  subject: "Funnel updated",
})
```
(Assign the object you pass to `.set(...)` to a `const updated = {…}` so it can be spread into `after`.)

- [ ] **Step 3: Run the whole test file + typecheck.** Run: `npx vitest run tests/change-tracking.test.ts && npx tsc --noEmit` → PASS / no new errors.

- [ ] **Step 4: Verify end-to-end** (real app): edit a demo funnel's stage + amount, confirm a `type='update'` activity row exists with a `changes` array:

Run: `ssh internalops@10.1.10.26 "docker exec crm-v2-db-1 psql -U postgres -d crm -Atc \"select type, subject, jsonb_pretty(changes) from activities where type='update' order by occurred_at desc limit 1\""`
Expected: one row with `changes` listing the fields you edited, `from`/`to` as readable labels.

- [ ] **Step 5: Commit.**

```bash
git add server/services/changes/registry.ts "app/(app)/funnel/actions.ts"
git commit -m "feat(changes): field registry + funnel update routes through recordChanges"
```

---

## Task 5: Render `update` entries in the timeline

**Files:**
- Create: `components/activity/change-list.tsx`
- Modify: `app/(app)/_shared/activity-actions.ts` (select `changes`; extend `ActivityRow`)
- Modify: `components/activity/activity-timeline.tsx` (icon/label + render)

**Interfaces:**
- Consumes: `ChangeEntry` (Task 2), `activities.changes` (Task 1).
- Produces: `<ChangeList changes={ChangeEntry[]} />`; `ActivityRow.changes: ChangeEntry[] | null`.

- [ ] **Step 1: `change-list.tsx`** (presentational, no client hooks needed):

```tsx
import type { ChangeEntry } from "@/server/services/changes/types"

export function ChangeList({ changes }: { changes: ChangeEntry[] }) {
  if (!changes?.length) return null
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {changes.map((c) => (
        <div key={c.field} className="contents">
          <dt className="text-muted-foreground">{c.label}</dt>
          <dd>
            <span className="line-through opacity-60">{c.from}</span>
            <span className="mx-1">→</span>
            <span className="font-medium">{c.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 2: Select `changes`** in `activity-actions.ts` `listActivities` (and `listEntityTimeline`): add `changes: activities.changes,` to the `.select({…})`, add `changes: r.changes as ChangeEntry[] | null` to the returned mapping, and add `changes: ChangeEntry[] | null` to the exported `ActivityRow` type. Import `type { ChangeEntry } from "@/server/services/changes/types"`.

- [ ] **Step 3: Render in the timeline.** In `components/activity/activity-timeline.tsx`: add `update: ActivityIcon` (reuse) to `ICONS` and `update: "Updated"` to `TYPE_LABEL`; import `{ ChangeList }`; where each item's body renders, when `item.type === "update"` render `<ChangeList changes={item.changes ?? []} />` (with the subject as the header line).

- [ ] **Step 4: Typecheck + eyeball.** Run: `npx tsc --noEmit` → no new errors. Then load a funnel detail page in the app and confirm the edit shows the inline change list.

- [ ] **Step 5: Commit.**

```bash
git add components/activity/change-list.tsx components/activity/activity-timeline.tsx "app/(app)/_shared/activity-actions.ts"
git commit -m "feat(changes): render 'update' entries with a from→to change list in the timeline"
```

---

## Task 6: History tab

**Files:**
- Create: `app/(app)/_shared/change-actions.ts`
- Create: `components/activity/change-history.tsx`
- Modify: `app/(app)/funnel/[id]/funnel-detail-body.tsx` (add a "History" tab)

**Interfaces:**
- Consumes: `listActivities` pattern, `<ChangeList>`.
- Produces: `listChanges(entityType, entityId): Promise<ActivityRow[]>` (update rows only); `<ChangeHistory items={…} />`.

- [ ] **Step 1: `change-actions.ts`** — reuse `listActivities` and filter to update rows:

```ts
"use server"
import { listActivities } from "./activity-actions"
import type { ActivityEntity } from "@/server/services/activity"

export async function listChanges(entityType: ActivityEntity, entityId: string) {
  const rows = await listActivities(entityType, entityId)
  return rows.filter((r) => r.type === "update")
}
```

- [ ] **Step 2: `change-history.tsx`** — server-rendered list:

```tsx
import type { ActivityRow } from "@/app/(app)/_shared/activity-actions"
import { ChangeList } from "./change-list"
import { formatDate } from "@/lib/format"

export function ChangeHistory({ items }: { items: ActivityRow[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
  return (
    <ol className="space-y-4">
      {items.map((it) => (
        <li key={it.id} className="border-l-2 pl-3">
          <div className="text-sm">
            <span className="font-medium">{it.memberName ?? "Someone"}</span>{" "}
            <span className="text-muted-foreground">· {formatDate(it.occurredAt)}</span>
          </div>
          <ChangeList changes={it.changes ?? []} />
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 3: Add the tab.** In `funnel-detail-body.tsx`, add a "History" tab alongside the existing tabs whose panel renders `<ChangeHistory items={changes} />`; fetch `changes` via `listChanges("opportunity", funnelId)` in the page/server component and pass it down (mirror how the existing timeline items are fetched and passed).

- [ ] **Step 4: Typecheck + eyeball.** Run: `npx tsc --noEmit` → no new errors. Open a funnel → History tab shows the diffs.

- [ ] **Step 5: Commit.**

```bash
git add "app/(app)/_shared/change-actions.ts" components/activity/change-history.tsx "app/(app)/funnel/[id]/funnel-detail-body.tsx"
git commit -m "feat(changes): per-record History tab (funnel)"
```

---

## Tasks 7–11: Roll out to the remaining timeline entities

For each entity below, the work is identical to Tasks 4+6: **(a)** fill its `CHANGE_FIELDS[key]` registry with the fields listed; **(b)** replace the update action's `writeAudit(partial)`+`logActivity(generic)` with `recordChanges({ entityType, registryKey, entityId, before: existing, after: {...existing, ...updated}, subject })`; **(c)** add the History tab to its `*-detail-body.tsx` via `listChanges(entityType, id)`. Confirm each column name against the entity's schema file while implementing. One commit per entity: `feat(changes): <entity> change tracking`.

- [ ] **Task 7 — Account** (`registryKey:"account"`, `entityType:"account"`, action `app/(app)/accounts/actions.ts`, body `accounts/[id]/account-detail-body.tsx`). Fields: `name`(Name), `code`(Code), `accountType`(Type), `industry`(Industry), `isCustomer`(Customer), `ownerMemberId`(Owner→`fk(memberName)`), `parentAccountId`(Parent→`fk(accountName)`).

- [ ] **Task 8 — Person** (`"person"` / `"person"`, `persons/actions.ts`, `persons/[id]/person-detail-body.tsx`). Fields: `firstName`, `lastName`, `title`, `email`, `phone`, `isPrimary`(Primary), `accountId`(Account→`fk(accountName)`).

- [ ] **Task 9 — Lead** (`"lead"` / `"lead"`, `leads/actions.ts`, `leads/[id]/lead-detail-body.tsx`). Fields: `name`, `companyName`(Company), `email`, `phone`, `source`, `status`(Status→`enumLabel({new:"New",contacted:"Contacted",qualified:"Qualified",disqualified:"Disqualified",converted:"Converted"})`), `ownerMemberId`(Owner→`fk(memberName)`), `disqualifyReason`(Disqualify reason).

- [ ] **Task 10 — Opportunity (container)** (`"opportunity"` / `"opportunity"`, `opportunities/actions.ts`, `opportunities/[id]/opportunity-detail-body.tsx`). Fields: `name`, `accountId`(Account→`fk(accountName)`), `ownerMemberId`(Owner→`fk(memberName)`), `totalEstimatedFunnelAmount`(Est. funnel amount→`money()`), `description`(Description).

- [ ] **Task 11 — Project** (`"project"` / `"project"`, `projects/actions.ts`, `projects/[id]/project-detail-body.tsx`). Fields: `name`, `status`(Status→`enumLabel({planning:"Planning",active:"Active",on_hold:"On hold",completed:"Completed",cancelled:"Cancelled"})`), `value`(Value→`money()`), `ownerMemberId`(Owner→`fk(memberName)`), `startDate`(Start→`date()`), `projectNatureCode`(Nature). (Project module is off by default — guard the tab behind `isModuleEnabled("projects")` as the page already does.)

---

## Task 12: Guardrail test

**Files:** Modify `tests/change-tracking.test.ts`.

- [ ] **Step 1: Add a source-scan test** asserting the core update actions import `recordChanges` (prevents regressing to ad-hoc logging):

```ts
import { readFileSync } from "node:fs"
const ACTIONS = [
  "app/(app)/funnel/actions.ts",
  "app/(app)/accounts/actions.ts",
  "app/(app)/persons/actions.ts",
  "app/(app)/leads/actions.ts",
  "app/(app)/opportunities/actions.ts",
]
it.each(ACTIONS)("%s routes updates through recordChanges", (p) => {
  expect(readFileSync(p, "utf8")).toContain("recordChanges")
})
```

- [ ] **Step 2: Run — expect PASS.** Run: `npx vitest run tests/change-tracking.test.ts` → PASS.

- [ ] **Step 3: Full check + commit.**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add tests/change-tracking.test.ts
git commit -m "test(changes): guardrail — core update actions use recordChanges"
```

---

## Follow-up (out of scope for this pass)

Records without an activity timeline today — **product, quotation, sales_order, payment_milestone, settings** — need a timeline surface before change history applies. Extending to them means: add their value to the `activity_entity_type` enum, give each a timeline + History tab on its detail page, then a registry entry + `recordChanges` swap (same pattern as Tasks 7–11). Track as a separate plan.
