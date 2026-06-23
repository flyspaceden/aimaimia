import client from './client';
import type {
  AdminGroupBuyActivity,
  AdminGroupBuyInstance,
  AdminGroupBuyOrder,
  AdminGroupBuyRebateLedger,
  CreateGroupBuyActivityInput,
  GroupBuyCatalogProduct,
  GroupBuyActivityQueryParams,
  GroupBuyActivityStatus,
  GroupBuyInstanceQueryParams,
  GroupBuyOrderQueryParams,
  GroupBuyRebateLedgerQueryParams,
  GroupBuySettings,
  UpdateGroupBuySettingsInput,
  PaginatedData,
  UpdateGroupBuyActivityInput,
} from '@/types';

export const getGroupBuyActivities = (
  params?: GroupBuyActivityQueryParams,
): Promise<PaginatedData<AdminGroupBuyActivity>> =>
  client.get('/admin/group-buy/activities', { params });

export const getGroupBuyActivity = (id: string): Promise<AdminGroupBuyActivity> =>
  client.get(`/admin/group-buy/activities/${id}`);

export const getGroupBuyProductCatalog = (
  params?: { keyword?: string },
): Promise<{ items: GroupBuyCatalogProduct[] }> =>
  client.get('/admin/group-buy/product-catalog', { params });

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

export const getGroupBuyInstances = (
  params?: GroupBuyInstanceQueryParams,
): Promise<PaginatedData<AdminGroupBuyInstance>> =>
  client.get('/admin/group-buy/instances', { params });

export const getGroupBuyInstance = (id: string): Promise<AdminGroupBuyInstance> =>
  client.get(`/admin/group-buy/instances/${id}`);

export const getGroupBuyOrders = (
  params?: GroupBuyOrderQueryParams,
): Promise<PaginatedData<AdminGroupBuyOrder>> =>
  client.get('/admin/group-buy/orders', { params });

export const getGroupBuyRebateLedgers = (
  params?: GroupBuyRebateLedgerQueryParams,
): Promise<PaginatedData<AdminGroupBuyRebateLedger>> =>
  client.get('/admin/group-buy/rebate-ledgers', { params });

export const getGroupBuySettings = (): Promise<GroupBuySettings> =>
  client.get('/admin/group-buy/settings');

export const updateGroupBuySettings = (
  data: UpdateGroupBuySettingsInput,
): Promise<GroupBuySettings> =>
  client.put('/admin/group-buy/settings', data);
