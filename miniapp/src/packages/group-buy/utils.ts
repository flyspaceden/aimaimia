import type {
  GroupBuyActivity,
  GroupBuyCurrentInstance,
  GroupBuyLedger,
  GroupBuyLedgerStatus,
} from './types';

export const GROUP_BUY_PAGE = '/packages/group-buy/activity-list/index';
export const GROUP_BUY_DETAIL_PAGE = '/packages/group-buy/activity-detail/index';

export function formatGroupBuyMoney(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(2) : '0.00';
}

export function createGroupBuyIdempotencyKey(): string {
  return `mini-group-buy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function groupBuyItems(activity: GroupBuyActivity) {
  if (activity.items?.length) return activity.items;
  return [{
    productId: activity.product.id,
    productTitle: activity.product.title,
    imageUrl: activity.product.imageUrl,
    skuId: activity.sku.id,
    skuTitle: activity.sku.title,
    stock: activity.sku.stock,
    weightGram: activity.sku.weightGram,
    quantity: 1,
  }];
}

export function availableGroupBuyStock(activity: GroupBuyActivity): number {
  return Math.max(0, Math.floor(activity.availableStock ?? activity.sku.stock ?? 0));
}

export function groupBuyTargetCount(activity: Pick<GroupBuyActivity, 'tiers'>): number {
  return Math.max(1, activity.tiers.length);
}

export function groupBuyProgress(instance: GroupBuyCurrentInstance) {
  const target = groupBuyTargetCount(instance.activity);
  const locked = Math.min(target, instance.referrals.filter(
    (item) => item.status === 'CANDIDATE' || item.status === 'VALID',
  ).length);
  return { target, locked, valid: Math.min(target, instance.validReferralCount), remaining: Math.max(0, target - locked) };
}

export function groupBuyRemainingText(endAt?: string | null, now = Date.now()): string {
  if (!endAt) return '活动时间以服务端为准';
  const remaining = new Date(endAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return '活动已结束';
  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
  return `剩余 ${hours} 小时 ${minutes} 分钟`;
}

const CODE_PATTERN = /^[A-Z0-9]{4,64}$/;

export function normalizeGroupBuyCode(value?: string): string | null {
  let candidate = value?.trim() || '';
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  candidate = candidate.replace(/^(?:group-buy:|gb[:_-])/i, '').trim().toUpperCase();
  return CODE_PATTERN.test(candidate) ? candidate : null;
}

export function resolveGroupBuyEntryCode(params: Record<string, string | undefined>): string | null {
  return normalizeGroupBuyCode(params.shareCode)
    ?? normalizeGroupBuyCode(params.code)
    ?? normalizeGroupBuyCode(params.scene);
}

export function extractGroupBuyCodeFromScan(raw?: string): string | null {
  const value = raw?.trim() || '';
  if (!value) return null;
  const queryCode = value.match(/[?&](?:shareCode|code|scene)=([^&#]+)/i)?.[1];
  const pathCode = value.match(/(?:^|\/)gb\/([^/?#]+)/i)?.[1];
  if (queryCode || pathCode) return normalizeGroupBuyCode(queryCode || pathCode);
  try {
    const parsed = new URL(value);
    const parsedCode = parsed.searchParams.get('shareCode') || parsed.searchParams.get('code') || parsed.searchParams.get('scene');
    return normalizeGroupBuyCode(parsedCode || undefined);
  } catch {
    return normalizeGroupBuyCode(value);
  }
}

export function buildGroupBuySharePath(code: string, activityId: string): string {
  const normalized = normalizeGroupBuyCode(code);
  if (!normalized) return GROUP_BUY_PAGE;
  return `${GROUP_BUY_DETAIL_PAGE}?activityId=${encodeURIComponent(activityId)}&shareCode=${encodeURIComponent(normalized)}`;
}

export function isGroupBuyActivityExpired(activity: GroupBuyActivity, now = Date.now()): boolean {
  const end = activity.endAt ? new Date(activity.endAt).getTime() : Number.NaN;
  return activity.status === 'ENDED' || !Number.isFinite(end) || end <= now;
}

export function groupBuyLedgerPresentation(ledger: GroupBuyLedger): { title: string; amount: number; tone: 'income' | 'pending' | 'expense' | 'muted' } {
  if (ledger.type === 'PENDING_REBATE') return { title: '好友订单返还冻结', amount: ledger.amount, tone: 'pending' };
  if (ledger.type === 'RELEASE') return { title: '团购返还到账', amount: ledger.amount, tone: 'income' };
  if (ledger.type === 'WITHDRAW') return { title: '提现扣减', amount: -Math.abs(ledger.amount), tone: 'expense' };
  if (ledger.type === 'DEDUCT') return { title: '消费抵扣', amount: -Math.abs(ledger.amount), tone: 'expense' };
  if (ledger.type === 'REFUND_RETURN') return { title: '失败退回', amount: Math.abs(ledger.amount), tone: 'income' };
  if (ledger.type === 'VOID') return { title: '返还失效', amount: ledger.amount, tone: 'muted' };
  return { title: '账户调整', amount: ledger.amount, tone: ledger.amount >= 0 ? 'income' : 'expense' };
}

const GROUP_BUY_LEDGER_STATUS_LABELS: Record<GroupBuyLedgerStatus, string> = {
  PENDING: '冻结中',
  AVAILABLE: '可用',
  RESERVED: '处理中',
  COMPLETED: '已完成',
  VOIDED: '已作废',
  FAILED: '处理失败',
};

export function groupBuyLedgerStatusLabel(status: GroupBuyLedgerStatus): string {
  return GROUP_BUY_LEDGER_STATUS_LABELS[status];
}

export function formatGroupBuyDate(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function isUserCancelledGroupBuyPayment(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'errMsg' in error
      ? String((error as { errMsg?: unknown }).errMsg || '')
      : String(error || '');
  return message.toLowerCase().includes('cancel');
}
