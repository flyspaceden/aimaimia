import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inboxTypes = readFileSync('src/types/domain/Inbox.ts', 'utf8');
const inboxPage = readFileSync('app/inbox/index.tsx', 'utf8');
const inboxMock = readFileSync('src/mocks/inbox.ts', 'utf8');
const notificationRoutes = readFileSync('src/utils/notificationRoutes.ts', 'utf8');

test('buyer inbox domain accepts platform announcement and outreach invitation message types', () => {
  for (const type of ['platform_announcement', 'platform_notice', 'cs_outreach_invite']) {
    assert.match(inboxTypes, new RegExp(`'${type}'`));
  }
});

test('buyer inbox renders announcement and outreach invite icons', () => {
  assert.match(inboxPage, /platform_announcement/);
  assert.match(inboxPage, /platform_notice/);
  assert.match(inboxPage, /cs_outreach_invite/);
  assert.match(inboxPage, /bullhorn-outline|bell-outline/);
  assert.match(inboxPage, /face-agent|message-account-outline/);
});

test('buyer inbox preserves and visibly marks important announcements', () => {
  assert.match(inboxTypes, /severity\?:/);
  assert.match(inboxTypes, /metadata\?:/);
  assert.match(inboxPage, /message\.severity === 'WARNING'/);
  assert.match(inboxPage, /message\.metadata\?\.priority === 'IMPORTANT'/);
  assert.match(inboxPage, />重要<\/Text>/);
});

test('buyer inbox mock data includes platform announcement and customer-service invite examples', () => {
  assert.match(inboxMock, /platform_announcement/);
  assert.match(inboxMock, /cs_outreach_invite/);
  assert.match(inboxMock, /\/cs/);
});

test('buyer inbox route resolver includes announcement-friendly pages', () => {
  assert.match(notificationRoutes, /'\/group-buy'/);
  assert.match(notificationRoutes, /'\/coupon-center'/);
  assert.match(inboxPage, /resolveBuyerNotificationRoute/);
});
