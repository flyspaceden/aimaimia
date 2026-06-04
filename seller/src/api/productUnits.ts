import client from './client';

/** 商品计量单位（由管理后台维护的字典，公开接口） */
export interface ProductUnit {
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * 获取启用中的商品计量单位列表（已按 sortOrder 排序）。
 *
 * 后端公开接口 `GET /api/v1/product-units`，返回 `{ ok:true, data:[...] }`，
 * 由 `client` 响应拦截器自动解包为 data 数组。携带 seller JWT 即可访问。
 */
export const getProductUnits = (): Promise<ProductUnit[]> =>
  client.get('/product-units');
