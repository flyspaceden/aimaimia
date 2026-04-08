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
   * 发送消息到客服会话
   * - 用途：用户在客服聊天页面发送文字消息
   * - 后端接口：`POST /api/v1/cs/sessions/:id/messages`
   * - Mock 模式下返回一条模拟的 AI 回复
   */
  sendMessage: async (sessionId: string, content: string): Promise<Result<CsMessage>> => {
    if (USE_MOCK) {
      // Mock 模式：模拟 AI 自动回复
      const mockReply: CsMessage = {
        id: `mock-ai-${Date.now()}`,
        sessionId,
        senderType: 'AI',
        contentType: 'TEXT',
        content: getMockAiReply(content),
        createdAt: new Date().toISOString(),
      };
      return simulateRequest(mockReply, { delay: 800 });
    }
    return ApiClient.post<CsMessage>(`/cs/sessions/${sessionId}/messages`, { content });
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

// Mock 模式下的 AI 自动回复
function getMockAiReply(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  if (msg.includes('快递') || msg.includes('物流')) {
    return '正在为您查询物流信息，请稍候...\n\n您的包裹目前已到达【杭州转运中心】，预计明天送达。如需进一步帮助，请随时告诉我。';
  }
  if (msg.includes('退') || msg.includes('换')) {
    return '关于退换货，我来为您解答：\n\n1. 收到商品7天内可申请无理由退货\n2. 商品质量问题可随时申请退换\n3. 退款一般3-5个工作日到账\n\n需要我帮您发起退换货申请吗？';
  }
  if (msg.includes('地址')) {
    return '修改收货地址的操作步骤：\n\n1. 进入"我的订单"页面\n2. 找到对应订单\n3. 点击"修改地址"\n\n注意：已发货的订单无法修改地址。需要我帮您查看订单状态吗？';
  }
  if (msg.includes('优惠') || msg.includes('券')) {
    return '关于优惠券使用说明：\n\n1. 在结算页面自动展示可用优惠券\n2. 选择优惠券后金额会自动抵扣\n3. 每笔订单仅可使用一张优惠券\n\n如有其他问题请继续咨询。';
  }
  if (msg.includes('vip') || msg.includes('会员')) {
    return 'VIP会员权益包括：\n\n1. 专属优惠价格\n2. 优先发货\n3. 专属客服通道\n4. 积分加速累积\n\n您可以在"我的"页面查看VIP详情和开通方式。';
  }
  return '感谢您的咨询！我已收到您的问题，正在为您分析中。\n\n如果需要人工客服，请点击右上角转人工按钮。还有什么可以帮您的吗？';
}
