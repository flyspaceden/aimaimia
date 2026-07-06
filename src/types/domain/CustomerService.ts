/**
 * 客服系统（Customer Service）业务域类型
 *
 * 用于买家 App 智能客服会话、快捷入口、消息展示等场景
 */

/** 客服快捷入口（快捷操作 + 热门问题） */
export interface CsQuickEntry {
  id: string;
  type: 'QUICK_ACTION' | 'HOT_QUESTION';
  label: string;
  action?: string;
  message?: string;
  icon?: string;
}

/** 客服会话信息 */
export interface CsSessionInfo {
  sessionId: string;
  isExisting: boolean;
}

/** 客服消息 */
export interface CsMessage {
  id: string;
  sessionId: string;
  senderType: 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
  senderId?: string;
  contentType: 'TEXT' | 'RICH_CARD' | 'ACTION_CONFIRM' | 'ACTION_RESULT' | 'IMAGE';
  content: string;
  metadata?: Record<string, unknown>;
  routeLayer?: number;
  createdAt: string;
}

export type CsSessionStatus = 'AI_HANDLING' | 'QUEUING' | 'AGENT_HANDLING' | 'CLOSED';

export type CsSessionSource = 'MY_PAGE' | 'ORDER_DETAIL' | 'AFTERSALE_DETAIL' | 'ADMIN_OUTREACH';

export type CsSessionListScope = 'active' | 'history' | 'all';

export interface CsSessionTicketSummary {
  id: string;
  category?: string;
  priority?: string;
}

/** 买家客服会话列表项 */
export interface CsSessionSummary {
  id: string;
  status: CsSessionStatus;
  source: CsSessionSource;
  sourceId?: string | null;
  agentId?: string | null;
  agentJoinedAt?: string | null;
  buyerLastReadAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  ticket?: CsSessionTicketSummary | null;
  lastMessage: CsMessage | null;
  unreadCount: number;
}

export interface CsSessionListResult {
  items: CsSessionSummary[];
  page: number;
  pageSize: number;
}

/** 发送消息后端返回结构 */
export interface CsSendMessageResult {
  userMessage: CsMessage;
  aiReply: CsMessage | null;
  transferred: boolean;
}
