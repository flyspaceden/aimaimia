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
  const profitSafety: any = {
    withCandidateChange: jest.fn(async (_change: any, write: any) => ({
      result: await write(tx, {
        candidateSnapshot: completeSnapshot(),
        candidateSkus: [],
        summary: fourScenarioSummary,
      }),
      candidateSnapshot: completeSnapshot(),
      candidateSkus: [],
      summary: fourScenarioSummary,
      ruleVersion: { id: 'rv-1', version: 'profit-safety-v1' },
    })),
    preview: jest.fn().mockResolvedValue(fourScenarioSummary),
    getCurrentSummary: jest.fn().mockResolvedValue(fourScenarioSummary),
  };
  return {
    tx,
    prisma,
    bonusConfig,
    profitSafety,
    service: new AdminConfigService(prisma, bonusConfig, profitSafety),
  };
}

describe('AdminConfigService profit safety coordination', () => {
  it('writes one safe update through the coordinator and invalidates cache after commit', async () => {
    const { service, tx, profitSafety, bonusConfig } = createHarness();

    const result = await service.update('VIP_REWARD_PERCENT', {
      value: { value: 0.3, description: 'VIP奖励' },
      changeNote: '调整奖励',
    }, 'admin-1');

    expect(profitSafety.withCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
      ruleUpdates: { VIP_REWARD_PERCENT: 0.3 },
      createdByAdminId: 'admin-1',
      changeNote: '调整奖励',
    }), expect.any(Function));
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

    expect(profitSafety.withCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
      ruleUpdates: { VIP_PLATFORM_PERCENT: 0.49, VIP_REWARD_PERCENT: 0.31 },
    }), expect.any(Function));
    expect(tx.ruleConfig.upsert).toHaveBeenCalledTimes(2);
    expect(bonusConfig.validateSnapshotRatios).toHaveBeenCalledTimes(1);
    expect(bonusConfig.invalidateCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, version: 'profit-safety-v1', updated: 2 });
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

    expect(profitSafety.withCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
      replaceRuleSnapshot: snapshot,
      createdByAdminId: 'admin-1',
    }), expect.any(Function));
    expect(tx.ruleConfig.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.ruleConfig.create).toHaveBeenCalledTimes(snapshot ? Object.keys(snapshot).length : 0);
    expect(bonusConfig.invalidateCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, version: 'profit-safety-v1' });
  });

  it('returns four-scenario current and preview safety summaries', async () => {
    const { service, profitSafety } = createHarness();

    await expect(service.getProfitSafetySummary()).resolves.toEqual(fourScenarioSummary);
    await expect(service.previewProfitSafety({
      updates: [{ key: 'VIP_REWARD_PERCENT', value: { value: 0.31 } }],
    })).resolves.toEqual(fourScenarioSummary);
    expect(profitSafety.preview).toHaveBeenCalledWith({
      ruleUpdates: { VIP_REWARD_PERCENT: 0.31 },
    });
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
