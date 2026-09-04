import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductVisualMode, ProductVisualRiskProfile, VisualAgentBudgetScope, VisualCreditQuoteStatus } from '@prisma/client';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';

function build(overrides: { staff?: unknown; product?: unknown } = {}) {
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
    companyStaff: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'staff') ? overrides.staff : { id: 'staff-1' }) },
    product: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'product') ? overrides.product : { id: 'product-1' }) },
    visualCreditQuote: { findMany: jest.fn().mockResolvedValue([]) },
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
  };
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

  it('repairs a drifted automatic rate card instead of taking the no-write fast path', async () => {
    const { prisma, invocations, credits } = build();
    credits.listRateCards.mockResolvedValue([{
      code: 'STAGING_AUTO_WAN_PRO_MARKETING_V1', status: 'ACTIVE', modelProfile: 'BAILIAN_WAN_PRO',
      displayName: 'Pro 营销场景图（测试）',
      description: '按受控模板重新布置营销展示场景；仅供私密预览，不能替换商品事实主图。',
      creditCost: 10, candidateCount: 1, version: 'staging-test-access-v1', requiresHumanReview: true,
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
    expect(credits.upsertRateCard).toHaveBeenCalledWith(expect.objectContaining({ candidateRole: 'MARKETING_IMAGE' }));
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledTimes(6);
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
    expect(credits.upsertRateCard).toHaveBeenCalledTimes(2);
    expect(invocations.upsertBudgetPolicy.mock.calls.length).toBeGreaterThanOrEqual(7);
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
});
