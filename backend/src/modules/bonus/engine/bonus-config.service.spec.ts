import { BadRequestException } from '@nestjs/common';
import { BonusConfigService } from './bonus-config.service';

describe('BonusConfigService VIP direct referral ratio config', () => {
  const makeService = (rows: Array<{ key: string; value: any }> = []) => {
    const prisma = {
      ruleConfig: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
      ruleVersion: {
        findFirst: jest.fn().mockResolvedValue({ version: 'test-version' }),
      },
    };

    return new BonusConfigService(prisma as any);
  };

  it('loads missing VIP_DIRECT_REFERRAL_PERCENT as 0', async () => {
    const service = makeService([
      { key: 'VIP_PLATFORM_PERCENT', value: { value: 0.5 } },
      { key: 'VIP_REWARD_PERCENT', value: { value: 0.3 } },
      { key: 'VIP_INDUSTRY_FUND_PERCENT', value: { value: 0.1 } },
      { key: 'VIP_CHARITY_PERCENT', value: { value: 0.02 } },
      { key: 'VIP_TECH_PERCENT', value: { value: 0.02 } },
      { key: 'VIP_RESERVE_PERCENT', value: { value: 0.06 } },
    ]);

    const config = await service.getConfig();
    const vipConfig = await service.getVipConfig();

    expect((config as any).vipDirectReferralPercent).toBe(0);
    expect((vipConfig as any).vipDirectReferralPercent).toBe(0);
  });

  it('accepts 50/30/0/10/2/2/6 VIP seven-way ratios', () => {
    const service = makeService();

    expect(() =>
      service.validateSnapshotRatios({
        VIP_PLATFORM_PERCENT: { value: 0.5 },
        VIP_REWARD_PERCENT: { value: 0.3 },
        VIP_DIRECT_REFERRAL_PERCENT: { value: 0 },
        VIP_INDUSTRY_FUND_PERCENT: { value: 0.1 },
        VIP_CHARITY_PERCENT: { value: 0.02 },
        VIP_TECH_PERCENT: { value: 0.02 },
        VIP_RESERVE_PERCENT: { value: 0.06 },
      }),
    ).not.toThrow();
  });

  it('accepts 50/25/5/10/2/2/6 VIP seven-way ratios', () => {
    const service = makeService();

    expect(() =>
      service.validateSnapshotRatios({
        VIP_PLATFORM_PERCENT: { value: 0.5 },
        VIP_REWARD_PERCENT: { value: 0.25 },
        VIP_DIRECT_REFERRAL_PERCENT: { value: 0.05 },
        VIP_INDUSTRY_FUND_PERCENT: { value: 0.1 },
        VIP_CHARITY_PERCENT: { value: 0.02 },
        VIP_TECH_PERCENT: { value: 0.02 },
        VIP_RESERVE_PERCENT: { value: 0.06 },
      }),
    ).not.toThrow();
  });

  it('accepts updating VIP_DIRECT_REFERRAL_PERCENT when the seven-way total remains 1', async () => {
    const service = makeService([
      { key: 'VIP_PLATFORM_PERCENT', value: { value: 0.5 } },
      { key: 'VIP_REWARD_PERCENT', value: { value: 0.25 } },
      { key: 'VIP_DIRECT_REFERRAL_PERCENT', value: { value: 0 } },
      { key: 'VIP_INDUSTRY_FUND_PERCENT', value: { value: 0.1 } },
      { key: 'VIP_CHARITY_PERCENT', value: { value: 0.02 } },
      { key: 'VIP_TECH_PERCENT', value: { value: 0.02 } },
      { key: 'VIP_RESERVE_PERCENT', value: { value: 0.06 } },
    ]);

    await expect(service.validateRatioUpdate('VIP_DIRECT_REFERRAL_PERCENT', 0.05)).resolves.toBeUndefined();
  });

  it('rejects VIP seven-way ratios whose total is not 1', () => {
    const service = makeService();

    expect(() =>
      service.validateSnapshotRatios({
        VIP_PLATFORM_PERCENT: { value: 0.5 },
        VIP_REWARD_PERCENT: { value: 0.25 },
        VIP_DIRECT_REFERRAL_PERCENT: { value: 0.04 },
        VIP_INDUSTRY_FUND_PERCENT: { value: 0.1 },
        VIP_CHARITY_PERCENT: { value: 0.02 },
        VIP_TECH_PERCENT: { value: 0.02 },
        VIP_RESERVE_PERCENT: { value: 0.06 },
      }),
    ).toThrow(BadRequestException);
  });

  it('loads normal direct referral and auto VIP defaults', async () => {
    const service = makeService([]);

    const config = await service.getConfig();

    expect((config as any).normalDirectReferralPercent).toBe(0.01);
    expect((config as any).autoVipBySpendEnabled).toBe(true);
    expect((config as any).autoVipCumulativeSpendThreshold).toBe(399);
  });

  it('validates normal seven-way ratio with direct referral percent', async () => {
    const prisma = {
      ruleConfig: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'NORMAL_PLATFORM_PERCENT', value: { value: 0.49 } },
          { key: 'NORMAL_REWARD_PERCENT', value: { value: 0.16 } },
          { key: 'NORMAL_DIRECT_REFERRAL_PERCENT', value: { value: 0.01 } },
          { key: 'NORMAL_INDUSTRY_FUND_PERCENT', value: { value: 0.16 } },
          { key: 'NORMAL_CHARITY_PERCENT', value: { value: 0.08 } },
          { key: 'NORMAL_TECH_PERCENT', value: { value: 0.08 } },
          { key: 'NORMAL_RESERVE_PERCENT', value: { value: 0.02 } },
        ]),
      },
      ruleVersion: {
        findFirst: jest.fn().mockResolvedValue({ version: 'test-version' }),
      },
    };
    const service = new BonusConfigService(prisma as any);

    await expect(service.validateRatioUpdate('NORMAL_DIRECT_REFERRAL_PERCENT', 0.01)).resolves.toBeUndefined();
    expect(prisma.ruleConfig.findMany).toHaveBeenCalledTimes(1);
  });
});
