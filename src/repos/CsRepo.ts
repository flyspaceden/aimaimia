/**
 * 客服系统仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：前端占位模拟快捷入口/会话/消息
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `GET /api/v1/cs/quick-entries` → `Result<CsQuickEntry[]>`
 *   - `POST /api/v1/cs/sessions` → `Result<CsSessionInfo>`
 *   - `GET /api/v1/cs/sessions/active` → `Result<any>`
 *   - `GET /api/v1/cs/sessions/:id/messages` → `Result<CsMessage[]>`
 *   - `POST /api/v1/cs/sessions/:id/rating` → `Result<any>`
 */
import { CsMessage, CsQuickEntry, CsSessionInfo, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

// Mock 快捷入口数据
const MOCK_QUICK_ENTRIES: CsQuickEntry[] = [
  { id: '1', type: 'QUICK_ACTION', label: '查物流', action: 'query_logistics', icon: 'truck' },
  { id: '2', type: 'QUICK_ACTION', label: '退换货', action: 'apply_aftersale', icon: 'refresh' },
  { id: '3', type: 'QUICK_ACTION', label: '改地址', action: 'modify_address', icon: 'map-pin' },
  { id: '4', type: 'QUICK_ACTION', label: '查退款', action: 'query_aftersale', icon: 'dollar-sign' },
  { id: '5', type: 'HOT_QUESTION', label: '我的快递到哪了？', message: '我的快递到哪了？' },
  { id: '6', type: 'HOT_QUESTION', label: '怎么申请退货退款？', message: '怎么申请退货退款？' },
  { id: '7', type: 'HOT_QUESTION', label: '退款多久到账？', message: '退款多久到账？' },
  { id: '8', type: 'HOT_QUESTION', label: '怎么修改收货地址？', message: '怎么修改收货地址？' },
  { id: '9', type: 'HOT_QUESTION', label: 'VIP会员有什么权益？', message: 'VIP会员有什么权益？' },
  { id: '10', type: 'HOT_QUESTION', label: '优惠券怎么用？', message: '优惠券怎么用？' },
];

// 客服系统仓储：会话管理与消息交互
export const CsRepo = {
  /**
   * 获取快捷入口列表
   * - 用途：客服页面顶部快捷操作 + 热门问题
   * - 后端接口：`GET /api/v1/cs/quick-entries`
   */
  getQuickEntries: async (): Promise<Result<CsQuickEntry[]>> => {
    if (USE_MOCK) return simulateRequest(MOCK_QUICK_ENTRIES, { delay: 200 });
    return ApiClient.get<CsQuickEntry[]>('/cs/quick-entries');
  },

  /**
   * 创建客服会话
   * - 用途：用户进入客服页面时创建新会话
   * - 后端接口：`POST /api/v1/cs/sessions`
   */
  createSession: async (source: string, sourceId?: string): Promise<Result<CsSessionInfo>> => {
    if (USE_MOCK) {
      return simulateRequest({ sessionId: `mock-cs-${Date.now()}`, isExisting: false }, { delay: 300 });
    }
    return ApiClient.post<CsSessionInfo>('/cs/sessions', { source, sourceId });
  },

  /**
   * 获取当前活跃会话
   * - 用途：检查是否有未结束的客服会话
   * - 后端接口：`GET /api/v1/cs/sessions/active`
   */
  getActiveSession: async (source: string, sourceId?: string): Promise<Result<any>> => {
    if (USE_MOCK) return simulateRequest(null, { delay: 200 });
    const params = new URLSearchParams({ source });
    if (sourceId) params.set('sourceId', sourceId);
    return ApiClient.get<any>(`/cs/sessions/active?${params.toString()}`);
  },

  /**
   * 获取会话消息列表
   * - 用途：加载客服会话的历史消息
   * - 后端接口：`GET /api/v1/cs/sessions/:id/messages`
   */
  getMessages: async (sessionId: string): Promise<Result<CsMessage[]>> => {
    if (USE_MOCK) return simulateRequest([], { delay: 200 });
    return ApiClient.get<CsMessage[]>(`/cs/sessions/${sessionId}/messages`);
  },

  /**
   * 提交会话评价
   * - 用途：客服会话结束后用户评分
   * - 后端接口：`POST /api/v1/cs/sessions/:id/rating`
   */
  submitRating: async (sessionId: string, data: { score: number; tags?: string[]; comment?: string }): Promise<Result<any>> => {
    if (USE_MOCK) return simulateRequest({ id: 'mock-rating' }, { delay: 300 });
    return ApiClient.post<any>(`/cs/sessions/${sessionId}/rating`, data);
  },
};
