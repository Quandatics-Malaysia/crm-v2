"use client"

import * as React from "react"
import { ALargeSmall } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Per-user text-size preference: one button cycling default → large → x-large
 * (mirrors ThemeToggle — no dropdown, no state to hydrate). The stored size is
 * applied before paint by TEXT_SIZE_INIT in app/layout.tsx; the UI is
 * rem-based, so the root font-size class scales everything.
 */
const SIZES = ["default", "large", "xlarge"] as const
const CLASS: Record<string, string> = {
  large: "text-scale-lg",
  xlarge: "text-scale-xl",
}

export function TextSizeToggle() {
  function cycle() {
    const el = document.documentElement
    let current = "default"
    try {
      current = localStorage.getItem("text-size") ?? "default"
    } catch {
      // storage unavailable — infer from the applied class
      current = el.classList.contains(CLASS.xlarge)
        ? "xlarge"
        : el.classList.contains(CLASS.large)
          ? "large"
          : "default"
    }
    const next = SIZES[(SIZES.indexOf(current as (typeof SIZES)[number]) + 1) % SIZES.length]
    el.classList.remove(CLASS.large, CLASS.xlarge)
    if (CLASS[next]) el.classList.add(CLASS[next])
    try {
      localStorage.setItem("text-size", next)
    } catch {
      // ignore storage failures
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cycle text size"
      title="Text size"
      onClick={cycle}
    >
      <ALargeSmall className="size-4" />
    </Button>
  )
}
