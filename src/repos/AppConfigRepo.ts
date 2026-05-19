import { ApiClient } from './http/ApiClient';
import { Result, ok } from '../types';

export type PublicAppConfig = {
  lowStockDisplayThreshold: number;
};

const FALLBACK_CONFIG: PublicAppConfig = {
  lowStockDisplayThreshold: 10,
};

export const AppConfigRepo = {
  getPublicConfig: async (): Promise<Result<PublicAppConfig>> => {
    const result = await ApiClient.get<PublicAppConfig>('/app/config');
    if (!result.ok) return ok(FALLBACK_CONFIG);
    return ok({
      lowStockDisplayThreshold:
        Number.isInteger(result.data.lowStockDisplayThreshold) &&
        result.data.lowStockDisplayThreshold >= 0 &&
        result.data.lowStockDisplayThreshold <= 999
          ? result.data.lowStockDisplayThreshold
          : FALLBACK_CONFIG.lowStockDisplayThreshold,
    });
  },
};
