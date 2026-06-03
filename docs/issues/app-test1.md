# 普通树 + VIP 树 + 分润系统自动化测试计划

> **生成日期**: 2026-05-06
> **触发场景**: 真机 P1-2 多商户测试中发现普通树插入算法 + 分润链路存在多处隐藏 bug，手工真机测试再现这些 bug 需要多用户多订单极费时间。同时 VIP 树（推荐人子树 BFS 滑落、A1-A10 系统根、VIP 上溯六分）从未端到端跑过。改用自动化测试覆盖两套树 + 分润核心业务逻辑。
> **覆盖范围**:
> - 普通用户树（NORMAL_TREE）入树算法 + 6 池计算 + rewardPool 上溯 + 平台 5 池记账
> - **VIP 树（VIP_UPSTREAM / VIP_EXITED）入树算法 + VIP 六分（50/30/10/2/2/6）+ 推荐人子树 BFS + A1-A10 系统根**
> - VIP_PACKAGE 礼包跳过分润路径
> **真相源**: `backend/src/modules/bonus/engine/` + `backend/src/modules/bonus/bonus.service.ts` + `backend/prisma/schema.prisma` Bonus 域模型
> **状态说明**: ⬜ 未写 | 🔧 编写中 | ✅ 已通过 | ❌ 失败

---

## 一、为什么写这份计划

### 1.1 背景

2026-05-06 真机 P1-2 多商户测试期间，普通用户首次入树 + 后续分润完全失败。逐一排查发现 **3 个相互独立的 bug**（已修但仍需测试覆盖防回归）：

| Bug | 位置 | 修复 commit |
|---|---|---|
| `AllocationRuleType` enum 缺 `VIP_PLATFORM_SPLIT` | Prisma migration | `8d3200f` |
| `assignNormalTreeNodeInline` 用 `nodeCount` 推算位置不容忍空隙 | `bonus-allocation.service.ts` | `243a0f3` |
| seed 子节点 `rootId='ROOT'` 与常量 `NORMAL_ROOT_ID='NORMAL_ROOT'` 不一致 + nt-u010 超载第 4 子 | `prisma/seed.ts` | `5d60811` |

**VIP 路径同样脆弱**：VIP 树用 `MemberProfile.inviterUserId` 决定挂载位置 + BFS 子树滑落 + A1-A10 系统节点遍历。这套逻辑分支多于普通树（普通树只有"轮询找最闲父"一种），但端到端从未跑过。

### 1.2 现状

后端已有 41 个 bonus 相关测试，但**未覆盖**：

**普通树**：
- `assignNormalTreeNodeInline` 边界场景（空隙、超载、stale childrenCount）
- 多用户连续入树后的树形分布正确性
- 三种路由（NORMAL_TREE / VIP_UPSTREAM / VIP_EXITED）+ VIP_PACKAGE 跳过路径

**VIP 树**：
- `assignVipTreeNode` 三种入树路径（直挂推荐人 / BFS 滑落 / A1-A10 系统根）
- A1-A10 全满后自动开 A11+
- `executeVipUpstreamSixWay` 完整调用链（六分 + rewardPool 上溯 + VIP_PLATFORM_SPLIT 写入）
- VIP_EXITED 路径（用户完成全部解锁后）
- 祖辈解锁 / 冻结 / 过期归平台

**两套通用**：
- 6 池数学校验（合计 = 100% profit、reserveFund 末池补差）
- 幂等性（idempotencyKey）+ 并发串行化

### 1.3 目标

写一套**单元 + 集成测试**，让 CI 每次代码变更都自动跑：
1. 已踩过的 bug 不再重现（回归防护）
2. 两套树的算法在所有边界场景行为可预期
3. 利润分配的数学不变量 (`Σ pools = profit`) 永远满足
4. VIP 树的复杂入树路径（推荐人 / BFS / 系统根）100% 覆盖

---

## 二、测试分层架构

### 2.1 三层金字塔

```
        E2E（HTTP 模拟全链路）— 3-5 case，跨支付/物流/分润
              ▲
         集成测试（实数据库 + Prisma + 完整 service 调用）— 35+ case
              ▲
         单元测试（mock tx，纯算法）— 23+ case
```

