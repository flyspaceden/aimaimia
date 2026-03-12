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

export const inviteStaff = (phone: string, role: string): Promise<CompanyStaff> =>
  client.post('/seller/company/staff', { phone, role });

export const updateStaff = (id: string, data: Record<string, unknown>): Promise<CompanyStaff> =>
  client.put(`/seller/company/staff/${id}`, data);

export const removeStaff = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/company/staff/${id}`);
