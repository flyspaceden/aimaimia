# VIP 利润公式统一为六分结构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VIP 分润从两级分割（rebateRatio → rebatePool → 4池）改为一级六分（直接6池），结构与普通用户一致但代码物理隔离。

**Architecture:** 新增 `calculateVip()` 六分计算 + `VipPlatformSplitService` 五池分割服务，替换 VIP 路由中旧的 `calculate()` + `PlatformSplitService`。旧服务标记 @deprecated 保留供 NORMAL_BROADCAST 遗留路径使用。数据库迁移删旧插新 RuleConfig 记录。

**Tech Stack:** NestJS / Prisma / TypeScript / React + Ant Design（管理后台）/ Python（盈利测试工具）

**Spec:** `docs/superpowers/specs/2026-03-20-vip-six-way-split-design.md`

---

## Task 1: 配置层 — BonusConfigService 接口和默认值

**Files:**
- Modify: `backend/src/modules/bonus/engine/bonus-config.service.ts`

- [ ] **Step 1: 更新 `VipBonusConfig` 接口**

删除旧 5 字段，新增 6 个 `vip*Percent` 字段：

```typescript
/** VIP分润系统配置 */
export interface VipBonusConfig {
  vipPlatformPercent: number;        // VIP平台利润比例
  vipRewardPercent: number;          // VIP奖励池比例
  vipIndustryFundPercent: number;    // VIP产业基金(卖家)比例
  vipCharityPercent: number;         // VIP慈善基金比例
  vipTechPercent: number;            // VIP科技基金比例
  vipReservePercent: number;         // VIP备用金比例
  vipMinAmount: number;
  vipMaxLayers: number;
  vipBranchFactor: number;
  vipPrice: number;
  vipReferralBonus: number;
  vipFreezeDays: number;
}
```

在 `BonusConfig` 接口中保留旧字段为 `@deprecated`（供 NORMAL_BROADCAST 遗留路径兼容）：

```typescript
export interface BonusConfig extends VipBonusConfig, NormalBonusConfig, SystemConfig {
  // @deprecated 废弃字段，保留兼容（NORMAL_BROADCAST 遗留路径使用）
  normalBroadcastX: number;
  bucketRanges: [number, number | null][];
  rebateRatio: number;
  rewardPoolPercent: number;
  platformPercent: number;
  fundPercent: number;
  pointsPercent: number;
  ruleVersion: string;
}
```

- [ ] **Step 2: 更新 `KEY_MAP`**

新增 6 个映射，保留旧映射（标记注释 @deprecated）：

```typescript
const KEY_MAP: Record<string, keyof Omit<BonusConfig, 'ruleVersion'>> = {
  // VIP系统（新六分）
  VIP_PLATFORM_PERCENT: 'vipPlatformPercent',
  VIP_REWARD_PERCENT: 'vipRewardPercent',
  VIP_INDUSTRY_FUND_PERCENT: 'vipIndustryFundPercent',
  VIP_CHARITY_PERCENT: 'vipCharityPercent',
  VIP_TECH_PERCENT: 'vipTechPercent',
  VIP_RESERVE_PERCENT: 'vipReservePercent',
  VIP_MIN_AMOUNT: 'vipMinAmount',
  VIP_MAX_LAYERS: 'vipMaxLayers',
  VIP_BRANCH_FACTOR: 'vipBranchFactor',
  VIP_PRICE: 'vipPrice',
  VIP_REFERRAL_BONUS: 'vipReferralBonus',
  VIP_FREEZE_DAYS: 'vipFreezeDays',
  // @deprecated VIP旧参数（NORMAL_BROADCAST 遗留路径使用）
  REBATE_RATIO: 'rebateRatio',
  REWARD_POOL_PERCENT: 'rewardPoolPercent',
  PLATFORM_PERCENT: 'platformPercent',
  FUND_PERCENT: 'fundPercent',
  POINTS_PERCENT: 'pointsPercent',
  // 普通用户系统（不变）
  NORMAL_BRANCH_FACTOR: 'normalBranchFactor',
  // ... 其余普通用户和系统级配置不变
};
```

- [ ] **Step 3: 更新 `VIP_RATIO_KEYS` 和 `DEFAULTS`**

```typescript
/** VIP利润分配比例配置键集合（新六分） */
const VIP_RATIO_KEYS = new Set([
  'VIP_PLATFORM_PERCENT',
  'VIP_REWARD_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'VIP_CHARITY_PERCENT',
  'VIP_TECH_PERCENT',
  'VIP_RESERVE_PERCENT',
]);
```

在 `DEFAULTS` 中新增 6 个 VIP 默认值，保留旧默认值：

```typescript
const DEFAULTS: Omit<BonusConfig, 'ruleVersion'> = {
  // VIP系统（新六分）
  vipPlatformPercent: 0.50,
  vipRewardPercent: 0.30,
  vipIndustryFundPercent: 0.10,
  vipCharityPercent: 0.02,
  vipTechPercent: 0.02,
  vipReservePercent: 0.06,
  vipMinAmount: 100.0,
  vipMaxLayers: 15,
  vipBranchFactor: 3,
  vipPrice: 399.0,
  vipReferralBonus: 50.0,
  vipFreezeDays: 30,
  // @deprecated VIP旧参数
  rebateRatio: 0.5,
  rewardPoolPercent: 0.60,
  platformPercent: 0.37,
  fundPercent: 0.01,
  pointsPercent: 0.02,
  // 普通用户系统（不变）
  normalBranchFactor: 3,
  // ... 其余不变
};
```

- [ ] **Step 4: 更新 `loadFromDb()` 中 VIP 比例校验**

将 VIP 校验从旧 4 项改为新 6 项：

