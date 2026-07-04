import client from './client';
import type { DashboardStats, SalesTrend, BonusStats, OperationsOverview } from '@/types';

/** Dashboard 统计数据 */
export const getDashboardStats = (): Promise<DashboardStats> =>
  client.get('/admin/stats/dashboard');

/** 销售趋势 */
export const getSalesTrend = (): Promise<SalesTrend[]> =>
  client.get('/admin/stats/sales-trend');

/** 奖励统计 */
export const getBonusStats = (): Promise<BonusStats> =>
  client.get('/admin/stats/bonus');

/** 运营工作台总览 */
export const getOperationsOverview = (): Promise<OperationsOverview> =>
  client.get('/admin/stats/operations-overview');
