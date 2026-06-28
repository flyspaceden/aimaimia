import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const meTab = () => readFileSync('app/(tabs)/me.tsx', 'utf8');

test('me identity card removes greeting copy from signed-in profile card', () => {
  const source = meTab();

  assert.doesNotMatch(source, /const greeting = useMemo/);
  assert.doesNotMatch(source, /早上好|下午好|晚上好/);
});

test('me identity card prefixes buyer number with ID label', () => {
  const source = meTab();

  assert.match(source, /profile\.buyerNo \? `ID: \$\{profile\.buyerNo\}` : 'ID: 用户编号生成中'/);
});

test('me identity card renders buyer number in a wider meta row with a larger text style', () => {
  const source = meTab();
  const metaStackIndex = source.indexOf('style={styles.profileMetaStack}');
  const buyerNoChipIndex = source.indexOf('style={[styles.buyerNoChip');

  assert.ok(metaStackIndex > 0, 'buyer number meta stack should exist');
  assert.ok(buyerNoChipIndex > metaStackIndex, 'buyer number chip should render inside the wider meta stack');
  assert.match(source, /style=\{\[styles\.buyerNoText, \{ color: colors\.gold\.primary, fontFamily: monoFamily \}\]\}/);
  assert.match(source, /minimumFontScale=\{0\.9\}/);
  assert.match(source, /profileMetaStack:\s*\{[^}]*alignSelf:\s*'stretch',/s);
  assert.doesNotMatch(source, /profileMetaStack:\s*\{[^}]*marginLeft:/s);
  assert.match(source, /buyerNoChip:\s*\{[^}]*alignSelf:\s*'stretch',/s);
  assert.match(source, /buyerNoText:\s*\{[^}]*fontSize:\s*16,[^}]*lineHeight:\s*22,/s);
  assert.match(source, /buyerNoText:\s*\{[^}]*minWidth:\s*0,[^}]*flexShrink:\s*1,/s);
});

test('me identity card labels the digital asset ranking explicitly', () => {
  const source = meTab();

  assert.match(source, /数字资产排行榜：\{assetRankLabel\}/);
  assert.doesNotMatch(source, />\s*资产排行榜：\{assetRankLabel\}/);
});

test('me identity card shows digital asset rank next to the referral entry', () => {
  const source = meTab();
  const metaStackIndex = source.indexOf('style={styles.profileMetaStack}');
  const referralIndex = source.indexOf('style={[styles.referralChip');
  const rankIndex = source.indexOf('数字资产排行榜：');

  assert.match(source, /DigitalAssetRepo/);
  assert.match(source, /queryKey:\s*\['digital-assets-summary'\]/);
  assert.match(source, /const assetRankLabel =/);
  assert.ok(metaStackIndex > 0, 'profile meta stack should exist');
  assert.ok(referralIndex > metaStackIndex, 'referral chip should render inside the profile meta area');
  assert.ok(rankIndex > referralIndex, 'digital asset rank should render next to the referral entry');
  assert.match(source, /assetRankText:\s*\{[^}]*flexShrink:\s*1,/s);
});
