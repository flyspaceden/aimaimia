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
});
