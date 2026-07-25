"use client"

import * as React from "react"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { Plus, X } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import {
  updateProjectNatures,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import {
  PROJECT_NATURE_CODE_MAX,
  normalizeProjectNatureCode,
  validateProjectNatureCode,
  type ProjectNature,
} from "@/app/(app)/settings/constants"

// ─── Project natures ───────────────────────────────────────────────────────────

function ProjectNaturesCard({ projectNatures }: { projectNatures: ProjectNature[] }) {
  const [items, setItems] = React.useState<ProjectNature[]>(projectNatures)
  const [codeDraft, setCodeDraft] = React.useState("")
  const [nameDraft, setNameDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== projectNatures.length) return true
    return items.some(
      (v, i) =>
        v.code !== projectNatures[i].code || v.name !== projectNatures[i].name
    )
  }, [items, projectNatures])

  function add() {
    const code = normalizeProjectNatureCode(codeDraft)
    const name = nameDraft.trim()
    const codeError = validateProjectNatureCode(code)
    if (codeError) {
      toast.error(codeError)
      return
    }
    if (!name) {
      toast.error("Enter a display name.")
      return
    }
    if (items.some((v) => v.code === code)) {
      toast.error(`Code "${code}" is already in the list.`)
      return
    }
    setItems((prev) => [...prev, { code, name }])
    setCodeDraft("")
    setNameDraft("")
  }

  function remove(code: string) {
    setItems((prev) => prev.filter((v) => v.code !== code))
  }

  function save() {
    startTransition(async () => {
      const res = await updateProjectNatures(items)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setItems(res.data)
      toast.success("Project natures saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project natures</CardTitle>
        <CardDescription>
          The picklist offered when creating a project. Each type has a short,
          stable code used as the project-nature segment of a project code (e.g.{" "}
          <span className="font-mono">WEB</span> in{" "}
          <span className="font-mono">2026-DEMO-ACME-WEB-001</span>).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Code, e.g. WEB"
            maxLength={PROJECT_NATURE_CODE_MAX}
            className="uppercase sm:max-w-[10rem]"
          />
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Display name, e.g. Web"
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((pt) => (
              <Badge key={pt.code} variant="secondary" className="gap-1 pr-1">
                <span className="font-mono">{pt.code}</span>
                <span className="text-muted-foreground">·</span>
                {pt.name}
                <button
                  type="button"
                  onClick={() => remove(pt.code)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${pt.code}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <EmptyState title="No project natures yet." />
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save project natures"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function ProjectNaturesClient({
  settings,
}: {
  settings: TenantSettingsView
}) {
  return (
    <div className="grid gap-4">
      <ProjectNaturesCard projectNatures={settings.projectNatures} />
    </div>
  )
}
