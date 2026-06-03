declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;
declare const require: any;

const {
  isAfterSaleRefundPollingActive,
  isAfterSaleRefundTerminal,
} = require('../afterSaleRefundSync');

describe('afterSaleRefundSync', () => {
  it('polls while either after-sale status or refund status is REFUNDING', () => {
    expect(isAfterSaleRefundPollingActive({ status: 'REFUNDING' })).toBe(true);
    expect(isAfterSaleRefundPollingActive({ status: 'APPROVED', refundStatus: 'REFUNDING' })).toBe(true);
    expect(isAfterSaleRefundPollingActive({ status: 'REFUNDED', refundStatus: 'REFUNDED' })).toBe(false);
    expect(isAfterSaleRefundPollingActive({ status: 'REFUNDING', refundStatus: 'FAILED' })).toBe(false);
    expect(isAfterSaleRefundPollingActive({ status: 'REFUNDING', refundStatus: 'REJECTED' })).toBe(false);
  });

  it('treats refunded and failed refunds as terminal for cache invalidation', () => {
    expect(isAfterSaleRefundTerminal({ status: 'REFUNDED' })).toBe(true);
    expect(isAfterSaleRefundTerminal({ status: 'COMPLETED', refundStatus: 'REFUNDED' })).toBe(true);
    expect(isAfterSaleRefundTerminal({ status: 'REFUNDING', refundStatus: 'FAILED' })).toBe(true);
    expect(isAfterSaleRefundTerminal({ status: 'REFUNDING', refundStatus: 'REJECTED' })).toBe(true);
    expect(isAfterSaleRefundTerminal({ status: 'APPROVED' })).toBe(false);
  });
});
