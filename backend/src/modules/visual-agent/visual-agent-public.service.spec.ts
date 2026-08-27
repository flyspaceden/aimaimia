import { ConflictException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { VisualAgentPublicService } from './visual-agent-public.service';

const principal = {
  tenantId: 'tenant-1', clientId: 'externalclient', adapterNamespace: 'restaurant-menu', allowedAdapterTypes: ['restaurant-v1'], keyId: 'key-1',
};
const source = Buffer.from('server-side-source-image');
const secret = 'a'.repeat(40);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    version: 'adapter-evidence-v1', keyId: 'key1', nonce: 'evidence-1', externalObjectId: 'menu-item-1', externalObjectVersion: 'menu-v3', actorId: 'operator-1',
    billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1', sourceSha256: createHash('sha256').update(source).digest('hex'),
    riskProfile: 'CONSERVATIVE_FACTS', allowedDirections: ['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO'], allowedOperations: ['LIGHTING', 'DEGLARE'],
    protectedRegionVersion: 'menu-facts-v1', factPolicy: { menuPriceProtected: true, allergenTextProtected: true },
    issuedAt: new Date(Date.now() - 10_000).toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

function signedEvidence(value: Record<string, unknown>) {
  return createHmac('sha256', secret).update(stableJson(value)).digest('hex');
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
    externalObjectId: 'menu-item-1', externalObjectVersion: 'menu-v3', actorId: 'operator-1', billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1',
    objectKey: 'visual-agent-assets/source.webp', canonicalSha256: 'a'.repeat(64), originalSha256: createHash('sha256').update(source).digest('hex'),
    mimeType: 'image/webp', byteSize: 100, width: 800, height: 800, status: 'AVAILABLE', evidenceNonce: 'evidence-1', evidenceKeyId: 'key1',
    evidenceIssuedAt: new Date(Date.now() - 10_000), evidenceExpiresAt: new Date(Date.now() + 10 * 60_000),
    factPolicy: { menuPriceProtected: true, riskProfile: 'CONSERVATIVE_FACTS', allowedDirections: ['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO'], allowedOperations: ['LIGHTING', 'DEGLARE'], protectedRegionVersion: 'menu-facts-v1' },
    ...overrides,
  };
}

function build() {
  const prisma = {
    visualAgentAsset: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(asset()), create: jest.fn().mockImplementation(({ data }) => ({ id: 'asset-1', status: 'AVAILABLE', ...data })) },
    visualAgentPlan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => ({ id: 'plan-1', ...data })) },
    visualAgentCandidate: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
  };
  const upload = {
    uploadFile: jest.fn().mockResolvedValue({ key: 'visual-agent-assets/source.webp', canonicalSha256: 'a'.repeat(64), mimeType: 'image/webp', size: 100, width: 800, height: 800, needsReview: false, contactInfoDetected: false }),
    deleteFile: jest.fn(), createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://private.example/image', expiresAt: '2026-08-26T12:00:00.000Z' }), getBuffer: jest.fn(),
  };
  const credits = {
    issueQuote: jest.fn().mockResolvedValue({ id: 'quote-1', status: 'ISSUED', creditCost: 15, candidateCount: 1, externalObjectId: 'menu-item-1', quoteHash: 'q'.repeat(64), rateCardSnapshot: { displayName: '标准美化', modelProfile: 'BAILIAN_WAN_STANDARD' } }),
    getAccount: jest.fn().mockResolvedValue({ availableCredits: 200, reservedCredits: 0 }),
    getQuoteForClient: jest.fn(),
    getReservedQuoteForExecution: jest.fn().mockResolvedValue({ id: 'quote-1', status: 'RESERVED', visualAgentInvocationId: null }),
    confirmAndReserve: jest.fn(),
    settleReservedQuote: jest.fn(),
    releaseReservedQuote: jest.fn(),
    markReconciliation: jest.fn(),
  };
  const execution = { executeReservedQuote: jest.fn(), pollForOutput: jest.fn() };
  const invocations = { completeSynchronousVerification: jest.fn() };
  const config = { get: jest.fn((key: string) => key === 'AI_VISUAL_AGENT_ADAPTER_EVIDENCE_SECRET_EXTERNALCLIENT_KEY1' ? secret : undefined) };
  const verification = { verify: jest.fn().mockResolvedValue({ version: 'visual-agent-candidate-verification-v1', disposition: 'MANUAL_REVIEW', geometry: {}, qr: {}, barcode: {}, ocr: {} }) };
  return { service: new VisualAgentPublicService(prisma as any, upload as any, credits as any, execution as any, invocations as any, config as any, verification as any), prisma, upload, credits, execution, invocations, verification };
}

