import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ProductImageOptimizationStatus, ProductVisualMode, ProductVisualRiskProfile, VisualCreditQuoteStatus } from '@prisma/client';
const sharp = require('sharp') as typeof import('sharp').default;
import {
  AimaiProductVisualAdapterService,
  AIMAI_VISUAL_ADAPTER_TYPE,
  AIMAI_VISUAL_CLIENT_ID,
} from './aimai-product-visual-adapter.service';
import { productVisualFactHash } from './product-visual-fact-hash';

const principal = {
  tenantId: 'aimai-product-agent', clientId: AIMAI_VISUAL_CLIENT_ID, adapterNamespace: 'aimai-product',
  allowedAdapterTypes: [AIMAI_VISUAL_ADAPTER_TYPE], keyId: 'internal:aimai-product-adapter-v1',
};

function build() {
  const product = {
    id: 'product-1', title: '测试商品', subtitle: null, description: null, categoryId: 'category-1',
    updatedAt: new Date('2026-08-26T00:00:00.000Z'), mediaVersion: 1,
  };
  const factVersion = productVisualFactHash(product);
  const plan = {
    id: 'plan-1', sourceHash: 'a'.repeat(64), riskProfile: ProductVisualRiskProfile.STANDARD_FACTS,
    allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO],
    protectedRegionVersion: 'mask-v1',
    sceneAnalysis: { productFactHash: factVersion },
  };
  const prisma = {
    productVisualPlan: { findFirst: jest.fn().mockResolvedValue(plan) },
    sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'asset-1', objectKey: 'seller-product-assets/asset-1.webp', canonicalSha256: 'a'.repeat(64) }) },
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ id: 'optimization-1', status: 'SUCCEEDED' }) },
    visualCreditQuote: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  };
  const clients = { resolveInternalClientPrincipal: jest.fn().mockResolvedValue(principal) };
  const trusted = {
    issueQuoteFromTrustedAdapter: jest.fn().mockResolvedValue({ id: 'quote-1', quoteHash: 'q'.repeat(64), creditCost: 15 }),
    confirmQuoteFromTrustedAdapter: jest.fn().mockResolvedValue({ quote: { id: 'quote-1', status: 'RESERVED' } }),
  };
  const credits = {
    getAccount: jest.fn().mockResolvedValue({ availableCredits: 200, reservedCredits: 0, exists: true }),
    getReservedQuoteForExecution: jest.fn().mockResolvedValue({
      id: 'quote-1', sourceAssetRef: 'asset-1', sourceHash: 'a'.repeat(64),
      visualPlanSnapshot: {
        direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', protectedRegionVersion: 'mask-v1', allowedOperations: ['LIGHTING'], adapterFactVersion: factVersion,
      },
    }),
    getQuoteForCandidateFinalization: jest.fn().mockResolvedValue({
      id: 'quote-1', sourceAssetRef: 'asset-1', sourceHash: 'a'.repeat(64), visualAgentInvocationId: 'invocation-1',
      rateCardSnapshot: { requiresHumanReview: true },
    }),
    releaseReservedQuote: jest.fn(),
    releaseUnboundReservedQuote: jest.fn().mockResolvedValue({ releaseSkipped: false }),
    settleReservedQuote: jest.fn(),
    markReconciliation: jest.fn(),
    listRateCards: jest.fn().mockResolvedValue([{
      code: 'STANDARD_REAL_SCENE', displayName: '标准实景美化', description: '保留实景', outputSpec: { size: '1K' },
      modelProfile: 'BAILIAN_WAN_STANDARD', candidateCount: 1, creditCost: 15, requiresHumanReview: true, status: 'ACTIVE', candidateRole: 'FACT_MAIN_IMAGE',
      allowedDirections: ['PRESERVE_REAL_SCENE'], allowedRiskProfiles: ['STANDARD_FACTS'],
    }]),
    getQuoteForClient: jest.fn().mockResolvedValue({
      quote: { id: 'quote-1', externalObjectId: 'product-1', creditCost: 15, status: 'ISSUED' },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1', availableCredits: 200, reservedCredits: 0 },
    }),
  };
  const execution = {
    isModelProfileAvailable: jest.fn().mockReturnValue(true),
    executeReservedQuote: jest.fn().mockResolvedValue({ invocationId: 'invocation-1', status: 'QUEUED' }),
    pollForOutput: jest.fn(),
  };
  const upload = { getBuffer: jest.fn().mockResolvedValue(Buffer.from('source')) };
  const invocations = {
    completeSynchronousVerification: jest.fn().mockResolvedValue(undefined),
    moveVerificationToReconciliation: jest.fn().mockResolvedValue(undefined),
    hasActiveBudgetCoverage: jest.fn().mockResolvedValue(true),
  };
  const candidates = {
    getPendingVerification: jest.fn().mockResolvedValue(null),
    persistPendingVerification: jest.fn().mockResolvedValue({ id: 'optimization-1', status: 'RECONCILING', candidateAssetId: 'candidate-1', candidateObjectKey: 'seller-product-assets/candidate.webp' }),
    finalizeVerification: jest.fn().mockResolvedValue({ id: 'optimization-1', status: 'SUCCEEDED' }),
  };
  const localVerification = { verify: jest.fn().mockResolvedValue({ disposition: 'MANUAL_REVIEW', geometry: {}, qr: {}, barcode: {} }) };
  const ocrVerification = { verify: jest.fn().mockResolvedValue({ state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW' }) };
  const testAccess = { isAllMerchantMode: jest.fn().mockReturnValue(false), ensureDefaultAccess: jest.fn() };
  const tasks = { registerHandler: jest.fn() };
  return {
    service: new AimaiProductVisualAdapterService(prisma as any, clients as any, trusted as any, credits as any, execution as any, upload as any, invocations as any, candidates as any, localVerification as any, ocrVerification as any, testAccess as any, tasks as any),
    prisma, clients, trusted, credits, execution, upload, invocations, candidates, localVerification, ocrVerification, testAccess, tasks,
  };
}

describe('AimaiProductVisualAdapterService', () => {
  it('lets the background handler advance an accepted task without confirming or submitting again', async () => {
    const { service, prisma, tasks } = build();
    Object.assign(prisma, {
      visualCreditAccount: { findUnique: jest.fn().mockResolvedValue({ billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' }) },
      visualAgentInvocation: { findUnique: jest.fn().mockResolvedValue({ status: 'RUNNING', providerTaskId: 'task-1' }) },
    });
    prisma.productImageOptimization.findFirst.mockResolvedValue(null);
    const advance = jest.spyOn(service, 'pollAndPersistCandidate').mockResolvedValue({ quoteId: 'q1', status: 'SUCCEEDED', optimizationId: 'opt1' } as any);
    const submit = jest.spyOn(service, 'executeConfirmedQuote');
    service.onModuleInit();
    const handler = tasks.registerHandler.mock.calls[0][1];
    await expect(handler.advance({ id: 'q1', billingAccountId: 'acc1', actorId: 'staff-1', externalObjectId: 'product-1', status: 'RESERVED', visualAgentInvocationId: 'inv1' })).resolves.toEqual({ done: true });
    expect(advance).toHaveBeenCalledWith({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'q1' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('releases a definitely unsubmitted bound invocation after restart, but never resubmits an unknown one', async () => {
    const { service, prisma, tasks, credits, invocations } = build();
    const invocation = { findUnique: jest.fn().mockResolvedValue({ status: 'RESERVED', providerTaskId: null }) };
    Object.assign(prisma, { visualCreditAccount: { findUnique: jest.fn().mockResolvedValue({ billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' }) }, visualAgentInvocation: invocation });
    Object.assign(invocations, { releaseBeforeSubmit: jest.fn().mockResolvedValue(undefined) });
    prisma.productImageOptimization.findFirst.mockResolvedValue(null);
    const submit = jest.spyOn(service, 'executeConfirmedQuote');
    service.onModuleInit();
    const handler = tasks.registerHandler.mock.calls[0][1];
    const quote = { id: 'q1', billingAccountId: 'acc1', actorId: 'staff-1', externalObjectId: 'product-1', status: 'RESERVED', visualAgentInvocationId: 'inv1' };
    await expect(handler.advance(quote)).resolves.toEqual({ done: true });
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('q1', 'WORKER_RECOVERED_BEFORE_PROVIDER_SUBMIT');
    credits.releaseReservedQuote.mockClear();
    invocation.findUnique.mockResolvedValue({ status: 'SUBMITTING', providerTaskId: null });
    await expect(handler.advance(quote)).resolves.toEqual({ done: false, retryAfterMs: 300_000 });
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('rejects a task history cursor outside the merchant scope', async () => {
    const { service, prisma } = build();
    await expect(service.listTasks('company-1', 'product-1', { cursor: 'other-quote' })).rejects.toThrow('分页记录不存在');
    expect(prisma.visualCreditQuote.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: 'other-quote', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
      externalObjectId: 'product-1', billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' },
    }) }));
    expect(prisma.visualCreditQuote.findMany).not.toHaveBeenCalled();
  });

  it('returns a released preflight task as terminal and paginates same-date rows by id', async () => {
    const { service, prisma } = build();
    const createdAt = new Date('2026-09-04T00:00:00Z');
    prisma.visualCreditQuote.findFirst.mockResolvedValue({ id: 'quote-z', createdAt });
    const row = { id: 'quote-b', sourceAssetRef: 'asset-1', status: 'RELEASED', creditCost: 10, candidateCount: 1,
      confirmedAt: createdAt, createdAt, settledAt: null, visualAgentInvocation: null,
      rateCardSnapshot: { displayName: '旧价格方案' }, visualPlanSnapshot: { direction: 'CATALOG_STUDIO' } };
    prisma.visualCreditQuote.findMany.mockResolvedValue([row, { ...row, id: 'quote-a' }]);
    Object.assign(prisma.productImageOptimization, { findMany: jest.fn().mockResolvedValue([]) });
    const result = await service.listTasks('company-1', 'product-1', { cursor: 'quote-z', limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ quoteId: 'quote-b', executionStatus: 'RELEASED', billingStatus: 'RELEASED' });
    expect(result.nextCursor).toBe('quote-b');
    expect(prisma.visualCreditQuote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: expect.objectContaining({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 'quote-z' } }] }),
    }));
  });

  it('bounds history reads and rejects a product owned by another merchant before reading tasks', async () => {
    const { service, prisma } = build();
    await service.listTasks('company-1', 'product-1', { limit: 999 });
    expect(prisma.visualCreditQuote.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.visualCreditQuote.findMany.mockClear();
    await expect(service.listTasks('other-company', 'product-1')).rejects.toThrow('商品不存在');
    expect(prisma.visualCreditQuote.findMany).not.toHaveBeenCalled();
  });
  const input = {
    companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
    planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    rateCode: 'STANDARD_REAL_SCENE', idempotencyKey: 'quote-1',
  };

  it('binds a product quote to the active internal client, Company billing owner, source asset and fixed plan', async () => {
    const { service, clients, trusted, credits } = build();

    const result = await service.issueQuote(input);

    expect(result).toMatchObject({ quote: { id: 'quote-1', creditCost: 15 }, account: { availableCredits: 200 } });
    expect(clients.resolveInternalClientPrincipal).toHaveBeenCalledWith(AIMAI_VISUAL_CLIENT_ID);
    expect(trusted.issueQuoteFromTrustedAdapter).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      adapterType: AIMAI_VISUAL_ADAPTER_TYPE,
      billingOwner: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' },
      externalObjectId: 'product-1', actorId: 'staff-1', sourceAssetRef: 'asset-1', sourceHash: 'a'.repeat(64),
      visualPlan: expect.objectContaining({ direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', allowedOperations: expect.arrayContaining(['LIGHTING']) }),
    }));
    expect(credits.getAccount).toHaveBeenCalledWith({ tenantId: 'aimai-product-agent', billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' });
  });

  it('refuses a direction that the verified product plan did not allow before a quote is created', async () => {
    const { service, trusted } = build();
    await expect(service.issueQuote({ ...input, direction: ProductVisualMode.MARKETING_SCENE })).rejects.toBeInstanceOf(ConflictException);
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('refuses to quote when saved product facts changed after the visual plan was created', async () => {
    const { service, prisma, trusted } = build();
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1', title: '已修改商品', subtitle: null, description: null, categoryId: 'category-1',
      updatedAt: new Date('2026-08-26T00:01:00.000Z'), mediaVersion: 1,
    });

    await expect(service.issueQuote(input)).rejects.toThrow('商品标题、分类或图片版本已变化');
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('does not invalidate a plan when only unrelated product update metadata changed', async () => {
    const { service, prisma, trusted } = build();
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1', title: '测试商品', subtitle: null, description: null, categoryId: 'category-1',
      updatedAt: new Date('2026-08-26T00:05:00.000Z'), mediaVersion: 1,
    });

    await expect(service.issueQuote(input)).resolves.toMatchObject({ quote: { id: 'quote-1' } });
    expect(trusted.issueQuoteFromTrustedAdapter).toHaveBeenCalledTimes(1);
  });

  it('invalidates a plan when the category name changes in place', async () => {
    const { service, prisma, trusted } = build();
    prisma.productVisualPlan.findFirst.mockResolvedValue({
      id: 'plan-1', sourceHash: 'a'.repeat(64), riskProfile: ProductVisualRiskProfile.STANDARD_FACTS,
      allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE], protectedRegionVersion: 'mask-v1',
      sceneAnalysis: { productFactHash: productVisualFactHash({
        title: '测试商品', subtitle: null, description: null, categoryId: 'category-1', categoryName: '日用品', mediaVersion: 1,
      }) },
    });
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1', title: '测试商品', subtitle: null, description: null, categoryId: 'category-1',
      category: { name: '智能设备' }, updatedAt: new Date('2026-08-26T00:05:00.000Z'), mediaVersion: 1,
    });

    await expect(service.issueQuote(input)).rejects.toThrow('商品标题、分类或图片版本已变化');
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('offers an organic harvest restage only through a marketing-image rate card', async () => {
    const { service, prisma, credits, trusted } = build();
    prisma.productVisualPlan.findFirst.mockResolvedValue({
      id: 'plan-1', sourceHash: 'a'.repeat(64), riskProfile: ProductVisualRiskProfile.ORGANIC_FACTS,
      allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO, ProductVisualMode.MARKETING_SCENE],
      protectedRegionVersion: 'mask-v1',
      sceneAnalysis: { productFactHash: productVisualFactHash({
        title: '测试商品', subtitle: null, description: null, categoryId: 'category-1',
        updatedAt: new Date('2026-08-26T00:00:00.000Z'), mediaVersion: 1,
      }) },
    });
    credits.listRateCards.mockResolvedValue([{
      code: 'HARVEST_PLATE_PRO', displayName: '采摘摆盘营销图', description: '陶瓷盘自然光', outputSpec: { size: '1K' },
      modelProfile: 'BAILIAN_WAN_PRO', candidateCount: 1, creditCost: 10, requiresHumanReview: true, status: 'ACTIVE',
      candidateRole: 'MARKETING_IMAGE', allowedDirections: ['MARKETING_SCENE'], allowedRiskProfiles: ['ORGANIC_FACTS'],
    }]);

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1', planId: 'plan-1', direction: ProductVisualMode.MARKETING_SCENE,
    })).resolves.toEqual([expect.objectContaining({ code: 'HARVEST_PLATE_PRO', candidateRole: 'MARKETING_IMAGE' })]);
    await service.issueQuote({ ...input, direction: ProductVisualMode.MARKETING_SCENE, rateCode: 'HARVEST_PLATE_PRO' });
    expect(trusted.issueQuoteFromTrustedAdapter).toHaveBeenCalledWith(expect.objectContaining({
      visualPlan: expect.objectContaining({
        direction: 'MARKETING_SCENE', riskProfile: 'ORGANIC_FACTS', presentationPreset: 'HARVEST_PLATE',
        allowedOperations: expect.arrayContaining(['SCENE_RESTAGE']),
      }),
    }));
  });

  it('allows an organic catalog plan to replace only the background for a studio candidate', async () => {
    const { service, prisma, credits, trusted } = build();
    prisma.productVisualPlan.findFirst.mockResolvedValue({
      id: 'plan-1', sourceHash: 'a'.repeat(64), riskProfile: ProductVisualRiskProfile.ORGANIC_FACTS,
      allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO, ProductVisualMode.MARKETING_SCENE],
      protectedRegionVersion: 'mask-v1',
      sceneAnalysis: { productFactHash: productVisualFactHash({
        title: '测试商品', subtitle: null, description: null, categoryId: 'category-1', mediaVersion: 1,
      }) },
    });
    credits.listRateCards.mockResolvedValue([{
      code: 'CATALOG_PRO', displayName: '智能白底棚拍', description: '白色棚拍背景', outputSpec: { providerManaged: true },
      modelProfile: 'BAILIAN_WAN_PRO', candidateCount: 1, creditCost: 10, requiresHumanReview: true, status: 'ACTIVE',
      candidateRole: 'FACT_MAIN_IMAGE', allowedDirections: ['CATALOG_STUDIO'], allowedRiskProfiles: ['ORGANIC_FACTS'],
    }]);

    await service.issueQuote({ ...input, direction: ProductVisualMode.CATALOG_STUDIO, rateCode: 'CATALOG_PRO' });

    expect(trusted.issueQuoteFromTrustedAdapter).toHaveBeenCalledWith(expect.objectContaining({
      visualPlan: expect.objectContaining({
        direction: 'CATALOG_STUDIO',
        riskProfile: 'ORGANIC_FACTS',
        allowedOperations: expect.arrayContaining(['BACKGROUND_REPLACE']),
      }),
    }));
  });

  it('lists only active rate cards compatible with the current product plan and owner scope', async () => {
    const { service, credits } = build();
    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1', planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).resolves.toEqual([{
      code: 'STANDARD_REAL_SCENE', displayName: '标准实景美化', description: '保留实景', outputSpec: { size: '1K' },
      candidateCount: 1, creditCost: 15, requiresHumanReview: true, candidateRole: 'FACT_MAIN_IMAGE',
    }]);
    expect(credits.listRateCards).toHaveBeenCalledWith({ tenantId: 'aimai-product-agent', clientId: AIMAI_VISUAL_CLIENT_ID, adapterNamespace: 'aimai-product' });
  });

  it('returns an explicit service error when exact budget coverage is unavailable', async () => {
    const { service, invocations } = build();
    invocations.hasActiveBudgetCoverage.mockResolvedValue(false);

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
      planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).rejects.toThrow('当前没有可用的图片美化方案');
    expect(invocations.hasActiveBudgetCoverage).toHaveBeenCalledWith(expect.objectContaining({
      externalObjectId: 'product-1', actorId: 'staff-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image',
    }));
  });

  it('returns an explicit service error while its real Provider route is paused', async () => {
    const { service, execution } = build();
    execution.isModelProfileAvailable.mockReturnValue(false);

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
      planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).rejects.toThrow('当前没有可用的图片美化方案');
  });

  it('auto-provisions internal budgets for every active staging merchant while listing plans', async () => {
    const { service, testAccess } = build();
    testAccess.isAllMerchantMode.mockReturnValue(true);
    testAccess.ensureDefaultAccess.mockResolvedValue({ unlimited: true });

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
      planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).resolves.toHaveLength(1);
    expect(testAccess.ensureDefaultAccess).toHaveBeenCalledWith({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', visualMode: ProductVisualMode.PRESERVE_REAL_SCENE,
    });
  });

  it('does not provision internal budgets for an invalid plan or direction', async () => {
    const { service, testAccess } = build();
    testAccess.isAllMerchantMode.mockReturnValue(true);

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
      planId: 'plan-1', direction: ProductVisualMode.MARKETING_SCENE,
    })).rejects.toThrow('当前图片计划不允许');
    expect(testAccess.ensureDefaultAccess).not.toHaveBeenCalled();
  });

  it('hides automatic-all-merchant cards immediately after the global test switch is disabled', async () => {
    const { service, credits, testAccess, invocations } = build();
    credits.listRateCards.mockResolvedValue([{
      code: 'STAGING_AUTO_WAN_PRO_PRESERVE_REAL_SCENE_V1', displayName: '自动测试方案', description: '测试',
      outputSpec: { providerManaged: true }, modelProfile: 'BAILIAN_WAN_PRO', candidateCount: 1, creditCost: 10,
      requiresHumanReview: true, status: 'ACTIVE', candidateRole: 'FACT_MAIN_IMAGE',
      allowedDirections: ['PRESERVE_REAL_SCENE'], allowedRiskProfiles: ['STANDARD_FACTS'],
    }]);
    testAccess.isAllMerchantMode.mockReturnValue(false);

    await expect(service.listEligibleRateCards({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1',
      planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).rejects.toThrow('当前没有可用的图片美化方案');
    expect(invocations.hasActiveBudgetCoverage).not.toHaveBeenCalled();
  });

  it('does not disclose a quote from a different merchant or product', async () => {
    const { service, credits } = build();
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', externalObjectId: 'product-other' },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-other', availableCredits: 200, reservedCredits: 0 },
    });
    await expect(service.getQuote('company-1', 'product-1', 'quote-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the product-bound optimization state so a merchant can resume a confirmed task', async () => {
    const { service, prisma } = build();

    await expect(service.getQuote('company-1', 'product-1', 'quote-1')).resolves.toMatchObject({
      quote: { id: 'quote-1' },
      optimization: { id: 'optimization-1', status: 'SUCCEEDED' },
    });
    expect(prisma.productImageOptimization.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-1', productId: 'product-1', idempotencyKey: 'paid-quote:quote-1' },
      select: { id: true, status: true },
    });
  });

  it('refuses a quote if the product or exact managed source is no longer owned by the merchant', async () => {
    const { service, prisma, trusted } = build();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.issueQuote(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('allows a newly uploaded managed source to be quoted before draft autosave', async () => {
    const { service, prisma } = build();

    await expect(service.issueQuote(input)).resolves.toMatchObject({ quote: { id: 'quote-1' } });
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1', companyId: 'company-1' },
    }));
  });

  it('fails closed when the configured internal Client belongs to another tenant or namespace', async () => {
    const { service, clients, trusted } = build();
    clients.resolveInternalClientPrincipal.mockResolvedValue({ ...principal, tenantId: 'restaurant-tenant' });
    await expect(service.issueQuote(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('requires the quote hash again when a merchant confirms the frozen price', async () => {
    const { service, trusted } = build();
    await expect(service.confirmQuote({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1', quoteHash: 'q'.repeat(64),
    })).resolves.toMatchObject({ quote: { status: 'RESERVED' } });
    expect(trusted.confirmQuoteFromTrustedAdapter).toHaveBeenCalledWith(expect.objectContaining({
      principal, adapterType: AIMAI_VISUAL_ADAPTER_TYPE, quoteId: 'quote-1', quoteHash: 'q'.repeat(64),
    }));
  });

  it('blocks an automatic tester quote before reserve when the all-merchant switch is disabled', async () => {
    const { service, credits, trusted, testAccess } = build();
    testAccess.isAllMerchantMode.mockReturnValue(false);
    credits.getQuoteForClient.mockResolvedValue({
      quote: {
        id: 'quote-auto', externalObjectId: 'product-1', status: VisualCreditQuoteStatus.ISSUED,
        rateCardSnapshot: { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1' },
      },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' },
    });

    await expect(service.confirmQuote({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-auto', quoteHash: 'q'.repeat(64),
    })).rejects.toThrow('全部测试商家图片美化已暂停');
    expect(trusted.confirmQuoteFromTrustedAdapter).not.toHaveBeenCalled();
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });

  it('releases an already reserved automatic tester quote when the global switch is disabled before submission', async () => {
    const { service, credits, trusted, testAccess } = build();
    testAccess.isAllMerchantMode.mockReturnValue(false);
    credits.getQuoteForClient.mockResolvedValue({
      quote: {
        id: 'quote-auto', externalObjectId: 'product-1', status: VisualCreditQuoteStatus.RESERVED,
        rateCardSnapshot: { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1' }, providerSubmissionStarted: false,
      },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' },
    });

    await expect(service.confirmQuote({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-auto', quoteHash: 'q'.repeat(64),
    })).rejects.toThrow('全部测试商家图片美化已暂停');
    expect(credits.releaseUnboundReservedQuote).toHaveBeenCalledWith('quote-auto', 'ALL_TEST_MERCHANT_ACCESS_DISABLED');
    expect(trusted.confirmQuoteFromTrustedAdapter).not.toHaveBeenCalled();
  });

  it('allows recovery of an already submitted automatic quote after the all-merchant switch is disabled', async () => {
    const { service, credits, trusted, testAccess } = build();
    testAccess.isAllMerchantMode.mockReturnValue(false);
    credits.getQuoteForClient.mockResolvedValue({
      quote: {
        id: 'quote-auto', externalObjectId: 'product-1', status: VisualCreditQuoteStatus.RESERVED,
        rateCardSnapshot: { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1' }, providerSubmissionStarted: true,
      },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' },
    });

    await expect(service.confirmQuote({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-auto', quoteHash: 'q'.repeat(64),
    })).resolves.toMatchObject({ quote: { status: 'RESERVED' } });
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
    expect(trusted.confirmQuoteFromTrustedAdapter).toHaveBeenCalled();
  });

  it('rechecks the source then runs the fixed provider plan only after quote confirmation', async () => {
    const { service, credits, execution, upload } = build();
    execution.executeReservedQuote.mockResolvedValue({ quoteId: 'quote-1', invocationId: 'invocation-1', status: 'QUEUED' });
    upload.getBuffer.mockResolvedValue(await sharp({
      create: { width: 320, height: 320, channels: 3, background: '#83715c' },
    }).jpeg().toBuffer());

    await expect(service.confirmAndExecute({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1', quoteHash: 'q'.repeat(64),
    })).resolves.toMatchObject({ execution: { invocationId: 'invocation-1', status: 'QUEUED' } });
    expect(upload.getBuffer).toHaveBeenCalledWith(expect.any(String));
    expect(execution.executeReservedQuote).toHaveBeenCalledWith(expect.objectContaining({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'a'.repeat(64),
      visualPlan: expect.objectContaining({ direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS' }),
    }));
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });

  it('releases frozen image points if saved product facts change after quote issuance', async () => {
    const { service, prisma, credits, execution } = build();
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1', title: '报价后已修改', subtitle: null, description: null, categoryId: 'category-1',
      updatedAt: new Date('2026-08-26T00:02:00.000Z'), mediaVersion: 2,
    });

    await expect(service.confirmAndExecute({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1', quoteHash: 'q'.repeat(64),
    })).rejects.toThrow('商品资料已变化');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'PRODUCT_FACTS_CHANGED_BEFORE_PROVIDER_SUBMIT');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });

  it('releases frozen credits when the managed source cannot be prepared before Provider submission', async () => {
    const { service, credits, execution, upload } = build();
    upload.getBuffer.mockRejectedValue(new Error('source unavailable'));

    await expect(service.confirmAndExecute({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1', quoteHash: 'q'.repeat(64),
    })).rejects.toThrow('source unavailable');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'SOURCE_PREPARATION_FAILED_BEFORE_PROVIDER_SUBMIT');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });

  it('settles a downloaded candidate only after Core verification and keeps persistence failures reconcilable', async () => {
    const { service, prisma, execution, credits, candidates, invocations, localVerification, ocrVerification, upload } = build();
    prisma.productImageOptimization.findFirst.mockResolvedValue(null);
    execution.pollForOutput.mockResolvedValue({
      quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_WAN', status: 'VERIFYING', output: { buffer: Buffer.from('candidate'), mimeType: 'image/jpeg' },
    });
    credits.settleReservedQuote = jest.fn().mockResolvedValue({});

    await expect(service.pollAndPersistCandidate({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1' }))
      .resolves.toMatchObject({ status: 'SUCCEEDED', candidate: { candidateAssetId: 'candidate-1' }, optimizationId: 'optimization-1' });
    expect(candidates.persistPendingVerification).toHaveBeenCalledWith(expect.objectContaining({ provider: 'BAILIAN_WAN', quote: expect.objectContaining({ id: 'quote-1' }) }));
    expect(localVerification.verify).toHaveBeenCalledWith(Buffer.from('source'), Buffer.from('source'));
    expect(ocrVerification.verify).toHaveBeenCalledWith(expect.objectContaining({ quoteId: 'quote-1', allowAutoPass: false }));
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_WAN');
    expect(credits.settleReservedQuote).toHaveBeenCalledWith('quote-1', expect.any(String));
    expect(candidates.finalizeVerification).toHaveBeenCalledWith('company-1', 'quote-1', expect.objectContaining({
      local: expect.objectContaining({ disposition: 'MANUAL_REVIEW' }),
      ocr: expect.objectContaining({ verdict: 'MANUAL_REVIEW' }),
    }), true);
    expect(upload.getBuffer).toHaveBeenCalledWith('seller-product-assets/candidate.webp');

    candidates.persistPendingVerification.mockRejectedValueOnce(new Error('storage failed'));
    credits.markReconciliation = jest.fn().mockResolvedValue(undefined);
    await expect(service.pollAndPersistCandidate({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1' }))
      .rejects.toThrow('storage failed');
    expect(invocations.moveVerificationToReconciliation).toHaveBeenCalledWith('invocation-1', 'BAILIAN_WAN', 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED');
    expect(credits.markReconciliation).toHaveBeenCalledWith('quote-1', 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED');
  });

  it('rejects cross-company polling before touching the Provider or quote state', async () => {
    const { service, prisma, credits, execution } = build();
    prisma.productImageOptimization.findFirst.mockResolvedValue(null);
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', externalObjectId: 'product-1' },
      billingAccount: { billingOwnerType: 'COMPANY', billingOwnerId: 'company-other' },
    });

    await expect(service.pollAndPersistCandidate({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(execution.pollForOutput).not.toHaveBeenCalled();
    expect(credits.markReconciliation).not.toHaveBeenCalled();
  });

  it('returns an already completed paid candidate without polling or touching the settled quote', async () => {
    const { service, prisma, execution, credits } = build();
    prisma.productImageOptimization.findFirst.mockResolvedValue({ id: 'optimization-1', status: ProductImageOptimizationStatus.SUCCEEDED });

    await expect(service.pollAndPersistCandidate({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1' }))
      .resolves.toEqual({ quoteId: 'quote-1', optimizationId: 'optimization-1', status: 'SUCCEEDED' });
    expect(execution.pollForOutput).not.toHaveBeenCalled();
    expect(credits.getReservedQuoteForExecution).not.toHaveBeenCalled();
  });

  it('recovers when another overlapping poll settles the quote before this poll reads it', async () => {
    const { service, prisma, execution, credits } = build();
    prisma.productImageOptimization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'optimization-1', status: ProductImageOptimizationStatus.SUCCEEDED });
    execution.pollForOutput.mockResolvedValue({
      quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_WAN', status: 'VERIFYING',
      output: { buffer: Buffer.from('candidate'), mimeType: 'image/jpeg' },
    });
    credits.getReservedQuoteForExecution.mockRejectedValue(new ConflictException('图片美化报价未冻结、已过期或不属于当前接入系统'));

    await expect(service.pollAndPersistCandidate({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1' }))
      .resolves.toEqual({ quoteId: 'quote-1', optimizationId: 'optimization-1', status: 'SUCCEEDED' });
    expect(credits.markReconciliation).not.toHaveBeenCalled();
  });

  it('resumes an already persisted candidate without submitting or fetching the Provider output again', async () => {
    const { service, prisma, execution, credits, candidates, invocations } = build();
    prisma.productImageOptimization.findFirst.mockResolvedValue(null);
    candidates.getPendingVerification.mockResolvedValue({
      id: 'optimization-1', status: 'RECONCILING', provider: 'BAILIAN_WAN',
      candidateAssetId: 'candidate-1', candidateObjectKey: 'seller-product-assets/candidate.webp',
    });

    await expect(service.pollAndPersistCandidate({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1' }))
      .resolves.toMatchObject({ quoteId: 'quote-1', invocationId: 'invocation-1', status: 'SUCCEEDED', optimizationId: 'optimization-1' });
    expect(execution.pollForOutput).not.toHaveBeenCalled();
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_WAN');
    expect(credits.settleReservedQuote).toHaveBeenCalledWith('quote-1', expect.any(String));
    expect(candidates.finalizeVerification).toHaveBeenCalled();
  });
});