**优先级**：单元 > 集成 > E2E

### 2.2 范围决策

| 档位 | 内容 | 工作量 | 包含 |
|---|---|---|---|
| **A1. 普通树算法单元** | `assignNormalTreeNodeInline` 边界 | ~1h | ✅ |
| **A2. VIP 树算法单元** | `assignVipTreeNode` 边界 | ~1.5h | ✅ |
| **B1. 普通树分润集成** | NORMAL_TREE 路由 + 上溯 + 5 池 | ~2h | ✅ |
| **B2. VIP 树分润集成** | VIP_UPSTREAM + VIP_EXITED + VIP_PLATFORM_SPLIT | ~2.5h | ✅ |
| **C. E2E HTTP 测试** | supertest 模拟下单到分润 | ~3h | ⏸ 暂缓 |

**本次实施 A1+A2+B1+B2**，C 留 backlog。**总工作量 ~7 小时，约 60 个 test case**。

---

## 三、Phase A1 — 普通树算法单元测试

文件：`backend/src/modules/bonus/engine/bonus-allocation.normal-tree.spec.ts`（新建）

测试目标：`assignNormalTreeNodeInline` 在各种树状态下都能正确选父节点 + 找空位。

### 3.1 测试 fixture

```ts
function makeMockTx(initialNodes: NodeFixture[]) {
  return {
    normalTreeNode: {
      findFirst: jest.fn(...),
      findMany: jest.fn(...),
      create: jest.fn(...),
      update: jest.fn(...),
    },
    memberProfile: { ... },
    normalProgress: { ... },
    $executeRawUnsafe: jest.fn(),
  };
}
```

### 3.2 测试用例清单

| # | 用例 | 输入树状态 | 期望插入位置 |
|---|---|---|---|
| A1-1 | 空树（仅 NORMAL_ROOT，无子）| level 0: 1 root | level=1, parentId=NORMAL_ROOT, position=0 |
| A1-2 | level 1 有 1 子 | root + 1 user at level 1 pos 0 | level=1, position=1 |
| A1-3 | level 1 有 2 子（连续位置）| root + 2 users at level 1 pos 0,1 | level=1, position=2 |
| A1-4 | level 1 有 2 子（位置 0 和 2 — 中间空）| root + 2 users at pos 0, 2 | level=1, position=1（找最小未用）|
| A1-5 | level 1 满 3 子，level 2 全空 | 1 + 3 + 0 | level=2, parentId=最早建的 L1, position=0 |
| A1-6 | level 1 满 + level 2 部分填 | 1 + 3 + (各 0/1/2 子) | level=2, parentId=children 最少的 L1（tie 取早的）|
| A1-7 | level 1 + level 2 都满（9 个） | 1+3+9 | level=3, parentId=最早建的 L2, position=0 |
| A1-8 | childrenCount stale（说有 4 但实际 0）| 数据漂移 | 仍正确插入 level=1 position=0（不依赖 childrenCount）|
| A1-9 | NORMAL_ROOT 不存在 | 空表 | 自动创建 root + 插入 level=1 |
| A1-10 | rootId 不一致（'ROOT' vs 'NORMAL_ROOT'）| 模拟今天踩的脏数据 | 给 warn 但仍能挂（防御性）|
| A1-11 | tie-break 由 createdAt asc | 多个 L1 各 0 子但建立时间不同 | 选最早的那个 |
| A1-12 | branchFactor 配置变更（=4）| config.normalBranchFactor=4 | level=1 能挂第 4 个 |
| A1-13 | MAX_TREE_DEPTH 限制 | 树满到 depth=20 | 抛错"普通树已满" |

**13 case**，约 1 小时。

---

## 四、Phase A2 — VIP 树算法单元测试

文件：`backend/src/modules/bonus/bonus.service.assignVipTreeNode.spec.ts`（新建）

测试目标：`assignVipTreeNode` 三种入树路径 + 边界正确。

### 4.1 VIP 树三种入树路径

