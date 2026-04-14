# L5 — 分润奖励链路深审（Reward Allocation）

**档位**: 💰 A（最复杂钱链路）
**审查日期**: 2026-04-11
**审查范围**: `backend/src/modules/bonus/engine/*`, `bonus.service.ts`, schema.prisma（Reward/Vip/Normal 相关模型）
**审查模式**: 只读

---

## 1 — 链路总览

入口：`BonusAllocationService.allocateForOrder(orderId)` — 被 3 处调用：
- `order.service.ts:877` — 买家确认收货同步触发
- `order-auto-confirm.service.ts:121` — 自动确认 Cron 触发（fire-and-forget `.catch`）
- `bonus-compensation.service.ts:104` — 补偿重试

退款入口：`rollbackForOrder(orderId)` — 被 `admin-refunds.service.ts:354` 调用（fire-and-forget）。

**核心路由**（`determineRouting`）：
| 条件 | 路由 |
|------|------|
| 非 VIP + `createdAt < BONUS_MIGRATION_DATE` | `NORMAL_BROADCAST`（legacy） |
| 非 VIP + 新日期 | `NORMAL_TREE` |
| VIP + `exitedAt` 有值 | `VIP_EXITED`（奖励归平台） |
| VIP + 未退出 | `VIP_UPSTREAM` |
| `bizType === VIP_PACKAGE` | **入口短路**，不参与分润 ✓ |

**六分结构**：VIP 50/30/10/2/2/6、Normal 50/16/16/8/8/2。`RewardCalculatorService.calculateVip/calculateNormal` 前五池按配比计算，第六池 `reserveFund` 用差值法吸收浮点误差。✓

---

## 2 — 14 个验证点逐项结论

| # | 验证点 | 结论 | 备注 |
|---|--------|------|------|
| 1 | 幂等键格式 `ALLOC:{trigger}:{orderId}:{rule}` | ✅ 符合 | 见 `bonus-allocation.ts:113,510,557,610,658,712,768`。格式一致，由 `RewardAllocation.idempotencyKey @unique` 保护。并发兜底：P2002 → `return` 跳过 |
| 2 | VIP 第 k 单 → 第 k 个祖先 + `selfPurchaseCount >= k` 解锁判定 | ✅ 实现正确 | `vip-upstream.ts:36-118`。`prevCount = count(valid)`, `k = prevCount+1`。`findKthAncestor` 使用递归 CTE 一次查询（去环 `path @> array`），`isUnlocked = ancestorSelfCount >= k` |
| 3 | 普通广播：桶 + 滑动窗口 + 等额分配 | ✅ 实现 | `normal-broadcast.ts`。`findOrCreateBucket` → `joinQueue` → 取 `joinedAt < self.joinedAt` 前 `normalBroadcastX` 条。等额 + 余额归最后一位。⚠️ 此路径为 legacy，仅旧订单走 |
| 4 | 六分利润 VIP 50/30/10/2/2/6、普通 50/16/16/8/8/2 | ✅ 默认值正确 | `bonus-config.ts:125-165` `DEFAULTS`。`validateRatioUpdate` / `validateSnapshotRatios` / `loadFromDb` 三处总和=1.0 校验（容差 0.001） |
| 5 | `RewardEntryType` 五种 FREEZE/RELEASE/WITHDRAW/VOID/ADJUST | ✅ schema 完整 | schema.prisma:344-350 |
| 6 | `RewardAccount.balance/frozen` 原子更新 | ⚠️ 有 CAS 分层 | 正向路径使用 `update + increment/decrement`（原子）。回滚路径使用 `updateMany where: balance|frozen >= amount`（CAS 防负数） |
| 7 | 分润事务 Serializable | ✅ | 分配事务 `bonus-allocation.ts:199-203`（timeout 30s + Serializable + P2034 重试 1 次）。回滚事务 `419`（Serializable + 3 次重试）。VIP 出局判定 `vip-upstream.ts:349`（独立 Serializable + 3 次重试） |
| 8 | 退款回滚 VOID/余额对称 | ⚠️ **有并发竞态**（见 §4 CRITICAL-01） | 阻塞路径本身逻辑对称，但在 `return freeze → frozen` 并发下可能 over/under |
| 9 | `VIP_PACKAGE` 入口豁免 | ✅ | `bonus-allocation.ts:64` 显式跳过，不创建 `VipEligibleOrder` |
| 10 | 平台账户 `PLATFORM_USER_ID` 外键 | ✅ | `PLATFORM_USER_ID = 'PLATFORM'`（constants.ts:2）。`RewardAccount.userId` 是真实外键，依赖种子数据创建 User('PLATFORM') |
| 11 | 冻结过期 Cron | ✅ 双 Cron | `handleFreezeExpire` 每小时 + `handleReturnFreezeExpire` 每 10 分钟（freeze-expire.ts） |
| 12 | VIP 解锁批量扫描 | ✅ | `vip-upstream.unlockFrozenRewards` + `normal-upstream.unlockFrozenRewards` 均按 `scheme` 过滤、`requiredLevel <= newLevel`、batch updateMany、CAS 限定源状态 |
| 13 | 精度处理（rewardPool / N 余数归属） | ✅ 末位补差 | `round2 = Math.floor(v*100)/100`。六分末池 `reserveFund = profit - Σ(前5池)`。广播余额归最后一位受益人。产业基金按公司占比最后一家补差 |
| 14 | 配置缓存失效 | ✅ | `BonusConfigService.invalidateCache()` 存在且在 admin 配置更新处调用（TTL 60s 兜底） |

