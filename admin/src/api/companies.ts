import client from './client';
import type { Company, CompanyStaff, PaginatedData, PaginationParams, AiSearchProfile } from '@/types';

interface CompanyQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
}

/** 企业列表 */
export const getCompanies = (params?: CompanyQueryParams): Promise<PaginatedData<Company>> =>
  client.get('/admin/companies', { params });

/** 企业详情 */
export const getCompany = (id: string): Promise<Company> =>
  client.get(`/admin/companies/${id}`);

/** 更新企业 */
export const updateCompany = (id: string, data: {
  name?: string;
  shortName?: string;
  description?: string;
  servicePhone?: string;
  serviceWeChat?: string;
  address?: Record<string, any>;
  status?: string;
}): Promise<Company> =>
  client.put(`/admin/companies/${id}`, data);

/** 企业审核 */
export const auditCompany = (id: string, data: {
  status: 'APPROVED' | 'REJECTED';
  note?: string;
}): Promise<Company> =>
  client.post(`/admin/companies/${id}/audit`, data);

/** 获取企业亮点 */
export const getCompanyHighlights = (companyId: string): Promise<Record<string, string>> =>
  client.get(`/admin/companies/${companyId}/highlights`);

/** 更新企业亮点 */
export const updateCompanyHighlights = (companyId: string, highlights: Record<string, string>): Promise<void> =>
  client.put(`/admin/companies/${companyId}/highlights`, { highlights });

/** 审核资质文件 */
export const verifyDocument = (companyId: string, docId: string, data: {
  verifyStatus: 'VERIFIED' | 'REJECTED';
  verifyNote?: string;
}): Promise<void> =>
  client.post(`/admin/companies/${companyId}/documents/${docId}/verify`, data);

/** 企业员工列表 */
export const getCompanyStaff = (companyId: string): Promise<CompanyStaff[]> =>
  client.get(`/admin/companies/${companyId}/staff`);

/** 绑定企业创始人 */
export const bindCompanyOwner = (companyId: string, phone: string): Promise<CompanyStaff> =>
  client.post(`/admin/companies/${companyId}/bind-owner`, { phone });

/** C40c8 管理员兜底重置员工密码 */
export const resetStaffPassword = (
  companyId: string,
  staffId: string,
  newPassword: string,
): Promise<{ ok: boolean }> =>
  client.post(`/admin/companies/${companyId}/staff/${staffId}/reset-password`, {
    newPassword,
  });

// ========== C40c9 管理员员工 CRUD + 换 OWNER ==========

/** 添加员工（MANAGER/OPERATOR） */
export const addStaff = (
  companyId: string,
  data: { phone: string; role: 'MANAGER' | 'OPERATOR'; nickname?: string; password?: string },
): Promise<CompanyStaff> =>
  client.post(`/admin/companies/${companyId}/staff`, data);

/** 修改员工角色/状态（OWNER 不可改） */
export const updateStaff = (
  companyId: string,
  staffId: string,
  data: { role?: 'MANAGER' | 'OPERATOR'; status?: 'ACTIVE' | 'DISABLED' },
): Promise<CompanyStaff> =>
  client.put(`/admin/companies/${companyId}/staff/${staffId}`, data);

/** 移除员工（OWNER 不可移除） */
export const removeStaff = (
  companyId: string,
  staffId: string,
): Promise<{ ok: boolean }> =>
  client.delete(`/admin/companies/${companyId}/staff/${staffId}`);

/** 换 OWNER */
export const transferOwner = (
  companyId: string,
  data: {
    newOwnerPhone: string;
    oldOwnerAction: 'DEMOTE_TO_MANAGER' | 'REMOVE';
  },
): Promise<{ ok: boolean; oldOwnerId: string; newOwnerId: string }> =>
  client.post(`/admin/companies/${companyId}/transfer-owner`, data);

/** 获取企业 AI 搜索资料 */
export const getCompanyAiSearchProfile = (companyId: string): Promise<AiSearchProfile> =>
  client.get(`/admin/companies/${companyId}/ai-search-profile`);

/** 更新企业 AI 搜索资料 */
export const updateCompanyAiSearchProfile = (companyId: string, data: AiSearchProfile): Promise<AiSearchProfile> =>
  client.put(`/admin/companies/${companyId}/ai-search-profile`, data);

/** 添加企业 */
export const createCompany = (data: {
  companyName: string;
  contactName: string;
  phone: string;
  category: string;
  description?: string;
}): Promise<{ companyId: string; staffId: string }> =>
  client.post('/admin/companies', data);
