import { ServiceUnavailableException } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;
import { VisualAgentProviderRunnerService } from './visual-agent-provider-runner.service';

const authorization = {
  invocationId: 'invocation-1', provider: 'BAILIAN_WAN', policySnapshotVersion: 'snapshot-1', reservedCostCents: 20,
  adapterExecutionApproved: true as const, leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000),
};

async function source() {
  return {
    buffer: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffffff' } }).jpeg().toBuffer(),
    mimeType: 'image/jpeg' as const, normalizedVersion: 'normalized-rgba-srgb-v1' as const, opaque: true as const,
  };
}

const visualPlan = {
  templateVersion: 'truth-preserving-v1' as const,
  direction: 'PRESERVE_REAL_SCENE' as const,
  riskProfile: 'CONSERVATIVE_FACTS' as const,
  allowedOperations: ['LIGHTING'] as const,
  protectedRegionVersion: 'protected-v1',
};

describe('VisualAgentProviderRunnerService', () => {
  it('runs all local provider validation before it acquires a budgeted submit lease', async () => {
    const invocations = {
      acquireForSubmit: jest.fn(), recordSubmitOutcome: jest.fn(),
    };
    const bailian = {
      preflight: jest.fn().mockRejectedValue(new ServiceUnavailableException('disabled')),
      submit: jest.fn(),
    };
    const service = new VisualAgentProviderRunnerService(invocations as any, bailian as any);

    await expect(service.submitBailian({ invocationId: 'invocation-1', model: 'wan2.7-image', source: await source(), visualPlan })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(invocations.acquireForSubmit).not.toHaveBeenCalled();
    expect(bailian.submit).not.toHaveBeenCalled();
  });

  it('persists a submit-unknown result before it returns control to any future worker', async () => {
    const invocations = {
      acquireForSubmit: jest.fn().mockResolvedValue(authorization),
      recordSubmitOutcome: jest.fn().mockResolvedValue(undefined),
      releaseBeforeProviderSubmit: jest.fn(),
      providerTaskForQuery: jest.fn(),
      recordQueryOutcome: jest.fn(),
    };
    const bailian = {
      preflight: jest.fn().mockResolvedValue(undefined),
      submit: jest.fn().mockResolvedValue({ kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true }),
    };
    const service = new VisualAgentProviderRunnerService(invocations as any, bailian as any);

    await expect(service.submitBailian({ invocationId: 'invocation-1', model: 'wan2.7-image', source: await source(), visualPlan })).resolves.toEqual({
      kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true,
    });
    expect(invocations.recordSubmitOutcome).toHaveBeenCalledWith(authorization, expect.objectContaining({ kind: 'UNKNOWN' }));
    expect(invocations.releaseBeforeProviderSubmit).not.toHaveBeenCalled();
  });

  it('keeps even an unexpected provider exception in reconciliation instead of assuming no charge', async () => {
    const invocations = {
      acquireForSubmit: jest.fn().mockResolvedValue(authorization),
      recordSubmitOutcome: jest.fn().mockResolvedValue(undefined),
      releaseBeforeProviderSubmit: jest.fn(),
    };
    const bailian = {
      preflight: jest.fn().mockResolvedValue(undefined),
      submit: jest.fn().mockRejectedValue(new ServiceUnavailableException('unexpected provider exception')),
    };
    const service = new VisualAgentProviderRunnerService(invocations as any, bailian as any);

    await expect(service.submitBailian({ invocationId: 'invocation-1', model: 'wan2.7-image', source: await source(), visualPlan })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(invocations.recordSubmitOutcome).toHaveBeenCalledWith(authorization, {
      kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
    });
    expect(invocations.releaseBeforeProviderSubmit).not.toHaveBeenCalled();
  });

  it('records a query exception as unknown under the same persisted query lease', async () => {
    const queryAuthorization = { ...authorization, providerTaskId: 'provider-task-1' };
    const invocations = {
      acquireForQuery: jest.fn().mockResolvedValue(queryAuthorization),
      recordQueryOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const bailian = { query: jest.fn().mockRejectedValue(new ServiceUnavailableException('provider unavailable')) };
    const service = new VisualAgentProviderRunnerService(invocations as any, bailian as any);

    await expect(service.queryBailian('invocation-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(invocations.recordQueryOutcome).toHaveBeenCalledWith(queryAuthorization, {
      kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
    });
  });

  it('fetches a Provider output only after Core confirms a VERIFYING invocation reference', async () => {
    const invocations = {
      getOutputForVerification: jest.fn().mockResolvedValue({
        id: 'invocation-1', providerOutputUrl: 'https://wanx-v1.oss-cn-beijing.aliyuncs.com/result.jpg',
      }),
    };
    const bailian = { fetchOutput: jest.fn().mockResolvedValue({ buffer: Buffer.from('candidate'), mimeType: 'image/jpeg' }) };
    const service = new VisualAgentProviderRunnerService(invocations as any, bailian as any);

    await expect(service.fetchBailianOutput('invocation-1')).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    expect(invocations.getOutputForVerification).toHaveBeenCalledWith('invocation-1');
    expect(bailian.fetchOutput).toHaveBeenCalledWith('https://wanx-v1.oss-cn-beijing.aliyuncs.com/result.jpg');
  });
});
