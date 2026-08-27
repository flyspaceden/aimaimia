import { ServiceUnavailableException } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;
import { BAILIAN_QWEN_IMAGE_PROVIDER, BailianQwenImageProvider } from './bailian-qwen-image.provider';
import { VisualProviderSubmitInput } from './visual-image-edit.provider';

function config(values: Record<string, string>) {
  return { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
}

function enabledConfig(extra: Record<string, string> = {}) {
  return config({
    AI_VISUAL_AGENT_ENABLED: 'true',
    AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED: 'true',
    AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED: 'true',
    AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: 'ws-workspace1',
    AI_VISUAL_AGENT_BAILIAN_API_KEY: 'test-key',
    AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES: 'oss-cn-beijing.aliyuncs.com',
    ...extra,
  });
}

async function submitInput(overrides: Partial<VisualProviderSubmitInput> = {}): Promise<VisualProviderSubmitInput> {
  const buffer = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#f5f5f5' } }).jpeg().toBuffer();
  return {
    source: { buffer, mimeType: 'image/jpeg', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true },
    visualPlan: {
      templateVersion: 'truth-preserving-v1', direction: 'PRESERVE_REAL_SCENE', riskProfile: 'CONSERVATIVE_FACTS',
      allowedOperations: ['LIGHTING', 'WHITE_BALANCE'], protectedRegionVersion: 'protected-region-v1',
    },
    model: 'qwen-image-3.0',
    authorization: {
      invocationId: 'invocation-1', provider: BAILIAN_QWEN_IMAGE_PROVIDER, policySnapshotVersion: 'policy-v1', reservedCostCents: 25,
      adapterExecutionApproved: true, leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000),
    },
    ...overrides,
  };
}

function invocationVerifier() {
  return { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) };
}

describe('BailianQwenImageProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed until the independent Qwen Image execution switches are enabled', async () => {
    const provider = new BailianQwenImageProvider(config({
      AI_VISUAL_AGENT_ENABLED: 'true', AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: 'ws-workspace1', AI_VISUAL_AGENT_BAILIAN_API_KEY: 'test-key',
    }) as any, invocationVerifier() as any);
    await expect(provider.submit(await submitInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('submits one asynchronous Qwen task with a fixed truth-preserving template and no prompt extension', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      output: { task_id: 'qwen-task-1', task_status: 'PENDING' }, request_id: 'request-1',
    }), { status: 200 })) as any;
    const verifier = invocationVerifier();
    const provider = new BailianQwenImageProvider(enabledConfig() as any, verifier as any);

    await expect(provider.submit(await submitInput())).resolves.toEqual({
      kind: 'ACCEPTED', providerTaskId: 'qwen-task-1', state: 'QUEUED', providerRequestId: 'request-1',
    });
    const request = (global.fetch as jest.Mock).mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(JSON.stringify(body)).toContain('Do not alter, add, remove');
    expect(body.parameters).toMatchObject({ prompt_extend: false, watermark: false, n: 1 });
    expect(JSON.stringify(body)).not.toContain('protected-region-v1');
    expect(verifier.assertProviderAuthorization).toHaveBeenCalledWith(expect.anything(), BAILIAN_QWEN_IMAGE_PROVIDER, 'qwen-image-3.0');
  });

  it('keeps unallowlisted output locations and query ambiguity in reconciliation', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      output: { task_id: 'qwen-task-1', task_status: 'SUCCEEDED', results: [{ url: 'https://attacker.example/result.png' }] }, request_id: 'request-1',
    }), { status: 200 })) as any;
    const provider = new BailianQwenImageProvider(enabledConfig() as any, invocationVerifier() as any);

    await expect(provider.query('qwen-task-1')).resolves.toEqual({
      kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId: 'request-1',
    });
  });

  it('downloads only an allowlisted, decodable PNG output', async () => {
    const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#2288aa' } }).png().toBuffer();
    global.fetch = jest.fn().mockResolvedValue(new Response(image, {
      status: 200, headers: { 'content-type': 'image/png', 'content-length': String(image.length) },
    })) as any;
    const provider = new BailianQwenImageProvider(enabledConfig() as any, invocationVerifier() as any);

    await expect(provider.fetchOutput('https://qwen-image.oss-cn-beijing.aliyuncs.com/result.png')).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(provider.fetchOutput('https://attacker.example/result.png')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
