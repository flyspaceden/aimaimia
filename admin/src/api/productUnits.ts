import client from './client';

/** 商品单位（管理端，含停用项） */
export interface AdminProductUnit {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 公开商品单位（仅启用项，用于下拉选项） */
export interface PublicProductUnit {
  id: string;
  name: string;
  sortOrder: number;
}

/** 获取全部单位（含停用） */
export const getProductUnits = (): Promise<AdminProductUnit[]> =>
  client.get('/admin/product-units');

/** 创建单位 */
export const createProductUnit = (data: {
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<AdminProductUnit> => client.post('/admin/product-units', data);

/** 编辑单位 */
export const updateProductUnit = (
  id: string,
  data: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<AdminProductUnit> => client.patch(`/admin/product-units/${id}`, data);

/** 删除单位 */
export const deleteProductUnit = (id: string): Promise<void> =>
  client.delete(`/admin/product-units/${id}`);

/** 公开接口：仅返回启用单位（供商品编辑下拉使用） */
export const getPublicProductUnits = (): Promise<PublicProductUnit[]> =>
  client.get('/product-units');