---

## 3 — 💰 账本完整性矩阵

每一笔金额必须同时有 `RewardLedger` + `RewardAccount` 更新。审查所有 7 个分配服务的写入点：

| 服务 | 场景 | Ledger 写入 | Account 写入 | 一致性 |
|------|------|-------------|--------------|--------|
| `normal-broadcast.distribute` | 空桶归平台 | ✓ | ✓ balance++ | ✅ |
| `normal-broadcast.distribute` | 正常等额 | ✓ | ✓ balance++ | ✅ |
| `vip-upstream.distribute` | 祖先解锁 AVAILABLE | ✓ | ✓ balance++ | ✅ |
| `vip-upstream.distribute` | 祖先未解锁 RETURN_FROZEN | ✓ | **❌ 不写** | ✅（注释明确 RETURN_FROZEN 对用户不可见） |
| `vip-upstream.distribute` | `k > maxLayers` 降级 | ✓ `creditToPlatform` | ✓ balance++ | ✅ |
| `vip-upstream.distribute` | 祖先不存在 / 系统节点 | ✓ `creditToPlatform` | ✓ balance++ | ✅ |
| `vip-upstream.unlockFrozenRewards` | FROZEN → AVAILABLE | ✓ updateMany | ✓ frozen-- + balance++ | ✅ |
| `normal-upstream.distribute/unlock` | 同 VIP | ✓ | ✓ | ✅ |
| `vip-platform-split.split` | 5 池 × 平台/卖家 | ✓ | ✓ balance++ | ✅ |
| `normal-platform-split.split` | 5 池 × 平台/卖家 | ✓ | ✓ balance++ | ✅ |
| `freeze-expire.transitionReturnFrozenToFrozen` | RETURN_FROZEN → FROZEN | ✓ CAS | ✓ **frozen ++** | ✅（补齐账户可见性） |
| `freeze-expire.expireSingleLedger` | FROZEN → VOIDED 平台回收 | ✓ 2 条（旧VOID + 新平台RELEASE） | ✓ 源 frozen-- + 平台 balance++ | ✅ |
| `rollbackForOrder` | 可逆 → VOID | ✓ updateMany | ⚠️ 聚合后扣减（见 §4 CRITICAL-01） | ⚠️ |

**结论**：正向路径（allocate + unlock + freeze-expire）账本严格对齐。反向路径（rollback）存在并发 TOCTOU。

---

## 4 — ↩️ 反向对称性分析（rollbackForOrder）

| 正向操作 | 期望反向 | 实际反向 | 对称 |
|----------|----------|----------|------|
| 创建 AVAILABLE ledger + balance++ | VOID ledger + balance-- | `updateMany status→VOIDED` + `availableByAccount` 聚合 decrement | ✓（但基于 stale snapshot） |
| 创建 FROZEN ledger + frozen++ | VOID ledger + frozen-- | `frozenByAccount` 聚合 decrement（CAS `frozen >= amount`） | ✓（但基于 stale snapshot） |
| 创建 RETURN_FROZEN ledger（无账户变动） | VOID ledger（无账户变动） | `updateMany status→VOIDED`，不进聚合 | ✓ |
| WITHDRAWN 已提现 | —（不可逆） | 保留 WITHDRAWN，仅 log warning 待人工追缴 | ⚠️ 只有警告，无追缴队列/任务 |
| VipEligibleOrder.valid=true | valid=false + `invalidReason: 'REFUND'` | ✓ | ✓ |
| VipProgress.selfPurchaseCount++ | `updateMany where >0 decrement` | ✓ CAS 防负 | ✓ |
| NormalProgress.selfPurchaseCount++ | 同上 | ✓ | ✓ |
| NormalEligibleOrder.valid=true | valid=false | ✓ | ✓ |
| NormalQueueMember.active=true | active=false | ✓ `updateMany` | ✓ |
| VipProgress.unlockedLevel 提升 | **无反向** | **未回滚** | 🚨 **ASYM-01**（见下） |
| VipProgress.exitedAt 已写 | **无反向** | **未检查/未撤销** | 🚨 **ASYM-02**（见下） |
| 普通树节点 NormalTreeNode 创建（首次入树） | **无反向** | 节点保留 | ⚠️（树结构不可逆，通常可接受） |
| MemberProfile.normalEligible=true（广播） | **无反向** | 保留 | ⚠️ |

