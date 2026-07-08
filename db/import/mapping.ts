/**
 * Salesforce → crm-v2 field mapping registry (phase-1 core objects). The SF
 * column names below are best-guess standard/custom API names — the dry-run
 * (`import.ts`) reports any CSV header with NO mapping here, so you reconcile
 * this file against the client's REAL export headers before committing.
 *
 * Import order is the array order (FK-safe): parents before children.
 */

export type Ctx = {
  /** SF record Id → deterministic crm-v2 UUID (stable, so FKs + re-runs match). */
  detId: (object: string, sfId: string) => string
  /** SF User Id → crm-v2 member id (or the default import owner). */
  resolveOwner: (sfUserId: string) => string | null
  /** Resolve a funnel's pipeline stage id from a SF sales-stage value. */
  resolveStage: (sfStage: string) => { pipelineId: string; stageId: string } | null
  warn: (msg: string) => void
}

export type Xform = (value: string, ctx: Ctx) => unknown
export type FieldMap = { col: string; xform?: Xform }

export type ObjectMap = {
  /** SF object name = CSV file base name (case-insensitive match). */
  object: string
  table: string
  /** SF Id column (its value seeds the deterministic UUID). */
  sfId: string
  fields: Record<string, FieldMap>
  /** SF columns consumed by `defaults` (so they aren't reported as unmapped). */
  consumes?: string[]
  /** Constant/derived columns not present as a single SF field. */
  defaults?: (row: Record<string, string>, ctx: Ctx) => Record<string, unknown>
}

// ── Transforms ───────────────────────────────────────────────────────────────
export const asText: Xform = (v) => (v === "" ? null : v)
export const asDate: Xform = (v) => (v ? v.slice(0, 10) : null) // SF datetime → date
export const asNum: Xform = (v) => (v === "" ? null : Number(v))
export const asBool: Xform = (v) => /^(1|true|yes|x)$/i.test(v)
export const ref =
  (object: string): Xform =>
  (v, ctx) =>
    v ? ctx.detId(object, v) : null
export const owner: Xform = (v, ctx) => ctx.resolveOwner(v)
export const picklist =
  (map: Record<string, string>, fallback?: string): Xform =>
  (v, ctx) => {
    if (v === "") return fallback ?? null
    const hit = map[v.trim().toLowerCase()] ?? map[v]
    if (hit == null) {
      ctx.warn(`unmapped picklist value "${v}"`)
      return fallback ?? v
    }
    return hit
  }

// Salesforce sales-stage label → crm-v2 stage code (0e/1d/2c/3b/4a/won/lost/kiv).
const STAGE_CODE = picklist(
  {
    "0e": "0e", "identified": "0e",
    "1d": "1d", "qualified": "1d",
    "2c": "2c", "proposal": "2c",
    "3b": "3b", "negotiation": "3b",
    "4a": "4a", "commit": "4a",
    "closed won": "won", "won": "won",
    "closed lost": "lost", "lost": "lost",
    "kiv": "kiv",
  },
  "0e"
)

const OPP_STATUS = picklist(
  { open: "open", "closed won": "won", won: "won", "closed lost": "lost", lost: "lost", kiv: "on_hold" },
  "open"
)
const LEAD_STATUS = picklist(
  { new: "new", contacted: "contacted", qualified: "qualified", unqualified: "disqualified", converted: "converted" },
  "new"
)
const ACCOUNT_TYPE = picklist({ client: "client", customer: "client", reseller: "reseller", channel: "reseller" }, "client")

