import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('bottom product tab keeps the museum route and its seafood navigation icon', () => {
  const layout = readFileSync('app/(tabs)/_layout.tsx', 'utf8');
  const museumTabStart = layout.indexOf('<Tabs.Screen\n        name="museum"');
  const museumTabEnd = layout.indexOf('<Tabs.Screen\n        name="me"');

  assert.ok(museumTabStart >= 0, 'museum tab should remain registered');
  assert.ok(museumTabEnd > museumTabStart, 'museum tab should precede the profile tab');

  const museumTab = layout.slice(museumTabStart, museumTabEnd);
  assert.match(museumTab, /title: '产品'/);
  assert.match(museumTab, /tabBarAccessibilityLabel: '产品，浏览商品与企业'/);
  assert.match(museumTab, /<SeafoodIcon name="starfish"/);
  assert.doesNotMatch(museumTab, /title: '发现'|tabBarAccessibilityLabel: '发现/);
});
