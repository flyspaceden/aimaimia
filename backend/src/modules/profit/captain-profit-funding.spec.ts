import { calculateCaptainProfitFunding } from './captain-profit-funding';

describe('calculateCaptainProfitFunding', () => {
  it('calculates the golden vector in cents without putting monthly hold in a balance', () => {
    expect(calculateCaptainProfitFunding({
      distributableProfitAmount: 50,
      captainEligibleProfitAmount: 35,
      treeRewardProfitRate: 0.2,
      industryFundProfitRate: 0.1,
      actualDirectReferralProfitRate: 0.04,
      captainDirectProfitRate: 0.11,
      monthlyProfitRates: [0.02, 0.01, 0.005, 0.01],
    })).toEqual({
      platformRetainedAmount: 33,
      directAmount: 3.85,
      monthlyMaximum: 1.58,
      totalHoldAmount: 5.43,
      coveredByPlatformRetained: true,
    });
  });

  it('retains the direct referral share when no external direct reward is paid', () => {
    const result = calculateCaptainProfitFunding({
      distributableProfitAmount: 50,
      captainEligibleProfitAmount: 35,
      treeRewardProfitRate: 0.2,
      industryFundProfitRate: 0.1,
      actualDirectReferralProfitRate: 0,
      captainDirectProfitRate: 0.11,
      monthlyProfitRates: [0.045],
    });

    expect(result.platformRetainedAmount).toBe(35);
    expect(result.totalHoldAmount).toBe(5.43);
    expect(result.coveredByPlatformRetained).toBe(true);
  });

  it('reports an invariant failure instead of shrinking configured captain rates', () => {
    expect(calculateCaptainProfitFunding({
      distributableProfitAmount: 8,
      captainEligibleProfitAmount: 35,
      treeRewardProfitRate: 0.2,
      industryFundProfitRate: 0.1,
      actualDirectReferralProfitRate: 0.04,
      captainDirectProfitRate: 0.11,
      monthlyProfitRates: [0.02, 0.01, 0.005, 0.01],
    })).toEqual({
      platformRetainedAmount: 5.28,
      directAmount: 3.85,
      monthlyMaximum: 1.58,
      totalHoldAmount: 5.43,
      coveredByPlatformRetained: false,
    });
  });
});
