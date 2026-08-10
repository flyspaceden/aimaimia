import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';
import type {
  BenefitTask,
  DrawResult,
  GrowthExchangeItem,
  GrowthExchangeRecord,
  GrowthGuide,
  GrowthSummary,
  LotteryPrize,
  MemberProfile,
  NormalTreeContext,
  QueueRewardStatus,
  TodayStatus,
  VipGiftOption,
  VipGiftOptionsResponse,
  VipPackage,
  VipTree,
  VipTreeNode,
} from './types';

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableString = (value: unknown): boolean => value === null || isString(value);

function invalid<T>(name: string): Result<T> {
  return { ok: false, error: { code: 'INVALID_CONTRACT', message: `invalid ${name} response`, displayMessage: '服务响应异常，请稍后重试', retryable: true } };
}

function normalize<T>(result: Result<unknown>, guard: (value: unknown) => value is T, name: string): Result<T> {
  if (!result.ok) return result;
  return guard(result.data) ? { ok: true, data: result.data } : invalid(name);
}

function isMember(value: unknown): value is MemberProfile {
  if (!isObject(value) || (value.tier !== 'NORMAL' && value.tier !== 'VIP')) return false;
  const directReferralStatuses = new Set([
    'ACTIVE',
    'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
    'SUPERSEDED_BY_VIP_TREE',
    'ADMIN_VOIDED',
  ]);
  return nullableString(value.referralCode) && nullableString(value.inviterUserId)
    && (value.inviter === null || isObject(value.inviter) && isString(value.inviter.userId)
      && nullableString(value.inviter.nickname) && nullableString(value.inviter.maskedPhone))
    && (value.directReferralStatus === null || directReferralStatuses.has(String(value.directReferralStatus)))
    && (value.directReferralInviter === null || isObject(value.directReferralInviter)
      && isString(value.directReferralInviter.id)
      && nullableString(value.directReferralInviter.nickname)
      && nullableString(value.directReferralInviter.buyerNo))
    && isNumber(value.inviteeVipCount) && nullableString(value.vipPurchasedAt)
    && typeof value.normalEligible === 'boolean' && (value.vipProgress === null || isObject(value.vipProgress));
}

function isGiftOption(value: unknown): value is VipGiftOption {
  if (!isObject(value) || !isString(value.id) || !isString(value.title) || !isNumber(value.totalPrice)
    || !nullableString(value.subtitle) || !nullableString(value.badge) || !nullableString(value.coverUrl)
    || !isString(value.coverMode) || !['AUTO_GRID', 'AUTO_DIAGONAL', 'AUTO_STACKED', 'CUSTOM'].includes(value.coverMode)
    || typeof value.available !== 'boolean' || !Array.isArray(value.items)) return false;
  return value.items.every((item) => isObject(item) && isString(item.skuId)
    && isString(item.productTitle) && nullableString(item.productImage)
    && isString(item.skuTitle) && isNumber(item.price) && isNumber(item.quantity));
}

function isPackage(value: unknown): value is VipPackage {
  return isObject(value) && isString(value.id) && isNumber(value.price) && isNumber(value.sortOrder)
    && Array.isArray(value.giftOptions) && value.giftOptions.every(isGiftOption);
}

function isGiftOptions(value: unknown): value is VipGiftOptionsResponse {
  return isObject(value) && Array.isArray(value.packages) && value.packages.every(isPackage);
}

function isTreeNode(value: unknown): value is VipTreeNode {
  return isObject(value) && isString(value.id) && isNumber(value.level) && isNumber(value.position)
    && isNumber(value.childrenCount) && (value.children === undefined || Array.isArray(value.children) && value.children.every(isTreeNode));
}

function isVipTree(value: unknown): value is VipTree {
  return isObject(value) && (value.node === null || isTreeNode(value.node))
    && Array.isArray(value.children) && value.children.every(isTreeNode);
}

