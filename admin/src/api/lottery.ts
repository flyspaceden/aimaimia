import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

export type LotteryPrizeType = 'DISCOUNT_BUY' | 'THRESHOLD_GIFT' | 'NO_PRIZE';

export interface Prize {
  id: string;
  name: string;
  type: LotteryPrizeType;
  probability: number;
  wonCount: number;
  productId?: string;
  skuId?: string;
  prizePrice?: number;
  originalPrice?: number;
  threshold?: number;
  prizeQuantity?: number;
  dailyLimit?: number;
  totalLimit?: number;
  expirationHours?: number;
  sortOrder?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; title: string; media?: Array<{ url: string }> };
  sku?: { id: string; title: string; price: number };
}

export interface DrawRecord {
  id: string;
  userId: string;
  prizeId?: string;
  result: 'WON' | 'NO_PRIZE';
  drawDate: string;
  createdAt: string;
  status?: string;
  user?: { profile?: { nickname?: string } };
  prize?: {
    id: string;
    name: string;
    type: LotteryPrizeType;
    product?: { id: string; title: string; media?: Array<{ url: string }> };
  };
}

export interface LotteryStats {
  today: {
    totalDraws: number;
    totalWon: number;
  };
  prizes: Array<{
    id: string;
    name: string;
    type: LotteryPrizeType;
    todayWon: number;
    totalWon: number;
    totalLimit: number | null;
    dailyLimit: number | null;
  }>;
}

interface PrizeQueryParams extends PaginationParams { type?: string; }
interface DrawRecordParams extends PaginationParams { userId?: string; result?: string; }

export const getPrizes = (params?: PrizeQueryParams): Promise<PaginatedData<Prize>> =>
  client.get('/admin/lottery/prizes', { params });

export const createPrize = (data: Partial<Prize>): Promise<Prize> =>
  client.post('/admin/lottery/prizes', data);

export const updatePrize = (id: string, data: Partial<Prize>): Promise<Prize> =>
  client.put(`/admin/lottery/prizes/${id}`, data);

export const deletePrize = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/lottery/prizes/${id}`);

export const batchUpdateProbabilities = (items: Array<{ id: string; probability: number }>): Promise<{ updated: number; items: Prize[] }> =>
  client.put('/admin/lottery/prizes/batch-probabilities', { items });

export const getDrawRecords = (params?: DrawRecordParams): Promise<PaginatedData<DrawRecord>> =>
  client.get('/admin/lottery/records', { params });

export const getLotteryStats = (): Promise<LotteryStats> =>
  client.get('/admin/lottery/stats');
