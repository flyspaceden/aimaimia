import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type ProductImageBackgroundPreset = 'NEUTRAL_STUDIO' | 'COLD_CHAIN' | 'ORIGIN_SCENE';

export type ProductImageBackgroundSubmission = {
  /** Server-held, verified transparent foreground; never an arbitrary URL. */
  foregroundPng: Buffer;
  foregroundCanonicalSha256: string;
  maskArtifactId: string;
  preset: ProductImageBackgroundPreset;
  idempotencyKey: string;
};

export type ProductImageBackgroundTask = { providerTaskId: string };
export type ProductImageBackgroundTaskState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type ProductImageBackgroundResult = { image: Buffer; mimeType: 'image/png'; providerUsageCents: number };

export interface ProductImageBackgroundProvider {
  isAvailable(): boolean;
  submit(request: ProductImageBackgroundSubmission): Promise<ProductImageBackgroundTask>;
  query(providerTaskId: string): Promise<{ state: ProductImageBackgroundTaskState }>;
  fetchVerifiedResult(providerTaskId: string): Promise<ProductImageBackgroundResult>;
}

/**
 * Fail-closed Phase-C provider. A real provider is intentionally not selected
 * until its key, region, budget and transparent-foreground path are configured.
 */
@Injectable()
export class DisabledProductImageBackgroundProvider implements ProductImageBackgroundProvider {
  isAvailable(): boolean {
    // This is deliberately a stub, not a configuration probe. Returning true
    // here would let callers believe the provider is ready even though
    // `create` cannot make a request. Bind a concrete, tested provider before
    // enabling this capability.
    return false;
  }

  async submit(_request: ProductImageBackgroundSubmission): Promise<ProductImageBackgroundTask> {
    throw new ServiceUnavailableException(
      'AI 商品背景生成尚未配置。请先在 staging 配置开关、百炼北京地域业务空间、预算和透明前景链路。',
    );
  }

  async query(_providerTaskId: string): Promise<{ state: ProductImageBackgroundTaskState }> {
    throw new ServiceUnavailableException('AI 商品背景生成尚未配置。');
  }

  async fetchVerifiedResult(_providerTaskId: string): Promise<ProductImageBackgroundResult> {
    throw new ServiceUnavailableException('AI 商品背景生成尚未配置。');
  }
}
