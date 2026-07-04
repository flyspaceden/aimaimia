import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('app/group-buy/[activityId].tsx', 'utf8');
const aiFloatingSource = readFileSync('src/components/effects/AiFloatingCompanion.tsx', 'utf8');
const appBottomSheetSource = readFileSync('src/components/overlay/AppBottomSheet.tsx', 'utf8');

test('group-buy detail removes purchasable-count copy from the price card', () => {
  assert.equal(source.includes('可购 {availableStock} 份'), false);
  assert.match(source, /下单前请确认收货地址/);
});

test('group-buy detail renders item stock only through low-stock display helper', () => {
  assert.equal(source.includes('{item.skuTitle} · 库存 {item.stock}'), false);
  assert.equal(source.includes('默认规格'), false);
  assert.match(source, /getGroupBuyLowStockText\(item\.stock\)/);
});

test('group-buy detail keeps the main content scrollable above the fixed pay bar', () => {
  assert.match(source, /<ScrollView[\s\S]*?style=\{styles\.scroll\}[\s\S]*?contentContainerStyle=\{\{ paddingBottom: bottomPadding \}\}/);
  assert.match(source, /scroll:\s*\{\s*flex:\s*1,\s*\}/);
});

test('group-buy detail suppresses the global AI floating gesture layer', () => {
  assert.match(aiFloatingSource, /const isGroupBuyDetail = pathname\.startsWith\('\/group-buy\/'\) && pathname !== '\/group-buy\/checkout';/);
  assert.match(aiFloatingSource, /if \(isHomeTab \|\| isGroupBuyDetail \|\| shouldHideForPage\) return null;/);
});

test('closed bottom sheets unmount instead of leaving a native gesture layer on Android', () => {
  assert.match(appBottomSheetSource, /if \(!open\) \{\s*return null;\s*\}/);
  assert.equal(appBottomSheetSource.includes('index={open ? 0 : -1}'), false);
});

test('group-buy detail back button falls back to the group-buy list on direct entry', () => {
  assert.match(source, /const handleBack = \(\) => \{\s*if \(router\.canGoBack\(\)\) \{\s*router\.back\(\);\s*return;\s*\}\s*router\.replace\('\/group-buy'\);\s*\};/);

  const headerMatches = [...source.matchAll(/<AppHeader title="团购详情"[^>]*\/>/g)];
  assert.equal(headerMatches.length, 4);
  for (const match of headerMatches) {
    assert.match(match[0], /onBack=\{handleBack\}/);
  }
});
