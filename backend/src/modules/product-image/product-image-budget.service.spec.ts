import { ServiceUnavailableException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { ProductImageBudgetLedgerType } from '@prisma/client';
import { ProductImageBudgetService } from './product-image-budget.service';

describe('ProductImageBudgetService', () => {
  it('fails closed before a paid background provider is explicitly enabled', async () => {
    const service = new ProductImageBudgetService({} as any, { get: jest.fn((_key: string, fallback?: string) => fallback) } as any);

    await expect(service.reserve('company-1', 'task-1', 8)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when paid generation is enabled without an explicit positive daily cap', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'AI_PRODUCT_IMAGE_ENABLED' || key === 'AI_PRODUCT_IMAGE_BACKGROUND_ENABLED') return 'true';
        return fallback;
      }),
    };
    const prisma = { $transaction: jest.fn() };
    const service = new ProductImageBudgetService(prisma as any, config as any);

    await expect(service.reserve('company-1', 'task-1', 8))
      .rejects.toThrow('AI_PRODUCT_IMAGE_DAILY_BUDGET_CENTS 必须显式配置为正整数分');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('counts settled tasks once and releases as zero committed cost', () => {
    const service = new ProductImageBudgetService({} as any, {} as any);
    const committed = (service as any).calculateCommittedCents([
      { optimizationId: 'a', type: ProductImageBudgetLedgerType.RESERVED, amountCents: 8 },
      { optimizationId: 'a', type: ProductImageBudgetLedgerType.SETTLED, amountCents: 8 },
      { optimizationId: 'b', type: ProductImageBudgetLedgerType.RESERVED, amountCents: 10 },
      { optimizationId: 'b', type: ProductImageBudgetLedgerType.RELEASED, amountCents: 10 },
      { optimizationId: 'c', type: ProductImageBudgetLedgerType.RESERVED, amountCents: 12 },
    ]);

    expect(committed).toBe(20);
  });

  it('never writes both RELEASED and SETTLED for one reservation', async () => {
    const reserved = { companyId: 'company-1', optimizationId: 'task-1', amountCents: 8, budgetVersion: 'v1' };
    const released = { ...reserved, type: ProductImageBudgetLedgerType.RELEASED };
    const tx = {
      productImageBudgetLedger: {
        findUnique: jest.fn().mockResolvedValue(reserved),
        findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([released]),
        create: jest.fn().mockResolvedValue(released),
      },
      productImageOptimization: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      productImageBudgetLedger: { findFirst: jest.fn() },
    };
    const service = new ProductImageBudgetService(prisma as any, {} as any);

    await expect(service.release('company-1', 'task-1')).resolves.toEqual(released);
    await expect(service.settle('company-1', 'task-1', 8)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productImageBudgetLedger.create).toHaveBeenCalledTimes(1);
  });
});
