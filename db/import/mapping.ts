/**
 * Salesforce (QM org) → crm-v2 field mapping — built against the REAL export in
 * project/QM_Data. Object model (confirmed from the data):
 *   Opportunity_ID__c  (custom)  = the Opportunity CONTAINER → crm-v2 `opportunities`
 *   Opportunity        (standard)= the FUNNEL / deal          → crm-v2 `funnels`
 *   Company__c                    = Lead's Company            → (no table; phase 2)
 *   OpportunityLineItem           = Opportunity Product        → (no table; phase 2)
 *
 * Import order below is FK-safe (parents first). The dry-run reports any CSV
 * header with no mapping here (your remaining parity gap).
 */

export type Ctx = {
  detId: (object: string, sfId: string) => string
  resolveOwner: (sfUserId: string) => string | null
  resolveStage: (sfStage: string) => { pipelineId: string; stageId: string; code: string } | null
  warn: (msg: string) => void
}

export type Xform = (value: string, ctx: Ctx) => unknown
export type FieldMap = { col: string; xform?: Xform }

export type ObjectMap = {
  object: string
  table: string
  sfId: string
  fields: Record<string, FieldMap>
  consumes?: string[]
  /** Self-reference columns applied in a 2nd UPDATE pass (parent may sort after child). */
  deferCols?: string[]
  defaults?: (row: Record<string, string>, ctx: Ctx) => Record<string, unknown>
}

// ── Transforms ───────────────────────────────────────────────────────────────
export const asText: Xform = (v) => (v === "" ? null : v)
export const asDate: Xform = (v) => (v ? v.slice(0, 10) : null)
export const asNum: Xform = (v) => (v === "" ? null : Number(v))
export const asInt: Xform = (v) => (v === "" ? null : Math.trunc(Number(v)))
export const asBool: Xform = (v) => /^(1|true|yes|x)$/i.test(v)
export const asCurrency: Xform = (v) => (v ? v.slice(0, 3).toUpperCase() : "MYR")
/** Integer with a fallback for NOT-NULL columns (version, sort_order). */
export const intOr =
  (d: number): Xform =>
  (v) => {
    const n = Math.trunc(Number(v))
    return v !== "" && Number.isFinite(n) ? n : d
  }
/** Number with a fallback for NOT-NULL numeric columns (discount). */
export const numOr =
  (d: number): Xform =>
  (v) => {
    const n = Number(v)
    return v !== "" && Number.isFinite(n) ? n : d
  }
export const ref =
  (object: string): Xform =>
  (v, ctx) =>
    v ? ctx.detId(object, v) : null
export const owner: Xform = (v, ctx) => ctx.resolveOwner(v)

/** Salesforce StageName → crm-v2 stage code (matches the real QM labels). */
export function stageCode(sfStage: string): string {
  const s = sfStage.trim().toLowerCase()
  if (s.startsWith("0e")) return "0e"
  if (s.startsWith("1d")) return "1d"
  if (s.startsWith("2c")) return "2c"
  if (s.startsWith("3b")) return "3b"
  if (s.startsWith("4a")) return "4a"
  if (s.includes("won")) return "won"
  if (s.includes("lost")) return "lost"
  if (s.includes("kiv")) return "kiv"
  return "0e"
}
const STAGE_STATUS: Record<string, "open" | "won" | "lost" | "on_hold"> = {
  "0e": "open", "1d": "open", "2c": "open", "3b": "open", "4a": "open",
  won: "won", lost: "lost", kiv: "on_hold",
}
const LEAD_STATUS: Record<string, string> = {
  new: "new", working: "contacted", contacted: "contacted",
  qualified: "qualified", unqualified: "disqualified", converted: "converted",
}
const QUOTE_STATUS: Record<string, string> = {
  draft: "draft", finalized: "sent", sent: "sent", accepted: "accepted",
  rejected: "rejected", expired: "expired",
}

