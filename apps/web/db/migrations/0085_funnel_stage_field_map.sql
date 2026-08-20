-- Restore the canonical stage detail field map for existing pipelines that
-- still have the old empty/default configuration. Preserve tenant edits.
UPDATE pipeline_stages
SET required_fields = CASE code
  WHEN '0e' THEN '["vision","oppEstimatedCloseDate"]'::jsonb
  WHEN '1d' THEN '["objective","oppEstimatedBudget","oppEstimatedCloseDate"]'::jsonb
  WHEN '2c' THEN '["value","procurementStage"]'::jsonb
  WHEN '3b' THEN '["powerSponsorContact","powerSponsorBudgetLimit","procurementStage","expectedInvoice"]'::jsonb
  WHEN '4a' THEN '["negotiationDone","negotiationDate","projectYear","expectedInvoice"]'::jsonb
  WHEN 'won' THEN '["awardDate","purchaseOrderNumber","contract"]'::jsonb
  ELSE required_fields
END
WHERE jsonb_array_length(required_fields) = 0
   OR (code = '0e' AND required_fields = '["vision"]'::jsonb)
   OR (code = '1d' AND required_fields = '["vision","objective","ownerBudgetLimit","oppEstimatedBudget","oppEstimatedCloseDate","ownerContact"]'::jsonb)
   OR (code = '4a' AND required_fields = '["vision","objective","ownerBudgetLimit","oppEstimatedBudget","oppEstimatedCloseDate","ownerContact","value","procurementStage","powerSponsorContact","powerSponsorBudgetLimit","negotiationDone","negotiationDate","expectedInvoice"]'::jsonb);

ALTER TABLE funnels ADD COLUMN IF NOT EXISTS purchase_order_number text;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS contract text;
