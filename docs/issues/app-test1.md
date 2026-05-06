# 普通用户树 + 分润系统自动化测试计划

> **生成日期**: 2026-05-06
> **触发场景**: 真机 P1-2 多商户测试中发现普通树插入算法 + 分润链路存在多处隐藏 bug（详见下文「踩坑清单」），手工真机测试再现这些 bug 需要多用户多订单，性价比极低。改用自动化测试覆盖核心业务逻辑。
> **覆盖范围**: 普通用户树（NORMAL_TREE）入树算法 + 利润六分计算 + rewardPool 上溯分配 + 平台 5 池记账 + VIP 路径
> **真相源**: `backend/src/modules/bonus/engine/` 全部源码 + `backend/prisma/schema.prisma` Bonus 域模型
> **状态说明**: ⬜ 未写 | 🔧 编写中 | ✅ 已通过 | ❌ 失败

---

## 一、为什么写这份计划

### 1.1 背景

2026-05-06 真机 P1-2 多商户测试期间，普通用户首次入树 + 后续分润完全失败。逐一排查发现 **3 个相互独立的 bug**（已修但只修了 staging 数据，源头问题还需测试覆盖防回归）：

| Bug | 位置 | 修复 commit |
|---|---|---|
| `AllocationRuleType` enum 缺 `VIP_PLATFORM_SPLIT` | Prisma migration | `8d3200f` |
| `assignNormalTreeNodeInline` 用 `nodeCount` 推算位置不容忍空隙 | `bonus-allocation.service.ts` | `243a0f3` |
| seed 子节点 `rootId='ROOT'` 与常量 `NORMAL_ROOT_ID='NORMAL_ROOT'` 不一致 + nt-u010 超载第 4 子 | `prisma/seed.ts` | `5d60811` |

这些 bug 都不会在单元测试或语法层暴露，必须**端到端跑业务流程**才能发现。手工真机测试发现这些 bug 用了约 4 小时——**自动化测试一次跑完只需几秒**。

### 1.2 现状

后端已有 41 个 bonus 相关测试（`backend/src/modules/bonus/**/*.spec.ts`），但**未覆盖**：

- `assignNormalTreeNodeInline` 边界场景（空隙、超载、stale childrenCount）
- 多用户连续入树后的树形分布正确性
- `allocateForOrder` 完整调用链 + rewardLedger 写入断言
- 三种路由（NORMAL_TREE / VIP_UPSTREAM / VIP_EXITED）+ VIP_PACKAGE 跳过路径
- 6 池数学校验（合计 = 100% profit、reserveFund 末池补差）
- 祖辈解锁 / 冻结 / 过期归平台

### 1.3 目标

写一套**单元 + 集成测试**，让 CI 每次代码变更都自动跑：
1. 已踩过的 bug 不再重现（回归防护）
2. 算法在所有边界场景行为可预期（前置质量保证）
3. 利润分配的数学不变量 (`Σ pools = profit`) 永远满足

---

## 二、测试分层架构

### 2.1 三层金字塔

```
        E2E（HTTP 模拟全链路）— 3-5 case，跨支付/物流/分润
              ▲
         集成测试（实数据库 + Prisma + 完整 service 调用）— 15+ case
              ▲
         单元测试（mock tx，纯算法）— 10+ case
```

**优先级**：单元 > 集成 > E2E

理由：
- 单元层 bug 出现在算法分支决策；集成层 bug 出现在事务/Schema 关联；E2E 层 bug 多是真实环境差异
- 单元 + 集成已能覆盖**所有今天踩过的 bug**
- E2E 必须依赖大量 mock（SF API、支付宝），ROI 较低，**已有真机测试兜底**

### 2.2 范围决策

| 档位 | 内容 | 工作量 | 包含 |
|---|---|---|---|
| **A. 算法单元测试** | `assignNormalTreeNodeInline` 边界 | ~1h | ✅ |
| **B. 分润集成测试** | `allocateForOrder` + ledger | ~2h | ✅ |
| **C. E2E HTTP 测试** | supertest 模拟下单到分润 | ~3h | ⏸ 暂缓 |

**本次实施 A + B**，C 留 backlog。

---

## 三、Phase A — 算法单元测试

文件：`backend/src/modules/bonus/engine/bonus-allocation.normal-tree.spec.ts`（新建）

测试目标：`assignNormalTreeNodeInline` 在各种树状态下都能正确选父节点 + 找空位。

### 3.1 测试 fixture

