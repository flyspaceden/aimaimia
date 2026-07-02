import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const helperPath = 'admin/src/pages/coupons/campaign-status-tabs.ts';
const pagePath = 'admin/src/pages/coupons/campaigns.tsx';
const helper = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : '';
const page = readFileSync(pagePath, 'utf8');

test('coupon campaign list defaults to active status tab', () => {
  assert.match(helper, /DEFAULT_CAMPAIGN_STATUS_TAB[^=]*=\s*'ACTIVE'/);
  assert.match(page, /useState<CampaignStatusTabKey>\(DEFAULT_CAMPAIGN_STATUS_TAB\)/);
});

test('coupon campaign status tabs expose active paused draft ended and all buckets', () => {
  for (const label of ['进行中', '已暂停', '草稿', '已结束', '全部']) {
    assert.match(helper, new RegExp(label));
  }
});

test('coupon campaign status tabs map all bucket to no status filter', () => {
  assert.match(helper, /key:\s*'ALL'[\s\S]*?status:\s*undefined/);
  assert.match(page, /status:\s*getCampaignStatusQuery\(activeStatusTab\)/);
});

test('coupon campaign table removes status search to avoid conflicting with tabs', () => {
  const statusColumnStart = page.indexOf("dataIndex: 'status'");
  assert.notEqual(statusColumnStart, -1, 'status column should exist');
  const statusColumnSnippet = page.slice(statusColumnStart, statusColumnStart + 360);
  assert.match(statusColumnSnippet, /search:\s*false/);
});
