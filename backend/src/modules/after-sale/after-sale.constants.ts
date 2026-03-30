/**
 * 售后系统常量定义
 * 包含配置键、默认值、状态集合
 */

// 售后系统配置键（对应 RuleConfig 表的 key）
export const AFTER_SALE_CONFIG_KEYS = {
  /** 无理由退货窗口（天） */
  RETURN_WINDOW_DAYS: 'RETURN_WINDOW_DAYS',
  /** 普通退货窗口（天） */
  NORMAL_RETURN_DAYS: 'NORMAL_RETURN_DAYS',
  /** 生鲜退货窗口（小时） */
  FRESH_RETURN_HOURS: 'FRESH_RETURN_HOURS',
  /** 免退货退款金额门槛（元），低于此值无需寄回 */
  RETURN_NO_SHIP_THRESHOLD: 'RETURN_NO_SHIP_THRESHOLD',
  /** 卖家审核超时（天） */
  SELLER_REVIEW_TIMEOUT_DAYS: 'SELLER_REVIEW_TIMEOUT_DAYS',
  /** 买家退货寄回超时（天） */
  BUYER_SHIP_TIMEOUT_DAYS: 'BUYER_SHIP_TIMEOUT_DAYS',
  /** 卖家签收退货超时（天） */
  SELLER_RECEIVE_TIMEOUT_DAYS: 'SELLER_RECEIVE_TIMEOUT_DAYS',
  /** 买家确认收货超时（天） */
  BUYER_CONFIRM_TIMEOUT_DAYS: 'BUYER_CONFIRM_TIMEOUT_DAYS',
} as const;

// 配置默认值（当 RuleConfig 表中不存在对应 key 时使用）
export const AFTER_SALE_CONFIG_DEFAULTS: Record<string, number> = {
  RETURN_WINDOW_DAYS: 7,
  NORMAL_RETURN_DAYS: 7,
  FRESH_RETURN_HOURS: 24,
  RETURN_NO_SHIP_THRESHOLD: 50,
  SELLER_REVIEW_TIMEOUT_DAYS: 3,
  BUYER_SHIP_TIMEOUT_DAYS: 7,
  SELLER_RECEIVE_TIMEOUT_DAYS: 7,
  BUYER_CONFIRM_TIMEOUT_DAYS: 7,
};

// 「进行中」状态集合 — 用于防重复申请、Cron 超时判断
export const ACTIVE_STATUSES = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PENDING_ARBITRATION',
  'RETURN_SHIPPING',
  'RECEIVED_BY_SELLER',
  'SELLER_REJECTED_RETURN',
  'REFUNDING',
  'REPLACEMENT_SHIPPED',
] as const;

// 「终态」状态集合 — 售后流程已结束
export const TERMINAL_STATUSES = [
  'REFUNDED',
  'COMPLETED',
  'CLOSED',
  'CANCELED',
  'REJECTED',
] as const;

// 售后成功终态 — 触发奖励归平台逻辑
export const SUCCESS_STATUSES = ['REFUNDED', 'COMPLETED'] as const;
