import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const sharp = require('sharp') as typeof import('sharp').default;
import { VisualAgentInvocationService } from '../visual-agent-invocation.service';
import { VisualProviderAuthorization, VisualProviderSource, VisualProviderUnknownResult } from './visual-image-edit.provider';

export const QWEN_OCR_MODEL = 'qwen-vl-ocr-2025-11-20';
export const BAILIAN_QWEN_OCR_PROVIDER = 'BAILIAN_QWEN_OCR';

export type QwenOcrKnownResult = {
  kind: 'KNOWN';
  text: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; imageTokens?: number };
};

export type QwenOcrDeclinedResult = {
  kind: 'DECLINED';
  code: 'INVALID_REQUEST' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE';
  providerRequestId?: string;
};

export type QwenOcrResult = QwenOcrKnownResult | QwenOcrDeclinedResult | VisualProviderUnknownResult;

type QwenOcrResponse = {
  model?: string;
  output?: { choices?: Array<{ finish_reason?: string; message?: { content?: Array<{ text?: string }> } }> };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; image_tokens?: number };
  request_id?: string;
  code?: string;
};

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_OCR_PIXELS = 262_144;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_TEXT_CHARS = 12_000;
const MIN_EDGE = 240;
const MAX_EDGE = 8000;

/**
 * Fixed-version, default-off OCR adapter. It accepts only a server-held
 * normalized source and a persisted Core lease; no browser can set prompts,
 * model ID, pixel budget, or text output destination.
 */
@Injectable()
export class BailianQwenOcrProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly invocations: VisualAgentInvocationService,
  ) {}

  isAvailable(): boolean {
    return this.config.get('AI_VISUAL_AGENT_ENABLED', 'false') === 'true'
      && this.config.get('AI_VISUAL_AGENT_QWEN_OCR_ENABLED', 'false') === 'true'
      && this.config.get('AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED', 'false') === 'true'
      && !!this.workspaceId()
      && !!this.apiKey();
  }

  async preflight(source: VisualProviderSource): Promise<void> {
    this.assertAvailable();
    if (!Buffer.isBuffer(source.buffer) || source.buffer.length === 0 || source.buffer.length > MAX_SOURCE_BYTES
      || source.normalizedVersion !== 'normalized-rgba-srgb-v1' || source.opaque !== true) {
      throw new ServiceUnavailableException('OCR 只接受已规范化的不透明受管图片');
    }
    let metadata: import('sharp').Metadata;
    try {
      metadata = await sharp(source.buffer, { failOn: 'error', limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
    } catch {
      throw new ServiceUnavailableException('OCR 源图无法安全解码');
    }
    const actualMimeType = metadata.format === 'jpeg' ? 'image/jpeg'
      : metadata.format === 'png' ? 'image/png'
        : metadata.format === 'webp' ? 'image/webp' : undefined;
    if (!actualMimeType || actualMimeType !== source.mimeType || !metadata.width || !metadata.height
      || metadata.width < MIN_EDGE || metadata.height < MIN_EDGE
      || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE
      || metadata.width / metadata.height > 8 || metadata.height / metadata.width > 8
      || (metadata.pages ?? 1) > 1
      || (source.mimeType !== 'image/jpeg' && metadata.hasAlpha)) {
      throw new ServiceUnavailableException('OCR 源图格式、尺寸或帧数不满足受控扫描条件');
    }
  }

  async recognize(source: VisualProviderSource, authorization: VisualProviderAuthorization): Promise<QwenOcrResult> {
    await this.preflight(source);
    await this.invocations.assertProviderAuthorization(authorization, BAILIAN_QWEN_OCR_PROVIDER, QWEN_OCR_MODEL);

    let response: Response;
    let payload: QwenOcrResponse;
    try {
      ({ response, payload } = await this.fetchJsonWithDeadline(this.endpoint('/services/aigc/multimodal-generation/generation'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: QWEN_OCR_MODEL,
          input: {
            messages: [{
              role: 'user',
              content: [{
                image: `data:${source.mimeType};base64,${source.buffer.toString('base64')}`,
                min_pixels: 3072,
                max_pixels: MAX_OCR_PIXELS,
                enable_rotate: false,
              }],
            }],
          },
          parameters: { ocr_options: { task: 'text_recognition' }, max_tokens: 256 },
        }),
      }));
    } catch (error) {
      return this.transportUnknown(error);
    }
    const providerRequestId = this.providerRequestId(payload);
    if (!response.ok) return this.classifyHttpFailure(response.status, providerRequestId);
    // DashScope's documented HTTP response does not require a top-level
    // model field. When it is present, reject a drifted snapshot; absence is
    // bound by the persisted request/Provider policy rather than treated as
    // a falsely unbillable result.
    if (payload.model !== undefined && payload.model !== QWEN_OCR_MODEL) {
      return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    }
    const choice = payload.output?.choices?.[0];
    const text = choice?.message?.content?.[0]?.text;
    if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || text.length > MAX_TEXT_CHARS) {
      return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    }
    return {
      kind: 'KNOWN',
      text,
      providerRequestId,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
        totalTokens: payload.usage?.total_tokens,
        imageTokens: payload.usage?.image_tokens,
      },
    };
  }

  private endpoint(path: string) {
    return `https://${this.workspaceId()}.cn-beijing.maas.aliyuncs.com/api/v1${path}`;
  }

  private workspaceId() {
    const value = this.config.get<string>('AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID')?.trim();
    return value && /^ws-[a-z0-9]{6,128}$/.test(value) ? value : undefined;
  }

  private apiKey() {
    return this.config.get<string>('AI_VISUAL_AGENT_BAILIAN_API_KEY')?.trim();
  }

  private assertAvailable() {
    if (!this.isAvailable()) throw new ServiceUnavailableException('AI Visual Agent Qwen OCR Provider 尚未启用');
  }

  private async fetchJsonWithDeadline(input: RequestInfo | URL, init: RequestInit): Promise<{ response: Response; payload: QwenOcrResponse }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      return { response, payload: await this.readBoundedResponse(response) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private transportUnknown(error: unknown): VisualProviderUnknownResult {
    return {
      kind: 'UNKNOWN',
      code: error instanceof DOMException && error.name === 'AbortError' ? 'TRANSPORT_TIMEOUT' : 'TRANSPORT_FAILURE',
      requiresReconciliation: true,
    };
  }

  private classifyHttpFailure(status: number, providerRequestId?: string): QwenOcrDeclinedResult | VisualProviderUnknownResult {
    if (status === 400 || status === 401 || status === 403 || status === 422) return { kind: 'DECLINED', code: 'INVALID_REQUEST', providerRequestId };
    if (status === 429) return { kind: 'DECLINED', code: 'RATE_LIMITED', providerRequestId };
    return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
  }

  private async readBoundedResponse(response: Response): Promise<QwenOcrResponse> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('OCR_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return {};
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('OCR_RESPONSE_TOO_LARGE');
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as QwenOcrResponse;
    } finally {
      reader.releaseLock();
    }
  }

  private providerRequestId(payload: QwenOcrResponse) {
    return payload.request_id && /^[A-Za-z0-9_-]{1,200}$/.test(payload.request_id) ? payload.request_id : undefined;
  }
}
