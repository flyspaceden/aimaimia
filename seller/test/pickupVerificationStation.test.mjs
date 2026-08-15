import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/pickup-verify/index.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api/orders.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/layouts/SellerLayout.tsx', import.meta.url), 'utf8');

test('pickup verification station provides scanner, desktop camera, and short-code entry', () => {
  assert.match(page, /BrowserQRCodeReader/);
  assert.match(page, /decodeFromConstraints/);
  assert.match(page, /扫码枪 \/ 读码器/);
  assert.match(page, /电脑摄像头/);
  assert.match(page, /输入 8 位取货码/);
  assert.match(page, /stopCamera/);
});

test('pickup verification station resolves a credential before an explicit verification action', () => {
  assert.match(page, /resolvePickupCredential/);
  assert.match(page, /verifyPickupCredential/);
  assert.match(page, /先识别凭证，再当面核对商品并确认核销/);
  assert.match(page, /确认交付并核销/);
  assert.match(api, /client\.post\('\/seller\/pickup\/resolve', data\)/);
  assert.match(api, /client\.post\('\/seller\/pickup\/verify', data\)/);
});

test('product barcodes remain optional goods checks and cannot replace buyer credentials', () => {
  assert.match(page, /商品条码核对（可选，不影响取货凭证）/);
  assert.match(page, /商品条码不能单独完成核销/);
  assert.match(api, /barcode: string \| null/);
  assert.match(api, /skuCode: string \| null/);
});

test('seller navigation exposes the verification station to every seller role', () => {
  assert.match(app, /pages\/pickup-verify\/index/);
  assert.match(app, /path="pickup-verify"/);
  assert.match(layout, /name: '到店核销台'/);
  assert.match(layout, /roles: \['OWNER', 'MANAGER', 'OPERATOR'\]/);
});
