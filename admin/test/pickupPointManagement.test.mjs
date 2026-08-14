import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('admin pickup point client exposes the full cross-company lifecycle contract', () => {
  const api = read('src/api/pickup-points.ts');

  assert.match(api, /companyId:\s*string/);
  assert.match(api, /isDeleted\?:\s*boolean/);
  assert.match(api, /client\.get\('\/admin\/pickup-points\/company-options'/);
  assert.match(api, /client\.post\('\/admin\/pickup-points',\s*data\)/);
  assert.match(api, /client\.patch\(`\/admin\/pickup-points\/\$\{id\}`,\s*data\)/);
  assert.match(api, /client\.delete\(`\/admin\/pickup-points\/\$\{id\}`,\s*\{\s*data:\s*\{\s*reason\s*\}\s*\}\)/);
  assert.match(api, /client\.post\(`\/admin\/pickup-points\/\$\{id\}\/restore`,\s*\{\s*reason\s*\}\)/);
});

test('admin pickup point page is gated by dedicated permissions and protects deletion', () => {
  const permissions = read('src/constants/permissions.ts');
  const routes = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');
  const roles = read('src/pages/admin/roles.tsx');
  const page = read('src/pages/pickup-points/index.tsx');

  for (const permission of ['read', 'create', 'update', 'delete']) {
    assert.match(permissions, new RegExp(`pickup_points:${permission}`));
  }
  assert.match(routes, /permission=\{PERMISSIONS\.PICKUP_POINTS_READ\}/);
  assert.match(layout, /permission:\s*PERMISSIONS\.PICKUP_POINTS_READ/);
  assert.match(roles, /pickup_points:\s*'自提点管理'/);
  assert.match(page, /permission=\{PERMISSIONS\.PICKUP_POINTS_CREATE\}/);
  assert.match(page, /permission=\{PERMISSIONS\.PICKUP_POINTS_UPDATE\}/);
  assert.match(page, /permission=\{PERMISSIONS\.PICKUP_POINTS_DELETE\}/);
  assert.match(page, /isDeleted:\s*deletedView/);
  assert.match(page, /reasonForm\.validateFields\(\)/);
  assert.match(page, /再次确认删除/);
  assert.match(page, /if \(deletedView \|\| point\.deletedAt\)[\s\S]*openLifecycleReason\('restore', point\)/);
  assert.match(page, /getPickupPointCompanyOptions/);
  assert.doesNotMatch(page, /getCompanies/);
  assert.match(page, /恢复后点位保持停用/);
});
