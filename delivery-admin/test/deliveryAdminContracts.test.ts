import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (path: string) => readFileSync(join(root, path), 'utf8');

const collectFiles = (dir: string): string[] => {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute).flatMap((entry) => {
    const fullPath = join(absolute, entry);
    const relPath = relative(root, fullPath);
    return statSync(fullPath).isDirectory() ? collectFiles(relPath) : [relPath];
  });
};

test('delivery admin active routes expose only delivery management modules', () => {
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  for (const route of [
    'stats',
    'users',
    'units',
    'merchants',
    'merchant-applications',
    'products',
    'pricing-rules',
    'orders',
    'shipping-records',
    'abnormal-payments',
    'manifests',
    'settlements',
    'customer-service',
    'audit',
    'config',
  ]) {
    assert.match(app, new RegExp(route.replace('/', '\\/')));
  }

  for (const forbidden of [
    'after-sale',
    'bonus',
    'vip',
    'coupons',
    'lottery',
    'digital-assets',
    'refund',
    '售后',
    '退款',
    'VIP',
    '红包',
    '抽奖',
    '数字资产',
  ]) {
    assert.doesNotMatch(app, new RegExp(forbidden, 'i'), `App exposes ${forbidden}`);
    assert.doesNotMatch(layout, new RegExp(forbidden, 'i'), `Layout exposes ${forbidden}`);
  }
});

test('delivery admin active API clients stay in the delivery-admin namespace', () => {
  for (const file of ['src/api/auth.ts', 'src/api/delivery-management.ts']) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /client\.(get|post|patch|put|delete)\(['"`](?!\/delivery-admin\/)/,
      file,
    );
    assert.doesNotMatch(source, /\/admin\//, `${file} should not call main admin namespace`);
    assert.doesNotMatch(source, /\/delivery-seller\//, `${file} should not call seller namespace`);
  }
});

test('delivery admin source tree does not keep inactive main-admin modules', () => {
  assert.deepEqual(
    readdirSync(join(root, 'src/pages')).sort(),
    ['account-security', 'delivery-admin', 'login'],
  );

  assert.deepEqual(
    readdirSync(join(root, 'src/api')).sort(),
    ['auth.ts', 'client.ts', 'delivery-management.ts'],
  );

  for (const removedPath of ['src/components', 'src/constants']) {
    assert.equal(existsSync(join(root, removedPath)), false, `${removedPath} should not exist in delivery admin`);
  }

  const forbidden = [
    'after-sale',
    'bonus',
    'coupon',
    'coupons',
    'vip',
    'lottery',
    'digital-assets',
    'reward-products',
    'refund',
    '售后',
    '退款',
    'VIP',
    '红包',
    '抽奖',
    '数字资产',
  ];

  for (const file of collectFiles('src')) {
    if (!/\.(ts|tsx)$/.test(file)) {
      continue;
    }
    const source = read(file);
    for (const token of forbidden) {
      assert.doesNotMatch(source, new RegExp(token, 'i'), `${file} contains legacy token ${token}`);
    }
  }
});

test('delivery admin keeps a logged-in switch back to the main ai-maimai admin', () => {
  const layout = read('src/layouts/AdminLayout.tsx');
  assert.match(layout, /切换爱买买管理后台/);
  assert.match(layout, /admin\.ai-maimai\.com/);
  assert.match(layout, /test-admin\.ai-maimai\.com/);
});
