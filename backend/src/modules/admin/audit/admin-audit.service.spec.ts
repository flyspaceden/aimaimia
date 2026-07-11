import { AdminAuditService } from './admin-audit.service';

function reversibleLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    adminUserId: 'admin-original',
    action: 'CONFIG_CHANGE',
    module: 'config',
    targetType: 'RuleConfig',
    targetId: 'NORMAL_REWARD_PERCENT',
    before: {
      key: 'NORMAL_REWARD_PERCENT',
      value: { value: 0.2, description: '普通树奖励比例' },
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    after: {
      key: 'NORMAL_REWARD_PERCENT',
      value: { value: 0.25, description: '普通树奖励比例' },
      updatedAt: '2026-07-10T01:00:00.000Z',
    },
    isReversible: true,
    rolledBackAt: null,
    ...overrides,
  };
}

function createHarness(log = reversibleLog()) {
  const safetyTx: any = {
    ruleConfig: { update: jest.fn() },
    adminAuditLog: {
      update: jest.fn(),
      create: jest.fn(),
    },
    ruleVersion: { create: jest.fn() },
  };
  const regularTx: any = {
    product: { update: jest.fn() },
    adminAuditLog: {
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma: any = {
    adminAuditLog: {
      findUnique: jest.fn().mockResolvedValue(log),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(async (write: any) => write(regularTx)),
  };
  const profitSafetyService = {
    withCandidateChange: jest.fn(async (_change: any, write: any) => ({
      result: await write(safetyTx),
      ruleVersion: { id: 'version-1', isComplete: true },
    })),
  };

  return {
    prisma,
    profitSafetyService,
    regularTx,
    safetyTx,
    service: new (AdminAuditService as any)(prisma, profitSafetyService as any),
  };
}

describe('AdminAuditService rollback safety', () => {
  it('merges only the historical RuleConfig value and writes rollback audit state inside the safety transaction', async () => {
    const { service, prisma, profitSafetyService, safetyTx } = createHarness();

    await expect(service.rollback('log-1', 'admin-rollback', '127.0.0.1'))
      .resolves.toEqual({ ok: true, message: '回滚成功' });

    expect(profitSafetyService.withCandidateChange).toHaveBeenCalledWith({
      ruleUpdates: { NORMAL_REWARD_PERCENT: 0.2 },
      createdByAdminId: 'admin-rollback',
      changeNote: '审计回滚配置项 NORMAL_REWARD_PERCENT',
    }, expect.any(Function));
    expect(safetyTx.ruleConfig.update).toHaveBeenCalledWith({
      where: { key: 'NORMAL_REWARD_PERCENT' },
      data: { value: { value: 0.2, description: '普通树奖励比例' } },
    });
    expect(safetyTx.adminAuditLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: {
        rolledBackAt: expect.any(Date),
        rolledBackByAdminId: 'admin-rollback',
      },
    });
    expect(safetyTx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminUserId: 'admin-rollback',
        action: 'ROLLBACK',
        targetType: 'RuleConfig',
        targetId: 'NORMAL_REWARD_PERCENT',
        rollbackOfLogId: 'log-1',
      }),
    });
    expect(safetyTx.ruleVersion.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('performs no RuleConfig or audit writes when the merged rollback candidate is unsafe', async () => {
    const { service, profitSafetyService, safetyTx } = createHarness();
    profitSafetyService.withCandidateChange.mockRejectedValueOnce(new Error('unsafe'));

    await expect(service.rollback('log-1', 'admin-rollback')).rejects.toThrow('unsafe');

    expect(safetyTx.ruleConfig.update).not.toHaveBeenCalled();
    expect(safetyTx.adminAuditLog.update).not.toHaveBeenCalled();
    expect(safetyTx.adminAuditLog.create).not.toHaveBeenCalled();
    expect(safetyTx.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('preserves the existing transaction path for non-RuleConfig rollback', async () => {
    const productLog = reversibleLog({
      targetType: 'Product',
      targetId: 'product-1',
      before: { id: 'product-1', name: '历史商品名', createdAt: 'old-date' },
      after: { id: 'product-1', name: '当前商品名', createdAt: 'old-date' },
    });
    const { service, prisma, profitSafetyService, regularTx } = createHarness(productLog);

    await service.rollback('log-1', 'admin-rollback');

    expect(profitSafetyService.withCandidateChange).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(regularTx.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { name: '历史商品名' },
    });
    expect(regularTx.adminAuditLog.update).toHaveBeenCalled();
    expect(regularTx.adminAuditLog.create).toHaveBeenCalled();
  });
});