function isNormalTree(value: unknown): value is NormalTreeContext {
  if (!isObject(value) || typeof value.inTree !== 'boolean' || !Array.isArray(value.breadcrumb) || !Array.isArray(value.children)) return false;
  if (!value.breadcrumb.every((item) => isObject(item) && isNumber(item.level) && typeof item.isRoot === 'boolean')) return false;
  if (value.node === null) return value.inTree === false;
  const node = value.node;
  return value.inTree === true && isObject(node) && isNumber(node.level) && isNumber(node.position)
    && isNumber(node.childrenCount) && isNumber(node.selfPurchaseCount) && nullableString(node.frozenAt)
    && value.children.every((child) => isObject(child) && isNumber(child.level) && isNumber(child.position)
      && isNumber(child.childrenCount) && typeof child.hasUser === 'boolean');
}

function isTask(value: unknown): value is BenefitTask {
  return isObject(value) && isString(value.id) && isString(value.title) && isString(value.rewardLabel)
    && isString(value.targetRoute) && (value.status === 'todo' || value.status === 'inProgress' || value.status === 'done');
}

function isLevel(value: unknown): boolean {
  return isObject(value) && isString(value.code) && isString(value.name) && isNumber(value.threshold);
}

function isGrowth(value: unknown): value is GrowthSummary {
  return isObject(value) && isNumber(value.pointsBalance) && isNumber(value.pointsTotalEarned)
    && isNumber(value.pointsTotalSpent) && isNumber(value.growthValue)
    && (value.level === null || isLevel(value.level)) && (value.nextLevel === null || isLevel(value.nextLevel))
    && isObject(value.levelProgress) && isNumber(value.levelProgress.current)
    && (value.levelProgress.required === null || isNumber(value.levelProgress.required)) && isNumber(value.levelProgress.ratio)
    && nullableString(value.updatedAt);
}

function isGuideRule(value: unknown): boolean {
  return isObject(value) && isString(value.code) && isString(value.name) && isString(value.categoryCode)
    && isNumber(value.pointsReward) && isNumber(value.growthReward) && isString(value.grantTiming)
    && (value.dailyLimit === null || isNumber(value.dailyLimit))
    && (value.weeklyLimit === null || isNumber(value.weeklyLimit))
    && (value.monthlyLimit === null || isNumber(value.monthlyLimit))
    && (value.lifetimeLimit === null || isNumber(value.lifetimeLimit)) && isNumber(value.sortOrder);
}

function isGuide(value: unknown): value is GrowthGuide {
  return isObject(value) && Array.isArray(value.inviteRules) && Array.isArray(value.earningRules)
    && value.inviteRules.every(isGuideRule) && value.earningRules.every(isGuideRule)
    && Array.isArray(value.levels) && value.levels.every(isLevel) && isString(value.pointsNote) && isString(value.growthNote);
}

function isExchangeItem(value: unknown): value is GrowthExchangeItem {
  return isObject(value) && isString(value.id) && isString(value.name) && isNumber(value.pointsCost)
    && nullableString(value.description) && nullableString(value.requiredLevelCode)
    && typeof value.canExchange === 'boolean' && ['ACTIVE', 'INACTIVE', 'SOLD_OUT'].includes(String(value.status))
    && ['COUPON', 'SHIPPING_COUPON', 'LOTTERY_CHANCE', 'VIP_DISCOUNT_COUPON', 'DECORATION'].includes(String(value.type));
}

function isExchangeRecord(value: unknown): value is GrowthExchangeRecord {
  return isObject(value) && isString(value.id) && isString(value.itemId) && isNumber(value.pointsCost)
    && isString(value.status) && nullableString(value.couponInstanceId) && nullableString(value.failureReason) && isString(value.createdAt);
}

function isLotteryPrize(value: unknown): value is LotteryPrize {
  return isObject(value) && isString(value.id) && isString(value.name) && isString(value.type);
}

