"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"

import { showActionError } from "@/lib/show-action-error"
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
import {
  updateProductCodes,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import {
  PRODUCT_CODE_MAX,
  PRODUCT_SUBCATEGORY_CODE_MAX,
  type ProductCategory,
} from "@/app/(app)/settings/constants"

function ProductCodesCard({ productCodes }: { productCodes: ProductCategory[] }) {
  const [items, setItems] = React.useState<ProductCategory[]>(productCodes)
  const [categoryCode, setCategoryCode] = React.useState("")
  const [categoryName, setCategoryName] = React.useState("")
  const [subcategoryDrafts, setSubcategoryDrafts] = React.useState<
    Record<string, { code: string; name: string }>
  >({})
  const [isPending, startTransition] = React.useTransition()

  const dirty = JSON.stringify(items) !== JSON.stringify(productCodes)

  function updateCategory(index: number, patch: Partial<ProductCategory>) {
    setItems((prev) =>
      prev.map((category, currentIndex) =>
        currentIndex === index ? { ...category, ...patch } : category
      )
    )
  }

  function addCategory() {
    const code = categoryCode.trim().toUpperCase()
    const name = categoryName.trim()
    if (!code || !name) {
      toast.error("Enter a category code and display name.")
      return
    }
    if (items.some((category) => category.code.toUpperCase() === code)) {
      toast.error(`Category code "${code}" is already in the list.`)
      return
    }
    setItems((prev) => [...prev, { code, name, subcategories: [] }])
    setCategoryCode("")
    setCategoryName("")
  }

  function addSubcategory(categoryCode: string) {
    const draft = subcategoryDrafts[categoryCode] ?? { code: "", name: "" }
    const code = draft.code.trim().toUpperCase()
    const name = draft.name.trim()
    if (!code || !name) {
      toast.error("Enter a subcategory code and display name.")
      return
    }
    const categoryIndex = items.findIndex((category) => category.code === categoryCode)
    const category = items[categoryIndex]
    if (!category) return
    if (
      category.subcategories.some(
        (subcategory) => subcategory.code.toUpperCase() === code
      )
    ) {
      toast.error(`Subcategory code "${code}" is already in this category.`)
      return
    }
    updateCategory(categoryIndex, {
      subcategories: [...category.subcategories, { code, name }],
    })
    setSubcategoryDrafts((prev) => ({ ...prev, [categoryCode]: { code: "", name: "" } }))
  }

  function save() {
    startTransition(async () => {
      const res = await updateProductCodes(items)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setItems(res.data)
      toast.success("Product taxonomy saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product taxonomy</CardTitle>
        <CardDescription>
          Configure product categories and their dependent subcategories. Codes
          are stable identifiers; changing a display name does not change products.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={categoryCode}
            onChange={(event) => setCategoryCode(event.target.value)}
            placeholder="Category code, e.g. COACHING"
            maxLength={PRODUCT_CODE_MAX}
            className="uppercase sm:max-w-[14rem]"
          />
          <Input
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            placeholder="Category name, e.g. Coaching"
          />
          <Button type="button" variant="outline" onClick={addCategory}>
            <Plus className="size-4" />
            Add category
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((category, categoryIndex) => {
              const draft = subcategoryDrafts[category.code] ?? { code: "", name: "" }
              return (
                <div key={category.code} className="grid gap-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={category.code}
                      onChange={(event) => updateCategory(categoryIndex, { code: event.target.value })}
                      maxLength={PRODUCT_CODE_MAX}
                      aria-label={`${category.name} category code`}
                      className="uppercase sm:max-w-[14rem]"
                    />
                    <Input
                      value={category.name}
                      onChange={(event) => updateCategory(categoryIndex, { name: event.target.value })}
                      aria-label={`${category.name} category name`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="sm:ml-auto"
                      onClick={() => setItems((prev) => prev.filter((_, index) => index !== categoryIndex))}
                      aria-label={`Archive ${category.name}`}
                    >
                      <X className="size-4" />
                      Archive
                    </Button>
                  </div>

                  <div className="grid gap-2 pl-4 sm:pl-6">
                    <p className="text-xs font-medium text-muted-foreground">Subcategories</p>
                    {category.subcategories.map((subcategory, subcategoryIndex) => (
                      <div key={`${category.code}-${subcategory.code}`} className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={subcategory.code}
                          onChange={(event) =>
                            updateCategory(categoryIndex, {
                              subcategories: category.subcategories.map((item, index) =>
                                index === subcategoryIndex ? { ...item, code: event.target.value } : item
                              ),
                            })
                          }
                          maxLength={PRODUCT_SUBCATEGORY_CODE_MAX}
                          aria-label={`${subcategory.name} subcategory code`}
                          className="uppercase sm:max-w-[14rem]"
                        />
                        <Input
                          value={subcategory.name}
                          onChange={(event) =>
                            updateCategory(categoryIndex, {
                              subcategories: category.subcategories.map((item, index) =>
                                index === subcategoryIndex ? { ...item, name: event.target.value } : item
                              ),
                            })
                          }
                          aria-label={`${subcategory.name} subcategory name`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            updateCategory(categoryIndex, {
                              subcategories: category.subcategories.filter((_, index) => index !== subcategoryIndex),
                            })
                          }
                          aria-label={`Archive ${subcategory.name}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={draft.code}
                        onChange={(event) =>
                          setSubcategoryDrafts((prev) => ({
                            ...prev,
                            [category.code]: { ...draft, code: event.target.value },
                          }))
                        }
                        maxLength={PRODUCT_SUBCATEGORY_CODE_MAX}
                        placeholder="Subcategory code"
                        className="uppercase sm:max-w-[14rem]"
                      />
                      <Input
                        value={draft.name}
                        onChange={(event) =>
                          setSubcategoryDrafts((prev) => ({
                            ...prev,
                            [category.code]: { ...draft, name: event.target.value },
                          }))
                        }
                        placeholder="Subcategory name"
                      />
                      <Button type="button" variant="outline" onClick={() => addSubcategory(category.code)}>
                        <Plus className="size-4" />
                        Add subcategory
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No product categories yet.</p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save product taxonomy"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Removal is blocked while a product uses a code</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProductCodesClient({ settings }: { settings: TenantSettingsView }) {
  return (
    <div className="grid gap-4">
      <ProductCodesCard productCodes={settings.productCodes} />
    </div>
  )
}