---

## 5 — 问题清单（按严重度）

### 🚨 CRITICAL-01: rollbackForOrder 读取外部 allocations 导致 TOCTOU + frozen 账户漂移

**位置**: `bonus-allocation.service.ts:265-268, 292-338`

**根因**:
```ts
const allocations = await this.prisma.rewardAllocation.findMany({
  where: { orderId }, include: { ledgers: true },   // ← 事务外读取，snapshot 可能过期
});
// ... 进入 $transaction
const nonVoidedLedgers = allocations.flatMap(...).filter(status !== 'VOIDED');
const frozenByAccount = ... // 基于 stale snapshot 聚合
```

**攻击时序**（生产期可触发）:
1. T0：分配产出 RETURN_FROZEN ledger（amount=100, 未计入 account.frozen）
2. T1：rollback 进程开始，`findMany` 快照 → ledger.status='RETURN_FROZEN'
3. T2：freeze-expire Cron 并发触发 `transitionReturnFrozenToFrozen` → ledger.status='FROZEN', account.frozen += 100
4. T3：rollback 进入事务 → `updateMany where id in [...] AND status in [AVAILABLE, FROZEN, RETURN_FROZEN]` → 将 FROZEN 的 ledger 作废为 VOIDED ✓
5. T3：rollback 聚合阶段看到 stale snapshot status='RETURN_FROZEN'，跳过 frozen 聚合 → **不扣减 account.frozen**
6. **结果**：`account.frozen` 虚增 100 元，永久无法释放（因为对应 ledger 已 VOID）

**Serializable 可防御吗？** 不能完全防御。Serializable 仅保护事务内部的读写集。`findMany` 在事务外执行，读到的 snapshot 是脏数据。即便 Serializable 拒绝事务，rollback 也会 P2034 重试 — 但重试时仍然复用事务外的 `allocations` 变量。

**建议修复**: 将 `findMany` 挪到 `$transaction` 内部，或事务内重新读取一次 ledger 以获取权威 status 再聚合。

**反向例**: 若 FROZEN 正要 unlock（status: FROZEN→AVAILABLE, frozen--/balance++）与 rollback 并发，stale 看到 FROZEN → 聚合 frozenByAccount → CAS 失败 frozen < amount → 整个事务抛 `InternalServerErrorException` → 重试。这是好的方向（失败而非漂移），但也可能被连续重试耗尽。

---

### 🚨 CRITICAL-02: `VIP_PLATFORM_SPLIT` 不是 AllocationRuleType 枚举值，Prisma 将拒绝写入

**位置**: `bonus-allocation.service.ts:616`；`schema.prisma:336-342`

```ts
ruleType: 'VIP_PLATFORM_SPLIT',  // ← 代码使用
```

Schema 枚举实际只有：`NORMAL_BROADCAST / NORMAL_TREE / VIP_UPSTREAM / PLATFORM_SPLIT / ZERO_PROFIT`。

**影响**: VIP 路由执行 `executeVipPlatformSplit` 时，`tx.rewardAllocation.create({ ruleType: 'VIP_PLATFORM_SPLIT' })` 将在 Prisma 客户端层抛出类型错误（TypeScript 应早报，除非 ts 宽松）或运行期 enum violation。所有 VIP 订单分润将失败，整个事务回滚 → VIP 路径完全无法分润。

**如果当前 TS 编译通过**，说明该分支可能从未真正被执行过（所有 VIP 测试订单要么在 ZERO_PROFIT 短路，要么 routing=VIP_EXITED），一旦生产首个真实 VIP 订单走到这里即失败。

**建议修复**: 在 `AllocationRuleType` 枚举补齐 `VIP_PLATFORM_SPLIT` 与 `NORMAL_TREE_PLATFORM`（后者同样需要验证）。

---

### 🚨 ASYM-01: rollback 未回退 VipProgress.unlockedLevel

