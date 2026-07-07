import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentPath = 'admin/src/components/BuyerSuggestInput.tsx';
const identityTextPath = 'admin/src/components/BuyerIdentityText.tsx';

const files = {
  users: 'admin/src/pages/users/index.tsx',
  digitalAssets: 'admin/src/pages/digital-assets/index.tsx',
  growth: 'admin/src/pages/growth/index.tsx',
  bonusMembers: 'admin/src/pages/bonus/members.tsx',
  referrals: 'admin/src/pages/referrals/index.tsx',
  announcements: 'admin/src/pages/announcements/index.tsx',
};

test('admin exposes a reusable buyer suggestion input backed by app user search', () => {
  assert.equal(existsSync(componentPath), true, 'BuyerSuggestInput component should exist');
  const component = readFileSync(componentPath, 'utf8');
  assert.match(component, /export function BuyerSuggestInput/);
  assert.match(component, /export function BuyerNoMultiSelect/);
  assert.match(component, /getAppUsers/);
  assert.match(component, /AutoComplete/);
  assert.match(component, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(component, /onSearch=\{handleSearch\}/);
  assert.match(component, /BuyerIdentityText/);
  assert.match(component, /buyer\.buyerNo/);
});

test('buyer suggestion input loads more candidate buyers when dropdown scrolls to bottom', () => {
  assert.equal(existsSync(componentPath), true, 'BuyerSuggestInput component should exist');
  const component = readFileSync(componentPath, 'utf8');
  assert.match(component, /useInfiniteQuery/);
  assert.match(component, /getNextPageParam/);
  assert.match(component, /fetchNextPage/);
  assert.match(component, /hasNextPage/);
  assert.match(component, /onPopupScroll=\{handlePopupScroll\}/);
});

test('buyer suggestion dropdowns stay readable in narrow admin search fields', () => {
  const component = readFileSync(componentPath, 'utf8');
  const identityText = readFileSync(identityTextPath, 'utf8');

  assert.match(component, /popupMatchSelectWidth=\{BUYER_SUGGESTION_POPUP_WIDTH\}/);
  assert.match(component, /BUYER_SUGGESTION_POPUP_WIDTH\s*=\s*360/);
  assert.match(identityText, /whiteSpace:\s*'nowrap'/);
  assert.match(identityText, /primaryIdMaxWidth\s*=\s*compact \? 220 : 280/);
  assert.match(identityText, /maxWidth:\s*primaryIdMaxWidth/);
});

test('high-value admin buyer keyword filters use buyer suggestions', () => {
  for (const [name, path] of Object.entries(files)) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /BuyerSuggestInput|BuyerNoMultiSelect/, `${name} should import or render a buyer suggestion control`);
  }
});

test('announcements specified buyer audience uses selectable buyer numbers instead of raw textarea only', () => {
  const page = readFileSync(files.announcements, 'utf8');
  const buyerNoBlock = page.match(/name="buyerNoText"[\s\S]*?<\/Form\.Item>/)?.[0] ?? '';
  assert.match(buyerNoBlock, /BuyerNoMultiSelect/);
  assert.doesNotMatch(buyerNoBlock, /<TextArea/);
});
