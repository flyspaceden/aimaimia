import type { WalletLedgerEntry } from '../types/domain/Bonus';

const sellerAccountLabel: Record<string, string> = {
  INDUSTRY_FUND: '产业基金',
  CHARITY_FUND: '慈善基金',
  TECH_FUND: '科技基金',
  RESERVE_FUND: '备用金',
  PLATFORM_PROFIT: '平台利润',
};

const refTypeLabel: Record<string, string> = {
  ORDER: '消费返积分',
  REFERRAL: '推荐返积分',
  VIP_REFERRAL: '推荐返积分',
  VIP_TREE: '消费返积分',
  NORMAL_TREE: '消费返积分',
  NORMAL_BROADCAST: '消费返积分',
  WITHDRAW: '提现到支付宝',
};

export function isGroupBuyRebateLedger(entry: WalletLedgerEntry): boolean {
  return entry.source === 'GROUP_BUY_REBATE' || entry.accountType === 'GROUP_BUY_REBATE';
}

export function isPendingGroupBuyRebate(entry: WalletLedgerEntry): boolean {
  return isGroupBuyRebateLedger(entry)
    && (entry.entryType === 'PENDING_REBATE' || entry.type === 'PENDING_REBATE' || entry.status === 'PENDING');
}

export function isWalletDeductionTitle(title: string): boolean {
  return title === '消费抵扣' || title === '团购返还抵扣';
}

export function getWalletLedgerTitle(entry: WalletLedgerEntry): string {
  if (isGroupBuyRebateLedger(entry)) {
    if (isPendingGroupBuyRebate(entry)) {
      return '团购返还冻结中';
    }
    if (entry.entryType === 'DEDUCT' || entry.type === 'DEDUCT') {
      return '团购返还抵扣';
    }
    if (entry.entryType === 'WITHDRAW' || entry.refType === 'WITHDRAW') {
      return '团购返还提现';
    }
    if (entry.entryType === 'RELEASE' || entry.type === 'RELEASE' || entry.status === 'AVAILABLE') {
      return '团购返还到账';
    }
    return '团购返还';
  }

  const sellerLabel = entry.accountType ? sellerAccountLabel[entry.accountType] : null;
  if (sellerLabel) {
    return sellerLabel;
  }

  const isIncome = entry.entryType === 'RELEASE' || entry.entryType === 'CREDIT';
  const isAdjust = entry.entryType === 'ADJUST';
  return refTypeLabel[entry.refType ?? ''] ?? (isIncome ? '消费返积分' : isAdjust ? '系统调整' : '支出');
}
