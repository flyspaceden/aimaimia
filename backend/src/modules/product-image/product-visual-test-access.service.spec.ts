import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, ProductVisualMode, ProductVisualRiskProfile, VisualAgentBudgetScope, VisualCreditQuoteStatus } from '@prisma/client';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';

function build(overrides: { staff?: unknown; product?: unknown } = {}) {
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
    companyStaff: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'staff') ? overrides.staff : { id: 'staff-1' }) },
    product: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'product') ? overrides.product : { id: 'product-1' }) },
    visualCreditQuote: { findMany: jest.fn().mockResolvedValue([]) },
    visualRateCard: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }) => data),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const invocations = {
    upsertBudgetPolicy: jest.fn().mockResolvedValue({ id: 'policy-1' }),
    listBudgetPolicies: jest.fn().mockResolvedValue([]),
    hasActiveBudgetCoverage: jest.fn().mockResolvedValue(false),
  };
  const credits = {
    upsertRateCard: jest.fn().mockResolvedValue({ code: 'STAGING_WAN_PRO_MARKETING_V1', creditCost: 10 }),
    grantWelcomeCredits: jest.fn().mockResolvedValue({}),
    getAccount: jest.fn().mockResolvedValue({ availableCredits: 200, reservedCredits: 0 }),
    releaseUnboundReservedQuote: jest.fn().mockResolvedValue({}),
    listRateCards: jest.fn().mockResolvedValue([]),
    getWelcomePolicy: jest.fn().mockResolvedValue({ enabled: true, effectiveFrom: new Date(0), effectiveUntil: null }),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  return {
    service: new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => key === 'PUBLIC_API_BASE_URL' ? 'https://test-api.ai-maimai.com/api/v1' : key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' ? 'true' : fallback) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    ),
    prisma,
    invocations,
    credits,
  };
}

const structureBudgetInput = { companyId: 'company-1', productId: 'product-1', staffId: 'staff-1' };

function buildStructure(overrides: {
  publicApiBaseUrl?: string;
  testAccessEnabled?: string;
  allMerchantsEnabled?: string;
  structureVerifyEnabled?: string;
  structureVerifyExecutionEnabled?: string;
  product?: unknown;
  existingPolicy?: (scope: string) => unknown;
} = {}) {
  const configValues: Record<string, string> = {
    PUBLIC_API_BASE_URL: overrides.publicApiBaseUrl ?? 'https://test-api.ai-maimai.com/api/v1',
    AI_VISUAL_AGENT_TEST_ACCESS_ENABLED: overrides.testAccessEnabled ?? 'true',
    AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED: overrides.allMerchantsEnabled ?? 'true',
    AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED: overrides.structureVerifyEnabled ?? 'true',
    AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED: overrides.structureVerifyExecutionEnabled ?? 'true',
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : fallback),
  };
  const tx = {
    $executeRaw: jest.fn(),
    visualAgentBudgetPolicy: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { scope: string } }) => overrides.existingPolicy?.(where.scope) ?? null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `policy-${data.scope}`, ...data })),
    },
  };
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'product') ? overrides.product : { id: 'product-1' }) },
    $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const service = new ProductVisualTestAccessService(
    prisma as any,
    {} as any,
    {} as any,
    config as any,
    {} as any,
  );
  return { service, prisma, tx, config };
}

