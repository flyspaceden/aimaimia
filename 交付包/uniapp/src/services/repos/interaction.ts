// 深度互动仓库：专家提问/打赏/合作意向接口占位
import type { Result } from '../types';

export type ExpertQuestionStatus = 'submitted' | 'assigned' | 'answered';
export type TipOrderStatus = 'created' | 'paying' | 'paid';

export type ExpertReply = {
  id: string;
  responder: string;
  content: string;
  createdAt: string;
};

export type ExpertTimelineItem = {
  status: ExpertQuestionStatus;
  label: string;
  time: string;
};

export type ExpertQuestionTicket = {
  id: string;
  postId: string;
  question: string;
  contact?: string;
  status: ExpertQuestionStatus;
  timeline: ExpertTimelineItem[];
  replies: ExpertReply[];
};

export type TipPayload = {
  postId: string;
  amount: number;
  method: 'wechat' | 'alipay';
  message?: string;
};

export type TipOrder = {
  id: string;
  postId: string;
  amount: number;
  method: 'wechat' | 'alipay';
  status: TipOrderStatus;
  createdAt: string;
  paidAt?: string;
};

export type ExpertQuestionPayload = {
  postId: string;
  question: string;
  contact?: string;
};

export type CooperationIntentPayload = {
  postId: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  message?: string;
};

const expertTickets = new Map<string, ExpertQuestionTicket>();
const tipOrders = new Map<string, TipOrder>();

const expertStatusLabels: Record<ExpertQuestionStatus, string> = {
  submitted: '已提交',
  assigned: '分配专家',
  answered: '已回复',
};

const formatTime = () => new Date().toLocaleString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = async <T>(data: T, delay = 220): Promise<Result<T>> => {
  await sleep(delay);
  return { ok: true, data };
};
const err = (message: string, code = 'INVALID'): Result<never> => ({
  ok: false,
  error: { code, message },
});

const buildTimelineItem = (status: ExpertQuestionStatus): ExpertTimelineItem => ({
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
  /**
   * 提交专家提问
   * - 后端建议：`POST /api/v1/interactions/expert-questions`
   * - body：`{ postId, question, contact? }`
   */
  submitExpertQuestion: async (payload: ExpertQuestionPayload): Promise<Result<ExpertQuestionTicket>> => {
    if (!payload.question || payload.question.trim().length < 5) {
      return err('问题至少 5 字');
    }
    const ticket: ExpertQuestionTicket = {
      id: `question-${Date.now()}`,
      postId: payload.postId,
      question: payload.question.trim(),
      contact: payload.contact?.trim() || undefined,
      status: 'submitted',
      timeline: [buildTimelineItem('submitted')],
      replies: [],
    };
    expertTickets.set(ticket.id, ticket);
    return ok(ticket, 260);
  },
  /** 分配专家：`POST /api/v1/interactions/expert-questions/{ticketId}/assign`（运营/系统） */
  assignExpert: async (ticketId: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err('咨询单不存在', 'NOT_FOUND');
    }
    const updated = updateTicketStatus(ticket, 'assigned');
    expertTickets.set(ticketId, updated);
    return ok(updated, 320);
  },
  /**
   * 专家回复
   * - 后端建议：`POST /api/v1/interactions/expert-questions/{ticketId}/reply`
   */
  replyExpertQuestion: async (ticketId: string, reply?: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err('咨询单不存在', 'NOT_FOUND');
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
    return ok(updated, 360);
  },
  /** 咨询单详情：`GET /api/v1/interactions/expert-questions/{ticketId}` */
  getExpertTicket: async (ticketId: string): Promise<Result<ExpertQuestionTicket>> => {
    const ticket = expertTickets.get(ticketId);
    if (!ticket) {
      return err('咨询单不存在', 'NOT_FOUND');
    }
    return ok(ticket, 200);
  },
  /**
   * 创建打赏订单
   * - 后端建议：`POST /api/v1/interactions/tips`
   */
  createTipOrder: async (payload: TipPayload): Promise<Result<TipOrder>> => {
    if (payload.amount <= 0) {
      return err('请输入打赏金额');
    }
    const order = buildTipOrder(payload, 'created');
    tipOrders.set(order.id, order);
    return ok(order, 260);
  },
  /** 发起支付：`POST /api/v1/interactions/tips/{orderId}/pay` */
  startTipPayment: async (orderId: string): Promise<Result<TipOrder>> => {
    const order = tipOrders.get(orderId);
    if (!order) {
      return err('订单不存在', 'NOT_FOUND');
    }
    const updated = { ...order, status: 'paying' as TipOrderStatus };
    tipOrders.set(orderId, updated);
    return ok(updated, 260);
  },
  /** 确认支付结果：`POST /api/v1/interactions/tips/{orderId}/confirm` */
  confirmTipPayment: async (orderId: string): Promise<Result<TipOrder>> => {
    const order = tipOrders.get(orderId);
    if (!order) {
      return err('订单不存在', 'NOT_FOUND');
    }
    const updated = { ...order, status: 'paid' as TipOrderStatus, paidAt: formatTime() };
    tipOrders.set(orderId, updated);
    return ok(updated, 260);
  },
  /**
   * 提交合作意向
   * - 后端建议：`POST /api/v1/interactions/cooperation-intents`
   */
  submitCooperationIntent: async (payload: CooperationIntentPayload): Promise<Result<{ id: string }>> => {
    if (!payload.companyName || !payload.contactName || !payload.contactPhone) {
      return err('请补全合作信息');
    }
    return ok({ id: `coop-${Date.now()}` }, 220);
  },
};
