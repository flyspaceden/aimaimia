import client from './client';
import type {
  AdminGroupBuyActivity,
  CreateGroupBuyActivityInput,
  GroupBuyActivityQueryParams,
  GroupBuyActivityStatus,
  PaginatedData,
  UpdateGroupBuyActivityInput,
} from '@/types';

export const getGroupBuyActivities = (
  params?: GroupBuyActivityQueryParams,
): Promise<PaginatedData<AdminGroupBuyActivity>> =>
  client.get('/admin/group-buy/activities', { params });

export const getGroupBuyActivity = (id: string): Promise<AdminGroupBuyActivity> =>
  client.get(`/admin/group-buy/activities/${id}`);

export const createGroupBuyActivity = (
  data: CreateGroupBuyActivityInput,
): Promise<AdminGroupBuyActivity> =>
  client.post('/admin/group-buy/activities', data);

export const updateGroupBuyActivity = (
  id: string,
  data: UpdateGroupBuyActivityInput,
): Promise<AdminGroupBuyActivity> =>
  client.patch(`/admin/group-buy/activities/${id}`, data);

export const updateGroupBuyActivityStatus = (
  id: string,
  status: GroupBuyActivityStatus,
): Promise<AdminGroupBuyActivity> =>
  client.patch(`/admin/group-buy/activities/${id}/status`, { status });

export const deleteGroupBuyActivity = (id: string): Promise<AdminGroupBuyActivity> =>
  client.delete(`/admin/group-buy/activities/${id}`);
