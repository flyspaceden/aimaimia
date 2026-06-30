import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('seller notifications API targets seller notification endpoints', () => {
  const source = read('src/api/notifications.ts');

  assert.match(source, /export type NotificationItem/);
  assert.match(source, /params\?: NotificationListParams/);
  assert.match(source, /client\.get\('\/seller\/notifications', \{ params \}\)/);
  assert.match(source, /client\.get\('\/seller\/notifications\/unread-count'\)/);
  assert.match(source, /client\.post\(`\/seller\/notifications\/\$\{id\}\/read`/);
});

test('seller notifications page maps known actions and handles unknown routes', () => {
  const source = read('src/pages/notifications/index.tsx');

  assert.match(source, /SELLER_ORDER_DETAIL/);
  assert.match(source, /SELLER_AFTER_SALE_DETAIL/);
  assert.match(source, /SELLER_PRODUCT_DETAIL/);
  assert.match(source, /NotificationsApi\.markRead/);
  assert.match(source, /message\.info\('该消息暂无可跳转页面'\)/);
});

test('seller layout and app expose the notifications entry', () => {
  const layout = read('src/layouts/SellerLayout.tsx');
  const app = read('src/App.tsx');

  assert.match(layout, /BellOutlined/);
  assert.match(layout, /NotificationsApi\.unreadCount/);
  assert.match(layout, /refetchInterval:\s*60_000/);
  assert.match(layout, /navigate\('\/notifications'\)/);
  assert.match(app, /pages\/notifications\/index/);
  assert.match(app, /path="notifications"/);
});
