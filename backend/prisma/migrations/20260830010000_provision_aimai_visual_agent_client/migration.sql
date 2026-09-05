-- Provision only the built-in Aimai product adapter scope. The Visual Agent
-- schema intentionally does not seed third-party tenants or issue raw client
-- keys, but the in-process Aimai adapter still needs its fixed tenant/client
-- rows before rate cards, credit accounts, and quotes can satisfy their FKs.
--
-- This migration is idempotent and never creates a VisualAgentClientKey.
INSERT INTO "VisualAgentTenant" (
  "id", "name", "status", "metadata", "createdAt", "updatedAt"
)
VALUES (
  'aimai-product-agent',
  '爱买买商品图片智能美化',
  'ACTIVE',
  '{"managedBy":"database-migration","purpose":"built-in-product-adapter"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "status" = 'ACTIVE',
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "VisualAgentClient" (
  "id", "tenantId", "name", "adapterNamespace", "allowedAdapterTypes",
  "status", "metadata", "createdAt", "updatedAt"
)
VALUES (
  'aimai-product-adapter-v1',
  'aimai-product-agent',
  '爱买买商品图片内置适配器',
  'aimai-product',
  ARRAY['aimai-product-v1']::text[],
  'ACTIVE',
  '{"managedBy":"database-migration","internal":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "allowedAdapterTypes" = EXCLUDED."allowedAdapterTypes",
  "status" = 'ACTIVE',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "VisualAgentClient"."tenantId" = EXCLUDED."tenantId"
  AND "VisualAgentClient"."adapterNamespace" = EXCLUDED."adapterNamespace";
