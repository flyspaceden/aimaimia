import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const form = readFileSync('admin/src/pages/coupons/campaign-form.tsx', 'utf8');
const listPage = readFileSync('admin/src/pages/coupons/campaigns.tsx', 'utf8');
const api = readFileSync('admin/src/api/coupon.ts', 'utf8');
const statusMaps = readFileSync('admin/src/constants/statusMaps.ts', 'utf8');

test('coupon trigger labels use clear supported business terms', () => {
  assert.match(form, /久未下单唤醒/);
  assert.match(statusMaps, /WIN_BACK:\s*\{\s*text:\s*'久未下单唤醒'/);
  assert.doesNotMatch(form, /label:\s*'复购激励'/);
  assert.doesNotMatch(statusMaps, /复购激励/);
});

test('campaign form hides currently unsupported trigger types', () => {
  const optionsStart = form.indexOf('const triggerTypeOptions');
  const optionsBlock = form.slice(optionsStart, form.indexOf('];', optionsStart));

  assert.doesNotMatch(optionsBlock, /CHECK_IN/);
  assert.doesNotMatch(optionsBlock, /REVIEW/);
  assert.doesNotMatch(optionsBlock, /签到/);
  assert.doesNotMatch(optionsBlock, /好评/);
});

test('campaign form constrains distribution mode from trigger type', () => {
  assert.match(form, /TRIGGER_DISTRIBUTION_MODE_MAP/);
  assert.match(form, /setFieldsValue\(\{\s*distributionMode:\s*expectedMode/);
  assert.match(form, /disabled:\s*true[\s\S]*?distributionModeOptions/);
});

test('campaign form supports unlimited end time only for evergreen trigger types', () => {
  assert.match(form, /EVERGREEN_TRIGGER_TYPES/);
  assert.match(form, /name="noEndAt"/);
  assert.match(form, /label="不限结束时间"/);
  assert.match(form, /endAt:\s*values\.noEndAt\s*\?\s*null/);
  assert.match(form, /长期活动必须设置领取后有效天数/);
});

test('manual issue API supports specified buyers or all buyers', () => {
  assert.match(api, /targetMode\?:\s*'SPECIFIC_USERS'\s*\|\s*'ALL_USERS'/);
  assert.match(api, /userIds\?:\s*string\[\]/);
  assert.match(api, /endAt:\s*string\s*\|\s*null/);
});

test('campaign list exposes manual issue modal with all-user mode', () => {
  assert.match(listPage, /manualIssue/);
  assert.match(listPage, /手动发放/);
  assert.match(listPage, /指定用户/);
  assert.match(listPage, /全部用户/);
  assert.match(listPage, /targetMode:\s*'ALL_USERS'/);
  assert.match(listPage, /买家编号或用户ID/);
});

test('campaign list and detail display evergreen campaign time without invalid date', () => {
  assert.match(listPage, /formatCampaignTime/);
  assert.match(listPage, /长期有效/);
  assert.match(listPage, /不限结束时间/);
  assert.doesNotMatch(listPage, /dayjs\(r\.endAt\)\.format/);
});
