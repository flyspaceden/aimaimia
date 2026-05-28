/** 平台账户的特殊 userId（种子数据中对应 User 记录） */
export const PLATFORM_USER_ID = 'PLATFORM';

/** L7: 提现最小金额（元） */
export const MIN_WITHDRAW_AMOUNT = 1;

/** L7: 每日最大提现次数 */
export const MAX_DAILY_WITHDRAWALS = 3;

/** L8: BFS 遍历最大迭代次数（防止无限循环） */
export const MAX_BFS_ITERATIONS = 100000000;

/**
 * L8: 树最大深度（用于祖辈分配等场景）
 *
 * 注意：此常量不应用于限制 VIP/Normal 三叉树的 BFS 插入 —
 * 按业务设计树没有底，每位用户必须永远插入在推荐人子树内，
 * 不允许以"超过深度"为由降级到系统节点或拒绝插入。
 * 仅在分配层数、祖辈遍历等纯读取场景下作为上限保护使用。
 */
export const MAX_TREE_DEPTH = 20;

/**
 * L8: 系统根节点搜索上限（A1-A_${10+MAX_ROOT_NODES}）
 *
 * 业务设计：A1-A10 + A11+ 全部是 userId=null 的虚拟平台节点（树的骨架），
 *           真实 VIP 用户都挂在它们底下。当 A1-A10 直接子位全满（每个 3 个），
 *           代码会自动创建 A11、A12... 继续容纳无推荐人的新 VIP。
 *
 * 实际意义：每个根节点能容纳 3 个直接子节点（无推荐人挂载点），所以这个常量
 *           直接决定"无推荐人 VIP"的硬上限 = (10 + MAX_ROOT_NODES) × 3。
 *           当前 1000 → 上限约 3030 个无推荐人 VIP，远超 v1.0 预期规模，
 *           实际上等同于"无业务上限"，仅作防无限循环的安全闸。
 */
export const MAX_ROOT_NODES = 1000;

/** 平台公司 ID（用于奖励商品和抽奖奖品） */
export const PLATFORM_COMPANY_ID = 'PLATFORM_COMPANY';

/** 普通用户树根节点 ID（单棵树，单个平台系统根节点） */
export const NORMAL_ROOT_ID = 'NORMAL_ROOT';

/** 普通奖励相关 scheme 列表（用于统一判断 accountType 路由） */
export const NORMAL_SCHEMES = ['NORMAL_TREE', 'NORMAL_BROADCAST'] as const;

/**
 * 分润系统迁移日期：早于此日期的非 VIP 订单走 NORMAL_BROADCAST（旧广播模式），
 * 晚于或等于此日期的走 NORMAL_TREE（新普通树模式）。
 * 默认设为 2026-02-28T00:00:00+08:00（系统启用普通树模式的日期）。
 * 可通过环境变量 BONUS_MIGRATION_DATE 覆盖。
 */
export const BONUS_MIGRATION_DATE = new Date(
  process.env.BONUS_MIGRATION_DATE || '2026-02-28T00:00:00+08:00',
);

/** M14修复：分润分配死信记录的原因字符串（创建和查询统一使用） */
export const DEAD_LETTER_REASON = '分润分配失败（死信记录）';

/** 售后退货保护冻结状态（订单确认收货后 7 天内不可见） */
export const RETURN_FREEZE_STATUS = 'RETURN_FROZEN';

/** 所有 RewardAccount 类型字面量（与 schema.prisma RewardAccountType enum 对齐） */
export type RewardAccountTypeStr =
  | 'VIP_REWARD'
  | 'NORMAL_REWARD'
  | 'POINTS'
  | 'FUND_POOL'
  | 'PLATFORM_PROFIT'
  | 'INDUSTRY_FUND'
  | 'CHARITY_FUND'
  | 'TECH_FUND'
  | 'RESERVE_FUND';

/**
 * 根据 ledger.meta 判断应使用的 RewardAccount 类型。
 * 优先用 meta.accountType（新代码明确写入，覆盖 INDUSTRY_FUND/CHARITY_FUND 等）；
 * 没有时按 scheme 名兜底（兼容历史 VIP_UPSTREAM/NORMAL_TREE 等只写 scheme 的 ledger）。
 */
export function getAccountTypeForLedger(meta: any): RewardAccountTypeStr {
  if (meta?.accountType) {
    return meta.accountType as RewardAccountTypeStr;
  }
  const scheme = meta?.scheme;
  return (NORMAL_SCHEMES as readonly string[]).includes(scheme) ? 'NORMAL_REWARD' : 'VIP_REWARD';
}

/** @deprecated 用 getAccountTypeForLedger(meta) 替代，本函数只考虑 scheme 名不能区分 INDUSTRY_FUND */
export function getAccountTypeForScheme(scheme: string): 'VIP_REWARD' | 'NORMAL_REWARD' {
  return (NORMAL_SCHEMES as readonly string[]).includes(scheme) ? 'NORMAL_REWARD' : 'VIP_REWARD';
}
