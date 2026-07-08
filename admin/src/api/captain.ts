import client from './client';
import type {
  CaptainApplication,
  CaptainCommissionLedger,
  CaptainMonthlySettlement,
  CaptainOrderAttribution,
  CaptainProfile,
  CaptainProfileStatus,
  CaptainQueryParams,
  CaptainRelation,
  CaptainSeafoodConfig,
  PaginatedData,
} from '@/types';

export const getCaptainApplications = (
  params?: CaptainQueryParams,
): Promise<PaginatedData<CaptainApplication>> =>
  client.get('/admin/captain/applications', { params });

export const getCaptainApplication = (
  id: string,
): Promise<CaptainApplication> =>
  client.get(`/admin/captain/applications/${id}`);

export const approveCaptainApplication = (
  id: string,
  data: { captainCode?: string; displayName?: string | null },
): Promise<CaptainApplication> =>
  client.post(`/admin/captain/applications/${id}/approve`, data);

export const rejectCaptainApplication = (
  id: string,
  data: { reason: string },
): Promise<CaptainApplication> =>
  client.post(`/admin/captain/applications/${id}/reject`, data);

export const getCaptainProfiles = (
  params?: CaptainQueryParams,
): Promise<PaginatedData<CaptainProfile>> =>
  client.get('/admin/captain/profiles', { params });

export const createCaptainProfile = (
  data: { userId: string; captainCode?: string; displayName?: string | null },
): Promise<CaptainProfile> =>
  client.post('/admin/captain/profiles', data);

export const getCaptainProfile = (
  userId: string,
  params?: { month?: string },
): Promise<CaptainProfile> =>
  client.get(`/admin/captain/profiles/${userId}`, { params });

export const updateCaptainProfileStatus = (
  userId: string,
  data: { status: CaptainProfileStatus; reason?: string | null },
): Promise<CaptainProfile> =>
  client.patch(`/admin/captain/profiles/${userId}/status`, data);

export const getCaptainTeam = (
  userId: string,
): Promise<{ items: CaptainRelation[] }> =>
  client.get(`/admin/captain/profiles/${userId}/team`);

export const getCaptainOrders = (
  params?: CaptainQueryParams,
): Promise<PaginatedData<CaptainOrderAttribution>> =>
  client.get('/admin/captain/orders', { params });

export const getCaptainLedgers = (
  params?: CaptainQueryParams,
): Promise<PaginatedData<CaptainCommissionLedger>> =>
  client.get('/admin/captain/ledgers', { params });

export const getCaptainSettlements = (
  params?: CaptainQueryParams,
): Promise<PaginatedData<CaptainMonthlySettlement>> =>
  client.get('/admin/captain/settlements', { params });

export const approveCaptainSettlement = (id: string): Promise<CaptainMonthlySettlement> =>
  client.post(`/admin/captain/settlements/${id}/approve`);

export const markCaptainSettlementPaid = (id: string): Promise<CaptainMonthlySettlement> =>
  client.post(`/admin/captain/settlements/${id}/mark-paid`);

export const recalculateCaptainSettlement = (id: string): Promise<CaptainMonthlySettlement> =>
  client.post(`/admin/captain/settlements/${id}/recalculate`);

export const getCaptainSettings = (): Promise<CaptainSeafoodConfig> =>
  client.get('/admin/captain/settings');

export const updateCaptainSettings = (
  data: CaptainSeafoodConfig,
): Promise<CaptainSeafoodConfig> =>
  client.put('/admin/captain/settings', { value: data });
