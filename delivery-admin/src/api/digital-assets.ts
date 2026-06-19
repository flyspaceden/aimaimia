import client from './client';
import type {
  DigitalAssetAccountDetail,
  DigitalAssetAccountQueryParams,
  DigitalAssetAccountRow,
  DigitalAssetAdjustPayload,
  DigitalAssetLedger,
  DigitalAssetLedgerQueryParams,
  DigitalAssetOverview,
  DigitalAssetSettings,
  PaginatedData,
} from '@/types';

export const getDigitalAssetOverview = (): Promise<DigitalAssetOverview> =>
  client.get('/delivery-admin/digital-assets/overview');

export const getDigitalAssetAccounts = (
  params?: DigitalAssetAccountQueryParams,
): Promise<PaginatedData<DigitalAssetAccountRow>> =>
  client.get('/delivery-admin/digital-assets/accounts', { params });

export const exportDigitalAssetAccounts = (
  params?: DigitalAssetAccountQueryParams,
): Promise<Blob> =>
  client.get('/delivery-admin/digital-assets/export', { params, responseType: 'blob' });

export const getDigitalAssetAccount = (userId: string): Promise<DigitalAssetAccountDetail> =>
  client.get(`/delivery-admin/digital-assets/users/${userId}`);

export const getDigitalAssetLedgers = (
  userId: string,
  params?: DigitalAssetLedgerQueryParams,
): Promise<PaginatedData<DigitalAssetLedger>> =>
  client.get(`/delivery-admin/digital-assets/users/${userId}/ledgers`, { params });

export const adjustDigitalAssetAccount = (
  userId: string,
  data: DigitalAssetAdjustPayload,
): Promise<DigitalAssetAccountDetail> =>
  client.post(`/delivery-admin/digital-assets/users/${userId}/adjust`, data);

export const getDigitalAssetSettings = (): Promise<DigitalAssetSettings> =>
  client.get('/delivery-admin/digital-assets/settings');

export const updateDigitalAssetSettings = (
  data: DigitalAssetSettings,
): Promise<DigitalAssetSettings> =>
  client.put('/delivery-admin/digital-assets/settings', data);
