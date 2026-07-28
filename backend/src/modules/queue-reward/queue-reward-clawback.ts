import { yuanToCents } from '../profit/money-allocation';

export type PendingQueueClawbackLedger = {
  amount: number;
  meta: unknown;
};

/**
 * 计算仍未偿还的队列奖励追偿金额。
 *
 * 新记录把剩余欠款写在 meta.clawbackAmount；读取 amount 只是兼容
 * 早期或异常缺少 meta 的负向追偿流水。全程返回整数分，避免钱包展示
 * 与提现校验分别使用 Float 后出现一分钱差异。
 */
export function pendingQueueClawbackCents(
  ledgers: PendingQueueClawbackLedger[],
): number {
  return ledgers.reduce((sum, ledger) => {
    const meta =
      ledger.meta &&
      typeof ledger.meta === 'object' &&
      !Array.isArray(ledger.meta)
        ? (ledger.meta as Record<string, unknown>)
        : {};
    if (meta.scheme !== 'GLOBAL_QUEUE_VOID') return sum;

    const pending = meta.clawbackAmount;
    const amountCents =
      typeof pending === 'number' &&
      Number.isFinite(pending)
      ? Math.max(0, yuanToCents(pending))
      : Math.max(0, -yuanToCents(ledger.amount));
    const next = sum + amountCents;
    if (!Number.isSafeInteger(next)) {
      throw new Error('queue clawback total exceeds the safe cent range');
    }
    return next;
  }, 0);
}
