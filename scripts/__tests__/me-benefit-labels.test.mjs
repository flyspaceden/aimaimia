import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const mePage = read('app/(tabs)/me.tsx');
const couponsPage = read('app/me/coupons.tsx');
const walletPage = read('app/me/wallet.tsx');
const vipPage = read('app/me/vip.tsx');
const withdrawPage = read('app/me/withdraw.tsx');
const deletionPage = read('app/me/deletion.tsx');
const privacyPolicy = read('src/content/legal/privacyPolicy.ts');
const termsOfService = read('src/content/legal/termsOfService.ts');

test('my page uses 我的财库 and 我的福利 for visible entry labels', () => {
  assert.match(mePage, /label: '我的福利'/);
  assert.match(mePage, /我的财库/);
  assert.doesNotMatch(mePage, /我的红包/);
  assert.doesNotMatch(mePage, />\s*钱包\s*</);
});

test('benefits page is consistently titled 我的福利', () => {
  assert.match(couponsPage, /label: '我的福利'/);
  assert.match(couponsPage, /<AppHeader title="我的福利" \/>/);
  assert.match(couponsPage, /领取成功，已放入我的福利/);
  assert.match(couponsPage, /暂无福利/);
  assert.doesNotMatch(couponsPage, /我的红包/);
  assert.doesNotMatch(couponsPage, /<AppHeader title="红包" \/>/);
  assert.doesNotMatch(couponsPage, /暂无红包/);
});

test('treasury-related screens no longer show wallet as the user-facing name', () => {
  assert.match(walletPage, /<AppHeader title="我的财库" \/>/);
  assert.match(walletPage, /我的财库加载失败/);
  assert.doesNotMatch(walletPage, /<AppHeader title="消费积分" \/>/);
  assert.doesNotMatch(walletPage, /钱包加载失败/);

  for (const source of [vipPage, withdrawPage, deletionPage]) {
    assert.doesNotMatch(source, /钱包详情/);
    assert.doesNotMatch(source, /钱包查看与提现/);
    assert.doesNotMatch(source, /钱包记录/);
    assert.doesNotMatch(source, /钱包流水/);
    assert.doesNotMatch(source, /钱包 \/ 可提现余额/);
    assert.doesNotMatch(source, /钱包或余额类权益/);
    assert.doesNotMatch(source, /奖励记入钱包/);
  }
});

test('legal cancellation copy uses 我的财库 for withdrawable balance naming', () => {
  for (const source of [privacyPolicy, termsOfService]) {
    assert.match(source, /我的财库可提现/);
    assert.match(source, /我的财库或余额类权益/);
    assert.doesNotMatch(source, /钱包可提现/);
    assert.doesNotMatch(source, /钱包或余额类权益/);
  }
});
