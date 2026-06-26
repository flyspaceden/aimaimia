/** 会员等级 */
export type MemberTier = 'NORMAL' | 'VIP';

/** 已绑定推荐人摘要 */
export interface ReferralInviterSummary {
  userId: string;
  nickname: string | null;
  maskedPhone: string | null;
}

/** 会员资料 */
export interface MemberProfile {
  tier: MemberTier;
  referralCode: string | null;
  inviterUserId: string | null;
  inviter: ReferralInviterSummary | null;
  /** 当前会员直接推荐并已升级为 VIP 的人数（不含下级的下级） */
  inviteeVipCount: number;
  vipPurchasedAt: string | null;
  normalEligible: boolean;
  vipProgress: {
    selfPurchaseCount: number;
    unlockedLevel: number;
  } | null;
}

/** 推荐码绑定结果 */
export interface ReferralBindingResult {
  success: boolean;
  inviterUserId: string;
  inviter: ReferralInviterSummary | null;
}

/** 奖励钱包 */
export interface Wallet {
  balance: number;
  frozen: number;
  total: number;
  /** VIP 奖励分账户 */
  vip?: { balance: number; frozen: number };
  /** 普通奖励分账户 */
  normal?: { balance: number; frozen: number };
  industryFund?: { balance: number; frozen: number };
}

/** 奖励流水条目 */
export interface WalletLedgerEntry {
  id: string;
  entryType: string;
  /** 金额（单位：元，保留 2 位小数精度） */
  amount: number;
  status: string;
  refType: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /** 所属奖励账户类型，用于区分消费积分(VIP_REWARD/NORMAL_REWARD) vs 产业基金(INDUSTRY_FUND) 等 */
  accountType: string | null;
}

/** 奖励流水分页 */
export interface WalletLedgerPage {
  items: WalletLedgerEntry[];
  nextPage?: number;
}

/** 提现记录 */
export interface WithdrawRecord {
  id: string;
  amount: number;
  channel: string;
  status: string;
  createdAt: string;
}

/** 提现申请输入（v1.0 无二次验证） */
export interface WithdrawRequestInput {
  amount: number;
  alipayAccount: string;
  alipayName: string;
}

/** 提现结果 */
export interface WithdrawResult {
  withdrawId: string;
  grossAmount: number;
  taxAmount: number;
  taxRate: number;
  netAmount: number;
  status: 'PROCESSING' | 'PAID' | 'FAILED';
  message: string;
}

/** 抵扣预览 */
export interface DeductionPreview {
  pointsBalance: number;
  pointsRatio: number;
  maxDeductible: number;
}

/** VIP 三叉树节点 */
export interface VipTreeNode {
  id: string;
  userId?: string;
  rootId?: string;
  level: number;
  position: number;
  childrenCount: number;
  children?: VipTreeNode[];
}

/** VIP 三叉树数据 */
export interface VipTree {
  node: VipTreeNode | null;
  children: VipTreeNode[];
}

/** 可用奖励（用于结算页抵扣选择） */
export type RewardSourceType =
  | 'ORDER'
  | 'REFERRAL'
  | 'VIP_REFERRAL'
  | 'VIP_BONUS'
  | 'BROADCAST'
  | 'NORMAL_TREE'
  | 'NORMAL_BROADCAST'
  | null;

export interface RewardItem {
  id: string;
  /** 奖励金额（单位：元，保留 2 位小数精度） */
  amount: number;
  /** 来源类型（稳定枚举，优先用于业务判断） */
  sourceType?: RewardSourceType;
  /** 来源描述，如"订单奖励"、"推荐奖励" */
  source: string;
  /** 最低使用门槛（元），0 表示无门槛 */
  minOrderAmount: number;
  /** 过期时间 */
  expireAt: string;
  /** 状态：AVAILABLE 可用 / USED 已使用 / EXPIRED 已过期 */
  status: 'AVAILABLE' | 'USED' | 'EXPIRED';
}

/** 普通奖励条目（含冻结状态/解锁条件/过期倒计时） */
export interface NormalRewardItem {
  id: string;
  amount: number;
  status: 'FROZEN' | 'AVAILABLE';
  /** 后端 getNormalRewards 仅返回 FREEZE/RELEASE 两种（已过滤） */
  entryType: 'FREEZE' | 'RELEASE';
  /** 解锁所需消费次数 */
  requiredLevel: number | null;
  /** 过期时间 */
  expiresAt: string | null;
  /** 剩余天数 */
  remainingDays: number | null;
  sourceOrderId: string | null;
  scheme: string | null;
  createdAt: string;
}

/** 普通奖励分页 */
export interface NormalRewardPage {
  items: NormalRewardItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 排队状态 */
export interface QueueStatus {
  inQueue: boolean;
  bucketKey?: string;
  position?: number;
  joinedAt?: string;
}

// VIP 赠品封面模式
export type CoverMode = 'AUTO_GRID' | 'AUTO_DIAGONAL' | 'AUTO_STACKED' | 'CUSTOM';

// VIP 赠品方案内的商品条目
export interface VipGiftItemInfo {
  skuId: string;
  productTitle: string;
  productImage: string | null;
  skuTitle: string;
  price: number;
  quantity: number;
}

// VIP 赠品方案
export interface VipGiftOption {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  coverMode: CoverMode;
  coverUrl: string | null;
  totalPrice: number;
  available: boolean;
  items: VipGiftItemInfo[];
}

// VIP 档位
export interface VipPackage {
  id: string;
  price: number;
  sortOrder: number;
  giftOptions: VipGiftOption[];
}

// VIP 档位列表响应
export interface VipGiftOptionsResponse {
  packages: VipPackage[];
}
