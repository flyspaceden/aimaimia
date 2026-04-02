import client from './client';

/** 获取当前加价率配置 */
export const getMarkupRate = (): Promise<{ markupRate: number }> =>
  client.get('/seller/config/markup-rate');
