import client from './client';

// --- Types ---

export interface CsSession {
  id: string;
  ticketId: string | null;
  userId: string;
  status: 'AI_HANDLING' | 'QUEUING' | 'AGENT_HANDLING' | 'CLOSED';
  source: string;
  sourceId: string | null;
  agentId: string | null;
  agentJoinedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  user: { id: string; profile: { nickname: string | null; avatarUrl: string | null } | null };
  messages: CsMessage[];
  ticket: { id: string; category: string; priority: string } | null;
}

export interface CsMessage {
  id: string;
  sessionId: string;
  senderType: 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
  senderId: string | null;
  contentType: 'TEXT' | 'RICH_CARD' | 'ACTION_CONFIRM' | 'ACTION_RESULT' | 'IMAGE';
  content: string;
  metadata: Record<string, unknown> | null;
  routeLayer: number | null;
  createdAt: string;
}

export interface CsTicket {
  id: string;
  userId: string;
  category: string;
  priority: string;
  status: string;
  summary: string | null;
  relatedOrderId: string | null;
  resolvedBy: string | null;
  createdAt: string;
  user: { id: string; profile: { nickname: string | null } | null };
  sessions: { id: string; status: string; createdAt: string }[];
}

export interface CsFaq {
  id: string;
  keywords: string[];
  pattern: string | null;
  answer: string;
  answerType: 'TEXT' | 'RICH_CARD';
  metadata: Record<string, unknown> | null;
  priority: number;
  enabled: boolean;
  sortOrder: number;
}

export interface CsQuickEntry {
  id: string;
  type: 'QUICK_ACTION' | 'HOT_QUESTION';
  label: string;
  action: string | null;
  message: string | null;
  icon: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface CsQuickReply {
  id: string;
  category: string;
  title: string;
  content: string;
  sortOrder: number;
  enabled: boolean;
}

export interface CsStats {
  totalSessions: number;
  aiResolveRate: number;
  agentHandled: number;
  avgRating: number;
  queueCount: number;
}

// --- API Functions ---
export const getCsSessions = (params?: { status?: string; page?: number }): Promise<CsSession[]> =>
  client.get('/admin/cs/sessions', { params });

export const getCsSessionDetail = (id: string): Promise<CsSession> =>
  client.get(`/admin/cs/sessions/${id}`);

export const getCsTickets = (params?: Record<string, string | number>): Promise<{ items: CsTicket[]; total: number }> =>
  client.get('/admin/cs/tickets', { params });

export const updateCsTicket = (id: string, data: Record<string, string>): Promise<CsTicket> =>
  client.patch(`/admin/cs/tickets/${id}`, data);

export const getCsFaqs = (): Promise<CsFaq[]> =>
  client.get('/admin/cs/faq');

export const createCsFaq = (data: Partial<CsFaq>): Promise<CsFaq> =>
  client.post('/admin/cs/faq', data);

export const updateCsFaq = (id: string, data: Partial<CsFaq>): Promise<CsFaq> =>
  client.patch(`/admin/cs/faq/${id}`, data);

export const deleteCsFaq = (id: string): Promise<void> =>
  client.delete(`/admin/cs/faq/${id}`);

export const testCsFaq = (message: string): Promise<{ answer: string } | null> =>
  client.post('/admin/cs/faq/test', { message });

export const getCsQuickEntries = (): Promise<CsQuickEntry[]> =>
  client.get('/admin/cs/quick-entries');

export const createCsQuickEntry = (data: Partial<CsQuickEntry>): Promise<CsQuickEntry> =>
  client.post('/admin/cs/quick-entries', data);

export const updateCsQuickEntry = (id: string, data: Partial<CsQuickEntry>): Promise<CsQuickEntry> =>
  client.patch(`/admin/cs/quick-entries/${id}`, data);

export const deleteCsQuickEntry = (id: string): Promise<void> =>
  client.delete(`/admin/cs/quick-entries/${id}`);

export const sortCsQuickEntries = (items: { id: string; sortOrder: number }[]): Promise<void> =>
  client.patch('/admin/cs/quick-entries/sort', { items });

export const getCsQuickReplies = (): Promise<CsQuickReply[]> =>
  client.get('/admin/cs/quick-replies');

export const createCsQuickReply = (data: Partial<CsQuickReply>): Promise<CsQuickReply> =>
  client.post('/admin/cs/quick-replies', data);

export const updateCsQuickReply = (id: string, data: Partial<CsQuickReply>): Promise<CsQuickReply> =>
  client.patch(`/admin/cs/quick-replies/${id}`, data);

export const deleteCsQuickReply = (id: string): Promise<void> =>
  client.delete(`/admin/cs/quick-replies/${id}`);

export const getCsStats = (): Promise<CsStats> =>
  client.get('/admin/cs/stats');

export const getCsAgentStatus = (): Promise<any[]> =>
  client.get('/admin/cs/agent-status');
