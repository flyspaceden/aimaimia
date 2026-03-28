import client from './client';

// ===== Types =====

export interface TagCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  scope: 'COMPANY' | 'PRODUCT';
  sortOrder: number;
  tags: TagItem[];
}

export interface TagItem {
  id: string;
  name: string;
  synonyms: string[];
  sortOrder: number;
  isActive: boolean;
  _count?: { productTags: number; companyTags: number };
  category?: { id: string; name: string; code: string; scope: string };
}

// ===== TagCategory =====

export const getTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/admin/tag-categories', { params: scope ? { scope } : undefined });

export const createTagCategory = (data: {
  name: string;
  code: string;
  scope: 'COMPANY' | 'PRODUCT';
  description?: string;
  sortOrder?: number;
}): Promise<TagCategory> => client.post('/admin/tag-categories', data);

export const updateTagCategory = (
  id: string,
  data: { name?: string; description?: string; sortOrder?: number },
): Promise<TagCategory> => client.patch(`/admin/tag-categories/${id}`, data);

export const deleteTagCategory = (id: string): Promise<void> =>
  client.delete(`/admin/tag-categories/${id}`);

// ===== Tag =====

export const getTags = (params?: { categoryId?: string; scope?: string }): Promise<TagItem[]> =>
  client.get('/admin/tags', { params });

export const createTag = (data: {
  name: string;
  categoryId: string;
  synonyms?: string[];
  sortOrder?: number;
}): Promise<TagItem> => client.post('/admin/tags', data);

export const updateTag = (
  id: string,
  data: { name?: string; synonyms?: string[]; sortOrder?: number; isActive?: boolean },
): Promise<TagItem> => client.patch(`/admin/tags/${id}`, data);

export const deleteTag = (id: string): Promise<void> =>
  client.delete(`/admin/tags/${id}`);

// ===== Company Tags =====

export interface CompanyTagGroup {
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  tags: { id: string; name: string }[];
}

export const getCompanyTags = (companyId: string): Promise<CompanyTagGroup[]> =>
  client.get(`/admin/companies/${companyId}/tags`);

export const updateCompanyTags = (companyId: string, tagIds: string[]): Promise<CompanyTagGroup[]> =>
  client.put(`/admin/companies/${companyId}/tags`, { tagIds });

// ===== Public API (for tag options in selectors) =====

export const getPublicTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/companies/tag-categories', { params: scope ? { scope } : undefined });
