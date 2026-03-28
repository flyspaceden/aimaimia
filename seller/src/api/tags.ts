import client from './client';

export interface TagCategory {
  id: string;
  name: string;
  code: string;
  scope: 'COMPANY' | 'PRODUCT';
  tags: { id: string; name: string }[];
}

export interface CompanyTagGroup {
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  tags: { id: string; name: string }[];
}

export const getTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/companies/tag-categories', { params: scope ? { scope } : undefined });

export const getCompanyTags = (): Promise<CompanyTagGroup[]> =>
  client.get('/seller/company/tags');

export const updateCompanyTags = (tagIds: string[]): Promise<CompanyTagGroup[]> =>
  client.put('/seller/company/tags', { tagIds });
