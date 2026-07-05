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
