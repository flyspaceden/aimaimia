/**
 * 账号注销（Account Deletion）业务域模型
 *
 * 对应后端接口：
 * - `GET  /api/v1/me/deletion/preview`   → 注销预览（阻塞项 + 资产快照 + 核验方式）
 * - `POST /api/v1/me/deletion/sms-code`  → 发送注销短信验证码（identityVerify=SMS 时）
 * - `POST /api/v1/me/deletion/execute`   → 执行注销
 *
 * 字段与后端 DeletionController/DeletionService 返回保持一一对应。
 */

/** 注销阻塞项编码（任一存在即不可注销，需用户先处理） */
export type AccountDeletionBlockerCode =
  | 'IS_COMPANY_OWNER' // 企业 OWNER 须先转让企业
  | 'USER_NOT_ACTIVE' // 账号状态非 ACTIVE 或已注销
  | 'ACTIVE_CHECKOUT_EXISTS' // 存在支付中 / 确认中的结算会话
  | 'PENDING_PAYMENT_EXISTS' // 存在待支付 / 处理中的支付
  | 'WITHDRAW_PROCESSING_EXISTS'; // 存在在途提现

/** 单条注销阻塞项 */
export interface AccountDeletionBlocker {
  /** 阻塞项编码 */
  code: AccountDeletionBlockerCode;
  /** 面向用户的提示文案 */
  message: string;
  /** 触发该阻塞项的数量（如在途订单 / 提现条数） */
  count: number;
}

/** 注销时将被清零 / 作废的资产快照 */
export interface AccountDeletionAssets {
  /** 消费积分 */
  points: number;
  /** 优惠券（红包）数量 */
  coupons: number;
  /** 可提现奖励余额 */
  withdrawableRewards: number;
  /** 冻结中奖励余额 */
  frozenRewards: number;
  /** 抽奖名额 */
  lotteryQuota: number;
  /** 在途提现金额 */
  pendingWithdrawAmount: number;
  /** 进行中的结算会话数量 */
  activeCheckoutCount: number;
}

/** 注销不阻断、仅告知用户的进行中事项 */
export interface AccountDeletionPending {
  /** 已付款订单数量（继续履约，不退款） */
  paidOrders: number;
  /** 进行中售后数量（继续受理） */
  activeAfterSales: number;
}

/** 身份核验方式：绑定手机号走短信，仅微信走弹窗输入四字 */
export type AccountDeletionIdentityVerify = 'SMS' | 'WECHAT_MODAL';

/** 注销预览结果 */
export interface AccountDeletionPreview {
  /** 是否可注销（无任何阻塞项时为 true） */
  canDelete: boolean;
  /** 阻塞项列表 */
  blockers: AccountDeletionBlocker[];
  /** 将被清零 / 作废的资产快照 */
  assets: AccountDeletionAssets;
  /** 进行中事项（仅告知不阻断） */
  pending: AccountDeletionPending;
  /** 身份核验方式 */
  identityVerify: AccountDeletionIdentityVerify;
  /** 脱敏手机号（identityVerify=SMS 时返回，如 "138****1234"） */
  maskedPhone?: string;
}

/** 执行注销的请求体 */
export interface AccountDeletionExecutePayload {
  /** 确认方式：与 preview.identityVerify 对应 */
  confirmationMethod: AccountDeletionIdentityVerify;
  /** 短信验证码（SMS 必填） */
  smsCode?: string;
  /** 弹窗确认文案（WECHAT_MODAL 必填，须 === '确认注销'） */
  modalConfirmText?: string;
  /** 须显式 true：用户已阅读并同意注销须知 */
  acknowledgedNotice: true;
}

/** 执行注销的返回结果 */
export interface AccountDeletionExecuteResult {
  /** 是否成功 */
  ok: boolean;
  /** 结果提示文案 */
  message: string;
}
