import { CsContentType, CsMessageSender, CsSessionSource, CsTicketCategory } from '@prisma/client';

/** Socket.IO event: client sends message */
export interface CsSendPayload {
  sessionId: string;
  content: string;
  contentType?: CsContentType;
  metadata?: Record<string, unknown>;
}

/** Socket.IO event: server pushes message */
export interface CsMessagePayload {
  id: string;
  sessionId: string;
  senderType: CsMessageSender;
  senderId?: string;
  contentType: CsContentType;
  content: string;
  metadata?: Record<string, unknown>;
  routeLayer?: number;
  createdAt: string;
}

/** Socket.IO event: agent joined */
export interface CsAgentJoinedPayload {
  sessionId: string;
  agentName: string;
}

/** Socket.IO event: new ticket in lobby */
export interface CsNewTicketPayload {
  sessionId: string;
  userId: string;
  userNickname: string;
  category: CsTicketCategory;
  summary?: string;
  waitingSince: string;
}

/** Socket.IO event: typing indicator */
export interface CsTypingPayload {
  sessionId: string;
  senderType: CsMessageSender;
}

/** Routing result from CsRoutingService */
export interface CsRouteResult {
  layer: 1 | 2 | 3;
  reply?: string;
  contentType?: CsContentType;
  metadata?: Record<string, unknown>;
  shouldTransferToAgent: boolean;
  aiIntent?: string;
  aiConfidence?: number;
}

/** Context passed to AI for customer service */
export interface CsAiContext {
  source: CsSessionSource;
  orderId?: string;
  afterSaleId?: string;
  orderInfo?: Record<string, unknown>;
  afterSaleInfo?: Record<string, unknown>;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
}