```typescript
// 校验VIP利润分配比例总和 = 1.0（新六分）
const vipSum =
  result.vipPlatformPercent +
  result.vipRewardPercent +
  result.vipIndustryFundPercent +
  result.vipCharityPercent +
  result.vipTechPercent +
  result.vipReservePercent;
if (Math.abs(vipSum - 1.0) > 0.001) {
  this.logger.error(
    `VIP利润分配比例总和异常: ${vipSum}（应为 1.0），使用默认值`,
  );
  result.vipPlatformPercent = DEFAULTS.vipPlatformPercent;
  result.vipRewardPercent = DEFAULTS.vipRewardPercent;
  result.vipIndustryFundPercent = DEFAULTS.vipIndustryFundPercent;
  result.vipCharityPercent = DEFAULTS.vipCharityPercent;
  result.vipTechPercent = DEFAULTS.vipTechPercent;
  result.vipReservePercent = DEFAULTS.vipReservePercent;
}
```

- [ ] **Step 5: 更新 `validateRatioUpdate()`**

VIP 分支改为 6 项校验：

```typescript
if (isVipRatio) {
  const sum =
    (current['VIP_PLATFORM_PERCENT'] ?? DEFAULTS.vipPlatformPercent) +
    (current['VIP_REWARD_PERCENT'] ?? DEFAULTS.vipRewardPercent) +
    (current['VIP_INDUSTRY_FUND_PERCENT'] ?? DEFAULTS.vipIndustryFundPercent) +
    (current['VIP_CHARITY_PERCENT'] ?? DEFAULTS.vipCharityPercent) +
    (current['VIP_TECH_PERCENT'] ?? DEFAULTS.vipTechPercent) +
    (current['VIP_RESERVE_PERCENT'] ?? DEFAULTS.vipReservePercent);
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new BadRequestException(
      `VIP利润分配比例总和为 ${sum.toFixed(4)}，应为 1.0`,
    );
  }
}
```

- [ ] **Step 6: 更新 `validateSnapshotRatios()`**

对旧格式快照兼容——检测到旧字段跳过 VIP 校验：

```typescript
validateSnapshotRatios(snapshot: Record<string, any>): void {
  const getValue = (key: string, fallback: number): number => {
    const stored = snapshot[key];
    if (stored === undefined || stored === null) return fallback;
    const val = typeof stored === 'object' && stored?.value !== undefined
      ? stored.value : stored;
    return Number(val);
  };

  // 检测快照格式：旧格式含 REWARD_POOL_PERCENT，新格式含 VIP_PLATFORM_PERCENT
  const isOldFormat = snapshot['REWARD_POOL_PERCENT'] !== undefined;

  if (isOldFormat) {
    // 旧格式：校验旧4项
    const vipSum =
      getValue('REWARD_POOL_PERCENT', DEFAULTS.rewardPoolPercent) +
      getValue('PLATFORM_PERCENT', DEFAULTS.platformPercent) +
      getValue('FUND_PERCENT', DEFAULTS.fundPercent) +
      getValue('POINTS_PERCENT', DEFAULTS.pointsPercent);
    if (Math.abs(vipSum - 1.0) > 0.001) {
      throw new BadRequestException(
        `快照中VIP利润分配比例总和为 ${vipSum.toFixed(4)}，应为 1.0`,
      );
    }
  } else {
    // 新格式：校验新6项
    const vipSum =
      getValue('VIP_PLATFORM_PERCENT', DEFAULTS.vipPlatformPercent) +
      getValue('VIP_REWARD_PERCENT', DEFAULTS.vipRewardPercent) +
      getValue('VIP_INDUSTRY_FUND_PERCENT', DEFAULTS.vipIndustryFundPercent) +
      getValue('VIP_CHARITY_PERCENT', DEFAULTS.vipCharityPercent) +
      getValue('VIP_TECH_PERCENT', DEFAULTS.vipTechPercent) +
      getValue('VIP_RESERVE_PERCENT', DEFAULTS.vipReservePercent);
    if (Math.abs(vipSum - 1.0) > 0.001) {
      throw new BadRequestException(
        `快照中VIP利润分配比例总和为 ${vipSum.toFixed(4)}，应为 1.0`,
      );
    }
  }

  // 普通用户校验不变
  // ...
}
```

- [ ] **Step 7: 更新 `getVipConfig()`**

返回新字段：

```typescript
async getVipConfig(): Promise<VipBonusConfig> {
  const config = await this.getConfig();
  return {
    vipPlatformPercent: config.vipPlatformPercent,
    vipRewardPercent: config.vipRewardPercent,
    vipIndustryFundPercent: config.vipIndustryFundPercent,
    vipCharityPercent: config.vipCharityPercent,
    vipTechPercent: config.vipTechPercent,
    vipReservePercent: config.vipReservePercent,
    vipMinAmount: config.vipMinAmount,
    vipMaxLayers: config.vipMaxLayers,
    vipBranchFactor: config.vipBranchFactor,
    vipPrice: config.vipPrice,
    vipReferralBonus: config.vipReferralBonus,
    vipFreezeDays: config.vipFreezeDays,
  };
}
```

- [ ] **Step 8: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -30`

此时会有下游编译错误（config-validation.ts 等引用旧类型），属于预期行为，在后续 Task 修复。

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/bonus/engine/bonus-config.service.ts
git commit -m "refactor(bonus): update VipBonusConfig to six-way split structure"
```

---

## Task 2: 配置校验 — config-validation.ts

**Files:**
- Modify: `backend/src/modules/admin/config/config-validation.ts`

- [ ] **Step 1: 新增 6 个 VIP 验证规则**

在 `CONFIG_VALIDATION_RULES` 的 VIP 分润系统区域，将旧 5 个规则标记 @deprecated 并新增 6 个：

