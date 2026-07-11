"use client"

import * as React from "react"

/** Controlled/uncontrolled open state for dialog forms: forwards to the
 *  parent's (open, onOpenChange) pair when controlled, self-manages when the
 *  dialog owns its own trigger. */
export function useDialogOpen(
  controlledOpen?: boolean,
  onOpenChange?: (open: boolean) => void
): [boolean, (next: boolean) => void] {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next)
      else setUncontrolledOpen(next)
    },
    [isControlled, onOpenChange]
  )
  return [open, setOpen]
}
