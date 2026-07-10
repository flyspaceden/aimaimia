import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../captain/captain.constants';
import { ProfitSafetyService } from './profit-safety.service';
import { ProfitSafetyValidator } from './profit-safety-validator';

function safeCaptainConfig() {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    perOrderCommission: { directProfitRate: 0.01 },
    monthlyRewards: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
      baseManagementProfitRate: 0.01,
      performanceBonusProfitRate: 0.01,
    },
    unitEconomics: { fulfillmentCostRate: 0.02 },
    caps: {
      maxTotalIncentiveProfitRate: 0.03,
      targetNetProfitRate: 0.03,
      coldChainRiskReserveRate: 0.01,
    },
  };
}

function makeHarness() {
  const events: string[] = [];
  const rows = [
    ['MARKUP_RATE', 1.35],
    ['VIP_DISCOUNT_RATE', 0.95],
    ['VIP_REWARD_PERCENT', 0.2],
    ['VIP_DIRECT_REFERRAL_PERCENT', 0.05],
    ['VIP_INDUSTRY_FUND_PERCENT', 0.1],
    ['NORMAL_REWARD_PERCENT', 0.2],
    ['NORMAL_DIRECT_REFERRAL_PERCENT', 0.05],
    ['NORMAL_INDUSTRY_FUND_PERCENT', 0.1],
    ['CAPTAIN_SEAFOOD_CONFIG', safeCaptainConfig()],
  ].map(([key, value]) => ({ key, value: { value } }));
  const tx: any = {
    $executeRawUnsafe: jest.fn(async () => { events.push('lock'); }),
    ruleConfig: {
      findMany: jest.fn(async () => {
        events.push('rules');
        return rows;
      }),
    },
    productSKU: {
      findMany: jest.fn(async () => {
        events.push('skus');
        return [{
          id: 'sku-1',
          price: 200,
          cost: 100,
          status: 'ACTIVE',
          vipGiftItems: [],
          product: {
            id: 'product-1',
            companyId: 'company-1',
            categoryId: 'category-1',
            status: 'ACTIVE',
            type: 'SIMPLE',
            company: { isPlatform: false },
            lotteryPrizes: [],
          },
        }];
      }),
    },
    ruleVersion: {
      create: jest.fn(async ({ data }: any) => {
        events.push('version');
        return { id: 'version-1', ...data };
      }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any, options: any) => {
      expect(options.isolationLevel).toBe('Serializable');
      return callback(tx);
    }),
  };
  return {
    tx,
    prisma,
    events,
    service: new ProfitSafetyService(prisma, new ProfitSafetyValidator()),
  };
}

describe('ProfitSafetyService', () => {
  it('locks, reads a full candidate, validates, writes, then stores a complete version', async () => {
    const { service, tx, events } = makeHarness();
    const write = jest.fn(async () => {
      events.push('write');
      return { saved: true };
    });

    const output = await service.withCandidateChange({
      ruleUpdates: { NORMAL_REWARD_PERCENT: 0.21 },
      createdByAdminId: 'admin-1',
      changeNote: '调整普通树奖励',
    }, write);

    expect(output.result).toEqual({ saved: true });
    expect(output.summary.safe).toBe(true);
    expect(events).toEqual(['lock', 'rules', 'skus', 'write', 'version']);
    expect(write).toHaveBeenCalledWith(tx, expect.objectContaining({
      candidateSnapshot: expect.objectContaining({ NORMAL_REWARD_PERCENT: 0.21 }),
      summary: expect.objectContaining({ safe: true }),
    }));
    expect(tx.ruleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByAdminId: 'admin-1',
        changeNote: '调整普通树奖励',
        isComplete: true,
        snapshot: expect.objectContaining({
          MARKUP_RATE: 1.35,
          NORMAL_REWARD_PERCENT: 0.21,
          CAPTAIN_SEAFOOD_CONFIG: expect.objectContaining({ schemaVersion: 3 }),
        }),
        safetySummary: expect.objectContaining({ safe: true }),
      }),
    });
  });

  it('performs no write and creates no version when the merged candidate is unsafe', async () => {
    const { service, tx } = makeHarness();
    const write = jest.fn();

    await expect(service.withCandidateChange({
      ruleUpdates: {
        VIP_REWARD_PERCENT: 0.9,
        VIP_DIRECT_REFERRAL_PERCENT: 0.9,
      },
    }, write)).rejects.toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');

    expect(write).not.toHaveBeenCalled();
    expect(tx.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('merges a candidate SKU mutation before validation', async () => {
    const { service } = makeHarness();
    const write = jest.fn();

    await expect(service.withCandidateChange({
      skuUpserts: [{
        id: 'sku-1',
        productId: 'product-1',
        companyId: 'company-1',
        categoryId: 'category-1',
        price: 200,
        cost: 199,
        active: true,
        ordinary: true,
        vipDiscountEligible: true,
      }],
    }, write)).rejects.toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');

    expect(write).not.toHaveBeenCalled();
  });

  it('previews under the same lock without writing a version', async () => {
    const { service, tx, events } = makeHarness();

    const summary = await service.preview({
      ruleUpdates: { NORMAL_REWARD_PERCENT: 0.21 },
    });

    expect(summary.safe).toBe(true);
    expect(events).toEqual(['lock', 'rules', 'skus']);
    expect(tx.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('serializes concurrent candidates and lets the second read state after the first write', async () => {
    const { service, tx, prisma } = makeHarness();
    let persistedNormalRate = 0.2;
    tx.ruleConfig.findMany.mockImplementation(async () => [
      { key: 'MARKUP_RATE', value: { value: 1.35 } },
      { key: 'VIP_DISCOUNT_RATE', value: { value: 0.95 } },
      { key: 'VIP_REWARD_PERCENT', value: { value: 0.2 } },
      { key: 'VIP_DIRECT_REFERRAL_PERCENT', value: { value: 0.05 } },
      { key: 'VIP_INDUSTRY_FUND_PERCENT', value: { value: 0.1 } },
      { key: 'NORMAL_REWARD_PERCENT', value: { value: persistedNormalRate } },
      { key: 'NORMAL_DIRECT_REFERRAL_PERCENT', value: { value: 0.05 } },
      { key: 'NORMAL_INDUSTRY_FUND_PERCENT', value: { value: 0.1 } },
      { key: 'CAPTAIN_SEAFOOD_CONFIG', value: { value: safeCaptainConfig() } },
    ]);
    let tail = Promise.resolve();
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(tx);
      } finally {
        release();
      }
    });

    await Promise.all([
      service.withCandidateChange({ ruleUpdates: { NORMAL_REWARD_PERCENT: 0.21 } }, async () => {
        persistedNormalRate = 0.21;
      }),
      service.withCandidateChange({ ruleUpdates: { VIP_REWARD_PERCENT: 0.21 } }, async (_tx, ctx) => {
        expect(ctx.candidateSnapshot.NORMAL_REWARD_PERCENT).toBe(0.21);
      }),
    ]);
  });
});