function publicPrize(value: LotteryPrize): LotteryPrize {
  return {
    id: value.id, name: value.name, type: value.type,
    ...(isNumber(value.prizePrice) ? { prizePrice: value.prizePrice } : {}),
    ...(isNumber(value.threshold) ? { threshold: value.threshold } : {}),
    ...(isNumber(value.prizeQuantity) ? { prizeQuantity: value.prizeQuantity } : {}),
    ...(isNumber(value.expirationHours) || value.expirationHours === null ? { expirationHours: value.expirationHours } : {}),
    ...(isNumber(value.originalPrice) || value.originalPrice === null ? { originalPrice: value.originalPrice } : {}),
    ...(isString(value.expiresAt) || value.expiresAt === null ? { expiresAt: value.expiresAt } : {}),
    ...(isNumber(value.sortOrder) ? { sortOrder: value.sortOrder } : {}),
  };
}

function isQueue(value: unknown): value is QueueRewardStatus {
  if (!isObject(value) || typeof value.enabled !== 'boolean' || !isNumber(value.queueSize)
    || !isNumber(value.splitUnitAmount) || !isNumber(value.maxPositionsPerOrder)
    || (value.distributionMode !== 'AVERAGE' && value.distributionMode !== 'NORMAL_RANDOM')
    || !isObject(value.wallet) || !isNumber(value.wallet.available) || !isNumber(value.wallet.total)
    || !isNumber(value.totalActivePositions) || !isObject(value.positionPage)
    || !Array.isArray(value.activePositions) || !Array.isArray(value.recentOrders) || !Array.isArray(value.recentRewards)) return false;
  return isNumber(value.positionPage.pageSize) && isNumber(value.positionPage.total)
    && typeof value.positionPage.hasMore === 'boolean' && nullableString(value.positionPage.nextSequence)
    && value.activePositions.every((item) => isObject(item) && isString(item.id) && isString(item.sequence)
      && isString(item.orderId) && isString(item.orderNo) && isNumber(item.unitIndex)
      && (item.status === 'ACTIVE' || item.status === 'CAPPED') && isNumber(item.ahead)
      && isNumber(item.observedUnitCount) && isNumber(item.targetObservedUnitCount)
      && isNumber(item.remainingObservedUnitCount) && isNumber(item.sharedCapAmount)
      && isNumber(item.receivedAmount) && isString(item.joinedAt))
    && value.recentOrders.every((item) => isObject(item) && isString(item.orderId) && isString(item.orderNo)
      && isNumber(item.eligiblePaidAmount) && isNumber(item.sharedCapAmount) && isNumber(item.availableReceivedAmount)
      && ['ACTIVE', 'CAPPED', 'COMPLETED', 'VOIDED'].includes(String(item.status))
      && nullableString(item.returnWindowExpiresAt) && isString(item.createdAt))
    && value.recentRewards.every((item) => isObject(item) && isString(item.id) && isNumber(item.amount)
      && item.status === 'AVAILABLE' && isString(item.sourceOrderNo) && nullableString(item.releaseAt)
      && nullableString(item.releasedAt) && nullableString(item.voidedAt) && isString(item.createdAt));
}

