import { allocateProfitRateBuckets } from './profit-rate-allocation';

describe('allocateProfitRateBuckets', () => {
  it('allocates all member buckets with one largest-remainder calculation', () => {
    expect(allocateProfitRateBuckets(1_325, {
      reward: 0.2,
      directReferral: 0.15,
      industryFund: 0.15,
      charity: 0.1,
      tech: 0.1,
      reserve: 0.09,
    })).toEqual({
      platform: 278,
      reward: 265,
      directReferral: 199,
      industryFund: 199,
      charity: 133,
      tech: 132,
      reserve: 119,
    });
  });

  it('never allocates more than one cent when two half-cent buckets compete', () => {
    const result = allocateProfitRateBuckets(1, {
      reward: 0.5,
      directReferral: 0.5,
      industryFund: 0,
      charity: 0,
      tech: 0,
      reserve: 0,
    });

    expect(Object.values(result).reduce((sum, cents) => sum + cents, 0)).toBe(1);
    expect(result.reward).toBe(1);
    expect(result.directReferral).toBe(0);
  });
});