**位置**: `vip-upstream.ts:274-278` 正向 `updateMany unlockedLevel { lt: newLevel } → newLevel`；rollback 中无反向。

**影响**: 订单 A 使 VIP 祖先 `unlockedLevel` 从 3 → 5，释放了 2 笔冻结奖励。订单 A 退款后，VipProgress.unlockedLevel 仍为 5，意味着该祖先"已解锁 L5"状态被永久化，即使其 `selfPurchaseCount` 被回滚后 < 5。后续新订单可能直接判定为 AVAILABLE 而非 FROZEN，出现资金放行过早。

**严格度**: 虽然 unlock 判定实际走的是 `ancestorSelfCount >= k`（对 `selfPurchaseCount` 回扣生效），`unlockedLevel` 主要是展示字段。不过应至少在 rollback 中对称维护或显式声明"仅记号字段"。

---

### 🚨 ASYM-02: rollback 未检查/未撤销 VipProgress.exitedAt

**位置**: `vip-upstream.checkExit` 写 `exitedAt`；rollback 无对应处理。

**影响**: 若退款的是"压垮骆驼的最后一笔"使 VIP 出局的订单，rollback 后 exitedAt 保留 → 该用户后续订单被永久路由到 `VIP_EXITED`（奖励归平台），而其实际层级未满。

**严格度**: 概率低（需要刚好是最后一单），但影响严重（资金错归平台）。

---

### ⚠️ HIGH-01: rollback 事务缺少 timeout 参数，默认 5s 易超时

**位置**: `bonus-allocation.ts:419` `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }`

与分配事务的 `timeout: 30000` 不对称。回滚涉及 `findMany` + 多次 `updateMany` + 多次 `findUnique` + `VipEligibleOrder/NormalEligibleOrder/NormalProgress/VipProgress/NormalQueueMember` 更新，Serializable 下易触发默认 5s 超时。建议显式 `timeout: 30000, maxWait: 5000`。

---

### ⚠️ HIGH-02: WITHDRAWN ledger 无追缴任务、仅 log.warn

**位置**: `bonus-allocation.ts:303-307`

```ts
if (withdrawnLedgers.length > 0) {
  this.logger.warn(`订单 ${orderId} 存在 ${withdrawnLedgers.length} 条已提现分润流水...`);
}
```

**影响**: 若用户在退款前已提现分润，退款后仅打日志。没有死信队列、没有写 `AdminAuditLog`、没有 TODO 任务。**真实资金漂移场景**。

---

### ⚠️ HIGH-03: rollback 硬编码 `ruleType: 'NORMAL_BROADCAST'` 作为回滚标识

**位置**: `bonus-allocation.ts:284`

```ts
ruleType: 'NORMAL_BROADCAST', // 标识用，实际是回滚
```

审计/BI 查询时，REFUND 类型会被错误归为 NORMAL_BROADCAST。建议在 `AllocationRuleType` 增加 `REFUND_ROLLBACK` 专用值。

---

### ⚠️ HIGH-04: `unlockFrozenRewards` 使用 buyer 的 `userId` 作为祖先参数

**位置**: `vip-upstream.ts:161` `await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);`

代码注释与命名有歧义：`async unlockFrozenRewards(tx, ancestorUserId, newLevel)` 暗示接收祖先 ID，但调用点传 `userId`（当前买家）。

**实际语义解读**: 买家自身的 `selfPurchaseCount` 增加后，**作为其下线的祖先角色**，需要扫描其名下的 FROZEN ledger 释放。这是对的。但命名参数 `ancestorUserId` 与调用点不符，极易误读。建议重命名为 `holderUserId`。

---

### 🟡 MEDIUM-01: `creditToPlatform`（VIP / Normal 两份）重复代码

两个服务各自实现 `creditToPlatform`，逻辑 95% 相同（仅 scheme 字段不同）。建议抽到共享 util 避免漂移。

---

### 🟡 MEDIUM-02: `findKthAncestor` CTE 用 `level` 与 `depth` 双轨

`vip-upstream.ts:195-210`。CTE 按 depth 递归定位，但祖先的真实 `level` 字段未参与校验。若脏数据使某节点 level 与实际深度不一致，CTE 仍会返回。建议增加 `WHERE level = startLevel - k` 做 sanity check 双校验。

---

### 🟡 MEDIUM-03: `ensureRewardAccount` 非事务外 upsert，并发可能 P2002

