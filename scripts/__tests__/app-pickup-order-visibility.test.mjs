import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('App order contract reads pickup fulfillment without adding a pickup pass credential', () => {
  const orderType = read('src/types/domain/Order.ts');

  assert.match(orderType, /export type FulfillmentMode = 'DELIVERY' \| 'PICKUP'/);
  assert.match(orderType, /pickupFulfillment\?: PickupFulfillmentSummary \| null/);
  assert.doesNotMatch(orderType, /pickupCode|qrPayload|qrImageBase64/);
});

test('App order list routes active pickup orders to details before delivery actions', () => {
  const list = read('app/orders/index.tsx');
  const pickupGuard = list.indexOf("isPickupOrder(order) && ['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)");
  const deliverySwitch = list.indexOf('switch (order.status)');

  assert.ok(pickupGuard >= 0 && pickupGuard < deliverySwitch);
  assert.match(list, /primaryLabel: '查看自提信息'/);
  assert.match(list, /secondaryLabel: '查看物流'/);
  assert.match(list, /primaryLabel: '确认收货'/);
});

test('App order detail isolates pickup from logistics, receiver editing, and buyer receive confirmation', () => {
  const detail = read('app/orders/[id].tsx');

  assert.match(detail, /const showLogistics = !isPickup/);
  assert.match(detail, /const canEditReceiverInfo = !isPickup/);
  assert.match(detail, /countdownExpiresAt=\{!isPickup/);
  assert.match(detail, /if \(!isPickup\) \{\s*primary = \{ label: '确认收货'/);
  assert.match(detail, /!isPickup && addr \?/);
  assert.match(detail, /canViewPickupPass\(order\)/);
  assert.match(detail, /orders\/pickup-pass\/\[id\]/);
  assert.doesNotMatch(detail, /请在微信小程序中查看/);
});

test('App pickup credentials remain screen-local and are withdrawn on lifecycle or request failure', () => {
  const pass = read('app/orders/pickup-pass/[id].tsx');
  assert.match(pass, /useFocusEffect/);
  assert.match(pass, /AppState.addEventListener/);
  assert.match(pass, /useAuthStore.subscribe/);
  assert.match(pass, /15_000/);
  assert.match(pass, /setEntry\(undefined\)/);
  assert.match(pass, /getPickupPass\(orderId\)/);
  assert.doesNotMatch(pass, /useQuery|AsyncStorage|writeAsStringAsync|qrPayload/);
});
