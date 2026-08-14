import client from './client';
import type { PaginatedData, PickupPoint } from '@/types';

export interface AdminPickupPointQuery {
  page?: number;
  pageSize?: number;
  companyId?: string;
  isActive?: boolean;
}

export const getPickupPoints = (
  params?: AdminPickupPointQuery,
): Promise<PaginatedData<PickupPoint>> =>
  client.get('/admin/pickup-points', { params });

export const updatePickupPoint = (
  id: string,
  data: { isActive: boolean },
): Promise<PickupPoint> =>
  client.patch(`/admin/pickup-points/${id}`, data);