```typescript
// =================== VIP 分润系统（新六分） ===================
VIP_PLATFORM_PERCENT: {
  type: 'number',
  description: 'VIP利润-平台分成比例',
  min: 0,
  max: 1,
},
VIP_REWARD_PERCENT: {
  type: 'number',
  description: 'VIP利润-奖励池比例',
  min: 0,
  max: 1,
},
VIP_INDUSTRY_FUND_PERCENT: {
  type: 'number',
  description: 'VIP利润-产业基金(卖家)比例',
  min: 0,
  max: 1,
},
VIP_CHARITY_PERCENT: {
  type: 'number',
  description: 'VIP利润-慈善基金比例',
  min: 0,
  max: 1,
},
VIP_TECH_PERCENT: {
  type: 'number',
  description: 'VIP利润-科技基金比例',
  min: 0,
  max: 1,
},
VIP_RESERVE_PERCENT: {
  type: 'number',
  description: 'VIP利润-备用金比例',
  min: 0,
  max: 1,
},
// =================== @deprecated VIP 旧参数 ===================
REBATE_RATIO: { ... },  // 保留不变
// ...
```

- [ ] **Step 2: 更新 `VIP_POOL_PERCENT_KEYS`**

```typescript
export const VIP_POOL_PERCENT_KEYS = [
  'VIP_PLATFORM_PERCENT',
  'VIP_REWARD_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'VIP_CHARITY_PERCENT',
  'VIP_TECH_PERCENT',
  'VIP_RESERVE_PERCENT',
] as const;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/admin/config/config-validation.ts
git commit -m "refactor(admin): update VIP config validation rules to six-way split"
```

---

## Task 3: 计算层 — RewardCalculatorService 新增 calculateVip

**Files:**
- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts`

- [ ] **Step 1: 重命名 `OrderItemForNormalCalc` → `OrderItemForPoolCalc`**

```typescript
/** 订单项（含成本信息 + 公司ID，用于六分利润归属） */
export interface OrderItemForPoolCalc extends OrderItemForCalc {
  companyId: string | null;
}

/** @deprecated 兼容别名 */
export type OrderItemForNormalCalc = OrderItemForPoolCalc;
```

- [ ] **Step 2: 新增 `VipPoolCalculation` 接口**

在 `NormalPoolCalculation` 接口下方新增：

```typescript
/** VIP 六分池计算结果 */
export interface VipPoolCalculation {
  profit: number;
  platformProfit: number;     // VIP平台利润
  rewardPool: number;         // VIP奖励分配（上溯祖辈）
  industryFund: number;       // VIP产业基金（返还卖家）
  charityFund: number;        // VIP慈善基金
  techFund: number;           // VIP科技基金
  reserveFund: number;        // VIP备用金（末池补差）
  companyProfitShares: Record<string, number>;
  ruleVersion: string;
  configSnapshot: Record<string, any>;
}
```

- [ ] **Step 3: 新增 `calculateVip()` 方法**

在 `calculateNormal()` 方法下方新增，逻辑与 `calculateNormal()` 对称但读 `vip*` 配置：

```typescript
/**
 * VIP 六分利润计算
 * 结构与 calculateNormal() 完全对称，读 vip* 配置参数
 */
calculateVip(items: OrderItemForPoolCalc[], config: BonusConfig): VipPoolCalculation {
  let profit = 0;
  const companyProfits = new Map<string, number>();

  for (const item of items) {
    let cost = item.cost;
    if (cost === null || cost === undefined) {
      this.logger.warn(`商品成本未设置（unitPrice=${item.unitPrice}），按 cost=0 计算（全额利润）`);
      cost = 0;
    }
    const itemProfit = (item.unitPrice - cost) * item.quantity;
    if (itemProfit > 0) {
      profit += itemProfit;
      const cid = item.companyId || 'UNKNOWN';
      companyProfits.set(cid, (companyProfits.get(cid) ?? 0) + itemProfit);
    }
  }

  if (profit <= 0) {
    return {
      profit: 0,
      platformProfit: 0,
      rewardPool: 0,
      industryFund: 0,
      charityFund: 0,
      techFund: 0,
      reserveFund: 0,
      companyProfitShares: {},
      ruleVersion: config.ruleVersion,
      configSnapshot: this.snapshotVip(config),
    };
  }

  profit = this.round2(profit);

  const platformProfit = this.round2(profit * config.vipPlatformPercent);
  const rewardPool = this.round2(profit * config.vipRewardPercent);
  const industryFund = this.round2(profit * config.vipIndustryFundPercent);
  const charityFund = this.round2(profit * config.vipCharityPercent);
  const techFund = this.round2(profit * config.vipTechPercent);
  const reserveFund = this.round2(profit - platformProfit - rewardPool - industryFund - charityFund - techFund);

  const companyProfitShares: Record<string, number> = {};
  for (const [cid, cProfit] of companyProfits) {
    companyProfitShares[cid] = cProfit / profit;
  }

  return {
    profit,
    platformProfit,
    rewardPool,
    industryFund,
    charityFund,
    techFund,
    reserveFund,
    companyProfitShares,
    ruleVersion: config.ruleVersion,
    configSnapshot: this.snapshotVip(config),
  };
}
```

- [ ] **Step 4: 新增 `snapshotVip()` 方法**

```typescript
/** VIP 六分配置快照（用于审计） */
private snapshotVip(config: BonusConfig): Record<string, any> {
  return {
    vipPlatformPercent: config.vipPlatformPercent,
    vipRewardPercent: config.vipRewardPercent,
    vipIndustryFundPercent: config.vipIndustryFundPercent,
    vipCharityPercent: config.vipCharityPercent,
    vipTechPercent: config.vipTechPercent,
    vipReservePercent: config.vipReservePercent,
    vipMaxLayers: config.vipMaxLayers,
    vipBranchFactor: config.vipBranchFactor,
    vipMinAmount: config.vipMinAmount,
    ruleVersion: config.ruleVersion,
  };
}
```

- [ ] **Step 5: 标记旧 `calculate()` 为 @deprecated**

在旧 `calculate()` 方法上方添加注释：

```typescript
/**
 * @deprecated 使用 calculateVip() 替代。保留供 NORMAL_BROADCAST 遗留路径使用。
 */
