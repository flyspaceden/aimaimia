import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../../app/vip/gifts.tsx', import.meta.url), 'utf8');
const checkoutSource = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
const memberAgreementSource = readFileSync(new URL('../../src/content/legal/memberServiceAgreement.ts', import.meta.url), 'utf8');

test('VIP gift page no longer advertises free shipping', () => {
  assert.doesNotMatch(source, /包邮特权/);
  assert.doesNotMatch(source, /包邮 · 支付即开通 VIP/);
  assert.doesNotMatch(source, /truck-fast/);
  assert.match(source, /支付即开通 VIP/);
});

test('VIP checkout and member agreement do not promise package free shipping', () => {
  assert.doesNotMatch(checkoutSource, /包邮 · 支付即开通 VIP/);
  assert.doesNotMatch(checkoutSource, /VIP 礼包[\s\S]{0,500}>包邮</);
  assert.match(checkoutSource, /运费优惠/);
  assert.doesNotMatch(memberAgreementSource, /VIP 礼包订单包邮/);
  assert.doesNotMatch(memberAgreementSource, /包邮权益/);
  assert.match(memberAgreementSource, /配送费用以订单页展示为准/);
});

test('VIP gift page shows full gift item list instead of truncating it in the card', () => {
  assert.doesNotMatch(source, /cardItemsSummary[\s\S]{0,120}numberOfLines=\{2\}/);
  assert.match(source, /selectedGiftOption/);
  assert.match(source, /giftDetailCard/);
  assert.match(source, /礼包清单/);
});

test('VIP gift cover images can be opened in a full-screen horizontal viewer', () => {
  assert.match(source, /Modal/);
  assert.match(source, /imagePreviewVisible/);
  assert.match(source, /previewFlatListRef/);
  assert.match(source, /pagingEnabled/);
  assert.match(source, /openImagePreview/);
});
