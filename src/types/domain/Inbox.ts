/**
 * 域模型：消息中心（Inbox）
 *
 * 用途：
 * - 承接互动/交易/系统消息；支持未读角标与跳转
 *
 * 后端接入建议：
 * - 新通知统一携带 routeKey + params；旧 route + params 仅做兼容，不应继续扩展
 */
export type InboxCategory =
  // 旧 Inbox 分类
  | 'interaction'
  | 'transaction'
  | 'system'
  // NotificationMessage canonical 分类
  | 'order'
  | 'after_sale'
  | 'wallet'
  | 'group_buy'
  | 'service'
  | 'risk';

export type InboxType =
  | 'expert_reply'
  | 'tip_paid'
  | 'cooperation_update'
  | 'like'
  | 'comment'
  | 'follow'
  | 'order_update'
  | 'booking_update'
  // C12: 钱相关事件
  | 'reward_credited'
  | 'reward_unfrozen'
  | 'reward_expired'
  | 'withdraw_approved'
  | 'withdraw_rejected'
  | 'vip_referral_bonus'
  | 'refund_credited'
  | 'coupon_granted'
  | 'coupon_expired'
  // 平台运营消息
  | 'platform_announcement'
  | 'platform_notice'
  | 'cs_outreach_invite'
  // 卖家通知
  | 'new_order'
  | 'stock_shortage'
  | 'vip_activated'
  | 'order_receiver_info_required'
  | string;

export type InboxRouteKey =
  | 'ORDER_DETAIL'
  | 'ORDER_TRACK'
  | 'AFTER_SALE_DETAIL'
  | 'INVOICE_DETAIL'
  | 'WALLET'
  | 'COUPONS'
  | 'DIGITAL_ASSETS'
  | 'GROUP_BUY_DETAIL'
  | 'CS_SESSION'
  | 'ORDER_RECEIVER_INFO'
  | string;

export type LegacyInboxTarget = {
  route: string;
  params?: Record<string, string>;
};

export type InboxAction = {
  routeKey: InboxRouteKey;
  params?: Record<string, string>;
};

export type InboxTarget = LegacyInboxTarget | InboxAction;

export type InboxMessage = {
  id: string;
  category: InboxCategory;
  type: InboxType;
  title: string;
  content: string;
  createdAt: string;
  unread: boolean;
  target?: InboxTarget;
  action?: InboxAction;
};
