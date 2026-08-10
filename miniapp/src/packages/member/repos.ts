import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';
import { isPageResult, withNextPage } from '@/types';
import type {
  CouponCenterCampaign,
  CouponCenterView,
  CouponInstanceStatus,
  DigitalAssetLedger,
  DigitalAssetLedgerPage,
  DigitalAssetLedgerQuery,
  DigitalAssetSummary,
  MyCoupon,
  WechatWithdrawResult,
  WalletLedgerEntry,
  WalletLedgerPage,
  WalletSummary,
  WithdrawRecord,
  WithdrawStatus,
} from './types';

const invalidContract = <T>(name: string): Result<T> => ({
  ok: false,
  error: {
    code: 'INVALID_CONTRACT',
    message: `invalid ${name} response`,
    displayMessage: '服务响应异常，请稍后重试',
    retryable: true,
  },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function normalize<T>(result: Result<unknown>, guard: (value: unknown) => value is T, name: string): Result<T> {
  if (!result.ok) return result;
  return guard(result.data) ? { ok: true, data: result.data } : invalidContract(name);
}

function isWalletAccount(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.balance) && isFiniteNumber(value.frozen);
}

function isGroupBuyRebate(value: unknown): boolean {
  return isObject(value)
    && isFiniteNumber(value.balance)
    && isFiniteNumber(value.pending)
    && isFiniteNumber(value.reserved)
    && isFiniteNumber(value.withdrawn)
    && isFiniteNumber(value.deducted)
    && isFiniteNumber(value.total);
}

function isWallet(value: unknown): value is WalletSummary {
  if (!isObject(value)) return false;
  return isFiniteNumber(value.balance) && isFiniteNumber(value.frozen) && isFiniteNumber(value.total)
    && isFiniteNumber(value.deductibleBalance)
    && isFiniteNumber(value.withdrawableBalance)
    && typeof value.isSellerOwner === 'boolean'
    && isWalletAccount(value.vip)
    && isWalletAccount(value.normal)
    && isWalletAccount(value.queueReward)
    && (value.industryFund === null || isWalletAccount(value.industryFund))
    && isGroupBuyRebate(value.groupBuyRebate);
}

function isWalletLedgerEntry(value: unknown): value is WalletLedgerEntry {
  if (!isObject(value)) return false;
  return isString(value.id) && isString(value.entryType) && isFiniteNumber(value.amount)
    && isString(value.status) && isNullableString(value.refType) && isString(value.createdAt)
    && isNullableString(value.accountType)
    && (value.meta === null || isObject(value.meta));
}

function isWalletLedgerPage(value: unknown): value is WalletLedgerPage {
  if (!isObject(value) || !Array.isArray(value.items) || !value.items.every(isWalletLedgerEntry)) return false;
  return value.nextPage === undefined || Number.isInteger(value.nextPage) && Number(value.nextPage) >= 2;
}

const WITHDRAW_STATUSES = new Set<WithdrawStatus>(['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED']);
function isWithdrawRecord(value: unknown): value is WithdrawRecord {
  if (!isObject(value)) return false;
  return isString(value.id) && isFiniteNumber(value.amount) && isString(value.channel)
    && isString(value.status) && WITHDRAW_STATUSES.has(value.status as WithdrawStatus)
    && isString(value.createdAt);
}

function isWithdrawResult(value: unknown): value is WechatWithdrawResult {
  if (!isObject(value)) return false;
  return isString(value.withdrawId) && isFiniteNumber(value.grossAmount)
    && isFiniteNumber(value.taxAmount) && isFiniteNumber(value.taxRate)
    && isFiniteNumber(value.netAmount) && isString(value.message)
    && (value.status === 'PROCESSING' || value.status === 'PAID' || value.status === 'FAILED')
    && (value.mchId === undefined || isString(value.mchId))
    && (value.appId === undefined || isString(value.appId))
    && (value.package === undefined || isString(value.package));
}

const COUPON_STATUSES = new Set(['AVAILABLE', 'RESERVED', 'USED', 'EXPIRED', 'REVOKED']);
function isMyCoupon(value: unknown): value is MyCoupon {
  if (!isObject(value)) return false;
  return isString(value.id) && isString(value.campaignName)
    && (value.discountType === 'FIXED' || value.discountType === 'PERCENT')
    && isFiniteNumber(value.discountValue) && (value.maxDiscountAmount === null || isFiniteNumber(value.maxDiscountAmount))
    && isFiniteNumber(value.minOrderAmount) && isString(value.status) && COUPON_STATUSES.has(value.status)
    && isString(value.issuedAt) && isString(value.expiresAt)
    && isNullableString(value.usedAt) && isNullableString(value.usedOrderId)
    && (value.usedAmount === null || isFiniteNumber(value.usedAmount));
}

const CENTER_STATUSES = new Set(['CLAIMABLE', 'CLAIMED', 'SOLD_OUT', 'NOT_ELIGIBLE', 'ENDED']);
function isCenterCampaign(value: unknown): value is CouponCenterCampaign {
  if (!isObject(value) || !isObject(value.claimedSummary)) return false;
  const summary = value.claimedSummary;
  return isString(value.id) && isString(value.name)
    && isNullableString(value.description)
    && (value.discountType === 'FIXED' || value.discountType === 'PERCENT')
    && isFiniteNumber(value.discountValue) && (value.maxDiscountAmount === null || isFiniteNumber(value.maxDiscountAmount))
    && isFiniteNumber(value.minOrderAmount) && isFiniteNumber(value.remainingQuota)
    && isFiniteNumber(value.userClaimedCount) && isFiniteNumber(value.maxPerUser)
    && value.distributionMode === 'CLAIM' && typeof value.canClaim === 'boolean'
    && isString(value.startAt) && isNullableString(value.endAt)
    && isString(value.displayStatus) && CENTER_STATUSES.has(value.displayStatus)
    && isString(value.statusLabel) && isNullableString(value.ineligibleReason)
    && isFiniteNumber(summary.total) && isFiniteNumber(summary.available)
    && isFiniteNumber(summary.used) && isFiniteNumber(summary.expired)
    && isFiniteNumber(summary.reserved) && isFiniteNumber(summary.revoked)
    && isNullableString(summary.nearestExpiresAt);
}

const SUBJECT_TYPES = new Set(['CUMULATIVE_SPEND', 'SEED_ASSET', 'CREDIT_ASSET']);
const DIRECTIONS = new Set(['CREDIT', 'DEBIT']);
const SOURCE_TYPES = new Set([
  'ORDER_RECEIVED', 'CONSUMPTION_CONFIRMED', 'CONSUMPTION_PAID_FROZEN',
  'CONSUMPTION_FROZEN_RELEASED', 'CONSUMPTION_FROZEN_VOIDED', 'REFUND_REVERSAL',
  'SELF_VIP_PURCHASE', 'REFERRAL_VIP_PURCHASE', 'HISTORICAL_CONSUMPTION_GRANT',
  'ADMIN_ADJUSTMENT', 'BACKFILL',
]);
function isDigitalLedger(value: unknown): value is DigitalAssetLedger {
  if (!isObject(value)) return false;
  return isString(value.id) && isString(value.type) && SOURCE_TYPES.has(value.type)
    && isString(value.sourceType) && SOURCE_TYPES.has(value.sourceType)
    && isString(value.subjectType) && SUBJECT_TYPES.has(value.subjectType)
    && isString(value.direction) && DIRECTIONS.has(value.direction)
    && isFiniteNumber(value.amount) && isFiniteNumber(value.balanceAfter)
    && isString(value.title) && isString(value.createdAt);
}

function isDigitalSummary(value: unknown): value is DigitalAssetSummary {
  if (!isObject(value)) return false;
  return typeof value.isVip === 'boolean' && isFiniteNumber(value.totalAssetBalance)
    && isFiniteNumber(value.seedAssetBalance) && isFiniteNumber(value.creditAssetBalance)
    && isFiniteNumber(value.frozenCreditAssetBalance) && isFiniteNumber(value.cumulativeSpendAmount)
    && (value.assetRank === null || isFiniteNumber(value.assetRank))
    && Array.isArray(value.recentRecords) && value.recentRecords.every(isDigitalLedger);
}

export const MemberWalletRepo = {
  async getWallet(): Promise<Result<WalletSummary>> {
    return normalize(await ApiClient.get<unknown>('/bonus/wallet'), isWallet, 'wallet');
  },
  async getLedger(page = 1, pageSize = 20): Promise<Result<WalletLedgerPage>> {
    return normalize(
      await ApiClient.get<unknown>('/bonus/wallet/ledger', { page, pageSize }),
      isWalletLedgerPage,
      'wallet ledger page',
    );
  },
  async requestWechatWithdraw(amount: number, idempotencyKey: string): Promise<Result<WechatWithdrawResult>> {
    return normalize(
      await ApiClient.post<unknown>('/bonus/withdraw', { amount, channel: 'wechat' }, { idempotencyKey }),
      isWithdrawResult,
      'wechat withdraw',
    );
  },
  async getWithdrawHistory(): Promise<Result<WithdrawRecord[]>> {
    const result = await ApiClient.get<unknown>('/bonus/withdraw/history');
    return normalize(result, (value): value is WithdrawRecord[] => Array.isArray(value) && value.every(isWithdrawRecord), 'withdraw history');
  },
};

export const MemberCouponRepo = {
  async getMine(status?: CouponInstanceStatus): Promise<Result<MyCoupon[]>> {
    const result = await ApiClient.get<unknown>('/coupons/my', status ? { status } : undefined);
    return normalize(result, (value): value is MyCoupon[] => Array.isArray(value) && value.every(isMyCoupon), 'my coupons');
  },
  async getCenter(view: CouponCenterView): Promise<Result<CouponCenterCampaign[]>> {
    const result = await ApiClient.get<unknown>('/coupons/center', { view });
    return normalize(result, (value): value is CouponCenterCampaign[] => Array.isArray(value) && value.every(isCenterCampaign), 'coupon center');
  },
  async claim(campaignId: string): Promise<Result<MyCoupon>> {
    return normalize(await ApiClient.post<unknown>(`/coupons/claim/${campaignId}`), isMyCoupon, 'claimed coupon');
  },
};

export const MemberDigitalAssetRepo = {
  async getSummary(): Promise<Result<DigitalAssetSummary>> {
    return normalize(await ApiClient.get<unknown>('/me/digital-assets/summary'), isDigitalSummary, 'digital asset summary');
  },
  async getLedgers(query: DigitalAssetLedgerQuery = {}): Promise<Result<DigitalAssetLedgerPage>> {
    const result = await ApiClient.get<unknown>('/me/digital-assets/ledgers', {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      subjectType: query.subjectType,
      sourceType: query.sourceType,
    });
    if (!result.ok) return result;
    if (!isPageResult(result.data)) return invalidContract('digital asset ledger page');
    const page = withNextPage(result.data);
    if (!page.items.every(isDigitalLedger)) return invalidContract('digital asset ledger page');
    return { ok: true, data: page as DigitalAssetLedgerPage };
  },
};
