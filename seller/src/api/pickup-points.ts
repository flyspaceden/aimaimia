import client from './client';
import type { PaginatedData, PickupBusinessHours, PickupPoint, PickupPointLocation } from '@/types';

export interface PickupPointQuery {
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}

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
}

export const getPickupPoints = (
  params?: PickupPointQuery,
): Promise<PaginatedData<PickupPoint>> =>
  client.get('/seller/pickup-points', { params });

export const createPickupPoint = (data: PickupPointPayload): Promise<PickupPoint> =>
  client.post('/seller/pickup-points', data);

export const updatePickupPoint = (
  id: string,
  data: Partial<PickupPointPayload>,
): Promise<PickupPoint> =>
  client.patch(`/seller/pickup-points/${id}`, data);
