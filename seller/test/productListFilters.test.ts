import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listSource = readFileSync(resolve(__dirname, '../src/pages/products/index.tsx'), 'utf8');

test('product list exposes compact status, audit, and return policy filters', () => {
  assert.match(listSource, /Segmented/);
  assert.match(listSource, /const \[statusFilter, setStatusFilter\]/);
  assert.match(listSource, /const \[auditStatusFilter, setAuditStatusFilter\]/);
  assert.match(listSource, /const \[returnPolicyFilter, setReturnPolicyFilter\]/);
  assert.match(listSource, /商品状态/);
  assert.match(listSource, /审核状态/);
  assert.match(listSource, /退货政策/);
});

test('product list request sends combined filter params to the seller products API', () => {
  assert.match(listSource, /statusFilter !== 'ALL'/);
  assert.match(listSource, /auditStatusFilter !== 'ALL'/);
  assert.match(listSource, /returnPolicyFilter !== 'ALL'/);
  assert.match(listSource, /returnPolicy: returnPolicyFilter/);
});
