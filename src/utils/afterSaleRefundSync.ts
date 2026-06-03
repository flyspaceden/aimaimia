import type { AfterSaleRequest } from '../types/domain/Order';

type RefundSyncState = Pick<AfterSaleRequest, 'status' | 'refundStatus'>;

export function isAfterSaleRefundPollingActive(afterSale?: Partial<RefundSyncState> | null): boolean {
  if (isAfterSaleRefundTerminal(afterSale)) {
    return false;
  }
  return afterSale?.status === 'REFUNDING' || afterSale?.refundStatus === 'REFUNDING';
}

export function isAfterSaleRefundTerminal(afterSale?: Partial<RefundSyncState> | null): boolean {
  return (
    afterSale?.status === 'REFUNDED' ||
    afterSale?.refundStatus === 'REFUNDED' ||
    afterSale?.refundStatus === 'FAILED' ||
    afterSale?.refundStatus === 'REJECTED'
  );
}
