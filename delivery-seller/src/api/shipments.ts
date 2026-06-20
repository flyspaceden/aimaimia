import client from './client';
import type { Shipment } from '@/types';

export const getOrderShipments = (subOrderId: string): Promise<Shipment[]> =>
  client.get(`/delivery-seller/orders/${subOrderId}/shipments`);
