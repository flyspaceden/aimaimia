import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('admin/src/pages/digital-assets/index.tsx', 'utf8');
const api = readFileSync('admin/src/api/digital-assets.ts', 'utf8');
const types = readFileSync('admin/src/types/index.ts', 'utf8');

test('admin digital asset account table exposes sortable numeric columns', () => {
  for (const field of [
    'totalAssetBalance',
    'seedAssetBalance',
    'creditAssetBalance',
    'frozenCreditAssetBalance',
    'cumulativeSpendAmount',
    'updatedAt',
  ]) {
    const columnStart = page.indexOf(`dataIndex: '${field}'`);
    assert.notEqual(columnStart, -1, `${field} column should exist`);
    const columnSnippet = page.slice(columnStart, columnStart + 260);
    assert.match(columnSnippet, /sorter:\s*true/, `${field} column should use server-side sorter`);
  }
});

test('admin digital asset table sends selected sort field and order to accounts API', () => {
  assert.match(page, /request=\{async \(params,\s*sort\)/, 'ProTable request should receive sorter argument');
  assert.match(page, /getDigitalAssetSortParams\(sort/, 'request should normalize ProTable sorter');
  assert.match(page, /sortField:\s*sortParams\.sortField/, 'request should pass sortField to API');
  assert.match(page, /sortOrder:\s*sortParams\.sortOrder/, 'request should pass sortOrder to API');
  assert.match(api, /DigitalAssetAccountQueryParams/, 'accounts API should use typed query params');
  assert.match(types, /sortField\?:\s*DigitalAssetAccountSortField/, 'query params should expose sortField');
  assert.match(types, /sortOrder\?:\s*'ascend'\s*\|\s*'descend'/, 'query params should expose table sort order');
});

test('admin digital asset account table displays global asset rank', () => {
  const columnStart = page.indexOf("dataIndex: 'assetRank'");
  assert.notEqual(columnStart, -1, 'assetRank column should exist');
  const columnSnippet = page.slice(columnStart - 120, columnStart + 260);
  assert.match(columnSnippet, /title:\s*'排名'/, 'rank column should be titled 排名');
  assert.match(columnSnippet, /renderAssetRank/, 'rank column should use dedicated rank rendering');
  assert.match(types, /assetRank:\s*number\s*\|\s*null/, 'account row type should expose assetRank');
});
