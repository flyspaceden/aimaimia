import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('platform pickup station exposes scanner, camera, and short-code modes', () => {
  const page = read('../src/pages/pickup-verify/index.tsx');
  assert.match(page, /BrowserQRCodeReader/);
  assert.match(page, /decodeFromConstraints/);
  assert.match(page, /扫码枪 \/ 读码器/);
  assert.match(page, /电脑摄像头/);
  assert.match(page, /输入 8 位取货码/);
  assert.match(page, /平台中心仓/);
  assert.match(page, /activeResolveSessionRef/);
  assert.match(page, /preview\.companies\.map/);
});

test('platform pickup station resolves before explicit context-modal verification', () => {
  const page = read('../src/pages/pickup-verify/index.tsx');
  const api = read('../src/api/orders.ts');
  assert.match(page, /resolvePickupCredential/);
  assert.match(page, /verifyPickupCredential/);
  assert.match(page, /const \{ message, modal \} = App\.useApp\(\)/);
  assert.match(page, /modal\.confirm\(\{/);
  assert.doesNotMatch(page, /Modal\.confirm\(\{/);
  assert.match(page, /confirmationOpenRef\.current/);
  assert.match(page, /afterClose/);
  assert.match(page, /resolvedCredentialRef/);
  assert.match(page, /setCredentialInput\(''\);\s+resolvedCredentialRef\.current = credential/);
  assert.match(api, /client\.post\('\/admin\/pickup\/resolve', data\)/);
  assert.match(api, /client\.post\('\/admin\/pickup\/verify', data\)/);
});

test('platform pickup station is permission-gated in route and navigation', () => {
  const app = read('../src/App.tsx');
  const layout = read('../src/layouts/AdminLayout.tsx');
  const permissions = read('../src/constants/permissions.ts');
  assert.match(permissions, /PICKUP_FULFILLMENT_OPERATE: 'pickup_fulfillment:operate'/);
  assert.match(app, /pages\/pickup-verify\/index/);
  assert.match(app, /path="pickup-verify"/);
  assert.match(app, /permission=\{PERMISSIONS\.PICKUP_FULFILLMENT_OPERATE\}/);
  assert.match(layout, /path: '\/pickup-verify', name: '到店核销台'/);
  assert.match(layout, /PERMISSIONS\.PICKUP_FULFILLMENT_OPERATE/);
});

test('platform pickup station pins the same audited QR reader as seller', () => {
  const packageJson = JSON.parse(read('../package.json'));
  assert.equal(packageJson.dependencies['@zxing/browser'], '0.1.5');
  assert.equal(packageJson.dependencies['@zxing/library'], '0.21.3');
});
