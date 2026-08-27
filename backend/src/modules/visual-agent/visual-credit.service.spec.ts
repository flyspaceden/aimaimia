import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { VisualCreditQuoteStatus, VisualRateCardStatus } from '@prisma/client';
import { VisualCreditService } from './visual-credit.service';

const principal = {
  tenantId: 'aimai-tenant', clientId: 'aimai-product-client', adapterNamespace: 'aimai-product',
  allowedAdapterTypes: ['aimai-product-v1'], keyId: 'key-1',
};
const owner = { billingOwnerType: 'COMPANY', billingOwnerId: 'company-1' };
const sourceHash = 'a'.repeat(64);
const planHash = 'b'.repeat(64);
const now = new Date('2026-08-26T12:00:00.000Z');

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1', tenantId: principal.tenantId, ...owner,
    availableCredits: 200, reservedCredits: 0, version: 0,
    ...overrides,
  };
}

function rateCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rate-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
    code: 'STANDARD_REAL_SCENE', displayName: '标准实景美化', description: '保留真实场景',
    modelProfile: 'BAILIAN_WAN_STANDARD', outputSpec: { size: '1K' }, candidateCount: 1,
    creditCost: 15, status: VisualRateCardStatus.ACTIVE, version: 'v1',
    effectiveFrom: new Date(0), effectiveUntil: null,
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
    billingAccountId: 'account-1', externalObjectId: 'product-1', actorId: 'staff-1', sourceHash, visualPlanHash: planHash,
    creditCost: 15, candidateCount: 1, rateCardSnapshot: { code: 'STANDARD_REAL_SCENE' }, quoteHash: 'q'.repeat(64),
    status: VisualCreditQuoteStatus.ISSUED, expiresAt: new Date(Date.now() + 15 * 60_000),
    confirmedAt: null, settledAt: null, releasedAt: null, failureReason: null,
    billingAccount: account(),
    ...overrides,
  };
}

