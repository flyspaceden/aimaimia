-- Platform-owned center warehouses can serve either every active merchant or
-- an explicitly audited subset. Merchant-owned points keep OWNER_COMPANY.
CREATE TYPE "PickupPointKind" AS ENUM ('MERCHANT', 'PLATFORM_HUB');
CREATE TYPE "PickupPointCoverage" AS ENUM ('OWNER_COMPANY', 'ALL_ACTIVE_COMPANIES', 'SELECTED_COMPANIES');

ALTER TABLE "PickupPoint"
  ADD COLUMN "kind" "PickupPointKind" NOT NULL DEFAULT 'MERCHANT',
  ADD COLUMN "coverage" "PickupPointCoverage" NOT NULL DEFAULT 'OWNER_COMPANY';

CREATE TABLE "PickupPointServiceCompany" (
  "pickupPointId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PickupPointServiceCompany_pkey" PRIMARY KEY ("pickupPointId", "companyId")
);

CREATE INDEX "PickupPoint_kind_coverage_deletedAt_isActive_idx"
  ON "PickupPoint"("kind", "coverage", "deletedAt", "isActive");
CREATE INDEX "PickupPointServiceCompany_companyId_pickupPointId_idx"
  ON "PickupPointServiceCompany"("companyId", "pickupPointId");

ALTER TABLE "PickupPointServiceCompany"
  ADD CONSTRAINT "PickupPointServiceCompany_pickupPointId_fkey"
    FOREIGN KEY ("pickupPointId") REFERENCES "PickupPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PickupPointServiceCompany_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Operation is deliberately separate from point administration and shipping.
INSERT INTO "AdminPermission" ("id", "code", "module", "action", "description") VALUES
  ('perm_pickup_fulfillment_operate', 'pickup_fulfillment:operate', 'pickup_fulfillment', 'operate', '平台备货和核销自提订单')
ON CONFLICT ("code") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description";

INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "AdminRole" r
CROSS JOIN "AdminPermission" p
WHERE r."name" = '超级管理员' AND p."code" = 'pickup_fulfillment:operate'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
