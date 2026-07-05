import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const form = readFileSync('admin/src/pages/coupons/campaign-form.tsx', 'utf8');
const listPage = readFileSync('admin/src/pages/coupons/campaigns.tsx', 'utf8');
const api = readFileSync('admin/src/api/coupon.ts', 'utf8');
const statusMaps = readFileSync('admin/src/constants/statusMaps.ts', 'utf8');
const appCouponPage = readFileSync('app/me/coupons.tsx', 'utf8');
const couponRepo = readFileSync('src/repos/CouponRepo.ts', 'utf8');
const couponTypes = readFileSync('src/types/domain/Coupon.ts', 'utf8');
const couponController = readFileSync('backend/src/modules/coupon/coupon.controller.ts', 'utf8');
const couponService = readFileSync('backend/src/modules/coupon/coupon.service.ts', 'utf8');

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

test('campaign form lets selected trigger types choose auto or claim distribution', () => {
  assert.match(form, /FLEXIBLE_DISTRIBUTION_TRIGGER_TYPES/);
  assert.match(form, /CUMULATIVE_SPEND/);
  assert.match(form, /WIN_BACK/);
  assert.match(form, /HOLIDAY/);
  assert.match(form, /FLASH/);
  assert.match(form, /getDistributionModeOptions/);
  assert.match(form, /disabled:\s*!isDistributionModeFlexible/);
  assert.doesNotMatch(form, /distributionMode:\s*expectedMode/);
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
  assert.match(form, /普通手动红包上架后会打开手动发放窗口/);
  assert.match(form, /搜索选择指定买家/);
  assert.match(form, /普通用户/);
  assert.match(form, /VIP用户/);
  assert.match(form, /全部用户/);
  assert.match(form, /勾选“积分兑换专用”后不会走普通手动发放入口/);
  assert.match(form, /onSuccess\(savedCampaign\)/);
});

