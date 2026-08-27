import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ProductVisualMode, ProductVisualRiskProfile } from '@prisma/client';
import {
  AimaiProductVisualAdapterService,
  AIMAI_VISUAL_ADAPTER_TYPE,
  AIMAI_VISUAL_CLIENT_ID,
} from './aimai-product-visual-adapter.service';

const principal = {
  tenantId: 'aimai-product-agent', clientId: AIMAI_VISUAL_CLIENT_ID, adapterNamespace: 'aimai-product',
  allowedAdapterTypes: [AIMAI_VISUAL_ADAPTER_TYPE], keyId: 'internal:aimai-product-adapter-v1',
};

function build() {
  const plan = {
    id: 'plan-1', sourceHash: 'a'.repeat(64), riskProfile: ProductVisualRiskProfile.STANDARD_FACTS,
    allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO],
    protectedRegionVersion: 'mask-v1',
  };
  const prisma = {
    productVisualPlan: { findFirst: jest.fn().mockResolvedValue(plan) },
    sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'asset-1', canonicalSha256: 'a'.repeat(64) }) },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }) },
  };
  const clients = { resolveInternalClientPrincipal: jest.fn().mockResolvedValue(principal) };
  const trusted = {
    issueQuoteFromTrustedAdapter: jest.fn().mockResolvedValue({ id: 'quote-1', quoteHash: 'q'.repeat(64), creditCost: 15 }),
    confirmQuoteFromTrustedAdapter: jest.fn().mockResolvedValue({ quote: { id: 'quote-1', status: 'RESERVED' } }),
  };
  const credits = { getAccount: jest.fn().mockResolvedValue({ availableCredits: 200, reservedCredits: 0, exists: true }) };
  return {
    service: new AimaiProductVisualAdapterService(prisma as any, clients as any, trusted as any, credits as any),
    prisma, clients, trusted, credits,
  };
}

describe('AimaiProductVisualAdapterService', () => {
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

  it('refuses a quote if the exact managed source is no longer attached to the product', async () => {
    const { service, prisma, trusted } = build();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.issueQuote(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(trusted.issueQuoteFromTrustedAdapter).not.toHaveBeenCalled();
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
});
