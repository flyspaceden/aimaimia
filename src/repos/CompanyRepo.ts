/**
 * 企业仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/companies.ts` + `simulateRequest` 模拟后端
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `GET /api/v1/companies?page=&pageSize=6&certified=&productCategory=&sortBy=&includeTopProducts=` → `Result<PaginationResult<Company>>`
 *   - `GET /api/v1/companies/{id}` → `Result<Company>`
 */
import { mockCompanies } from '../mocks';
import { Company, PaginationResult, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';
import { normalizePagination } from './http/pagination';

const PAGE_SIZE = 6;

// Mock 精选商品数据，附加到每个企业
const MOCK_TOP_PRODUCTS: Array<{ id: string; title: string; price: number; image: string }> = [
  { id: 'tp-001', title: '有机蔬菜礼盒', price: 58, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-002', title: '富硒大米 5kg', price: 89, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-003', title: '冷压初榨茶油', price: 128, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-004', title: '山地蓝莓干 200g', price: 45, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-005', title: '野生灵芝切片', price: 198, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-006', title: '手工腐乳礼盒', price: 36, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-007', title: '铁观音特级 100g', price: 72, image: 'https://placehold.co/200x200/png' },
  { id: 'tp-008', title: '散养土鸡蛋 30枚', price: 65, image: 'https://placehold.co/200x200/png' },
];

/**
 * 为企业附加 Mock 精选商品（3~5 个，根据企业 id 取不同子集）
 */
const attachMockTopProducts = (company: Company): Company => {
  const seed = parseInt(company.id.replace(/\D/g, ''), 10) || 0;
  const count = 3 + (seed % 3); // 3、4 或 5 个商品
  const start = seed % MOCK_TOP_PRODUCTS.length;
  const topProducts: Company['topProducts'] = [];
  for (let i = 0; i < count; i++) {
    const src = MOCK_TOP_PRODUCTS[(start + i) % MOCK_TOP_PRODUCTS.length];
    topProducts.push({
      id: `${company.id}-${src.id}`,
      title: src.title,
      price: src.price,
      image: src.image,
    });
  }
  return { ...company, topProducts };
};

// 企业仓储：对外仅暴露 list/getById 等方法
export const CompanyRepo = {
  /**
   * 获取企业分页列表
   * - 用途：展览馆列表 / 搜索企业
   * - 后端接口：`GET /api/v1/companies`
   * - 响应：`Result<PaginationResult<Company>>`
   */
  list: async (
    options?: {
      page?: number;
      pageSize?: number;
      certified?: boolean;
      productCategory?: string;
      sortBy?: 'distance' | 'rating';
      includeTopProducts?: boolean;
    },
  ): Promise<Result<PaginationResult<Company>>> => {
    if (USE_MOCK) {
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? PAGE_SIZE;
      const certified = options?.certified;
      const productCategory = options?.productCategory;
      const sortBy = options?.sortBy;
      const includeTopProducts = options?.includeTopProducts ?? false;

      // 构建足量的分页数据（复制 mock 数据多页）
      const TOTAL_PAGES = 4;
      const expandedCompanies: Company[] = [];
      for (let p = 1; p <= TOTAL_PAGES; p++) {
        mockCompanies.forEach((company, index) => {
          const suffix = p > 1 ? `-p${p}` : '';
          expandedCompanies.push({
            ...company,
            id: `${company.id}${suffix}`,
            name: p > 1 ? `${company.name} · 批次${p}` : company.name,
            distanceKm: company.distanceKm + (p - 1) * 10 + index * 2,
          });
        });
      }

      let filtered = expandedCompanies;

      // 过滤：certified — 有 certifications 字段且长度 > 0
      if (certified !== undefined) {
        filtered = filtered.filter((company) =>
          certified
            ? (company.certifications?.length ?? 0) > 0
            : (company.certifications?.length ?? 0) === 0,
        );
      }

      // 过滤：productCategory — 匹配 industryTags
      if (productCategory) {
        const cat = productCategory.toLowerCase();
        filtered = filtered.filter((company) =>
          company.industryTags?.some((tag) => tag.toLowerCase().includes(cat)),
        );
      }

      // 排序：distance 按 distanceKm 升序
      if (sortBy === 'distance') {
        filtered = [...filtered].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      }

      // 附加精选商品
      if (includeTopProducts) {
        filtered = filtered.map(attachMockTopProducts);
      }

      // 分页切片
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const items = filtered.slice(start, end);
      const total = filtered.length;
      const nextPage = end < total ? page + 1 : undefined;

      return simulateRequest({ items, total, page, pageSize, nextPage });
    }

    // 真实 API 模式
    // 后端可能返回数组 Company[] 或分页对象 { items, total, page, pageSize }
    const res = await ApiClient.get<any>('/companies');
    if (res.ok) {
      const raw = res.data;
      // 兼容后端返回普通数组的情况：客户端做分页和筛选
      const allCompanies: Company[] = Array.isArray(raw) ? raw : (raw.items ?? []);
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? PAGE_SIZE;

      let filtered = allCompanies;
      if (options?.certified !== undefined) {
        filtered = filtered.filter((c) =>
          options.certified
            ? (c.certifications?.length ?? 0) > 0
            : (c.certifications?.length ?? 0) === 0,
        );
      }
      if (options?.productCategory) {
        const cat = options.productCategory.toLowerCase();
        filtered = filtered.filter((c) =>
          c.industryTags?.some((tag) => tag.toLowerCase().includes(cat)),
        );
      }
      if (options?.sortBy === 'distance') {
        filtered = [...filtered].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      }

      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const items = filtered.slice(start, end);
      const total = filtered.length;
      const nextPage = end < total ? page + 1 : undefined;

      return { ok: true, data: { items, total, page, pageSize, nextPage } };
    }
    return res as Result<PaginationResult<Company>>;
  },

  /**
   * 获取企业详情
   * - 用途：企业详情页（品牌海报、档案、资质、报告、日历事件等）
   * - 后端接口：`GET /api/v1/companies/{id}`
   */
  getById: async (id: string): Promise<Result<Company>> => {
    if (USE_MOCK) {
      const normalizedId = id.split('-p')[0];
      const company = mockCompanies.find((item) => item.id === normalizedId);
      if (!company) {
        return err(createAppError('NOT_FOUND', `企业不存在: ${id}`, '企业信息不存在'));
      }
      return simulateRequest(company);
    }
    return ApiClient.get<Company>(`/companies/${id}`);
  },
};
