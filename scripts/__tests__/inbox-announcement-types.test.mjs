import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const inboxTypes = readFileSync('src/types/domain/Inbox.ts', 'utf8');
const inboxPage = readFileSync('app/inbox/index.tsx', 'utf8');
const inboxDetailPage = readFileSync('app/inbox/[id].tsx', 'utf8');
const inboxMock = readFileSync('src/mocks/inbox.ts', 'utf8');
const notificationRoutes = readFileSync('src/utils/notificationRoutes.ts', 'utf8');
const inboxFilters = readFileSync('src/utils/inboxFilters.ts', 'utf8');
const inboxDisplay = readFileSync('src/utils/inboxDisplay.ts', 'utf8');
const inboxRepo = readFileSync('src/repos/InboxRepo.ts', 'utf8');
const inboxController = readFileSync('backend/src/modules/inbox/inbox.controller.ts', 'utf8');
const notificationMessages = readFileSync('backend/src/modules/notification/notification-message.service.ts', 'utf8');
const notificationSchema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const softDeleteMigrationPath = 'backend/prisma/migrations/20260711160000_notification_message_soft_delete/migration.sql';
const outreachCategoryMigrationPath = 'backend/prisma/migrations/20260712050000_fix_cs_outreach_notification_category/migration.sql';
const outreachService = readFileSync('backend/src/modules/customer-service/cs-outreach.service.ts', 'utf8');

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
  assert.match(inboxMock, /category: 'service'[\s\S]*cs_outreach_invite/);
  assert.match(inboxMock, /\/cs/);
});

test('buyer inbox route resolver includes announcement-friendly pages', () => {
  assert.match(notificationRoutes, /'\/group-buy'/);
  assert.match(notificationRoutes, /'\/coupon-center'/);
  assert.match(inboxDetailPage, /resolveBuyerNotificationRoute/);
  assert.match(notificationRoutes, /PRODUCT_DETAIL:\s*'\/product\/\[id\]'/);
});

test('buyer inbox filters are controlled by category and unread chips without a reset button', () => {
  assert.match(inboxFilters, /activeTab:\s*'all'/);
  assert.match(inboxFilters, /unreadOnly:\s*false/);
  assert.match(inboxPage, /setFilters\(resetInboxFilters\(\)\)/);
  assert.doesNotMatch(inboxPage, /accessibilityLabel="重置消息筛选"/);
  assert.doesNotMatch(inboxPage, />重置筛选<\/Text>/);
});

test('buyer inbox opens a message detail before offering the target action', () => {
  assert.match(inboxPage, /pathname: '\/inbox\/\[id\]'/);
  assert.match(inboxDetailPage, /InboxRepo\.getMessage/);
  assert.match(inboxDetailPage, /formatInboxDetailTimestamp/);
  assert.match(inboxDetailPage, /getBuyerNotificationActionLabel/);
  assert.match(inboxDetailPage, /router\.push\(targetRoute/);
  assert.match(inboxDetailPage, /message\.content/);
  assert.match(inboxController, /@Get\(':id'\)/);
  assert.match(notificationMessages, /async getOne\(recipientKey: string, id: string\)/);
});

test('buyer inbox explains swipe deletion and classifies customer-service outreach as interaction', () => {
  assert.match(inboxPage, /消息向左滑动删除/);
  assert.match(outreachService, /category: 'service'[\s\S]*eventType: 'cs_outreach_invite'/);
  assert.equal(existsSync(outreachCategoryMigrationPath), true);
  const migration = readFileSync(outreachCategoryMigrationPath, 'utf8');
  assert.match(migration, /"eventType" = 'cs_outreach_invite'/);
  assert.match(migration, /SET "category" = 'service'/);
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
