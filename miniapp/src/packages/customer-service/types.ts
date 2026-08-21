export type CsSessionStatus = 'AI_HANDLING' | 'QUEUING' | 'AGENT_HANDLING' | 'CLOSED';
export type CsSessionSource = 'MY_PAGE' | 'ORDER_DETAIL' | 'AFTERSALE_DETAIL' | 'ADMIN_OUTREACH';
export type CsSessionScope = 'active' | 'history' | 'all';
export type CsMessageSender = 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
export type CsContentType = 'TEXT' | 'RICH_CARD' | 'ACTION_CONFIRM' | 'ACTION_RESULT' | 'IMAGE';

export type CsMessage = {
  id: string;
  sessionId: string;
  senderType: CsMessageSender;
  senderId?: string;
  contentType: CsContentType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  _status?: 'sending' | 'sent' | 'failed';
};

export type CsQuickEntry = {
  id: string;
  type: 'QUICK_ACTION' | 'HOT_QUESTION';
  label: string;
  action?: string;
  message?: string;
  icon?: string;
};

export type CsSessionSummary = {
  id: string;
  status: CsSessionStatus;
  source: CsSessionSource;
  sourceId?: string | null;
  agentId?: string | null;
  agentJoinedAt?: string | null;
  buyerLastReadAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  unreadCount: number;
  lastMessage: CsMessage | null;
};

export type CsRatingSummary = {
  id: string;
  score: number;
  tags: string[];
  comment?: string | null;
  createdAt: string;
};

export type CsSessionDetail = Pick<CsSessionSummary, 'id' | 'status' | 'source' | 'sourceId' | 'agentId' | 'closedAt'> & {
  rating: CsRatingSummary | null;
};
export type CsSessionListResult = { items: CsSessionSummary[]; page: number; pageSize: number };
export type CsSessionInfo = { sessionId: string; isExisting: boolean };
export type CsSendMessageResult = {
  userMessage: CsMessage;
  aiReply: CsMessage | null;
  transferred: boolean;
};
