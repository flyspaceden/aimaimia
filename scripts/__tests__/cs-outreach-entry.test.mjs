import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const csPage = readFileSync('app/cs/index.tsx', 'utf8');

test('buyer cs page can enter an existing outreach session from sessionId param', () => {
  assert.match(csPage, /sessionId:\s*routeSessionId/);
  assert.match(csPage, /routeSessionId/);
  assert.match(csPage, /CsRepo\.getMessages\(routeSessionId\)/);
  assert.match(csPage, /setSessionClosed\(routeSessionStatus === 'CLOSED'\)/);
});

test('buyer cs page reloads when the routed outreach session changes', () => {
  assert.doesNotMatch(csPage, /eslint-disable-next-line react-hooks\/exhaustive-deps/);
  assert.match(csPage, /\}, \[routeSessionId, routeSessionStatus, show, source, sourceId\]\);/);
});

test('buyer cs page hides the AI welcome bubble for routed outreach sessions', () => {
  assert.match(csPage, /const showWelcomeMessage = !routeSessionId;/);
  assert.match(csPage, /\{showWelcomeMessage \? \(\s*<CsMessageBubble message=\{welcomeMessage\} \/>/);
});

test('buyer cs page hides initial quick prompts for routed outreach sessions', () => {
  assert.match(csPage, /const showInitialContent = messages\.length === 0 && !routeSessionId;/);
});
