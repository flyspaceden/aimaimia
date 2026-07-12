import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../captain/captain.constants';
import {
  PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS,
  ProfitSafetyService,
} from './profit-safety.service';
import {
  ProfitSafetyValidator,
  ProfitSafetyViolationError,
} from './profit-safety-validator';

function safeCaptainConfig() {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    scope: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
      productIds: ['product-1'],
    },
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
  const safetyValues = new Map<string, unknown>([
    ['MARKUP_RATE', 1.35],
    ['VIP_DISCOUNT_RATE', 0.95],
    ['VIP_REWARD_PERCENT', 0.2],
    ['VIP_DIRECT_REFERRAL_PERCENT', 0.05],
    ['VIP_INDUSTRY_FUND_PERCENT', 0.1],
    ['NORMAL_REWARD_PERCENT', 0.2],
    ['NORMAL_DIRECT_REFERRAL_PERCENT', 0.05],
    ['NORMAL_INDUSTRY_FUND_PERCENT', 0.1],
    ['CAPTAIN_SEAFOOD_CONFIG', safeCaptainConfig()],
  ]);
  const rows: Array<{ key: string; value: { value: unknown } }> =
    PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => ({
      key,
      value: { value: safetyValues.has(key) ? safetyValues.get(key) : `snapshot:${key}` },
    }));
  rows.push({ key: 'FUTURE_EXTENSION_CONFIG', value: { value: { enabled: true } } });
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
  const historicallyMissingRequiredKeys = [
    'VIP_DISCOUNT_RATE',
    'VIP_REWARD_EXPIRY_DAYS',
    'NORMAL_REWARD_EXPIRY_DAYS',
    'VIP_FREE_SHIPPING_THRESHOLD',
    'NORMAL_FREE_SHIPPING_THRESHOLD',
    'LOW_STOCK_DISPLAY_THRESHOLD',
    'RETURN_SHIPPING_FEE_DEFAULT',
    'DIGITAL_ASSET_MODULE_SETTINGS',
    'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
  ];

  it('catalogs non-profit RuleConfig keys persisted by independent system modules', () => {
    expect(PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS).toEqual(expect.arrayContaining([
      'DIGITAL_ASSET_MODULE_SETTINGS',
      'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
      'LOW_STOCK_DISPLAY_THRESHOLD',
      'RETURN_SHIPPING_FEE_DEFAULT',
      'VIP_FREE_SHIPPING_THRESHOLD',
      'NORMAL_FREE_SHIPPING_THRESHOLD',
      'VIP_REWARD_EXPIRY_DAYS',
      'NORMAL_REWARD_EXPIRY_DAYS',
    ]));
  });

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
          WITHDRAW_TAX_RATE: 'snapshot:WITHDRAW_TAX_RATE',
          FUTURE_EXTENSION_CONFIG: { enabled: true },
          CAPTAIN_SEAFOOD_CONFIG: expect.objectContaining({ schemaVersion: 3 }),
        }),
        safetySummary: expect.objectContaining({ safe: true }),
      }),
    });
    expect(output.summary.ruleConfigCompleteness).toEqual(expect.objectContaining({
      complete: true,
      missingKeys: [],
      requiredKeys: expect.arrayContaining([
        'WITHDRAW_TAX_RATE',
        'DIGITAL_ASSET_MODULE_SETTINGS',
        'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
        'LOW_STOCK_DISPLAY_THRESHOLD',
      ]),
      presentKeys: expect.arrayContaining([
        'FUTURE_EXTENSION_CONFIG',
        'WITHDRAW_TAX_RATE',
      ]),
    }));
  });

  it('wraps RuleConfig updates in the same validated safety transaction and complete version', async () => {
    const { service, tx, events } = makeHarness();
    const write = jest.fn(async () => {
      events.push('write');
      return { saved: true };
    });

    const output = await service.withRuleConfigUpdates({
      INVOICE_AUTO_ISSUE: false,
    }, write, {
      changeNote: '关闭自动开票',
    });

    expect(output.result).toEqual({ saved: true });
    expect(events).toEqual(['lock', 'rules', 'skus', 'write', 'version']);
    expect(write).toHaveBeenCalledWith(tx, expect.objectContaining({
      candidateSnapshot: expect.objectContaining({ INVOICE_AUTO_ISSUE: false }),
      summary: expect.objectContaining({ safe: true }),
    }));
    expect(tx.ruleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isComplete: true,
        changeNote: '关闭自动开票',
        snapshot: expect.objectContaining({ INVOICE_AUTO_ISSUE: false }),
      }),
    });
  });

  it('resolves a candidate factory after taking the safety lock and validates that exact change', async () => {
    const { service, tx, events } = makeHarness();
    const changeFactory = jest.fn(async (factoryTx: typeof tx) => {
      expect(factoryTx).toBe(tx);
      events.push('factory');
      return { ruleUpdates: { NORMAL_REWARD_PERCENT: 0.21 } };
    });
    const write = jest.fn(async () => {
      events.push('write');
      return { saved: true };
    });

    const output = await service.withCandidateChange(changeFactory, write);

    expect(changeFactory).toHaveBeenCalledTimes(1);
    expect(output.candidateSnapshot.NORMAL_REWARD_PERCENT).toBe(0.21);
    expect(events).toEqual(['lock', 'factory', 'rules', 'skus', 'write', 'version']);
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

  it.each([null, 'bad-config', [], 3])(
    'fails closed when captain configuration is a malformed non-object: %p',
    async (captainConfig) => {
      const { service, tx } = makeHarness();
      tx.ruleConfig.findMany.mockImplementation(async () => (
        PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => ({
          key,
          value: {
            value: key === 'CAPTAIN_SEAFOOD_CONFIG'
              ? captainConfig
              : key === 'MARKUP_RATE'
                ? 1.35
                : key === 'VIP_DISCOUNT_RATE'
                  ? 0.95
                  : key.includes('REWARD_PERCENT')
                    ? 0.2
                    : key.includes('DIRECT_REFERRAL_PERCENT')
                      ? 0.05
                      : key.includes('INDUSTRY_FUND_PERCENT')
                        ? 0.1
                        : `snapshot:${key}`,
          },
        }))
      ));
      const write = jest.fn();

      await expect(service.withCandidateChange({}, write))
        .rejects.toBeInstanceOf(ProfitSafetyViolationError);
      expect(write).not.toHaveBeenCalled();
      expect(tx.ruleVersion.create).not.toHaveBeenCalled();
    },
  );

  it('initializes every required safety key in both seed and upgrade migration', () => {
    const seed = readFileSync(resolve(__dirname, '../../../prisma/seed.ts'), 'utf8');
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../prisma/migrations/20260710050000_backfill_profit_safety_rule_configs/migration.sql',
      ),
      'utf8',
    );

    for (const key of historicallyMissingRequiredKeys) {
      expect(seed).toContain(`key: '${key}'`);
      expect(migration).toContain(`'${key}'`);
    }
  });

  it.each([
    'WITHDRAW_TAX_RATE',
    'DIGITAL_ASSET_MODULE_SETTINGS',
    'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
    'LOW_STOCK_DISPLAY_THRESHOLD',
  ])('keeps a finance-safe write available but marks the version incomplete when system RuleConfig %s is missing', async (missingKey) => {
    const { service, tx } = makeHarness();
    tx.ruleConfig.findMany.mockImplementation(async () => (
      PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS
        .filter((key) => key !== missingKey)
        .map((key) => ({
          key,
          value: {
            value: key === 'CAPTAIN_SEAFOOD_CONFIG'
              ? safeCaptainConfig()
              : key === 'MARKUP_RATE'
                ? 1.35
                : key === 'VIP_DISCOUNT_RATE'
                  ? 0.95
                  : key.includes('REWARD_PERCENT')
                    ? 0.2
                    : key.includes('DIRECT_REFERRAL_PERCENT')
                      ? 0.05
                      : key.includes('INDUSTRY_FUND_PERCENT')
                        ? 0.1
                        : `snapshot:${key}`,
          },
        }))
    ));
    const write = jest.fn();

    const output = await service.withCandidateChange({}, write);

    expect(output.summary.safe).toBe(true);
    expect(output.summary.profitSafetyConfigCompleteness).toMatchObject({ complete: true });
    expect(output.summary.ruleConfigCompleteness).toMatchObject({
      complete: false,
      missingKeys: [missingKey],
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(tx.ruleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isComplete: false }),
    });
  });

  it.each([
    'MARKUP_RATE',
    'VIP_DISCOUNT_RATE',
    'VIP_REWARD_PERCENT',
    'NORMAL_DIRECT_REFERRAL_PERCENT',
  ])('still blocks a write when profit safety input %s is missing', async (missingKey) => {
    const { service, tx } = makeHarness();
    tx.ruleConfig.findMany.mockImplementation(async () => (
      PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS
        .filter((key) => key !== missingKey)
        .map((key) => ({
          key,
          value: {
            value: key === 'CAPTAIN_SEAFOOD_CONFIG'
              ? safeCaptainConfig()
              : key === 'MARKUP_RATE'
                ? 1.35
                : key === 'VIP_DISCOUNT_RATE'
                  ? 0.95
                  : key.includes('REWARD_PERCENT')
                    ? 0.2
                    : key.includes('DIRECT_REFERRAL_PERCENT')
                      ? 0.05
                      : key.includes('INDUSTRY_FUND_PERCENT')
                        ? 0.1
                        : `snapshot:${key}`,
          },
        }))
    ));
    const write = jest.fn();

    await expect(service.withCandidateChange({}, write))
      .rejects.toBeInstanceOf(ProfitSafetyViolationError);
    expect(write).not.toHaveBeenCalled();
    expect(tx.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('uses the disabled default when a captain configuration has not been saved yet', async () => {
    const { service, tx } = makeHarness();
    tx.ruleConfig.findMany.mockImplementation(async () => (
      PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS
        .filter((key) => key !== 'CAPTAIN_SEAFOOD_CONFIG')
        .map((key) => ({
          key,
          value: {
            value: key === 'MARKUP_RATE'
              ? 1.35
              : key === 'VIP_DISCOUNT_RATE'
                ? 0.95
                : key.includes('REWARD_PERCENT')
                  ? 0.2
                  : key.includes('DIRECT_REFERRAL_PERCENT')
                    ? 0.05
                    : key.includes('INDUSTRY_FUND_PERCENT')
                      ? 0.1
                      : `snapshot:${key}`,
          },
        }))
    ));
    const write = jest.fn();

    const output = await service.withCandidateChange({}, write);

    expect(output.summary.safe).toBe(true);
    expect(output.summary.captainConfigState).toBe('DISABLED');
    expect(output.summary.captainMaximumProfitRate).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(tx.ruleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isComplete: false }),
    });
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

  it('replaces the complete rule snapshot for full-version rollback', async () => {
    const { service, tx } = makeHarness();
    const replacement = Object.fromEntries(
      PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => [
        key,
        key === 'CAPTAIN_SEAFOOD_CONFIG'
          ? safeCaptainConfig()
          : key === 'MARKUP_RATE'
            ? 1.35
            : key === 'VIP_DISCOUNT_RATE'
              ? 0.95
              : key.includes('REWARD_PERCENT')
                ? 0.2
                : key.includes('DIRECT_REFERRAL_PERCENT')
                  ? 0.05
                  : key.includes('INDUSTRY_FUND_PERCENT')
                    ? 0.1
                    : `replacement:${key}`,
      ]),
    );
    const write = jest.fn(async () => undefined);

    const output = await service.withCandidateChange({
      replaceRuleSnapshot: replacement,
    }, write);

    expect(output.candidateSnapshot).toEqual(replacement);
    expect(output.candidateSnapshot).not.toHaveProperty('FUTURE_EXTENSION_CONFIG');
    expect(tx.ruleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshot: replacement }),
    });
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

  it('excludes platform-company SKUs from ordinary-goods safety validation', async () => {
    const { service, tx } = makeHarness();
    tx.productSKU.findMany.mockResolvedValue([{
      id: 'platform-sku',
      price: 0,
      cost: 0,
      status: 'ACTIVE',
      vipGiftItems: [],
      product: {
        id: 'platform-product',
        companyId: 'PLATFORM_COMPANY',
        categoryId: null,
        status: 'ACTIVE',
        type: 'SIMPLE',
        company: { isPlatform: true },
        lotteryPrizes: [],
      },
    }]);

    const summary = await service.preview();

    expect(summary.safe).toBe(true);
    expect(summary.evaluatedSkuCount).toBe(0);
  });
});
