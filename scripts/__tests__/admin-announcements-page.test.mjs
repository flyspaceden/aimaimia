import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const apiPath = 'admin/src/api/announcements.ts';
const pagePath = 'admin/src/pages/announcements/index.tsx';
const app = readFileSync('admin/src/App.tsx', 'utf8');
const layout = readFileSync('admin/src/layouts/AdminLayout.tsx', 'utf8');
const permissions = readFileSync('admin/src/constants/permissions.ts', 'utf8');

test('admin announcements API exposes list preview and publish calls', () => {
  assert.equal(existsSync(apiPath), true, 'announcements API file should exist');
  const api = readFileSync(apiPath, 'utf8');
  assert.match(api, /getAnnouncements/);
  assert.match(api, /previewAnnouncement/);
  assert.match(api, /createAnnouncement/);
  assert.match(api, /\/admin\/announcements/);
});

test('admin announcements page is routed and permission-gated in menu', () => {
  assert.match(app, /AnnouncementsPage/);
  assert.match(app, /path="announcements"/);
  assert.match(layout, /消息公告/);
  assert.match(layout, /PERMISSIONS\.ANNOUNCEMENTS_READ/);
  assert.match(permissions, /ANNOUNCEMENTS_CREATE/);
});

test('admin announcements page supports audience preview publish and history', () => {
  assert.equal(existsSync(pagePath), true, 'announcements page should exist');
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /预览受众/);
  assert.match(page, /发布公告/);
  assert.match(page, /发送历史/);
  assert.match(page, /BUYER_NOS/);
  assert.match(page, /previewAnnouncement/);
  assert.match(page, /createAnnouncement/);
});
