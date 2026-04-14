// 商品状态
export const productStatusMap: Record<string, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  ACTIVE: { text: '已上架', color: 'green' },
  INACTIVE: { text: '已下架', color: 'warning' },
};

// 商品审核状态
export const auditStatusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待审核', color: 'processing' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已驳回', color: 'error' },
};

// 订单状态（付款后建单架构：无 PENDING_PAYMENT；换货替代退款：无 ISSUE/REFUNDING）
export const orderStatusMap: Record<string, { text: string; color: string }> = {
  PAID: { text: '待发货', color: 'warning' },
  SHIPPED: { text: '已发货', color: 'processing' },
  DELIVERED: { text: '已送达', color: 'cyan' },
  RECEIVED: { text: '已收货', color: 'green' },
  CANCELED: { text: '已取消', color: 'default' },
  REFUNDED: { text: '已退款', color: 'error' },
};

// 退款状态
export const refundStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待处理', color: 'warning' },
  APPROVED: { text: '已同意', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'error' },
  REFUNDED: { text: '已退款', color: 'default' },
};

// 物流状态
export const shipmentStatusMap: Record<string, { text: string; color: string }> = {
  INIT: { text: '待发货', color: 'default' },
  IN_TRANSIT: { text: '运输中', color: 'processing' },
  DELIVERED: { text: '已送达', color: 'green' },
  EXCEPTION: { text: '异常', color: 'error' },
};

// 员工角色
export const staffRoleMap: Record<string, { text: string; color: string }> = {
  OWNER: { text: '企业主', color: 'gold' },
  MANAGER: { text: '经理', color: 'blue' },
  OPERATOR: { text: '运营', color: 'default' },
};

// 换货理由类型
export const replacementReasonMap: Record<string, { text: string; color: string }> = {
  QUALITY_ISSUE: { text: '质量问题', color: 'red' },
  WRONG_ITEM: { text: '发错商品', color: 'orange' },
  DAMAGED: { text: '运输损坏', color: 'volcano' },
  NOT_AS_DESCRIBED: { text: '与描述不符', color: 'gold' },
  SIZE_ISSUE: { text: '规格不符', color: 'cyan' },
  EXPIRED: { text: '临期/过期', color: 'magenta' },
  OTHER: { text: '其他', color: 'default' },
};

// 售后状态
export const afterSaleStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待审核', color: 'orange' },
  UNDER_REVIEW: { text: '审核中', color: 'purple' },
  APPROVED: { text: '已批准', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  PENDING_ARBITRATION: { text: '平台仲裁中', color: 'magenta' },
  RETURN_SHIPPING: { text: '退货寄回中', color: 'geekblue' },
  RECEIVED_BY_SELLER: { text: '卖家已收到', color: 'cyan' },
  SELLER_REJECTED_RETURN: { text: '验收不合格', color: 'volcano' },
  REFUNDING: { text: '退款处理中', color: 'gold' },
  REFUNDED: { text: '已退款', color: 'lime' },
  REPLACEMENT_SHIPPED: { text: '换货已发出', color: 'geekblue' },
  COMPLETED: { text: '已完成', color: 'green' },
  CLOSED: { text: '已关闭', color: 'default' },
  CANCELED: { text: '已取消', color: 'default' },
};

// 售后类型
export const afterSaleTypeMap: Record<string, { text: string; color: string }> = {
  NO_REASON_RETURN: { text: '七天无理由退货', color: 'blue' },
  QUALITY_RETURN: { text: '质量问题退货', color: 'orange' },
  QUALITY_EXCHANGE: { text: '质量问题换货', color: 'purple' },
};

// 售后原因类型（复用换货理由 + 售后特有理由）
export const afterSaleReasonMap: Record<string, { text: string; color: string }> = {
  QUALITY_ISSUE: { text: '质量问题', color: 'red' },
  WRONG_ITEM: { text: '发错商品', color: 'orange' },
  DAMAGED: { text: '运输损坏', color: 'volcano' },
  NOT_AS_DESCRIBED: { text: '与描述不符', color: 'gold' },
  SIZE_ISSUE: { text: '规格不符', color: 'cyan' },
  EXPIRED: { text: '临期/过期', color: 'magenta' },
  NO_REASON: { text: '七天无理由', color: 'blue' },
  OTHER: { text: '其他', color: 'default' },
};

// 退货政策
export const returnPolicyMap: Record<string, { text: string; color: string }> = {
  RETURNABLE: { text: '7天无理由退换', color: 'green' },
  NON_RETURNABLE: { text: '仅质量问题可退', color: 'orange' },
  INHERIT: { text: '默认', color: 'default' },
};

// 快递公司代码
export const carrierMap: Record<string, string> = {
  SF: '顺丰速运',
  YTO: '圆通快递',
  ZTO: '中通快递',
  STO: '申通快递',
  YUNDA: '韵达快递',
  JD: '京东物流',
  EMS: '中国邮政速递',
};
