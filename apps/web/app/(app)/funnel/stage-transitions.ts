/** Client adapter for the shared server-authoritative transition policy. */
import {
  canTransition as sharedCanTransition,
  isTerminalKind as sharedIsTerminalKind,
  type TransitionStage,
} from "@/lib/stage-gate"

export type { TransitionStage }

export function isTerminalKind(kind: string): boolean {
  return sharedIsTerminalKind(kind)
}

/**
 * Whether a deal in `from` may move to `to`:
 *  - never to the stage it's already in,
 * The implementation delegates to the same pure policy used by the server.
 */
export function canTransition(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  return sharedCanTransition(from, to)
}

/** The subset of `stages` a deal currently in `currentStageId` may move to. */
export function selectableTargets<T extends TransitionStage>(
  stages: T[],
  currentStageId: string
): T[] {
  const from = stages.find((s) => s.id === currentStageId)
  if (!from) return []
  return stages.filter((s) => canTransition(from, s))
}
