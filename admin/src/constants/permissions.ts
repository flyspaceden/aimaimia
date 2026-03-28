export const PERMISSIONS = {
  // 商品
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_AUDIT: 'products:audit',

  // 订单
  ORDERS_READ: 'orders:read',
  ORDERS_SHIP: 'orders:ship',
  ORDERS_REFUND: 'orders:refund',
  ORDERS_CANCEL: 'orders:cancel',

  // 企业
  COMPANIES_READ: 'companies:read',
  COMPANIES_UPDATE: 'companies:update',
  COMPANIES_AUDIT: 'companies:audit',

  // 用户
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  USERS_BAN: 'users:ban',

  // 会员/奖励
  BONUS_READ: 'bonus:read',
  BONUS_APPROVE_WITHDRAW: 'bonus:approve_withdraw',

  // 溯源
  TRACE_READ: 'trace:read',
  TRACE_CREATE: 'trace:create',
  TRACE_UPDATE: 'trace:update',
  TRACE_DELETE: 'trace:delete',

  // 审计
  AUDIT_READ: 'audit:read',
  AUDIT_ROLLBACK: 'audit:rollback',

  // 系统配置
  CONFIG_READ: 'config:read',
  CONFIG_UPDATE: 'config:update',

  // 管理员
  ADMIN_USERS_READ: 'admin_users:read',
  ADMIN_USERS_CREATE: 'admin_users:create',
  ADMIN_USERS_UPDATE: 'admin_users:update',
  ADMIN_USERS_DELETE: 'admin_users:delete',

  // 角色
  ADMIN_ROLES_READ: 'admin_roles:read',
  ADMIN_ROLES_CREATE: 'admin_roles:create',
  ADMIN_ROLES_UPDATE: 'admin_roles:update',
  ADMIN_ROLES_DELETE: 'admin_roles:delete',

  // 抽奖
  LOTTERY_READ: 'lottery:read',
  LOTTERY_CREATE: 'lottery:create',
  LOTTERY_UPDATE: 'lottery:update',
  LOTTERY_DELETE: 'lottery:delete',

  // 奖励商品
  REWARD_PRODUCTS_READ: 'reward_products:read',
  REWARD_PRODUCTS_CREATE: 'reward_products:create',
  REWARD_PRODUCTS_UPDATE: 'reward_products:update',
  REWARD_PRODUCTS_DELETE: 'reward_products:delete',

  // 运费规则
  SHIPPING_READ: 'shipping:read',
  SHIPPING_CREATE: 'shipping:create',
  SHIPPING_UPDATE: 'shipping:update',
  SHIPPING_DELETE: 'shipping:delete',

  // 换货仲裁
  REPLACEMENTS_READ: 'replacements:read',
  REPLACEMENTS_ARBITRATE: 'replacements:arbitrate',

  // 红包（平台红包/优惠券）
  COUPON_READ: 'coupon:read',
  COUPON_MANAGE: 'coupon:manage',

  // 分类
  CATEGORIES_READ: 'categories:read',
  CATEGORIES_MANAGE: 'categories:manage',

  // 发票
  INVOICES_READ: 'invoices:read',
  INVOICES_ISSUE: 'invoices:issue',

  // VIP 赠品方案
  VIP_GIFT_READ: 'vip_gift:read',
  VIP_GIFT_CREATE: 'vip_gift:create',
  VIP_GIFT_UPDATE: 'vip_gift:update',
  VIP_GIFT_DELETE: 'vip_gift:delete',

  // 标签管理
  TAGS_READ: 'tags:read',
  TAGS_MANAGE: 'tags:manage',
} as const;
