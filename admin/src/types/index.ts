// ========== API 通用类型 ==========

/** 后端统一响应信封 */
export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error?: string;
}

/** 分页响应（后端返回 items 字段） */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 分页查询参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ========== 管理员 ==========

export type AdminUserStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  username: string;
  realName: string | null;
  status: AdminUserStatus;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  loginFailCount: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  roles: AdminRole[];
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: AdminPermission[];
}

export interface AdminPermission {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
}

// ========== 认证 ==========

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: {
    id: string;
    username: string;
    realName: string | null;
    roles: string[];
  };
}

export interface AdminProfile {
  id: string;
  username: string;
  realName: string | null;
  /** 后端返回角色名字符串数组，如 ["超级管理员"] */
  roles: string[];
  permissions: string[];
}

// ========== 审计日志 ==========

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'APPROVE'
  | 'REJECT'
  | 'REFUND'
  | 'SHIP'
  | 'CONFIG_CHANGE'
  | 'ROLLBACK';

export interface AuditLog {
  id: string;
  adminUserId: string;
  adminUser?: { username: string; realName: string | null };
  action: AuditAction;
  module: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  isReversible: boolean;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rolledBackLogId: string | null;
  createdAt: string;
}

export interface AuditQueryParams extends PaginationParams {
  module?: string;
  action?: AuditAction;
  adminUserId?: string;
  targetType?: string;
  targetId?: string;
  startDate?: string;
  endDate?: string;
}

// ========== Dashboard 统计 ==========

export interface DashboardStats {
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  recentOrders: Order[];
}

export interface SalesTrend {
  date: string;
  amount: number;
  count: number;
}

// ========== App 用户（买家） ==========

export type AppUserStatus = 'ACTIVE' | 'BANNED' | 'DELETED';

export interface AppUser {
  id: string;
  phone: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  memberTier: 'VIP' | 'NORMAL';
  status: AppUserStatus;
  orderCount: number;
  createdAt: string;
}

export interface AppUserStats {
  totalUsers: number;
  vipUsers: number;
  todayRegistered: number;
  bannedUsers: number;
}