export const BenefitsRepo = {
  getMember: (): Promise<Result<MemberProfile>> => ApiClient.get<unknown>('/bonus/member').then((result) => normalize(result, isMember, 'member')),
  getVipGiftOptions: (): Promise<Result<VipGiftOptionsResponse>> => ApiClient.get<unknown>('/bonus/vip/gift-options').then((result) => normalize(result, isGiftOptions, 'vip gift options')),
  getVipTree: (): Promise<Result<VipTree>> => ApiClient.get<unknown>('/bonus/vip/tree').then((result) => normalize(result, isVipTree, 'vip tree')),
  getNormalTree: (): Promise<Result<NormalTreeContext>> => ApiClient.get<unknown>('/bonus/normal-tree/context').then((result) => normalize(result, isNormalTree, 'normal tree')),
  getQueueStatus: (afterSequence?: string, positionPageSize = 20): Promise<Result<QueueRewardStatus>> =>
    ApiClient.get<unknown>('/bonus/queue/v2/status', { afterSequence, positionPageSize }).then((result) => normalize(result, isQueue, 'queue reward status')),
  getTasks: (): Promise<Result<BenefitTask[]>> => ApiClient.get<unknown>('/tasks').then((result) => normalize(result, (value): value is BenefitTask[] => Array.isArray(value) && value.every(isTask), 'tasks')),
  getGrowth: (): Promise<Result<GrowthSummary>> => ApiClient.get<unknown>('/growth/me').then((result) => normalize(result, isGrowth, 'growth summary')),
  getGrowthGuide: (): Promise<Result<GrowthGuide>> => ApiClient.get<unknown>('/growth/guide').then((result) => normalize(result, isGuide, 'growth guide')),
  getExchangeItems: (): Promise<Result<GrowthExchangeItem[]>> => ApiClient.get<unknown>('/growth/exchange/items').then((result) => normalize(result, (value): value is GrowthExchangeItem[] => Array.isArray(value) && value.every(isExchangeItem), 'growth exchange items')),
  getExchangeRecords: (): Promise<Result<GrowthExchangeRecord[]>> => ApiClient.get<unknown>('/growth/exchange/records').then((result) => normalize(result, (value): value is GrowthExchangeRecord[] => Array.isArray(value) && value.every(isExchangeRecord), 'growth exchange records')),
  exchangeItem: (itemId: string, idempotencyKey: string): Promise<Result<GrowthExchangeRecord>> => ApiClient.post<unknown>(`/growth/exchange/${itemId}`, { idempotencyKey }).then((result) => normalize(result, isExchangeRecord, 'growth exchange')),
  async getLotteryPrizes(): Promise<Result<LotteryPrize[]>> {
    const result = await ApiClient.get<unknown>('/lottery/prizes');
    const normalized = normalize(result, (value): value is LotteryPrize[] => Array.isArray(value) && value.every(isLotteryPrize), 'lottery prizes');
    return normalized.ok ? { ok: true, data: normalized.data.map(publicPrize) } : normalized;
  },
  async getLotteryToday(loggedIn: boolean, fingerprint: string): Promise<Result<TodayStatus>> {
    const result = loggedIn
      ? await ApiClient.get<unknown>('/lottery/today')
      : await ApiClient.get<unknown>('/lottery/public/today', { fp: fingerprint });
    if (!result.ok) return result;
    if (!isObject(result.data) || typeof result.data.hasDrawn !== 'boolean') return invalid('lottery today');
    const remaining = loggedIn ? result.data.remainingChances : result.data.remainingDraws;
    if (!isNumber(remaining)) return invalid('lottery today');
    const records = Array.isArray(result.data.records) ? result.data.records : [];
    const last = records.length ? records[records.length - 1] : undefined;
    return {
      ok: true,
      data: {
        hasDrawn: result.data.hasDrawn,
        remainingDraws: remaining,
        ...(isObject(last) && (last.result === 'WON' || last.result === 'NO_PRIZE') ? {
          lastResult: { won: last.result === 'WON', ...(isLotteryPrize(last.prize) ? { prize: publicPrize(last.prize) } : {}), message: last.result === 'WON' ? '恭喜中奖！' : '谢谢参与' },
        } : {}),
      },
    };
  },
  async drawLottery(loggedIn: boolean, fingerprint: string): Promise<Result<DrawResult>> {
    const result = loggedIn
      ? await ApiClient.post<unknown>('/lottery/draw')
      : await ApiClient.post<unknown>('/lottery/public/draw', { deviceFingerprint: fingerprint });
    if (!result.ok) return result;
    if (!isObject(result.data) || (result.data.result !== 'WON' && result.data.result !== 'NO_PRIZE')) return invalid('lottery draw');
    if (result.data.result === 'WON' && !isLotteryPrize(result.data.prize)) return invalid('lottery draw');
    if (!loggedIn && result.data.result === 'WON' && !isString(result.data.claimToken)) return invalid('lottery claim');
    return { ok: true, data: {
      won: result.data.result === 'WON',
      ...(isLotteryPrize(result.data.prize) ? { prize: publicPrize(result.data.prize) } : {}),
      ...(isString(result.data.claimToken) ? { claimToken: result.data.claimToken } : {}),
      message: result.data.result === 'WON' ? '恭喜中奖！' : '谢谢参与',
    } };
  },
};
