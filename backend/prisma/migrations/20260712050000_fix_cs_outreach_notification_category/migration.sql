-- Proactive customer-service invitations belong to the interaction/service
-- inbox category. Repair existing rows so current buyers can filter them too.
UPDATE "NotificationMessage"
SET "category" = 'service'
WHERE "eventType" = 'cs_outreach_invite'
  AND "category" <> 'service';