function build() {
  const tx = {
    $executeRaw: jest.fn(),
    visualCreditWelcomePolicy: { findUnique: jest.fn().mockResolvedValue({
      id: 'welcome-1', enabled: true, grantCredits: 200, creditValueCents: 2000,
      policyVersion: 'welcome-v1', effectiveFrom: new Date(0), effectiveUntil: null,
    }) },
    visualCreditAccount: {
      upsert: jest.fn().mockResolvedValue(account()),
      update: jest.fn().mockResolvedValue(account({ availableCredits: 185, reservedCredits: 15, version: 1 })),
    },
    visualCreditLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'ledger-1', type: 'RESERVE', availableDelta: -15, reservedDelta: 15,
        availableBalanceAfter: 185, reservedBalanceAfter: 15, createdAt: now,
      }),
    },
    visualRateCard: {
      findFirst: jest.fn().mockResolvedValue(rateCard()),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue(rateCard()),
    },
    visualCreditQuote: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => quote({ ...data })),
      findFirst: jest.fn().mockResolvedValue(quote()),
      update: jest.fn().mockImplementation(async ({ data }: any) => quote({ ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    visualCreditWelcomePolicy: { upsert: jest.fn().mockResolvedValue({ id: 'welcome-1' }) },
    visualRateCard: { upsert: jest.fn() },
    visualCreditAccount: { findUnique: jest.fn() },
    visualCreditQuote: { updateMany: jest.fn() },
    visualCreditLedger: { findMany: jest.fn() },
  };
  return { service: new VisualCreditService(prisma as any), prisma, tx };
}

describe('VisualCreditService', () => {
  it('grants the configured 200 welcome credits once and records a separate non-cash ledger', async () => {
    const { service, tx } = build();
    tx.visualCreditAccount.update.mockResolvedValue(account({ availableCredits: 400, version: 1 }));
    tx.visualCreditLedger.create.mockResolvedValue({
      id: 'ledger-1', accountId: 'account-1', type: 'WELCOME_GRANT', availableDelta: 200, reservedDelta: 0,
      availableBalanceAfter: 400, reservedBalanceAfter: 0, createdAt: now,
    });

    const result = await service.grantWelcomeCredits({ tenantId: principal.tenantId, ...owner, now });

    expect(result).toMatchObject({ account: { availableCredits: 400, reservedCredits: 0 }, ledger: { type: 'WELCOME_GRANT', availableDelta: 200 } });
    expect(tx.visualCreditLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: `WELCOME_200_V1:${principal.tenantId}:COMPANY:company-1` }),
    }));
  });

  it('rejects a welcome idempotency key that belongs to another credit account', async () => {
    const { service, tx } = build();
    tx.visualCreditLedger.findUnique.mockResolvedValue({ accountId: 'another-account', type: 'WELCOME_GRANT' });

    await expect(service.grantWelcomeCredits({ tenantId: principal.tenantId, ...owner, idempotencyKey: 'welcome-reuse', now }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('pauses an older active rate card before activating a new version', async () => {
    const { service, tx } = build();

    await service.upsertRateCard({ ...rateCard(), status: VisualRateCardStatus.ACTIVE, version: 'v2' });

    expect(tx.visualRateCard.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ code: 'STANDARD_REAL_SCENE', status: VisualRateCardStatus.ACTIVE, version: { not: 'v2' } }),
      data: { status: VisualRateCardStatus.PAUSED },
    }));
  });

  it('issues an immutable rate-card quote bound to Client, billing owner, image and plan hashes', async () => {
    const { service, tx } = build();
    const result = await service.issueQuote({
      principal, ...owner, externalObjectId: 'product-1', actorId: 'staff-1', rateCode: 'STANDARD_REAL_SCENE',
      sourceHash, visualPlanHash: planHash, idempotencyKey: 'quote-1', expiresAt: new Date(Date.now() + 20 * 60_000),
    });

    expect(result).toMatchObject({ creditCost: 15, candidateCount: 1, rateCardSnapshot: expect.objectContaining({ modelProfile: 'BAILIAN_WAN_STANDARD' }) });
    expect(tx.visualCreditQuote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: principal.tenantId, clientId: principal.clientId, billingAccountId: 'account-1', sourceHash, visualPlanHash: planHash }),
    }));
  });

  it('fails closed when an active rate card is not configured for the exact Client scope', async () => {
    const { service, tx } = build();
    tx.visualRateCard.findFirst.mockResolvedValue(null);

    await expect(service.issueQuote({
      principal, ...owner, externalObjectId: 'product-1', actorId: 'staff-1', rateCode: 'STANDARD_REAL_SCENE',
      sourceHash, visualPlanHash: planHash, idempotencyKey: 'quote-no-rate', expiresAt: new Date(Date.now() + 20 * 60_000),
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reserves a confirmed quote exactly once and moves credits from available to reserved', async () => {
    const { service, tx } = build();
    tx.visualCreditQuote.findFirst.mockResolvedValue(quote());

    const result = await service.confirmAndReserve({ principal, ...owner, externalObjectId: 'product-1', actorId: 'staff-1', quoteId: 'quote-1' });

    expect(result).toMatchObject({ quote: { status: VisualCreditQuoteStatus.RESERVED }, account: { availableCredits: 185, reservedCredits: 15 }, ledger: { type: 'RESERVE' } });
    expect(tx.visualCreditAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ availableCredits: 185, reservedCredits: 15 }),
    }));
  });

  it('does not freeze credits when the account has insufficient available balance', async () => {
    const { service, tx } = build();
    tx.visualCreditQuote.findFirst.mockResolvedValue(quote({ billingAccount: account({ availableCredits: 14 }) }));

    await expect(service.confirmAndReserve({ principal, ...owner, externalObjectId: 'product-1', actorId: 'staff-1', quoteId: 'quote-1' }))
      .rejects.toThrow('图片额度不足');
    expect(tx.visualCreditAccount.update).not.toHaveBeenCalled();
  });

  it('expires only an unconfirmed quote and never releases a potentially submitted reservation', async () => {
    const { service, prisma } = build();
    prisma.visualCreditQuote.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.expireIssuedQuotes()).resolves.toEqual({ count: 2 });
    expect(prisma.visualCreditQuote.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: VisualCreditQuoteStatus.ISSUED, expiresAt: { lte: expect.any(Date) } },
      data: { status: VisualCreditQuoteStatus.EXPIRED, failureReason: 'QUOTE_EXPIRED' },
    }));
  });

  it('allows an audited platform adjustment but never lets it make a credit account negative', async () => {
    const { service, tx } = build();
    tx.visualCreditAccount.update.mockResolvedValue(account({ availableCredits: 250, version: 1 }));
    tx.visualCreditLedger.create.mockResolvedValue({
      id: 'ledger-adjust', type: 'ADMIN_ADJUST', availableDelta: 50, reservedDelta: 0,
      availableBalanceAfter: 250, reservedBalanceAfter: 0, createdAt: now,
    });

    await expect(service.adminAdjust({
      tenantId: principal.tenantId, ...owner, availableDelta: 50,
      reason: '首批人工补发额度', idempotencyKey: 'admin-adjust-1', operatorId: 'admin-1',
    })).resolves.toMatchObject({ account: { availableCredits: 250 }, ledger: { type: 'ADMIN_ADJUST', availableDelta: 50 } });

    tx.visualCreditAccount.upsert.mockResolvedValue(account({ availableCredits: 10 }));
    await expect(service.adminAdjust({
      tenantId: principal.tenantId, ...owner, availableDelta: -11,
      reason: '错误回收', idempotencyKey: 'admin-adjust-2', operatorId: 'admin-1',
    })).rejects.toThrow('图片额度不足');
  });

  it('keeps pagination outside the account composite key when reading ledger history', async () => {
    const { service, prisma } = build();
    prisma.visualCreditAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    prisma.visualCreditLedger.findMany.mockResolvedValue([{
      id: 'ledger-1', type: 'WELCOME_GRANT', availableDelta: 200, reservedDelta: 0,
      availableBalanceAfter: 200, reservedBalanceAfter: 0, createdAt: now,
    }]);

    await expect(service.listLedger({ tenantId: principal.tenantId, ...owner, take: 10 }))
      .resolves.toMatchObject([{ id: 'ledger-1', type: 'WELCOME_GRANT' }]);
    expect(prisma.visualCreditAccount.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_billingOwnerType_billingOwnerId: {
          tenantId: principal.tenantId,
          billingOwnerType: 'COMPANY',
          billingOwnerId: 'company-1',
        },
      },
      select: { id: true },
    });
  });

  it('settles a billed success and releases a known-unbilled failure without a duplicate debit', async () => {
    const { service, tx } = build();
    tx.visualCreditQuote.findUnique.mockResolvedValue(quote({
      status: VisualCreditQuoteStatus.RESERVED,
      billingAccount: account({ availableCredits: 185, reservedCredits: 15 }),
    }));
    tx.visualCreditAccount.update.mockResolvedValue(account({ availableCredits: 185, reservedCredits: 0, version: 2 }));
    tx.visualCreditQuote.update.mockImplementation(async ({ data }: any) => quote({ ...data }));
    tx.visualCreditLedger.create.mockResolvedValue({
      id: 'ledger-settle', type: 'SETTLE', availableDelta: 0, reservedDelta: -15,
      availableBalanceAfter: 185, reservedBalanceAfter: 0, createdAt: now,
    });

    const settled = await service.settleReservedQuote('quote-1');
    expect(settled).toMatchObject({ quote: { status: VisualCreditQuoteStatus.SETTLED }, account: { availableCredits: 185, reservedCredits: 0 }, ledger: { type: 'SETTLE' } });

    tx.visualCreditQuote.findUnique.mockResolvedValue(quote({
      status: VisualCreditQuoteStatus.RECONCILING,
      billingAccount: account({ availableCredits: 185, reservedCredits: 15 }),
    }));
    tx.visualCreditAccount.update.mockResolvedValue(account({ availableCredits: 200, reservedCredits: 0, version: 3 }));
    tx.visualCreditLedger.create.mockResolvedValue({
      id: 'ledger-release', type: 'RELEASE', availableDelta: 15, reservedDelta: -15,
      availableBalanceAfter: 200, reservedBalanceAfter: 0, createdAt: now,
    });
    const released = await service.releaseReservedQuote('quote-1');
    expect(released).toMatchObject({ quote: { status: VisualCreditQuoteStatus.RELEASED }, account: { availableCredits: 200, reservedCredits: 0 }, ledger: { type: 'RELEASE' } });
  });
});
