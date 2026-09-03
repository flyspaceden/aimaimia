import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const sharp = require('sharp') as typeof import('sharp').default;
import {
  VisualImageEditProvider,
  VisualProviderDeclinedResult,
  VisualProviderKnownTaskResult,
  VisualProviderModel,
  VisualProviderQueryResult,
  VisualProviderServerPlan,
  VisualProviderSource,
  VisualProviderSubmitInput,
  VisualProviderSubmitResult,
  VisualProviderOutput,
  VisualProviderTaskState,
  VisualProviderUnknownResult,
} from './visual-image-edit.provider';
import { VisualAgentInvocationService } from '../visual-agent-invocation.service';

type QwenImageTaskResponse = {
  output?: {
    task_id?: string;
    task_status?: string;
    results?: Array<{ url?: string }>;
    choices?: Array<{ message?: { content?: Array<{ image?: string }> } }>;
  };
  usage?: { image_count?: number };
  request_id?: string;
};

export const BAILIAN_QWEN_IMAGE_PROVIDER = 'BAILIAN_QWEN_IMAGE';
const allowedModels = new Set<VisualProviderModel>(['qwen-image-3.0', 'qwen-image-3.0-pro']);
const allowedMimeTypes = new Set<VisualProviderSource['mimeType']>(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MIN_EDGE = 384;
const MIN_PIXELS = 512 * 512;
const MAX_EDGE = 2048;
const MAX_PIXELS = 2048 * 2048;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Default-off Qwen Image 3.0 provider. The 3.0 edit API accepts server-held
 * image references plus a fixed Core instruction; it never receives a user
 * prompt, arbitrary model ID or URL. Its async task semantics deliberately
 * match Wan so a timeout stays reconciliable rather than being resubmitted.
 */
@Injectable()
export class BailianQwenImageProvider implements VisualImageEditProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly invocations: VisualAgentInvocationService,
  ) {}

  isAvailable(): boolean {
    return this.config.get('AI_VISUAL_AGENT_ENABLED', 'false') === 'true'
      && this.config.get('AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED', 'false') === 'true'
      && this.config.get('AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED', 'false') === 'true'
      && !!this.workspaceId()
      && !!this.apiKey()
      && this.allowedResultHostSuffixes().length > 0;
  }

  isModelAvailable(model: VisualProviderModel): boolean {
    return this.isAvailable() && allowedModels.has(model) && this.allowedModels().has(model);
  }

  async preflight(input: Pick<VisualProviderSubmitInput, 'source' | 'visualPlan' | 'model'>): Promise<void> {
    this.assertAvailable();
    this.assertAllowedModel(input.model);
    await this.assertProviderReadySource(input.source);
    this.renderFixedPrompt(input.visualPlan);
  }

  async submit(input: VisualProviderSubmitInput): Promise<VisualProviderSubmitResult> {
    await this.preflight(input);
    await this.assertAuthorizedInvocation(input);
    const fixedPrompt = this.renderFixedPrompt(input.visualPlan);
    let response: Response;
    try {
      response = await this.fetchWithDeadline(this.endpoint('/services/aigc/image-generation/generation'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()!}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: input.model,
          input: {
            messages: [{
              role: 'user',
              content: [
                { image: `data:${input.source.mimeType};base64,${input.source.buffer.toString('base64')}` },
                { text: fixedPrompt },
              ],
            }],
          },
          // Prompt rewriting is deliberately disabled: only the reviewed
          // server template may influence an image that can become a listing.
          parameters: { n: 1, watermark: false, prompt_extend: false },
        }),
      });
    } catch (error) {
      return this.transportUnknown(error);
    }
    const payload = await this.readResponse(response);
    const providerRequestId = this.providerRequestId(payload);
    if (!response.ok) return this.classifyHttpFailure(response.status, providerRequestId);
    const taskId = payload.output?.task_id;
    if (!this.isValidTaskId(taskId) || !payload.output?.task_status) {
      return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    }
    const state = this.mapState(payload.output.task_status);
    if (state === 'UNKNOWN') {
      return { kind: 'UNKNOWN', code: 'UNKNOWN_PROVIDER_STATE', requiresReconciliation: true, providerRequestId };
    }
    return { kind: 'ACCEPTED', providerTaskId: taskId, state, providerRequestId };
  }

  async query(providerTaskId: string): Promise<VisualProviderQueryResult> {
    this.assertRecoveryAvailable();
    if (!this.isValidTaskId(providerTaskId)) return { kind: 'DECLINED', code: 'INVALID_REQUEST' };
    let response: Response;
    try {
      response = await this.fetchWithDeadline(this.endpoint(`/tasks/${encodeURIComponent(providerTaskId)}`), {
        headers: { Authorization: `Bearer ${this.apiKey()!}` },
      });
    } catch (error) {
      return this.transportUnknown(error);
    }
    const payload = await this.readResponse(response);
    const providerRequestId = this.providerRequestId(payload);
    if (!response.ok) return this.classifyHttpFailure(response.status, providerRequestId, true);
    const output = payload.output;
    if (!output?.task_status || !this.isValidTaskId(output.task_id) || output.task_id !== providerTaskId) {
      return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    }
    const state = this.mapState(output.task_status);
    if (state === 'UNKNOWN') return { kind: 'UNKNOWN', code: 'UNKNOWN_PROVIDER_STATE', requiresReconciliation: true, providerRequestId };
    const outputUrl = output.results?.[0]?.url
      ?? output.choices?.[0]?.message?.content?.find((item) => !!item.image)?.image;
    if (state === 'SUCCEEDED' && (!outputUrl || !this.isAllowedProviderResultUrl(outputUrl))) {
      return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    }
    const result: VisualProviderKnownTaskResult = {
      kind: 'KNOWN', providerTaskId: output.task_id, state, providerRequestId, outputUrl, successfulImageCount: payload.usage?.image_count,
    };
    return result;
  }

  async fetchOutput(outputUrl: string): Promise<VisualProviderOutput> {
    this.assertRecoveryAvailable();
    if (!this.isAllowedProviderResultUrl(outputUrl)) throw new ServiceUnavailableException('百炼 Qwen 输出地址不在允许域名范围内');
    let response: Response;
    try {
      response = await this.fetchWithDeadline(outputUrl, { redirect: 'error' });
    } catch {
      throw new ServiceUnavailableException('无法安全下载百炼 Qwen 输出');
    }
    const contentLength = Number(response.headers.get('content-length') || '0');
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!response.ok || contentType !== 'image/png' || (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES)) {
      throw new ServiceUnavailableException('百炼 Qwen 输出格式或大小无效');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) throw new ServiceUnavailableException('百炼 Qwen 输出大小无效');
    await this.assertDecodedOutput(buffer);
    return { buffer, mimeType: 'image/png' };
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
    if (!this.isAvailable()) throw new ServiceUnavailableException('AI Visual Agent 百炼 Qwen Image Provider 尚未启用或未完成 staging 配置');
  }

  private assertRecoveryAvailable() {
    if (!this.workspaceId() || !this.apiKey() || this.allowedResultHostSuffixes().length === 0) {
      throw new ServiceUnavailableException('AI Visual Agent 百炼 Qwen Provider 缺少在途任务恢复配置');
    }
  }

  private async assertAuthorizedInvocation(input: VisualProviderSubmitInput) {
    const authorization = input.authorization;
    if (!authorization.invocationId || !authorization.policySnapshotVersion || !authorization.adapterExecutionApproved
      || !authorization.leaseToken || !Number.isInteger(authorization.reservedCostCents) || authorization.reservedCostCents <= 0
      || authorization.expiresAt.getTime() <= Date.now()) {
      throw new ServiceUnavailableException('AI Visual Agent 调用未取得有效的 Core 预算与适配器授权');
    }
    await this.invocations.assertProviderAuthorization(authorization, BAILIAN_QWEN_IMAGE_PROVIDER, input.model);
  }

  private assertAllowedModel(model: VisualProviderModel) {
    if (!allowedModels.has(model) || !this.allowedModels().has(model)) throw new ServiceUnavailableException('未授权的百炼 Qwen 图像模型');
  }

  private allowedModels() {
    const raw = this.config.get<string>('AI_VISUAL_AGENT_QWEN_IMAGE_ALLOWED_MODELS', 'qwen-image-3.0');
    return new Set(raw.split(',').map((value) => value.trim()).filter((value): value is VisualProviderModel => allowedModels.has(value as VisualProviderModel)));
  }

  private async assertProviderReadySource(source: VisualProviderSource) {
    if (source.normalizedVersion !== 'normalized-rgba-srgb-v1' || source.opaque !== true || !allowedMimeTypes.has(source.mimeType)) {
      throw new ServiceUnavailableException('视觉源图必须是 Core 规范化后的不透明受管图片');
    }
    let metadata: import('sharp').Metadata;
    try {
      metadata = await sharp(source.buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new ServiceUnavailableException('视觉源图无法安全解码');
    }
    const actualMimeType = this.formatToMimeType(metadata.format);
    if (!Buffer.isBuffer(source.buffer) || source.buffer.length === 0 || source.buffer.length > MAX_SOURCE_BYTES
      || actualMimeType !== source.mimeType || !metadata.width || !metadata.height
      || metadata.width < MIN_EDGE || metadata.height < MIN_EDGE || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE
      || metadata.width * metadata.height < MIN_PIXELS || metadata.width * metadata.height > MAX_PIXELS
      || metadata.width / metadata.height > 8 || metadata.height / metadata.width > 8
      || (metadata.pages ?? 1) > 1 || (source.mimeType !== 'image/jpeg' && metadata.hasAlpha)) {
      throw new ServiceUnavailableException('视觉源图不满足百炼 Qwen Image 输入约束');
    }
  }

  private async assertDecodedOutput(buffer: Buffer) {
    let metadata: import('sharp').Metadata;
    try {
      metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new ServiceUnavailableException('百炼 Qwen 输出无法安全解码');
    }
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width < MIN_EDGE || metadata.height < MIN_EDGE
      || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE || metadata.width * metadata.height < MIN_PIXELS
      || metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) > 1) {
      throw new ServiceUnavailableException('百炼 Qwen 输出尺寸或格式无效');
    }
  }

  private renderFixedPrompt(plan: VisualProviderServerPlan) {
    if (!['truth-preserving-v1', 'marketing-restage-v1'].includes(plan.templateVersion) || plan.allowedOperations.length === 0) {
      throw new ServiceUnavailableException('视觉计划不是已批准的服务端模板');
    }
    const allowed = new Set(['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY', 'BACKGROUND_REPLACE', 'SCENE_RESTAGE']);
    if (plan.allowedOperations.some((operation) => !allowed.has(operation))) throw new ServiceUnavailableException('视觉计划包含未批准的操作');
    if (plan.templateVersion === 'marketing-restage-v1') {
      if (plan.direction !== 'MARKETING_SCENE' || !plan.allowedOperations.includes('SCENE_RESTAGE') || !plan.presentationPreset) {
        throw new ServiceUnavailableException('营销场景计划缺少受控摆拍模板');
      }
      const preset = {
        HARVEST_PLATE: 'Show the same produce as freshly harvested and elegantly arranged on a refined white ceramic plate on a clean wooden kitchen table, with soft natural daylight and a subtle farm-fresh atmosphere. Remove the vine setting; stems may be naturally trimmed. The exact display count is illustrative and must not imply package quantity or weight.',
        HANDHELD_HARVEST: 'Show the same produce freshly harvested and gently held in two clean hands in soft greenhouse daylight. The exact display count is illustrative and must not imply package quantity or weight.',
        LIFESTYLE_TABLETOP: 'Restage the same product as a clearly secondary lifestyle tabletop marketing image with soft natural commercial light and a tasteful uncluttered setting.',
      }[plan.presentationPreset];
      if (!preset) throw new ServiceUnavailableException('营销场景摆拍模板未获批准');
      return [
        'Create one photorealistic secondary AIGC marketing image from the supplied product photo.', preset,
        'Preserve product identity, variety, ripeness range, characteristic shape, surface texture, and natural color. Do not turn it into another product or exaggerate freshness.',
        'Do not add labels, text, watermark, border, collage, price, certificate, promotion, packaging claim, or extra product category.',
        'This is not a factual main image and must remain a marketing presentation. Return one image only.',
      ].join(' ');
    }
    const direction = {
      PRESERVE_REAL_SCENE: 'Keep the authentic real-life setting and improve only light, color balance, clarity, glare, and minor non-product distractions.',
      CATALOG_STUDIO: 'Create a clean neutral catalog presentation while preserving the exact product, packaging, labels, count, and proportions.',
      PRODUCT_RETOUCH: 'Apply conservative product retouching only within the approved non-protected regions; do not redraw product structure.',
      MARKETING_SCENE: 'Create a clearly secondary marketing presentation while preserving all protected product facts exactly.',
    }[plan.direction];
    const riskRule = {
      STRICT_FACTS: 'Treat every visible product fact and all protected source pixels as immutable.',
      CONSERVATIVE_FACTS: 'Treat all product facts, text, labels, count, and visible components as immutable.',
      STANDARD_FACTS: 'Treat product identity, text, labels, count, color, and components as immutable.',
      ORGANIC_FACTS: 'Treat food identity, count, packaging, and visible freshness evidence as immutable.',
      MARKETING_ONLY: 'Treat product identity, text, labels, count, color, and components as immutable; this is never a primary listing image.',
    }[plan.riskProfile];
    if (!direction || !riskRule) throw new ServiceUnavailableException('视觉计划方向或事实风险规则未获批准');
    return [
      'Apply the fixed truth-preserving commercial image enhancement plan.', direction,
      `Allowed operations: ${[...plan.allowedOperations].sort().join(', ')}.`, riskRule,
      'Do not alter, add, remove, duplicate, hide, or invent product objects, components, count, size, color, material, defects, freshness, logos, labels, text, model numbers, barcodes, QR codes, certificates, prices, promotions, or people.',
      'Return one photorealistic image only. Do not add text, watermark, border, or collage.',
    ].join(' ');
  }

  private async fetchWithDeadline(input: RequestInfo | URL, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private transportUnknown(error: unknown): VisualProviderUnknownResult {
    return { kind: 'UNKNOWN', code: error instanceof DOMException && error.name === 'AbortError' ? 'TRANSPORT_TIMEOUT' : 'TRANSPORT_FAILURE', requiresReconciliation: true };
  }

  private classifyHttpFailure(status: number, providerRequestId?: string, isQuery = false): VisualProviderDeclinedResult | VisualProviderUnknownResult {
    if (isQuery) return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
    if (status === 400 || status === 401 || status === 403 || status === 422) return { kind: 'DECLINED', code: 'INVALID_REQUEST', providerRequestId };
    if (status === 429) return { kind: 'DECLINED', code: 'RATE_LIMITED', providerRequestId };
    return { kind: 'UNKNOWN', code: 'AMBIGUOUS_PROVIDER_RESPONSE', requiresReconciliation: true, providerRequestId };
  }

  private mapState(status?: string): VisualProviderTaskState {
    switch (status) {
      case 'PENDING': return 'QUEUED';
      case 'RUNNING': return 'RUNNING';
      case 'SUCCEEDED': return 'SUCCEEDED';
      case 'FAILED': return 'FAILED';
      case 'CANCELED': return 'CANCELED';
      default: return 'UNKNOWN';
    }
  }

  private async readResponse(response: Response): Promise<QwenImageTaskResponse> {
    try { return await response.json() as QwenImageTaskResponse; } catch { return {}; }
  }

  private providerRequestId(payload: QwenImageTaskResponse) {
    return payload.request_id && /^[A-Za-z0-9_-]{1,200}$/.test(payload.request_id) ? payload.request_id : undefined;
  }

  private isValidTaskId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  }

  private isAllowedProviderResultUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
        && this.allowedResultHostSuffixes().some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
    } catch { return false; }
  }

  private allowedResultHostSuffixes() {
    const raw = this.config.get<string>('AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES', '');
    return raw.split(',').map((value) => value.trim().toLowerCase())
      .filter((value) => value !== 'aliyuncs.com'
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.aliyuncs\.com$/.test(value));
  }

  private formatToMimeType(format?: string): VisualProviderSource['mimeType'] | undefined {
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'png') return 'image/png';
    if (format === 'webp') return 'image/webp';
    return undefined;
  }
}
