import client from './client';

/** 获取公开 App 配置 */
export const getPublicAppConfig = (): Promise<{ lowStockDisplayThreshold: number }> =>
  client.get('/app/config');
