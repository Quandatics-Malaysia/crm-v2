-- Link a lead to its Company__c record (readable company name lives in the
-- standard Company field; Company_Name__c is a lookup to Company__c).
ALTER TABLE "leads" ADD COLUMN "lead_company_id" uuid;
