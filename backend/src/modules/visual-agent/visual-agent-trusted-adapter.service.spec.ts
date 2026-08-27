import { ForbiddenException } from '@nestjs/common';
import { VisualAgentTrustedAdapterService } from './visual-agent-trusted-adapter.service';

describe('VisualAgentTrustedAdapterService', () => {
  const principal = {
    tenantId: 'restaurant-tenant', clientId: 'restaurant-client', adapterNamespace: 'restaurant-menu',
    allowedAdapterTypes: ['restaurant-menu-v1'], keyId: 'key-1',
  };
  const input = {
    principal, adapterType: 'restaurant-menu-v1', externalObjectId: 'dish-1', actorId: 'operator-1',
    provider: 'BAILIAN_WAN', model: 'wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE',
    sourceHash: 'a'.repeat(64), visualPlanHash: 'b'.repeat(64), idempotencyKey: 'reserve-1',
    expiresAt: new Date(Date.now() + 60_000),
  };

  it('derives every Core ownership scope from the authenticated Client principal', async () => {
    const clientKeys = { assertAdapterAccess: jest.fn() };
    const invocations = { reserve: jest.fn().mockResolvedValue({ invocationId: 'invocation-1', status: 'RESERVED' }) };
    const service = new VisualAgentTrustedAdapterService(clientKeys as any, invocations as any, {} as any);

    await expect(service.reserveFromTrustedAdapter(input)).resolves.toEqual({ invocationId: 'invocation-1', status: 'RESERVED' });
    expect(clientKeys.assertAdapterAccess).toHaveBeenCalledWith(principal, 'restaurant-menu-v1');
    expect(invocations.reserve).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'restaurant-tenant', ownerClientId: 'restaurant-client', adapterNamespace: 'restaurant-menu',
      externalObjectId: 'dish-1', actorId: 'operator-1',
    }));
  });

  it('does not reserve when the Client is not allowlisted for the Adapter', async () => {
    const clientKeys = { assertAdapterAccess: jest.fn(() => { throw new ForbiddenException(); }) };
    const invocations = { reserve: jest.fn() };
    const service = new VisualAgentTrustedAdapterService(clientKeys as any, invocations as any, {} as any);

    expect(() => service.reserveFromTrustedAdapter({ ...input, adapterType: 'aimai-product-v1' })).toThrow(ForbiddenException);
    expect(invocations.reserve).not.toHaveBeenCalled();
  });

  it('binds a quote and confirmation to the same authenticated Client and Adapter scope', async () => {
    const clientKeys = { assertAdapterAccess: jest.fn() };
    const invocations = { reserve: jest.fn() };
    const credits = {
      issueQuote: jest.fn().mockResolvedValue({ id: 'quote-1', creditCost: 15 }),
      confirmAndReserve: jest.fn().mockResolvedValue({ quote: { id: 'quote-1', status: 'RESERVED' } }),
    };
    const service = new VisualAgentTrustedAdapterService(clientKeys as any, invocations as any, credits as any);
    const common = {
      principal, adapterType: 'restaurant-menu-v1', billingOwner: { billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1' },
      externalObjectId: 'dish-1', actorId: 'operator-1',
    };

    await expect(service.issueQuoteFromTrustedAdapter({
      ...common, rateCode: 'STANDARD_REAL_SCENE', sourceHash: 'a'.repeat(64), visualPlanHash: 'b'.repeat(64),
      visualPlan: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', protectedRegionVersion: 'mask-v1', allowedOperations: ['LIGHTING'] },
      idempotencyKey: 'quote-1', expiresAt: new Date(Date.now() + 60_000),
    })).resolves.toMatchObject({ id: 'quote-1', creditCost: 15 });
    await expect(service.confirmQuoteFromTrustedAdapter({ ...common, quoteId: 'quote-1' }))
      .resolves.toMatchObject({ quote: { status: 'RESERVED' } });
    expect(credits.issueQuote).toHaveBeenCalledWith(expect.objectContaining({
      principal, billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1',
    }));
    expect(credits.confirmAndReserve).toHaveBeenCalledWith(expect.objectContaining({
      principal, externalObjectId: 'dish-1', actorId: 'operator-1',
    }));
  });
});
