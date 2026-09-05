import { ServiceUnavailableException } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;
import { BailianQwenOcrProvider, QWEN_OCR_MODEL } from './bailian-qwen-ocr.provider';

function config(values: Record<string, string>) {
  return { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
}

function enabledConfig() {
  return config({
    AI_VISUAL_AGENT_ENABLED: 'true',
    AI_VISUAL_AGENT_QWEN_OCR_ENABLED: 'true',
    AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED: 'true',
    AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: 'ws-workspace1',
    AI_VISUAL_AGENT_BAILIAN_API_KEY: 'test-key',
  });
}

async function source() {
  return {
    buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).jpeg().toBuffer(),
    mimeType: 'image/jpeg' as const,
    normalizedVersion: 'normalized-rgba-srgb-v1' as const,
    opaque: true as const,
  };
}

const authorization = {
  invocationId: 'invocation-1', provider: 'BAILIAN_QWEN_OCR', policySnapshotVersion: 'policy-v1', reservedCostCents: 1,
  adapterExecutionApproved: true as const, leaseToken: 'lease-1', leaseGeneration: 1,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('BailianQwenOcrProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed until all OCR execution flags and credentials are configured', async () => {
    const provider = new BailianQwenOcrProvider(config({}) as any, { assertProviderAuthorization: jest.fn() } as any);

    await expect(provider.recognize(await source(), authorization)).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_FACT_SCAN_OCR_DISABLED',
        message: '商品文字识别服务暂未开启，当前不能检查图片中的商品事实',
      },
    });
  });

  it('uses the fixed OCR model, low pixel cap, and server-held image bytes only', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      model: QWEN_OCR_MODEL,
      request_id: 'request-1',
      output: { choices: [{ finish_reason: 'stop', message: { content: [{ text: 'PRODUCT-123' }] } }] },
      usage: { image_tokens: 202, input_tokens: 226, output_tokens: 11, total_tokens: 237 },
    }), { status: 200 })) as any;
    const invocations = { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) };
    const provider = new BailianQwenOcrProvider(enabledConfig() as any, invocations as any);

    await expect(provider.recognize(await source(), authorization)).resolves.toEqual({
      kind: 'KNOWN', text: 'PRODUCT-123', providerRequestId: 'request-1',
      usage: { imageTokens: 202, inputTokens: 226, outputTokens: 11, totalTokens: 237 },
    });
    expect(invocations.assertProviderAuthorization).toHaveBeenCalledWith(authorization, 'BAILIAN_QWEN_OCR', QWEN_OCR_MODEL);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ws-workspace1.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request).toMatchObject({ model: QWEN_OCR_MODEL, parameters: { ocr_options: { task: 'text_recognition' }, max_tokens: 256 } });
    expect(request.input.messages[0].content[0]).toMatchObject({ min_pixels: 3072, max_pixels: 262144, enable_rotate: false });
  });

  it('marks a transport error as unknown so a future Core task cannot assume OCR was free', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as any;
    const provider = new BailianQwenOcrProvider(enabledConfig() as any, { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) } as any);

    await expect(provider.recognize(await source(), authorization)).resolves.toEqual({
      kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true,
    });
  });

  it('accepts a successful DashScope response that omits its optional top-level model echo', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: 'request-1',
      output: { choices: [{ finish_reason: 'stop', message: { content: [{ text: '' }] } }] },
    }), { status: 200 })) as any;
    const provider = new BailianQwenOcrProvider(enabledConfig() as any, { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) } as any);

    await expect(provider.recognize(await source(), authorization)).resolves.toMatchObject({ kind: 'KNOWN', text: '', providerRequestId: 'request-1' });
  });

  it('never treats a max-token-truncated OCR response as complete evidence', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      model: QWEN_OCR_MODEL,
      request_id: 'request-1',
      output: { choices: [{ finish_reason: 'length', message: { content: [{ text: 'PARTIAL LABEL' }] } }] },
    }), { status: 200 })) as any;
    const provider = new BailianQwenOcrProvider(enabledConfig() as any, { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) } as any);

    await expect(provider.recognize(await source(), authorization)).resolves.toEqual({
      kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId: 'request-1',
    });
  });
});
