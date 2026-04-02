/**
 * 溯源仓储（Repo）
 *
 * 后端接口：
 * - GET /api/v1/trace/product/:productId → ProductTrace
 * - GET /api/v1/trace/order/:orderId → OrderTrace
 * - GET /api/v1/trace/batch/:batchId → TraceBatch
 * - GET /api/v1/trace/code?code=xxx → TraceBatch
 */
import { ProductTrace, OrderTrace, TraceBatch, Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

// Mock 数据
const mockBatch: TraceBatch = {
  id: 'batch-1',
  batchCode: 'NM-2026-001',
  productId: 'p-1',
  companyId: 'c-1',
  stage: 'HARVEST',
  status: 'ACTIVE',
  meta: { origin: '浙江省杭州市', variety: '龙井茶' },
  createdAt: '2026-01-01',
  events: [
    { id: 'evt-1', type: 'SEED', data: { variety: '龙井43号' }, occurredAt: '2025-03-01' },
    { id: 'evt-2', type: 'PLANT', data: { field: 'A区3号' }, occurredAt: '2025-04-15' },
    { id: 'evt-3', type: 'HARVEST', data: { weight: '500kg' }, occurredAt: '2026-01-01' },
  ],
  ownershipClaim: {
    id: 'oc-1',
    type: 'FARM',
    data: { farmName: '西湖龙井茶园', certNo: 'ZJ-2025-1234' },
    verifiedAt: '2025-06-01',
  },
};

export const TraceRepo = {
  /** 商品溯源链 */
  getProductTrace: async (productId: string): Promise<Result<ProductTrace>> => {
    if (USE_MOCK) {
      return simulateRequest({ productId, batches: [mockBatch] });
    }
    return ApiClient.get<ProductTrace>(`/trace/product/${productId}`);
  },

  /** 订单溯源链 */
  getOrderTrace: async (orderId: string): Promise<Result<OrderTrace>> => {
    if (USE_MOCK) {
      return simulateRequest({
        orderId,
        items: [{ orderItemId: 'oi-1', batches: [mockBatch] }],
      });
    }
    return ApiClient.get<OrderTrace>(`/trace/order/${orderId}`);
  },

  /** 批次详情 */
  getBatchDetail: async (batchId: string): Promise<Result<TraceBatch>> => {
    if (USE_MOCK) {
      return simulateRequest(mockBatch);
    }
    return ApiClient.get<TraceBatch>(`/trace/batch/${batchId}`);
  },

  /** 批次码查询 */
  searchByCode: async (code: string): Promise<Result<TraceBatch>> => {
    if (USE_MOCK) {
      return simulateRequest(mockBatch);
    }
    return ApiClient.get<TraceBatch>('/trace/code', { code });
  },
};
