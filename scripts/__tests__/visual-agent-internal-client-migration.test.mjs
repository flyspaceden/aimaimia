import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationPath = fileURLToPath(new URL(
  '../../backend/prisma/migrations/20260830010000_provision_aimai_visual_agent_client/migration.sql',
  import.meta.url,
));
const migration = readFileSync(migrationPath, 'utf8');

test('built-in Aimai visual adapter migration provisions the exact trusted scope', () => {
  assert.match(migration, /'aimai-product-agent'/);
  assert.match(migration, /'aimai-product-adapter-v1'/);
  assert.match(migration, /'aimai-product'/);
  assert.match(migration, /ARRAY\['aimai-product-v1'\]::text\[\]/);
  assert.match(migration, /ON CONFLICT \("id"\) DO UPDATE SET/);
  assert.match(migration, /"VisualAgentClient"\."tenantId" = EXCLUDED\."tenantId"/);
  assert.match(migration, /"VisualAgentClient"\."adapterNamespace" = EXCLUDED\."adapterNamespace"/);
});

test('built-in adapter migration never provisions or exposes a raw client key', () => {
  assert.doesNotMatch(migration, /INSERT INTO "VisualAgentClientKey"/);
  assert.doesNotMatch(migration, /keyHash|keyPrefix|vag_(?:test|live)_/);
});
