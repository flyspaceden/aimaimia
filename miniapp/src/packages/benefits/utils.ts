import Taro from '@tarojs/taro';
import type { CartMergeItem, CheckoutSession } from '@/types';
import type { GrowthExchangeRecord, PendingPrizeClaim, QueueRewardStatus, VipCheckoutDraft } from './types';

const environment = process.env.TARO_APP_ENV || 'development';
const FINGERPRINT_KEY = `aimai-benefits-fingerprint-v1:${environment}`;
const CLAIM_KEY = `aimai-pending-prize-v1:${environment}`;
const VIP_DRAFT_KEY = `aimai-vip-checkout-draft-v1:${environment}`;
const VIP_SESSION_KEY = `aimai-vip-checkout-session-v1:${environment}`;

export function createOperationKey(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
}

export function formatMoney(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

export function formatDate(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function formatPercent(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '以平台规则为准';
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

export function benefitsLoginUrl(returnUrl: string): string {
  return `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}`;
}

const EXCHANGE_STATUS_LABELS: Record<GrowthExchangeRecord['status'], string> = {
  PENDING: '处理中',
  SUCCESS: '兑换成功',
  FAILED: '兑换失败',
  REVERSED: '已退回',
};

const QUEUE_ORDER_STATUS_LABELS: Record<QueueRewardStatus['recentOrders'][number]['status'], string> = {
  ACTIVE: '进行中',
  CAPPED: '已达上限',
  COMPLETED: '已完成',
  VOIDED: '已作废',
};

export function exchangeStatusLabel(status: GrowthExchangeRecord['status']): string {
  return EXCHANGE_STATUS_LABELS[status];
}

export function queueOrderStatusLabel(status: QueueRewardStatus['recentOrders'][number]['status']): string {
  return QUEUE_ORDER_STATUS_LABELS[status];
}

export function safeTaskTarget(route: string): string | undefined {
  const normalized = route.trim().toLowerCase();
  if (!normalized.startsWith('/') || normalized.startsWith('//') || normalized.includes('://') || normalized.includes('\\')) return undefined;
  if (normalized.includes('lottery')) return '/packages/benefits/lottery/index';
  if (normalized.includes('growth')) return '/packages/benefits/growth/index';
  if (normalized.includes('vip')) return '/packages/benefits/vip-center/index';
  if (normalized.includes('cart')) return '/packages/commerce/cart/index';
  if (normalized.includes('product') || normalized.includes('search')) return '/pages/products/index';
  if (normalized === '/' || normalized.includes('home')) return '/pages/home/index';
  return undefined;
}

export function buildPrizeMergeItem(claim: PendingPrizeClaim): CartMergeItem {
  const tokenKey = claim.claimToken.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || claim.prizeId.slice(0, 24);
  return {
    localKey: `pending-prize-${claim.prizeId}`,
    skuId: `pending-prize-${tokenKey}`,
    quantity: 1,
    isPrize: true,
    claimToken: claim.claimToken,
  };
}

export function getDeviceFingerprint(): string {
  const stored = Taro.getStorageSync<string>(FINGERPRINT_KEY);
  if (typeof stored === 'string' && stored.length >= 32 && stored.length <= 128) return stored;
  const created = `mini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`.padEnd(32, '0').slice(0, 96);
  Taro.setStorageSync(FINGERPRINT_KEY, created);
  return created;
}

export function savePendingPrize(claim: PendingPrizeClaim): void {
  Taro.setStorageSync(CLAIM_KEY, claim);
}

export function readPendingPrize(): PendingPrizeClaim | undefined {
  const value = Taro.getStorageSync<PendingPrizeClaim>(CLAIM_KEY);
  if (!value || typeof value !== 'object' || typeof value.claimToken !== 'string'
    || value.claimToken.length < 16 || typeof value.prizeId !== 'string' || value.prizeId.length > 96
    || typeof value.prizeName !== 'string' || typeof value.createdAt !== 'string'
    || typeof value.mergeKey !== 'string') return undefined;
  return value;
}

export function clearPendingPrize(): void {
  Taro.removeStorageSync(CLAIM_KEY);
}

export function saveVipCheckoutDraft(draft: VipCheckoutDraft): void {
  Taro.setStorageSync(VIP_DRAFT_KEY, draft);
}

export function readVipCheckoutDraft(userId: string): VipCheckoutDraft | undefined {
  const value = Taro.getStorageSync<VipCheckoutDraft>(VIP_DRAFT_KEY);
  if (!value || typeof value !== 'object' || value.userId !== userId
    || typeof value.idempotencyKey !== 'string' || typeof value.packageId !== 'string'
    || typeof value.giftOptionId !== 'string' || typeof value.addressId !== 'string'
    || typeof value.expectedTotal !== 'number' || !Number.isFinite(value.expectedTotal)) return undefined;
  return value;
}

export function clearVipCheckoutDraft(): void {
  Taro.removeStorageSync(VIP_DRAFT_KEY);
}

export function saveVipCheckoutSession(userId: string, session: CheckoutSession): void {
  Taro.setStorageSync(VIP_SESSION_KEY, { userId, session, createdAt: new Date().toISOString() });
}

export function readVipCheckoutSession(userId: string): CheckoutSession | undefined {
  const value = Taro.getStorageSync<{ userId: string; session: CheckoutSession }>(VIP_SESSION_KEY);
  if (!value || typeof value !== 'object' || value.userId !== userId || !value.session || typeof value.session !== 'object') return undefined;
  const session = value.session;
  if (typeof session.sessionId !== 'string' || typeof session.merchantOrderNo !== 'string'
    || typeof session.expectedTotal !== 'number' || session.paymentScene !== 'MINI_PROGRAM'
    || !session.paymentParams || typeof session.paymentParams !== 'object'
    || typeof session.paymentParams.timeStamp !== 'string' || typeof session.paymentParams.nonceStr !== 'string'
    || typeof session.paymentParams.package !== 'string' || typeof session.paymentParams.paySign !== 'string') return undefined;
  return session;
}

export function clearVipCheckoutSession(): void {
  Taro.removeStorageSync(VIP_SESSION_KEY);
}
