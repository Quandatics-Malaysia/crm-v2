"use client"

import {
  MilestonesPanel as SharedMilestonesPanel,
  type MilestoneItemBase,
} from "@/components/milestones-panel"
import {
  createMilestone,
  deleteMilestone,
  reorderMilestones,
  updateMilestone,
  type MilestoneItem,
} from "../actions"

export function MilestonesPanel({
  projectId,
  milestones,
  projectValue,
  currency,
  canManage = true,
}: {
  projectId: string
  milestones: MilestoneItem[]
  projectValue: string | null
  currency: string
  /** When false the panel is read-only: no inline edits, status changes,
   * reordering, deletes, or add-row (gated on project.update). */
  canManage?: boolean
}) {
  return (
    <SharedMilestonesPanel
      milestones={milestones as MilestoneItemBase[]}
      valueCeiling={projectValue}
      valueCeilingLabel="net project value, ex-tax"
      currency={currency}
      canManage={canManage}
      onCreate={(values) => createMilestone({ projectId, ...values })}
      onUpdate={(id, values) => updateMilestone(id, values)}
      onDelete={(id) => deleteMilestone(id)}
      onReorder={(order) => reorderMilestones(projectId, order)}
    />
  )
}
