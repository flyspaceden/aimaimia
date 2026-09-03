import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductVisualMode, VisualAgentBudgetScope } from '@prisma/client';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';

function build(overrides: { staff?: unknown; product?: unknown } = {}) {
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
    companyStaff: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'staff') ? overrides.staff : { id: 'staff-1' }) },
    product: { findFirst: jest.fn().mockResolvedValue(Object.prototype.hasOwnProperty.call(overrides, 'product') ? overrides.product : { id: 'product-1' }) },
  };
  const invocations = {
    upsertBudgetPolicy: jest.fn().mockResolvedValue({ id: 'policy-1' }),
    listBudgetPolicies: jest.fn().mockResolvedValue([]),
  };
  const credits = {
    upsertRateCard: jest.fn().mockResolvedValue({ code: 'STAGING_WAN_PRO_MARKETING_V1', creditCost: 10 }),
    grantWelcomeCredits: jest.fn().mockResolvedValue({}),
    getAccount: jest.fn().mockResolvedValue({ availableCredits: 200, reservedCredits: 0 }),
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
});
