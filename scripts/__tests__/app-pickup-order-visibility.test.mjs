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
  assert.match(detail, /当前 App 暂不展示取货二维码，请在微信小程序中查看一次性取货凭证/);
});

test('App keeps pickup QR and credential generation out of this compatibility slice', () => {
  const changedRuntime = [
    read('app/orders/index.tsx'),
    read('app/orders/[id].tsx'),
    read('src/components/cards/OrderCard.tsx'),
    read('src/utils/pickupOrder.ts'),
  ].join('\n');

  assert.doesNotMatch(changedRuntime, /getPickupPass|react-native-qrcode-svg|qrPayload|pickupCode/);
});
