import "server-only"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { type Tx } from "@/db"
import { paymentMilestones, projects, tenantSettings } from "@/db/schema"
import { isModuleEnabled } from "@/lib/modules"
import { logActivity } from "@/server/services/activity"
import type { ServerContext } from "@/lib/server-context"

/**
 * All milestones paid → move the project to Completed (settings toggle).
 * Shared by receipt issuance, manual invoice settlement, AND manual milestone
 * edits/deletes — every path that can make the last milestone paid.
 */
// ponytail: two concurrent final receipts can each still see the other's
// milestone unpaid and both skip completion; any later milestone touch
// converges it. Serialize with a project row lock if it ever matters.
export async function maybeCompleteProject(
  tx: Tx,
  ctx: ServerContext,
  projectId: string
): Promise<void> {
  if (!isModuleEnabled("finance")) return
  const [s] = await tx
    .select({
      auto: tenantSettings.autoCompleteProjectOnPaid,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .limit(1)
  if (!s?.auto) return
  const [remaining] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.projectId, projectId),
        ne(paymentMilestones.status, "paid")
      )
    )
  const [total] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId))
  if (Number(total?.n) === 0 || Number(remaining?.n) > 0) return
  const [p] = await tx
    .update(projects)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(
        eq(projects.id, projectId),
        inArray(projects.status, ["planning", "active", "on_hold"])
      )
    )
    .returning({ id: projects.id })
  if (p) {
    await logActivity(tx, ctx, {
      entityType: "project",
      entityId: projectId,
      type: "system",
      subject: "Project completed — all milestones paid",
    })
  }
}
