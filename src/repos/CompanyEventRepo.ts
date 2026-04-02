/**
 * 企业事件仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/companyEvents.ts` 返回事件数据
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/companies/{companyId}/events` → `Result<CompanyEvent[]>`
 * - `GET /api/v1/company-events/{id}` → `Result<CompanyEvent | undefined>`
 */
import { mockCompanyEvents } from '../mocks';
import { CompanyEvent, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

// 企业事件仓储：日历/活动/直播数据
export const CompanyEventRepo = {
  /** 企业事件列表：`GET /api/v1/companies/{companyId}/events` */
  listByCompany: async (companyId: string): Promise<Result<CompanyEvent[]>> => {
    if (USE_MOCK) {
      return simulateRequest(mockCompanyEvents.filter((item) => item.companyId === companyId));
    }

    return ApiClient.get<CompanyEvent[]>(`/companies/${companyId}/events`);
  },
  /** 事件详情：`GET /api/v1/company-events/{id}` */
  getById: async (id: string): Promise<Result<CompanyEvent | undefined>> => {
    if (USE_MOCK) {
      return simulateRequest(mockCompanyEvents.find((item) => item.id === id));
    }

    return ApiClient.get<CompanyEvent | undefined>(`/company-events/${id}`);
  },
};
