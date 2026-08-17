import client from './client';
import type {
  PaginatedData,
  PickupBusinessHours,
  PickupPoint,
  PickupPointCoverage,
  PickupPointKind,
  PickupPointLocation,
} from '@/types';

export interface PickupPointPayload {
  name: string;
  contactName: string;
  contactPhone: string;
  regionCode: string;
  regionText: string;
  detail: string;
  location?: PickupPointLocation | null;
  businessHours: PickupBusinessHours;
  pickupNotice?: string;
  isActive?: boolean;
  kind?: PickupPointKind;
  coverage?: PickupPointCoverage;
  serviceCompanyIds?: string[];
}

export interface AdminPickupPointQuery {
  page?: number;
  pageSize?: number;
  companyId?: string;
  isActive?: boolean;
  isDeleted?: boolean;
  kind?: PickupPointKind;
}

export interface PickupPointCompanyOption {
  id: string;
  name: string;
  isPlatform: boolean;
}

export const getPickupPoints = (
  params?: AdminPickupPointQuery,
): Promise<PaginatedData<PickupPoint>> =>
  client.get('/admin/pickup-points', { params });

export const getPickupPointCompanyOptions = (
  keyword?: string,
): Promise<{ items: PickupPointCompanyOption[] }> =>
  client.get('/admin/pickup-points/company-options', {
    params: keyword ? { keyword } : undefined,
  });

export const createPickupPoint = (
  data: PickupPointPayload & { companyId: string },
): Promise<PickupPoint> =>
  client.post('/admin/pickup-points', data);

export const updatePickupPoint = (
  id: string,
  data: Partial<PickupPointPayload> & { reason?: string },
): Promise<PickupPoint> =>
  client.patch(`/admin/pickup-points/${id}`, data);

export const deletePickupPoint = (
  id: string,
  reason: string,
): Promise<PickupPoint> =>
  client.delete(`/admin/pickup-points/${id}`, { data: { reason } });

export const restorePickupPoint = (
  id: string,
  reason: string,
): Promise<PickupPoint> =>
  client.post(`/admin/pickup-points/${id}/restore`, { reason });
