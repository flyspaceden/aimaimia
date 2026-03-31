/** 全局状态颜色/文字映射，集中管理避免各页面重复定义 */

type StatusEntry = { text: string; color: string };

// 商品上下架状态
export const productStatusMap: Record<string, StatusEntry> = {
  ACTIVE: { text: '上架', color: 'green' },
  INACTIVE: { text: '下架', color: 'default' },
  DRAFT: { text: '草稿', color: 'blue' },
};

// 审核状态（商品/企业通用）
export const auditStatusMap: Record<string, StatusEntry> = {
  PENDING: { text: '待审核', color: 'orange' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
};

// 订单状态
export const orderStatusMap: Record<string, StatusEntry> = {
  PENDING_PAYMENT: { text: '待付款', color: 'default' },
  PAID: { text: '已付款', color: 'blue' },
  SHIPPED: { text: '已发货', color: 'cyan' },
  DELIVERED: { text: '已送达', color: 'green' },
  RECEIVED: { text: '已收货', color: 'green' },
  CANCELED: { text: '已取消', color: 'default' },
  REFUNDED: { text: '已退款', color: 'red' },
};

// 企业状态
export const companyStatusMap: Record<string, StatusEntry> = {
  PENDING: { text: '待审核', color: 'orange' },
  ACTIVE: { text: '正常', color: 'green' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
  SUSPENDED: { text: '已暂停', color: 'default' },
};

// 买家用户状态
export const userStatusMap: Record<string, StatusEntry> = {
  ACTIVE: { text: '正常', color: 'green' },
  BANNED: { text: '已封禁', color: 'red' },
  DELETED: { text: '已注销', color: 'default' },
};

// 提现状态
export const withdrawalStatusMap: Record<string, StatusEntry> = {
  REQUESTED: { text: '待审核', color: 'orange' },
  APPROVED: { text: '已批准', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
  PAID: { text: '已打款', color: 'blue' },
  FAILED: { text: '打款失败', color: 'volcano' },
};

// 退款状态
export const refundStatusMap: Record<string, StatusEntry> = {
  REQUESTED: { text: '待处理', color: 'orange' },
  APPROVED: { text: '已同意', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
  REFUNDING: { text: '退款中', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'cyan' },
  FAILED: { text: '退款失败', color: 'volcano' },
};

// 会员等级颜色
export const memberTierColors: Record<string, string> = {
  NORMAL: 'default',
  VIP: 'gold',
};

// 换货状态
export const replacementStatusMap: Record<string, StatusEntry> = {
  REQUESTED: { text: '待处理', color: 'orange' },
  UNDER_REVIEW: { text: '审核中', color: 'purple' },
  APPROVED: { text: '已同意', color: 'blue' },
  REJECTED: { text: '已拒绝', color: 'red' },
  SHIPPED: { text: '换货中', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'green' },
};

// 红包活动状态
export const couponCampaignStatusMap: Record<string, StatusEntry> = {
  DRAFT: { text: '草稿', color: 'default' },
  ACTIVE: { text: '进行中', color: 'green' },
  PAUSED: { text: '已暂停', color: 'orange' },
  ENDED: { text: '已结束', color: 'red' },
};

// 红包实例状态
export const couponInstanceStatusMap: Record<string, StatusEntry> = {
  AVAILABLE: { text: '可用', color: 'green' },
  RESERVED: { text: '锁定中', color: 'blue' },
  USED: { text: '已使用', color: 'default' },
  EXPIRED: { text: '已过期', color: 'red' },
  REVOKED: { text: '已撤回', color: 'volcano' },
};

// 红包触发类型
export const couponTriggerTypeMap: Record<string, StatusEntry> = {
  REGISTER: { text: '新用户注册', color: 'blue' },
  FIRST_ORDER: { text: '首次下单', color: 'cyan' },
  BIRTHDAY: { text: '生日', color: 'magenta' },
  CHECK_IN: { text: '签到', color: 'green' },
  INVITE: { text: '邀请新用户', color: 'purple' },
  REVIEW: { text: '好评', color: 'gold' },
  SHARE: { text: '分享', color: 'lime' },
  CUMULATIVE_SPEND: { text: '累计消费', color: 'orange' },
  WIN_BACK: { text: '复购激励', color: 'volcano' },
  HOLIDAY: { text: '节日活动', color: 'red' },
  FLASH: { text: '限时抢', color: 'geekblue' },
  MANUAL: { text: '手动发放', color: 'default' },
};

// 红包发放方式
export const couponDistributionModeMap: Record<string, StatusEntry> = {
  AUTO: { text: '系统自动', color: 'blue' },
  CLAIM: { text: '用户领取', color: 'green' },
  MANUAL: { text: '管理员发放', color: 'orange' },
};

// 红包抵扣类型
export const couponDiscountTypeMap: Record<string, StatusEntry> = {
  FIXED: { text: '固定金额', color: 'blue' },
  PERCENT: { text: '百分比折扣', color: 'green' },
};

// 支付方式
export const paymentMethodMap: Record<string, StatusEntry> = {
  WECHAT: { text: '微信支付', color: 'green' },
  ALIPAY: { text: '支付宝', color: 'blue' },
  BALANCE: { text: '余额支付', color: 'orange' },
  COD: { text: '货到付款', color: 'default' },
};

// 支付渠道（对应后端 PaymentChannel 枚举）
export const paymentChannelMap: Record<string, StatusEntry> = {
  WECHAT_PAY: { text: '微信支付', color: 'green' },
  ALIPAY: { text: '支付宝', color: 'blue' },
  UNIONPAY: { text: '银联支付', color: 'purple' },
  AGGREGATOR: { text: '聚合支付', color: 'cyan' },
};

// 订单售后状态（根据订单状态推断，旧兼容映射）
export const orderAfterSaleStatusMap: Record<string, StatusEntry> = {
  NONE: { text: '-', color: 'default' },
  REFUNDED: { text: '已退款', color: 'red' },
  CANCELED: { text: '已取消', color: 'default' },
};

// 统一售后申请状态（AfterSaleStatus 枚举，14 状态）
export const afterSaleStatusMap: Record<string, StatusEntry> = {
  REQUESTED: { text: '待处理', color: 'orange' },
  UNDER_REVIEW: { text: '审核中', color: 'purple' },
  APPROVED: { text: '已批准', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  PENDING_ARBITRATION: { text: '等待仲裁', color: 'magenta' },
  RETURN_SHIPPING: { text: '退货寄回中', color: 'cyan' },
  RECEIVED_BY_SELLER: { text: '卖家已收货', color: 'geekblue' },
  SELLER_REJECTED_RETURN: { text: '验收不合格', color: 'volcano' },
  REFUNDING: { text: '退款中', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'green' },
  REPLACEMENT_SHIPPED: { text: '换货已发出', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'green' },
  CLOSED: { text: '已关闭', color: 'default' },
  CANCELED: { text: '已取消', color: 'default' },
};

// 统一售后类型（AfterSaleType 枚举）
export const afterSaleTypeMap: Record<string, StatusEntry> = {
  NO_REASON_RETURN: { text: '七天无理由退货', color: 'blue' },
  QUALITY_RETURN: { text: '质量问题退货', color: 'orange' },
  QUALITY_EXCHANGE: { text: '质量问题换货', color: 'purple' },
};

// 退货政策（ReturnPolicy 枚举）
export const returnPolicyMap: Record<string, StatusEntry> = {
  RETURNABLE: { text: '支持退货', color: 'green' },
  NON_RETURNABLE: { text: '不支持退货', color: 'red' },
  INHERIT: { text: '继承父分类', color: 'default' },
};

// 提现渠道
export const withdrawChannelMap: Record<string, StatusEntry> = {
  WECHAT: { text: '微信', color: 'green' },
  ALIPAY: { text: '支付宝', color: 'blue' },
  BANKCARD: { text: '银行卡', color: 'orange' },
};

// 奖励账户类型
export const rewardAccountTypeMap: Record<string, StatusEntry> = {
  VIP_REWARD: { text: 'VIP奖励', color: 'gold' },
  NORMAL_REWARD: { text: '普通奖励', color: 'cyan' },
};

// 审计日志操作类型颜色
export const auditActionColors: Record<string, string> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  STATUS_CHANGE: 'orange',
  LOGIN: 'default',
  LOGOUT: 'default',
  APPROVE: 'green',
  REJECT: 'red',
  REFUND: 'volcano',
  SHIP: 'cyan',
  CONFIG_CHANGE: 'purple',
  ROLLBACK: 'gold',
};
