import {
  calculateCreditAsset,
  validateCreditTiers,
} from './digital-asset-credit-calculator';

const defaultTiers = [
  { minAmount: 0, maxAmount: 500, multiplier: 3 },
  { minAmount: 500, maxAmount: 5000, multiplier: 5 },
  { minAmount: 5000, maxAmount: null, multiplier: 10 },
];

describe('digital asset credit calculator', () => {
  it('calculates across a tier boundary from previous cumulative spend', () => {
    expect(calculateCreditAsset({
      previousCumulativeSpend: 480,
      addedSpend: 100,
      tiers: defaultTiers,
    }).assetAmount).toBe(460);
  });

  it('calculates multiple tier segments and rounds the final asset amount', () => {
    expect(calculateCreditAsset({
      previousCumulativeSpend: 0,
      addedSpend: 5800,
      tiers: defaultTiers,
    }).assetAmount).toBe(32000);
  });

  it('rejects tiers with a gap between adjacent ranges', () => {
    expect(() => validateCreditTiers([
      { minAmount: 0, maxAmount: 500, multiplier: 3 },
      { minAmount: 600, maxAmount: null, multiplier: 5 },
    ])).toThrow('消费资产倍率档位不能断档');
  });

  it('rejects tiers with a zero multiplier', () => {
    expect(() => validateCreditTiers([
      { minAmount: 0, maxAmount: null, multiplier: 0 },
    ])).toThrow('消费资产倍率必须大于0');
  });
});
