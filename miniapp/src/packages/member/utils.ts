import type {
  CouponDiscountType,
  DigitalAssetLedger,
  DigitalAssetSourceType,
  DigitalAssetSubjectType,
  WechatWithdrawResult,
  WalletLedgerEntry,
} from './types';

export type AssetLedgerFilter =
  | 'all'
  | 'seed'
  | 'consumption'
  | 'frozen'
  | 'spend'
  | 'refund'
  | 'adjustment';

export const ASSET_FILTER_QUERY: Record<
  AssetLedgerFilter,
  { subjectType?: DigitalAssetSubjectType; sourceType?: DigitalAssetSourceType }
> = {
  all: {},
  seed: { subjectType: 'SEED_ASSET' },
  consumption: { subjectType: 'CREDIT_ASSET' },
  frozen: { sourceType: 'CONSUMPTION_PAID_FROZEN' },
  spend: { subjectType: 'CUMULATIVE_SPEND' },
  refund: { sourceType: 'REFUND_REVERSAL' },
  adjustment: { sourceType: 'ADMIN_ADJUSTMENT' },
};

export function formatMoney(value: number): string {
  return `¥${Number.isFinite(value) ? value.toFixed(2) : '0.00'}`;
}

export function formatAsset(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('zh-CN');
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCouponDiscount(
  type: CouponDiscountType,
  value: number,
): string {
  return type === 'PERCENT'
    ? `${Number((10 - value / 10).toFixed(1))}折`
    : formatMoney(value);
}

export function isWithdrawLedger(entry: WalletLedgerEntry): boolean {
  return entry.entryType === 'WITHDRAW' || entry.refType === 'WITHDRAW';
}

export function walletLedgerPresentation(entry: WalletLedgerEntry): {
  title: string;
  description: string;
  amount: number;
  tone: 'income' | 'expense' | 'frozen' | 'failed';
} {
  const isWithdraw = isWithdrawLedger(entry);
  const isDeduct = entry.entryType === 'DEDUCT';
  const isFrozen = entry.status === 'FROZEN'
    || entry.entryType === 'FREEZE'
    || entry.source === 'GROUP_BUY_REBATE' && entry.status === 'PENDING';
  const isVoided = entry.status === 'VOIDED' || entry.entryType === 'VOID';
  const metaOrderNo = typeof entry.meta?.orderNo === 'string' ? entry.meta.orderNo : '';

  if (isWithdraw && isVoided) {
    return { title: '余额提现', description: '提现未成功，余额已退回', amount: Math.abs(entry.amount), tone: 'failed' };
  }
  if (isWithdraw) {
    return {
      title: '余额提现',
      description: entry.status === 'FROZEN' || entry.status === 'PROCESSING' ? '提现处理中' : '提现记录',
      amount: -Math.abs(entry.amount),
      tone: 'expense',
    };
  }
  if (isDeduct) {
    return {
      title: '消费积分抵扣',
      description: metaOrderNo ? `订单 ${metaOrderNo}` : '订单金额抵扣',
      amount: -Math.abs(entry.amount),
      tone: 'expense',
    };
  }
  if (entry.refType === 'REFUND_RESTORE') {
    return {
      title: '退款返还',
      description: metaOrderNo ? `订单 ${metaOrderNo}` : '消费积分返还',
      amount: Math.abs(entry.amount),
      tone: 'income',
    };
  }
  if (isFrozen) {
    return {
      title: entry.source === 'GROUP_BUY_REBATE' ? '团购返还' : '消费积分',
      description: entry.source === 'GROUP_BUY_REBATE' ? '待收货释放' : '冻结中',
      amount: Math.abs(entry.amount),
      tone: 'frozen',
    };
  }
  if (isVoided) {
    return { title: '消费积分', description: '已失效', amount: Math.abs(entry.amount), tone: 'failed' };
  }
  return {
    title: entry.sourceLabel || (entry.source === 'GROUP_BUY_REBATE' ? '团购返还' : '消费积分到账'),
    description: entry.accountType === 'INDUSTRY_FUND' ? '产业基金' : '已计入统一钱包',
    amount: Math.abs(entry.amount),
    tone: 'income',
  };
}

export function hasMerchantTransferConfirmation(
  result: WechatWithdrawResult,
): result is WechatWithdrawResult & { mchId: string; appId: string; package: string } {
  return result.status === 'PROCESSING'
    && typeof result.mchId === 'string' && result.mchId.length > 0
    && typeof result.appId === 'string' && result.appId.length > 0
    && typeof result.package === 'string' && result.package.length > 0;
}

export function isPendingWithdrawStatus(status: string): boolean {
  return status === 'REQUESTED' || status === 'APPROVED' || status === 'PROCESSING';
}

export function digitalLedgerTitle(item: DigitalAssetLedger): string {
  if (item.sourceType === 'CONSUMPTION_CONFIRMED' && item.subjectType === 'CUMULATIVE_SPEND') return '消费累计';
  if (item.sourceType === 'CONSUMPTION_CONFIRMED' && item.subjectType === 'CREDIT_ASSET') return '消费资产入账';
  if (item.sourceType === 'CONSUMPTION_PAID_FROZEN') return '消费资产冻结';
  if (item.sourceType === 'CONSUMPTION_FROZEN_RELEASED') return '消费资产释放';
  if (item.sourceType === 'CONSUMPTION_FROZEN_VOIDED') return '冻结资产作废';
  if (item.sourceType === 'SELF_VIP_PURCHASE') return '自购 VIP 种子资产';
  if (item.sourceType === 'REFERRAL_VIP_PURCHASE') return '推荐 VIP 种子资产';
  if (item.sourceType === 'HISTORICAL_CONSUMPTION_GRANT') return '历史消费转入';
  if (item.sourceType === 'REFUND_REVERSAL') return '退款扣回';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return '后台调整';
  return item.title || '资产流水';
}

export function digitalLedgerAmount(item: DigitalAssetLedger): string {
  const sign = item.direction === 'DEBIT' ? '-' : '+';
  const amount = Math.abs(item.assetAmount ?? item.amount);
  return item.subjectType === 'CUMULATIVE_SPEND'
    ? `${sign}${formatMoney(Math.abs(item.amount))}`
    : `${sign}${formatAsset(amount)}`;
}

export function digitalLedgerBalance(item: DigitalAssetLedger): string {
  if (item.subjectType === 'CUMULATIVE_SPEND') return `累计 ${formatMoney(item.balanceAfter)}`;
  if (item.status === 'FROZEN' || item.status === 'VOIDED') {
    return `冻结 ${formatAsset(item.frozenCreditAssetBalanceAfter ?? item.balanceAfter)}`;
  }
  return `余额 ${formatAsset(item.balanceAfter)}`;
}

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10, 16)]
    .map((part) => part.join(''))
    .join('-');
}

export function createWithdrawIdempotencyKey(): string {
  const cryptoApi = (globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array) => Uint8Array };
  }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return uuidFromBytes(bytes);
}
