import { ApiClient } from '@/api/client';
import type {
  Company,
  CompanyProductsQuery,
  CompanyProductsResult,
  DiscoveryFilter,
  Result,
} from '@/types';

/** GET /companies 当前后端返回数组；这里不伪造服务端分页能力。 */
export const CompanyRepo = {
  list: (tagId?: string): Promise<Result<Company[]>> =>
    ApiClient.get<Company[]>('/companies', { tagId }),

  getById: (companyId: string): Promise<Result<Company>> =>
    ApiClient.get<Company>(`/companies/${companyId}`),

  listProducts: (
    companyId: string,
    query: CompanyProductsQuery = {},
  ): Promise<Result<CompanyProductsResult>> =>
    ApiClient.get<CompanyProductsResult>(`/companies/${companyId}/products`, {
      page: query.page,
      pageSize: query.pageSize,
      category: query.category,
    }),

  getDiscoveryFilters: (): Promise<Result<DiscoveryFilter[]>> =>
    ApiClient.get<DiscoveryFilter[]>('/companies/discovery-filters'),
};
