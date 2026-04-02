/**
 * 域模型：深度互动（专家提问/打赏/合作）
 *
 * 用途：
 * - 帖子详情页的深度互动入口与状态追踪（建议进入消息中心）
 */
export type TipMethod = 'wechat' | 'alipay';

export type ExpertQuestionStatus = 'submitted' | 'assigned' | 'answered';

export type ExpertQuestionTimelineItem = {
  status: ExpertQuestionStatus;
  label: string;
  time: string;
};

export type ExpertReply = {
  id: string;
  responder: string;
  content: string;
  createdAt: string;
};

export type ExpertQuestionTicket = {
  id: string;
  postId: string;
  question: string;
  contact?: string;
  status: ExpertQuestionStatus;
  timeline: ExpertQuestionTimelineItem[];
  replies: ExpertReply[];
};

export type TipOrderStatus = 'created' | 'paying' | 'paid' | 'failed';

export type TipOrder = {
  id: string;
  postId: string;
  amount: number;
  method: TipMethod;
  status: TipOrderStatus;
  createdAt: string;
  paidAt?: string;
};

export type ExpertQuestionPayload = {
  postId: string;
  question: string;
  contact?: string;
};

export type TipPayload = {
  postId: string;
  amount: number;
  method: TipMethod;
  message?: string;
};

export type CooperationIntentPayload = {
  postId: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  message?: string;
};
