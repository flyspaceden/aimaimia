import { VisualAgentBudgetScope, VisualRateCardStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { AdminVisualCreditController } from './admin-visual-credit.controller';
import { UpsertVisualAgentBudgetPolicyDto } from './admin-visual-credit.dto';

describe('AdminVisualCreditController', () => {
  function build() {
    const credits = {
      getWelcomePolicy: jest.fn(),
      configureWelcomePolicy: jest.fn().mockResolvedValue({ id: 'policy-1' }),
      listRateCards: jest.fn(),
      upsertRateCard: jest.fn().mockResolvedValue({ id: 'rate-1' }),
      grantWelcomeCredits: jest.fn().mockResolvedValue({ account: { id: 'account-1' } }),
      getAccount: jest.fn(),
      listLedger: jest.fn(),
      adminAdjust: jest.fn().mockResolvedValue({ ledger: { id: 'ledger-1' } }),
    };
    const invocations = {
      listBudgetPolicies: jest.fn().mockResolvedValue([{ id: 'budget-1' }]),
      upsertBudgetPolicy: jest.fn().mockResolvedValue({ id: 'budget-1' }),
      listReconciliations: jest.fn().mockResolvedValue([{ id: 'invocation-1' }]),
      resolveReconciliation: jest.fn().mockResolvedValue(undefined),
    };
    return { controller: new AdminVisualCreditController(credits as any, invocations as any), credits, invocations };
  }

  it('maps platform welcome-policy fields without using a buyer reward account', async () => {
    const { controller, credits } = build();
    await expect(controller.configureWelcomePolicy('aimai-tenant', {
      enabled: true, grantCredits: 200, creditValueCents: 2000, policyVersion: 'welcome-v1',
      effectiveFrom: '2026-08-26T00:00:00.000Z',
    })).resolves.toEqual({ id: 'policy-1' });
    expect(credits.configureWelcomePolicy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'aimai-tenant', grantCredits: 200, creditValueCents: 2000,
    }));
  });

  it('writes a tenant/client/namespace-scoped rate card with a merchant credit cost', async () => {
    const { controller, credits } = build();
    await expect(controller.upsertRateCard('aimai-tenant', {
      clientId: 'aimai-product-client', adapterNamespace: 'aimai-product', code: 'STANDARD_REAL_SCENE',
      displayName: '标准实景美化', description: '保留实景', modelProfile: 'BAILIAN_WAN_STANDARD',
      outputSpec: { providerManaged: true }, allowedDirections: ['PRESERVE_REAL_SCENE'],
      allowedRiskProfiles: ['STANDARD_FACTS'], candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: true,
      candidateCount: 1, creditCost: 15,
      status: VisualRateCardStatus.ACTIVE, version: 'v1',
    })).resolves.toEqual({ id: 'rate-1' });
    expect(credits.upsertRateCard).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'aimai-tenant', creditCost: 15, clientId: 'aimai-product-client', adapterNamespace: 'aimai-product',
    }));
  });

  it('keeps account adjustments explicitly tied to the administrator and reason', async () => {
    const { controller, credits } = build();
    await expect(controller.adjust('aimai-tenant', 'COMPANY', 'company-1', {
      availableDelta: 30, reason: '售后补偿', idempotencyKey: 'adjust-1',
    }, 'admin-1')).resolves.toEqual({ ledger: { id: 'ledger-1' } });
    expect(credits.adminAdjust).toHaveBeenCalledWith({
      tenantId: 'aimai-tenant', billingOwnerType: 'COMPANY', billingOwnerId: 'company-1',
      availableDelta: 30, reason: '售后补偿', idempotencyKey: 'adjust-1', operatorId: 'admin-1',
    });
  });

  it('maps budget policy and reconciliation controls to the invocation service', async () => {
    const { controller, invocations } = build();
    await expect(controller.upsertBudgetPolicy({
      scope: VisualAgentBudgetScope.PLATFORM,
      scopeKey: 'GLOBAL', provider: 'BAILIAN_WAN', model: 'wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE',
      reserveCents: 20, perTaskCapCents: 50, dailyCapCents: 500, weeklyCapCents: 2000,
      policyVersion: 'v1', enabled: true,
    })).resolves.toEqual({ id: 'budget-1' });
    expect(invocations.upsertBudgetPolicy).toHaveBeenCalledWith(expect.objectContaining({
      scope: VisualAgentBudgetScope.PLATFORM, scopeKey: 'GLOBAL', effectiveFrom: expect.any(Date),
    }));

    await expect(controller.resolveReconciliation('invocation-1', {
      decision: 'RELEASED', creditDecision: 'RELEASE', evidenceRef: 'provider:no-charge-1',
    }, 'admin-1')).resolves.toEqual({ resolved: true });
    expect(invocations.resolveReconciliation).toHaveBeenCalledWith({
      invocationId: 'invocation-1', decision: 'RELEASED', creditDecision: 'RELEASE', evidenceRef: 'provider:no-charge-1', operatorId: 'admin-1',
    });
  });

  it('accepts the controlled marketing-scene mode in the admin budget DTO', async () => {
    const dto = Object.assign(new UpsertVisualAgentBudgetPolicyDto(), {
      scope: VisualAgentBudgetScope.PLATFORM,
      scopeKey: 'GLOBAL', provider: 'BAILIAN_WAN', model: 'wan2.7-image-pro', visualMode: 'MARKETING_SCENE',
      reserveCents: 50, perTaskCapCents: 50, dailyCapCents: 50, weeklyCapCents: 50,
      policyVersion: 'marketing-canary-v1', enabled: true,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
