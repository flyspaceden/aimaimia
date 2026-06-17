import { getAwardedPrizeQuantity } from './prize-quantity.util';

describe('getAwardedPrizeQuantity', () => {
  it('clamps discount-buy prizes to one checkout item', () => {
    expect(getAwardedPrizeQuantity('DISCOUNT_BUY', 100)).toBe(1);
  });

  it('keeps configured quantity for threshold gifts', () => {
    expect(getAwardedPrizeQuantity('THRESHOLD_GIFT', 3)).toBe(3);
  });

  it('falls back to one for missing or invalid quantities', () => {
    expect(getAwardedPrizeQuantity('THRESHOLD_GIFT', null)).toBe(1);
    expect(getAwardedPrizeQuantity('THRESHOLD_GIFT', 0)).toBe(1);
    expect(getAwardedPrizeQuantity('THRESHOLD_GIFT', 1.8)).toBe(1);
  });
});
