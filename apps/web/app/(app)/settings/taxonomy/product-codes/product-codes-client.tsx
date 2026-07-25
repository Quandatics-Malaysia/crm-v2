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
  updateProductCodes,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import {
  PRODUCT_CODE_MAX,
  normalizeProductCode,
  validateProductCode,
  type ProductCode,
} from "@/app/(app)/settings/constants"

// ─── Product codes ───────────────────────────────────────────────────────────

function ProductCodesCard({ productCodes }: { productCodes: ProductCode[] }) {
  const [items, setItems] = React.useState<ProductCode[]>(productCodes)
  const [codeDraft, setCodeDraft] = React.useState("")
  const [nameDraft, setNameDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== productCodes.length) return true
    return items.some(
      (v, i) => v.code !== productCodes[i].code || v.name !== productCodes[i].name
    )
  }, [items, productCodes])

  function add() {
    const code = normalizeProductCode(codeDraft)
    const name = nameDraft.trim()
    const codeError = validateProductCode(code)
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
      const res = await updateProductCodes(items)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setItems(res.data)
      toast.success("Product codes saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product codes</CardTitle>
        <CardDescription>
          The product lines available in the catalog. Each standardised product
          is classified under one of these codes (e.g.{" "}
          <span className="font-mono">COACHING</span> · Coaching).
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
            placeholder="Code, e.g. COACHING"
            maxLength={PRODUCT_CODE_MAX}
            className="uppercase sm:max-w-[12rem]"
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
            placeholder="Display name, e.g. Coaching"
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((pc) => (
              <Badge key={pc.code} variant="secondary" className="gap-1 pr-1">
                <span className="font-mono">{pc.code}</span>
                <span className="text-muted-foreground">·</span>
                {pc.name}
                <button
                  type="button"
                  onClick={() => remove(pc.code)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${pc.code}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <EmptyState title="No product codes yet." />
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save product codes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function ProductCodesClient({
  settings,
}: {
  settings: TenantSettingsView
}) {
  return (
    <div className="grid gap-4">
      <ProductCodesCard productCodes={settings.productCodes} />
    </div>
  )
}
