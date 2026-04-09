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

/** 发送消息后端返回结构 */
export interface CsSendMessageResult {
  userMessage: CsMessage;
  aiReply: CsMessage | null;
  transferred: boolean;
}
