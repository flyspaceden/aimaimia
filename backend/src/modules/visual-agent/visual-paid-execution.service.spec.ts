const sharp = require('sharp') as typeof import('sharp').default;
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { VisualAgentInvocationStatus, VisualCreditQuoteStatus } from '@prisma/client';
import { visualPlanSha256 } from './visual-agent-integrity';
import { VisualPaidExecutionService } from './visual-paid-execution.service';

const principal = {
  tenantId: 'aimai-product-agent', clientId: 'aimai-product-adapter-v1', adapterNamespace: 'aimai-product',
  allowedAdapterTypes: ['aimai-product-v1'], keyId: 'internal:aimai-product-adapter-v1',
};
const plan = {
  templateVersion: 'truth-preserving-v1' as const,
  direction: 'PRESERVE_REAL_SCENE' as const,
  riskProfile: 'STANDARD_FACTS' as const,
  allowedOperations: ['LIGHTING'] as const,
  protectedRegionVersion: 'mask-v1',
};

async function source() {
  const buffer = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#9c805f' } }).jpeg().toBuffer();
  return { buffer, mimeType: 'image/jpeg' as const, normalizedVersion: 'normalized-rgba-srgb-v1' as const, opaque: true as const };
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1', sourceAssetRef: 'asset-1', sourceHash: 'raw-source-hash', visualPlanHash: visualPlanSha256(plan),
    visualPlanSnapshot: {
      direction: plan.direction, riskProfile: plan.riskProfile,
      protectedRegionVersion: plan.protectedRegionVersion, allowedOperations: [...plan.allowedOperations],
    },
    status: VisualCreditQuoteStatus.RESERVED,
    visualAgentInvocationId: null,
    externalObjectId: 'product-1', actorId: 'staff-1',
    rateCard: { modelProfile: 'BAILIAN_WAN_STANDARD' },
    ...overrides,
  };
}

function build(overrides: { quote?: Record<string, unknown> } = {}) {
  const credits = {
    getReservedQuoteForExecution: jest.fn().mockResolvedValue(quote(overrides.quote)),
    releaseReservedQuote: jest.fn().mockResolvedValue({}),
    attachInvocation: jest.fn().mockResolvedValue({}),
    markReconciliation: jest.fn().mockResolvedValue(undefined),
  };
  const invocations = {
    reserve: jest.fn().mockResolvedValue({ invocationId: 'invocation-1', status: VisualAgentInvocationStatus.RESERVED }),
    releaseBeforeSubmit: jest.fn().mockResolvedValue(undefined),
  };
  const runner = {
    submitBailian: jest.fn().mockResolvedValue({ kind: 'ACCEPTED', providerTaskId: 'wan-task-1', state: 'QUEUED' }),
    queryBailian: jest.fn(),
    fetchBailianOutput: jest.fn(),
  };
  const wan = { preflight: jest.fn().mockResolvedValue(undefined) };
  return { service: new VisualPaidExecutionService(credits as any, invocations as any, runner as any, wan as any), credits, invocations, runner, wan };
}