describe('ProductVisualTestAccessService', () => {
  const input = {
    companyId: 'company-1',
    staffId: 'staff-1',
    productId: 'product-1',
    visualMode: ProductVisualMode.MARKETING_SCENE,
    dailyCallLimit: 2,
    weeklyCallLimit: 5,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    grantWelcomeCredits: true,
  };

  it('grants one explicit company, staff and product exact six-scope test authorization', async () => {
    const { service, prisma, invocations, credits } = build();

    await expect(service.grant(input)).resolves.toMatchObject({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1',
      model: 'wan2.7-image-pro', reserveCents: 50,
      account: { availableCredits: 200, reservedCredits: 0 },
    });
    expect(prisma.companyStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'staff-1', companyId: 'company-1', status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } }),
    }));
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledTimes(6);
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      scope: VisualAgentBudgetScope.EXTERNAL_OBJECT,
      scopeKey: expect.stringMatching(/:object:9:product-1$/),
      policyVersion: 'rate-STAGING_WAN_PRO_MARKETING_V1',
      dailyCapCents: 100,
      weeklyCapCents: 250,
      effectiveUntil: input.expiresAt,
    }));
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      scope: VisualAgentBudgetScope.ACTOR,
      scopeKey: expect.stringMatching(/:actor:7:staff-1$/),
    }));
    expect(credits.grantWelcomeCredits).toHaveBeenCalledWith(expect.objectContaining({ billingOwnerId: 'company-1' }));
  });

  it('fails before creating any policy when company, staff and product are not one valid test scope', async () => {
    const { service, invocations, credits } = build({ staff: null });

    await expect(service.grant(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
    expect(credits.grantWelcomeCredits).not.toHaveBeenCalled();
  });

  it('does not shorten an existing product test window or reduce its caps when another staff is authorized', async () => {
    const { service, invocations } = build();
    const laterExpiry = new Date(Date.now() + 14 * 24 * 60 * 60_000);
    invocations.listBudgetPolicies.mockResolvedValue([{
      scope: VisualAgentBudgetScope.EXTERNAL_OBJECT,
      scopeKey: 'tenant:19:aimai-product-agent:client:24:aimai-product-adapter-v1:adapter:13:aimai-product:object:9:product-1',
      provider: 'BAILIAN_WAN', model: 'wan2.7-image-pro', visualMode: ProductVisualMode.MARKETING_SCENE,
      policyVersion: 'rate-STAGING_WAN_PRO_MARKETING_V1', enabled: true,
      dailyCapCents: 250, weeklyCapCents: 1000, effectiveUntil: laterExpiry,
    }]);

    await service.grant(input);
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      scope: VisualAgentBudgetScope.EXTERNAL_OBJECT,
      dailyCapCents: 250,
      weeklyCapCents: 1000,
      effectiveUntil: laterExpiry,
    }));
  });

  it('rejects excessive or inconsistent tester access windows', async () => {
    const { service, invocations } = build();

    await expect(service.grant({ ...input, expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60_000) }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.grant({ ...input, dailyCallLimit: 5, weeklyCallLimit: 2 }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
  });

  it('cannot grant staging test access from a production API process', async () => {
    const { prisma, invocations, credits } = build();
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => key === 'PUBLIC_API_BASE_URL' ? 'https://api.ai-maimai.com/api/v1' : key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' ? 'true' : fallback) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(false) } as any,
    );

    await expect(service.grant(input)).rejects.toThrow('只允许在 staging 环境使用');
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
  });

  it('stays closed on the test hostname until its dedicated access switch is enabled', async () => {
    const { prisma, invocations, credits } = build();
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => key === 'PUBLIC_API_BASE_URL' ? 'https://test-api.ai-maimai.com/api/v1' : fallback) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(false) } as any,
    );

    await expect(service.grant(input)).rejects.toThrow('只允许在 staging 环境使用');
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
  });

  it('auto-provisions exact but effectively unlimited access for every active staging merchant', async () => {
    const { prisma, invocations, credits } = build();
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => {
        if (key === 'PUBLIC_API_BASE_URL') return 'https://test-api.ai-maimai.com/api/v1';
        if (key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' || key === 'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED') return 'true';
        return fallback;
      }) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    );

    expect(service.isAllMerchantMode()).toBe(true);
    await expect(service.ensureDefaultAccess({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', visualMode: ProductVisualMode.MARKETING_SCENE,
    })).resolves.toMatchObject({ unlimited: true, providerReady: true });
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledTimes(6);
    for (const call of invocations.upsertBudgetPolicy.mock.calls) {
      expect(call[0]).toMatchObject({ dailyCapCents: 2_000_000_000, weeklyCapCents: 2_000_000_000 });
    }
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      scope: VisualAgentBudgetScope.EXTERNAL_OBJECT,
      effectiveUntil: null,
    }));
    expect(credits.grantWelcomeCredits).toHaveBeenCalled();
  });

  it('does not rewrite an already complete automatic credit and budget scope', async () => {
    const { prisma, invocations, credits } = build();
    credits.listRateCards.mockResolvedValue([{
      code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status: 'ACTIVE', modelProfile: 'BAILIAN_WAN_PRO',
      displayName: 'Pro 营销场景图（测试）',
      description: '按受控模板重新布置营销展示场景；仅供私密预览，不能替换商品事实主图。',
      creditCost: 10, candidateCount: 1, version: 'staging-test-access-v1', requiresHumanReview: true,
      candidateRole: 'MARKETING_IMAGE', outputSpec: { providerManaged: true },
      effectiveFrom: new Date(Date.now() - 60_000), effectiveUntil: null,
      allowedDirections: [ProductVisualMode.MARKETING_SCENE],
      allowedRiskProfiles: [ProductVisualRiskProfile.ORGANIC_FACTS, ProductVisualRiskProfile.STANDARD_FACTS],
    }]);
    credits.getAccount.mockResolvedValue({ availableCredits: 190, reservedCredits: 0, exists: true });
    invocations.hasActiveBudgetCoverage.mockResolvedValue(true);
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => {
        if (key === 'PUBLIC_API_BASE_URL') return 'https://test-api.ai-maimai.com/api/v1';
        if (key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' || key === 'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED') return 'true';
        return fallback;
      }) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    );

    await expect(service.ensureDefaultAccess({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', visualMode: ProductVisualMode.MARKETING_SCENE,
    })).resolves.toMatchObject({ unlimited: true, expiresAt: null, account: { availableCredits: 190 } });
    expect(invocations.hasActiveBudgetCoverage).toHaveBeenCalled();
    expect(credits.upsertRateCard).not.toHaveBeenCalled();
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
    expect(credits.grantWelcomeCredits).not.toHaveBeenCalled();
  });

  it('preserves administrator changes instead of restoring the bootstrap configuration', async () => {
    const { prisma, invocations, credits } = build();
    credits.listRateCards.mockResolvedValue([{
      code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status: 'ACTIVE', modelProfile: 'BAILIAN_WAN_PRO',
      displayName: 'Pro 营销场景图（测试）',
      description: '按受控模板重新布置营销展示场景；仅供私密预览，不能替换商品事实主图。',
      creditCost: 27, candidateCount: 1, version: 'admin-version-2', requiresHumanReview: true,
      candidateRole: 'DETAIL_IMAGE', outputSpec: { providerManaged: true },
      effectiveFrom: new Date(Date.now() - 60_000), effectiveUntil: null,
      allowedDirections: [ProductVisualMode.MARKETING_SCENE],
      allowedRiskProfiles: [ProductVisualRiskProfile.ORGANIC_FACTS, ProductVisualRiskProfile.STANDARD_FACTS],
    }]);
    credits.getAccount.mockResolvedValue({ availableCredits: 190, reservedCredits: 0, exists: true });
    invocations.hasActiveBudgetCoverage.mockResolvedValue(true);
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => {
        if (key === 'PUBLIC_API_BASE_URL') return 'https://test-api.ai-maimai.com/api/v1';
        if (key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' || key === 'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED') return 'true';
        return fallback;
      }) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    );

    await service.ensureDefaultAccess({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', visualMode: ProductVisualMode.MARKETING_SCENE,
    });
    expect(credits.upsertRateCard).not.toHaveBeenCalled();
    expect(prisma.visualRateCard.create).not.toHaveBeenCalled();
    expect(invocations.upsertBudgetPolicy).not.toHaveBeenCalled();
  });

  it('retries all idempotent budget steps after a partial provisioning failure', async () => {
    const { prisma, invocations, credits } = build();
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => {
        if (key === 'PUBLIC_API_BASE_URL') return 'https://test-api.ai-maimai.com/api/v1';
        if (key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' || key === 'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED') return 'true';
        return fallback;
      }) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    );
    invocations.upsertBudgetPolicy.mockRejectedValueOnce(new Error('temporary database error'));

    const request = {
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', visualMode: ProductVisualMode.MARKETING_SCENE,
    };
    await expect(service.ensureDefaultAccess(request)).rejects.toThrow('temporary database error');
    await expect(service.ensureDefaultAccess(request)).resolves.toMatchObject({ unlimited: true });
    expect(credits.upsertRateCard).not.toHaveBeenCalled();
    expect(invocations.upsertBudgetPolicy.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it.each(['PAUSED', 'ACTIVE'])('does not overwrite an administrator %s card while provisioning a new merchant', async (status) => {
    const { service, prisma, credits, invocations } = build();
    const card = {
      code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status,
      displayName: '管理员自定义方案', description: '管理员说明',
      modelProfile: 'BAILIAN_QWEN_IMAGE', creditCost: 23,
      version: 'admin-v3', effectiveFrom: new Date(0), effectiveUntil: null,
    };
    // 模拟列表读取后管理员刚保存；锁内重读才是初始化依据。
    credits.listRateCards.mockResolvedValue([]);
    prisma.visualRateCard.findMany.mockResolvedValue([card]);

    await expect(service.grant({ ...input, unlimited: true, automaticAllMerchants: true }))
      .resolves.toMatchObject({
        model: 'qwen-image-3.0', provider: 'BAILIAN_QWEN_IMAGE',
        rateCard: { creditCost: 23 },
      });
    expect(prisma.visualRateCard.create).not.toHaveBeenCalled();
    expect(credits.upsertRateCard).not.toHaveBeenCalled();
    expect(card.status).toBe(status);
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'BAILIAN_QWEN_IMAGE', model: 'qwen-image-3.0',
      scope: VisualAgentBudgetScope.PROVIDER, scopeKey: 'provider:18:BAILIAN_QWEN_IMAGE',
    }));
  });

  it('uses the active administrator version instead of resurrecting the paused initial version', async () => {
    const { service, prisma, credits } = build();
    prisma.visualRateCard.findMany.mockResolvedValue([
      { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status: 'PAUSED', modelProfile: 'BAILIAN_WAN_PRO', creditCost: 10, effectiveFrom: new Date(0) },
      { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status: 'ACTIVE', modelProfile: 'BAILIAN_WAN_STANDARD', creditCost: 7, effectiveFrom: new Date(0), effectiveUntil: null },
    ]);
    await expect(service.grant({ ...input, unlimited: true, automaticAllMerchants: true }))
      .resolves.toMatchObject({ model: 'wan2.7-image', rateCard: { creditCost: 7 } });
    expect(prisma.visualRateCard.create).not.toHaveBeenCalled();
    expect(credits.upsertRateCard).not.toHaveBeenCalled();
  });

  it.each([null, { enabled: false, effectiveFrom: new Date(0) },
    { enabled: true, effectiveFrom: new Date(0), effectiveUntil: new Date(1) }])(
    'allows an existing funded merchant when the welcome policy is unavailable: %j', async (policy) => {
      const { service, credits } = build();
      credits.getWelcomePolicy.mockResolvedValue(policy as any);
      credits.getAccount.mockResolvedValue({ exists: true, availableCredits: 90, reservedCredits: 0 });
      await expect(service.grant({ ...input, unlimited: true, automaticAllMerchants: true }))
        .resolves.toMatchObject({ account: { availableCredits: 90 } });
      expect(credits.grantWelcomeCredits).not.toHaveBeenCalled();
    },
  );

  it('tolerates welcome policy pause during provisioning but propagates storage failures', async () => {
    const { service, credits } = build();
    credits.grantWelcomeCredits.mockRejectedValueOnce(new ServiceUnavailableException('当前没有可用的新商家图片积分赠送策略'));
    await expect(service.grant(input)).resolves.toMatchObject({ account: { availableCredits: 200 } });
    credits.grantWelcomeCredits.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.grant(input)).rejects.toThrow('database unavailable');
  });

  it('creates only absent initial rate cards using the shared administrator lock and serializable transaction', async () => {
    const { service, prisma } = build();
    await service.grant(input);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.visualRateCard.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      code: 'STAGING_WAN_PRO_MARKETING_V1', creditCost: 10, status: 'ACTIVE',
      tenantId: 'aimai-product-agent', clientId: 'aimai-product-adapter-v1', adapterNamespace: 'aimai-product',
    }) });
  });

  it('releases only unbound automatic reservations after all-merchant access is disabled', async () => {
    const { prisma, invocations, credits } = build();
    prisma.visualCreditQuote.findMany.mockResolvedValue([
      { id: 'auto-quote', rateCardSnapshot: { code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1' } },
      { id: 'manual-quote', rateCardSnapshot: { code: 'STAGING_WAN_PRO_MARKETING_V1' } },
    ]);
    const service = new ProductVisualTestAccessService(
      prisma as any,
      invocations as any,
      credits as any,
      { get: jest.fn((key: string, fallback?: string) => key === 'PUBLIC_API_BASE_URL' ? 'https://test-api.ai-maimai.com/api/v1' : key === 'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED' ? 'true' : fallback) } as any,
      { isModelProfileAvailable: jest.fn().mockReturnValue(true) } as any,
    );

    await expect(service.releaseDisabledAutomaticReservations()).resolves.toBe(1);
    expect(prisma.visualCreditQuote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: VisualCreditQuoteStatus.RESERVED, visualAgentInvocationId: null },
    }));
    expect(credits.releaseUnboundReservedQuote).toHaveBeenCalledWith('auto-quote', 'ALL_TEST_MERCHANT_ACCESS_DISABLED');
    expect(credits.releaseUnboundReservedQuote).not.toHaveBeenCalledWith('manual-quote', expect.anything());
  });

  it.each([
    ['staging all-merchant access is disabled', { allMerchantsEnabled: 'false' }],
    ['structure verification is disabled', { structureVerifyEnabled: 'false' }],
    ['structure execution is disabled', { structureVerifyExecutionEnabled: 'false' }],
    ['the API uses a production hostname', { publicApiBaseUrl: 'https://api.ai-maimai.com/api/v1' }],
  ])('does not write a structure budget when %s', async (_description, options) => {
    const { service, prisma, tx } = buildStructure(options);

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).resolves.toBeUndefined();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.visualAgentBudgetPolicy.create).not.toHaveBeenCalled();
  });

  it('rejects a product that is missing from the requesting company before opening a transaction', async () => {
    const { service, prisma, tx } = buildStructure({ product: null });

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', companyId: 'company-1' },
      select: { id: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.visualAgentBudgetPolicy.create).not.toHaveBeenCalled();
  });

  it('creates exactly one one-cent policy for each of the six exact structure scopes in Serializable isolation', async () => {
    const { service, prisma, tx } = buildStructure();

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(6);
    expect(tx.visualAgentBudgetPolicy.findFirst).toHaveBeenCalledTimes(6);
    expect(tx.visualAgentBudgetPolicy.create).toHaveBeenCalledTimes(6);

    const created = tx.visualAgentBudgetPolicy.create.mock.calls.map((call: [{ data: Record<string, unknown> }]) => call[0].data);
    expect(created.map((data) => data.scope).sort()).toEqual(Object.values(VisualAgentBudgetScope).sort());
    for (const data of created) {
      expect(data).toMatchObject({
        provider: 'BAILIAN_QWEN_STRUCTURE',
        model: 'qwen3-vl-flash',
        visualMode: 'STRUCTURE_VERIFY',
        reserveCents: 1,
        perTaskCapCents: 1,
        dailyCapCents: 2_000_000_000,
        weeklyCapCents: 2_000_000_000,
        policyVersion: 'staging-structure-v1',
        enabled: true,
        effectiveUntil: null,
      });
      expect(data.scopeKey).toEqual(expect.any(String));
    }
  });

  it('does not overwrite an existing paused policy while creating the remaining structure scopes', async () => {
    const { service, tx } = buildStructure({
      existingPolicy: (scope) => scope === VisualAgentBudgetScope.PLATFORM ? { id: 'paused-platform-policy', status: 'PAUSED' } : null,
    });

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).resolves.toBeUndefined();
    expect(tx.visualAgentBudgetPolicy.create).toHaveBeenCalledTimes(5);
    expect(tx.visualAgentBudgetPolicy.create.mock.calls.map((call: [{ data: Record<string, unknown> }]) => call[0].data.scope))
      .not.toContain(VisualAgentBudgetScope.PLATFORM);
    expect(tx.visualAgentBudgetPolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: VisualAgentBudgetScope.PLATFORM, provider: 'BAILIAN_QWEN_STRUCTURE', model: 'qwen3-vl-flash', visualMode: 'STRUCTURE_VERIFY' }),
      select: { id: true },
    }));
  });

  it('retries a real Prisma P2034 once without duplicating a partial transaction', async () => {
    const { service, prisma, tx } = buildStructure();
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction.mockReset()
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (callback: (transaction: typeof tx) => unknown) => callback(tx));

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.visualAgentBudgetPolicy.create).toHaveBeenCalledTimes(6);
  });

  it('stops after five consecutive Prisma P2034 conflicts with a retryable service error', async () => {
    const { service, prisma } = buildStructure();
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction.mockReset().mockRejectedValue(conflict);

    await expect(service.ensureStructureTestBudget(structureBudgetInput))
      .rejects.toMatchObject({ response: { message: '结构检查配置暂时繁忙，请稍后重试' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('does not swallow an ordinary database error or retry it', async () => {
    const { service, prisma } = buildStructure();
    const databaseError = new Error('database unavailable');
    prisma.$transaction.mockReset().mockRejectedValue(databaseError);

    await expect(service.ensureStructureTestBudget(structureBudgetInput)).rejects.toBe(databaseError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
