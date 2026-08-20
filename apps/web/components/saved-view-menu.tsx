"use client"

import * as React from "react"
import { Bookmark, Copy, Pencil, Plus, RotateCcw, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  deleteView,
  duplicateView,
  listSavedViews,
  renameView,
  saveView,
  setDefaultView,
} from "@/app/(app)/_shared/saved-view-actions"
import type { SavedView, SavedViewPayload } from "@/lib/saved-views"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type DialogMode = "save" | "rename" | "duplicate"

export function SavedViewMenu({
  listKey,
  currentPayload,
  applyDefault,
  onApply,
  onReset,
}: {
  listKey: string
  currentPayload: SavedViewPayload
  applyDefault: boolean
  onApply: (payload: SavedViewPayload) => void
  onReset: () => void
}) {
  const [views, setViews] = React.useState<SavedView[]>([])
  const [selectedId, setSelectedId] = React.useState("")
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<DialogMode | null>(null)
  const [dialogName, setDialogName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const onApplyRef = React.useRef(onApply)
  const loadedListKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    onApplyRef.current = onApply
  }, [onApply])

  const selected = views.find((view) => view.id === selectedId)

  const refresh = React.useCallback(async () => {
    try {
      const next = await listSavedViews(listKey)
      setViews(next)
      if (applyDefault) {
        const defaultView = next.find((view) => view.isDefault)
        if (defaultView) {
          setSelectedId(defaultView.id)
          onApplyRef.current(defaultView.payload)
        }
      }
    } catch {
      // A table remains usable when saved-view loading is unavailable.
    }
  }, [applyDefault, listKey])

  React.useEffect(() => {
    if (loadedListKey.current === listKey) return
    loadedListKey.current = listKey
    void refresh()
  }, [listKey, refresh])

  function openDialog(mode: DialogMode, view?: SavedView) {
    setMenuOpen(false)
    setDialogMode(mode)
    setDialogName(mode === "save" ? "" : view?.name ?? "")
  }

  async function submitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialogMode || !dialogName.trim()) return
    setBusy(true)
    try {
      const result =
        dialogMode === "save"
          ? await saveView({ listKey, name: dialogName, payload: currentPayload })
          : dialogMode === "rename" && selected
            ? await renameView(selected.id, dialogName)
            : selected
              ? await duplicateView(selected.id, dialogName)
              : null
      if (!result) {
        toast.error("Select a view first")
        return
      }
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setViews((current) => {
        if (dialogMode === "save" || dialogMode === "duplicate") return [...current, result.data]
        return current.map((view) => (view.id === result.data.id ? result.data : view))
      })
      setSelectedId(result.data.id)
      setDialogMode(null)
      toast.success(dialogMode === "rename" ? "View renamed" : "View saved")
    } catch {
      toast.error("Could not save view. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function makeDefault() {
    if (!selected) return
    setBusy(true)
    try {
      const result = await setDefaultView(selected.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setViews((current) =>
        current.map((view) => ({ ...view, isDefault: view.id === result.data.id }))
      )
      toast.success("Default view updated")
    } finally {
      setBusy(false)
    }
  }

  async function removeSelected() {
    if (!selected || !window.confirm(`Delete “${selected.name}”?`)) return
    setBusy(true)
    try {
      const result = await deleteView(selected.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setViews((current) => current.filter((view) => view.id !== selected.id))
      setSelectedId("")
      toast.success("View deleted")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" aria-label="Saved views">
              <Bookmark className="size-4" />
              <span className="hidden sm:inline">Views</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={selectedId}
            onValueChange={(id) => {
              const view = views.find((candidate) => candidate.id === id)
              if (!view) return
              setSelectedId(id)
              onApply(view.payload)
            }}
          >
            {views.map((view) => (
              <DropdownMenuRadioItem key={view.id} value={view.id}>
                {view.name}
                {view.isDefault ? <Star className="ml-auto size-3 text-amber-500" /> : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {views.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => openDialog("save")}>
            <Plus /> Save current view
          </DropdownMenuItem>
          {selected ? (
            <>
              <DropdownMenuItem onClick={() => openDialog("rename", selected)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openDialog("duplicate", selected)}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || selected.isDefault} onClick={() => void makeDefault()}>
                <Star /> Set as default
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => void removeSelected()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setSelectedId("")
              onReset()
            }}
          >
            <RotateCcw /> Reset to base view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "rename" ? "Rename view" : dialogMode === "duplicate" ? "Duplicate view" : "Save view"}
            </DialogTitle>
            <DialogDescription>Give this table configuration a name.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDialog} className="space-y-4">
            <Input
              autoFocus
              value={dialogName}
              onChange={(event) => setDialogName(event.target.value)}
              placeholder="e.g. Open accounts"
              maxLength={100}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !dialogName.trim()}>
                {dialogMode === "duplicate" ? "Duplicate" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