```ts
// 用 jest.fn() mock tx，给 algorithm 喂可控的 tree state
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
| A1 | 空树（仅 NORMAL_ROOT，无子）| level 0: 1 root | level=1, parentId=NORMAL_ROOT, position=0 |
| A2 | level 1 有 1 子 | root + 1 user at level 1 pos 0 | level=1, position=1 |
| A3 | level 1 有 2 子（连续位置）| root + 2 users at level 1 pos 0,1 | level=1, position=2 |
| A4 | level 1 有 2 子（位置 0 和 2 — 中间空）| root + 2 users at pos 0, 2 | level=1, position=1（找最小未用）|
| A5 | level 1 满 3 子，level 2 全空 | 1 + 3 + 0 | level=2, parentId=最早建的 L1, position=0 |
| A6 | level 1 满 + level 2 部分填 | 1 + 3 + (各 0/1/2 子) | level=2, parentId=children 最少的 L1（tie 取早的）|
| A7 | level 1 + level 2 都满（9 个） | 1+3+9 | level=3, parentId=最早建的 L2, position=0 |
| A8 | childrenCount stale（说有 4 但实际 0）| 数据漂移 | 仍正确插入 level=1 position=0（不依赖 childrenCount）|
| A9 | NORMAL_ROOT 不存在 | 空表 | 自动创建 root + 插入 level=1 |
| A10 | rootId 不一致（'ROOT' vs 'NORMAL_ROOT'）| 模拟今天踩的脏数据 | 给 warn 但仍能插入（防御性，未来可加）|
| A11 | tie-break 由 createdAt asc | 多个 L1 各 0 子但建立时间不同 | 选最早的那个 |
| A12 | branchFactor 配置变更（=4）| config.normalBranchFactor=4 | level=1 能挂第 4 个 |
| A13 | MAX_TREE_DEPTH 限制 | 树满到 depth=20 | 抛错"普通树已满" |

### 3.3 数学不变量断言

```ts
it('插入后 parent.childrenCount 与 actual children 数一致', async () => {
  await assignNormalTreeNodeInline(tx, 'newUser', config);
  const parent = await tx.normalTreeNode.findUnique({ where: { id: insertedParentId } });
  const actualChildren = await tx.normalTreeNode.count({ where: { parentId: insertedParentId } });
  expect(parent.childrenCount).toBe(actualChildren);
});
```

---

## 四、Phase B — 分润集成测试

文件：`backend/src/modules/bonus/engine/bonus-allocation.spec.ts`（扩展现有文件）

测试目标：`allocateForOrder` 完整调用链——树插入 + 6 池计算 + rewardPool 上溯 + 5 池记账。

### 4.1 测试 fixture

用现有 `prisma-test.module.ts` 模式（连本地测试 PG）：

```ts
beforeEach(async () => {
  await resetDb();
  await seedTreeWithSeedScript(); // 同 prisma/seed.ts 同样的 7 节点结构
  await seedTestUsers(['buyer-1', 'buyer-2', 'buyer-3']);
  await seedCompany('青禾智慧农场');
});
```

### 4.2 路由分流测试（B1-B4）

| # | 用例 | 用户身份 | 商品类型 | 期望路由 |
|---|---|---|---|---|
| B1 | 普通用户买普通商品 | normal | NORMAL_GOODS | NORMAL_TREE |
| B2 | VIP 用户买普通商品 | vip | NORMAL_GOODS | VIP_UPSTREAM |
| B3 | VIP-EXITED 用户买普通商品 | vipExited | NORMAL_GOODS | VIP_EXITED |
| B4 | 任何用户买 VIP 礼包 | * | VIP_PACKAGE | **跳过分润**（早 return）|

### 4.3 普通树端到端（B5-B10）

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B5 | 新人首次下单（k=1）| 创建 buyer-1 → 下 1 单 → 收货 → allocateForOrder | tree 插入 nt-u004/level2/pos0；rewardLedger 给 u-004（用 seed 的祖辈）AVAILABLE |
| B6 | 同 buyer 第 2 单（k=2）| buyer-1 第 2 单 | rewardLedger 给 nt-u004 上数第 2 层（=NORMAL_ROOT，userId=null）→ 归平台 |
| B7 | 多人连续 10 单 | 10 个 buyer 各自 1 单 | tree 形态符合「先填 level 1 / level 2 / 再 level 3」预期，分布平衡 |
| B8 | 祖辈 selfPurchaseCount=0 | buyer-1 第 1 单（祖辈 u-004 自购=0）| FROZEN（30 天到期归平台）|
| B9 | 祖辈 selfPurchaseCount>=k | 用 seed 时手动 set u-004.selfPurchaseCount=5 | AVAILABLE 立即到账 |
| B10 | k > normalMaxLayers (15) | buyer 已下 15 单，第 16 单 | over_max_layers，奖励归平台 |

### 4.4 6 池数学（B11-B14）

| # | 用例 | 输入 profit | 期望各池 |
|---|---|---|---|
| B11 | profit=100 | 100 | platform=50, reward=16, industry=16, charity=8, tech=8, reserve=2 |
| B12 | profit=33.33（验末池补差）| 33.33 | 前 5 池独立计算 floor(2 位)，reserve = profit - 前 5 之和 |
| B13 | profit<=0（亏损单）| 0 / 负 | 写 ZERO_PROFIT 标记，无 ledger 流水 |
| B14 | 多商家订单的 industryFund 按比例分 | 商家 A 利润 60% / B 利润 40% | A 拿 16×0.6=9.6，B 拿 16×0.4=6.4 |

### 4.5 VIP 路径（B15-B17）

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B15 | VIP 用户首次买普通商品 | seed VIP 树（10 系统根 A1-A10）+ vip user 挂 A1 子树 → 下普通商品单 | 走 VIP_UPSTREAM；写入 `RewardAllocation(ruleType=VIP_UPSTREAM)` + `RewardAllocation(ruleType=VIP_PLATFORM_SPLIT)` ← **验证 enum 修复** |
| B16 | VIP 用户 k>vipMaxLayers (15) | vip 已下 15 单第 16 单 | rewardPool 归平台 |
| B17 | VIP_PACKAGE 订单 | 任何用户买 VIP 礼包 | 不创建 RewardAllocation；NormalProgress.selfPurchaseCount 不递增 |

### 4.6 幂等性 + 并发（B18-B20）

| # | 用例 | 操作 | 期望 |
|---|---|---|---|
| B18 | 同一订单重复 allocate | allocateForOrder(orderId) × 2 | 第 2 次因 idempotencyKey 唯一约束跳过 |
| B19 | 多 buyer 同时入树（并发）| Promise.all 触发 5 个新人 allocateForOrder | advisory_xact_lock 串行化，无 P2002，最终各自挂到独立 (parent, position) |
| B20 | dead letter 重试 | 模拟第 1 次失败 → 第 2 次成功 | RewardAllocation 不重复，状态正确 |

---

## 五、Phase C — E2E HTTP 测试（暂缓 backlog）

文件：`backend/test/e2e/bonus-flow.e2e-spec.ts`（未来）

```ts
it('卖家自助发货 → SF push → 确认收货 → 分润全链路', async () => {
  // 1. supertest POST /api/v1/orders
  // 2. supertest POST /api/v1/seller/shipping/...
  // 3. 模拟 SF push body POST /api/v1/shipments/sf/callback/<token>
  // 4. supertest POST /api/v1/orders/:id/confirm-receive
  // 5. 断言：RewardAllocation + RewardLedger + tree state
});
```

**为什么暂缓**：
- 真机已经端到端跑通过 SF 链路（commit `b3ffb69` ~ `5d60811`）
- 分润逻辑由 A+B 完全覆盖，不需要再叠 E2E
- E2E 维护成本高（mock 大量外部依赖）

待 v1.5 上线后或新增售后链路时再补。

---

## 六、实施计划

### 6.1 时间排程

| Phase | 工作量 | 测试 case 数 | 优先级 |
|---|---|---|---|
| **A. 算法单元测试** | ~1h | 10-13 | P0 |
| **B. 分润集成测试** | ~2h | 15-20 | P0 |
| **C. E2E 测试** | ~3h | 3-5 | P3（暂缓）|

**P0 总计**：~3h，约 25-33 个 test case。

### 6.2 执行顺序

1. **Phase A 单元测试**（独立可写，无 DB 依赖）
2. **Phase B 集成测试**（依赖现有 prisma-test 模块和 seed 脚本）
3. 运行 `npx jest --testPathPatterns='bonus'` 确认全绿
4. 提交 + push staging
5. CI 自动跑

### 6.3 完成判定

- [ ] Phase A 全部 test case 写完且通过
- [ ] Phase B 全部 test case 写完且通过
- [ ] `backend` 测试总数从 ~371 增加到 ~400
- [ ] 今天踩过的 3 个 bug 都有对应 test case 防回归：
  - VIP_PLATFORM_SPLIT enum → B15
  - 普通树插入算法空隙 → A4 / A8
  - rootId 一致性 → A10
- [ ] CI workflow `npm test` 自动跑（已有，无需配置）

---

## 七、覆盖与不覆盖的边界

### ✅ 自动化测试覆盖

- 入树算法在所有树状态下的决策正确性
- 6 池数学计算 + 末池补差
- rewardPool 给祖辈 vs 归平台的判定
- 解锁 / 冻结 / 过期状态机
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

**测试策略原则**：业务逻辑用自动化测试覆盖（廉价 + 快速），用户交互和环境集成用 1-2 次真机测试覆盖（不重复跑）。

---

## 八、参考资料

- `backend/src/modules/bonus/engine/bonus-allocation.service.ts` — 主入口
- `backend/src/modules/bonus/engine/normal-upstream.service.ts` — 普通树上溯
- `backend/src/modules/bonus/engine/reward-calculator.service.ts` — 6 池计算
- `backend/src/modules/bonus/engine/normal-platform-split.service.ts` — 平台 5 池记账
- `backend/prisma/seed.ts:3696-3704` — 普通树 seed 数据（现已修复，rootId 统一为 NORMAL_ROOT）
- `docs/issues/app-tofix3.md` — 物流链路 bug 清单（与本文档配套，主链路真机验收记录）
- `CLAUDE.md` — 关键架构决策（普通用户分润树章节）