test('coupon campaigns can be marked as growth-exchange dedicated pools', () => {
  assert.match(api, /growthExchangeEnabled:\s*boolean/);
  assert.match(form, /name="growthExchangeEnabled"/);
  assert.match(form, /label="积分兑换专用"/);
  assert.match(form, /仅用于积分成长兑换/);
  assert.match(form, /growthExchangeEnabled:\s*isManualTrigger\s*\?\s*Boolean\(values\.growthExchangeEnabled\)\s*:\s*false/);
  assert.match(listPage, /growthExchangeEnabled/);
  assert.match(listPage, /积分兑换专用/);
  assert.match(listPage, /record\.distributionMode === 'MANUAL' && !record\.growthExchangeEnabled/);
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

test('manual issue API supports specified, normal, vip, and all buyers', () => {
  assert.match(api, /targetMode\?:\s*'SPECIFIC_USERS'\s*\|\s*'NORMAL_USERS'\s*\|\s*'VIP_USERS'\s*\|\s*'ALL_USERS'/);
  assert.match(api, /userIds\?:\s*string\[\]/);
  assert.match(api, /endAt:\s*string\s*\|\s*null/);
});

test('campaign list exposes manual issue modal with searchable selected-user mode', () => {
  assert.match(listPage, /manualIssue/);
  assert.match(listPage, /手动发放/);
  assert.match(listPage, /指定用户/);
  assert.match(listPage, /普通用户/);
  assert.match(listPage, /VIP用户/);
  assert.match(listPage, /全部用户/);
  assert.match(listPage, /getAppUsers/);
  assert.match(listPage, /mode="multiple"/);
  assert.match(listPage, /搜索昵称、手机号、买家编号或用户ID/);
  assert.match(listPage, /targetMode:\s*manualIssueMode/);
  assert.doesNotMatch(listPage, /逗号分隔/);
  assert.doesNotMatch(listPage, /Input\.TextArea/);
});

test('new draft campaigns remain discoverable and manual activation opens issue modal', () => {
  assert.match(listPage, /createdCampaign\?\.status === 'DRAFT'/);
  assert.match(listPage, /setActiveStatusTab\('DRAFT'\)/);
  assert.match(listPage, /updatedCampaign\.distributionMode === 'MANUAL'/);
  assert.match(listPage, /!updatedCampaign\.growthExchangeEnabled/);
  assert.match(listPage, /setManualIssueCampaign\(updatedCampaign\)/);
});

test('campaign list and detail display evergreen campaign time without invalid date', () => {
  assert.match(listPage, /formatCampaignTime/);
  assert.match(listPage, /长期有效/);
  assert.match(listPage, /不限结束时间/);
  assert.doesNotMatch(listPage, /dayjs\(r\.endAt\)\.format/);
});

test('campaign scope selectors load real category and active company options without opening-error toast', () => {
  assert.match(form, /from '@\/api\/categories'/);
  assert.match(form, /from '@\/api\/companies'/);
  assert.match(form, /categoryOptions/);
  assert.match(form, /companyOptions/);
  assert.match(form, /getCompanies\(\{\s*pageSize:\s*200,\s*status:\s*'ACTIVE'\s*\}\)/);
  assert.doesNotMatch(form, /message\.error\('加载店铺选项失败'\)/);
  assert.doesNotMatch(form, /message\.error\('加载品类选项失败'\)/);
  assert.match(form, /name="applicableCategories"[\s\S]*?mode="multiple"/);
  assert.match(form, /name="applicableCompanyIds"[\s\S]*?mode="multiple"/);
  assert.doesNotMatch(form, /label="限定品类"[\s\S]{0,180}?mode="tags"/);
  assert.doesNotMatch(form, /label="限定店铺"[\s\S]{0,180}?mode="tags"/);
});

test('manual campaigns hide activity time fields from creation form', () => {
  assert.match(form, /isManualTrigger/);
  assert.match(form, /手动发放无需配置活动开始或截止时间/);
  assert.match(form, /搜索选择指定买家/);
  assert.match(form, /startAt:\s*isManualTrigger\s*\?\s*dayjs\(\)\.toISOString\(\)/);
  assert.match(form, /endAt:\s*isManualTrigger\s*\?\s*null/);
  assert.match(form, /triggerType !== 'MANUAL'[\s\S]*?name="startAt"/);
});

test('holiday and flash auto distribution require an automatic audience selector', () => {
  assert.match(form, /triggerConfig_autoTargetMode/);
  assert.match(form, /自动发放对象/);
  assert.match(form, /普通用户/);
  assert.match(form, /VIP用户/);
  assert.match(form, /全部用户/);
});

test('new coupon campaigns default to non-stackable', () => {
  assert.match(form, /stackable:\s*false/);
  assert.match(form, /stackable:\s*\(values\.stackable as boolean\) \?\? false/);
  assert.doesNotMatch(form, /stackable:\s*true/);
});

test('manual issue modal supports normal buyers, vip buyers, and scheduled issue time', () => {
  assert.match(api, /NORMAL_USERS/);
  assert.match(api, /VIP_USERS/);
  assert.match(api, /scheduleMode\?:\s*'IMMEDIATE'\s*\|\s*'SCHEDULED'/);
  assert.match(api, /scheduledAt\?:\s*string/);
  assert.match(listPage, /NORMAL_USERS/);
  assert.match(listPage, /普通用户/);
  assert.match(listPage, /VIP用户/);
  assert.match(listPage, /立即发放/);
  assert.match(listPage, /定时发放/);
  assert.match(listPage, /scheduledAt/);
  assert.match(listPage, /定时发放时间必须晚于当前时间/);
});

test('buyer coupon center shows and clears new claimable coupon badge', () => {
  assert.match(couponTypes, /ClaimableCouponAlertDto/);
  assert.match(couponRepo, /getClaimableAlert/);
  assert.match(couponRepo, /markClaimableAlertRead/);
  assert.match(couponRepo, /\/coupons\/claimable-alert/);
  assert.match(couponRepo, /\/coupons\/claimable-alert\/read/);
  assert.match(appCouponPage, /claimable-alert/);
  assert.match(appCouponPage, /claimableBadgeCount/);
  assert.match(appCouponPage, /badgeText/);
  assert.match(appCouponPage, /markClaimableAlertRead/);
  assert.match(appCouponPage, /setMainTab\('center'\)/);
  assert.match(appCouponPage, /mutate\(claimableCampaignKey\)/);
  assert.match(appCouponPage, /if \(!result\.ok\)/);
  assert.match(appCouponPage, /标记领券中心已读失败/);
  assert.match(appCouponPage, /retry:\s*2/);
  assert.match(appCouponPage, /retryDelay/);
  assert.match(appCouponPage, /mainTab !== 'center'/);
  assert.match(appCouponPage, /lastClaimableReadKeyRef\.current = ''/);
});

test('buyer coupon center has claimable, claimed, and active tabs backed by server views', () => {
  assert.match(couponTypes, /CouponCenterView/);
  assert.match(couponTypes, /CouponCenterCampaignDto/);
  assert.match(couponTypes, /CouponCenterClaimSummaryDto/);
  assert.match(couponRepo, /getCouponCenterCampaigns/);
  assert.match(couponRepo, /\/coupons\/center/);
  assert.match(couponController, /@Get\('center'\)/);
  assert.match(couponService, /getCouponCenterCampaigns/);
  assert.match(appCouponPage, /CENTER_TABS/);
  assert.match(appCouponPage, /可领取/);
  assert.match(appCouponPage, /已领取/);
  assert.match(appCouponPage, /进行中/);
  assert.match(appCouponPage, /claimable/);
  assert.match(appCouponPage, /claimed/);
  assert.match(appCouponPage, /active/);
});

test('buyer coupon center uses server display status and refreshes stale claim state', () => {
  assert.match(couponTypes, /CouponCenterDisplayStatus/);
  assert.match(couponTypes, /displayStatus/);
  assert.match(couponTypes, /claimedSummary/);
  assert.match(couponTypes, /nearestExpiresAt/);
  assert.match(appCouponPage, /displayStatus/);
  assert.match(appCouponPage, /statusLabel/);
  assert.match(appCouponPage, /claimedSummary\.available/);
  assert.match(appCouponPage, /立即领取/);
  assert.match(appCouponPage, /已领取/);
  assert.match(appCouponPage, /已领完/);
  assert.match(appCouponPage, /已结束/);
  assert.match(appCouponPage, /领取失败，请稍后重试/);
  assert.match(appCouponPage, /result\.error\.code === 'NETWORK'/);
  assert.match(appCouponPage, /领取冲突，请重试/);
  assert.match(appCouponPage, /红包活动不存在/);
  assert.match(appCouponPage, /该活动不支持用户自行领取/);
  assert.match(appCouponPage, /coupon-center-campaigns/);
  assert.match(appCouponPage, /coupon-claimable-alert/);
  assert.match(appCouponPage, /my-coupons/);
  assert.match(appCouponPage, /checkout-eligible-coupons/);
  assert.match(appCouponPage, /已达活动领取上限|每人限领|已领完|活动已结束|活动已暂停/);
});