export interface AppUserDetail {
  id: string;
  phone: string | null;
  phoneMasked: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  level: string;
  growthPoints: number;
  points: number;
  gender: string | null;
  birthday: string | null;
  city: string | null;
  status: AppUserStatus;
  memberTier: 'VIP' | 'NORMAL';
  orderCount: number;
  addressCount: number;
  followCount: number;
  authIdentitiesMasked: Array<{
    provider: string;
    identifierMasked: string;
    verified: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ========== 商品 ==========

export type ProductStatus = 'ACTIVE' | 'INACTIVE';
export type ProductAuditStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProductMedia {
  id: string;
  url: string;
  type: string;
  sortOrder: number;
}

export interface ProductSKU {
  id: string;
  title: string;
  price: number;
  stock: number;
  attrs: Record<string, unknown> | null;
  cost?: number | null;
  status?: string;
  skuCode?: string | null;
}

export interface Product {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  basePrice: number;
  categoryId: string | null;
  category?: { id: string; name: string; returnPolicy?: string } | null;
  origin: Record<string, any> | null;
  attributes: Record<string, any> | null;
  aiKeywords: string[];
  status: ProductStatus;
  auditStatus: ProductAuditStatus;
  auditNote: string | null;
  companyId: string;
  company?: { id: string; name: string; status?: CompanyStatus };
  images: { url: string }[];
  media?: ProductMedia[];
  skus?: ProductSKU[];
  createdAt: string;
  updatedAt: string;
}

// ========== 订单 ==========

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RECEIVED'
  | 'CANCELED'
  | 'REFUNDED';

export interface OrderItem {
  id: string;
  productId: string;
  productTitle: string;
  productImage?: string | null;
  skuName: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  user?: { phone: string; nickname: string | null };
  company?: { id: string; name: string } | null;
  status: OrderStatus;
  totalAmount: number;
  paymentAmount: number;
  discountAmount?: number;
  shippingFee?: number;
  paymentMethod?: string;
  paidAt?: string;
  transactionId?: string;
  remark?: string;
  items: OrderItem[];
  itemsSummary?: string;
  itemCount?: number;
  address: Record<string, unknown> | null;
  shipment?: {
    id?: string;
    companyId?: string;
    carrierCode?: string;
    carrierName?: string;
    trackingNo?: string;
    trackingNoMasked?: string;
    status?: string;
    shippedAt?: string | null;
  } | null;
  shipments?: Array<{
    id: string;
    companyId?: string;
    carrierCode?: string;
    carrierName?: string;
    trackingNo?: string;
    trackingNoMasked?: string;
    status?: string;
    shippedAt?: string | null;
  }>;
  bizType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  companyId?: string;
  paymentChannel?: string;
  userId?: string;
}

export type OrderStatsMap = Record<string, number>;

// ========== 企业 ==========

// I28修复：添加 'ACTIVE' 状态，与 companyStatusMap 对齐
export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface CompanyDocument {
  id: string;
  type: string;
  title: string;
  fileUrl: string;
  issuer: string | null;
  verifyStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifyNote: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  shortName: string | null;
  status: CompanyStatus;
  description: string | null;
  logo: string | null;
  servicePhone: string | null;
  serviceWeChat: string | null;
  address: Record<string, any> | null;
  contactName: string | null;
  contactPhone: string | null;
  contact?: Record<string, string>;
  documents?: CompanyDocument[];
  profile?: { highlights?: Record<string, string> } | null;
  _count?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

// ========== 企业员工 ==========

export type CompanyStaffRole = 'OWNER' | 'MANAGER' | 'OPERATOR';
export type CompanyStaffStatus = 'ACTIVE' | 'DISABLED';

export interface CompanyStaff {
  id: string;
  userId: string;
  companyId: string;
  role: CompanyStaffRole;
  status: CompanyStaffStatus;
  joinedAt: string;
  user?: {
    id: string;
    profile?: { nickname: string | null; avatarUrl: string | null } | null;
    authIdentities?: { identifier: string }[];
  };
}

// ========== AI 搜索资料 ==========

export interface AiSearchProfile {
  companyType: string | null;
}

export const COMPANY_TYPE_OPTIONS = [
  { value: 'farm', label: '农场' },
  { value: 'company', label: '公司' },
  { value: 'cooperative', label: '合作社' },
  { value: 'base', label: '基地' },
  { value: 'factory', label: '工厂' },
  { value: 'store', label: '店铺' },
];

// ========== 退款 ==========

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';

/** 退款状态变更历史记录 */
export interface RefundStatusHistoryItem {
  fromStatus: string | null;
  toStatus: string;
  remark: string | null;
  operatorId: string | null;
  createdAt: string;
}

export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
  order?: Order;
  buyer?: { nickname: string | null; phone: string | null };
  company?: { id: string; name: string } | null;
  /** 支付渠道（从关联订单的支付记录提取） */
  paymentChannel?: string | null;
  /** 退款状态变更历史（含卖家处理记录） */
  statusHistory?: RefundStatusHistoryItem[];
}

// ========== 会员 / 奖励 ==========

export interface BonusMember {
  id: string;
  userId: string;
  user?: { id: string; profile?: { nickname: string | null } | null };
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  vipPurchasedAt: string | null;
  vipNodeId: string | null;
  normalEligible: boolean;
  /** 钱包信息（列表接口可选返回） */
  wallet?: { balance: number; frozen: number };
  /** 奖励树层级 */
  treeLevel?: number;
  /** 自购次数 */
  selfPurchaseCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** 会员详情（getMemberDetail 返回） */
export interface BonusMemberDetail {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  vipPurchasedAt: string | null;
  wallet: {
    balance: number;
    frozen: number;
    totalEarned: number;
  };
  tree: {
    level: number;
    position: number;
    parentUserId: string | null;
    childCount: number;
    selfPurchaseCount: number;
    unlockedLevel: number;
    exitedAt: string | null;
  } | null;
  ledgers: {
    id: string;
    entryType: string;
    amount: number;
    status: string;
    refType: string | null;
    refId: string | null;
    createdAt: string;
  }[];
  withdrawals: {
    id: string;
    amount: number;
    status: string;
    channel: string;
    createdAt: string;
    reviewerAdminId: string | null;
  }[];
}

/** 奖励统计 Dashboard */
export interface BonusStats {
  totalDistributed: number;
  totalWithdrawn: number;
  vipCount: number;
  pendingWithdrawals: number;
  dailyTrend: { date: string; amount: number }[];
  totalMembers: number;
  vipRate: number;
}

export type WithdrawStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'FAILED';

export type WithdrawChannel = 'WECHAT' | 'ALIPAY' | 'BANKCARD';

export interface WithdrawRequest {
  id: string;
  userId: string;
  user?: { id: string; profile?: { nickname: string | null } | null };
  amount: number;
  status: WithdrawStatus;
  channel: WithdrawChannel | string;
  /** 后端字段名为 accountSnapshot，包含脱敏账户信息 { name, account } */
  accountSnapshot: { name?: string; account?: string; [key: string]: unknown } | null;
  /** @deprecated 旧字段名，兼容保留 */
  accountInfo?: Record<string, unknown> | null;
  /** 账户类型：VIP_REWARD 或 NORMAL_REWARD */
  accountType: string;
  /** 拒绝原因 */
  rejectReason?: string | null;
  reviewerAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ========== VIP 树可视化 ==========

export type VipNodeStatus = 'active' | 'silent' | 'frozen' | 'exited';

export interface VipTreeNodeView {
  userId: string;
  nickname: string | null;
  phone: string | null;
  tier: 'NORMAL' | 'VIP';
  selfPurchaseCount: number;
  totalEarned: number;
  frozenAmount: number;
  childCount: number;
  level: number;
  status: VipNodeStatus;
  isSystemNode: boolean;
  children?: VipTreeNodeView[];

  // Phase 4: 通用扩展字段
  joinedTreeAt?: string | null;
  position?: number;
  unlockedLevel?: number;

  // Phase 4: VIP 特有字段
  referrerUserId?: string | null;
  referrerNickname?: string | null;
  entryMode?: 'REFERRAL' | 'AUTO_PLACE' | 'SYSTEM';
  exitedAt?: string | null;
  rootId?: string;

  // Phase 4: 普通树特有字段
  balance?: number;
  frozenAt?: string | null;
  normalRewardEligible?: boolean;
  upgradedToVipAt?: string | null;
  stoppedReason?: 'UPGRADED_VIP' | 'FROZEN' | null;
}

export interface VipTreeContextResponse {
  breadcrumb: Array<{ userId: string | null; nickname: string | null; level: number }>;
  parent: VipTreeNodeView | null;
  current: VipTreeNodeView;
  children: VipTreeNodeView[];
  /** 节点总数超出上限时为 true */
  truncated?: boolean;
}

// ========== 树根节点统计 ==========

/** VIP 树根节点统计 */
export interface VipRootStat {
  rootId: string;
  rootNodeId: string;
  totalNodes: number;
  activeNodes: number;
  activeRate: number;
  weeklyNew: number;
}

/** 普通树根节点统计 */
export interface NormalRootStat {
  rootId: string;
  totalNodes: number;
  activeNodes: number;
  activeRate: number;
  weeklyNew: number;
}

// ========== 树奖励记录 ==========

export interface TreeRewardRecord {
  id: string;
  entryType: string;
  amount: number;
  status: string;
  refType: string | null;
  refId: string | null;
  sourceUserId: string | null;
  sourceNickname: string | null;
  layer: number | null;
  createdAt: string;
}

export interface TreeRelatedOrder {
  orderId: string;
  sourceUserId: string | null;
  sourceNickname: string | null;
  totalReward: number;
  entryCount: number;
  latestStatus: string;
  latestEntryType: string;
  latestLayer: number | null;
  latestCreatedAt: string;
}

// ========== 奖励路径解释 ==========

export interface PathExplainNode {
  userId: string;
  nickname: string | null;
  level: number;
  isSource: boolean;
  isTarget: boolean;
}

export interface PathExplainResponse {
  /** 消费用户 */
  sourceUserId: string | null;
  sourceNickname: string | null;
  /** 第 k 次有效消费 */
  consumptionIndex: number | null;
  /** 奖励金额 */
  rewardAmount: number;
  /** 奖励状态 */
  rewardStatus: string;
  /** 奖励入账类型 */
  entryType: string;
  /** 接收者 */
  recipientUserId: string;
  recipientNickname: string | null;
  /** 路径节点（从消费者到接收者） */
  path: PathExplainNode[];
  /** 命中结果说明 */
  hitResult: string;
}

// ========== 普通奖励滑动窗口 ==========

export interface BroadcastBucketInfo {
  bucketKey: string;
  totalOrders: number;
  totalAmount: number;
  totalReward: number;
}

export interface BroadcastWindowOrder {
  orderId: string;
  userId: string;
  nickname: string | null;
  amount: number;
  rewardDistributed: number;
  createdAt: string;
}

export interface BroadcastWindowResponse {
  bucketInfo: BroadcastBucketInfo;
  windowOrders: BroadcastWindowOrder[];
  pagination: { total: number; page: number; pageSize: number };
}

export interface BroadcastDistribution {
  recipientId: string;
  recipientName: string | null;
  amount: number;
  orderIndex: number;
  createdAt: string;
}

export interface BroadcastDistributionResponse {
  order: { id: string; amount: number; buyerName: string | null };
  distributions: BroadcastDistribution[];
}

// ========== 溯源 ==========

export interface TraceBatch {
  id: string;
  companyId: string;
  company?: { id: string; name: string };
  batchCode: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ========== 系统配置 ==========

export interface RuleConfig {
  key: string;
  value: { value: unknown; description?: string } | unknown;
  updatedAt: string;
}

/** 配置值提取 — RuleConfig.value 可能是 { value, description } 或裸值 */
export function extractConfigValue(config: RuleConfig): unknown {
  const v = config.value as any;
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}

export function extractConfigDescription(config: RuleConfig): string | null {
  const v = config.value as any;
  return v && typeof v === 'object' && 'description' in v ? v.description : null;
}

export interface ConfigVersion {
  id: string;
  version: string;
  snapshot: Record<string, unknown>;
  changeNote: string | null;
  createdByAdminId: string | null;
  createdByAdmin?: { id: string; username: string; realName?: string };
  createdAt: string;
}
