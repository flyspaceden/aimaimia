import client from './client';
import type { DashboardStats, SalesTrend, BonusStats } from '@/types';

/** Dashboard 统计数据 */
export const getDashboardStats = (): Promise<DashboardStats> =>
  client.get('/delivery-admin/stats/dashboard');

/** 销售趋势 */
export const getSalesTrend = (): Promise<SalesTrend[]> =>
  client.get('/delivery-admin/stats/sales-trend');

/** 奖励统计 */
export const getBonusStats = (): Promise<BonusStats> =>
  client.get('/delivery-admin/stats/bonus');
