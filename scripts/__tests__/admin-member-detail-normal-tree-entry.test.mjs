import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('admin/src/pages/bonus/member-detail.tsx', 'utf8');
const types = readFileSync('admin/src/types/index.ts', 'utf8');
const service = readFileSync('backend/src/modules/admin/bonus/admin-bonus.service.ts', 'utf8');

test('member detail receives normal tree availability from the backend', () => {
  assert.match(service, /normalTree:\s*\{[\s\S]*?hasNode:\s*!!member\?\.normalTreeNodeId/);
  assert.match(types, /normalTree:\s*\{[\s\S]*?hasNode:\s*boolean/);
});

test('member detail only shows the normal tree link for a user with a normal tree node', () => {
  assert.match(page, /const hasNormalTree = d\.normalTree\?\.hasNode === true/);
  assert.match(page, /hasNormalTree \? \([\s\S]*?buildTreeLink\('\/bonus\/normal-tree'\)[\s\S]*?: \([\s\S]*?未进入普通树/);
  assert.match(page, /尚未参与普通树奖励，暂无可查看的结构/);
});
