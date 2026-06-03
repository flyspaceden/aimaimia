import client from './client';

/** 获取当前加价率配置 */
export const getMarkupRate = (): Promise<{ markupRate: number }> =>
  client.get('/seller/config/markup-rate');

/** 获取公开 App 配置 */
export const getPublicAppConfig = (): Promise<{ lowStockDisplayThreshold: number }> =>
  client.get('/app/config');
