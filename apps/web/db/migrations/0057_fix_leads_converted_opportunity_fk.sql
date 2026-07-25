-- leads.converted_opportunity_id's FK survived the 0047 opportunity/funnel
-- remodel pointing at the OLD "opportunities" table (renamed to "funnels"),
-- not the new Opportunity CONTAINER table — despite 0047's comment claiming
-- otherwise. server/services/conversion.ts writes the container's id here,
-- so every lead conversion that creates an Opportunity fails this FK.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_converted_opportunity_id_opportunities_id_fk";
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_opportunity_id_opportunities_id_fk"
  FOREIGN KEY ("converted_opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL;
