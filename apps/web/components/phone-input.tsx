"use client"

import * as React from "react"
import {
  isValidPhoneNumber,
  getCountryCallingCode,
  parsePhoneNumber,
} from "react-phone-number-input"
import {
  ChevronDownIcon,
  CheckCircle2Icon,
  XCircleIcon,
  SearchIcon,
} from "lucide-react"

import { FormControl, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import "react-phone-number-input/style.css"

// ─── Country data ───────────────────────────────────────────────────────────

const FLAG_EMOJI: Record<string, string> = {
  MY: "🇲🇾", US: "🇺🇸", GB: "🇬🇧", AU: "🇦🇺", SG: "🇸🇬", IN: "🇮🇳",
  ID: "🇮🇩", TH: "🇹🇭", PH: "🇵🇭", VN: "🇻🇳", CN: "🇨🇳", HK: "🇭🇰",
  JP: "🇯🇵", KR: "🇰🇷", TW: "🇹🇼", AE: "🇦🇪", SA: "🇸🇦",
  DE: "🇩🇪", FR: "🇫🇷", NL: "🇳🇱", BE: "🇧🇪", CH: "🇨🇭",
  IT: "🇮🇹", ES: "🇪🇸", PT: "🇵🇹", PL: "🇵🇱", SE: "🇸🇪",
  NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", AT: "🇦🇹", IE: "🇮🇪",
  NZ: "🇳🇿", CA: "🇨🇦", MX: "🇲🇽", BR: "🇧🇷", AR: "🇦🇷",
  ZA: "🇿🇦", EG: "🇪🇬", NG: "🇳🇬", KE: "🇰🇪",
}

const COUNTRY_LABELS: Record<string, string> = {
  MY: "Malaysia (+60)", US: "United States (+1)", GB: "United Kingdom (+44)",
  AU: "Australia (+61)", SG: "Singapore (+65)", IN: "India (+91)",
  ID: "Indonesia (+62)", TH: "Thailand (+66)", PH: "Philippines (+63)",
  VN: "Vietnam (+84)", CN: "China (+86)", HK: "Hong Kong (+852)",
  JP: "Japan (+81)", KR: "South Korea (+82)", TW: "Taiwan (+886)",
  AE: "UAE (+971)", SA: "Saudi Arabia (+966)", DE: "Germany (+49)",
  FR: "France (+33)", NL: "Netherlands (+31)", BE: "Belgium (+32)",
  CH: "Switzerland (+41)", IT: "Italy (+39)", ES: "Spain (+34)",
  PT: "Portugal (+351)", PL: "Poland (+48)", SE: "Sweden (+46)",
  NO: "Norway (+47)", DK: "Denmark (+45)", FI: "Finland (+358)",
  AT: "Austria (+43)", IE: "Ireland (+353)", NZ: "New Zealand (+64)",
  CA: "Canada (+1)", MX: "Mexico (+52)", BR: "Brazil (+55)",
  AR: "Argentina (+54)", ZA: "South Africa (+27)", EG: "Egypt (+20)",
  NG: "Nigeria (+234)", KE: "Kenya (+254)",
}

/** Ordered list for the country dropdown — common ones first. */
const ORDERED_CODES = [
  "MY", "US", "GB", "AU", "SG", "IN", "ID", "TH", "PH", "VN",
  "CN", "HK", "JP", "KR", "TW", "AE", "SA", "DE", "FR", "NL",
  "BE", "CH", "IT", "ES", "PT", "PL", "SE", "NO", "DK", "FI",
  "AT", "IE", "NZ", "CA", "MX", "BR", "AR", "ZA", "EG", "NG", "KE",
]

// ─── Core internals ──────────────────────────────────────────────────────────

function CountryOption({ code }: { code: string }) {
  const flag = FLAG_EMOJI[code] ?? "🌐"
  const label = COUNTRY_LABELS[code]
  if (!label) return null
  const callingCode = getCountryCallingCode(code as Parameters<typeof getCountryCallingCode>[0])
  return (
    <DropdownMenuRadioItem key={code} value={code} className="text-sm">
      <span className="mr-2 shrink-0">{flag}</span>
      {label.replace(` (+${callingCode})`, "")}{" "}
      <span className="ml-1 text-muted-foreground">+{callingCode}</span>
    </DropdownMenuRadioItem>
  )
}

function callingCodeOf(country: string): string {
  try {
    return String(getCountryCallingCode(country as Parameters<typeof getCountryCallingCode>[0]))
  } catch {
    return ""
  }
}

function detectCountry(value: string): string | undefined {
  if (!value) return undefined
  try {
    const parsed = parsePhoneNumber(value)
    return parsed?.country
  } catch {
    return undefined
  }
}

// ─── PhoneInput (full FormItem wrapper) ─────────────────────────────────────

export function PhoneInput({
  value,
  onChange,
  label,
  placeholder = "+1 234 567 8900",
  defaultCountry = "MY",
  required = false,
  error,
  className,
  disabled,
}: {
  value?: string
  onChange?: (value: string) => void
  label?: string
  placeholder?: string
  /** ISO 3166-1 alpha-2 country code pre-selected from tenant settings. */
  defaultCountry?: string
  required?: boolean
  error?: string
  className?: string
  disabled?: boolean
}) {
  const [country, setCountry] = React.useState<string>(defaultCountry)
  const [touched, setTouched] = React.useState(false)

  // Detect country from incoming E.164 value and sync to state.
  const prevValueRef = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    if (prevValueRef.current === value) return
    prevValueRef.current = value
    const detected = detectCountry(value ?? "")
    if (detected && detected !== country) {
      setCountry(detected) // eslint-disable-line react-hooks/set-state-in-effect -- intentionally syncing derived country state from incoming E.164 value
    }
  }, [value, country])

  const isEmpty = !value || value.trim() === ""
  const isValid = isEmpty || isValidPhoneNumber(
    value ?? "",
    country as Parameters<typeof isValidPhoneNumber>[1]
  )
  const hasError = touched && !isEmpty && !isValid

  return (
    <FormItem className={cn("flex flex-col", className)}>
      {label && (
        <FormLabel>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </FormLabel>
      )}
      <FormControl>
        <PhoneInputInner
          value={value}
          onChange={onChange}
          country={country}
          onCountryChange={setCountry}
          placeholder={placeholder}
          disabled={disabled}
          hasError={hasError || !!error}
          flag={FLAG_EMOJI[country] ?? "🌐"}
          onBlur={() => setTouched(true)}
        />
      </FormControl>
      {(hasError || error) && (
        <FormMessage>{error ?? "Enter a valid phone number for the selected country."}</FormMessage>
      )}
    </FormItem>
  )
}

