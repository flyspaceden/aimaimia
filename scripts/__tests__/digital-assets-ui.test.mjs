import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('digital asset page does not expose unfinished long-term modules', () => {
  const page = read('app/me/digital-assets.tsx');

  assert.doesNotMatch(page, /PENDING_MODULES/);
  assert.doesNotMatch(page, /长期模块/);
  assert.doesNotMatch(page, /未来权益模块/);
  assert.doesNotMatch(page, /权益规则待开放/);
});

test('digital asset page does not expose front-end acquisition rules', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /消费资产规则/,
    /VIP 种子资产规则/,
    /当前档位/,
    /下一档/,
    /当前套餐规则/,
    /暂无档位规则/,
    /规则待开放/,
    /规则待配置/,
    /暂无可展示的套餐规则/,
    /按套餐配置/,
    /按规则转化/,
    /currentCreditTier\?\.multiplier/,
    /nextCreditTier\?\.multiplier/,
    /buildTierProgress/,
    /renderVipSeedRule/,
    /信用资产/,
    /资产说明/,
  ].forEach((pattern) => assert.doesNotMatch(page, pattern));
});

test('digital asset page keeps result-only asset surface', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /数字资产总额/,
    /种子资产/,
    /消费资产/,
    /累计消费金额/,
    /最近资产流水/,
    /查看全部/,
    /开通 VIP 激活数字资产/,
  ].forEach((pattern) => assert.match(page, pattern));
});

test('digital asset page filters non-vip recent records to cumulative spend rows', () => {
  const page = read('app/me/digital-assets.tsx');

  assert.match(page, /filter\(\(item\) => isVip \|\| item\.subjectType === 'CUMULATIVE_SPEND'\)/);
});

test('digital asset page defines restrained ledger type colors', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /#1F8A5F/,
    /#267B93/,
    /#A87918/,
    /#B65347/,
    /#6E7B72/,
    /getLedgerTone/,
  ].forEach((pattern) => assert.match(page, pattern));
});
