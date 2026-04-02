/**
 * 企业事件仓储（Repo）
 *
 * 作用：
 * - 企业页“可预约日历”：返回未来 7 天滚动窗口或整月视图所需事件数据
 * - 事件具备 `startTime`，同一天可有多个事件（参观/讲解/活动等）
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/companies/{companyId}/events` → `Result<CompanyEvent[]>`
 *   - `GET /api/v1/events/{id}` → `Result<CompanyEvent | undefined>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#22-企业事件日历活动讲解参观`
 */
import { mockCompanyEvents } from '../mocks';
import { CompanyEvent, Result } from '../types';
import { simulateRequest } from './helpers';

// 企业事件仓储：日历/活动/直播数据
export const CompanyEventRepo = {
  /** 企业事件列表：`GET /api/v1/companies/{companyId}/events` */
  listByCompany: async (companyId: string): Promise<Result<CompanyEvent[]>> =>
    simulateRequest(mockCompanyEvents.filter((item) => item.companyId === companyId)),
  /** 事件详情：`GET /api/v1/events/{id}` */
  getById: async (id: string): Promise<Result<CompanyEvent | undefined>> =>
    simulateRequest(mockCompanyEvents.find((item) => item.id === id)),
};