describe('VisualPaidExecutionService', () => {
  it('submits only a reserved quote whose source reference and fixed plan still match', async () => {
    const { service, credits, invocations, runner, wan } = build();
    const result = await service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    });

    expect(result).toEqual({ quoteId: 'quote-1', invocationId: 'invocation-1', providerTaskId: 'wan-task-1', status: 'QUEUED' });
    expect(wan.preflight).toHaveBeenCalled();
    expect(invocations.reserve).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: principal.tenantId, ownerClientId: principal.clientId, provider: 'BAILIAN_WAN', model: 'wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE',
    }));
    expect(credits.attachInvocation).toHaveBeenCalledWith({ principal, quoteId: 'quote-1', invocationId: 'invocation-1' });
    expect(runner.submitBailian).toHaveBeenCalledWith(expect.objectContaining({ invocationId: 'invocation-1', model: 'wan2.7-image' }));
  });

  it('releases a reserved quote before any invocation when local provider preflight is unavailable', async () => {
    const { service, credits, invocations, runner, wan } = build();
    wan.preflight.mockRejectedValue(new ServiceUnavailableException('disabled'));

    await expect(service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'PROVIDER_PREFLIGHT_DECLINED');
    expect(invocations.reserve).not.toHaveBeenCalled();
    expect(runner.submitBailian).not.toHaveBeenCalled();
  });

  it('releases a known Provider rejection but preserves a billing-unknown submission for reconciliation', async () => {
    const declined = build();
    declined.runner.submitBailian.mockResolvedValue({ kind: 'DECLINED', code: 'INVALID_REQUEST' });
    await expect(declined.service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).resolves.toMatchObject({ status: 'RELEASED' });
    expect(declined.credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'PROVIDER_DECLINED:INVALID_REQUEST');

    const unknown = build();
    unknown.runner.submitBailian.mockResolvedValue({ kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true });
    await expect(unknown.service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).resolves.toMatchObject({ status: 'RECONCILING' });
    expect(unknown.credits.markReconciliation).toHaveBeenCalledWith('quote-1', 'PROVIDER_UNKNOWN:TRANSPORT_TIMEOUT');
    expect(unknown.credits.releaseReservedQuote).not.toHaveBeenCalled();
  });

  it('unwinds both Core reservation and merchant credits if quote-to-invocation binding loses a race', async () => {
    const { service, credits, invocations, runner } = build();
    credits.attachInvocation.mockRejectedValue(new ConflictException('quote changed'));
    await expect(service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).rejects.toThrow('quote changed');
    expect(invocations.releaseBeforeSubmit).toHaveBeenCalledWith('invocation-1', 'QUOTE_BIND_FAILED_BEFORE_PROVIDER_SUBMIT');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'QUOTE_BIND_FAILED_BEFORE_PROVIDER_SUBMIT');
    expect(runner.submitBailian).not.toHaveBeenCalled();
  });

  it('does not submit a reconciliation or mismatched-evidence quote again', async () => {
    const reconciling = build({ quote: { status: VisualCreditQuoteStatus.RECONCILING } });
    await expect(reconciling.service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).resolves.toMatchObject({ status: 'RECONCILING', invocationId: null });
    expect(reconciling.runner.submitBailian).not.toHaveBeenCalled();

    const mismatch = build();
    await expect(mismatch.service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-other', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).rejects.toThrow('原图证据已变化');
    expect(mismatch.invocations.reserve).not.toHaveBeenCalled();
  });

  it('releases a quote if its rate card has no configured executable provider', async () => {
    const { service, credits, invocations } = build({ quote: { rateCard: { modelProfile: 'BAILIAN_QWEN_IMAGE' } } });
    await expect(service.executeReservedQuote({
      principal, quoteId: 'quote-1', sourceAssetRef: 'asset-1', sourceCanonicalHash: 'raw-source-hash', source: await source(), visualPlan: plan,
    })).rejects.toThrow('尚未配置可执行');
    expect(credits.releaseReservedQuote).toHaveBeenCalledWith('quote-1', 'PROVIDER_PREFLIGHT_DECLINED');
    expect(invocations.reserve).not.toHaveBeenCalled();
  });

  it('polls a bound task and downloads output only once the Core has recorded success for verification', async () => {
    const { service, credits, runner } = build({ quote: { visualAgentInvocationId: 'invocation-1' } });
    runner.queryBailian.mockResolvedValue({ kind: 'KNOWN', providerTaskId: 'wan-task-1', state: 'SUCCEEDED', outputUrl: 'https://wanx-v1.oss-cn-beijing.aliyuncs.com/result.jpg' });
    runner.fetchBailianOutput.mockResolvedValue({ buffer: Buffer.from('candidate'), mimeType: 'image/jpeg' });

    await expect(service.pollForOutput({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({
      quoteId: 'quote-1', invocationId: 'invocation-1', status: 'VERIFYING', output: { mimeType: 'image/jpeg' },
    });
    expect(runner.fetchBailianOutput).toHaveBeenCalledWith('invocation-1');
    expect(credits.markReconciliation).not.toHaveBeenCalled();
  });

  it('never releases credits after an accepted task has an unknown/failed query result', async () => {
    const { service, credits, runner } = build({ quote: { visualAgentInvocationId: 'invocation-1' } });
    runner.queryBailian.mockResolvedValue({ kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true });

    await expect(service.pollForOutput({ principal, quoteId: 'quote-1' })).resolves.toMatchObject({ status: 'RECONCILING' });
    expect(credits.markReconciliation).toHaveBeenCalledWith('quote-1', 'PROVIDER_QUERY_AMBIGUOUS_PROVIDER_RESPONSE');
    expect(credits.releaseReservedQuote).not.toHaveBeenCalled();
  });
});
