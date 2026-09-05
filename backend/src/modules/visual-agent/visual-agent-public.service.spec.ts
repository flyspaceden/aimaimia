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

function verification(overrides: Record<string, unknown> = {}) {
  return {
    version: 'visual-agent-candidate-verification-v2', stage: 'CHECKS_RUN', disposition: 'MANUAL_REVIEW',
    geometry: { aspectRatioDelta: 0, verdict: 'PASS' },
    qr: { sourceCount: 0, candidateCount: 0, verdict: 'PASS' },
    barcode: { sourceStatus: 'INCONCLUSIVE', candidateStatus: 'INCONCLUSIVE', sourceFormats: [], candidateFormats: [], verdict: 'MANUAL_REVIEW' },
    ocr: { state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW', sourceTextDetected: null, candidateTextDetected: null, sourceTextLength: null, candidateTextLength: null, normalizedTextMatch: null },
    structure: { state: 'DISABLED', report: null, invocationId: null },
    ...overrides,
  };
}

function legacyVerification() {
  return {
    version: 'visual-agent-candidate-verification-v1', disposition: 'MANUAL_REVIEW',
    geometry: { aspectRatioDelta: 0, verdict: 'PASS' },
    qr: { sourceCount: 0, candidateCount: 0, verdict: 'PASS' },
    barcode: { sourceStatus: 'INCONCLUSIVE', candidateStatus: 'INCONCLUSIVE', sourceFormats: [], candidateFormats: [], verdict: 'MANUAL_REVIEW' },
    ocr: { state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW', sourceTextDetected: null, candidateTextDetected: null, sourceTextLength: null, candidateTextLength: null, normalizedTextMatch: null },
  };
}

function build() {
  const prisma = {
    visualAgentInvocation: { findUnique: jest.fn() },
    visualCreditQuote: { findFirst: jest.fn(), findUnique: jest.fn() },
    visualAgentAsset: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(asset()), create: jest.fn().mockImplementation(({ data }) => ({ id: 'asset-1', status: 'AVAILABLE', ...data })) },
    visualAgentPlan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => ({ id: 'plan-1', ...data })) },
    visualAgentCandidate: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'candidate-1', updatedAt: new Date(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
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
  const invocations = { completeSynchronousVerification: jest.fn(), moveVerificationToReconciliation: jest.fn(), releaseBeforeSubmit: jest.fn() };
  const config = { get: jest.fn((key: string) => key === 'AI_VISUAL_AGENT_ADAPTER_EVIDENCE_SECRET_EXTERNALCLIENT_KEY1' ? secret : undefined) };
  const verificationService = { verify: jest.fn().mockResolvedValue(verification()) };
  const managedOutputs = {
    normalize: jest.fn().mockImplementation(async (output) => ({
      buffer: output.buffer,
      mimeType: output.mimeType,
      audit: { version: 'visual-agent-managed-output-v1', normalization: 'provider-png-preserved-v1' },
    })),
  };
  return { service: new VisualAgentPublicService(prisma as any, upload as any, credits as any, execution as any, invocations as any, config as any, verificationService as any, managedOutputs as any), prisma, upload, credits, execution, invocations, verification: verificationService, managedOutputs };
}

describe('VisualAgentPublicService', () => {
  it.each(['CANCELLED', 'RELEASED', 'EXPIRED'])('finishes a %s task without provider or billing work', async (status) => {
    const { service, prisma, execution, credits } = build();
    await expect(service.advanceConfirmedTask({ id: 'quote-1', ...principal, status } as any)).resolves.toEqual({ done: true });
    expect(prisma.visualAgentInvocation.findUnique).not.toHaveBeenCalled();
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
    expect(execution.pollForOutput).not.toHaveBeenCalled();
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });
  it.each(['SUBMITTING', 'RECONCILING'])('does not resubmit %s without a provider task ID', async (status) => {
    const { service, prisma, execution, credits } = build();
    prisma.visualAgentInvocation.findUnique.mockResolvedValue({ id: 'invocation-1', status, providerTaskId: null });
    await expect(service.advanceConfirmedTask({ id: 'quote-1', ...principal, visualAgentInvocationId: 'invocation-1', status: 'RESERVED' } as any))
      .resolves.toMatchObject({ done: false, retryAfterMs: 300_000 });
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });

  it('releases a crash-before-submit reservation rather than leaving it pending or resubmitting', async () => {
    const { service, prisma, execution, credits, invocations } = build();
    prisma.visualAgentInvocation.findUnique.mockResolvedValue({ id: 'invocation-1', status: 'RESERVED', providerTaskId: null });
    await expect(service.advanceConfirmedTask({ id: 'quote-1', ...principal, visualAgentInvocationId: 'invocation-1', status: 'RESERVED' } as any)).resolves.toEqual({ done: true });
    expect(invocations.releaseBeforeSubmit).toHaveBeenCalledWith('invocation-1', 'WORKER_RECOVERY_NOT_SUBMITTED');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'WORKER_RECOVERY_NOT_SUBMITTED');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });

  it('does not release credits if submit won the invocation CAS during recovery', async () => {
    const { service, prisma, credits, invocations } = build();
    prisma.visualAgentInvocation.findUnique.mockResolvedValue({ id: 'invocation-1', status: 'RESERVED', providerTaskId: null });
    invocations.releaseBeforeSubmit.mockRejectedValue(new ConflictException('already submitting'));
    await expect(service.advanceConfirmedTask({ id: 'quote-1', ...principal, visualAgentInvocationId: 'invocation-1', status: 'RESERVED' } as any)).rejects.toThrow('already submitting');
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });
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

  it('accepts only a finite HMAC-bound structure focus and persists it with the scoped asset facts', async () => {
    const { service, prisma, upload } = build();
    const envelope = evidence({ factPolicy: { menuPriceProtected: true, structureFocus: 'WATCH_STRUCTURE' } });
    const file = { buffer: source, size: source.length, mimetype: 'image/jpeg', originalname: 'watch.jpg' } as Express.Multer.File;
    await service.createAsset({ principal, evidenceJson: JSON.stringify(envelope), signature: signedEvidence(envelope), file });
    expect(prisma.visualAgentAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ factPolicy: expect.objectContaining({ structureFocus: 'WATCH_STRUCTURE' }) }),
    }));

    const invalid = evidence({ nonce: 'evidence-2', factPolicy: { structureFocus: 'FREE_TEXT' } });
    await expect(service.createAsset({ principal, evidenceJson: JSON.stringify(invalid), signature: signedEvidence(invalid), file })).rejects.toThrow('焦点无效');
    expect(upload.uploadFile).toHaveBeenCalledTimes(1);
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
      visualPlan: expect.objectContaining({ structureFocus: 'GENERAL_PRODUCT' }),
    }));
  });

  it('records an external adoption intent but never publishes an image from Core', async () => {
    const { service, prisma } = build();
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({ id: 'candidate-1', status: 'PENDING_REVIEW', verificationSummary: legacyVerification(), plan: { externalObjectVersion: 'menu-v3' }, quote: { status: 'SETTLED' } });
    prisma.visualAgentCandidate.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.recordAdoptIntent({ principal, quoteId: 'quote-1', externalObjectVersion: 'menu-v3', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true })).resolves.toEqual({
      candidateId: 'candidate-1', status: 'ADOPT_INTENT', publication: 'EXTERNAL_ADAPTER_MUST_APPLY_EXPLICITLY',
    });
    expect(prisma.visualAgentCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ADOPT_INTENT' }) }));
  });

  it('queues confirmation without source or provider I/O; worker handles later source failure', async () => {
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

    await expect(service.confirmTask({ principal, quoteId: 'quote-1', quoteHash: 'q'.repeat(64) })).resolves.toMatchObject({ execution: { quoteId: 'quote-1', status: 'QUEUED' } });
    expect(upload.getBuffer).not.toHaveBeenCalled();
    credits.getReservedQuoteForExecution.mockResolvedValue({ id: 'quote-1', status: 'RESERVED', sourceAssetRef: 'asset-1', visualPlanSnapshot: {
      direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1',
    } });
    await expect(service.advanceConfirmedTask({ id: 'quote-1', ...principal, status: 'RESERVED' } as any)).rejects.toThrow('source unavailable');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'SOURCE_PREPARATION_FAILED_BEFORE_PROVIDER_SUBMIT');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });

  it('idempotently completes and settles a persisted candidate before exposing it', async () => {
    const { service, prisma, credits, invocations } = build();
    credits.getQuoteForClient.mockResolvedValue({ quote: { id: 'quote-1', status: 'RECONCILING' } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({
      id: 'candidate-1', status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png', mimeType: 'image/png',
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', width: 800, height: 800,
      verificationSummary: verification(),
    });

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({ quoteId: 'quote-1', status: 'PENDING_REVIEW', candidate: { id: 'candidate-1' } });
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_WAN');
    expect(credits.settleReservedQuote).toHaveBeenCalledWith('quote-1', expect.any(String));
  });

  it('requires a Client-scoped signed-asset binding before it can read a tenant-level credit account', async () => {
    const { service, prisma, credits } = build();
    await expect(service.getCredits(principal, 'RESTAURANT', 'restaurant-1')).resolves.toMatchObject({ availableCredits: 200 });
    expect(prisma.visualAgentAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, billingOwnerId: 'restaurant-1' }),
    }));
    expect(credits.getAccount).toHaveBeenCalledWith({ tenantId: principal.tenantId, billingOwnerType: 'RESTAURANT', billingOwnerId: 'restaurant-1' });
  });

  it('recovers output after plan expiry without exposing the model route', async () => {
    const { service, prisma, upload, credits, execution, invocations, verification } = build();
    const plan = {
      id: 'plan-1', assetId: 'asset-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedDirection: 'PRESERVE_REAL_SCENE',
      allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', planHash: 'b'.repeat(64), expiresAt: new Date(Date.now() - 10 * 60_000),
    };
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', sourceAssetRef: 'asset-1', visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1' } },
    });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue(null);
    prisma.visualAgentPlan.findFirst.mockResolvedValue(plan);
    prisma.visualAgentCandidate.create.mockImplementation(async ({ data }) => ({ id: 'candidate-1', updatedAt: new Date(), ...data }));
    execution.pollForOutput.mockResolvedValue({ quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_QWEN_IMAGE', status: 'VERIFYING', output: { buffer: Buffer.from('provider-output'), mimeType: 'image/png' } });
    upload.uploadFile.mockResolvedValueOnce({ key: 'visual-agent-assets/candidate.png', canonicalSha256: 'b'.repeat(64), mimeType: 'image/png', size: 200, width: 800, height: 800, needsReview: false, contactInfoDetected: false });

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({ quoteId: 'quote-1', status: 'PENDING_REVIEW', candidate: { id: 'candidate-1' } });
    expect(prisma.visualAgentPlan.findFirst.mock.calls[0][0].where).not.toHaveProperty('expiresAt');
    expect(upload.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ mimetype: 'image/png' }), 'visual-agent-assets', { preserveQrCodes: true, preserveProviderOutput: true });
    expect(verification.verify).toHaveBeenCalledWith(expect.objectContaining({ verificationId: 'quote-1', allowAutoPass: false }));
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_QWEN_IMAGE');
    expect(credits.settleReservedQuote).toHaveBeenCalledWith('quote-1', expect.any(String));
  });

  it('stores a managed output but leaves the parent task, quote and candidate unavailable while structure is PENDING', async () => {
    const { service, prisma, upload, credits, execution, invocations, verification: verifier } = build();
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', status: 'RESERVED', sourceAssetRef: 'asset-1',
        visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', structureFocus: 'GENERAL_PRODUCT' },
        rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: false } },
    });
    prisma.visualAgentCandidate.findFirst.mockResolvedValueOnce(null);
    prisma.visualAgentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', actorId: 'operator-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedDirection: 'PRESERVE_REAL_SCENE',
      allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', factPolicy: { structureFocus: 'GENERAL_PRODUCT' }, planHash: 'b'.repeat(64), expiresAt: new Date(),
    });
    execution.pollForOutput.mockResolvedValue({ quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_WAN', status: 'VERIFYING', output: { buffer: Buffer.from('provider-output'), mimeType: 'image/png' } });
    upload.getBuffer.mockResolvedValue(Buffer.from('source'));
    upload.uploadFile.mockResolvedValueOnce({ key: 'visual-agent-assets/candidate.png', canonicalSha256: 'b'.repeat(64), mimeType: 'image/png', size: 200, width: 800, height: 800 });
    verifier.verify.mockResolvedValue(verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }));

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toEqual({ quoteId: 'quote-1', invocationId: 'invocation-1', status: 'VERIFYING', candidate: null });
    expect(prisma.visualAgentCandidate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ verificationSummary: expect.objectContaining({ disposition: 'PENDING' }) }) }));
    expect(upload.uploadFile.mock.invocationCallOrder[0]).toBeLessThan(verifier.verify.mock.invocationCallOrder[0]);
    expect(upload.getBuffer).toHaveBeenCalledWith('visual-agent-assets/candidate.png');
    expect(invocations.completeSynchronousVerification).not.toHaveBeenCalled();
    expect(credits.settleReservedQuote).not.toHaveBeenCalled();
  });

  it('does not expose a v2 PENDING candidate after an external operator settled the parent quote', async () => {
    const { service, prisma, upload, credits, invocations, verification: verifier } = build();
    const pending = {
      id: 'candidate-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
      status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png', mimeType: 'image/png', width: 800, height: 800,
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', updatedAt: new Date(),
      verificationSummary: verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }),
    };
    credits.getQuoteForClient.mockResolvedValue({ quote: {
      id: 'quote-1', status: 'SETTLED', sourceAssetRef: 'asset-1',
      visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', structureFocus: 'GENERAL_PRODUCT' },
      rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: false },
    } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue(pending);
    prisma.visualAgentPlan.findFirst.mockResolvedValue({ id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', actorId: 'operator-1' });
    upload.getBuffer.mockResolvedValue(Buffer.from('managed-image'));
    verifier.verify.mockResolvedValue(verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }));

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toEqual({ quoteId: 'quote-1', invocationId: 'invocation-1', status: 'VERIFYING', candidate: null });
    expect(upload.createPrivateAccessUrl).not.toHaveBeenCalled();
    expect(invocations.completeSynchronousVerification).not.toHaveBeenCalled();
    expect(credits.settleReservedQuote).not.toHaveBeenCalled();
  });

  it('hides a settled v2 PENDING candidate from getTask and rejects its adoption intent', async () => {
    const { service, prisma, credits, upload } = build();
    const pendingSummary = verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } });
    credits.getQuoteForClient.mockResolvedValue({ quote: { id: 'quote-1', status: 'SETTLED' }, billingAccount: {} });
    prisma.visualAgentCandidate.findFirst
      .mockResolvedValueOnce({ id: 'candidate-1', status: 'PENDING_REVIEW', verificationSummary: pendingSummary })
      .mockResolvedValueOnce({ id: 'candidate-1', status: 'PENDING_REVIEW', verificationSummary: pendingSummary,
        plan: { externalObjectVersion: 'menu-v3' }, quote: { status: 'SETTLED' } });
    prisma.visualCreditQuote.findFirst.mockResolvedValue({ visualAgentInvocation: { status: 'SUCCEEDED' } });

    await expect(service.getTask(principal, 'quote-1')).resolves.toMatchObject({ status: 'VERIFYING', candidate: null });
    await expect(service.recordAdoptIntent({ principal, quoteId: 'quote-1', externalObjectVersion: 'menu-v3', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true })).rejects.toThrow('不能记录采用意图');
    expect(upload.createPrivateAccessUrl).not.toHaveBeenCalled();
    expect(prisma.visualAgentCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('keeps an explicitly finite legacy v1 candidate readable after historical settlement', async () => {
    const { service, prisma, credits, verification: verifier } = build();
    credits.getQuoteForClient.mockResolvedValue({ quote: { id: 'quote-legacy', status: 'SETTLED' } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({
      id: 'candidate-legacy', status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/legacy.png', mimeType: 'image/png', width: 800, height: 800,
      verificationSummary: legacyVerification(),
    });
    await expect(service.pollTask({ principal, quoteId: 'quote-legacy' })).resolves.toMatchObject({ status: 'PENDING_REVIEW', candidate: { id: 'candidate-legacy' } });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('does not treat a damaged or unknown settled summary as a legacy terminal contract', async () => {
    const { service, prisma, upload, credits, verification: verifier } = build();
    credits.getQuoteForClient.mockResolvedValue({ quote: {
      id: 'quote-bad', status: 'SETTLED', sourceAssetRef: 'asset-1',
      visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', structureFocus: 'GENERAL_PRODUCT' },
      rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: true },
    } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue({
      id: 'candidate-bad', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
      status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/bad.png', invocationId: 'invocation-1', provider: 'BAILIAN_WAN',
      verificationSummary: { version: 'visual-agent-candidate-verification-v1', disposition: 'MANUAL_REVIEW' }, updatedAt: new Date(),
    });
    prisma.visualAgentPlan.findFirst.mockResolvedValue({ id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', actorId: 'operator-1' });
    upload.getBuffer.mockResolvedValue(Buffer.from('managed-image'));
    verifier.verify.mockResolvedValue(verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }));

    await expect(service.pollTask({ principal, quoteId: 'quote-bad' })).resolves.toMatchObject({ status: 'VERIFYING', candidate: null });
    expect(upload.createPrivateAccessUrl).not.toHaveBeenCalled();
  });

  it('replays a pending managed candidate to a known FAIL and settles the generation quote only once', async () => {
    const { service, prisma, upload, credits, invocations, verification: verifier } = build();
    const pendingCandidate = {
      id: 'candidate-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
      status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png', mimeType: 'image/png', width: 800, height: 800,
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', updatedAt: new Date('2026-09-04T00:00:00Z'),
      verificationSummary: verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }),
    };
    credits.getQuoteForClient.mockResolvedValue({ quote: {
      id: 'quote-1', status: 'RESERVED', sourceAssetRef: 'asset-1',
      visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', structureFocus: 'GENERAL_PRODUCT' },
      rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: false },
    } });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue(pendingCandidate);
    prisma.visualAgentPlan.findFirst.mockResolvedValue({ id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', actorId: 'operator-1' });
    upload.getBuffer.mockResolvedValue(Buffer.from('managed-image'));
    verifier.verify.mockResolvedValue(verification({
      disposition: 'REJECT',
      structure: { state: 'FAIL', invocationId: 'structure-1', report: { version: 'product-structure-compare-v1', scope: 'VISUAL_STRUCTURE', verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'] } },
    }));

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({ status: 'REJECTED', candidate: { status: 'REJECTED' } });
    expect(prisma.visualAgentCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledTimes(1);
    expect(credits.settleReservedQuote).toHaveBeenCalledTimes(1);
  });

  it('lets a concurrent cached FAIL dominate UNKNOWN and records only one generation-fee settlement', async () => {
    const { service, prisma, upload, credits, verification: verifier } = build();
    let row: any = {
      id: 'candidate-1', tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
      status: 'PENDING_REVIEW', objectKey: 'visual-agent-assets/candidate.png', mimeType: 'image/png', width: 800, height: 800,
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', updatedAt: new Date('2026-09-04T00:00:00Z'),
      verificationSummary: verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } }),
    };
    const quoteRow = {
      id: 'quote-1', status: 'RESERVED', sourceAssetRef: 'asset-1',
      visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', structureFocus: 'GENERAL_PRODUCT' },
      rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: false },
    };
    credits.getQuoteForClient.mockResolvedValue({ quote: quoteRow });
    prisma.visualAgentCandidate.findFirst.mockImplementation(async () => ({ ...row }));
    prisma.visualAgentCandidate.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.status !== row.status || (where.updatedAt && where.updatedAt.getTime() !== row.updatedAt.getTime())) return { count: 0 };
      row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) };
      return { count: 1 };
    });
    prisma.visualAgentPlan.findFirst.mockResolvedValue({ id: 'plan-1', assetId: 'asset-1', externalObjectId: 'menu-item-1', actorId: 'operator-1' });
    upload.getBuffer.mockResolvedValue(Buffer.from('managed-image'));
    let releaseUnknown!: () => void;
    const unknownGate = new Promise<void>((resolve) => { releaseUnknown = resolve; });
    verifier.verify
      .mockImplementationOnce(async () => {
        await unknownGate;
        return verification({ disposition: 'PENDING', structure: { state: 'PENDING', report: null, invocationId: 'structure-1' } });
      })
      .mockImplementationOnce(async () => {
        releaseUnknown();
        return verification({ disposition: 'REJECT', structure: {
          state: 'FAIL', invocationId: 'structure-1',
          report: { version: 'product-structure-compare-v1', scope: 'VISUAL_STRUCTURE', verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'] },
        } });
      });
    let settledLedgerEntries = 0;
    let settled = false;
    credits.settleReservedQuote.mockImplementation(async () => {
      if (!settled) { settled = true; settledLedgerEntries += 1; }
      return { status: 'SETTLED' };
    });

    const [first, second] = await Promise.all([
      service.pollTask({ principal, quoteId: 'quote-1' }),
      service.pollTask({ principal, quoteId: 'quote-1' }),
    ]);
    expect([first, second]).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'REJECTED', candidate: expect.objectContaining({ status: 'REJECTED' }) }),
      expect.objectContaining({ status: 'REJECTED', candidate: expect.objectContaining({ status: 'REJECTED' }) }),
    ]));
    expect(row).toMatchObject({ status: 'REJECTED', verificationSummary: { disposition: 'REJECT', structure: { state: 'FAIL' } } });
    expect(settledLedgerEntries).toBe(1);
  });

  it('does not read or settle a task when the Key-scoped quote lookup rejects cross-scope access', async () => {
    const { service, prisma, credits } = build();
    credits.getQuoteForClient.mockRejectedValue(new ConflictException('图片美化报价不存在'));
    await expect(service.pollTask({ principal: { ...principal, clientId: 'other-client' }, quoteId: 'quote-1' })).rejects.toThrow('不存在');
    expect(prisma.visualAgentCandidate.findFirst).not.toHaveBeenCalled();
    expect(credits.settleReservedQuote).not.toHaveBeenCalled();
  });

  it('moves the same Provider invocation and quote into reconciliation when candidate persistence fails', async () => {
    const { service, prisma, upload, credits, execution, invocations } = build();
    credits.getQuoteForClient.mockResolvedValue({
      quote: { id: 'quote-1', sourceAssetRef: 'asset-1', visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS', allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1' } },
    });
    prisma.visualAgentCandidate.findFirst.mockResolvedValue(null);
    prisma.visualAgentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', assetId: 'asset-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedDirection: 'PRESERVE_REAL_SCENE',
      allowedOperations: ['LIGHTING'], protectedRegionVersion: 'menu-facts-v1', planHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    execution.pollForOutput.mockResolvedValue({ quoteId: 'quote-1', invocationId: 'invocation-1', provider: 'BAILIAN_WAN', status: 'VERIFYING', output: { buffer: Buffer.from('provider-output'), mimeType: 'image/png' } });
    upload.uploadFile.mockRejectedValueOnce(new Error('storage failed'));

    await expect(service.pollTask({ principal, quoteId: 'quote-1' })).rejects.toThrow('storage failed');
    expect(invocations.moveVerificationToReconciliation).toHaveBeenCalledWith('invocation-1', 'BAILIAN_WAN', 'PUBLIC_CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED');
    expect(credits.markReconciliation).toHaveBeenCalledWith('quote-1', 'PUBLIC_CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED');
    expect(execution.executeReservedQuote).not.toHaveBeenCalled();
  });
});
