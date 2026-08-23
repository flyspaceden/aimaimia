import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/orders/index.tsx', import.meta.url), 'utf8');

test('seller pickup tab only queries active paid pickup orders', () => {
  assert.match(
    page,
    /\{ key: 'pickup', label: '自提订单', status: 'PAID', fulfillmentMode: 'PICKUP' \}/,
  );
});

test('completed tab remains the sole queue for received pickup orders', () => {
  assert.match(
    page,
    /\{ key: 'completed', label: '已完成', status: 'DELIVERED,RECEIVED' \}/,
  );
});
