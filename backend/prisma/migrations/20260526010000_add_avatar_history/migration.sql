-- CreateTable
CREATE TABLE "AvatarHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvatarHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvatarHistory_userId_createdAt_idx" ON "AvatarHistory"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AvatarHistory" ADD CONSTRAINT "AvatarHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
