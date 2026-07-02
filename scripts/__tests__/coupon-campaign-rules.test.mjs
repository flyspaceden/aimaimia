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
  assert.match(form, /endAt:\s*isManualTrigger[\s\S]*?values\.noEndAt\s*\?\s*null/);
  assert.match(form, /长期活动必须设置领取后有效天数/);
});

test('manual campaign creation explains the activation before issuing workflow', () => {
  assert.match(form, /手动发放对象/);
  assert.match(form, /创建后先在草稿列表上架/);
  assert.match(form, /买家编号或用户ID/);
  assert.match(form, /全部用户/);
  assert.match(form, /onSuccess\(savedCampaign\)/);
});

test('fixed discount campaigns require threshold after discount amount', () => {
  assert.match(form, /name=\{\['discountType', 'discountValue'\]\}/);
  assert.match(form, /disabled:\s*discountType === 'FIXED' && !discountValue/);
  assert.match(form, /min=\{discountType === 'FIXED' && discountValue \? Number\(discountValue\) : 0\}/);
  assert.match(form, /最低消费门槛不能低于抵扣金额/);
  assert.match(form, /先填写抵扣金额，再设置最低消费门槛/);
});

test('claim-based activity labels explain holiday versus flash usage', () => {
  assert.match(form, /节日活动适合固定节日或营销周期/);
  assert.match(form, /限时抢适合短时间、强库存或强名额约束/);
});

test('manual issue API supports specified buyers, all buyers, and vip buyers', () => {
  assert.match(api, /targetMode\?:\s*'SPECIFIC_USERS'\s*\|\s*'ALL_USERS'\s*\|\s*'VIP_USERS'/);
  assert.match(api, /userIds\?:\s*string\[\]/);
  assert.match(api, /endAt:\s*string\s*\|\s*null/);
});

test('campaign list exposes manual issue modal with all-user mode', () => {
  assert.match(listPage, /manualIssue/);
  assert.match(listPage, /手动发放/);
  assert.match(listPage, /指定用户/);
  assert.match(listPage, /全部用户/);
  assert.match(listPage, /targetMode:\s*manualIssueMode/);
  assert.match(listPage, /买家编号或用户ID/);
});

test('new draft campaigns remain discoverable and manual activation opens issue modal', () => {
  assert.match(listPage, /createdCampaign\?\.status === 'DRAFT'/);
  assert.match(listPage, /setActiveStatusTab\('DRAFT'\)/);
  assert.match(listPage, /updatedCampaign\.distributionMode === 'MANUAL'/);
  assert.match(listPage, /setManualIssueCampaign\(updatedCampaign\)/);
});

test('campaign list and detail display evergreen campaign time without invalid date', () => {
  assert.match(listPage, /formatCampaignTime/);
  assert.match(listPage, /长期有效/);
  assert.match(listPage, /不限结束时间/);
  assert.doesNotMatch(listPage, /dayjs\(r\.endAt\)\.format/);
});

test('campaign scope selectors load real category and approved company options', () => {
  assert.match(form, /from '@\/api\/categories'/);
  assert.match(form, /from '@\/api\/companies'/);
  assert.match(form, /categoryOptions/);
  assert.match(form, /companyOptions/);
  assert.match(form, /getCompanies\(\{\s*pageSize:\s*200,\s*status:\s*'APPROVED'\s*\}\)/);
  assert.match(form, /name="applicableCategories"[\s\S]*?mode="multiple"/);
  assert.match(form, /name="applicableCompanyIds"[\s\S]*?mode="multiple"/);
  assert.doesNotMatch(form, /label="限定品类"[\s\S]{0,180}?mode="tags"/);
  assert.doesNotMatch(form, /label="限定店铺"[\s\S]{0,180}?mode="tags"/);
});

test('manual campaigns hide activity time fields from creation form', () => {
  assert.match(form, /isManualTrigger/);
  assert.match(form, /手动发放无需配置活动开始或截止时间/);
  assert.match(form, /startAt:\s*isManualTrigger\s*\?\s*dayjs\(\)\.toISOString\(\)/);
  assert.match(form, /endAt:\s*isManualTrigger\s*\?\s*null/);
  assert.match(form, /triggerType !== 'MANUAL'[\s\S]*?name="startAt"/);
});

test('manual issue modal supports vip buyers and scheduled issue time', () => {
  assert.match(api, /VIP_USERS/);
  assert.match(api, /scheduleMode\?:\s*'IMMEDIATE'\s*\|\s*'SCHEDULED'/);
  assert.match(api, /scheduledAt\?:\s*string/);
  assert.match(listPage, /VIP用户/);
  assert.match(listPage, /立即发放/);
  assert.match(listPage, /定时发放/);
  assert.match(listPage, /scheduledAt/);
  assert.match(listPage, /定时发放时间必须晚于当前时间/);
});
