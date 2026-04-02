import client from './client';
import type { SellerOverview, SalesTrendItem, ProductRankItem, OrderStatItem } from '@/types';

export const getOverview = (): Promise<SellerOverview> =>
  client.get('/seller/analytics/overview');

export const getSalesTrend = (days?: number): Promise<SalesTrendItem[]> =>
  client.get('/seller/analytics/sales', { params: { days } });

export const getProductRanking = (limit?: number): Promise<ProductRankItem[]> =>
  client.get('/seller/analytics/products', { params: { limit } });

export const getOrderStats = (): Promise<OrderStatItem[]> =>
  client.get('/seller/analytics/orders');