// ── Object registry (FK order) ───────────────────────────────────────────────
export const MAPPINGS: ObjectMap[] = [
  {
    object: "Account",
    table: "accounts",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      AccountNumber: { col: "code", xform: asText },
      Type: { col: "account_type", xform: ACCOUNT_TYPE },
      Industry: { col: "industry", xform: asText },
      Website: { col: "website", xform: asText },
      Phone: { col: "phone", xform: asText },
      OwnerId: { col: "owner_member_id", xform: owner },
      Budgeting_Date__c: { col: "budgeting_date", xform: asDate },
    },
  },
  {
    object: "Contact",
    table: "persons",
    sfId: "Id",
    fields: {
      FirstName: { col: "first_name", xform: asText },
      LastName: { col: "last_name", xform: asText },
      Title: { col: "title", xform: asText },
      Email: { col: "email", xform: asText },
      Phone: { col: "phone", xform: asText },
      MailingCountry: { col: "country", xform: asText },
      OwnerId: { col: "owner_member_id", xform: owner },
      AccountId: { col: "account_id", xform: ref("Account") },
    },
    // first_name is NOT NULL in crm-v2; SF FirstName may be blank.
    defaults: (r) => ({ first_name: r.FirstName || r.LastName || "—" }),
  },
  {
    object: "Lead",
    table: "leads",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      Company: { col: "company_name", xform: asText },
      Email: { col: "email", xform: asText },
      Phone: { col: "phone", xform: asText },
      MobilePhone: { col: "mobile", xform: asText },
      Country: { col: "country", xform: asText },
      LeadSource: { col: "source", xform: asText },
      Status: { col: "status", xform: LEAD_STATUS },
      OwnerId: { col: "owner_member_id", xform: owner },
    },
  },
  {
    object: "Opportunity",
    table: "opportunities",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      AccountId: { col: "account_id", xform: ref("Account") },
      OwnerId: { col: "owner_member_id", xform: owner },
      Opportunity_Year__c: { col: "opportunity_year", xform: asNum },
      Opportunity_Number__c: { col: "opportunity_number", xform: asNum },
      Opportunity_ID__c: { col: "code", xform: asText },
      Pain__c: { col: "pain", xform: asText },
      Power__c: { col: "power", xform: asText },
      Vision__c: { col: "vision", xform: asText },
      Value__c: { col: "value", xform: asText },
      Control__c: { col: "control", xform: asText },
      CurrencyIsoCode: { col: "currency", xform: asText },
    },
  },
  {
    object: "Funnel",
    table: "funnels",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      Opportunity__c: { col: "opportunity_id", xform: ref("Opportunity") },
      Account__c: { col: "account_id", xform: ref("Account") },
      OwnerId: { col: "owner_member_id", xform: owner },
      Estimated_Funnel_Amount__c: { col: "estimated_amount", xform: asNum },
      Quoted_Amount__c: { col: "amount", xform: asNum },
      Award_Date__c: { col: "award_date", xform: asDate },
      Estimated_Funnel_Close_Date__c: { col: "expected_close_date", xform: asDate },
      Project_Year__c: { col: "project_year", xform: asNum },
      Status: { col: "status", xform: OPP_STATUS },
      CurrencyIsoCode: { col: "currency", xform: asText },
    },
    consumes: ["Sales_Stage__c"],
    // pipeline_id + current_stage_id resolve from the SF sales stage against the
    // seeded default pipeline (see import.ts → Ctx.resolveStage).
    defaults: (r, ctx) => {
      const stage = ctx.resolveStage(r.Sales_Stage__c ?? "")
      if (!stage) { ctx.warn(`no stage for "${r.Sales_Stage__c}"`); return {} }
      return { pipeline_id: stage.pipelineId, current_stage_id: stage.stageId }
    },
  },
  {
    object: "Product",
    table: "products",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      ProductCode: { col: "product_code", xform: asText },
      Family: { col: "category", xform: asText },
      Description: { col: "description", xform: asText },
      IsActive: { col: "active", xform: asBool },
      CurrencyIsoCode: { col: "currency", xform: asText },
    },
  },
  {
    object: "Quote",
    table: "quotations",
    sfId: "Id",
    fields: {
      QuoteNumber: { col: "quote_number", xform: asText },
      Funnel__c: { col: "funnel_id", xform: ref("Funnel") },
      Status: { col: "status", xform: picklist({ draft: "draft", sent: "sent", accepted: "accepted" }, "draft") },
      Quote_Date__c: { col: "quote_date", xform: asDate },
      ExpirationDate: { col: "valid_until", xform: asDate },
      CurrencyIsoCode: { col: "currency", xform: asText },
    },
  },
  {
    object: "QuoteLineItem",
    table: "quotation_line_items",
    sfId: "Id",
    fields: {
      QuoteId: { col: "quotation_id", xform: ref("Quote") },
      Product2Id: { col: "product_id", xform: ref("Product") },
      Description: { col: "description", xform: asText },
      Quantity: { col: "quantity", xform: asNum },
      UnitPrice: { col: "unit_price", xform: asNum },
      Discount: { col: "discount_amount", xform: asNum },
    },
  },
]
