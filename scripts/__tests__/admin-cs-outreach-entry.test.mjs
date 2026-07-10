import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const csApi = readFileSync('admin/src/api/cs.ts', 'utf8');
const userDetail = readFileSync('admin/src/pages/users/detail.tsx', 'utf8');
const workstation = readFileSync('admin/src/pages/cs/workstation.tsx', 'utf8');

test('admin cs API exposes proactive outreach creation', () => {
  assert.match(csApi, /createCsOutreach/);
  assert.match(csApi, /\/admin\/cs\/outreach/);
});

test('admin cs API exposes minimal buyer search for outreach', () => {
  assert.match(csApi, /searchCsOutreachBuyers/);
  assert.match(csApi, /\/admin\/cs\/buyers\/search/);
  assert.match(csApi, /CsOutreachBuyer/);
});

test('admin user detail can start a proactive buyer chat and navigate to session', () => {
  assert.match(userDetail, /联系买家/);
  assert.match(userDetail, /createCsOutreach/);
  assert.match(userDetail, /PERMISSIONS\.CS_OUTREACH/);
  assert.match(userDetail, /sessionId/);
  assert.match(userDetail, /\/cs\/workstation\?sessionId=/);
});

test('admin cs workstation accepts sessionId from URL', () => {
  assert.match(workstation, /useSearchParams/);
  assert.match(workstation, /searchParams\.get\('sessionId'\)/);
  assert.match(workstation, /setActiveSessionId/);
});

test('admin cs workstation clears URL sessionId when the active socket session ends', () => {
  assert.match(workstation, /if \(activeSessionIdRef\.current === data\.sessionId\) \{\s*selectSession\(null\);\s*\}/);
});

test('admin cs workstation labels proactive outreach sessions in Chinese', () => {
  assert.match(workstation, /ADMIN_OUTREACH:\s*'客服主动联系'/);
  assert.match(workstation, /MY_PAGE:\s*'我的咨询'/);
  assert.match(workstation, /AFTERSALE_DETAIL:\s*'售后详情页'/);
});

test('admin cs workstation can start proactive buyer chat directly', () => {
  assert.match(workstation, /联系买家/);
  assert.match(workstation, /createCsOutreach/);
  assert.match(workstation, /searchCsOutreachBuyers/);
  assert.match(workstation, /PERMISSIONS\.CS_OUTREACH/);
  assert.match(workstation, /输入买家编号、手机号或昵称/);
});

test('admin cs workstation joins the selected handling session room for realtime buyer replies', () => {
  assert.match(workstation, /socket\.emit\('cs:join_session',\s*\{\s*sessionId:\s*activeSessionId\s*\}\)/);
  assert.match(workstation, /activeSession\?\.status !== 'AGENT_HANDLING'/);
});

test('admin cs workstation outreach buyer picker suggests buyers without pressing search', () => {
  assert.match(workstation, /buyerSearchText/);
  assert.match(workstation, /debouncedBuyerSearchText/);
  assert.match(workstation, /setTimeout\(\(\) => \{/);
  assert.match(workstation, /enabled:\s*outreachOpen && buyerPickerOpen/);
  assert.match(workstation, /onChange=\{\(e\) => \{/);
  assert.doesNotMatch(workstation, /enterButton="搜索"/);
});

test('admin cs workstation outreach buyer picker opens as an input dropdown', () => {
  assert.match(workstation, /buyerPickerOpen/);
  assert.match(workstation, /onFocus=\{\(\) => setBuyerPickerOpen\(true\)\}/);
  assert.match(workstation, /\{buyerPickerOpen && \(/);
  assert.match(workstation, /position:\s*'absolute'/);
  assert.match(workstation, /setBuyerPickerOpen\(false\)/);
  assert.doesNotMatch(workstation, /minHeight:\s*132/);
  assert.doesNotMatch(workstation, /autoFocus/);
});

test('admin cs workstation session search includes buyerNo', () => {
  assert.match(workstation, /buyerNo/);
  assert.match(workstation, /buyerNo\.toLowerCase\(\)\.includes/);
});

test('admin cs workstation top search suggests outreach buyers on focus', () => {
  assert.match(workstation, /sessionSearchBuyerPickerOpen/);
  assert.match(workstation, /debouncedSessionBuyerSearchText/);
  assert.match(workstation, /queryKey:\s*\['admin', 'cs', 'session-search-buyers'/);
  assert.match(workstation, /enabled:\s*canOutreach && sessionSearchBuyerPickerOpen/);
  assert.match(workstation, /onFocus=\{\(\) => setSessionSearchBuyerPickerOpen\(true\)\}/);
  assert.match(workstation, /openOutreachModal\(buyer\)/);
});

test('admin cs workstation top buyer suggestion popup is wider than the search input', () => {
  assert.match(workstation, /SESSION_BUYER_SUGGESTION_POPUP_WIDTH\s*=\s*360/);
  assert.match(workstation, /width:\s*SESSION_BUYER_SUGGESTION_POPUP_WIDTH/);
  assert.match(workstation, /gridTemplateColumns:\s*'minmax\(0, 1fr\) auto'/);
  assert.doesNotMatch(workstation, /right:\s*0,\s*\n\s*zIndex:\s*35/);
});

test('admin cs workstation polls selected conversation only while socket is disconnected', () => {
  assert.match(workstation, /refetchInterval:\s*socketConnected \? false : 5000/);
});

test('admin cs workstation recreates socket from Zustand token and retries without a finite cap', () => {
  assert.match(workstation, /const adminToken = useAuthStore\(\(state\) => state\.token\)/);
  assert.match(workstation, /auth:\s*\{ token: adminToken \}/);
  assert.doesNotMatch(workstation, /reconnectionAttempts:\s*5/);
});

test('admin cs workstation updates active session ref synchronously and refreshes after joining room', () => {
  assert.match(workstation, /activeSessionIdRef\.current = sessionId;\s*setActiveSessionId\(sessionId\)/);
  assert.match(workstation, /socket\.on\('cs:joined'/);
  assert.match(workstation, /queryKey:\s*\['admin', 'cs', 'session', data\.sessionId\]/);
});

test('admin cs workstation only lets the assigned connected agent operate the conversation', () => {
  assert.match(workstation, /const isCurrentAgent =/);
  assert.match(workstation, /activeSession\?\.agentId === currentAdmin\?\.id/);
  assert.match(workstation, /PERMISSIONS\.CS_MANAGE/);
  assert.match(workstation, /const canOperateSession =/);
  assert.match(workstation, /pendingSessionAction === null/);
  assert.match(workstation, /disabled=\{!canOperateSession\}/);
});

test('admin cs workstation replaces optimistic messages from persisted socket ACK', () => {
  assert.match(workstation, /socket\.timeout\(10_000\)\.emit\('cs:send'/);
  assert.match(workstation, /const persistedMessage = response\.message/);
  assert.match(workstation, /m\.id === tempId \? persistedMessage : m/);
});
