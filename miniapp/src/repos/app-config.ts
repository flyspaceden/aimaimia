import { ApiClient } from '@/api/client';
import type { Result } from '@/types';

export type PublicAppConfig = {
  lowStockDisplayThreshold: number;
};

export const DEFAULT_PUBLIC_APP_CONFIG: PublicAppConfig = {
  lowStockDisplayThreshold: 10,
};

export const AppConfigRepo = {
  async getPublicConfig(): Promise<Result<PublicAppConfig>> {
    const result = await ApiClient.get<{ lowStockDisplayThreshold?: unknown }>('/app/config');
    if (!result.ok) return { ok: true, data: DEFAULT_PUBLIC_APP_CONFIG };
    const threshold = result.data.lowStockDisplayThreshold;
    return {
      ok: true,
      data: {
        lowStockDisplayThreshold: Number.isInteger(threshold)
          && Number(threshold) >= 0
          && Number(threshold) <= 999
          ? Number(threshold)
          : DEFAULT_PUBLIC_APP_CONFIG.lowStockDisplayThreshold,
      },
    };
  },
};
