CREATE TABLE "CouponClaimableSeenState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CouponClaimableSeenState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CouponClaimableSeenState_userId_key" ON "CouponClaimableSeenState"("userId");
CREATE INDEX "CouponClaimableSeenState_lastSeenAt_idx" ON "CouponClaimableSeenState"("lastSeenAt");

ALTER TABLE "CouponClaimableSeenState"
  ADD CONSTRAINT "CouponClaimableSeenState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