```
路径 1：有推荐人 + 推荐人节点未满（childrenCount < 3）
  → 直接挂推荐人下面

路径 2：有推荐人 + 推荐人已满
  → BFS 在推荐人子树内找第一个 childrenCount < 3 的节点
  → 子树全满 → 抛错（不降级到系统节点）

路径 3：无推荐人
  → 遍历 A1, A2, ..., A10 找第一个 childrenCount < 3
  → A1-A10 全满 → 创建 A11, A12, ... 直到 MAX_ROOT_NODES
```

### 4.2 测试用例清单

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| A2-1 | 无推荐人 + A1 空 | A1.childrenCount=0, A2-A10 任意 | 挂 A1, position=0 |
| A2-2 | 无推荐人 + A1 满 + A2 空 | A1.cc=3, A2.cc=0 | 挂 A2 |
| A2-3 | 无推荐人 + A1-A10 全满 | 全部 cc=3 | 创建 A11 + 挂 A11 |
| A2-4 | 无推荐人 + A1-A10+A11+...+A(10+MAX_ROOT_NODES) 全满 | 触发上限 | 抛错"系统节点已达上限" |
| A2-5 | 有推荐人 + 推荐人未满 | inviter.cc=2 | 挂 inviter 下，level=inviter.level+1, position=2 |
| A2-6 | 有推荐人 + 推荐人满 + 子树有空位 | inviter.cc=3，子树某节点 cc=1 | BFS 找到该节点，挂下面 |
| A2-7 | 有推荐人 + 推荐人满 + 子树全满 | 整子树全 cc=3，深度 < MAX_BFS_ITERATIONS | 抛错"无法找到 VIP 空位" |
| A2-8 | 有推荐人 + 推荐人无 vipNodeId | inviter MemberProfile.vipNodeId=null | 抛错"推荐人尚未分配 VIP 树节点" |
| A2-9 | 推荐人是系统节点（userId=null）| inviter is A1 | 正常挂 A1 子树（系统节点也能当推荐人）|
| A2-10 | position 取 increment 后 childrenCount-1 | 并发场景 | 防止位置冲突，先 update parent.childrenCount 再 create |
| A2-11 | BFS 迭代超过 MAX_BFS_ITERATIONS | 数据循环引用 | 中止搜索，logger.warn |
| A2-12 | rootId 继承推荐人的 rootId | inviter 在 A3 子树 | newNode.rootId='A3' |

**12 case**，约 1.5 小时。

---

## 五、Phase B1 — 普通树分润集成测试

文件：`backend/src/modules/bonus/engine/bonus-allocation.spec.ts`（扩展现有）

测试目标：`allocateForOrder` 完整调用链——树插入 + 6 池计算 + rewardPool 上溯 + 5 池记账。

### 5.1 测试 fixture

```ts
beforeEach(async () => {
  await resetDb();
  await seedTreeWithSeedScript(); // 同 prisma/seed.ts 同样的 7 节点结构
  await seedTestUsers(['buyer-1', 'buyer-2', 'buyer-3']);
  await seedCompany('青禾智慧农场');
});
```

### 5.2 路由分流测试

| # | 用例 | 用户身份 | 商品类型 | 期望路由 |
|---|---|---|---|---|
| B1-1 | 普通用户买普通商品 | normal | NORMAL_GOODS | NORMAL_TREE |
| B1-2 | VIP 用户买普通商品 | vip | NORMAL_GOODS | VIP_UPSTREAM |
| B1-3 | VIP-EXITED 用户买普通商品 | vipExited | NORMAL_GOODS | VIP_EXITED |
| B1-4 | 任何用户买 VIP 礼包 | * | VIP_PACKAGE | **跳过分润**（早 return）|

