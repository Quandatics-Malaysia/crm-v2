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
