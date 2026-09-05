const sharp = require('sharp') as typeof import('sharp').default;
import { BAILIAN_QWEN_OCR_PROVIDER, QWEN_OCR_MODEL } from './providers/bailian-qwen-ocr.provider';
import { VisualAgentOcrRunnerService } from './visual-agent-ocr-runner.service';

async function source() {
  return {
    buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).jpeg().toBuffer(),
    mimeType: 'image/jpeg' as const,
    normalizedVersion: 'normalized-rgba-srgb-v1' as const,
    opaque: true as const,
  };
}

const authorization = {
  invocationId: 'ocr-invocation-1', provider: BAILIAN_QWEN_OCR_PROVIDER,
  policySnapshotVersion: 'policy-v1', reservedCostCents: 1, adapterExecutionApproved: true as const,
  leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000),
};

describe('VisualAgentOcrRunnerService', () => {
  it('preflights and hash-binds an OCR source before it leases a paid invocation', async () => {
    const invocations = {
      acquireForSubmit: jest.fn().mockResolvedValue(authorization),
      recordSynchronousProviderOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const qwenOcr = {
      preflight: jest.fn().mockResolvedValue(undefined),
      recognize: jest.fn().mockResolvedValue({ kind: 'KNOWN', text: 'PRODUCT-123', providerRequestId: 'request-1', usage: { totalTokens: 237 } }),
    };
    const service = new VisualAgentOcrRunnerService(invocations as any, qwenOcr as any);

    await expect(service.recognizeFactScan({ invocationId: 'ocr-invocation-1', source: await source() })).resolves.toMatchObject({
      kind: 'KNOWN', text: 'PRODUCT-123',
    });
    expect(invocations.acquireForSubmit).toHaveBeenCalledWith(
      'ocr-invocation-1', QWEN_OCR_MODEL, BAILIAN_QWEN_OCR_PROVIDER,
      expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/), 'OCR_FACT_SCAN',
    );
    expect(invocations.recordSynchronousProviderOutcome).toHaveBeenCalledWith(authorization, {
      kind: 'KNOWN', providerRequestId: 'request-1', usage: { totalTokens: 237 },
    });
  });

  it('does not reserve or lease an invocation when OCR source preflight is rejected', async () => {
    const invocations = { acquireForSubmit: jest.fn(), recordSynchronousProviderOutcome: jest.fn() };
    const qwenOcr = { preflight: jest.fn().mockRejectedValue(new Error('invalid source')), recognize: jest.fn() };
    const service = new VisualAgentOcrRunnerService(invocations as any, qwenOcr as any);

    await expect(service.recognizeFactScan({ invocationId: 'ocr-invocation-1', source: await source() })).rejects.toThrow('invalid source');
    expect(invocations.acquireForSubmit).not.toHaveBeenCalled();
    expect(qwenOcr.recognize).not.toHaveBeenCalled();
  });

  it('persists an OCR transport failure as reconciliation before surfacing the error', async () => {
    const invocations = {
      acquireForSubmit: jest.fn().mockResolvedValue(authorization),
      recordSynchronousProviderOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const qwenOcr = { preflight: jest.fn().mockResolvedValue(undefined), recognize: jest.fn().mockRejectedValue(new Error('network')) };
    const service = new VisualAgentOcrRunnerService(invocations as any, qwenOcr as any);

    await expect(service.recognizeFactScan({ invocationId: 'ocr-invocation-1', source: await source() })).rejects.toThrow('network');
    expect(invocations.recordSynchronousProviderOutcome).toHaveBeenCalledWith(authorization, {
      kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
    });
  });
});
