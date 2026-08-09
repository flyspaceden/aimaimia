-- Preserve the exact verified login identity that issued each session.
-- Existing sessions remain compatible but cannot authorize identity-bound mini-program payments.
ALTER TABLE "Session" ADD COLUMN "authIdentityId" TEXT;

CREATE INDEX "Session_authIdentityId_idx" ON "Session"("authIdentityId");

ALTER TABLE "Session"
ADD CONSTRAINT "Session_authIdentityId_fkey"
FOREIGN KEY ("authIdentityId") REFERENCES "AuthIdentity"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
