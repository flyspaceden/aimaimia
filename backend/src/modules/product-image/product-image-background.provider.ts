import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type ProductImageBackgroundPreset = 'NEUTRAL_STUDIO' | 'COLD_CHAIN' | 'ORIGIN_SCENE';

export type ProductImageBackgroundRequest = {
  foregroundUrl: string;
  preset: ProductImageBackgroundPreset;
};

export type ProductImageBackgroundTask = { providerTaskId: string };

export interface ProductImageBackgroundProvider {
  isAvailable(): boolean;
  create(request: ProductImageBackgroundRequest): Promise<ProductImageBackgroundTask>;
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

  async create(_request: ProductImageBackgroundRequest): Promise<ProductImageBackgroundTask> {
    throw new ServiceUnavailableException(
      'AI 商品背景生成尚未配置。请先在 staging 配置开关、百炼北京地域业务空间、预算和透明前景链路。',
    );
  }
}