calculate(items: OrderItemForCalc[], config: BonusConfig): PoolCalculation {
```

- [ ] **Step 6: 更新 `calculateNormal()` 参数类型**

将 `calculateNormal(items: OrderItemForNormalCalc[]` 改为 `calculateNormal(items: OrderItemForPoolCalc[]`

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/bonus/engine/reward-calculator.service.ts
git commit -m "feat(bonus): add calculateVip() six-way split method"
```

---

## Task 4: VIP 平台分割服务 — 新建 VipPlatformSplitService

**Files:**
- Create: `backend/src/modules/bonus/engine/vip-platform-split.service.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] **Step 1: 创建 `vip-platform-split.service.ts`**

参考 `normal-platform-split.service.ts` 实现，结构完全对称：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_USER_ID } from './constants';

/** VIP 六分平台分割的 5 个池（奖励由 VipUpstreamService 处理） */
interface VipPlatformPools {
  platformProfit: number;
  industryFund: number;
  charityFund: number;
  techFund: number;
  reserveFund: number;
}

@Injectable()
export class VipPlatformSplitService {
  private readonly logger = new Logger(VipPlatformSplitService.name);

  /**
   * VIP 六分平台分割：处理除奖励外的 5 个池
   *
   * - PLATFORM_PROFIT → 平台用户账户
   * - INDUSTRY_FUND → 按商品利润占比分给各卖家公司 OWNER
   * - CHARITY_FUND → 平台账户
   * - TECH_FUND → 平台账户
   * - RESERVE_FUND → 平台账户
   */
  async split(
    tx: any,
    allocationId: string,
    orderId: string,
    pools: VipPlatformPools,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.platformProfit, 'PLATFORM_PROFIT', 'VIP平台利润',
    );
    await this.distributeIndustryFund(
      tx, allocationId, orderId, pools.industryFund, companyProfitShares,
    );
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.charityFund, 'CHARITY_FUND', 'VIP慈善基金',
    );
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.techFund, 'TECH_FUND', 'VIP科技基金',
    );
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.reserveFund, 'RESERVE_FUND', 'VIP备用金',
    );
  }

  /** 产业基金分配：按各公司利润占比分给卖家 OWNER */
  private async distributeIndustryFund(
    tx: any,
    allocationId: string,
    orderId: string,
    totalAmount: number,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    if (totalAmount <= 0) return;

    const companyIds = Object.keys(companyProfitShares);
    if (companyIds.length === 0) {
      await this.creditPlatformAccount(
        tx, allocationId, orderId, totalAmount, 'INDUSTRY_FUND', 'VIP产业基金（无卖家归属）',
      );
      return;
    }

    let distributed = 0;

    for (let i = 0; i < companyIds.length; i++) {
      const companyId = companyIds[i];
      const share = companyProfitShares[companyId];
      const isLast = i === companyIds.length - 1;
      const amount = isLast
        ? this.round2(totalAmount - distributed)
        : this.round2(totalAmount * share);

      if (amount <= 0) continue;
      distributed += amount;

      const ownerStaff = await tx.companyStaff.findFirst({
        where: { companyId, role: 'OWNER', status: 'ACTIVE' },
        select: { userId: true },
      });

      if (!ownerStaff) {
        this.logger.warn(`公司 ${companyId} 无活跃 OWNER，VIP产业基金 ${amount} 元归平台`);
        await this.creditPlatformAccount(
          tx, allocationId, orderId, amount, 'INDUSTRY_FUND', `VIP产业基金（公司${companyId}无OWNER）`,
        );
        continue;
      }

      const account = await this.ensureAccount(tx, ownerStaff.userId, 'INDUSTRY_FUND');

      await tx.rewardLedger.create({
        data: {
          allocationId,
          accountId: account.id,
          userId: ownerStaff.userId,
          entryType: 'RELEASE',
          amount,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: orderId,
          meta: {
            scheme: 'VIP_PLATFORM_SPLIT',
            accountType: 'INDUSTRY_FUND',
            companyId,
            profitShare: share,
            sourceOrderId: orderId,
          },
        },
      });

      await tx.rewardAccount.update({
        where: { id: account.id },
        data: { balance: { increment: amount } },
      });

      this.logger.log(`VIP产业基金入账：${amount} 元 → 卖家 ${ownerStaff.userId}（公司 ${companyId}）`);
    }
  }

  /** 平台账户入账 */
  private async creditPlatformAccount(
    tx: any,
    allocationId: string,
    orderId: string,
    amount: number,
    accountType: string,
    label: string,
  ): Promise<void> {
    if (amount <= 0) return;

    const account = await this.ensureAccount(tx, PLATFORM_USER_ID, accountType);

    await tx.rewardLedger.create({
      data: {
        allocationId,
        accountId: account.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: orderId,
        meta: {
          scheme: 'VIP_PLATFORM_SPLIT',
          accountType,
          sourceOrderId: orderId,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });

    this.logger.log(`${label}入账：${amount} 元`);
  }

  /** 确保账户存在 */
  private async ensureAccount(tx: any, userId: string, type: string) {
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type } },
    });
    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId, type },
      });
    }
    return account;
  }

  /** 四舍五入到分 */
  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }
}
```

- [ ] **Step 2: 注册到 `bonus.module.ts`**

在 `bonus.module.ts` 中添加 import 和 provider：

```typescript
import { VipPlatformSplitService } from './engine/vip-platform-split.service';

// providers 数组中添加：
VipPlatformSplitService,
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/bonus/engine/vip-platform-split.service.ts backend/src/modules/bonus/bonus.module.ts
git commit -m "feat(bonus): add VipPlatformSplitService for six-way split"
```

---

## Task 5: 路由层 — BonusAllocationService 改用新 VIP 公式

**Files:**
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`

- [ ] **Step 1: 添加 import**

```typescript
import { VipPlatformSplitService } from './vip-platform-split.service';
import { RewardCalculatorService, OrderItemForCalc, OrderItemForPoolCalc, PoolCalculation, NormalPoolCalculation, VipPoolCalculation } from './reward-calculator.service';
```

在 constructor 中注入 `VipPlatformSplitService`：

```typescript
constructor(
  // ... 已有依赖
  private vipPlatformSplit: VipPlatformSplitService,
) {}
```

- [ ] **Step 2: 修改 VIP 路由的零利润判断和池计算**

在 `allocateForOrder()` 方法中（约第 90-142 行），VIP 路由改用 `calculateVip()`，同时**删除旧的 fallback 块**（约第 137-142 行 `if (!pools) { pools = ... }; const resolvedPools = pools;`）：

```typescript
// 5. 根据路由结果选择正确的 calculator
let pools: PoolCalculation | null = null;
let vipPools: VipPoolCalculation | null = null;
let isZeroProfit = false;

if (routing === 'NORMAL_TREE') {
  const normalPools = this.calculator.calculateNormal(calcItems, config);
  isZeroProfit = normalPools.profit <= 0;
} else if (routing === 'VIP_UPSTREAM' || routing === 'VIP_EXITED') {
  // VIP 路由使用新六分公式
  vipPools = this.calculator.calculateVip(calcItems, config);
  isZeroProfit = vipPools.profit <= 0;
} else {
  // NORMAL_BROADCAST 遗留路径，使用旧公式
  pools = this.calculator.calculate(calcItems, config);
  isZeroProfit = pools.rewardPool <= 0;
}

// ... 零利润处理逻辑不变 ...

// 删除旧的 fallback 块（原 if (!pools) { pools = ... }），各路由已在上方分别计算
```

- [ ] **Step 3: 修改 VIP_UPSTREAM 事务分支**

替换事务内的 VIP_UPSTREAM 分支（约第 157-160 行）：

```typescript
if (routing === 'VIP_UPSTREAM') {
  const resolvedVipPools = vipPools!;
  await this.executeVipUpstreamSixWay(tx, orderId, order.userId, order.totalAmount, resolvedVipPools, config);
  await this.executeVipPlatformSplit(tx, orderId, resolvedVipPools, config.ruleVersion);
}
```

- [ ] **Step 4: 修改 VIP_EXITED 事务分支**

替换事务内的 VIP_EXITED 分支（约第 161-185 行）：

```typescript
else if (routing === 'VIP_EXITED') {
  const resolvedVipPools = vipPools!;
  const exitedKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_EXITED`;
  await tx.rewardAllocation.create({
    data: {
      triggerType: 'ORDER_RECEIVED',
      orderId,
      ruleType: 'VIP_UPSTREAM',
      ruleVersion: config.ruleVersion,
      meta: {
        routing: 'VIP_EXITED',
        userId: order.userId,
        reason: `VIP用户已完成全部层级解锁并退出，奖励归平台`,
        profit: resolvedVipPools.profit,
        rewardPool: resolvedVipPools.rewardPool,
      },
      idempotencyKey: exitedKey,
    },
  });
  if (resolvedVipPools.rewardPool > 0) {
    await this.normalUpstream.creditToPlatform(
      tx, exitedKey, orderId, resolvedVipPools.rewardPool, 'vip_exited',
    );
  }
  await this.executeVipPlatformSplit(tx, orderId, resolvedVipPools, config.ruleVersion);
}
```

- [ ] **Step 5: NORMAL_BROADCAST 分支使用旧 `pools`**

确保 NORMAL_BROADCAST 分支仍然使用旧的 `resolvedPools`（不变）：

```typescript
else if (routing === 'NORMAL_TREE') {
  await this.executeNormalTree(tx, orderId, order.userId, order.totalAmount, calcItems, config);
} else {
  // NORMAL_BROADCAST 遗留路径
  const resolvedPools = pools!;
  await this.executeNormalBroadcast(tx, orderId, order.userId, order.totalAmount, resolvedPools, config);
  await this.executePlatformSplit(tx, orderId, resolvedPools, config.ruleVersion);
}
```

- [ ] **Step 6: 新增 `executeVipUpstreamSixWay()` 方法**

参考旧 `executeVipUpstream()`，改用 `VipPoolCalculation`：

```typescript
private async executeVipUpstreamSixWay(
  tx: any,
  orderId: string,
  userId: string,
  orderAmount: number,
  pools: VipPoolCalculation,
  config: BonusConfig,
): Promise<string | null> {
  const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_UPSTREAM`;

  const allocation = await tx.rewardAllocation.create({
    data: {
      triggerType: 'ORDER_RECEIVED',
      orderId,
      ruleType: 'VIP_UPSTREAM',
      ruleVersion: config.ruleVersion,
      meta: {
        routing: 'VIP_UPSTREAM',
        userId,
        profit: pools.profit,
        rewardPool: pools.rewardPool,
        configSnapshot: pools.configSnapshot,
      },
      idempotencyKey,
    },
  });

  const { result, ancestorUserId } = await this.vipUpstream.distribute(
    tx, allocation.id, orderId, userId, orderAmount, pools.rewardPool, config,
  );

  if (result === 'downgrade_normal') {
    this.logger.log(`VIP 上溯超出最大层级，奖励归平台：订单 ${orderId}`);
    if (pools.rewardPool > 0) {
      await this.normalUpstream.creditToPlatform(
        tx, allocation.id, orderId, pools.rewardPool, 'vip_over_max_layers',
      );
    }
  }

  this.logger.log(`VIP 上溯完成：${idempotencyKey}，结果=${result}`);
  return ancestorUserId;
}
```

- [ ] **Step 7: 新增 `executeVipPlatformSplit()` 方法**

```typescript
private async executeVipPlatformSplit(
  tx: any,
  orderId: string,
  pools: VipPoolCalculation,
  ruleVersion: string,
): Promise<void> {
  const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_PLATFORM_SPLIT`;

  const allocation = await tx.rewardAllocation.create({
    data: {
      triggerType: 'ORDER_RECEIVED',
      orderId,
      ruleType: 'VIP_PLATFORM_SPLIT',
      ruleVersion,
      meta: {
        platformProfit: pools.platformProfit,
        industryFund: pools.industryFund,
        charityFund: pools.charityFund,
        techFund: pools.techFund,
        reserveFund: pools.reserveFund,
        configSnapshot: pools.configSnapshot,
      },
      idempotencyKey,
    },
  });

  await this.vipPlatformSplit.split(
    tx, allocation.id, orderId,
    {
      platformProfit: pools.platformProfit,
      industryFund: pools.industryFund,
      charityFund: pools.charityFund,
      techFund: pools.techFund,
      reserveFund: pools.reserveFund,
    },
    pools.companyProfitShares,
  );

  this.logger.log(
    `VIP六分平台分润完成：platform=${pools.platformProfit}，industry=${pools.industryFund}，charity=${pools.charityFund}，tech=${pools.techFund}，reserve=${pools.reserveFund}`,
  );
}
```

- [ ] **Step 8: 标记旧方法为 @deprecated**

在旧 `executeVipUpstream()` 方法上添加 `@deprecated` 注释，说明已被 `executeVipUpstreamSixWay()` 替代：

```typescript
/**
 * @deprecated 使用 executeVipUpstreamSixWay() 替代。保留供参考。
 */
private async executeVipUpstream(
```

同样在 `executePlatformSplit()` 上添加：

```typescript
/**
 * @deprecated VIP 路由已改用 executeVipPlatformSplit()。仅 NORMAL_BROADCAST 遗留路径使用。
 */
private async executePlatformSplit(
```

- [ ] **Step 9: 确认 VIP_UPSTREAM 路径赋值 ancestorUserId**

确保 VIP_UPSTREAM 路径将 `executeVipUpstreamSixWay()` 的返回值赋给 `vipAncestorUserId`（已在 Step 3 中处理）。

- [ ] **Step 10: 验证 TypeScript 编译通过**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/bonus/engine/bonus-allocation.service.ts
git commit -m "feat(bonus): wire VIP routes to six-way split formula"
```

---

## Task 6: 种子数据和数据迁移

**Files:**
- Modify: `backend/prisma/seed.ts` (lines 1305-1309)
- Create: `backend/prisma/migrations/<timestamp>_vip_six_way_split_config/migration.sql`

- [ ] **Step 1: 更新 `seed.ts` VIP 配置项**

将 seed.ts 第 1305-1309 行的 5 条旧 VIP 配置替换为 6 条新配置：

```typescript
// --- VIP系统配置（新六分） ---
{ key: 'VIP_PLATFORM_PERCENT', value: 0.50, desc: 'VIP利润-平台分成比例' },
{ key: 'VIP_REWARD_PERCENT', value: 0.30, desc: 'VIP利润-奖励池比例' },
{ key: 'VIP_INDUSTRY_FUND_PERCENT', value: 0.10, desc: 'VIP利润-产业基金(卖家)比例' },
{ key: 'VIP_CHARITY_PERCENT', value: 0.02, desc: 'VIP利润-慈善基金比例' },
{ key: 'VIP_TECH_PERCENT', value: 0.02, desc: 'VIP利润-科技基金比例' },
{ key: 'VIP_RESERVE_PERCENT', value: 0.06, desc: 'VIP利润-备用金比例' },
```

- [ ] **Step 2: 创建数据迁移 SQL**

Run: `cd backend && npx prisma migrate dev --create-only --name vip_six_way_split_config`

然后编辑生成的 migration.sql 文件，写入单事务原子操作：

```sql
-- VIP 分润系统从两级分割改为六分结构
-- 删除旧的 5 个 VIP 配置
DELETE FROM "RuleConfig" WHERE key IN (
  'REBATE_RATIO',
  'REWARD_POOL_PERCENT',
  'PLATFORM_PERCENT',
  'FUND_PERCENT',
  'POINTS_PERCENT'
);

-- 插入新的 6 个 VIP 配置
INSERT INTO "RuleConfig" (id, key, value, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'VIP_PLATFORM_PERCENT', '{"value": 0.50, "description": "VIP利润-平台分成比例"}', NOW(), NOW()),
  (gen_random_uuid(), 'VIP_REWARD_PERCENT', '{"value": 0.30, "description": "VIP利润-奖励池比例"}', NOW(), NOW()),
  (gen_random_uuid(), 'VIP_INDUSTRY_FUND_PERCENT', '{"value": 0.10, "description": "VIP利润-产业基金(卖家)比例"}', NOW(), NOW()),
  (gen_random_uuid(), 'VIP_CHARITY_PERCENT', '{"value": 0.02, "description": "VIP利润-慈善基金比例"}', NOW(), NOW()),
  (gen_random_uuid(), 'VIP_TECH_PERCENT', '{"value": 0.02, "description": "VIP利润-科技基金比例"}', NOW(), NOW()),
  (gen_random_uuid(), 'VIP_RESERVE_PERCENT', '{"value": 0.06, "description": "VIP利润-备用金比例"}', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: 验证 Prisma**

Run: `cd backend && npx prisma validate`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/prisma/migrations/
git commit -m "feat(prisma): add VIP six-way split config migration and seed data"
```

---

## Task 7: 管理后台 — vip-config.tsx 重写分润比例卡片

**Files:**
- Modify: `admin/src/pages/bonus/vip-config.tsx`

- [ ] **Step 1: 更新 `CONFIG_SCHEMA` 分润比例部分**

将旧的 `REBATE_RATIO` + 4 项比例替换为新的 6 项：

```typescript
const CONFIG_SCHEMA: ConfigMeta[] = [
  // 分润比例（六项须合计 = 1.0）
  {
    key: 'VIP_PLATFORM_PERCENT',
    label: 'VIP平台占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中归平台的比例',
    defaultValue: 0.50,
  },
  {
    key: 'VIP_REWARD_PERCENT',
    label: 'VIP奖励占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中分配给奖励的比例',
    defaultValue: 0.30,
  },
  {
    key: 'VIP_INDUSTRY_FUND_PERCENT',
    label: 'VIP产业基金(卖家)占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中划入产业基金（卖家）的比例',
    defaultValue: 0.10,
  },
  {
    key: 'VIP_CHARITY_PERCENT',
    label: 'VIP慈善占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中归慈善的比例',
    defaultValue: 0.02,
  },
  {
    key: 'VIP_TECH_PERCENT',
    label: 'VIP科技占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中归科技的比例',
    defaultValue: 0.02,
  },
  {
    key: 'VIP_RESERVE_PERCENT',
    label: 'VIP备用金占比',
    group: 'ratio',
    type: 'percent',
    min: 0, max: 1, step: 0.01,
    description: 'VIP利润中归备用金的比例',
    defaultValue: 0.06,
  },
  // VIP 基础设置 + 奖励有效期 — 不变
  // ...
];
```

- [ ] **Step 2: 更新 `RATIO_KEYS` 为所有 6 项**

```typescript
const RATIO_KEYS = CONFIG_SCHEMA
  .filter((m) => m.group === 'ratio' && m.type === 'percent')
  .map((m) => m.key);
```

不再排除 `REBATE_RATIO`（已删除），所有 6 项都参与求和校验。

- [ ] **Step 3: 更新分润比例卡片 JSX**

移除 `REBATE_RATIO` 独立展示和"以下四项须合计=100%"分割线，替换为"以下六项须合计=100%"：

```tsx
{/* ====== 分润比例 ====== */}
<Col span={24}>
  <Card
    bordered={false}
    style={{ borderRadius: 12 }}
    styles={{ header: { borderBottom: '2px solid #1E40AF', paddingBottom: 8 } }}
    title={
      <Space>
        <PercentageOutlined style={{ color: '#1E40AF', fontSize: 18 }} />
        <Text strong style={{ fontSize: 15 }}>VIP 利润六分比例</Text>
      </Space>
    }
    extra={
      <Space>
        <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
          <Button
            icon={<ThunderboltOutlined />}
            size="small"
            onClick={handleApplyTemplate}
            style={{ borderColor: '#1E40AF', color: '#1E40AF' }}
          >
            推荐模板
          </Button>
        </PermissionGate>
        <Tag
          icon={sumValid ? <CheckCircleOutlined /> : <WarningOutlined />}
          color={sumValid ? 'green' : 'error'}
          style={{ fontSize: 13, padding: '2px 10px' }}
        >
          六项合计：{fmtPercent(sumValue)}
        </Tag>
      </Space>
    }
  >
    <Divider style={{ margin: '0 0 12px' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>以下六项须合计 = 100%（50/30/10/2/2/6）</Text>
    </Divider>

    {!sumValid && (
      <Alert
        message={`当前六项合计 ${fmtPercent(sumValue)}，需要调整至 100%`}
        type="warning" showIcon
        style={{ marginBottom: 12, borderRadius: 8 }}
      />
    )}

    <Row gutter={16}>
      {CONFIG_SCHEMA.filter((m) => m.group === 'ratio').map((meta) => (
        <Col span={12} key={meta.key}>
          <RatioField meta={meta} />
        </Col>
      ))}
    </Row>
  </Card>
</Col>
```

- [ ] **Step 4: 新增推荐模板和恢复默认值功能**

参考 `normal-config.tsx` 已有实现，添加：

```typescript
const RECOMMENDED_RATIO_TEMPLATE: Record<string, number> = {
  VIP_PLATFORM_PERCENT: 0.50,
  VIP_REWARD_PERCENT: 0.30,
  VIP_INDUSTRY_FUND_PERCENT: 0.10,
  VIP_CHARITY_PERCENT: 0.02,
  VIP_TECH_PERCENT: 0.02,
  VIP_RESERVE_PERCENT: 0.06,
};

const handleApplyTemplate = useCallback(() => {
  Modal.confirm({
    title: '应用推荐模板',
    content: (
      <div>
        <Text>将六分比例设置为推荐值：</Text>
        <div style={{ marginTop: 8, padding: 12, background: '#e6f4ff', borderRadius: 8, border: '1px solid #91caff' }}>
          <div>平台 50% / 奖励 30% / 产业基金 10%</div>
          <div>慈善 2% / 科技 2% / 备用金 6%</div>
        </div>
      </div>
    ),
    okText: '应用模板',
    onOk: () => {
      form.setFieldsValue(RECOMMENDED_RATIO_TEMPLATE);
      setDirty(true);
      message.success('已应用推荐模板，请确认后保存');
    },
  });
}, [form]);
```

- [ ] **Step 5: 更新 `handleSave()` 求和校验提示文案**

将"四项比例合计"改为"六项比例合计"。

- [ ] **Step 6: 需要新增 import**

添加 `ThunderboltOutlined`、`Alert`（如尚未引入）。

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/bonus/vip-config.tsx
git commit -m "feat(admin): rewrite VIP config page for six-way split"
```

---

## Task 8: 管理后台 — broadcast-window.tsx 移除 VIP 比例展示

**Files:**
- Modify: `admin/src/pages/bonus/broadcast-window.tsx`

- [ ] **Step 1: 移除旧 VIP 比例变量和展示**

删除第 69-70 行的 `rewardPoolPercent` 和 `rebateRatio` 变量：

```typescript
// 删除这两行：
// const rewardPoolPercent = extractValue(configs, 'REWARD_POOL_PERCENT', 0.6);
// const rebateRatio = extractValue(configs, 'REBATE_RATIO', 0.5);
```

删除第 256 行附近引用这两个变量的 `<Tooltip>` 和 `<Statistic>` 展示。

- [ ] **Step 2: Commit**

```bash
git add admin/src/pages/bonus/broadcast-window.tsx
git commit -m "fix(admin): remove deprecated VIP ratio display from broadcast window"
```

---

## Task 9: 文档同步

**Files:**
- Modify: `CLAUDE.md`
- Modify: `plan-treeforuser.md`
- Modify: `test-reward.md`
- Modify: `data-system.md`

- [ ] **Step 1: 更新 `CLAUDE.md` 关键架构决策表**

将 "VIP利润公式" 行改为：

```
| VIP利润公式 | **六分结构，与普通用户结构一致但参数独立**。VIP默认：平台50% / 奖励30% / 产业基金10% / 慈善2% / 科技2% / 备用金6%。普通默认：50/16/16/8/8/2 |
```

删除提到"rebatePool两级分割"的旧描述。同时更新"普通/VIP系统隔离"行补充说明利润公式结构统一。

- [ ] **Step 2: 更新 `plan-treeforuser.md` D11 决策**

将 D11 从：

> D11 | VIP利润公式 | **保持现有** rebatePool 两级分割不变，不改为六分 | 普通/VIP两套系统独立，VIP公式已稳定运行

改为：

> D11 | VIP利润公式 | **与普通用户统一为六分结构**（VIP默认50/30/10/2/2/6），废弃 rebateRatio 中间层 | 简化理解，VIP新增产业基金→卖家分配

同步搜索并更新文件中所有提到"rebatePool两级分割"的地方（至少包括 §1.2 利润分配流、§二（续）改动分类中的 D11 引用、Phase 实现描述中的 VIP 公式引用），全部改为"六分结构"。

全文搜索关键词：`rebatePool`、`两级分割`、`rebateRatio`，确保无遗漏。

- [ ] **Step 3: 更新 `data-system.md` 中 VIP 利润公式描述**

搜索 `rebatePool`、`rebateRatio`、`rewardPool` 等旧 VIP 公式引用，更新为六分结构描述。至少涉及：
- VIP 利润分配公式描述（`rebatePool = profit * rebateRatio` → 六分直接分配）
- RewardAllocation meta 快照字段说明（旧字段保留为历史兼容说明）

- [ ] **Step 4: 更新 `test-reward.md` §2.2 VIP 资金流**

将 §2.2 "VIP用户订单资金流" 从旧的两级分割描述改为六分结构：

```
VIP用户订单资金流（新六分）：
用户支付：cost × markupRate × vipDiscountRate（元）
    │
    ├── 卖家收入：cost（成本回收）+ profit × vipIndustryFundPct（产业基金）
    │
    └── 平台可分配利润（profit = cost × (markupRate × vipDiscountRate - 1)）
         ├── profit × vipPlatformPct     → 平台利润      ← 可控
         ├── profit × vipRewardPct       → 奖励池        ← 可能流出或回流
         ├── profit × vipIndustryFundPct → 产业基金(卖家) ← 真实支出
         ├── profit × vipCharityPct      → 慈善基金       ← 可控
         ├── profit × vipTechPct         → 科技基金       ← 可控
         └── profit × vipReservePct      → 备用金         ← 可控

默认配比：50% / 30% / 10% / 2% / 2% / 6%（总和=100%）
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md plan-treeforuser.md test-reward.md data-system.md
git commit -m "docs: update VIP profit formula to six-way split across all docs"
```

---

## Task 10: 盈利测试工具更新

**Files:**
- Modify: `tools/reward-model/analytical.py`
- Modify: `tools/reward-model/simulation.py`
- Modify: `tools/reward-model/optimizer.py`
- Modify: `tools/reward-model/breakeven.py`
- Modify: `tools/reward-model/layer_optimizer.py`

- [ ] **Step 1: 更新所有 Python 文件中的 VIP 利润公式**

在每个文件中：
- 将 `rebate_ratio` 参数替换为 6 个 `vip_platform_pct`、`vip_reward_pct`、`vip_industry_pct`、`vip_charity_pct`、`vip_tech_pct`、`vip_reserve_pct`
- VIP 利润计算从 `profit * rebate_ratio * reward_pool_pct` 改为 `profit * vip_reward_pct`
- VIP 平台收入从 `profit * (1 - rebate_ratio) + rebate_pool * platform_pct` 改为 `profit * vip_platform_pct`
- 新增 VIP 产业基金（`profit * vip_industry_pct`）计入卖家支出
- 默认值使用 50/30/10/2/2/6

具体改动因每个文件结构不同而异，需要逐文件阅读后修改。核心原则：任何地方出现 `rebate_ratio` 或 `rebatePool` 的 VIP 利润计算，都改为直接六分。

- [ ] **Step 2: 运行测试验证**

Run: `cd tools/reward-model && python analytical.py 2>&1 | tail -20`
Expected: 无报错，输出使用新公式的分析结果

- [ ] **Step 3: Commit**

```bash
git add tools/reward-model/
git commit -m "refactor(tools): update VIP profit formula to six-way split in all analysis tools"
```

---

## Task 11: 最终验证

- [ ] **Step 1: TypeScript 全量编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: 通过

- [ ] **Step 3: 管理后台编译**

Run: `cd admin && npx tsc --noEmit`
Expected: 0 errors（或仅有预期的非阻塞警告）

- [ ] **Step 4: 全局搜索确认无遗漏引用**

Run: `grep -rn 'rebateRatio\|rebatePool\|REBATE_RATIO\|rewardPoolPercent\|REWARD_POOL_PERCENT' backend/src/ admin/src/ --include='*.ts' --include='*.tsx' | grep -v '@deprecated\|遗留\|NORMAL_BROADCAST\|旧'`

Expected: 除了明确标注 @deprecated 的保留代码外，不应有活跃的旧字段引用。

- [ ] **Step 5: Commit（如有修复）**

```bash
git commit -m "fix: clean up remaining old VIP formula references"
```
