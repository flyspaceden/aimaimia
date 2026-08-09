import client from './client';
import type { SfExpressProductOption } from '@/types';

/** 获取公开 App 配置 */
export const getPublicAppConfig = (): Promise<{
  lowStockDisplayThreshold: number;
  sfExpressProducts: SfExpressProductOption[];
}> =>
  client.get('/delivery-seller/config/public');
