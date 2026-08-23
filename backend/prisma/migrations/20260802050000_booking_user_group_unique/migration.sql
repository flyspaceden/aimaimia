DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Booking"
    WHERE "groupId" IS NOT NULL
    GROUP BY "userId", "groupId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce Booking(userId, groupId) uniqueness: duplicate grouped bookings require explicit review';
  END IF;
END $$;

CREATE UNIQUE INDEX "Booking_userId_groupId_key" ON "Booking"("userId", "groupId");
