import { VisualAgentPublicController } from './visual-agent-public.controller';

describe('VisualAgentPublicController', () => {
  it('passes only Key-derived scope and fixed DTO fields to the public service', async () => {
    const visual = { createAsset: jest.fn(), getAsset: jest.fn(), createPlan: jest.fn(), issueQuote: jest.fn(), confirmTask: jest.fn(), pollTask: jest.fn(), getTask: jest.fn(), recordAdoptIntent: jest.fn(), getCredits: jest.fn() };
    const controller = new VisualAgentPublicController(visual as any);
    const principal = { tenantId: 'tenant-1', clientId: 'client-1', adapterNamespace: 'restaurant-menu', allowedAdapterTypes: [], keyId: 'key-1' };
    const request = { visualAgentClient: principal };

    await controller.createPlan(request, { assetId: 'asset-1', requestedDirection: 'PRESERVE_REAL_SCENE' });
    await controller.issueQuote(request, { planId: 'plan-1', rateCode: 'STANDARD', idempotencyKey: 'quote-1' });
    await controller.confirmTask(request, 'quote-1', { quoteHash: 'a'.repeat(64) });
    expect(visual.createPlan).toHaveBeenCalledWith({ principal, assetId: 'asset-1', requestedDirection: 'PRESERVE_REAL_SCENE' });
    expect(visual.issueQuote).toHaveBeenCalledWith({ principal, planId: 'plan-1', rateCode: 'STANDARD', idempotencyKey: 'quote-1' });
    expect(visual.confirmTask).toHaveBeenCalledWith({ principal, quoteId: 'quote-1', quoteHash: 'a'.repeat(64) });
  });
});
