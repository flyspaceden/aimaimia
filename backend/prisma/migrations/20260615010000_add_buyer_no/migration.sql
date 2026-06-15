-- Buyer public number. Internal User.id remains the primary key.
ALTER TABLE "User" ADD COLUMN "buyerNo" TEXT;

CREATE UNIQUE INDEX "User_buyerNo_key" ON "User"("buyerNo");

CREATE SEQUENCE IF NOT EXISTS buyer_no_seq
  AS BIGINT
  MINVALUE 1
  MAXVALUE 99999999999999
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;
