# VIP 利润公式统一为六分结构设计方案

> 创建时间：2026-03-20
> 状态：**设计完成，待实现**
> 目标：将 VIP 分润系统从两级分割（rebateRatio → rebatePool → 60/37/1/2）改为与普通用户一致的一级六分结构，两套系统保持物理隔离但结构对称

---

## 一、变更动机

当前 VIP 和普通用户的利润分配公式**结构不同**：

```
VIP（现状）：利润 → rebateRatio(0.5) → rebatePool → 60%奖励/37%平台/1%基金/2%积分
             ↑ 50%利润不进入分配系统（平台隐性收入）

普通用户：   利润 → 直接六分 50%平台/16%奖励/16%产业基金/8%慈善/8%科技/2%备用金
             ↑ 100%利润全部显式分配
```

改造后**结构统一**，100% 利润全部显式分配：

```
VIP（改后）：利润 → 直接六分 VIP_PLATFORM/VIP_REWARD/VIP_INDUSTRY_FUND/VIP_CHARITY/VIP_TECH/VIP_RESERVE
普通用户：   利润 → 直接六分 NORMAL_PLATFORM/NORMAL_REWARD/NORMAL_INDUSTRY_FUND/NORMAL_CHARITY/NORMAL_TECH/NORMAL_RESERVE
```

关键变化：
- VIP 订单新增**产业基金→卖家**分配（现有 VIP 体系卖家只拿成本回收）
- 去掉 `rebateRatio` 中间层，100% 利润显式分配，简化参数理解
- 两套系统代码物理隔离，方便未来独立演化

### 1.1 业务影响：VIP 利润分配变化对比

旧 VIP 公式中 `rebateRatio=0.5`，只有 50% 的利润进入分配系统，另外 50% 是平台的隐性收入。
新公式将 100% 利润显式分配到 6 个池中。

| 资金去向 | 旧公式（占利润%） | 新公式（占利润%） | 变化 |
|----------|------------------|------------------|------|
| 平台 | 68.5%（50%隐性 + 18.5%显性） | 50% | -18.5% |
| 奖励池 | 30% | 30% | 不变 |
| 产业基金→卖家 | 0%（仅成本回收） | 10% | **+10% 新增** |
| 慈善基金 | 0% | 2% | +2% |
| 科技基金 | 0% | 2% | +2% |
| 备用金 | 1%（积分池） | 6% | +5% |
| 基金池 | 0.5% | 0%（合并到上面） | 废弃 |

> **注意**：平台从 68.5% 降到 50% 是因为旧系统中 50% 利润不经过分配系统直接归平台。新系统将这部分显式化并重新分配给卖家产业基金、慈善、科技、备用金等池。

---

## 二、设计方案（方案 B：物理隔离）

VIP 保留独立的计算函数和平台分割服务，结构与普通用户对称但代码分离。

---

## 三、配置层变更

### 3.1 废弃的 VIP 参数（5个）

| 配置键 | 字段名 | 说明 |
|--------|--------|------|
| `REBATE_RATIO` | `rebateRatio` | 返利比例（中间层） |
| `REWARD_POOL_PERCENT` | `rewardPoolPercent` | 奖励池占返利池比例 |
| `PLATFORM_PERCENT` | `platformPercent` | 平台利润占返利池比例 |
| `FUND_PERCENT` | `fundPercent` | 基金池占返利池比例 |
| `POINTS_PERCENT` | `pointsPercent` | 积分池占返利池比例 |

### 3.2 新增的 VIP 参数（6个）

| 配置键 | 字段名 | 默认值 | 说明 |
|--------|--------|--------|------|
| `VIP_PLATFORM_PERCENT` | `vipPlatformPercent` | 0.50 | VIP平台利润 |
| `VIP_REWARD_PERCENT` | `vipRewardPercent` | 0.30 | VIP奖励池（上溯祖辈） |
| `VIP_INDUSTRY_FUND_PERCENT` | `vipIndustryFundPercent` | 0.10 | VIP产业基金→卖家 OWNER |
| `VIP_CHARITY_PERCENT` | `vipCharityPercent` | 0.02 | VIP慈善基金 |
| `VIP_TECH_PERCENT` | `vipTechPercent` | 0.02 | VIP科技基金 |
| `VIP_RESERVE_PERCENT` | `vipReservePercent` | 0.06 | VIP备用金（末池补差） |

