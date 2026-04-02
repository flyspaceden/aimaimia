/**
 * 深度互动仓储（Repo）（当前为占位）
 *
 * 作用：
 * - 专家提问：提交问题 -> 分配专家 -> 专家回复（形成工单/消息）
 * - 打赏：创建订单 -> 发起支付 -> 支付确认（形成订单/消息）
 * - 合作意向：提交意向（形成线索/消息）
 *
 * 后端接入说明：
 * - 这三类动作都建议进入“消息中心/工单系统”，便于用户在“我的-消息”里追踪进度
 * - 支付（打赏/参团/众筹）需要微信/支付宝；支付结果以回调为准
 * - 建议接口见：`说明文档/后端接口清单.md#45-深度互动专家提问打赏合作意向`
 */
import {
  CooperationIntentPayload,
  ExpertQuestionPayload,
  ExpertQuestionStatus,
  ExpertQuestionTicket,
  ExpertReply,
  Result,
  TipOrder,
  TipOrderStatus,
  TipPayload,
} from '../types';
import { createAppError, simulateRequest } from './helpers';
import { err } from '../types';

// 深度互动仓储：专家提问/打赏/合作意向提交（占位）
const expertTickets = new Map<string, ExpertQuestionTicket>();
const tipOrders = new Map<string, TipOrder>();

const expertStatusLabels: Record<ExpertQuestionStatus, string> = {
  submitted: '已提交',
  assigned: '分配专家',
  answered: '已回复',
};

const formatTime = () => new Date().toLocaleString();

const buildTimelineItem = (status: ExpertQuestionStatus) => ({
  status,
  label: expertStatusLabels[status],
  time: formatTime(),
});

const ensureTimeline = (ticket: ExpertQuestionTicket, status: ExpertQuestionStatus) => {
  if (ticket.timeline.some((item) => item.status === status)) {
    return ticket.timeline;
  }
  return [...ticket.timeline, buildTimelineItem(status)];
};

const updateTicketStatus = (ticket: ExpertQuestionTicket, status: ExpertQuestionStatus) => ({
  ...ticket,
  status,
  timeline: ensureTimeline(ticket, status),
});

const buildExpertReply = (question: string): ExpertReply => ({
  id: `reply-${Date.now()}`,
  responder: '企业专家',
  content: `已收到你的问题：“${question}”。建议关注土壤水分与温度变化，后续可补充具体品种与产地信息。`,
  createdAt: formatTime(),
});

const buildTipOrder = (payload: TipPayload, status: TipOrderStatus): TipOrder => ({
  id: `tip-${Date.now()}`,
  postId: payload.postId,
  amount: payload.amount,
  method: payload.method,
  status,
  createdAt: formatTime(),
});

export const InteractionRepo = {
  // 提交专家提问，生成咨询单
  /**
   * 提交专家提问
   * - 后端建议：`POST /api/v1/interactions/expert-questions`
   * - body：`{ postId, question, contact? }`
   */
  submitExpertQuestion: async (payload: ExpertQuestionPayload): Promise<Result<ExpertQuestionTicket>> => {
    const ticket: ExpertQuestionTicket = {
      id: `question-${Date.now()}`,
      postId: payload.postId,
      question: payload.question,
      contact: payload.contact,
      status: 'submitted',
      timeline: [buildTimelineItem('submitted')],
      replies: [],
    };
    expertTickets.set(ticket.id, ticket);
    return simulateRequest(ticket, { delay: 260, failRate: 0.08 });
  },
  // 分配专家（占位）：更新为“分配专家”
  /** 分配专家：`POST /api/v1/interactions/expert-questions/{ticketId}/assign`（运营/系统） */
  assignExpert: async (ticketId: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err(createAppError('NOT_FOUND', '咨询单不存在', '咨询单不存在'));
    }
    const updated = updateTicketStatus(ticket, 'assigned');
    expertTickets.set(ticketId, updated);
    return simulateRequest(updated, { delay: 420, failRate: 0.05 });
  },
  // 专家回复（占位）：生成回复内容
  /**
   * 专家回复
   * - 后端建议：`POST /api/v1/interactions/expert-questions/{ticketId}/reply`
   * - body：`{ reply }`
   */
  replyExpertQuestion: async (ticketId: string, reply?: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err(createAppError('NOT_FOUND', '咨询单不存在', '咨询单不存在'));
    }
    const answer = reply ? { ...buildExpertReply(ticket.question), content: reply } : buildExpertReply(ticket.question);
    const updated = updateTicketStatus(
      {
        ...ticket,
        replies: [...ticket.replies, answer],
      },
      'answered'
    );
    expertTickets.set(ticketId, updated);
    return simulateRequest(updated, { delay: 520, failRate: 0.06 });
  },
  // 获取咨询单详情（占位）
  /** 咨询单详情：`GET /api/v1/interactions/expert-questions/{ticketId}` */
  getExpertTicket: async (ticketId: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err(createAppError('NOT_FOUND', '咨询单不存在', '咨询单不存在'));
    }
    return simulateRequest(ticket, { delay: 200, failRate: 0.02 });
  },
  // 创建打赏订单（占位）
  /**
   * 创建打赏订单
   * - 后端建议：`POST /api/v1/interactions/tips`
   * - body：`{ postId, amount, method }`
   */
  createTipOrder: async (payload: TipPayload): Promise<Result<TipOrder>> => {
    const order = buildTipOrder(payload, 'created');
    tipOrders.set(order.id, order);
    return simulateRequest(order, { delay: 260, failRate: 0.06 });
  },
  // 发起支付（占位）：更新为“支付中”
  /** 发起支付：`POST /api/v1/interactions/tips/{orderId}/pay` */
  startTipPayment: async (orderId: string): Promise<Result<TipOrder>> => {
    const order = tipOrders.get(orderId);
    if (!order) {
      return err(createAppError('NOT_FOUND', '订单不存在', '订单不存在'));
    }
    const updated = { ...order, status: 'paying' as TipOrderStatus };
    tipOrders.set(orderId, updated);
    return simulateRequest(updated, { delay: 320, failRate: 0.08 });
  },
  // 确认支付结果（占位）
  /** 确认支付结果：`POST /api/v1/interactions/tips/{orderId}/confirm` */
  confirmTipPayment: async (orderId: string): Promise<Result<TipOrder>> => {
    const order = tipOrders.get(orderId);
    if (!order) {
      return err(createAppError('NOT_FOUND', '订单不存在', '订单不存在'));
    }
    const updated = { ...order, status: 'paid' as TipOrderStatus, paidAt: formatTime() };
    tipOrders.set(orderId, updated);
    return simulateRequest(updated, { delay: 360, failRate: 0.05 });
  },
  // 原有简化接口保留，便于兼容
  /** 兼容旧接口（建议后续删除）：打赏直接返回 id */
  sendTip: async (payload: TipPayload): Promise<Result<{ id: string }>> => {
    return simulateRequest({ id: `tip-${Date.now()}` }, { delay: 220 });
  },
  /** 提交合作意向：`POST /api/v1/interactions/cooperation-intents` */
  submitCooperationIntent: async (payload: CooperationIntentPayload): Promise<Result<{ id: string }>> => {
    return simulateRequest({ id: `coop-${Date.now()}` }, { delay: 220 });
  },
};
