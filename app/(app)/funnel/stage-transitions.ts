/**
 * Client-side mirror of the server's stage state machine (server/services/stage.ts).
 * Keeps the funnel UI's selectable next-stage set in sync with what the server
 * will actually accept, so the board/dialog never offer an illegal move.
 */

export type TransitionStage = {
  id: string
  kind: string
  sortOrder: number
}

/** Stage kinds other than OPEN are terminal (Won / Lost / KIV-parked). */
export function isTerminalKind(kind: string): boolean {
  return kind !== "OPEN"
}

/**
 * Whether a deal in `from` may move to `to`:
 *  - never to the stage it's already in,
 *  - a terminal (closed/parked) deal can't move (reopen is a separate flow),
 *  - OPEN → OPEN must advance forward (monotonic),
 *  - OPEN → terminal (win / lose / park) is always allowed.
 */
export function canTransition(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  if (from.id === to.id) return false
  if (isTerminalKind(from.kind)) return false
  if (to.kind === "OPEN") return to.sortOrder > from.sortOrder
  return true
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
