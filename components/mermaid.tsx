"use client"

import * as React from "react"
import { Maximize2Icon, ZoomInIcon, ZoomOutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

let seq = 0

/**
 * Client-side Mermaid renderer for the documentation flow maps, with a
 * full-screen dialog + zoom controls. The library (~1.5 MB) is
 * dynamic-imported so it only loads on /documentation pages.
 */
// ponytail: theme is read once at mount — a live theme toggle re-renders on
// navigation anyway; wire a MutationObserver if that ever matters.
export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = React.useState<string | null>(null)
  const [err, setErr] = React.useState(false)
  const [full, setFull] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const mermaid = (await import("mermaid")).default
        const dark = document.documentElement.classList.contains("dark")
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          fontFamily: "inherit",
          themeVariables: { fontSize: "14px" },
        })
        const { svg } = await mermaid.render(`mmd-${++seq}`, chart)
        if (alive) setSvg(svg)
      } catch (e) {
        console.error("[docs] mermaid render failed", e)
        if (alive) setErr(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [chart])

  if (err) {
    return (
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs">
        {chart.trim()}
      </pre>
    )
  }
  if (!svg) {
    return <div className="h-48 animate-pulse rounded-lg border bg-muted/40" />
  }
  return (
    <>
      <div className="group relative">
        <div
          className="overflow-x-auto rounded-lg border bg-card p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="absolute top-2 right-2 bg-background/80 opacity-70 backdrop-blur transition-opacity group-hover:opacity-100"
          title="Full screen"
          aria-label="View diagram full screen"
          onClick={() => setFull(true)}
        >
          <Maximize2Icon className="size-4" />
        </Button>
      </div>

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[92svh] w-[96vw] flex-col gap-3 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Diagram</DialogTitle>
          </DialogHeader>
          <ZoomableSvg svg={svg} />
        </DialogContent>
      </Dialog>
    </>
  )
}

// ponytail: button-stepped zoom + native scroll panning; add wheel/pinch
// zoom if anyone actually asks for it.
function ZoomableSvg({ svg }: { svg: string }) {
  const [z, setZ] = React.useState(1.2)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => setZ((v) => Math.max(0.4, +(v - 0.2).toFixed(1)))}
        >
          <ZoomOutIcon className="size-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(z * 100)}%
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => setZ((v) => Math.min(4, +(v + 0.2).toFixed(1)))}
        >
          <ZoomInIcon className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setZ(1.2)}>
          Reset
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          Scroll to pan
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-4">
        <div
          style={{
            transform: `scale(${z})`,
            transformOrigin: "0 0",
            width: "max-content",
          }}
          className="[&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
