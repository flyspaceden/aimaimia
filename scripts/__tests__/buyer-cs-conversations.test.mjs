import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const controller = readFileSync('backend/src/modules/customer-service/cs.controller.ts', 'utf8');
const service = readFileSync('backend/src/modules/customer-service/cs.service.ts', 'utf8');
const gateway = readFileSync('backend/src/modules/customer-service/cs.gateway.ts', 'utf8');
const repo = readFileSync('src/repos/CsRepo.ts', 'utf8');
const types = readFileSync('src/types/domain/CustomerService.ts', 'utf8');
const csPage = readFileSync('app/cs/index.tsx', 'utf8');
const mePage = readFileSync('app/(tabs)/me.tsx', 'utf8');
const notificationRoutes = readFileSync('src/utils/notificationRoutes.ts', 'utf8');

test('buyer cs sessions have a read cursor for conversation unread counts', () => {
  assert.match(schema, /buyerLastReadAt\s+DateTime\?/);
  assert.equal(
    existsSync('backend/prisma/migrations/20260706020000_buyer_cs_conversation_read_cursor/migration.sql'),
    true,
  );
});

test('buyer cs API exposes conversation list and read marker endpoints', () => {
  assert.match(controller, /@Get\('sessions'\)/);
  assert.match(controller, /getBuyerSessions/);
  assert.match(controller, /@Post\('sessions\/:id\/read'\)/);
  assert.match(controller, /markBuyerSessionRead/);
  assert.match(service, /getBuyerSessionList/);
  assert.match(service, /markBuyerSessionRead/);
  assert.match(service, /unreadCount/);
});

test('buyer cs socket lets the App join a concrete session for realtime messages', () => {
  assert.match(gateway, /@SubscribeMessage\('cs:join_session'\)/);
  assert.match(gateway, /handleJoinSession/);
  assert.match(gateway, /markUserInSession/);
  assert.match(gateway, /client\.join\(`session:\$\{sessionId\}`\)/);
});

test('buyer App repo exposes customer-service conversation list operations', () => {
  assert.match(types, /CsSessionSummary/);
  assert.match(types, /unreadCount:\s*number/);
  assert.match(types, /lastMessage:\s*CsMessage \| null/);
  assert.match(repo, /listSessions/);
  assert.match(repo, /markSessionRead/);
  assert.match(repo, /\/cs\/sessions/);
});

test('buyer App shows a customer-service conversation list before opening a chat', () => {
  assert.match(csPage, /showConversationList/);
  assert.match(csPage, /CsRepo\.listSessions/);
  assert.match(csPage, /进行中/);
  assert.match(csPage, /历史对话/);
  assert.match(csPage, /unreadCount/);
  assert.match(mePage, /route:\s*'\/cs'/);
  assert.doesNotMatch(mePage, /route:\s*'\/cs\?source=MY_PAGE'/);
});

test('buyer App opens historical closed sessions in read-only closed mode', () => {
  assert.match(csPage, /params:\s*\{\s*sessionId:\s*item\.id,\s*sessionStatus:\s*item\.status\s*\}/);
  assert.match(csPage, /routeSessionStatus === 'CLOSED'/);
});

test('buyer App chat page joins the session socket and keeps polling as fallback', () => {
  assert.match(csPage, /from 'socket\.io-client'/);
  assert.match(csPage, /io\(`\$\{WS_BASE_URL\}\/cs`/);
  assert.match(csPage, /socket\.emit\('cs:join_session'/);
  assert.match(csPage, /socket\.on\('cs:message'/);
  assert.match(csPage, /CsRepo\.markSessionRead/);
  assert.match(csPage, /POLL_INTERVAL = 5000/);
  assert.match(notificationRoutes, /CS_SESSION:\s*'\/cs'/);
});
