/**
 * 域模型：消息中心（Inbox）
 *
 * 用途：
 * - 承接互动/交易/系统消息；支持未读角标与跳转
 *
 * 后端接入建议：
 * - 每条消息建议携带可跳转目标（route + params），避免前端 hardcode（见 `说明文档/后端接口清单.md#55-消息中心`）
 */
export type InboxCategory = 'interaction' | 'transaction' | 'system';

export type InboxType =
  | 'expert_reply'
  | 'tip_paid'
  | 'cooperation_update'
  | 'like'
  | 'comment'
  | 'follow'
  | 'order_update'
  | 'booking_update';

export type InboxTarget = {
  route: string;
  params?: Record<string, string>;
};

export type InboxMessage = {
  id: string;
  category: InboxCategory;
  type: InboxType;
  title: string;
  content: string;
  createdAt: string;
  unread: boolean;
  target?: InboxTarget;
};
