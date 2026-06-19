import client from './client';

export interface AdminCategory {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  level: number;
  sortOrder: number;
  isActive: boolean;
  returnPolicy: 'RETURNABLE' | 'NON_RETURNABLE' | 'INHERIT';
  _count: { products: number; children: number };
}

/** 获取完整分类树 */
export const getCategories = (): Promise<AdminCategory[]> =>
  client.get('/admin/categories');

/** 创建分类 */
export const createCategory = (data: {
  name: string;
  parentId?: string;
  sortOrder?: number;
  returnPolicy?: 'RETURNABLE' | 'NON_RETURNABLE' | 'INHERIT';
}): Promise<AdminCategory> => client.post('/admin/categories', data);

/** 编辑分类 */
export const updateCategory = (
  id: string,
  data: { name?: string; sortOrder?: number; returnPolicy?: 'RETURNABLE' | 'NON_RETURNABLE' | 'INHERIT' },
): Promise<AdminCategory> => client.put(`/admin/categories/${id}`, data);

/** 删除分类 */
export const deleteCategory = (id: string): Promise<void> =>
  client.delete(`/admin/categories/${id}`);

/** 启用/停用 */
export const toggleCategoryActive = (id: string): Promise<AdminCategory> =>
  client.post(`/admin/categories/${id}/toggle-active`);

/** 批量排序 */
export const batchSortCategories = (
  items: { id: string; sortOrder: number }[],
): Promise<void> => client.put('/admin/categories/batch/sort', { items });
