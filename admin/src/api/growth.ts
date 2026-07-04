import client from './client';
import type {
  AdminGrowthAccountQueryParams,
  AdminGrowthAccountRow,
  AdminGrowthAdjustPayload,
  AdminGrowthDashboard,
  AdminGrowthExchangeItem,
  AdminGrowthExchangeItemPayload,
  AdminGrowthLedger,
  AdminGrowthLedgerQueryParams,
  AdminGrowthLevel,
  AdminGrowthRule,
  AdminGrowthSettings,
  AdminNormalShareBinding,
  AdminNormalShareBindingQueryParams,
  PaginatedData,
} from '@/types';

export const getGrowthDashboard = (): Promise<AdminGrowthDashboard> =>
  client.get('/admin/growth/dashboard');

export const getGrowthRules = (): Promise<AdminGrowthRule[]> =>
  client.get('/admin/growth/rules');

export const getGrowthSettings = (): Promise<AdminGrowthSettings> =>
  client.get('/admin/growth/settings');

export const updateGrowthSettings = (
  data: Partial<AdminGrowthSettings>,
): Promise<AdminGrowthSettings> =>
  client.put('/admin/growth/settings', data);

export const upsertGrowthRule = (
  code: string,
  data: AdminGrowthRule,
): Promise<AdminGrowthRule> =>
  client.put(`/admin/growth/rules/${code}`, data);

export const getGrowthLevels = (): Promise<AdminGrowthLevel[]> =>
  client.get('/admin/growth/levels');

export const replaceGrowthLevels = (
  levels: AdminGrowthLevel[],
): Promise<AdminGrowthLevel[]> =>
  client.put('/admin/growth/levels', { levels });

export const getGrowthExchangeItems = (): Promise<AdminGrowthExchangeItem[]> =>
  client.get('/admin/growth/exchange-items');

export const createGrowthExchangeItem = (
  data: AdminGrowthExchangeItemPayload,
): Promise<AdminGrowthExchangeItem> =>
  client.post('/admin/growth/exchange-items', data);

export const updateGrowthExchangeItem = (
  id: string,
  data: Partial<AdminGrowthExchangeItemPayload>,
): Promise<AdminGrowthExchangeItem> =>
  client.patch(`/admin/growth/exchange-items/${id}`, data);

export const getGrowthAccounts = (
  params?: AdminGrowthAccountQueryParams,
): Promise<PaginatedData<AdminGrowthAccountRow>> =>
  client.get('/admin/growth/accounts', { params });

export const getGrowthLedgers = (
  params?: AdminGrowthLedgerQueryParams,
): Promise<PaginatedData<AdminGrowthLedger>> =>
  client.get('/admin/growth/ledgers', { params });

export const adjustGrowthUser = (
  userId: string,
  data: AdminGrowthAdjustPayload,
): Promise<AdminGrowthLedger> =>
  client.post(`/admin/growth/users/${userId}/adjust`, data);

export const getNormalShareBindings = (
  params?: AdminNormalShareBindingQueryParams,
): Promise<PaginatedData<AdminNormalShareBinding>> =>
  client.get('/admin/growth/normal-share/bindings', { params });

export const disableNormalShareProfile = (userId: string, reason?: string): Promise<void> =>
  client.post(`/admin/growth/normal-share/profiles/${userId}/disable`, {
    reason,
  });

export const enableNormalShareProfile = (userId: string): Promise<void> =>
  client.post(`/admin/growth/normal-share/profiles/${userId}/enable`);
