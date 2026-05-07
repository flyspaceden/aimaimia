import { calculateRefundAmount } from './after-sale.utils';

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
});
