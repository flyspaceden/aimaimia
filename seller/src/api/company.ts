import client from './client';
import type { Company, CompanyDocument, CompanyStaff, AiSearchProfile } from '@/types';

// 企业信息
export const getCompany = (): Promise<Company> =>
  client.get('/seller/company');

export const updateCompany = (data: Record<string, unknown>): Promise<Company> =>
  client.put('/seller/company', data);

// 企业亮点
export const updateHighlights = (highlights: Record<string, string>): Promise<unknown> =>
  client.put('/seller/company/highlights', { highlights });

// AI 搜索资料
export const getAiSearchProfile = (): Promise<AiSearchProfile> =>
  client.get('/seller/company/ai-search-profile');

export const updateAiSearchProfile = (data: AiSearchProfile): Promise<AiSearchProfile> =>
  client.put('/seller/company/ai-search-profile', data);

// 资质文件
export const getDocuments = (): Promise<CompanyDocument[]> =>
  client.get('/seller/company/documents');

export const addDocument = (data: Record<string, unknown>): Promise<CompanyDocument> =>
  client.post('/seller/company/documents', data);

// 员工管理
export const getStaff = (): Promise<CompanyStaff[]> =>
  client.get('/seller/company/staff');

export const inviteStaff = (
  phone: string,
  role: 'MANAGER' | 'OPERATOR',
  password?: string,
): Promise<CompanyStaff> =>
  client.post('/seller/company/staff', { phone, role, ...(password ? { password } : {}) });

export const updateStaff = (id: string, data: Record<string, unknown>): Promise<CompanyStaff> =>
  client.put(`/seller/company/staff/${id}`, data);

export const removeStaff = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/company/staff/${id}`);

/** OWNER 修改员工昵称（全局生效） */
export const updateStaffNickname = (id: string, nickname: string): Promise<{ ok: boolean; nickname: string }> =>
  client.put(`/seller/company/staff/${id}/nickname`, { nickname });

/** OWNER 修改员工手机号（替换登录凭证） */
export const updateStaffPhone = (
  id: string,
  newPhone: string,
): Promise<{ ok: boolean; unchanged?: boolean; oldPhone?: string; newPhone?: string }> =>
  client.put(`/seller/company/staff/${id}/phone`, { newPhone });

/** OWNER 重置员工密码（会失效该员工所有活跃 session） */
export const resetStaffPassword = (id: string, newPassword: string): Promise<{ ok: boolean }> =>
  client.post(`/seller/company/staff/${id}/reset-password`, { newPassword });