六项合计校验 = 1.0（容差 ±0.001），与普通用户完全一致。

### 3.3 保留不变的 VIP 参数

`VIP_MIN_AMOUNT`、`VIP_MAX_LAYERS`、`VIP_BRANCH_FACTOR`、`VIP_PRICE`、`VIP_REFERRAL_BONUS`、`VIP_FREEZE_DAYS`、`VIP_REWARD_EXPIRY_DAYS`、`VIP_DISCOUNT_RATE`

---

## 四、后端引擎层变更

### 4.1 `RewardCalculatorService`

- **新增** `calculateVip(items: OrderItemForPoolCalc[], config: BonusConfig): VipPoolCalculation`
  - 与 `calculateNormal()` 逻辑对称，读 `config.vipPlatformPercent` / `vipRewardPercent` / `vipIndustryFundPercent` / `vipCharityPercent` / `vipTechPercent` / `vipReservePercent`
  - 需要 `companyId` 参数计算产业基金按公司分配
  - 返回 `VipPoolCalculation` 接口（结构与 `NormalPoolCalculation` 对称）
- **保留** `calculate()` 方法和 `PoolCalculation` 接口（标记 @deprecated），供 `NORMAL_BROADCAST` 遗留路径使用
- **新增** `snapshotVip()` 记录新的 6 个比例参数（旧 `snapshot()` 保留供遗留路径使用）
- **重命名** `OrderItemForNormalCalc` → `OrderItemForPoolCalc`（VIP/Normal 共用，含 companyId）

