import { BadRequestException } from '@nestjs/common';
import {
  PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS,
} from '../../profit/profit-safety.service';
import { ProfitSafetyViolationError } from '../../profit/profit-safety-validator';
import { AdminConfigService } from './admin-config.service';

const fourScenarioSummary: any = {
  safe: true,
  scenarios: [
    { key: 'VIP_BUYER_VIP_INVITER' },
    { key: 'VIP_BUYER_NORMAL_INVITER' },
    { key: 'NORMAL_BUYER_VIP_INVITER' },
    { key: 'NORMAL_BUYER_NORMAL_INVITER' },
  ],
  limitingSkus: [],
  shortfall: 0,
  evaluatedSkuCount: 1,
  platformRequiredRevenueRate: 0.1,
  captainMaximumProfitRate: 0.1,
  captainConfiguredCap: 0.1,
  errors: [],
};

function completeSnapshot() {
  return Object.fromEntries(PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => [
    key,
    key === 'CAPTAIN_SEAFOOD_CONFIG'
      ? { schemaVersion: 3, enabled: false }
      : key === 'VIP_REWARD_PERCENT'
        ? 0.3
        : `value:${key}`,
  ]));
}

function createHarness() {
  const tx: any = {
    ruleConfig: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma: any = {
    ruleConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    ruleVersion: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
    },
  };
  const bonusConfig: any = {
    validateSnapshotRatios: jest.fn(),
    invalidateCache: jest.fn(),
  };
  const resolvedChanges: any[] = [];
  const profitSafety: any = {
    resolvedChanges,
    withCandidateChange: jest.fn(async (change: any, write: any) => {
      const resolvedChange = typeof change === 'function' ? await change(tx) : change;
      resolvedChanges.push(resolvedChange);
      return {
      result: await write(tx, {
        candidateSnapshot: completeSnapshot(),
        candidateSkus: [],
        summary: fourScenarioSummary,
      }),
      candidateSnapshot: completeSnapshot(),
      candidateSkus: [],
      summary: fourScenarioSummary,
      ruleVersion: { id: 'rv-1', version: 'profit-safety-v1' },
    };
    }),
    preview: jest.fn().mockResolvedValue(fourScenarioSummary),
    previewContext: jest.fn().mockResolvedValue({
      candidateSnapshot: completeSnapshot(),
      candidateSkus: [],
      summary: fourScenarioSummary,
    }),
    getCurrentSummary: jest.fn().mockResolvedValue(fourScenarioSummary),
  };
  const productPricing: any = {
    buildMarkupRepricePlan: jest.fn(),
    assertMarkupRepriceConfirmed: jest.fn(),
    applyMarkupReprice: jest.fn(),
    previewMarkupReprice: jest.fn(),
    previewMarkupRepricePlan: jest.fn().mockResolvedValue({ profitSafetySkus: [] }),
  };
  return {
    tx,
    prisma,
    bonusConfig,
    profitSafety,
    productPricing,
    service: new AdminConfigService(prisma, bonusConfig, profitSafety, productPricing),
  };
}

