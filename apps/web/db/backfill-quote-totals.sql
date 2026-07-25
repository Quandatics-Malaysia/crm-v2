-- Backfill quotation line + header money columns for the Salesforce import.
--
-- The SF export carries only Quantity, UnitPrice and Item_Discount__c (an
-- ABSOLUTE per-line discount amount, stored in the legacy `discount_percent`
-- column which the schema maps to `discountAmount`). It has NO per-line
-- subtotal/tax/total and NO quote grand-total, and its Tax column is 0 for
-- every quote — so the importer left line_subtotal/line_tax/line_total and
-- quotations.total at 0. This recomputes them with the app's own convention
-- (server/services/quotation-math.ts): line net = max(0, qty*price - discount),
-- tax = 0, total = subtotal - header discount.

begin;

-- 1. Per-line: net = max(0, qty*unit_price - discountAmount); tax 0.
update quotation_line_items set
  line_subtotal = round(greatest(0,
    quantity * unit_price - coalesce(discount_percent, 0)), 2),
  line_tax = 0,
  line_total = round(greatest(0,
    quantity * unit_price - coalesce(discount_percent, 0)), 2),
  updated_at = now();

-- 2. Header: keep SF-provided subtotal + discount_total (authoritative);
--    tax 0; grand total = subtotal - discount, floored at 0.
update quotations set
  tax_total = 0,
  total = round(greatest(0,
    coalesce(subtotal, 0) - coalesce(discount_total, 0)), 2),
  updated_at = now();

commit;