### 5.3 普通树端到端

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B1-5 | 新人首次下单（k=1）| 创建 buyer-1 → 下 1 单 → 收货 → allocateForOrder | tree 插入 nt-u004/level2/pos0；rewardLedger 给 u-004 AVAILABLE |
| B1-6 | 同 buyer 第 2 单（k=2）| buyer-1 第 2 单 | rewardLedger 给 nt-u004 上数第 2 层（=NORMAL_ROOT，userId=null）→ 归平台 |
| B1-7 | 多人连续 10 单 | 10 个 buyer 各自 1 单 | tree 形态符合「先填 level 1 / level 2 / 再 level 3」预期，分布平衡 |
| B1-8 | 祖辈 selfPurchaseCount=0 | buyer-1 第 1 单（祖辈 u-004 自购=0）| FROZEN（30 天到期归平台）|
| B1-9 | 祖辈 selfPurchaseCount>=k | 用 seed 时手动 set u-004.selfPurchaseCount=5 | AVAILABLE 立即到账 |
| B1-10 | k > normalMaxLayers (15) | buyer 已下 15 单，第 16 单 | over_max_layers，奖励归平台 |

### 5.4 6 池数学（普通：50/16/16/8/8/2）

| # | 用例 | 输入 profit | 期望各池 |
|---|---|---|---|
| B1-11 | profit=100 | 100 | platform=50, reward=16, industry=16, charity=8, tech=8, reserve=2 |
| B1-12 | profit=33.33（验末池补差）| 33.33 | 前 5 池独立计算 floor(2 位)，reserve = profit - 前 5 之和 |
| B1-13 | profit<=0（亏损单）| 0 / 负 | 写 ZERO_PROFIT 标记，无 ledger 流水 |
| B1-14 | 多商家订单的 industryFund 按比例分 | 商家 A 利润 60% / B 利润 40% | A 拿 16×0.6=9.6，B 拿 16×0.4=6.4 |

**14 case**，约 2 小时。

---

## 六、Phase B2 — VIP 树分润集成测试

文件：`backend/src/modules/bonus/engine/bonus-allocation.vip.spec.ts`（新建）

测试目标：VIP_UPSTREAM + VIP_EXITED + VIP_PLATFORM_SPLIT 完整链路。

### 6.1 测试 fixture

```ts
beforeEach(async () => {
  await resetDb();
  // VIP 树 seed：A1-A10 + 几个挂在 A1 子树的 VIP 用户
  //   A1.userId=null
  //     ├─ vipUser1 (level=1, selfPurchaseCount=10)
  //     ├─ vipUser2 (level=1, selfPurchaseCount=5)
  //     │  └─ vipUser3 (level=2, selfPurchaseCount=2)
  //     │     └─ vipUser4 (level=3, selfPurchaseCount=1)
  //     └─ vipUser5 (level=1, selfPurchaseCount=0)
  await seedVipTree();
  await seedTestVipUsers(['vipBuyer-1', 'vipBuyer-2']);
});
```

### 6.2 VIP 入树（assignVipTreeNode）

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B2-1 | VIP 用户首次买礼包激活（无推荐人） | createVipUser → 买 VIP 礼包 | 挂 A1（或第一个有空 A），写入 MemberProfile.vipNodeId |
| B2-2 | VIP 用户首次买礼包激活（有推荐人，推荐人未满）| inviter=vipUser1 | 挂 vipUser1 下面，rootId=A1 |
| B2-3 | VIP 用户首次买礼包激活（推荐人满，BFS 滑落）| inviter=vipUser2，vipUser2 满 | BFS 到 vipUser3 / vipUser4，找空位 |
| B2-4 | VIP 礼包付款失败重试 → 不重复入树 | 同一 userId 第 2 次 activateVipAfterPayment | idempotent，不创建第 2 个 vipNode |

