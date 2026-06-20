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

// 订单状态（付款后建单架构：无 PENDING_PAYMENT）
export const orderStatusMap: Record<string, { text: string; color: string }> = {
  PENDING_SHIPMENT: { text: '待发货', color: 'warning' },
  SHIPPED: { text: '已发货', color: 'processing' },
  DELIVERED: { text: '已送达', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'green' },
  CANCELED: { text: '已取消', color: 'default' },
};

// 物流状态（与 backend Prisma ShipmentStatus 枚举严格对齐）
export const shipmentStatusMap: Record<string, { text: string; color: string }> = {
  INIT: { text: '待发货', color: 'default' },
  SHIPPED: { text: '已发货', color: 'processing' },
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
