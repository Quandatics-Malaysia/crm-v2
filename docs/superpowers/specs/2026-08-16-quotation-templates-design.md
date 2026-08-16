# CC and QAR Quotation Templates

## Goal

Render the supplied CC and QAR quotation layouts in the CRM preview/print view, using the active tenant logo from application settings and preserving tenant/account template selection.

## Design

The existing `EntityQuotationDocument` remains the built-in renderer for the `cc` and `qar` template keys. Its layout will be aligned to the supplied references: A4 page, company header, quotation title, customer/meta block, entity-specific line-item columns, totals, notes, prepared-by block, and footer. The tenant logo remains loaded from `/api/tenant-logo`, so each organization uses its own uploaded logo.

The current quotation document loader will expose the account-level template code and the active tenant template registry entry. Resolution will prefer the account override, then the tenant/entity legacy code, while retaining the existing default/alias fallback. The built-in renderer will continue to handle `cc` and `qar`; external HTML/CSS registry entries remain API-ready but are outside this change.

## Data and behavior

- CC uses Item, SKU, Description, QTY, UOM, Unit Price, Subtotal, and Total Price columns.
- QAR uses No, Description, QTY, Unit Price, and Total Price columns.
- Both templates show tenant logo when one exists and omit it cleanly when absent.
- Existing quotation values are the source of truth for quote number, dates, currency, totals, notes, contact, and company profile.
- Account-level template selection must override entity identity; unregistered codes fall back safely.

## Verification

- Unit tests cover account override/legacy resolution and built-in template selection.
- `pnpm build` must exit successfully.
- The preview renderer must remain type-safe and preserve the existing default quotation view.