### 6.3 VIP 上溯六分

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B2-5 | VIP 用户 k=1 + 第 1 层祖辈是真用户 + selfPurchaseCount>=1 | vipBuyer-1 在 vipUser1 下，第 1 单 profit=100 | rewardPool=30 给 vipUser1，AVAILABLE |
| B2-6 | VIP 用户 k=1 + 第 1 层祖辈是 A1 系统节点 | vipBuyer-1 直接挂 A1 下，第 1 单 | rewardPool 归平台（系统节点不接受奖励）|
| B2-7 | VIP 用户 k=2 + 第 2 层祖辈 selfPurchaseCount<2 | 祖辈自购=1，需要 k=2 | RETURN_FROZEN，30 天 |
| B2-8 | 祖辈在冻结期内补够 k 笔自购 | unlockFrozenRewards 触发 | FROZEN → AVAILABLE，写入流水 |
| B2-9 | 祖辈过期未补够（30 天后）| 时间快进 31 天 | FROZEN → 归平台，AVAILABLE 流水 |
| B2-10 | k=15 (vipMaxLayers) | 已下 14 单第 15 单 | 找第 15 层祖辈（极深路径）|
| B2-11 | k=16 (>vipMaxLayers) | 第 16 单 | 走 VIP_EXITED 路径 |
| B2-12 | VIP_EXITED 路径 → reward 归平台 | k>maxLayers | 创建 RewardAllocation(ruleType=VIP_UPSTREAM) + creditToPlatform |

### 6.4 VIP_PLATFORM_SPLIT（验证 enum migration 修复）

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B2-13 | VIP 用户买普通商品收货 | vipBuyer 第 1 单收货 | **写入 RewardAllocation(ruleType='VIP_PLATFORM_SPLIT')** ← 验证 enum 不再 P22P02 |
| B2-14 | VIP_PLATFORM_SPLIT 5 池数学（VIP 比例：50/10/2/2/6）| profit=100 | platform=50, industry=10, charity=2, tech=2, reserve=6（rewardPool=30 已在 VIP_UPSTREAM 流水）|
| B2-15 | VIP industryFund 按公司利润占比分 | 多商家订单 | 各商家按 (companyProfit/totalProfit) 拿 industryFund |

### 6.5 VIP_PACKAGE 跳过

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B2-16 | VIP_PACKAGE 订单收货 | bizType=VIP_PACKAGE | 不创建 RewardAllocation；NormalProgress.selfPurchaseCount 不递增；VipProgress.selfPurchaseCount 不递增 |
| B2-17 | VIP_PACKAGE 订单触发 activateVipAfterPayment | 付款（不是收货）后 | 入 VIP 树（assignVipTreeNode），但不分润 |

### 6.6 幂等性 + 并发

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B2-18 | 同一订单重复 allocate | allocateForOrder(orderId) × 2 | 第 2 次因 idempotencyKey 唯一约束跳过 |
| B2-19 | 多 VIP 同时入树（推荐人未满）| Promise.all 触发 5 个新 VIP，同一 inviter | childrenCount 原子递增，5 个分别在 position 0/1/2/...，无冲突 |
| B2-20 | dead letter 重试 | 模拟 VIP allocate 失败 → cron 重试 | RewardAllocation 不重复，状态正确 |

**20 case**，约 2.5 小时。

---

## 七、Phase C — E2E HTTP 测试（暂缓 backlog）

文件：`backend/test/e2e/bonus-flow.e2e-spec.ts`（未来）

```ts
describe('普通用户分润 E2E', () => {
  it('卖家自助发货 → SF push → 确认收货 → 普通树分润', ...);
});

describe('VIP 用户分润 E2E', () => {
  it('VIP 礼包激活 → 买普通商品 → 确认收货 → VIP_UPSTREAM + VIP_PLATFORM_SPLIT', ...);
});
```

**为什么暂缓**：
- 真机已经端到端跑通过 SF 链路
- A1+A2+B1+B2 已能覆盖所有今天踩过的 bug 和分支决策
- E2E 维护成本高（mock SF/支付宝/OSS）

---

## 八、实施计划

### 8.1 时间排程

| Phase | 工作量 | Test case 数 | 优先级 |
|---|---|---|---|
| **A1. 普通树算法单元** | ~1h | 13 | P0 |
| **A2. VIP 树算法单元** | ~1.5h | 12 | P0 |
| **B1. 普通树分润集成** | ~2h | 14 | P0 |
| **B2. VIP 树分润集成** | ~2.5h | 20 | P0 |
| **C. E2E 测试** | ~3h | 3-5 | P3（暂缓）|

**P0 总计**：~7h，约 59 个 test case。

### 8.2 执行顺序