多处 `findUnique → create` 两步（vip-upstream.ts:426-438、normal-upstream.ts:328-340、normal-broadcast.ts:187-199、normal-platform-split.ts:183-195、vip-platform-split.ts:183-195）。高并发下两个事务同时 findUnique 返回 null，各自 create 触发 `@@unique([userId, type])` P2002。Serializable 隔离会让其中一方重试，但代码没有针对 "account creation P2002" 的兜底，会被 allocate 的外层 P2002 判断（只匹配 `idempotencyKey`）漏过，最终向上抛出。

**建议**: 改用 `tx.rewardAccount.upsert`。

---

### ~~🟡 MEDIUM-04~~ → ✅ 已确认安全（2026-04-13 用户决策 Q3）

原问题：利润计算基于 `unitPrice - cost`，未考虑订单级折扣是否已扣减。

**核实结果**：`checkout.service.ts:260` `unitPrice = sku.price`（SKU 原价）。分润公式 `profit = (unitPrice - cost) × quantity` 基于**卖家的实际利润**（原价 - 成本），这是正确的。订单级优惠（红包、VIP 折扣）是**平台让利**，不应从卖家利润中扣除。分润基础 = 卖家利润，不是买家实付金额。

**用户 2026-04-13 确认**：A. 已扣减（安全）— 分润利润计算基础正确。

---

### 🟡 MEDIUM-05: `reserveFund` 差值法未 clamp 至 ≥ 0

`reward-calculator.ts:172` `reserveFund = profit - 前5池之和`。由于前5池均 `Math.floor`，差值 ≥ 0，理论安全。但若未来有人改为 `Math.round` 而忘记 clamp，reserveFund 可能为负 → 写入平台账户时直接 `increment(负)` = decrement。建议显式 `Math.max(0, ...)`。

---

### 🟡 MEDIUM-06: `NormalTreeNode` 插入使用 `pg_advisory_xact_lock(2026022801)` 全局锁

`bonus-allocation.ts:869`。单锁全表串行，在 B 轮活动高峰用户首次入树会形成瓶颈。未必致命（入树只发生一次），但与"并行分流"的设计目标略冲突。

---

### 🟡 MEDIUM-07: freeze-expire handler 单条失败不 alert

`freeze-expire.ts:84-88` 仅 `this.logger.error`。无 metrics、无告警队列。资金类 Cron 应写结构化审计 + 触发 alarm。

---

### 🔵 LOW-01: `rollbackForOrder` 结构化审计用 `logger.warn` 替代 AdminAuditLog

`bonus-allocation.ts:454-457` 已注明"AdminAuditLog 需 adminUserId FK"，但应引入独立 `SystemAuditLog` 而非仅 log。

### 🔵 LOW-02: `normalBroadcastX` 已废弃却仍保留在 config

`bonus-config.ts:56, 163`。遗留路径使用，难以 drop-clean。建议在废弃 migration 日期后加 TODO。

### 🔵 LOW-03: `snapshot()` 方法 deprecated 却未从调用栈清理

`reward-calculator.ts:271`。保留以防 legacy。OK。

---

## 6 — 审查维度覆盖确认

- [x] 幂等键格式
- [x] VIP 上溯/普通树上溯/普通广播
- [x] 六分利润公式（默认值 + 校验）
- [x] RewardLedger 五种 entryType
- [x] RewardAccount 原子更新（CAS）
- [x] Serializable 隔离（分配 + 回滚 + 出局判定）
- [x] rollbackForOrder 对称性
- [x] VIP_PACKAGE 豁免
- [x] PLATFORM_USER_ID 外键
- [x] 冻结过期 Cron（双 Cron）
- [x] VIP 解锁批量扫描
- [x] 精度处理（末位补差）
- [x] 配置缓存失效
- [x] 账本完整性矩阵
- [x] 反向对称性表

---

## 7 — 结论

**阻断发布的 CRITICAL**: 2 项
- CRITICAL-01：rollback TOCTOU（并发期 frozen 账户漂移）
- CRITICAL-02：`VIP_PLATFORM_SPLIT` 枚举缺失（VIP 分润将直接崩溃）

**阻断发布的 ASYM**: 2 项
- ASYM-01：unlockedLevel 不可逆
- ASYM-02：exitedAt 不可逆（资金错归平台风险）

**HIGH**: 4 项（rollback timeout、WITHDRAWN 无追缴、硬编码 ruleType、unlock 命名误导）

**MEDIUM**: 7 项
**LOW**: 3 项

**首发前必修**: CRITICAL-01、CRITICAL-02、ASYM-02、HIGH-01、HIGH-02。
**首发后可迭代**: ASYM-01、HIGH-03/04、所有 MEDIUM。

分润链路的 正向路径（allocate + unlock + freeze-expire）设计完备、事务保护到位、账本一致性良好。**主要风险集中在 rollback 与枚举缺失。**
