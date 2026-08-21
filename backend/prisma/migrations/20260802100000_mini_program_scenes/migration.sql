CREATE TABLE "MiniProgramScene" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetPath" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "generatedCount" INTEGER NOT NULL DEFAULT 0,
  "lastGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniProgramScene_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiniProgramScene_token_key" ON "MiniProgramScene"("token");
CREATE INDEX "MiniProgramScene_ownerUserId_kind_payloadHash_expiresAt_idx" ON "MiniProgramScene"("ownerUserId", "kind", "payloadHash", "expiresAt");
CREATE INDEX "MiniProgramScene_expiresAt_idx" ON "MiniProgramScene"("expiresAt");
ALTER TABLE "MiniProgramScene" ADD CONSTRAINT "MiniProgramScene_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