describe('VisualAgentPublicService', () => {
  it('accepts a scoped binary asset only when its separate Adapter Evidence HMAC and source digest both verify', async () => {
    const { service, prisma, upload } = build();
    const envelope = evidence();
    const file = { buffer: source, size: source.length, mimetype: 'image/jpeg', originalname: 'dish.jpg' } as Express.Multer.File;

    await expect(service.createAsset({ principal, evidenceJson: JSON.stringify(envelope), signature: signedEvidence(envelope), file })).resolves.toMatchObject({ id: 'asset-1', preview: { displayUrl: 'https://private.example/image' } });
    expect(upload.uploadFile).toHaveBeenCalledWith(file, 'visual-agent-assets', { preserveQrCodes: true, preserveEvidencePixels: true });
    expect(prisma.visualAgentAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: principal.tenantId, clientId: principal.clientId, externalObjectVersion: 'menu-v3', billingOwnerId: 'restaurant-1' }),
    }));
  });

  it('fails before upload when a Client Key lacks the separately configured Adapter Evidence signature', async () => {
    const { service, upload } = build();
    const envelope = evidence();
    const file = { buffer: source, size: source.length, mimetype: 'image/jpeg', originalname: 'dish.jpg' } as Express.Multer.File;

    await expect(service.createAsset({ principal, evidenceJson: JSON.stringify(envelope), signature: 'b'.repeat(64), file })).rejects.toBeInstanceOf(ConflictException);
    expect(upload.uploadFile).not.toHaveBeenCalled();
  });

  it('derives a short-lived plan and issues only a scoped server-side tariff quote', async () => {
    const { service, credits, prisma } = build();
    const plan = await service.createPlan({ principal, assetId: 'asset-1', requestedDirection: 'PRESERVE_REAL_SCENE' });
    prisma.visualAgentPlan.findFirst.mockResolvedValue({
      id: plan.id, assetId: 'asset-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedDirection: 'PRESERVE_REAL_SCENE',
      allowedDirections: ['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO'], allowedOperations: ['LIGHTING', 'DEGLARE'],
      protectedRegionVersion: 'menu-facts-v1', planHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 10 * 60_000),
      billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1', externalObjectId: 'menu-item-1', actorId: 'operator-1',
    });
    await expect(service.issueQuote({ principal, planId: plan.id, rateCode: 'STANDARD_REAL_SCENE', idempotencyKey: 'quote-1' })).resolves.toMatchObject({ quote: { id: 'quote-1', offer: { displayName: '标准美化' } } });
    expect(credits.issueQuote).toHaveBeenCalledWith(expect.objectContaining({
      principal, billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1', sourceAssetRef: 'asset-1', rateCode: 'STANDARD_REAL_SCENE',
    }));
  });

  it('records an external adoption intent but never publishes an image from Core', async () => {
    const { service, prisma } = build();
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({ id: 'candidate-1', status: 'PENDING_REVIEW', plan: { externalObjectVersion: 'menu-v3' }, quote: { status: 'SETTLED' } });
    prisma.visualAgentCandidate.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.recordAdoptIntent({ principal, quoteId: 'quote-1', externalObjectVersion: 'menu-v3', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true })).resolves.toEqual({
      candidateId: 'candidate-1', status: 'ADOPT_INTENT', publication: 'EXTERNAL_ADAPTER_MUST_APPLY_EXPLICITLY',
    });
    expect(prisma.visualAgentCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ADOPT_INTENT' }) }));
  });

  it('releases frozen credits when source preparation fails before any Provider submission', async () => {
    const { service, prisma, upload, credits, execution } = build();
    credits.getQuoteForClient.mockResolvedValue({
      quote: {
        id: 'quote-1', sourceAssetRef: 'asset-1',
        visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1' },
      },
    });
    credits.confirmAndReserve.mockResolvedValue({ quote: { id: 'quote-1', status: 'RESERVED' }, account: {}, ledger: {} });
    prisma.visualAgentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', externalObjectVersion: 'menu-v3', actorId: 'operator-1',
      billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1', recommendedDirection: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS',
      allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', planHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000),
    });
    upload.getBuffer.mockRejectedValue(new Error('source unavailable'));

    await expect(service.confirmTask({ principal, quoteId: 'quote-1', quoteHash: 'q'.repeat(64) })).rejects.toThrow('source unavailable');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'SOURCE_PREPARATION_FAILED_BEFORE_PROVIDER_SUBMIT');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });

  it('never exposes or adopts a persisted candidate until the associated credit quote is settled', async () => {
    const { service, prisma, credits } = build();
    credits.getQuoteForClient.mockResolvedValue({ quote: { id: 'quote-1', status: 'RECONCILING' } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({ id: 'candidate-1', status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png' });

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toEqual({ quoteId: 'quote-1', status: 'RECONCILING', candidate: null });
  });

  it('requires a Client-scoped signed-asset binding before it can read a tenant-level credit account', async () => {
    const { service, prisma, credits } = build();
    await expect(service.getCredits(principal, 'RESTAURANT', 'restaurant-1')).resolves.toMatchObject({ availableCredits: 200 });
    expect(prisma.visualAgentAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, billingOwnerId: 'restaurant-1' }),
    }));
    expect(credits.getAccount).toHaveBeenCalledWith({ tenantId: principal.tenantId, billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1' });
  });

  it('persists a Provider output privately and returns a review candidate without exposing its model route', async () => {
    const { service, prisma, upload, credits, execution, invocations, verification } = build();
    const plan = {
      id: 'plan-1', assetId: 'asset-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedDirection: 'PRESERVE_REAL_SCENE',
      allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', planHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 10 * 60_000),
    };
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', sourceAssetRef: 'asset-1', visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1' } },
    });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue(null);
    prisma.visualAgentPlan.findFirst.mockResolvedValue(plan);
    prisma.visualAgentCandidate.create.mockResolvedValue({ id: 'candidate-1', status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png', mimeType: 'image/png', width: 800, height: 800, provider: 'BAILIAN_QWEN_IMAGE' });
    execution.pollForOutput.mockResolvedValue({ quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_QWEN_IMAGE', status: 'VERIFYING', output: { buffer: Buffer.from('provider-output'), mimeType: 'image/png' } });
    upload.uploadFile.mockResolvedValueOnce({ key: 'visual-agent-assets/candidate.png', canonicalSha256: 'b'.repeat(64), mimeType: 'image/png', size: 200, width: 800, height: 800, needsReview: false, contactInfoDetected: false });

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({ quoteId: 'quote-1', status: 'PENDING_REVIEW', candidate: { id: 'candidate-1' } });
    expect(upload.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ mimetype: 'image/png' }), 'visual-agent-assets', { preserveQrCodes: true, preserveProviderOutput: true });
    expect(verification.verify).toHaveBeenCalledWith(expect.objectContaining({ verificationId: 'quote-1', allowAutoPass: false }));
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_QWEN_IMAGE');
    expect(credits.settleReservedQuote).toHaveBeenCalledWith('quote-1', expect.any(String));
  });
});
