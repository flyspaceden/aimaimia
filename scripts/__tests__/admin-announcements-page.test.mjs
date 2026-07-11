import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const apiPath = 'admin/src/api/announcements.ts';
const pagePath = 'admin/src/pages/announcements/index.tsx';
const pageStylePath = 'admin/src/pages/announcements/index.css';
const productSelectPath = 'admin/src/components/AnnouncementProductSelect.tsx';
const app = readFileSync('admin/src/App.tsx', 'utf8');
const layout = readFileSync('admin/src/layouts/AdminLayout.tsx', 'utf8');
const permissions = readFileSync('admin/src/constants/permissions.ts', 'utf8');

test('admin announcements API exposes list preview and publish calls', () => {
  assert.equal(existsSync(apiPath), true, 'announcements API file should exist');
  const api = readFileSync(apiPath, 'utf8');
  assert.match(api, /getAnnouncements/);
  assert.match(api, /previewAnnouncement/);
  assert.match(api, /createAnnouncement/);
  assert.match(api, /getAnnouncementTargetProducts/);
  assert.match(api, /\/admin\/announcements/);
});

test('admin announcements page is routed and permission-gated in menu', () => {
  assert.match(app, /AnnouncementsPage/);
  assert.match(app, /path="announcements"/);
  assert.match(layout, /消息公告/);
  assert.match(layout, /PERMISSIONS\.ANNOUNCEMENTS_READ/);
  assert.match(permissions, /ANNOUNCEMENTS_CREATE/);
});

test('admin announcements menu item is grouped under customer service', () => {
  const operationsBlock = layout.match(/name:\s*'运营活动'[\s\S]*?name:\s*'客服中心'/)?.[0] ?? '';
  const customerServiceBlock = layout.match(/name:\s*'客服中心'[\s\S]*?name:\s*'系统管理'/)?.[0] ?? '';
  assert.doesNotMatch(operationsBlock, /\/announcements/);
  assert.match(customerServiceBlock, /\/announcements/);
  assert.match(customerServiceBlock, /PERMISSIONS\.ANNOUNCEMENTS_READ/);
  assert.match(customerServiceBlock, /permissionAny:\s*\[PERMISSIONS\.CS_READ,\s*PERMISSIONS\.ANNOUNCEMENTS_READ\]/);
  assert.match(customerServiceBlock, /path:\s*'\/cs\/workstation'[\s\S]*permission:\s*PERMISSIONS\.CS_READ/);
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

test('admin announcements page uses friendly target page choices instead of route input', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /targetPageOptions/);
  assert.match(page, /领券中心/);
  assert.match(page, /团购首页/);
  assert.match(page, /我的财库/);
  assert.match(page, /推荐中心/);
  assert.match(page, /商品详情/);
  assert.match(page, /AnnouncementProductSelect/);
  assert.match(page, /routeKey: 'PRODUCT_DETAIL'/);
  assert.doesNotMatch(page, /targetRoute/);
  assert.doesNotMatch(page, /\/product\/xxx/);
  assert.doesNotMatch(page, /\/orders\/xxx/);
});

test('announcement product picker searches buyer-visible products and loads more on scroll', () => {
  assert.equal(existsSync(productSelectPath), true, 'announcement product selector should exist');
  const productSelect = readFileSync(productSelectPath, 'utf8');
  assert.match(productSelect, /getAnnouncementTargetProducts/);
  assert.match(productSelect, /useInfiniteQuery/);
  assert.match(productSelect, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(productSelect, /onPopupScroll=\{handlePopupScroll\}/);
  assert.match(productSelect, /fetchNextPage/);
});

test('admin announcements page lets operators resize publish and history panes', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.equal(existsSync(pageStylePath), true, 'announcements page split pane styles should exist');
  const styles = readFileSync(pageStylePath, 'utf8');
  assert.match(page, /announcementFormPaneWidth/);
  assert.match(page, /role="separator"/);
  assert.match(page, /aria-label="调整发布公告和发送历史宽度"/);
  assert.match(page, /onMouseDown=\{handlePaneResizeStart\}/);
  assert.match(page, /cursor: 'col-resize'/);
  assert.match(styles, /\.announcement-pane-resizer/);
  assert.match(styles, /@media \(max-width: 1199px\)/);
  assert.doesNotMatch(page, /<Row gutter=\{16\} align="top">/);
});
