/**
 * 数据分析仓储（Repo）（当前为占位）
 *
 * 作用：
 * - 企业内容分析面板
 * - 用户兴趣图谱
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/analytics/companies/{companyId}/content-stats` → `Result<CompanyContentStats>`
 *   - `GET /api/v1/analytics/users/{userId}/interest-profile` → `Result<UserInterestProfile>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#47-数据分析占位`
 */
import { mockCompanyContentStats, mockUserInterestProfile } from '../mocks';
import { CompanyContentStats, Result, UserInterestProfile } from '../types';
import { simulateRequest } from './helpers';

// 数据分析仓储：企业内容分析、用户兴趣图谱（占位）
export const AnalyticsRepo = {
  /**
   * 企业内容分析
   * - 用途：企业侧“内容效果/粉丝画像/转化”等占位
   * - 后端建议：`GET /api/v1/analytics/companies/{companyId}/content-stats`
   */
  getCompanyContentStats: async (companyId: string): Promise<Result<CompanyContentStats>> => {
    const stats = { ...mockCompanyContentStats, companyId };
    return simulateRequest(stats, { delay: 280 });
  },
  /**
   * 用户兴趣图谱
   * - 用途：个性化推荐/运营洞察占位
   * - 后端建议：`GET /api/v1/analytics/users/{userId}/interest-profile`
   */
  getUserInterestProfile: async (userId: string): Promise<Result<UserInterestProfile>> => {
    const profile = { ...mockUserInterestProfile, userId };
    return simulateRequest(profile, { delay: 260 });
  },
};
