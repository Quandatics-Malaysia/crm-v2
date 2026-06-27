"use client"

import * as React from "react"
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

export type ComboboxOption = {
  value: string
  label: string
}

/** Searchable single-select for high-cardinality entity pickers
 *  (accounts / persons / funnels). API mirrors a controlled Select so forms can
 *  swap a plain Select for this with minimal changes. Keep Select for low-card
 *  enums (status / type / tax).
 *
 *  Pass `onCreate` to enable inline "add on the fly": when the typed query is
 *  non-empty and matches no option's label (case-insensitively), a selectable
 *  "+ Create \"<query>\"" row appears at the bottom of the list. Choosing it
 *  (click or arrow-keys + Enter) closes the list and calls `onCreate(query)`. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  disabled,
  id,
  className,
  onCreate,
  createLabel = (query) => `Create "${query}"`,
  "aria-invalid": ariaInvalid,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  id?: string
  className?: string
  /** Enable an inline "+ Create" row for an unmatched query (e.g. to open a
   *  quick-create dialog). Called with the trimmed typed text. */
  onCreate?: (query: string) => void
  /** Label for the inline create row. Defaults to `Create "<query>"`. */
  createLabel?: (query: string) => string
  "aria-invalid"?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const selected = options.find((o) => o.value === value)

  const trimmed = query.trim()
  const hasExactMatch = options.some(
    (o) => o.label.toLowerCase() === trimmed.toLowerCase()
  )
  // Show the create row only when there's a real query that doesn't already
  // name an existing option. Partial matches still surface it (intentional).
  const showCreate = !!onCreate && trimmed.length > 0 && !hasExactMatch

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setQuery("") // reset the search so the next open starts fresh
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={ariaInvalid}
            disabled={disabled}
            className={cn(
              "h-8 w-full justify-between gap-1.5 px-2.5 font-normal aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
              !selected && "text-muted-foreground",
              className
            )}
          >
            <span className="line-clamp-1 text-left">
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) p-0"
      >
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {showCreate ? null : <CommandEmpty>{emptyMessage}</CommandEmpty>}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  data-checked={option.value === value}
                  onSelect={() => {
                    onChange(option.value)
                    handleOpenChange(false)
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate ? (
              <>
                {options.length > 0 ? <CommandSeparator /> : null}
                {/* forceMount keeps the row visible regardless of cmdk's own
                    filtering; we already gate it with `showCreate`. */}
                <CommandItem
                  forceMount
                  value={trimmed}
                  onSelect={() => {
                    onCreate?.(trimmed)
                    handleOpenChange(false)
                  }}
                >
                  <PlusIcon />
                  {createLabel(trimmed)}
                </CommandItem>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
