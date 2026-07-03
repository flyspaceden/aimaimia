import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('admin/src/pages/bonus/vip-config.tsx', 'utf8');

function extractRecommendedRatios(source) {
  const match = source.match(/const RECOMMENDED_RATIO_TEMPLATE:[\s\S]*?=\s*\{([\s\S]*?)\};/);
  assert.ok(match, 'recommended ratio template should exist');

  const ratios = {};
  for (const [, key, value] of match[1].matchAll(/([A-Z_]+):\s*([0-9.]+)/g)) {
    ratios[key] = Number(value);
  }
  return ratios;
}

test('VIP config schema includes the direct referral ratio item', () => {
  assert.match(page, /key:\s*'VIP_DIRECT_REFERRAL_PERCENT'/);
  assert.match(page, /label:\s*'VIP直推佣金占比'/);
  assert.match(page, /description:\s*'VIP利润中给直系推荐人的持续佣金比例'/);
  assert.match(page, /defaultValue:\s*0/);
});

test('VIP ratio keys and recommended template use seven-way ratios', () => {
  const expectedKeys = [
    'VIP_PLATFORM_PERCENT',
    'VIP_REWARD_PERCENT',
    'VIP_DIRECT_REFERRAL_PERCENT',
    'VIP_INDUSTRY_FUND_PERCENT',
    'VIP_CHARITY_PERCENT',
    'VIP_TECH_PERCENT',
    'VIP_RESERVE_PERCENT',
  ];

  const ratioKeyMatches = [...page.matchAll(/key:\s*'([^']+)'[^;\n]*group:\s*'ratio'/g)].map((match) => match[1]);
  assert.deepEqual(ratioKeyMatches, expectedKeys);
  assert.match(page, /const RATIO_KEYS = CONFIG_SCHEMA[\s\S]*?group === 'ratio'[\s\S]*?\.map\(\(m\) => m\.key\)/);

  const ratios = extractRecommendedRatios(page);
  assert.deepEqual(ratios, {
    VIP_PLATFORM_PERCENT: 0.50,
    VIP_REWARD_PERCENT: 0.25,
    VIP_DIRECT_REFERRAL_PERCENT: 0.05,
    VIP_INDUSTRY_FUND_PERCENT: 0.10,
    VIP_CHARITY_PERCENT: 0.02,
    VIP_TECH_PERCENT: 0.02,
    VIP_RESERVE_PERCENT: 0.06,
  });
  assert.equal(Object.values(ratios).reduce((sum, value) => sum + value, 0), 1);
});

test('VIP config visible copy says seven-way and removes old six-way wording', () => {
  assert.match(page, /VIP 利润七分比例/);
  assert.match(page, /七项合计/);
  assert.match(page, /以下七项须合计 = 100%（50\/25\/5\/10\/2\/2\/6）/);
  assert.match(page, /直推佣金 5%/);

  assert.doesNotMatch(page, /VIP 利润六分比例/);
  assert.doesNotMatch(page, /六项合计/);
  assert.doesNotMatch(page, /以下六项须合计/);
  assert.doesNotMatch(page, /50\/30\/10\/2\/2\/6/);
  assert.doesNotMatch(page, /六分比例/);
});

test('VIP restore defaults uses a valid seven-way ratio template', () => {
  assert.match(
    page,
    /meta\.group === 'ratio'[\s\S]*?RECOMMENDED_RATIO_TEMPLATE\[meta\.key\]/,
    'ratio defaults should come from the valid recommended seven-way template',
  );
  assert.match(page, /VIP_DIRECT_REFERRAL_PERCENT:\s*0\.05/);
});

test('VIP config save handles missing config records without non-null find assertions', () => {
  assert.doesNotMatch(
    page,
    /configs\.find\(\(c\) => c\.key === meta\.key\)!/,
    'missing config records should not be forced through a non-null assertion',
  );
  assert.match(
    page,
    /const existing = configs\.find\(\(c\) => c\.key === meta\.key\);[\s\S]*?existing \? extractConfigDescription\(existing\) : undefined/,
    'save path should safely read descriptions only when the config record exists',
  );
});
