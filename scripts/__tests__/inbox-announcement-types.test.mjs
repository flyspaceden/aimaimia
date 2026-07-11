import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const inboxTypes = readFileSync('src/types/domain/Inbox.ts', 'utf8');
const inboxPage = readFileSync('app/inbox/index.tsx', 'utf8');
const inboxMock = readFileSync('src/mocks/inbox.ts', 'utf8');
const notificationRoutes = readFileSync('src/utils/notificationRoutes.ts', 'utf8');
const inboxFilters = readFileSync('src/utils/inboxFilters.ts', 'utf8');
const inboxDisplay = readFileSync('src/utils/inboxDisplay.ts', 'utf8');
const inboxRepo = readFileSync('src/repos/InboxRepo.ts', 'utf8');
const inboxController = readFileSync('backend/src/modules/inbox/inbox.controller.ts', 'utf8');
const notificationMessages = readFileSync('backend/src/modules/notification/notification-message.service.ts', 'utf8');
const notificationSchema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const softDeleteMigrationPath = 'backend/prisma/migrations/20260711160000_notification_message_soft_delete/migration.sql';

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
  assert.match(notificationRoutes, /PRODUCT_DETAIL:\s*'\/product\/\[id\]'/);
});

test('buyer inbox clear filter action atomically restores all messages', () => {
  assert.match(inboxFilters, /activeTab:\s*'all'/);
  assert.match(inboxFilters, /unreadOnly:\s*false/);
  assert.match(inboxPage, /setFilters\(resetInboxFilters\(\)\)/);
  assert.match(inboxPage, /accessibilityLabel="清空消息筛选"/);
  assert.match(inboxPage, /hitSlop=\{10\}/);
});

test('buyer inbox supports single swipe deletion undo and confirmed bulk cleanup', () => {
  assert.match(inboxPage, /ReanimatedSwipeable/);
  assert.match(inboxPage, /renderRightActions/);
  assert.match(inboxPage, /trash-can-outline/);
  assert.match(inboxPage, /handleRestoreMessage/);
  assert.match(inboxPage, /清空已读消息/);
  assert.match(inboxPage, /清空全部消息/);
  assert.match(inboxPage, /confirm-all/);
  assert.match(inboxRepo, /deleteMessage/);
  assert.match(inboxRepo, /restoreMessage/);
  assert.match(inboxRepo, /deleteReadMessages/);
  assert.match(inboxRepo, /deleteAllMessages/);
  assert.match(inboxPage, /formatInboxTimestamp\(message\.createdAt\)/);
  assert.match(inboxDisplay, /sameDay/);
});

test('buyer message deletion is recipient-scoped soft deletion', () => {
  assert.equal(existsSync(softDeleteMigrationPath), true);
  const migration = readFileSync(softDeleteMigrationPath, 'utf8');
  assert.match(notificationSchema, /model NotificationMessage[\s\S]*deletedAt\s+DateTime\?/);
  assert.match(migration, /ADD COLUMN "deletedAt"/);
  assert.match(inboxController, /@Delete\('read'\)/);
  assert.match(inboxController, /@Delete\('all'\)/);
  assert.match(inboxController, /@Delete\(':id'\)/);
  assert.match(inboxController, /@Post\(':id\/restore'\)/);
  assert.match(notificationMessages, /where:\s*\{ id, recipientKey, deletedAt: null \}/);
  assert.match(notificationMessages, /where:\s*\{ recipientKey, deletedAt: null, readAt: \{ not: null \} \}/);
});
