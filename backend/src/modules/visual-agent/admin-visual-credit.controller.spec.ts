import { VisualRateCardStatus } from '@prisma/client';
import { AdminVisualCreditController } from './admin-visual-credit.controller';

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
    return { controller: new AdminVisualCreditController(credits as any), credits };
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
      outputSpec: { size: '1K' }, candidateCount: 1, creditCost: 15,
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
});