1. **A1 普通树单元**（最简单，建立 mock 模式）
2. **A2 VIP 树单元**（沿用 mock 模式，分支更多）
3. **B1 普通树集成**（开始用真实 prisma-test）
4. **B2 VIP 树集成**（依赖 VIP 树 seed，最复杂）
5. 运行 `npx jest --testPathPatterns='bonus'` 确认全绿
6. 提交 + push staging
7. CI 自动跑

### 8.3 完成判定

- [ ] A1 + A2 + B1 + B2 全部 test case 通过
- [ ] `backend` 测试总数从 ~371 增加到 ~430
- [ ] 今天踩过的 3 个 bug 都有对应 test case 防回归：
  - VIP_PLATFORM_SPLIT enum → **B2-13**
  - 普通树插入算法空隙 → **A1-4 / A1-8**
  - rootId 一致性 → **A1-10**
- [ ] CI workflow `npm test` 自动跑（已有，无需配置）

---

## 九、覆盖与不覆盖的边界

### ✅ 自动化测试覆盖

**普通树**：
- 入树算法在所有树状态下的决策正确性
- rewardPool 给祖辈 vs 归平台的判定
- 解锁 / 冻结 / 过期状态机

**VIP 树**：
- 三种入树路径（直挂推荐人 / BFS 滑落 / A1-A10 系统根）
- A1-A10 全满后自动开 A11+
- BFS 迭代上限保护
- 推荐人无 vipNodeId 的异常路径
- VIP 上溯六分 + VIP_PLATFORM_SPLIT 写入

**两套通用**：
- 6 池数学计算 + 末池补差
- 三种路由分流 + VIP_PACKAGE 跳过
- 幂等性保护（idempotencyKey）
- 并发场景串行化（advisory lock）

### ❌ 仍需手工真机测试

- 真实支付宝沙箱回调（金额、签名等环境差异）
- 真机 OTA 应用后的 App 显示
- 顺丰沙箱推送的 body 格式实证
- 卖家后台 / admin 后台的浏览器交互
- App 物流时间线的视觉呈现
- 多端状态同步的实时性
- VIP 礼包购买流程的支付链路（含支付宝 + 入树 + 解冻奖励）

**测试策略原则**：业务逻辑用自动化测试覆盖（廉价 + 快速），用户交互和环境集成用 1-2 次真机测试覆盖（不重复跑）。

---

## 十、参考资料

### 普通树
- `backend/src/modules/bonus/engine/bonus-allocation.service.ts:850-988` — `assignNormalTreeNodeInline`
- `backend/src/modules/bonus/engine/normal-upstream.service.ts` — 普通树上溯
- `backend/src/modules/bonus/engine/normal-platform-split.service.ts` — 平台 5 池记账
- `backend/prisma/seed.ts:3696-3704` — 普通树 seed 数据

### VIP 树
- `backend/src/modules/bonus/bonus.service.ts:1074-1185` — `assignVipTreeNode`
- `backend/src/modules/bonus/bonus.service.ts:1187-1219` — `bfsInSubtree`
- `backend/src/modules/bonus/engine/vip-upstream.service.ts` — VIP 上溯六分
- `backend/src/modules/bonus/engine/bonus-allocation.service.ts:538-630` — `executeVipUpstreamSixWay` + `executeVipPlatformSplit`

### 6 池计算
- `backend/src/modules/bonus/engine/reward-calculator.service.ts` — `calculateNormal` + `calculateVip`

### 配置常量
- `backend/src/modules/bonus/engine/constants.ts` — `NORMAL_ROOT_ID`、`MAX_TREE_DEPTH`、`MAX_BFS_ITERATIONS`、`MAX_ROOT_NODES`
- `backend/src/modules/bonus/engine/bonus-config.service.ts` — 默认 6 池比例 + branchFactor + maxLayers + freezeDays

### 配套文档
- `docs/issues/app-tofix3.md` — 物流链路 bug 清单（与本文档配套，主链路真机验收记录）
- `CLAUDE.md` — 关键架构决策（普通用户/VIP 分润树章节）
