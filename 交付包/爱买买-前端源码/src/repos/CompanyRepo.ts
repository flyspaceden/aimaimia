/**
 * 企业仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/companies.ts` + `simulateRequest` 模拟后端
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/companies` → `Result<Company[]>`
 *   - `GET /api/v1/companies/{id}` → `Result<Company>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#2-数字展览馆company--events--booking--group`
 */
import { mockCompanies } from '../mocks';
import { Company, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

// 企业仓储：后续可替换为真实 API
export const CompanyRepo = {
  /**
   * 获取企业列表
   * - 用途：展览馆列表/搜索企业
   * - 后端建议：`GET /api/v1/companies`
   */
  list: async (): Promise<Result<Company[]>> => simulateRequest(mockCompanies),
  /**
   * 获取企业详情
   * - 用途：企业详情页（品牌海报、档案、资质、报告、日历事件等）
   * - 后端建议：`GET /api/v1/companies/{id}`
   */
  getById: async (id: string): Promise<Result<Company>> => {
    const company = mockCompanies.find((item) => item.id === id);
    if (!company) {
      return err(createAppError('NOT_FOUND', `企业不存在: ${id}`, '企业信息不存在'));
    }
    return simulateRequest(company);
  },
};
