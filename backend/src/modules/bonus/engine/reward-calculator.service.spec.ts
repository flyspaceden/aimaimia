import { BonusConfig } from './bonus-config.service';
import { RewardCalculatorService } from './reward-calculator.service';

describe('RewardCalculatorService.calculateVip direct referral pool', () => {
  const makeConfig = (overrides: Partial<BonusConfig> = {}) =>
    ({
      vipPlatformPercent: 0.5,
      vipRewardPercent: 0.3,
      vipDirectReferralPercent: 0,
      vipIndustryFundPercent: 0.1,
      vipCharityPercent: 0.02,
      vipTechPercent: 0.02,
      vipReservePercent: 0.06,
      vipMinAmount: 100,
      vipMaxLayers: 15,
      vipBranchFactor: 3,
      vipFreezeDays: 30,
      normalPlatformPercent: 0.49,
      normalRewardPercent: 0.16,
      normalDirectReferralPercent: 0.01,
      normalIndustryFundPercent: 0.16,
      normalCharityPercent: 0.08,
      normalTechPercent: 0.08,
      normalReservePercent: 0.02,
      normalBranchFactor: 3,
      normalMaxLayers: 15,
      normalFreezeDays: 30,
      rebateRatio: 0.5,
      rewardPoolPercent: 0.6,
      platformPercent: 0.37,
      fundPercent: 0.01,
      pointsPercent: 0.02,
      normalBroadcastX: 20,
      bucketRanges: [[0, 10], [10, null]],
      markupRate: 1.3,
      defaultShippingFee: 8,
      autoConfirmDays: 7,
      lotteryEnabled: true,
      lotteryDailyChances: 1,
      vipDiscountRate: 0.95,
      vipFreeShippingThreshold: 49,
      normalFreeShippingThreshold: 99,
      autoVipBySpendEnabled: true,
      autoVipCumulativeSpendThreshold: 399,
      ruleVersion: 'test-version',
      ...overrides,
    }) as BonusConfig;

  const calculator = new RewardCalculatorService();

  it('splits profit 100 into 50/25/5/10/2/2/6 VIP pools', () => {
    const result = calculator.calculateVip(
      [{ unitPrice: 120, cost: 20, quantity: 1, companyId: 'company-1' }],
      makeConfig({
        vipRewardPercent: 0.25,
        vipDirectReferralPercent: 0.05,
      }),
    );

    expect(result.rewardPool).toBe(25);
    expect(result.directReferralPool).toBe(5);
    expect(result.reserveFund).toBe(6);
  });

  it('keeps rounded VIP pools within 0.01 of profit', () => {
    const result = calculator.calculateVip(
      [{ unitPrice: 10.01, cost: 0, quantity: 1, companyId: 'company-1' }],
      makeConfig({
        vipRewardPercent: 0.25,
        vipDirectReferralPercent: 0.05,
      }),
    );

    const total =
      result.platformProfit +
      result.rewardPool +
      result.directReferralPool +
      result.industryFund +
      result.charityFund +
      result.techFund +
      result.reserveFund;

    const centDiff = Math.round(Math.abs(total - result.profit) * 100) / 100;
    expect(centDiff).toBeLessThanOrEqual(0.01);
  });

  it('preserves six-way VIP outputs when direct referral percent is 0', () => {
    const result = calculator.calculateVip(
      [{ unitPrice: 120, cost: 20, quantity: 1, companyId: 'company-1' }],
      makeConfig(),
    );

    expect(result.platformProfit).toBe(50);
    expect(result.rewardPool).toBe(30);
    expect(result.directReferralPool).toBe(0);
    expect(result.industryFund).toBe(10);
    expect(result.charityFund).toBe(2);
    expect(result.techFund).toBe(2);
    expect(result.reserveFund).toBe(6);
  });

  it('splits profit 100 into 49/16/1/16/8/8/2 normal pools', () => {
    const result = calculator.calculateNormal(
      [{ unitPrice: 120, cost: 20, quantity: 1, companyId: 'company-1' }],
      makeConfig(),
    );

    expect(result.platformProfit).toBe(49);
    expect(result.rewardPool).toBe(16);
    expect((result as any).directReferralPool).toBe(1);
    expect(result.industryFund).toBe(16);
    expect(result.charityFund).toBe(8);
    expect(result.techFund).toBe(8);
    expect(result.reserveFund).toBe(2);
  });
});

