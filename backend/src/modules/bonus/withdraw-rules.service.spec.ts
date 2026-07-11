import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfitSafetyService } from '../profit/profit-safety.service';
import { WithdrawRulesService } from './withdraw-rules.service';

describe('WithdrawRulesService', () => {
  let service: WithdrawRulesService;
  let prisma: any;
  let profitSafetyService: any;

  beforeEach(async () => {
    prisma = {
      ruleConfig: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    profitSafetyService = {
      withRuleConfigUpdates: jest.fn(async (_updates: Record<string, unknown>, write: any) => ({
        result: await write(prisma),
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WithdrawRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProfitSafetyService, useValue: profitSafetyService },
      ],
    }).compile();

    service = moduleRef.get(WithdrawRulesService);
  });

  it('returns dual-track defaults when RuleConfig rows are absent', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([]);

    await expect(service.getRules()).resolves.toMatchObject({
      withdrawTaxRate: 0.2,
      withdrawMinAmount: 10,
      withdrawMaxAmount: 10000,
      withdrawDailyMaxCount: 3,
      withdrawCooldownSeconds: 60,
      withdrawYearlyMaxAmount: 50000,
      deductionRatioNormal: 0.1,
      deductionRatioVip: 0.15,
      deductionMinOrderAmount: 0,
      deductionAllowCouponStack: true,
      withdrawProviderFeeAmount: 0,
      withdrawYearlyAlertThreshold: 0.8,
    });
  });

  it('overrides defaults from stored RuleConfig envelopes', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([
      { key: 'WITHDRAW_TAX_RATE', value: { value: 0.18, description: 'custom' } },
      { key: 'DEDUCTION_ALLOW_COUPON_STACK', value: { value: false } },
      { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.2 } },
    ]);

    const rules = await service.getRules();

    expect(rules.withdrawTaxRate).toBe(0.18);
    expect(rules.deductionAllowCouponStack).toBe(false);
    expect(rules.deductionRatioVip).toBe(0.2);
    expect(rules.withdrawMinAmount).toBe(10);
  });

  it('persists partial updates with descriptions preserved in the JSON value', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([]);
    prisma.ruleConfig.upsert.mockResolvedValue(undefined);

    await service.updateRules({ withdrawTaxRate: 0.16, deductionAllowCouponStack: false });

    expect(profitSafetyService.withRuleConfigUpdates).toHaveBeenCalledWith(
      { WITHDRAW_TAX_RATE: 0.16, DEDUCTION_ALLOW_COUPON_STACK: false },
      expect.any(Function),
      { changeNote: '更新提现规则' },
    );
    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'WITHDRAW_TAX_RATE' },
      create: expect.objectContaining({
        key: 'WITHDRAW_TAX_RATE',
        value: expect.objectContaining({ value: 0.16, description: expect.any(String) }),
      }),
      update: expect.objectContaining({
        value: expect.objectContaining({ value: 0.16, description: expect.any(String) }),
      }),
    }));
    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'DEDUCTION_ALLOW_COUPON_STACK' },
      update: expect.objectContaining({
        value: expect.objectContaining({ value: false }),
      }),
    }));
  });

  it('rejects invalid rule combinations before persisting', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([]);

    await expect(service.updateRules({
      withdrawMinAmount: 100,
      withdrawMaxAmount: 50,
    })).rejects.toThrow(BadRequestException);

    await expect(service.updateRules({
      withdrawProviderFeeAmount: 10,
    })).rejects.toThrow(BadRequestException);

    await expect(service.updateRules({
      deductionRatioNormal: 1.1,
    })).rejects.toThrow(BadRequestException);

    expect(prisma.ruleConfig.upsert).not.toHaveBeenCalled();
  });
});
