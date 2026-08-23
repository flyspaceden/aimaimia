-- Platform-managed pickup points use soft deletion because historical
-- PickupFulfillment rows keep a RESTRICT relation to their original point.
ALTER TABLE "PickupPoint"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByAdminId" TEXT,
  ADD COLUMN "deleteReason" VARCHAR(500);

DROP INDEX IF EXISTS "PickupPoint_companyId_isActive_idx";
CREATE INDEX "PickupPoint_companyId_deletedAt_isActive_idx"
  ON "PickupPoint"("companyId", "deletedAt", "isActive");

-- Explicit permissions let platform roles delegate point management without
-- coupling it to order shipping or company editing permissions.
INSERT INTO "AdminPermission" ("id", "code", "module", "action", "description") VALUES
  ('perm_pickup_points_read', 'pickup_points:read', 'pickup_points', 'read', '查看自提点'),
  ('perm_pickup_points_create', 'pickup_points:create', 'pickup_points', 'create', '创建自提点'),
  ('perm_pickup_points_update', 'pickup_points:update', 'pickup_points', 'update', '编辑和启停自提点'),
  ('perm_pickup_points_delete', 'pickup_points:delete', 'pickup_points', 'delete', '删除和恢复自提点')
ON CONFLICT ("code") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description";

-- Only the super-admin system role receives these permissions automatically.
-- Every other role must be explicitly granted pickup-point permissions in the
-- role-management UI so this migration never expands existing privileges.
INSERT INTO "AdminRolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT
  'rpp_' || md5(r."id" || ':' || p."id"),
  r."id",
  p."id",
  CURRENT_TIMESTAMP
FROM "AdminRole" r
CROSS JOIN "AdminPermission" p
WHERE r."name" = '超级管理员' AND p."code" LIKE 'pickup_points:%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