// ─── PhoneInputInner (raw input, no FormItem) ───────────────────────────────

export function PhoneInputInner({
  value,
  onChange,
  country,
  onCountryChange,
  placeholder,
  disabled,
  hasError,
  flag,
  onBlur,
  className,
}: {
  value?: string
  onChange?: (value: string) => void
  country: string
  onCountryChange: (code: string) => void
  placeholder?: string
  disabled?: boolean
  hasError: boolean
  flag: string
  // countryLabel was removed (unused)
  onBlur?: () => void
  className?: string
}) {
  const isEmpty = !value || value.trim() === ""
  const isNumberValid = isEmpty || isValidPhoneNumber(
    value ?? "",
    country as Parameters<typeof isValidPhoneNumber>[1]
  )
  const callingCode = callingCodeOf(country)
  const [countryQuery, setCountryQuery] = React.useState("")
  const filteredCodes = React.useMemo(() => {
    const q = countryQuery.trim().toLowerCase()
    if (!q) return ORDERED_CODES
    return ORDERED_CODES.filter((code) => {
      const label = (COUNTRY_LABELS[code] ?? "").toLowerCase()
      const cc = callingCodeOf(code)
      return (
        label.includes(q) ||
        code.toLowerCase().includes(q) ||
        cc === q ||
        `+${cc}` === `+${q}`
      )
    })
  }, [countryQuery])

  return (
    <div
      className={cn(
        "flex rounded-md border bg-background text-sm ring-offset-background",
        "focus-within:ring-1 focus-within:ring-ring focus-within:ring-offset-1",
        hasError ? "border-destructive focus-within:ring-destructive" : "border-input",
        disabled ? "opacity-50" : "",
        className,
      )}
    >
      {/* Country code selector */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-1 border-r border-input bg-muted/50 px-2.5 py-2 text-sm font-medium hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer rounded-l-md"
              aria-label={`Selected country: ${COUNTRY_LABELS[country] ?? country}`}
            >
              <span aria-hidden="true" className="text-base leading-none">{flag}</span>
              <span className="tabular-nums text-muted-foreground">+{callingCode}</span>
              <ChevronDownIcon className="size-3 text-muted-foreground" />
            </button>
          }
          onBlur={onBlur}
          disabled={disabled}
        />
        <DropdownMenuContent align="start" className="w-72 p-1.5">
          <div className="relative mb-1.5">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={countryQuery}
              onChange={(e) => setCountryQuery(e.target.value)}
              placeholder="Search country…"
              className="h-8 pl-7 pr-7 text-sm"
              autoFocus
            />
            {countryQuery ? (
              <button
                type="button"
                aria-label="Clear country search"
                onClick={() => setCountryQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XCircleIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredCodes.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No countries found
              </p>
            ) : (
              <DropdownMenuRadioGroup
                value={country}
                onValueChange={(code) => {
                  onCountryChange(code)
                  setCountryQuery("")
                }}
              >
                {filteredCodes.map((code) => (
                  <CountryOption key={code} code={code} />
                ))}
              </DropdownMenuRadioGroup>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Number input */}
      <input
        type="tel"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex-1 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground",
          "focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          hasError && "aria-invalid",
        )}
        aria-invalid={hasError}
      />

      {/* Live validation indicator */}
      {!isEmpty && (
        <span className="flex items-center pr-3 shrink-0">
          {isNumberValid ? (
            <CheckCircle2Icon className="size-4 text-green-500" />
          ) : (
            <XCircleIcon className="size-4 text-destructive" />
          )}
        </span>
      )}
    </div>
  )
}