// ── Registry (FK order) ──────────────────────────────────────────────────────
export const MAPPINGS: ObjectMap[] = [
  {
    object: "Account",
    table: "accounts",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      AccountNumber: { col: "code", xform: asText },
      Industry: { col: "industry", xform: asText },
      Website: { col: "website", xform: asText },
      Phone: { col: "phone", xform: asText },
      Company_Registration_No_1__c: { col: "registration_number", xform: asText },
      OwnerId: { col: "owner_member_id", xform: owner },
      Budgeting_Date__c: { col: "budgeting_date", xform: asDate },
      ParentId: { col: "parent_account_id", xform: ref("Account") },
    },
    deferCols: ["parent_account_id"],
    consumes: ["Type", "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode", "BillingCountry"],
    defaults: (r) => {
      const type = (r.Type || "").toLowerCase()
      const addr = {
        line1: r.BillingStreet || "",
        city: r.BillingCity || "",
        state: r.BillingState || "",
        postcode: r.BillingPostalCode || "",
        country: r.BillingCountry || "",
      }
      const hasAddr = Object.values(addr).some(Boolean)
      return {
        account_type: type === "reseller" ? "reseller" : "client",
        is_customer: type === "customer",
        billing_address: hasAddr ? addr : null,
      }
    },
  },
  {
    object: "Product2",
    table: "products",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      ProductCode: { col: "product_code", xform: asText },
      Description: { col: "description", xform: asText },
      IsActive: { col: "is_active", xform: asBool },
      Product_Subcategory__c: { col: "subcategory", xform: asText },
      UOM__c: { col: "uom", xform: asText },
    },
  },
  {
    object: "Contact",
    table: "persons",
    sfId: "Id",
    fields: {
      LastName: { col: "last_name", xform: asText },
      Title: { col: "title", xform: asText },
      Email: { col: "email", xform: asText },
      Phone: { col: "phone", xform: asText },
      Country__c: { col: "country", xform: asText },
      OwnerId: { col: "owner_member_id", xform: owner },
      AccountId: { col: "account_id", xform: ref("Account") },
    },
    consumes: ["FirstName"],
    defaults: (r) => ({ first_name: r.FirstName || r.LastName || "—" }),
  },
  {
    object: "Lead",
    table: "leads",
    sfId: "Id",
    fields: {
      Company_Name__c: { col: "company_name", xform: asText },
      Email: { col: "email", xform: asText },
      Phone: { col: "phone", xform: asText },
      MobilePhone: { col: "mobile", xform: asText },
      Country__c: { col: "country", xform: asText },
      LeadSource: { col: "source", xform: asText },
      OwnerId: { col: "owner_member_id", xform: owner },
      ConvertedAccountId: { col: "converted_account_id", xform: ref("Account") },
      ConvertedContactId: { col: "converted_person_id", xform: ref("Contact") },
      ConvertedOpportunityId: { col: "converted_opportunity_id", xform: ref("Opportunity") },
    },
    deferCols: ["converted_account_id", "converted_person_id", "converted_opportunity_id"],
    consumes: ["FirstName", "LastName", "Company", "Status"],
    defaults: (r) => ({
      name: [r.FirstName, r.LastName].filter(Boolean).join(" ") || r.Company || "—",
      company_name: r.Company_Name__c || r.Company || null,
      status: LEAD_STATUS[(r.Status || "").toLowerCase()] ?? "new",
    }),
  },
  {
    object: "Opportunity_ID__c",
    table: "opportunities",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      Account_Name_c__c: { col: "account_id", xform: ref("Account") },
      Opp_Contact__c: { col: "primary_person_id", xform: ref("Contact") },
      OwnerId: { col: "owner_member_id", xform: owner },
      Opportunity_Description__c: { col: "description", xform: asText },
      Pain__c: { col: "pain", xform: asText },
      Vision__c: { col: "vision", xform: asText },
      Value__c: { col: "value", xform: asText },
      Total_Estimated_Funnel_Amount__c: { col: "total_estimated_funnel_amount", xform: asNum },
      CurrencyIsoCode: { col: "currency", xform: asCurrency },
    },
    deferCols: ["primary_person_id"],
    consumes: ["Opportunity_Year__c", "Opportunity_Number__c"],
    defaults: (r) => {
      const year = Math.trunc(Number(r.Opportunity_Year__c)) || new Date(0).getUTCFullYear()
      const num = Math.trunc(Number(r.Opportunity_Number__c)) || 0
      return {
        opportunity_year: year,
        opportunity_number: num,
        code: `OPP-${year}-${String(num).padStart(4, "0")}`,
      }
    },
  },
  {
    object: "Opportunity",
    table: "funnels",
    sfId: "Id",
    fields: {
      Name: { col: "name", xform: asText },
      Opportunity__c: { col: "opportunity_id", xform: ref("Opportunity_ID__c") },
      AccountId: { col: "account_id", xform: ref("Account") },
      ContactId: { col: "primary_person_id", xform: ref("Contact") },
      OwnerId: { col: "owner_member_id", xform: owner },
      SyncedQuoteId: { col: "primary_quotation_id", xform: ref("Quote") },
      Amount: { col: "amount", xform: asNum },
      Estimated_Amount__c: { col: "estimated_amount", xform: asNum },
      Recognized_Percentage__c: { col: "recognized_percent", xform: asNum },
      Description: { col: "description", xform: asText },
      Award_Date__c: { col: "award_date", xform: asDate },
      CloseDate: { col: "expected_close_date", xform: asDate },
      Pain__c: { col: "pain", xform: asText },
      Vision__c: { col: "vision", xform: asText },
      Value__c: { col: "value", xform: asText },
      CurrencyIsoCode: { col: "currency", xform: asCurrency },
    },
    deferCols: ["primary_person_id", "primary_quotation_id"],
    consumes: ["StageName"],
    defaults: (r, ctx) => {
      const stage = ctx.resolveStage(r.StageName ?? "")
      if (!stage) { ctx.warn(`no stage for "${r.StageName}"`); return {} }
      return {
        pipeline_id: stage.pipelineId,
        current_stage_id: stage.stageId,
        status: STAGE_STATUS[stage.code] ?? "open",
      }
    },
  },
  {
    object: "Quote",
    table: "quotations",
    sfId: "Id",
    fields: {
      QuoteNumber: { col: "quote_number", xform: asText },
      OpportunityId: { col: "funnel_id", xform: ref("Opportunity") },
      Revision_Number__c: { col: "version", xform: intOr(1) },
      Date__c: { col: "quote_date", xform: asDate },
      ExpirationDate: { col: "valid_until", xform: asDate },
      Total_Excluding_Tax__c: { col: "subtotal", xform: asNum },
      Total_Discount__c: { col: "discount_total", xform: asNum },
      CurrencyIsoCode: { col: "currency", xform: asCurrency },
    },
    consumes: ["Status"],
    defaults: (r) => ({ status: QUOTE_STATUS[(r.Status || "").toLowerCase()] ?? "draft" }),
  },
  {
    object: "QuoteLineItem",
    table: "quotation_line_items",
    sfId: "Id",
    fields: {
      QuoteId: { col: "quotation_id", xform: ref("Quote") },
      Product2Id: { col: "product_id", xform: ref("Product2") },
      Quantity: { col: "quantity", xform: numOr(1) },
      UnitPrice: { col: "unit_price", xform: numOr(0) },
      Item_Discount__c: { col: "discount_percent", xform: numOr(0) },
      SortOrder: { col: "sort_order", xform: intOr(0) },
    },
    consumes: ["Description", "Description__c"],
    defaults: (r) => ({ description: r.Description__c || r.Description || "—" }),
  },
]