**VipPoolCalculation 接口：**
```typescript
interface VipPoolCalculation {
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

### 4.2 `BonusConfigService`

- `VipBonusConfig` 接口：删除旧 5 字段，新增 6 个 `vip*Percent` 字段
- `BonusConfig` 合并接口同步更新
- `KEY_MAP`：删除旧 5 映射，新增 6 映射
- `VIP_RATIO_KEYS`：从旧 4 键改为新 6 键
- `DEFAULTS`：旧 5 个默认值保留（标记 @deprecated，供 NORMAL_BROADCAST 遗留路径使用），新增 6 默认值（50/30/10/2/2/6）
- `loadFromDb()`：VIP 比例校验改为 6 项求和 = 1.0
- `validateRatioUpdate()`：VIP 分支改为 6 项校验
- `validateSnapshotRatios()`：VIP 分支改为 6 项校验；对旧格式快照兼容——检测到旧字段（如 `REWARD_POOL_PERCENT`）时跳过 VIP 校验而非报错
- `getVipConfig()`：返回新字段

### 4.3 `VipUpstreamService`

- `distribute()` 的 `rewardPool` 参数来源从旧 `pools.rewardPool` 改为新 `vipPools.rewardPool`
- 内部上溯逻辑（findKthAncestor、unlockFrozenRewards、checkExit）**不变**
- `ensureRewardAccount()` 账户类型 `VIP_REWARD` **不变**

### 4.4 VIP 平台分割服务

- **保留** `PlatformSplitService`（标记 @deprecated，供 `NORMAL_BROADCAST` 遗留路径使用）
- **新增** `VipPlatformSplitService`，结构与 `NormalPlatformSplitService` 对称：
  - 处理 5 个池：platformProfit / industryFund / charityFund / techFund / reserveFund
  - 产业基金按 `companyProfitShares` 比例分给卖家 OWNER（逻辑与普通用户一致）
  - 无 OWNER 时归平台

### 4.5 `BonusAllocationService`

- **VIP_UPSTREAM 路由**：改用 `calculateVip()` 替代 `calculate()`，传入 `calcItems`（已含 companyId）
  - `executeVipUpstream()`：接收 `VipPoolCalculation` 替代 `PoolCalculation`
  - `executePlatformSplit()` 替换为 `executeVipPlatformSplit()`，调用 `VipPlatformSplitService`
- **VIP_EXITED 路由**：同样改用 `calculateVip()`，奖励池归平台逻辑不变，平台分割改用 `VipPlatformSplitService`
- **NORMAL_BROADCAST 遗留路由**：**不改**，继续使用旧的 `calculate()` + `PlatformSplitService`（向后兼容迁移日期前的旧订单）
- **零利润判断**：
  - VIP 路由（VIP_UPSTREAM / VIP_EXITED）：改为 `vipPools.profit <= 0`（旧公式检查的是 `pools.rewardPool <= 0`，语义不同——旧公式下 rebateRatio=0 时 rewardPool=0 但 profit>0；新公式下这种情况不再存在，检查 profit 更准确）
  - NORMAL_BROADCAST / NORMAL_TREE：不变
- **退款回滚** `rollbackForOrder()`：不需要改（按 allocation/ledger 回滚，与公式结构无关）

### 4.6 `config-validation.ts`

- 旧 5 个 VIP 验证规则保留（标记 @deprecated，供 NORMAL_BROADCAST 路径兼容）
- 新增 6 个 VIP 验证规则（`VIP_PLATFORM_PERCENT` 等，type: number, min: 0, max: 1）
- `VIP_POOL_PERCENT_KEYS` 改为新的 6 个键

### 4.7 种子数据 `seed.ts`

- 预置 VIP 配置项从旧 5 个改为新 6 个

### 4.8 `bonus.module.ts`

- 注册 `VipPlatformSplitService`
- 保留 `PlatformSplitService`（遗留路径需要）

---

## 五、管理后台前端变更

### 5.1 `vip-config.tsx`

"分润比例"卡片从：
- `REBATE_RATIO`（独立滑块）+ 4项合计=100%（`REWARD_POOL_PERCENT`/`PLATFORM_PERCENT`/`FUND_PERCENT`/`POINTS_PERCENT`）

改为与 `normal-config.tsx` 对称的：
- 6项合计=100%（`VIP_PLATFORM_PERCENT` / `VIP_REWARD_PERCENT` / `VIP_INDUSTRY_FUND_PERCENT` / `VIP_CHARITY_PERCENT` / `VIP_TECH_PERCENT` / `VIP_RESERVE_PERCENT`）
- 推荐模板默认值：50/30/10/2/2/6
- 新增推荐模板按钮、恢复默认值功能（参考 `normal-config.tsx` 已有实现）
- `RATIO_KEYS` 和求和校验同步更新为 6 项

### 5.2 `broadcast-window.tsx`

当前引用 `REWARD_POOL_PERCENT` 和 `REBATE_RATIO` 做 VIP 统计展示。由于 broadcast-window 是 NORMAL_BROADCAST 遗留页面（非 VIP 页面），**移除** VIP 相关比例展示，仅保留普通广播统计。

---

## 六、数据迁移

### 6.1 部署顺序（保证安全）

1. **先部署代码**：新代码包含新 DEFAULTS 作为兜底，即使数据库还没迁移也能用默认值运行
2. **再执行数据库迁移**：删旧插新 RuleConfig 记录
3. **清除配置缓存**：迁移后调用 `invalidateCache()` 或等待 60 秒缓存过期

### 6.2 `RuleConfig` 表

通过 Prisma migration SQL 在**单个事务中**原子执行：
- **删除** 5 条旧记录：`REBATE_RATIO`、`REWARD_POOL_PERCENT`、`PLATFORM_PERCENT`、`FUND_PERCENT`、`POINTS_PERCENT`
- **插入** 6 条新记录：`VIP_PLATFORM_PERCENT`(0.50)、`VIP_REWARD_PERCENT`(0.30)、`VIP_INDUSTRY_FUND_PERCENT`(0.10)、`VIP_CHARITY_PERCENT`(0.02)、`VIP_TECH_PERCENT`(0.02)、`VIP_RESERVE_PERCENT`(0.06)

### 6.3 `RuleVersion` 快照

- 历史版本快照含旧字段名，**不追溯修改**
- `validateSnapshotRatios()` 对旧格式快照兼容：检测到旧字段（如 `REWARD_POOL_PERCENT`）时跳过 VIP 校验，确保版本历史页面正常回看

### 6.4 `RewardAllocation.meta.configSnapshot`

- 历史分配记录的 `configSnapshot` 含旧字段，**不追溯修改**，仅作审计存档
- 新分配记录使用新字段名

### 6.5 种子数据

- `seed.ts` 中 VIP 配置项改为新的 6 个

---

## 七、盈利测试工具变更

`tools/reward-model/` 目录下的 VIP 利润公式需要全部从两级分割改为六分：
- `analytical.py`：`Params` 类中 `rebate_ratio` 替换为 6 个 `vip_*_pct` 字段，VIP 利润计算改为直接六分
- `simulation.py`：同上
- `optimizer.py`：搜索空间从 `rebate_ratio` 改为 6 个独立比例（约束合计=1.0）
- `breakeven.py`：VIP 盈亏分析改用六分公式
- `layer_optimizer.py`：VIP 层级优化改用六分公式

`test-reward.md` 文档 §2.2 VIP 资金流描述同步更新为六分结构。

---

## 八、文档同步

| 文档 | 更新内容 |
|------|---------|
| `CLAUDE.md` | 关键架构决策表：删除"VIP利润公式保持现有rebatePool两级分割"，改为"VIP/普通利润公式均为六分结构，参数独立配置（VIP默认50/30/10/2/2/6，普通默认50/16/16/8/8/2）" |
| `plan-treeforuser.md` | D11 决策：从"保持现有 rebatePool 两级分割"改为"与普通用户统一为六分结构，VIP默认50/30/10/2/2/6" |
| `test-reward.md` | §2.2 VIP 资金流全景重写为六分结构 |
| `data-system.md` | 如有 VIP 利润公式描述则同步更新 |

---

## 九、不受影响的部分

- `VipUpstreamService` 上溯核心逻辑（findKthAncestor、unlockFrozenRewards、checkExit）
- `NormalUpstreamService`、`NormalPlatformSplitService`
- `NormalBroadcastService`（遗留，不改）
- `FreezeExpireService`
- Prisma Schema（RewardAccount/RewardLedger type 枚举不变）
- 买家 App 前端（只展示奖励金额，不关心公式）
- 卖家后台前端

---

## 十、影响范围汇总

| 层级 | 文件 | 变更类型 |
|------|------|---------|
| 后端配置 | `bonus-config.service.ts` | 重构接口+默认值+校验（保留旧默认值供遗留路径） |
| 后端计算 | `reward-calculator.service.ts` | 新增 calculateVip + VipPoolCalculation，保留 calculate(@deprecated)，重命名 OrderItemForNormalCalc→OrderItemForPoolCalc |
| 后端分割 | `platform-split.service.ts` | 标记 @deprecated（保留供 NORMAL_BROADCAST 使用） |
| 后端分割 | `vip-platform-split.service.ts` | **新建**（与 NormalPlatformSplitService 对称） |
| 后端路由 | `bonus-allocation.service.ts` | VIP_UPSTREAM + VIP_EXITED 改用新公式+新分割服务；NORMAL_BROADCAST 不变 |
| 后端上溯 | `vip-upstream.service.ts` | rewardPool 参数来源更新（内部逻辑不变） |
| 后端校验 | `config-validation.ts` | 新增 6 个 VIP 验证规则，旧规则标记 @deprecated 保留 |
| 后端种子 | `seed.ts` | VIP 配置项更新 |
| 后端模块 | `bonus.module.ts` | 注册 VipPlatformSplitService |
| 管理前端 | `vip-config.tsx` | 分润比例卡片重写为六分（50/30/10/2/2/6） |
| 管理前端 | `broadcast-window.tsx` | 移除 VIP 比例展示 |
| 数据迁移 | Prisma migration SQL | 单事务删旧插新 RuleConfig 记录 |
| 测试工具 | `tools/reward-model/*.py` | VIP 公式改为六分 |
| 文档 | `CLAUDE.md`、`plan-treeforuser.md`、`test-reward.md`、`data-system.md` | 同步更新 |