describe('RewardCalculatorService.calculateFromProfit', () => {
  const calculator = new RewardCalculatorService();
  const rates = {
    vip: {
      platform: 0.4,
      reward: 0.2,
      directReferral: 0.05,
      industryFund: 0.1,
      charity: 0.1,
      tech: 0.05,
      reserve: 0.1,
    },
    normal: {
      platform: 0.35,
      reward: 0.2,
      directReferral: 0.01,
      industryFund: 0.15,
      charity: 0.1,
      tech: 0.1,
      reserve: 0.09,
    },
  };

  it('uses D as the only base and rounds a 15% direct share of 13.25 to 1.99', () => {
    const result = calculator.calculateFromProfit(
      13.25,
      'NORMAL',
      rates,
      0.15,
      { 'company-1': 1 },
      true,
      'snapshot-v3',
    );

    expect(result.profit).toBe(13.25);
    expect(result.directReferralPool).toBe(1.99);
    expect(result.rewardPool).toBe(2.65);
    expect(result.industryFund).toBe(1.99);
  });

  it.each([
    ['NORMAL', 0.15, 2.65, 1.99],
    ['VIP', 0.01, 2.65, 1.33],
  ] as const)(
    'uses %s buyer rates while keeping the inviter direct rate independent',
    (buyerPath, directRate, expectedReward, expectedIndustry) => {
      const result = calculator.calculateFromProfit(
        13.25,
        buyerPath,
        rates,
        directRate,
        {},
        true,
        'snapshot-v3',
      );

      expect(result.rewardPool).toBe(expectedReward);
      expect(result.industryFund).toBe(expectedIndustry);
      expect(result.directReferralPool).toBe(Math.round(13.25 * directRate * 100) / 100);
    },
  );

  it('conserves integer cents exactly and lets the explicit platform bucket absorb rounding', () => {
    const result = calculator.calculateFromProfit(
      13.25,
      'NORMAL',
      rates,
      0.15,
      {},
      true,
      'snapshot-v3',
    );
    const total = [
      result.platformProfit,
      result.rewardPool,
      result.directReferralPool,
      result.industryFund,
      result.charityFund,
      result.techFund,
      result.reserveFund,
    ].reduce((sum, amount) => sum + Math.round(amount * 100), 0);

    expect(total).toBe(1325);
    expect(result.platformRetained).toBe(
      Math.round((result.platformProfit + result.charityFund + result.techFund + result.reserveFund) * 100) / 100,
    );
  });

  it('counts an unclaimed direct share as platform retained without changing D', () => {
    const claimed = calculator.calculateFromProfit(13.25, 'NORMAL', rates, 0.15, {}, true, 'snapshot-v3');
    const unclaimed = calculator.calculateFromProfit(13.25, 'NORMAL', rates, 0.15, {}, false, 'snapshot-v3');

    expect(Math.round((unclaimed.platformRetained - claimed.platformRetained) * 100)).toBe(199);
    expect(Math.round((unclaimed.externalNet + unclaimed.platformRetained) * 100)).toBe(1325);
  });

  it('uses largest remainders so a one-cent profit can never be over-allocated', () => {
    const tinyRates = {
      vip: {
        platform: 0,
        reward: 0.5,
        directReferral: 0.5,
        industryFund: 0,
        charity: 0,
        tech: 0,
        reserve: 0,
      },
      normal: {
        platform: 0,
        reward: 0.5,
        directReferral: 0.5,
        industryFund: 0,
        charity: 0,
        tech: 0,
        reserve: 0,
      },
    };

    const result = calculator.calculateFromProfit(
      0.01,
      'NORMAL',
      tinyRates,
      0.5,
      {},
      true,
      'snapshot-v3',
    );
    const allocatedCents = [
      result.platformProfit,
      result.rewardPool,
      result.directReferralPool,
      result.industryFund,
      result.charityFund,
      result.techFund,
      result.reserveFund,
    ].reduce((total, amount) => total + Math.round(amount * 100), 0);

    expect(allocatedCents).toBe(1);
    expect(Math.round((result.externalNet + result.platformRetained) * 100)).toBe(1);
  });
});
