import client from './client';
import type { PaginatedData, QueryParams } from '@/types';

export interface DeliverySettlement {
  id: string;
  merchantId: string;
  subOrderId?: string | null;
  status: 'PENDING' | 'SETTLED';
  settlementMonth: string;
  supplyAmountCents: number;
  settledAmountCents: number;
  expectedAmountCents?: number;
  note?: string | null;
  settledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  subOrder?: {
    id: string;
    orderId: string;
    status: string;
    deliveredAt?: string | null;
    completedAt?: string | null;
  } | null;
}

export const getSettlements = (params?: QueryParams): Promise<PaginatedData<DeliverySettlement>> =>
  client.get('/delivery-seller/settlements', { params });
