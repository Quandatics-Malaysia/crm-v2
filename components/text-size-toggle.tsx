"use client"

import * as React from "react"
import { ALargeSmallIcon, CheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Per-user text-size preference. The whole UI is rem-based, so scaling the
 * root font-size scales everything proportionally — an accessibility control
 * for users who find the default too small. Persisted in localStorage and
 * applied before hydration by TEXT_SIZE_INIT in app/layout.tsx (same pattern
 * as the theme), so there is no flash of the wrong size.
 */
const SIZES = [
  { value: "default", label: "Default", className: "" },
  { value: "large", label: "Large", className: "text-scale-lg" },
  { value: "xlarge", label: "Extra large", className: "text-scale-xl" },
] as const

type TextSize = (typeof SIZES)[number]["value"]

function apply(size: TextSize) {
  const el = document.documentElement
  for (const s of SIZES) if (s.className) el.classList.remove(s.className)
  const chosen = SIZES.find((s) => s.value === size)
  if (chosen?.className) el.classList.add(chosen.className)
}

export function TextSizeToggle() {
  // Lazy init from localStorage (client only). The stored size is applied to
  // <html> before hydration by TEXT_SIZE_INIT, and the check mark only renders
  // inside the (closed-by-default) menu, so there is no hydration mismatch.
  const [size, setSize] = React.useState<TextSize>(() => {
    if (typeof window === "undefined") return "default"
    try {
      const stored = localStorage.getItem("text-size") as TextSize | null
      return stored && SIZES.some((s) => s.value === stored)
        ? stored
        : "default"
    } catch {
      return "default"
    }
  })

  function choose(next: TextSize) {
    setSize(next)
    apply(next)
    try {
      localStorage.setItem("text-size", next)
    } catch {
      // storage unavailable — the choice still applies for this page
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Text size">
            <ALargeSmallIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Text size</DropdownMenuLabel>
        {SIZES.map((s) => (
          <DropdownMenuItem key={s.value} onClick={() => choose(s.value)}>
            {s.label}
            {size === s.value ? (
              <CheckIcon className="ml-auto size-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
