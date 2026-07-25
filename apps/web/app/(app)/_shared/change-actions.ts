"use server"
import { listActivities } from "./activity-actions"
import type { ActivityEntity } from "@/server/services/activity"

export async function listChanges(entityType: ActivityEntity, entityId: string) {
  const rows = await listActivities(entityType, entityId)
  return rows.filter((r) => r.type === "update")
}
