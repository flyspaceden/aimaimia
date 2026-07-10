import { calculateCaptainProfitFunding } from './captain-profit-funding';

describe('calculateCaptainProfitFunding', () => {
  const memberProfitRates = {
    reward: 0.2,
    directReferral: 0.04,
    industryFund: 0.1,
    charity: 0,
    tech: 0,
    reserve: 0,
  };

  it('calculates the golden vector in cents without putting monthly hold in a balance', () => {
    expect(calculateCaptainProfitFunding({
      distributableProfitAmount: 50,
      captainEligibleProfitAmount: 35,
      memberProfitRates,
      directReferralClaimed: true,
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
      memberProfitRates,
      directReferralClaimed: false,
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
      captainEligibleProfitAmount: 8,
      memberProfitRates,
      directReferralClaimed: true,
      captainDirectProfitRate: 0.5,
      monthlyProfitRates: [0.2],
    })).toEqual({
      platformRetainedAmount: 5.28,
      directAmount: 4,
      monthlyMaximum: 1.6,
      totalHoldAmount: 5.6,
      coveredByPlatformRetained: false,
    });
  });

  it('rejects a corrupted snapshot where captain-eligible profit exceeds D', () => {
    expect(() => calculateCaptainProfitFunding({
      distributableProfitAmount: 8,
      captainEligibleProfitAmount: 8.01,
      memberProfitRates,
      directReferralClaimed: true,
      captainDirectProfitRate: 0.11,
      monthlyProfitRates: [0.045],
    })).toThrow('cannot exceed');
  });

  it('uses the same penny allocation as member rewards when calculating retained funding', () => {
    expect(calculateCaptainProfitFunding({
      distributableProfitAmount: 0.01,
      captainEligibleProfitAmount: 0.01,
      memberProfitRates: {
        reward: 0.5,
        directReferral: 0.5,
        industryFund: 0,
        charity: 0,
        tech: 0,
        reserve: 0,
      },
      directReferralClaimed: true,
      captainDirectProfitRate: 0,
      monthlyProfitRates: [0],
    })).toMatchObject({
      platformRetainedAmount: 0,
      totalHoldAmount: 0,
      coveredByPlatformRetained: true,
    });

    expect(calculateCaptainProfitFunding({
      distributableProfitAmount: 0.01,
      captainEligibleProfitAmount: 0.01,
      memberProfitRates: {
        reward: 0,
        directReferral: 1,
        industryFund: 0,
        charity: 0,
        tech: 0,
        reserve: 0,
      },
      directReferralClaimed: false,
      captainDirectProfitRate: 0,
      monthlyProfitRates: [0],
    })).toMatchObject({
      platformRetainedAmount: 0.01,
      totalHoldAmount: 0,
      coveredByPlatformRetained: true,
    });
  });
});
