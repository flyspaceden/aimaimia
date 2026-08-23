import { ApiClient } from '@/api/client';
import type { Result, ShipmentDetail } from '@/types';

export const LogisticsRepo = {
  getByOrderId: (orderId: string): Promise<Result<ShipmentDetail | null>> =>
    ApiClient.get<ShipmentDetail | null>(`/shipments/${orderId}`),

  refreshTracking: (orderId: string): Promise<Result<ShipmentDetail | null>> =>
    ApiClient.get<ShipmentDetail | null>(`/shipments/${orderId}/track`),
};
