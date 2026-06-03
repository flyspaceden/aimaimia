import {
  calculateRefundAmount,
  isWithinReturnWindow,
  requiresReturnShipping,
} from './after-sale.utils';

describe('requiresReturnShipping', () => {
  it('无理由换货低金额免寄回，高金额需要寄回', () => {
    expect(requiresReturnShipping('NO_REASON_EXCHANGE', 49, 50)).toBe(false);
    expect(requiresReturnShipping('NO_REASON_EXCHANGE', 51, 50)).toBe(true);
  });
});

describe('isWithinReturnWindow', () => {
  it('无理由换货使用 RETURNABLE 商品的七天窗口', () => {
    const deliveredAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(isWithinReturnWindow(deliveredAt, null, 'RETURNABLE', 'NO_REASON_EXCHANGE', 7, 7, 24)).toBe(true);
  });

  it('NON_RETURNABLE 商品不允许无理由换货', () => {
    const deliveredAt = new Date();
    expect(isWithinReturnWindow(deliveredAt, null, 'NON_RETURNABLE', 'NO_REASON_EXCHANGE', 7, 7, 24)).toBe(false);
  });
});

describe('calculateRefundAmount', () => {
  it('按商品占比分摊奖励、红包、VIP 折扣，避免退款超过用户实付', () => {
    const refund = calculateRefundAmount(
      100,
      1,
      100,
      10,
      20,
      5,
      0,
      'QUALITY_RETURN',
      false,
    );

    expect(refund).toBe(65);
  });

  it('整单质量退货在扣除全部抵扣后退还运费', () => {
    const refund = calculateRefundAmount(
      100,
      1,
      100,
      10,
      20,
      5,
      8,
      'QUALITY_RETURN',
      true,
    );

    expect(refund).toBe(73);
  });

  it('无理由退货整单退款不退运费', () => {
    const refund = calculateRefundAmount(
      100,
      1,
      100,
      10,
      20,
      5,
      8,
      'NO_REASON_RETURN',
      true,
    );

    expect(refund).toBe(65);
  });

  it('订单抵扣异常大于商品金额时退款不为负数', () => {
    const refund = calculateRefundAmount(
      20,
      1,
      20,
      15,
      15,
      15,
      0,
      'QUALITY_RETURN',
      false,
    );

    expect(refund).toBe(0);
  });

  it('无理由退货从退款中扣除退货运费且退款最低为 0', () => {
    const refund = calculateRefundAmount(20, 1, 20, 0, 0, 0, 0, 'NO_REASON_RETURN', false, 25);
    expect(refund).toBe(0);
  });
});