describe('AdminConfigService profit safety coordination', () => {
  it('writes one safe update through the coordinator and invalidates cache after commit', async () => {
    const { service, tx, profitSafety, bonusConfig } = createHarness();

    const result = await service.update('VIP_REWARD_PERCENT', {
      value: { value: 0.3, description: 'VIP奖励' },
      changeNote: '调整奖励',
    }, 'admin-1');

    expect(profitSafety.resolvedChanges[0]).toEqual(expect.objectContaining({
      ruleUpdates: { VIP_REWARD_PERCENT: 0.3 },
      createdByAdminId: 'admin-1',
      changeNote: '调整奖励',
    }));
    expect(tx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'VIP_REWARD_PERCENT' },
      update: { value: { value: 0.3, description: 'VIP奖励' } },
      create: { key: 'VIP_REWARD_PERCENT', value: { value: 0.3, description: 'VIP奖励' } },
    });
    expect(bonusConfig.validateSnapshotRatios).toHaveBeenCalledWith(completeSnapshot());
    expect(bonusConfig.invalidateCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, version: 'profit-safety-v1' });
  });

  it('maps an unsafe candidate to a stable HTTP 400 and performs no write or cache invalidation', async () => {
    const { service, tx, profitSafety, bonusConfig } = createHarness();
    profitSafety.withCandidateChange.mockRejectedValueOnce(new ProfitSafetyViolationError({
      ...fourScenarioSummary,
      safe: false,
      shortfall: 0.02,
    }));

    await expect(service.update('VIP_REWARD_PERCENT', { value: 0.9 }, 'admin-1'))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CAPTAIN_PROFIT_SAFETY_VIOLATION',
          shortfall: 0.02,
        }),
      });
    expect(tx.ruleConfig.upsert).not.toHaveBeenCalled();
    expect(bonusConfig.invalidateCache).not.toHaveBeenCalled();
  });

  it('validates and writes a batch as one candidate and one complete version', async () => {
    const { service, tx, profitSafety, bonusConfig } = createHarness();

    const result = await service.batchUpdate({
      updates: [
        { key: 'VIP_PLATFORM_PERCENT', value: { value: 0.49 } },
        { key: 'VIP_REWARD_PERCENT', value: { value: 0.31 } },
      ],
      changeNote: '联动调整',
    }, 'admin-1');

    expect(profitSafety.resolvedChanges[0]).toEqual(expect.objectContaining({
      ruleUpdates: { VIP_PLATFORM_PERCENT: 0.49, VIP_REWARD_PERCENT: 0.31 },
    }));
    expect(tx.ruleConfig.upsert).toHaveBeenCalledTimes(2);
    expect(bonusConfig.validateSnapshotRatios).toHaveBeenCalledTimes(1);
    expect(bonusConfig.invalidateCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, version: 'profit-safety-v1', updated: 2 });
  });

  it('requires a matching preview and reprices seller SKUs in the same markup update', async () => {
    const { service, tx, productPricing, profitSafety } = createHarness();
    const preview = {
      currentMarkupRate: 1.3,
      nextMarkupRate: 1.35,
      affectedSkuCount: 2,
      previewToken: 'token-1',
    };
    const plan = { preview, items: [], profitSafetySkus: [{ id: 'sku-1' }] };
    productPricing.buildMarkupRepricePlan.mockResolvedValue(plan);
    productPricing.applyMarkupReprice.mockResolvedValue(preview);

    const result = await service.update('MARKUP_RATE', {
      value: { value: 1.35, description: '加价率' },
      repriceExisting: true,
      markupPreviewToken: 'token-1',
    }, 'admin-1');

    expect(productPricing.assertMarkupRepriceConfirmed).toHaveBeenCalledWith(
      plan,
      true,
      'token-1',
    );
    expect(profitSafety.resolvedChanges[0]).toEqual(expect.objectContaining({
      ruleUpdates: { MARKUP_RATE: 1.35 },
      skuUpserts: plan.profitSafetySkus,
    }));
    expect(tx.ruleConfig.upsert).toHaveBeenCalledTimes(1);
    expect(productPricing.applyMarkupReprice).toHaveBeenCalledWith(tx, plan);
    expect(result).toMatchObject({ ok: true, markupReprice: preview });
  });

  it('delegates markup impact preview without writing configuration', async () => {
    const { service, productPricing, profitSafety } = createHarness();
    productPricing.previewMarkupReprice.mockResolvedValue({ affectedSkuCount: 3 });

    await expect(service.previewMarkupReprice(1.35)).resolves.toEqual({ affectedSkuCount: 3 });

    expect(productPricing.previewMarkupReprice).toHaveBeenCalledWith(1.35);
    expect(profitSafety.withCandidateChange).not.toHaveBeenCalled();
  });

  it('rejects a reward release window shorter than the quality after-sale window', async () => {
    const { service, tx, profitSafety } = createHarness();
    profitSafety.withCandidateChange.mockImplementationOnce(
      async (_change: any, write: any) =>
        write(tx, {
          candidateSnapshot: {
            ...completeSnapshot(),
            RETURN_WINDOW_DAYS: 7,
            NORMAL_RETURN_DAYS: 15,
          },
          candidateSkus: [],
          summary: fourScenarioSummary,
        }),
    );

    await expect(
      service.batchUpdate(
        {
          updates: [
            { key: 'RETURN_WINDOW_DAYS', value: 7 },
            { key: 'NORMAL_RETURN_DAYS', value: 15 },
          ],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AFTER_SALE_WINDOW_COVERAGE_INVALID',
      }),
    });
    expect(tx.ruleConfig.upsert).not.toHaveBeenCalled();
  });

  it('rejects incomplete versions before attempting a rollback', async () => {
    const { service, prisma, profitSafety, tx } = createHarness();
    prisma.ruleVersion.findUnique.mockResolvedValue({
      id: 'old',
      version: 'old',
      isComplete: false,
      snapshot: { VIP_REWARD_PERCENT: 0.3 },
    });

    await expect(service.rollbackToVersion('old', 'admin-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(profitSafety.withCandidateChange).not.toHaveBeenCalled();
    expect(tx.ruleConfig.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces the entire persisted configuration for an eligible full rollback', async () => {
    const { service, prisma, tx, profitSafety, bonusConfig } = createHarness();
    const snapshot = completeSnapshot();
    prisma.ruleVersion.findUnique.mockResolvedValue({
      id: 'safe-version',
      version: 'safe-v1',
      isComplete: true,
      snapshot,
      safetySummary: fourScenarioSummary,
    });

    const result = await service.rollbackToVersion('safe-version', 'admin-1');

    expect(profitSafety.resolvedChanges[0]).toEqual(expect.objectContaining({
      replaceRuleSnapshot: snapshot,
      createdByAdminId: 'admin-1',
    }));
    expect(tx.ruleConfig.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.ruleConfig.create).toHaveBeenCalledTimes(snapshot ? Object.keys(snapshot).length : 0);
    expect(bonusConfig.invalidateCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, version: 'profit-safety-v1' });
  });

  it('reprices products when a version rollback restores a different markup rate', async () => {
    const { service, prisma, productPricing } = createHarness();
    const snapshot = { ...completeSnapshot(), MARKUP_RATE: 1.2 };
    prisma.ruleVersion.findUnique.mockResolvedValue({
      id: 'safe-version',
      version: 'safe-v1',
      isComplete: true,
      snapshot,
    });
    const preview = {
      currentMarkupRate: 1.3,
      nextMarkupRate: 1.2,
      affectedSkuCount: 1,
      previewToken: 'rollback-token',
    };
    const plan = { preview, items: [], profitSafetySkus: [{ id: 'sku-1' }] };
    productPricing.buildMarkupRepricePlan.mockResolvedValue(plan);
    productPricing.applyMarkupReprice.mockResolvedValue(preview);

    const result = await service.rollbackToVersion('safe-version', 'admin-1', {
      repriceExisting: true,
      markupPreviewToken: 'rollback-token',
    });

    expect(productPricing.assertMarkupRepriceConfirmed).toHaveBeenCalledWith(
      plan,
      true,
      'rollback-token',
    );
    expect(productPricing.previewMarkupRepricePlan).toHaveBeenCalledWith(1.2);
    expect(productPricing.applyMarkupReprice).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, markupReprice: preview });
  });

  it('returns four-scenario current and preview safety summaries with final snapshot validation', async () => {
    const { service, profitSafety, bonusConfig } = createHarness();

    await expect(service.getProfitSafetySummary()).resolves.toEqual(fourScenarioSummary);
    await expect(service.previewProfitSafety({
      updates: [{ key: 'VIP_REWARD_PERCENT', value: { value: 0.31 } }],
    })).resolves.toEqual(fourScenarioSummary);
    expect(profitSafety.previewContext).toHaveBeenCalledWith({
      ruleUpdates: { VIP_REWARD_PERCENT: 0.31 },
    });
    expect(bonusConfig.validateSnapshotRatios).toHaveBeenCalledWith(
      completeSnapshot(),
    );
  });

  it('derives rollback eligibility and stored safety fields for version history', async () => {
    const { service, prisma } = createHarness();
    prisma.ruleVersion.findMany.mockResolvedValue([
      { id: 'complete', isComplete: true, snapshot: completeSnapshot(), safetySummary: fourScenarioSummary },
      { id: 'partial', isComplete: false, snapshot: {}, safetySummary: null },
    ]);
    prisma.ruleVersion.count.mockResolvedValue(2);

    const result = await service.findVersions();

    expect(result.items[0]).toMatchObject({
      rollbackAllowed: true,
      rollbackBlockedReason: null,
      safetySummary: fourScenarioSummary,
      isComplete: true,
    });
    expect(result.items[1]).toMatchObject({
      rollbackAllowed: false,
      rollbackBlockedReason: expect.stringContaining('不完整'),
    });
  });

  it('marks a complete version non-rollbackable when its ratio totals are invalid', async () => {
    const { service, prisma, bonusConfig } = createHarness();
    prisma.ruleVersion.findMany.mockResolvedValue([
      { id: 'bad-ratios', isComplete: true, snapshot: completeSnapshot() },
    ]);
    prisma.ruleVersion.count.mockResolvedValue(1);
    bonusConfig.validateSnapshotRatios.mockImplementation(() => {
      throw new BadRequestException('比例总和不是 1');
    });

    const result = await service.findVersions();

    expect(result.items[0]).toMatchObject({
      rollbackAllowed: false,
      rollbackBlockedReason: expect.stringContaining('比例'),
    });
  });
});
