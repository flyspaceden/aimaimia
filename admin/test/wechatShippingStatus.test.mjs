import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('微信交易发货状态只展示给小程序微信订单并通过受权后端重试', async () => {
  const [detail, api, controller, service] = await Promise.all([
    read('../src/pages/orders/detail.tsx'),
    read('../src/api/orders.ts'),
    read('../../backend/src/modules/admin/orders/admin-orders.controller.ts'),
    read('../../backend/src/modules/shipment/wechat-shipping-outbox.service.ts'),
  ]);

  assert.match(detail, /paymentMethod === 'WECHAT_PAY'/);
  assert.match(detail, /paymentScene === 'MINI_PROGRAM'/);
  assert.match(detail, /PERMISSIONS\.ORDERS_SHIP/);
  assert.match(detail, /status === 'PENDING' \|\| status === 'PROCESSING' \? 5_000 : false/);
  assert.match(detail, /refetchIntervalInBackground: false/);
  assert.match(api, /\/wechat-shipping\/retry/);
  assert.match(controller, /@RequirePermission\('orders:ship'\)/);
  assert.match(service, /enqueueForOrderTx\(tx, orderId, \{ force: true \}\)/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});
