# 普通用户分润奖励系统改造计划

> 文档创建时间：2026-02-27
> 最后更新：2026-03-01（v19 — 三端鉴权 + 卖家报表 + 数据隔离 + 状态同步 + DTO 校验全面加固）
> 状态：**全端开发完成** — 后端 Phase A~L ✅ / 买家App ✅ / 卖家端 10/10 ✅ / 管理后台 16/16 ✅ / 四端 TSC + Prisma validate 通过 ✅ / 跨端契约审计 24/24 ✅ / 流程完整性审计 5/5 ✅ / 架构质量审计 R7 4/5 + R8 5/5 + R9 12/12 ✅
> 涉及系统：买家App / 卖家后台 / 管理后台 / 后端

---

## 一、需求概述

### 1.1 九大改动项

| # | 改动 | 影响范围 |
|---|------|---------|
| 1 | **首页抽奖转盘**：默认每天一次（`LOTTERY_DAILY_CHANCES` 可配置），奖池含"低价买高价商品"和"消费满X送商品"两类，奖品自动加入购物车 | 买家App、管理后台、后端 |
| 2 | **普通用户分润树**：取消滑动窗口机制，改为和VIP类似的多叉树（自动入树，无需推荐） | 后端核心改造 |
| 3 | **奖励分配机制**：第k次消费利润的16%给第k层祖辈，需祖辈消费k次解锁，冻结30天后过期 | 后端核心改造 |
| 4 | **利润六分**：平台50% / 奖励16% / 产业基金(卖家)16% / 慈善8% / 科技8% / 备用金2% | 后端 |
| 5 | **自动定价**：卖家设成本，售价=成本×130%（加价率后台可配） | 卖家后台、后端 |
| 6 | **VIP排除**：VIP用户在普通树中不领奖励（归平台） | 后端 |
| 7 | **运费三维度**：金额区间 × 地区 × 重量，后台配置 | 管理后台、后端 |
| 8 | **取消退款改换货**：质量问题上传照片→审核→重新发货，无退款 | 买家App、卖家后台、管理后台、后端 |
| 9 | **普通/VIP完全独立**：所有参数独立配置 | 管理后台、后端 |

### 1.2 核心业务逻辑 — 普通用户分润树

**入树规则**：
- 触发条件：用户首笔订单确认收货时自动入树（抽奖订单也算）
- 树结构：多叉树，默认3叉，后台可配
- 根节点：**单个平台系统根节点**（Level 0），分配到根的奖励直接归平台（不走冻结流程）
- 插入算法：**轮询平衡插入** — 在当前活跃层，按上一层父节点的入树时间排序，先给每个父节点1个子节点，全部有1个后再给第2个，直到形成满层后进入下一层

**奖励分配规则（与VIP机制完全一致，仅金额/比例不同）**：
- 每笔订单确认收货时计算利润（售价-成本），16%为奖励池
- 用户第k次消费（在普通树中的计数）→ 奖励给第k层祖辈节点（往上数k层）
- **分配上限**：k 最大为 maxLayers（默认15），第16次及之后的消费不再分配奖励（16%归平台）
- **自然停止**：若用户离根节点较近（如Level 5），到达根节点后上方无祖辈，后续消费也不再分配。这是两个独立的停止条件
- 取消价格区间分类，所有消费统一处理

**解锁机制**：
- 第k层祖辈需要自己完成≥k次消费才能解锁该奖励
- 未解锁的奖励处于冻结状态（用户可见但不可用）
- 冻结时限默认30天（后台可配），过期后奖励归平台
- 用户新增消费时，自动释放符合条件的冻结奖励（requiredLevel ≤ newPurchaseCount）

**VIP互斥**：
- 若奖励接收者已是VIP用户 → 该奖励归平台
- 若奖励接收者为系统根节点 → 该奖励归平台
- 用户成为VIP后，其普通树位置保留但不再接收新奖励，普通树消费计数冻结

**利润分配流（普通用户与VIP用户均使用六分结构，各自独立配比）**：
```
售价 = 成本 × 1.3（自动定价）
订单利润 = Σ(unitPrice - cost) × quantity（逐商品项计算，利润≤0的不参与）

利润分配（普通用户）：
├── 50% → 平台利润账户
├── 16% → 奖励池 → 通过普通树分配给祖辈（无合格接收者则归平台）
├── 16% → 产业基金 → 对应商品的卖家公司（卖家总收入 = 成本 + 此部分 ≈ 成本×1.048）
├── 8%  → 慈善基金
├── 8%  → 科技基金
└── 2%  → 备用金
```

---

## 二、设计决策记录

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| D1 | 普通树根节点 | **单个平台系统根节点**（Level 0），奖励到根直接归平台（不走冻结） | 避免先入者优势，结构简单，根节点奖励自然归平台 |
| D2 | 普通树数量 | **单棵树**，所有用户在同一棵树中，轮询平衡插入 | 无需推荐码，纯顺序入树，单棵树结构清晰 |
| D3 | Type2奖品(消费满X送) | 0元加入购物车 + 结算时校验非奖品商品总额 ≥ 门槛X | 用户体验清晰，实现简单 |
| D4 | 抽奖空奖 | 支持"谢谢参与"选项，后台可配各奖品概率，总和100% | 控制成本，符合商业实际 |
| D5 | 抽奖商品利润 | 后台独立设置成本和价格（成本≤售价），确保利润≥0 | 避免负利润导致分配异常 |
| D6 | 普通/VIP参数隔离 | RuleConfig中使用前缀区分（`NORMAL_`/`VIP_`），管理后台分为两个独立设置页面 | 完全独立，互不影响 |
| D7 | 售后流程 | 新建ReplacementRequest模型替代Refund退款流程，仅支持换货 | 业务语义不同（退款vs换货），需要新字段（照片、描述） |
| D8 | 奖励发放时机 | 确认收货时（与现有VIP系统一致） | 无退款风险，确认收货=最终状态 |
| D9 | 卖家自动定价 | 卖家设SKU成本，系统按 `cost × markupRate`（默认1.3）自动算售价 | 统一利润率，简化卖家操作 |
| D10 | 运费体系 | 平台统一运费规则（替代原商户独立ShippingTemplate），按"金额区间+地区+重量"三维度计算 | 平台统一管控价格和运费 |
| D11 | VIP利润公式 | **与普通用户统一为六分结构**，VIP默认50/30/10/2/2/6（平台/奖励/产业基金/慈善/科技/备用金） | 100%利润显式分配，消除隐性平台收入，两套系统结构统一但配比独立 |
| D12 | 卖家收入 | 卖家总收入 = 成本回收 + 利润×16%产业基金 ≈ 成本×1.048 | 产业基金给对应商品的具体卖家，非统一资金池 |
| D13 | 根节点奖励处理 | 分配到系统根节点的奖励**直接归平台**，不走冻结→过期流程 | 根节点无法消费，走冻结流程无意义 |
| D14 | VIP冻结过期 | VIP系统**新增冻结过期机制**（VIP_FREEZE_DAYS，独立配置，默认30天） | 现有VIP冻结奖励无过期，需与普通系统对齐，但天数独立 |
| D15 | 订单流程 | **付款后才创建订单**：引入 CheckoutSession 中间态，支付回调中原子建单 | 消除 PENDING_PAYMENT 状态，避免库存预扣竞态。详见 `new-features-design.md` §1 |
| D16 | 赠品锁定 | THRESHOLD_GIFT 入购物车为锁定状态，按勾选非奖品商品总额实时解锁 | CartItem 新增 isLocked/threshold/isSelected 字段。详见 `new-features-design.md` §2 |
| D17 | 奖品过期 | 可配置过期时间（小时），从入购物车起算，混合清理（访问时+定时任务） | LotteryPrize 新增 expirationHours，CartItem 新增 expiresAt。详见 `new-features-design.md` §3 |
| D18 | 平台公司 | 平台公司命名"爱买买app"，Company 新增 `isPlatform` 字段，商品搜索排除奖励商品 | 详见 `new-features-design.md` §4 |
| D19 | 奖励过期可配置 | VIP/普通分别设定奖励有效期（天），替换硬编码 30 天 | 新增 VIP_REDPACK_EXPIRY_DAYS / NORMAL_REDPACK_EXPIRY_DAYS 配置键。详见 `new-features-design.md` §5 |
| D20 | 奖品不可退 | 奖品从购物车消失即永久丢失，wonCount 永不回退 | 经产品确认，清空购物车删奖品为预期行为 |
| D21 | 超卖容忍 | 允许库存变为负数，卖家收到补货通知 | 简化支付回调流程，消除退款补偿逻辑 |

---

## 二（续）、改动分类 — 普通系统 vs. VIP系统 vs. 系统级

### 只改普通系统（不动VIP）

| 改动 | 说明 |
|------|------|
| NormalTreeNode / NormalProgress / NormalEligibleOrder 模型 | 全新数据结构，独立于VIP |
| 轮询平衡插入算法 | VIP用BFS+推荐人优先，普通树用轮询平衡（完全不同的算法） |
| normal-upstream.service.ts | 普通树分配引擎（参考但独立于 vip-upstream） |
| 利润六分公式 | 普通用户（50/16/16/8/8/2）和VIP用户（50/30/10/2/2/6）均使用六分结构，各自独立配比 |
| NORMAL_RED_PACKET 账户类型 | 新账户类型，VIP继续用 RED_PACKET |
| NORMAL_* 系列 RuleConfig 配置键 | 独立参数空间 |
| 管理后台-普通树配置/查看器 | 新增页面 |
| 买家App-普通树页面 | 新增页面 |
| 废弃 NormalBroadcast 滑动窗口 | 只影响普通系统 |

### VIP系统也要改的

| 改动 | 说明 |
|------|------|
| **冻结奖励过期机制** | 现有VIP冻结奖励**无过期**。需新增：VIP_FREEZE_DAYS（独立配置，默认30天），过期后VOID归平台 |
| **vip-upstream.service.ts** | 创建 FROZEN ledger 时写入 `meta.expiresAt = now + VIP_FREEZE_DAYS` |
| **FreezeExpireService Cron** | 统一处理两个系统的冻结过期，分别按各自 FREEZE_DAYS 计算 |
| **purchaseVip() 流程** | 新增：冻结用户的 NormalProgress（设 frozenAt），确保后续消费不再走普通树 |
| **bonus-allocation.service.ts 路由决策** | 新增 NORMAL_TREE 分支，替代 NORMAL_BROADCAST |

### 系统级改动（与VIP/普通身份无关，所有用户/订单受影响）

| 改动 | 说明 |
|------|------|
| 抽奖转盘 | 所有用户均可参与 |
| 自动定价（成本×1.3） | 所有卖家商品 |
| 奖励商品管理 | 管理后台新增 |
| 运费三维度规则 | 所有订单 |
| 取消退款改换货 | 所有订单 |

---

## 三、数据模型变更

### 3.1 新增模型

#### 3.1.1 NormalTreeNode — 普通用户树节点

```prisma
model NormalTreeNode {
  id            String            @id @default(cuid())
  rootId        String            // 树标识（单棵树固定为 "NORMAL_ROOT"）
  userId        String?           @unique // null = 系统根节点（Level 0 平台节点）
  parentId      String?
  parent        NormalTreeNode?   @relation("NormalTree", fields: [parentId], references: [id])
  children      NormalTreeNode[]  @relation("NormalTree")
  level         Int               // 0=根节点, 1=第一层用户...
  position      Int               // 在父节点下的位置 (0, 1, 2)
  childrenCount Int               @default(0)
  createdAt     DateTime          @default(now())

  @@unique([parentId, position])        // 防并发插入同位置
  @@index([level, position])            // 层级查询
  @@index([level, childrenCount])       // 插入时找活跃层有空位的父节点
}
```

#### 3.1.2 NormalProgress — 普通用户消费进度

```prisma
model NormalProgress {
  id                String    @id @default(cuid())
  userId            String    @unique
  user              User      @relation(...)
  selfPurchaseCount Int       @default(0)  // 在普通树中的有效消费次数
  treeNodeId        String?   // 关联 NormalTreeNode
  frozenAt          DateTime? // 成为VIP时冻结
  updatedAt         DateTime  @updatedAt
}
```

#### 3.1.3 NormalEligibleOrder — 普通树有效消费记录

```prisma
model NormalEligibleOrder {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(...)
  orderId        String   @unique
  order          Order    @relation(...)
  amount         Float
  effectiveIndex Int?     // k（第几次有效消费）
  valid          Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([userId, valid, createdAt])
  @@index([userId, effectiveIndex])
}
```

#### 3.1.4 LotteryPrize — 抽奖奖池配置

```prisma
model LotteryPrize {
  id            String          @id @default(cuid())
  type          LotteryPrizeType  // DISCOUNT_BUY / THRESHOLD_GIFT / NO_PRIZE
  name          String            // 展示名称，如"1元白酒"
  productId     String?           // 关联奖励商品（NO_PRIZE 为 null）
  product       Product?          @relation(...)
  skuId         String?           // 关联具体SKU
  sku           ProductSKU?       @relation(...)
  prizePrice    Float?            // 奖品价格（DISCOUNT_BUY时为特价，THRESHOLD_GIFT时为0）
  threshold     Float?            // 消费门槛（仅 THRESHOLD_GIFT 类型）
  prizeQuantity Int               @default(1) // 奖品数量
  probability   Float             // 中奖概率 (0-100)，所有奖品概率之和=100
  dailyLimit    Int?              // 每日最大中奖数（控制成本）
  totalLimit    Int?              // 总中奖数限制
  wonCount      Int               @default(0) // 已中奖次数
  isActive      Boolean           @default(true)
  sortOrder     Int               @default(0) // 转盘上的展示顺序
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
}
```

#### 3.1.5 LotteryRecord — 抽奖记录

```prisma
model LotteryRecord {
  id        String         @id @default(cuid())
  userId    String
  user      User           @relation(...)
  prizeId   String?        // 中奖的奖品ID（未中奖为null）
  prize     LotteryPrize?  @relation(...)
  result    LotteryResult  // WON / NO_PRIZE
  drawDate  String         // "2026-02-27"，用于每日次数限制
  meta      Json?          // 奖品快照信息
  createdAt DateTime       @default(now())

  @@index([userId, drawDate])   // 每用户每天可多次（由 LOTTERY_DAILY_CHANCES 限制）
  @@index([userId, createdAt])
}
```

#### 3.1.6 ShippingRule — 平台统一运费规则

```prisma
model ShippingRule {
  id           String   @id @default(cuid())
  name         String            // 规则名称
  regionCodes  String[]          // 适用地区行政区划码列表（省级，空=全国）
  minAmount    Float?            // 订单金额下限（含）
  maxAmount    Float?            // 订单金额上限（不含，null=无上限）
  minWeight    Int?              // 商品总重量下限(克)
  maxWeight    Int?              // 商品总重量上限(克)
  fee          Float             // 运费金额
  priority     Int               @default(0)  // 优先级（高优先级先匹配）
  isActive     Boolean           @default(true)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
}
```
> 匹配逻辑：按 priority 降序，找到第一条全部维度匹配的规则即返回其 fee。若无匹配规则，使用默认运费（RuleConfig 中配置）。

#### 3.1.7 ReplacementRequest — 换货请求（替代退款）

```prisma
model ReplacementRequest {
  id              String               @id @default(cuid())
  orderId         String
  order           Order                @relation(...)
  userId          String
  user            User                 @relation(...)
  orderItemId     String?              // 具体商品项（null=整单）
  orderItem       OrderItem?           @relation(...)
  reason          String               // 问题描述
  photos          String[]             // 照片URL列表（必须上传）
  status          ReplacementStatus    @default(REQUESTED)
  reviewerId      String?              // 审核人（卖家staff或管理员）
  reviewNote      String?
  reviewedAt      DateTime?
  replacementShipmentId String?        // 换货物流单号
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([orderId])
  @@index([userId, status])
}
```

### 3.2 修改模型

#### 3.2.1 枚举新增/修改

```prisma
// 新增枚举
enum LotteryPrizeType {
  DISCOUNT_BUY      // 低价买高价商品（1元白酒）
  THRESHOLD_GIFT    // 消费满X送商品
  NO_PRIZE          // 谢谢参与
}

enum LotteryResult {
  WON
  NO_PRIZE
}

enum ReplacementStatus {
  REQUESTED         // 用户提交
  UNDER_REVIEW      // 审核中
  APPROVED          // 已批准，待发货
  SHIPPED           // 已重新发货
  COMPLETED         // 用户确认收到
  REJECTED          // 驳回
}

// 修改枚举
enum RewardAccountType {
  RED_PACKET          // VIP奖励（保持现有）
  NORMAL_RED_PACKET   // 新增：普通用户奖励
  POINTS
  FUND_POOL
  PLATFORM_PROFIT
  INDUSTRY_FUND       // 新增：产业基金（卖家）
  CHARITY_FUND        // 新增：慈善基金
  TECH_FUND           // 新增：科技基金
  RESERVE_FUND        // 新增：备用金
}

enum AllocationRuleType {
  NORMAL_BROADCAST    // 将废弃
  NORMAL_TREE         // 新增：普通用户树分配
  VIP_UPSTREAM
  PLATFORM_SPLIT
  ZERO_PROFIT
}
```

#### 3.2.2 MemberProfile — 新增普通树字段

```diff
model MemberProfile {
  ...existing fields...
+ normalTreeNodeId  String?  // NormalTreeNode ID
+ normalJoinedAt    DateTime? // 加入普通树的时间
}
```

#### 3.2.3 Order — 新增关联

```diff
model Order {
  ...existing fields...
+ normalEligibleOrder NormalEligibleOrder?
+ replacementRequests ReplacementRequest[]
}
```

#### 3.2.4 OrderItem — 新增奖品标记

```diff
model OrderItem {
  ...existing fields...
+ isPrize       Boolean  @default(false)   // 是否为抽奖奖品
+ prizeType     String?                     // DISCOUNT_BUY / THRESHOLD_GIFT
+ prizeRecordId String?                     // 关联 LotteryRecord
}
```

#### 3.2.5 ProductSKU — 自动定价标记

```diff
model ProductSKU {
  ...existing fields...
  // price 字段保留，但对卖家商品由系统自动计算 (= cost × markupRate)
  // cost 字段从 optional 改为 required（卖家商品必填）
- cost  Float?
+ cost  Float   // 成本价（元），卖家商品必填，平台/抽奖商品由后台设置
}
```
> 注意：奖励商品（用于抽奖）的成本和售价由管理后台独立设置，不受 markupRate 约束，但需满足 cost ≤ price。

#### 3.2.6 CartItem — 赠品锁定 + 奖品过期（v2 新增，F2+F3）

```diff
model CartItem {
  ...existing fields...
+ isLocked      Boolean    @default(false)  // THRESHOLD_GIFT 未达门槛时锁定
+ threshold     Float?                       // 解锁门槛金额
+ isSelected    Boolean    @default(true)    // 用户是否勾选该商品
+ createdAt     DateTime   @default(now())   // 入购物车时间（奖品过期起算点）
+ expiresAt     DateTime?                    // 奖品过期时间（= createdAt + expirationHours）
}
```

#### 3.2.7 LotteryPrize — 过期时间配置（v2 新增，F3）

```diff
model LotteryPrize {
  ...existing fields...
+ expirationHours  Int?   // 可配置过期时间（小时），null = 不过期
}
```

#### 3.2.8 Company — 平台公司标记（v2 新增，F4）

```diff
model Company {
  ...existing fields...
+ isPlatform  Boolean  @default(false)  // 平台官方公司标记
}
```

#### 3.2.9 CheckoutSession — 结算会话（v2 新增，F1）

```prisma
enum CheckoutSessionStatus {
  ACTIVE      // 等待支付
  PAID        // 支付确认，正在创建订单
  COMPLETED   // 订单创建成功
  EXPIRED     // 会话超时（30分钟）
  FAILED      // 库存不足等原因失败
}

model CheckoutSession {
  id              String                @id @default(cuid())
  userId          String
  user            User                  @relation(...)
  status          CheckoutSessionStatus @default(ACTIVE)
  itemsSnapshot   Json                  // 结算时的商品快照
  addressSnapshot Json                  // 收货地址快照
  redPackId       String?               // 选用的奖励 ID
  expectedTotal   Float                 // 应付总额
  goodsAmount     Float                 // 商品金额
  shippingFee     Float                 // 运费
  discountAmount  Float    @default(0)  // 奖励抵扣
  merchantOrderNo String?  @unique
  paymentChannel  PaymentChannel?
  providerTxnId   String?  @unique
  idempotencyKey  String?
  expiresAt       DateTime
  paidAt          DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  orders          Order[]

  @@unique([userId, idempotencyKey])
  @@index([userId, status])
  @@index([merchantOrderNo])
  @@index([expiresAt, status])
}
```

#### 3.2.10 Order — 关联 CheckoutSession（v2 新增，F1）

```diff
model Order {
  ...existing fields...
+ checkoutSessionId  String?
+ checkoutSession    CheckoutSession? @relation(...)
}
```

#### 3.2.11 RewardEntryStatus — 奖励预留状态（v2 新增，F1）

```diff
enum RewardEntryStatus {
  ...existing values...
+ RESERVED    // 结算会话中预留，支付成功后消费，超时释放
}
```

### 3.3 废弃模型（不删除，标记废弃，保留历史数据）

| 模型 | 原用途 | 替代方案 |
|------|--------|---------|
| NormalBucket | 普通奖励价格区间分桶 | NormalTreeNode + 树分配 |
| NormalQueueMember | 滑动窗口队列成员 | NormalEligibleOrder |
| ShippingTemplate | 商户独立运费模板 | ShippingRule 平台统一运费 |
| Refund / RefundItem | 退款流程 | ReplacementRequest 换货流程 |

> 废弃不等于删除。这些模型在 Schema 中保留（加注释标记 `@deprecated`），以支持历史数据查询。新业务流程不再写入这些表。

### 3.4 RuleConfig 新增配置键

**普通用户系统（`NORMAL_` 前缀，与VIP完全独立）**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `NORMAL_BRANCH_FACTOR` | 3 | 普通树叉数 |
| `NORMAL_MAX_LAYERS` | 15 | 最大分配层数（每个用户最多收下面15层奖励） |
| `NORMAL_FREEZE_DAYS` | 30 | 冻结奖励过期天数 |
| `NORMAL_PLATFORM_PERCENT` | 0.50 | 平台分成比例 |
| `NORMAL_REWARD_PERCENT` | 0.16 | 奖励分成比例 |
| `NORMAL_INDUSTRY_FUND_PERCENT` | 0.16 | 产业基金(卖家)比例 |
| `NORMAL_CHARITY_PERCENT` | 0.08 | 慈善基金比例 |
| `NORMAL_TECH_PERCENT` | 0.08 | 科技基金比例 |
| `NORMAL_RESERVE_PERCENT` | 0.02 | 备用金比例 |

**定价系统**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `MARKUP_RATE` | 1.30 | 卖家商品加价率（售价=成本×此值） |

**运费系统**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `DEFAULT_SHIPPING_FEE` | 8.0 | 无匹配规则时的默认运费 |

**VIP系统新增（冻结过期，原有VIP系统无此机制）**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `VIP_FREEZE_DAYS` | 30 | VIP冻结奖励过期天数（与NORMAL独立配置） |

**抽奖系统**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `LOTTERY_ENABLED` | true | 抽奖功能开关 |
| `LOTTERY_DAILY_CHANCES` | 1 | 每日抽奖次数 |

**奖励有效期（v2 新增，F5）**：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `VIP_REWARD_EXPIRY_DAYS` | 30 | VIP 用户已释放奖励有效期（天） |
| `NORMAL_REWARD_EXPIRY_DAYS` | 30 | 普通用户已释放奖励有效期（天） |

---

## 四、后端模块变更

### 4.1 新增模块

#### 4.1.1 `modules/lottery/` — 抽奖模块

| 文件 | 职责 |
|------|------|
| `lottery.controller.ts` | 买家端：`POST /lottery/draw`（抽奖）、`GET /lottery/today`（今日抽奖状态：已用/剩余次数）、`GET /lottery/prizes`（奖池列表用于转盘展示） |
| `lottery.service.ts` | 抽奖核心逻辑：概率计算、库存检查、每日限制、结果写入 |
| `lottery.module.ts` | 模块定义 |

**抽奖逻辑**：
1. 事务内统计用户当日抽奖次数（`LotteryRecord.count`）并校验 `LOTTERY_DAILY_CHANCES`
2. 获取所有 isActive 的 `LotteryPrize`
3. 按概率加权随机选择一个奖品
4. 若选中 NO_PRIZE → 记录结果，返回"谢谢参与"
5. 若选中实物奖品 → 检查 dailyLimit/totalLimit → 原子递增 wonCount → 记录结果
6. 返回奖品信息（前端负责加入购物车）

**并发控制**：使用 Serializable 事务 + 事务内次数校验 + `wonCount` CAS 防并发超发

#### 4.1.2 `modules/admin/lottery/` — 管理后台抽奖管理

| 文件 | 职责 |
|------|------|
| `admin-lottery.controller.ts` | 奖池CRUD、抽奖记录查询、统计 |
| `admin-lottery.service.ts` | 奖池管理逻辑，概率总和校验 |

**API**：
- `GET /admin/lottery/prizes` — 奖池列表
- `POST /admin/lottery/prizes` — 新增奖品
- `PUT /admin/lottery/prizes/:id` — 编辑奖品
- `DELETE /admin/lottery/prizes/:id` — 删除奖品
- `GET /admin/lottery/records` — 抽奖记录列表
- `GET /admin/lottery/stats` — 抽奖统计（今日中奖数、各奖品消耗等）

#### 4.1.3 `modules/admin/platform-product/` — 奖励商品管理

| 文件 | 职责 |
|------|------|
| `platform-product.controller.ts` | 奖励商品CRUD |
| `platform-product.service.ts` | 奖励商品管理逻辑 |

**设计**：
- 在 Company 表中创建一个系统级"平台公司"记录（id 固定，如 `PLATFORM_COMPANY`）
- 奖励商品就是 `companyId = 'PLATFORM_COMPANY'` 的普通 Product
- 复用现有 Product/ProductSKU 模型，但由管理后台管理（非卖家）
- 奖励商品不受 `markupRate` 自动定价约束，成本和价格由管理员手动设置

**API**：
- `GET /admin/reward-products` — 奖励商品列表
- `POST /admin/reward-products` — 新增
- `PUT /admin/reward-products/:id` — 编辑
- `DELETE /admin/reward-products/:id` — 下架/删除

#### 4.1.4 `modules/admin/shipping-rule/` — 运费规则管理

| 文件 | 职责 |
|------|------|
| `shipping-rule.controller.ts` | 运费规则 CRUD |
| `shipping-rule.service.ts` | 规则管理 + 运费计算引擎 |

**API**：
- `GET /admin/shipping-rules` — 规则列表
- `POST /admin/shipping-rules` — 新增规则
- `PUT /admin/shipping-rules/:id` — 编辑规则
- `DELETE /admin/shipping-rules/:id` — 删除规则
- `POST /admin/shipping-rules/preview` — 运费预览测试（传入金额/地区/重量，返回运费）

#### 4.1.5 `modules/replacements/` — 换货模块

| 文件 | 职责 |
|------|------|
| `replacement.controller.ts` | 买家端：`POST /replacements/orders/:orderId`（申请换货）、`GET /replacements`（我的换货记录） |
| `replacement.service.ts` | 换货申请逻辑、照片校验 |

#### 4.1.6 `modules/admin/replacements/` + `modules/seller/replacements/` — 换货审核

| 端 | API |
|----|-----|
| 卖家端 | `GET /seller/replacements` 列表、`POST /seller/replacements/:id/approve` 审核通过、`POST /seller/replacements/:id/reject` 驳回、`POST /seller/replacements/:id/ship` 发货 |
| 管理端 | `GET /admin/replacements` 列表、`POST /admin/replacements/:id/arbitrate` 仲裁（平台介入） |

### 4.2 修改模块

#### 4.2.1 `modules/bonus/engine/` — 分润引擎核心改造

| 文件 | 变更 |
|------|------|
| `bonus-allocation.service.ts` | **路由决策增加 NORMAL_TREE**：若用户非VIP → 走 NormalTree 分配（替代 NormalBroadcast） |
| `reward-calculator.service.ts` | **新增普通用户利润计算**：6项直接分割（替代2级分割），根据 `AllocationRuleType` 选择计算公式 |
| `normal-broadcast.service.ts` | **废弃**，不再调用。保留代码供历史数据回溯 |
| `bonus-config.service.ts` | **新增普通系统配置加载**：读取 `NORMAL_*` 前缀的 RuleConfig，与VIP配置完全隔离 |
| `constants.ts` | 新增：`PLATFORM_COMPANY_ID`、`NORMAL_ROOT_ID = 'NORMAL_ROOT'` |

**新增文件**：

| 文件 | 职责 |
|------|------|
| `normal-upstream.service.ts` | **普通树分配核心**（参考 vip-upstream.service.ts 设计）|
| `normal-platform-split.service.ts` | **普通用户6项利润分割** |

**`normal-upstream.service.ts` 核心逻辑（与 vip-upstream.service.ts 机制一致）**：
```
输入：orderId, userId
1. 查询用户的 NormalProgress.selfPurchaseCount → k = prevCount + 1
2. 若 k > maxLayers（默认15）→ 不分配奖励，16%归平台，退出
3. CTE递归查询第k层祖辈节点（往上数k层）
4. 若第k层祖辈不存在（已到达/越过根节点）→ 16%归平台，退出
5. 递增 NormalProgress.selfPurchaseCount
6. 创建 NormalEligibleOrder（effectiveIndex = k）
7. 判断祖辈：
   a. 系统根节点(userId=null) → 奖励直接归平台（不冻结）
   b. VIP用户(MemberProfile.tier=VIP) → 奖励归平台
   c. 祖辈 NormalProgress.selfPurchaseCount >= k → AVAILABLE（已解锁）
   d. 祖辈 NormalProgress.selfPurchaseCount < k → FROZEN（冻结，设expiresAt = now + freezeDays）
8. 创建 RewardLedger（meta: {requiredLevel: k, expiresAt, scheme: 'NORMAL_TREE'}）
9. 更新 RewardAccount（NORMAL_RED_PACKET 类型，balance 或 frozen）
10. 尝试释放祖辈已有的冻结奖励（requiredLevel ≤ 新selfPurchaseCount 的全部释放）
```

#### 4.2.2 `modules/bonus/bonus.service.ts` — 买家端服务

| 变更 | 说明 |
|------|------|
| 新增 `assignNormalTreeNode()` | 轮询平衡插入算法（详见下方） |
| 新增 `getNormalTreeContext()` | 普通树可视化数据 |
| 新增 `getNormalRewards()` | 普通奖励列表（含冻结状态） |
| 修改 `purchaseVip()` | 冻结用户的普通树进度（设 NormalProgress.frozenAt） |

**轮询平衡插入算法 `assignNormalTreeNode(userId)`**：
```
（单棵树，单个平台根节点）
1. Serializable 事务内执行
2. 找到活跃层 L：从 Level 1 开始，找第一个未满层
   - 层L的节点数 < 上层节点数 × branchFactor → L是活跃层
   - Level 1 的父节点数 = 1（根节点），满 = branchFactor 个
   - Level 2 的父节点数 = branchFactor，满 = branchFactor² 个
3. 获取层L-1的所有父节点（按 createdAt 排序）
4. 当前层已有节点数 = nodeCount
5. round = nodeCount / parentCount  (整除)
6. parentIndex = nodeCount % parentCount
7. 若 round >= branchFactor → L层已满，L++，重新计算
8. parent = parents[parentIndex]
9. position = round
10. 创建 NormalTreeNode(rootId='NORMAL_ROOT', userId, parentId, level=L, position)
11. 原子递增 parent.childrenCount
```

#### 4.2.3 `modules/order/order.service.ts` — 订单模块

| 变更 | 说明 |
|------|------|
| `calculateShippingFee()` | **重写**：使用 ShippingRule 平台统一规则（替代商户 ShippingTemplate） |
| `createFromCart()` | 新增奖品商品校验（isPrize、门槛检查）、自动定价校验 |
| `previewOrder()` | 同上：奖品商品展示、新运费计算 |
| `confirmReceive()` | 新增：首次收货时触发普通树入树逻辑 |
| `applyAfterSale()` | **重写为换货申请**：移除退款金额逻辑，改为 ReplacementRequest |

**运费计算新逻辑**：
```
输入：regionCode（收货地区）, totalWeight（总重量，克）, goodsAmount（商品金额）
注：管理端配置/预览使用 kg（可小数），后端在 API 层统一换算为克存储与匹配。
1. 查询所有 isActive 的 ShippingRule，按 priority 降序
2. 遍历规则，找第一条匹配的：
   - regionCodes 为空（全国）或包含 regionCode 的省级前缀
   - minAmount <= goodsAmount < maxAmount（null = 无限制）
   - minWeight <= totalWeight < maxWeight（null = 无限制）
3. 返回匹配规则的 fee
4. 无匹配 → 返回 DEFAULT_SHIPPING_FEE
```

#### 4.2.4 `modules/product/` — 商品模块（后端）

| 变更 | 说明 |
|------|------|
| 创建/更新商品时 | 若 companyId ≠ PLATFORM_COMPANY → 强制 `price = cost × markupRate`（卖家商品自动定价） |
| 验证逻辑 | 卖家商品：cost 必填、price 由系统计算。奖励商品：cost 和 price 均由管理员设置，cost ≤ price |

#### 4.2.5 `modules/admin/bonus/` — 管理后台奖励管理

| 变更 | 说明 |
|------|------|
| 新增普通树查看器 | 类似VIP树查看器（breadcrumb、子节点懒加载） |
| 新增普通系统配置CRUD | 独立配置页面：`NORMAL_*` 系列参数 |
| 修改VIP配置 | 确保VIP参数使用 `VIP_*` 前缀，与普通系统隔离 |

#### 4.2.6 `modules/seller/product/` — 卖家商品管理（后端）

| 变更 | 说明 |
|------|------|
| 创建/更新DTO | 移除 price 字段（或标记只读），仅接受 cost |
| 响应中 | 返回 calculatedPrice（= cost × markupRate）供卖家查看 |

### 4.3 新增定时任务

| Cron Job | 频率 | 职责 |
|----------|------|------|
| `FreezeExpireService` | 每小时 | 扫描**两个系统**的过期冻结奖励：NORMAL_RED_PACKET 按 NORMAL_FREEZE_DAYS 过期，RED_PACKET（VIP）按 VIP_FREEZE_DAYS 过期。VOID 并转入 PLATFORM_PROFIT |

> **VIP系统变更**：现有VIP冻结奖励无过期机制。此 Cron Job 同时处理VIP冻结奖励的过期，是对VIP系统的新增功能。需修改 `vip-upstream.service.ts` 在创建 FROZEN ledger 时写入 `meta.expiresAt`。

### 4.4 废弃服务

| 服务 | 原用途 | 说明 |
|------|--------|------|
| `normal-broadcast.service.ts` | 滑动窗口分配 | 新增 `normal-upstream.service.ts` 替代，旧服务保留不删除 |

---

## 五、买家App前端变更

### 5.1 新增页面/组件

| 文件路径 | 说明 |
|---------|------|
| ~~`src/components/lottery/LotteryWheel.tsx`~~ | ~~圆形转盘组件~~ → 已用 `src/components/effects/SpinWheel.tsx`（SVG等分扇形转盘，SharedValue旋转控制）替代 |
| ~~`src/components/lottery/LotteryResult.tsx`~~ | ~~中奖/未中奖结果弹窗~~ → 已集成在 `app/lottery.tsx` 内（AppBottomSheet + AiTypingEffect 逐字揭晓） |
| `src/components/effects/WheelPointer.tsx` | 金色倒三角指针（旋转时 ±3° 摆动模拟物理弹片） |
| `src/components/effects/Confetti.tsx` | 中奖庆祝粒子爆发（25粒子+重力物理+淡出，设计令牌颜色） |
| `app/me/normal-tree.tsx` | 普通用户树可视化页面（类似 bonus-tree.tsx） |
| `app/me/replacement.tsx` | 换货记录列表页 |
| `app/me/replacement-apply.tsx` | 申请换货页面（照片上传+问题描述） |

### 5.2 修改页面

| 文件 | 变更 |
|------|------|
| `app/(tabs)/home.tsx` | 首页新增抽奖浮动按钮（FAB）：未抽奖→脉冲动画引导点击跳转 `/lottery`，已抽奖→隐藏 |
| `src/store/useCartStore.ts` | CartItem 新增字段：`isPrize`, `prizeType`, `prizeThreshold`, `originalPrice`, `fixedQuantity`。修改 `updateQty` 忽略 fixedQuantity 的商品 |
| `app/cart.tsx` | 购物车页面：奖品商品显示"奖品"标签、不可修改数量、显示门槛条件 |
| `app/checkout.tsx` | 结算页：校验 THRESHOLD_GIFT 奖品的消费门槛、使用新运费计算、移除退款相关UI |
| `app/me/wallet.tsx` | 钱包页：区分展示VIP奖励和普通奖励、冻结奖励显示倒计时和解锁条件 |
| `app/me/vip.tsx` | VIP页：提示"成为VIP后不再参与普通奖励" |
| `app/me/rewards.tsx` | 奖励列表：新增冻结状态展示（图标+倒计时+解锁条件说明） |
| `app/me/bonus-queue.tsx` | **废弃或重构**：从滑动窗口队列改为普通树概览入口 |
| `app/orders/[id].tsx` (订单详情) | 移除"申请退款"按钮，改为"申请换货"按钮（跳转 replacement-apply） |

### 5.3 Repository 变更

| 文件 | 变更 |
|------|------|
| `src/repos/BonusRepo.ts` | 新增：`getNormalTree()`、`getNormalRewards()`、`drawLottery()`、`getTodayLottery()`、`getLotteryPrizes()` |
| `src/repos/OrderRepo.ts` | 新增：`applyReplacement(orderId, data)`、`getReplacements()`。移除退款相关方法 |
| 新增 `src/repos/LotteryRepo.ts` | 抽奖专用 Repository |
| 新增 `src/repos/ReplacementRepo.ts` | 换货专用 Repository |

### 5.4 TypeScript 类型变更

| 文件 | 变更 |
|------|------|
| `src/types/domain/bonus.ts` | 新增：`NormalTreeNode`、`NormalProgress`、`NormalRewardItem` 类型 |
| `src/types/domain/lottery.ts` | 新增：`LotteryPrize`、`LotteryRecord`、`LotteryResult` 类型 |
| `src/types/domain/order.ts` | 新增：`ReplacementRequest`、`ReplacementStatus`。修改 OrderItem 加 `isPrize` |
| `src/types/domain/cart.ts` | 修改 CartItem 加奖品相关字段 |

### 5.5 审计偏差（2026-02-28，历史）→ 2026-03-01 复核结果

| 位置 | 当前代码现状 | 影响 | 优先级 |
|------|-------------|------|--------|
| `app/(tabs)/home.tsx` + `app/lottery.tsx` | 已接入抽奖状态查询并补齐 `/lottery` 路由页 | 抽奖入口闭环恢复 | ✅ 已修复 |
| `src/store/useCartStore.ts` + `app/cart.tsx` | 已切换服务端购物车主链路（CartRepo） | 奖品锁定/过期与后端一致 | ✅ 已修复 |
| `app/checkout.tsx` | 已使用 CheckoutSession 流程，并补传 `addressId` 参与预结算 | F1 主链路闭环，预结算运费与地址一致 | ✅ 已修复 |
| `app/orders/after-sale/[id].tsx` + `src/repos/OrderRepo.ts` | 已按换货参数提交 `photos + orderItemId`，上传补齐鉴权 | 换货申请契约一致，避免 400/401 | ✅ 已修复 |
| `app/orders/[id].tsx` | 真实环境已隐藏旧 `POST /orders/:id/pay` 入口，待支付历史单改为提示“请重新下单”（Mock 保留支付按钮） | 避免触发 410 Gone，历史单行为明确 | ✅ 已修复 |
| `app/orders/[id].tsx` + `src/repos/OrderRepo.ts` | “模拟推进售后”已改为 `USE_MOCK` 条件渲染，且 Repo 非 Mock 环境直接拒绝该操作 | 真实环境不再出现 mock-only 伪操作入口 | ✅ 已修复 |
| `src/repos/OrderRepo.ts` | `applyAfterSale` 返回类型已由 `Order` 对齐为 `AfterSaleApplication`（ReplacementRequest 语义） | 消除前后端类型契约漂移 | ✅ 已修复 |
| `src/repos/BonusRepo.ts` + `src/repos/LotteryRepo.ts` + `src/repos/ReplacementRepo.ts` | 普通树与抽奖/换货 Repo 已落地并接入页面 | 能力分层清晰 | ✅ 已修复 |

---

## 六、卖家系统前端变更

### 6.1 修改页面

| 文件 | 变更 |
|------|------|
| `seller/src/pages/products/edit.tsx` | **SKU表单改造**：`price` 字段改为只读（自动计算展示），`cost` 改为必填，显示 `计算售价 = cost × 1.3`。加价率从后端获取 |
| `seller/src/pages/products/index.tsx` | 商品列表：增加"成本价"列，"售价"列标注"(自动)" |
| `seller/src/pages/refunds/index.tsx` | **重构为换货管理**：列表展示 ReplacementRequest，操作改为"审核"和"发货"。移除退款金额相关列 |
| 新增 `seller/src/pages/replacements/index.tsx` | 换货管理列表页（或直接修改 refunds 页面） |
| 新增 `seller/src/pages/replacements/detail.tsx` | 换货详情页：查看照片、审核操作、录入物流单号 |

### 6.2 API 变更

| 变更 | 说明 |
|------|------|
| `seller/src/api/product.ts` | 创建/更新商品接口：去掉 price 参数，只传 cost。响应增加 calculatedPrice |
| `seller/src/api/refund.ts` → `replacement.ts` | 替换为换货相关API |
| `seller/src/api/config.ts` | 新增：获取 markupRate（展示给卖家看当前加价率） |

### 6.3 审计偏差（2026-02-28，历史）→ 2026-03-01 复核结果

| 位置 | 当前代码现状 | 影响 | 优先级 |
|------|-------------|------|--------|
| `seller/src/pages/products/edit.tsx` | 编辑商品已改为“基础信息 update + `updateSkus` 分离提交” | 修复 `UpdateProductDto` 白名单 400 风险 | ✅ 已修复 |
| `seller/src/pages/replacements/*` + `seller/src/api/replacements.ts` | 已对齐后端真实状态枚举（`REQUESTED/UNDER_REVIEW/...`） | 换货审核按钮与流程恢复可用 | ✅ 已修复 |
| `seller/src/pages/replacements/detail.tsx` + `seller/src/api/replacements.ts` | 详情字段已由 `rejectReason/note` 对齐为后端真实 `reviewNote`，按状态显示“驳回原因/审核备注” | 审核备注信息可正确展示 | ✅ 已修复 |
| `seller/src/layouts/SellerLayout.tsx` + `seller/src/App.tsx` | 已接入 `replacements` 菜单与路由，`refunds` 降级为历史入口 | 新换货链路可直达 | ✅ 已修复 |

### 6.4 卖家端全面审计（2026-03-01）

| # | 项目 | 状态 | 说明 |
|---|------|------|------|
| S1 | SKU 表单只显示成本价，售价自动计算只读展示 | ✅ | `pages/products/edit.tsx` — cost 为 InputNumber 输入，售价为 Text 只读展示 |
| S2 | 换货 API（replacements.ts） | ✅ | 5 个端点完整：列表/详情/批准/拒绝/发货 |
| S3 | 换货管理页面（列表 + 详情） | ✅ | `pages/replacements/index.tsx` + `detail.tsx`，6 状态流转 + 照片证据 |
| S4 | 菜单包含换货管理入口 | ✅ | SellerLayout.tsx 有"换货管理"菜单项 + SwapOutlined 图标 |
| S5 | 退款 API 保留（旧订单兼容） | ✅ | refunds.ts 保留，新旧流程共存（设计如此） |
| S6 | markupRate 从后端获取 | ✅ | 新建后端 `GET /seller/config/markup-rate` 端点（`seller-config.controller/service/module`）+ `seller/src/api/config.ts` + edit.tsx useQuery 获取实际加价率替换硬编码 |
| S7 | orderStatusMap 清理过时状态 | ✅ | 移除 `PENDING_PAYMENT`、`ISSUE`、`REFUNDING`，保留有效状态 6 个 |
| S8 | OrderItem 类型补齐 isPrize 字段 | ✅ | 添加 `isPrize?: boolean`、`prizeType?: string`、`prizeRecordId?: string` |
| S9 | 订单详情显示奖品标识 | ✅ | `detail.tsx` 商品表格新增「类型」列，奖品项显示金色 Tag |
| S10 | 仪表盘补齐待处理换货计数 | ✅ | 5 列统计卡片布局 + `pendingReplacementCount` 换货计数 + 待处理列表含换货项。后端 `seller-analytics.service` 同步添加 `replacementRequest.count` 查询 |

---

## 七、管理后台前端变更

### 7.1 新增页面

| 文件路径 | 说明 |
|---------|------|
| `admin/src/pages/lottery/prizes.tsx` | **抽奖奖池管理**：ProTable 列表 + ProForm 编辑。设置奖品名称、类型、关联奖励商品、概率、限额 |
| `admin/src/pages/lottery/records.tsx` | **抽奖记录查询**：按用户/日期/结果筛选 |
| `admin/src/pages/platform-products/index.tsx` | **奖励商品管理**：CRUD，独立于卖家商品。用于抽奖奖品和平台自营 |
| `admin/src/pages/platform-products/edit.tsx` | **奖励商品编辑**：成本、售价均可手动设置（cost ≤ price） |
| `admin/src/pages/bonus/normal-tree.tsx` | **普通用户树查看器**：搜索用户 → 展示树上下文（面包屑、父节点、当前、子节点） |
| `admin/src/pages/bonus/normal-config.tsx` | **普通系统参数配置**：独立配置所有 `NORMAL_*` 参数 |
| `admin/src/pages/shipping-rules/index.tsx` | **运费规则管理**：CRUD + 预览测试 |
| `admin/src/pages/replacements/index.tsx` | **换货审核**（平台介入）：列表 + 审核操作 |

### 7.2 修改页面

| 文件 | 变更 |
|------|------|
| `admin/src/pages/bonus/config.tsx`（若存在）| 重命名/标记为"VIP系统配置"，与普通系统配置完全分开 |
| `admin/src/pages/bonus/index.tsx` | 会员管理：增加普通树状态展示 |
| `admin/src/pages/bonus/vip-tree.tsx` | 标记为"VIP树查看器"，与普通树查看器区分 |
| `admin/src/layouts/` (侧边栏) | 新增菜单项：抽奖管理、奖励商品、普通树配置、运费规则、换货管理 |

### 7.3 审计偏差（2026-02-28，历史）→ 2026-03-01 复核结果

| 位置 | 当前代码现状 | 影响 | 优先级 |
|------|-------------|------|--------|
| `admin/src/pages/lottery/index.tsx` + `admin/src/api/lottery.ts` | 已对齐后端 DTO（奖品类型、概率 0-100、统计结构） | 奖池增改查与批量概率可用 | ✅ 已修复 |
| `admin/src/pages/replacements/index.tsx` + `admin/src/api/replacements.ts` | 仲裁参数从 `action` 改为 `status`，状态枚举与后端一致 | 换货仲裁可落库生效 | ✅ 已修复 |
| `admin/src/pages/platform-products/index.tsx` + `admin/src/api/platform-products.ts` | 已切换为后端真实模型（`basePrice + skus[]`），列表按 SKU 聚合展示，新增时按默认 SKU 提交 | 奖励商品增改查契约一致 | ✅ 已修复 |
| `admin/src/pages/shipping-rules/index.tsx` + `admin/src/api/shipping-rules.ts` | 已切换为后端真实模型（`name/regionCodes/min-max/fee/priority/isActive`），预览响应改读 `{ fee, input }` | 运费规则 CRUD 与预览契约一致 | ✅ 已修复 |
| `admin/src/layouts/AdminLayout.tsx` + `admin/src/App.tsx` + `admin/src/constants/permissions.ts` | 菜单、路由、权限常量均已补齐 | 管理模块可访问且受控 | ✅ 已修复 |

### 7.4 管理后台全面审计（2026-03-01）

| # | 项目 | 状态 | 说明 |
|---|------|------|------|
| A1 | VIP 树查看器 | ✅ | `bonus/vip-tree.tsx`，蓝色主题，独立 API |
| A2 | 普通树查看器（独立于 VIP） | ✅ | `bonus/normal-tree.tsx`，绿色主题，独立 API（`searchNormalTreeUsers`、`getNormalTreeContext`） |
| A3 | 抽奖奖池管理（CRUD + 批量概率） | ✅ | `lottery/index.tsx` 三 Tab 合一：奖池管理 / 抽奖记录 / 统计。含 `expirationHours` 字段（F3） |
| A4 | 抽奖记录查询 | ✅ | 按用户/日期/结果筛选 |
| A5 | 抽奖统计 | ✅ | 统计卡片 + 奖品消耗表 |
| A6 | 奖励商品基础 CRUD | ✅ | `platform-products/index.tsx`，可独立设成本和售价（cost ≤ price 校验） |
| A7 | 运费规则 CRUD（三维度） | ✅ | `shipping-rules/index.tsx`，金额×地区×重量 + 运费预览测试卡片。重量单位为千克（kg），与后端一致 |
| A8 | 换货仲裁（独立于退款） | ✅ | `replacements/index.tsx`，照片证据预览 + 仲裁决定（APPROVED/REJECTED） |
| A9 | 所有权限常量 | ✅ | `permissions.ts` 包含 lottery/reward_products/shipping/replacements 全部 CRUD 权限 |
| A10 | 菜单入口 | ✅ | 抽奖 / 奖励商品 / 运费 / 换货 / 普通树均有菜单项 |
| A11 | 普通用户系统参数配置页 | ✅ | `bonus/normal-config.tsx` 创建完成。三分区：树结构（BRANCH_FACTOR/MAX_LAYERS）、奖励设置（FREEZE_DAYS/EXPIRY_DAYS）、利润六分比例（6 项 percent slider + sum=100% 校验）。含版本历史抽屉 |
| A12 | 全局配置页补齐缺失配置项 | ✅ | `config/index.tsx` CONFIG_SCHEMA 新增 `VIP_FREEZE_DAYS`、`VIP_REWARD_EXPIRY_DAYS`、`MARKUP_RATE`、`DEFAULT_SHIPPING_FEE`、`LOTTERY_ENABLED`、`LOTTERY_DAILY_CHANCES` |
| A13 | 配置页废弃参数已替换 | ✅ | 移除 `NORMAL_BROADCAST_X` 和 `BUCKET_RANGES` 分组，替换为「定价与运费」和「抽奖设置」卡片。BucketRangesField 组件删除 |
| A14 | 奖励商品独立编辑页（多 SKU） | ✅ | `platform-products/edit.tsx` 创建完成。基本信息卡 + SKU 管理卡（表格展示、内联编辑 Modal、增删改、cost ≤ price 校验）。后端新增 `findOne/addSku/updateSku/deleteSku` 四个端点 |
| A15 | 抽奖奖品奖励商品选择器 | ✅ | 新建 `components/PlatformProductPicker.tsx` 可复用组件（搜索下拉 + SKU 级联选择 + 自动单 SKU 选中）。`lottery/index.tsx` 替换文本框为选择器，条件显示（仅非 NO_PRIZE 类型） |
| A16 | broadcast-window.tsx 从菜单隐藏 | ✅ | AdminLayout.tsx 菜单项注释移除，路由保留供直接访问 |

---

## 八、安全与并发控制

### 8.1 需要 Serializable 隔离级别的操作

| 操作 | 风险 | 防护 |
|------|------|------|
| 普通树节点插入 | 并发用户同时入树，争抢同一位置 | `pg_advisory_xact_lock` 事务级咨询锁串行化 + @@unique([parentId, position]) 兜底 |
| 普通奖励分配 | 同一订单重复触发分配 | 幂等键 + Serializable |
| 冻结奖励解锁 | 并发消费触发多次解锁 | Serializable + CAS (updateMany where status=FROZEN) |
| 冻结奖励过期 | Cron与用户解锁并发 | Serializable + CAS |
| 抽奖 | 并发请求绕过每日限制 | 事务内 `count(userId, drawDate)` + `LOTTERY_DAILY_CHANCES` + Serializable |
| 奖品库存 | wonCount 并发递增超限 | Serializable + CAS (wonCount < dailyLimit) |

### 8.2 新增安全检查项（追加到 tofix-safe.md）

| 编号 | 风险 | 级别 | 说明 |
|------|------|------|------|
| N01 | 普通树并发插入 | 高 | 需与VIP树同等的并发保护 |
| N02 | 冻结奖励双重释放 | 高 | CAS + Serializable 防止 |
| N03 | 冻结奖励过期与释放竞态 | 中 | Cron过期和用户消费解锁同时发生 |
| N04 | 抽奖防刷 | 中 | 时区处理（统一UTC+8）、IP限制 |
| N05 | 奖品超发 | 高 | dailyLimit/totalLimit 原子检查 |
| N06 | 换货申请重复提交 | 低 | 幂等校验 |
| N07 | 自动定价绕过 | 中 | 后端强制校验 price = cost × markupRate，拒绝前端传入的 price |

### 8.3 数据一致性

- **入树时机**：确认收货时（非支付时），避免未完成订单的用户进入树
- **VIP转换**：用户购买VIP后，冻结 NormalProgress（设 frozenAt），后续消费不再计入普通树
- **奖励过期处理（两个系统）**：Cron每小时扫描，分别按 NORMAL_FREEZE_DAYS 和 VIP_FREEZE_DAYS 处理过期冻结奖励，VOID 并转入 PLATFORM_PROFIT
- **VIP冻结新增expiresAt**：修改 vip-upstream.service.ts，FROZEN 状态的 RewardLedger 在 meta 中写入 expiresAt
- **概率完整性**：管理后台保存奖池时，强制校验所有 isActive 奖品的 probability 总和 = 100
- **利润公式隔离**：普通用户订单走六分公式（NORMAL_*配置），VIP用户订单也走六分公式（VIP_*配置，默认50/30/10/2/2/6），allocateForOrder 根据用户身份选择对应配比

### 8.4 审计新增隐患（2026-02-28）更新

- **普通树并发插入冲突重试**：已补齐 `P2002(@@unique[parentId,position])` 冲突重试与重扫位置逻辑。
- **F1 子订单运费分摊偏差**：已在 CheckoutSession 快照中持久化分组运费，支付回调优先按快照建单（老会话降级兼容比例拆分）。
- **抽奖概率 CRUD 可操作性风险**：已提供管理端”批量编辑概率”入口，支持一次性提交全量活跃奖品概率（总和=100%）。
- **买家端售后页依赖缺失（`expo-image-picker`）**：已补齐依赖并通过根目录 TypeScript 校验（`npx tsc --noEmit`）。

### 8.5 二轮深度审计修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P0** | `CHECK(stock >= 0)` 约束与 D21 超卖容忍冲突，支付回调扣库存至负数时会被 DB 约束阻断 | `seed.ts`: 改为 `DROP CONSTRAINT IF EXISTS chk_product_sku_stock_non_negative`，删除该约束 | ✅ |
| 2 | **P1** | 普通树并发插入 P2002 重试在死事务上操作 + childrenCount 漂移风险 | `bonus-allocation.service.ts`: 改用 `pg_advisory_xact_lock(2026022801)` 事务级咨询锁串行化插入，移除 P2002 重试；操作顺序改为先 create 节点再 increment childrenCount | ✅ |
| 3 | **P2** | `admin-orders.service.ts` / `seller-orders.service.ts` 自动确认天数硬编码 7 天，未使用 `AUTO_CONFIRM_DAYS` 配置 | 两处均改为 `const { autoConfirmDays } = await this.bonusConfig.getSystemConfig()` 从配置读取 | ✅ |
| 4 | **P2** | 抽奖奖品后端校验不完整：THRESHOLD_GIFT 未强制 threshold>0 / prizePrice=0，skuId 未校验归属 productId | `admin-lottery.service.ts`: 新增 `validatePricingConstraints()`（类型↔价格/门槛联动）+ `validateProductSkuRelation()`（奖励商品归属 + SKU 归属 + 优惠价≤原价），create 和 update 均调用 | ✅ |
| 5 | — | 管理端普通树搜索 404 / 奖励商品缺 status 过滤 / 运费预览路由顺序 | 后端补齐 `GET /admin/bonus/normal-tree/search`；`platform-product.controller` 加 `@Query('status')`；`shipping-rule.controller` preview 移到 create 前 | ✅ |
| 6 | **P2** | 买家换货申请缺 DTO 级校验（reason/photos/orderItemId） | 新增 `CreateReplacementDto` 并接入 `replacement.controller/service`：`reason` 非空且最长 500，`photos` 1-10 且逐项 URL 校验，`orderItemId` 必须为 CUID | ✅ |

**未修改项（经评估无需修改）**：
- 旧下单接口（`POST /orders`, `POST :id/pay`）保留但已标 `@deprecated`，前端已全部迁移至 CheckoutSession，不构成风险
- 管理员退款接口（`POST :id/refund`）为有意保留，用于历史退款处理和特殊仲裁场景
- NO_PRIZE 记录 `status` 默认 WON：`status` 字段仅对 `result=WON` 记录有意义，NO_PRIZE 记录不进入奖品生命周期

### 8.6 三轮前端对齐审计修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P0** | 管理端奖励商品页使用扁平 `price/stock/cost`，后端模型为 `basePrice` + `skus[]` 数组，创建/编辑/列表全部不兼容 | `admin/src/api/platform-products.ts`: 类型改为 `PlatformProduct.basePrice` + `PlatformProductSku[]`；`index.tsx`: 列表通过 helper 从 skus 聚合价格/成本/库存展示，创建提交 `{ basePrice, skus: [{ title, price, cost, stock }] }`，编辑提交 `{ basePrice, cost, status }` | ✅ |
| 2 | **P0** | 管理端运费规则页模型完全错误（`regionCode/baseShippingFee/freeShippingThreshold/weightRate`），与后端 ShippingRule（`name/regionCodes[]/minAmount/maxAmount/minWeight/maxWeight/fee/priority`）无任何字段匹配 | `admin/src/api/shipping-rules.ts`: 类型重写为 `ShippingRule` + `ShippingPreview { fee, input }`；`index.tsx`: 列表展示 regionCodes/金额区间/重量区间/fee/priority/isActive，表单对齐全部字段，预览面板发送 `{ goodsAmount, regionCode, totalWeight }` 并展示 `{ fee, input }` | ✅ |
| 3 | **P2** | 买家订单详情 `handlePay` 直接调用 `OrderRepo.payOrder()`，后端已返回 410 GoneException | `app/orders/[id].tsx`: `handlePay` 增加 `if (!USE_MOCK)` 前置守卫返回错误 toast；pendingPay 状态 UI 区分 Mock（显示支付按钮）和生产（显示"历史待支付订单请重新下单"提示） | ✅ |
| 4 | **P2** | 买家订单详情"推进售后"按钮在生产环境暴露，`advanceAfterSale` 无后端 API 对应 | `app/orders/[id].tsx`: 按钮包裹 `{USE_MOCK ? ... : null}` 仅 Mock 模式可见，文案改为"模拟推进售后"；`OrderRepo.advanceAfterSale` 增加 `!USE_MOCK` 前置返回错误（双重守卫） | ✅ |
| 5 | **P3** | 买家换货申请后端 `replacement.controller` 使用内联 `@Body() dto: { ... }` 无 class-validator 校验，reason 可空、photos 可传任意内容 | 新建 `backend/src/modules/replacement/dto/create-replacement.dto.ts`：`reason` 非空+max500，`photos` array min1 max10 逐项 URL 校验，`orderItemId?` CUID 正则校验；controller 改用 `CreateReplacementDto` | ✅ |
| 6 | **P1** | 卖家换货详情页读 `replacement.rejectReason`/`replacement.note`，后端 Prisma 模型实际字段为 `reviewNote` | `seller/src/pages/replacements/detail.tsx`: 改为读 `replacement.reviewNote`；物流单号读 `replacement.replacementShipmentId`；label 根据状态显示"驳回原因"或"审核备注" | ✅ |
| 7 | **P3** | `OrderRepo.applyAfterSale` 声明返回 `Result<Order>`，但后端 `POST /replacements/orders/:orderId` 返回 `ReplacementRequest` 结构 | `src/repos/OrderRepo.ts`: 新增 `AfterSaleApplication` 接口（id/orderId/orderItemId/reason/photos/status/createdAt/updatedAt），返回类型改为 `Result<AfterSaleApplication>`；API 路径改为 `/replacements/orders/${orderId}`；Mock 模式同步返回正确结构 | ✅ |

### 8.7 复测结论（2026-03-01）

- 后端：`backend` 构建通过（`npm run build`）。
- 买家App：根目录 TypeScript 校验通过（`npx tsc --noEmit`）。
- 管理端/卖家端：`tsc -b` 已通过；`vite build` 受运行环境 Node 版本影响（当前 20.9.0，需 `>=20.19`）。

### 8.8 四轮后端一致性修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P2** | CheckoutSession `idempotencyKey` 未按用户隔离，存在极低概率跨用户幂等碰撞风险 | `checkout.service.ts` 幂等查询改为 `where: { userId, idempotencyKey }`；Schema 从 `idempotencyKey @unique` 调整为 `@@unique([userId, idempotencyKey])` | ✅ |
| 2 | **P2** | 旧入口 `POST /orders/:id/after-sale` DTO 校验弱于新换货入口（photos URL / orderItemId CUID） | `AfterSaleDto` 对齐严格校验：`reason<=500`、`photos` 逐项 URL、`orderItemId` CUID 正则 | ✅ |
| 3 | **P2** | 运费规则 `update` 缺服务端边界校验（负运费、区间反转） | `shipping-rule.service.ts` 新增统一 `validateRuleBounds()`，create/update 均执行“更新后值”校验 | ✅ |
| 4 | **P2** | 运费重量单位在管理端（kg）与后端存储（克）语义不统一 | ShippingRule 管理接口统一“入参 kg → 存储 g → 列表回传 kg”，并在 preview 中做 kg→g 转换 | ✅ |
| 5 | **P3** | `admin/bonus` 参数缺失抛 `Error` 返回 500 | `admin-bonus.controller.ts` 改为 `BadRequestException`，返回 400 语义 | ✅ |

**未修改项（经评估无需修改）**：
- 运费计算保留 `ShippingTemplate` 降级兜底：属有意设计，当 ShippingRule 异常时避免下单链路中断，文档"强制平台规则"措辞后续优化为"优先使用平台规则，异常时降级"

### 8.9 五轮后端一致性修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P1** | Checkout 奖励在 `RESERVED` 后，`CheckoutSession.create` 异常时可能泄漏 | `checkout.service.ts`：为会话创建失败补充兜底释放逻辑（仅在未落库会话时释放），避免无会话 `RESERVED` 残留 | ✅ |
| 2 | **P1** | 幂等冲突（P2002）分支返回本地变量，可能回传错误 `merchantOrderNo` | `checkout.service.ts`：P2002 复用分支改为直接返回已存在 session 字段，不再返回本地新生成值 | ✅ |
| 3 | **P2** | `CheckoutSession` 幂等键复合唯一约束仅在 Schema，迁移未落地 | 新增迁移 `20260301010000_fix_checkout_idempotency_composite_unique`：删除旧单列唯一索引，改为 `("userId","idempotencyKey")` 复合唯一 | ✅ |
| 4 | **P2** | 奖励商品管理接口缺 DTO，异常参数会走 500 | 新增 `CreatePlatformProductDto/UpdatePlatformProductDto`，`platform-product.controller.ts` 改为 DTO 入参，返回 400 语义校验错误 | ✅ |
| 5 | **P3** | 换货审核接口缺 DTO（管理员仲裁、卖家驳回/发货） | 新增 `ArbitrateReplacementDto`、`Approve/Reject/ShipReplacementDto` 并接入对应 controller | ✅ |
| 6 | **P3** | 文档残余接口与抽奖次数描述不一致 | 同步更新 `plan-treeforuser.md`：换货路径/动作、LotteryRecord 每日次数描述、抽奖并发控制措辞 | ✅ |

~~**未修改项**~~：§4.1.5/§4.1.6 换货模块路径单复数偏差已在六轮文档修正中一并修复。

### 8.10 六轮文档修正（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P2** | 普通树 `rootId` 文档仍写 `ROOT`，后端实际为 `NORMAL_ROOT` | `plan-treeforuser.md` 三处修正：§3.1 Schema 注释（:143）、§4.2.2 伪代码（:672）、Phase A Seed 描述（:975），统一为 `NORMAL_ROOT` | ✅ |
| 2 | **P3** | 换货模块路径文档写单数 `replacement/`，代码目录为复数 `replacements/` | `plan-treeforuser.md` §4.1.5 + §4.1.6 路径修正为 `replacements/` | ✅ |
| 3 | **P3** | 抽奖总述写"每天一次"，后端实现为 `LOTTERY_DAILY_CHANCES` 可配置（默认 1） | `plan-treeforuser.md` §1 总述改为"默认每天一次（`LOTTERY_DAILY_CHANCES` 可配置）" | ✅ |

### 8.11 七轮后端一致性修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P1** | 支付失败回调未检查 session CAS 结果，并发时可能错误释放奖励 | `payment.service.ts`：`updateMany` 捕获 `updateResult`，`count===0` 时 log warn + 提前返回，奖励释放仅在 CAS 成功后执行 | ✅ |
| 2 | **P2** | `getLatestIssue()` 比较时间用 `order.createdAt` 而非 `replacementRequest.createdAt`，误判"最近异常" | `order.service.ts`：比较改为 `refundedOrder.createdAt >= replacementOrder.createdAt`（申请时间） | ✅ |
| 3 | **P2** | 拆单后 `InventoryLedger.refId` 固定 `createdOrderIds[0]`，多卖家场景库存流水追踪不准 | `checkout.service.ts`：新增 `companyOrderIdMap`，建单时记录 companyId→orderId 映射，库存流水按 `item.companyId` 查找对应子订单 ID | ✅ |
| 4 | **P3** | 运费规则 `remove()` 直接返回 DB 对象（g），其他接口返回 kg，单位不一致 | `shipping-rule.service.ts`：`remove()` 返回值包裹 `normalizeRuleWeightUnit()` | ✅ |
| 5 | **P3** | 卖家换货 approve/reject 未写 `reviewerId`，审计链不完整 | `seller-replacements.service.ts`：approve/reject 签名增加 `reviewerId` 参数并写入 DB；controller 通过 `@CurrentSeller('sub')` 提取 staffId 传入 | ✅ |

~~**未修改项**~~：`getLatestIssue()` 退款时间问题已在八轮修复中彻底解决（改查 Refund 模型）。

### 8.12 八轮安全+一致性修复（2026-03-01）

| # | 严重度 | 问题 | 修复方案 | 状态 |
|---|--------|------|---------|------|
| 1 | **P1** | 物流回调 `@Public()` 无鉴权，知道 trackingNo 即可伪造签收并触发分润链路 | `shipment.controller.ts`：加 `@UseGuards(WebhookIpGuard)` IP 白名单；`shipment.service.ts`：新增 `verifyCallbackSignature()` HMAC-SHA256 签名验证 + `timingSafeEqual`，与支付回调同级防护 | ✅ |
| 2 | **P2** | `POST /orders/batch-pay` 遗漏废弃，可绕过 CheckoutSession 直接将历史订单改为 PAID | `order.controller.ts`：`batchPay()` 改为 `throw GoneException(410)`，与 `POST /orders` 同模式 | ✅ |
| 3 | **P2** | `getLatestIssue()` 退款侧按 `order.createdAt` 排序/比较，老订单近期退款被误判为"更早的异常" | `order.service.ts`：改为查 `Refund` 模型（`refund.createdAt` = 退款发起时间），比较 `latestRefund.createdAt >= replacementOrder.createdAt` | ✅ |
| 4 | **P3** | Checkout 创建失败兜底按 `merchantOrderNo` 反查后未校验 `userId`，极低概率跨用户会话复用 | `checkout.service.ts`：`createdSession.userId !== userId` 时释放奖励 + log error + 抛 BadRequestException | ✅ |
| 5 | **P3** | 购物车 4 个写入接口使用内联 `@Body`，缺 class-validator 运行时校验 | 新增 `cart.dto.ts`（`AddCartItemDto` / `UpdateCartItemQuantityDto` / `ToggleCartSelectDto`）；controller 改用 DTO 入参 | ✅ |

### 8.13 九轮全面深度审计修复（2026-03-01）

> 5 维度并行审计（安全认证 / 并发一致性 / API-DTO / 业务逻辑 / Schema 基础设施），6 Agent 并行修复，共 31 项。

#### CRITICAL × 7 — 并发安全 Serializable + CAS

| # | 文件 | 方法 | 修复 | 状态 |
|---|------|------|------|------|
| C1 | `admin/orders/admin-orders.service.ts` | `refund()` | Serializable + CAS `updateMany` + P2034 重试 + 退款金额 ≤ 订单总额校验 | ✅ |
| C2 | `admin/orders/admin-orders.service.ts` | `cancel()` | Serializable + CAS `updateMany` + P2034 重试 | ✅ |
| C3 | `admin/orders/admin-orders.service.ts` | `ship()` | Serializable + CAS + 状态检查移入事务内 + P2034 重试 | ✅ |
| C4 | `admin/refunds/admin-refunds.service.ts` | `arbitrateApprove()` | Serializable + CAS（退款+订单双重 CAS）+ 检查移入事务 + P2034 重试 | ✅ |
| C5 | `order/order.service.ts` | `confirmReceive()` | Serializable + CAS `updateMany` + P2034 重试，分润仅 CAS 成功后触发 | ✅ |
| C6 | `replacement/replacement.service.ts` | `confirmReceive()` | 新增 Serializable 事务包裹 + CAS `updateMany` + P2034 重试 | ✅ |
| C7 | `shipment/shipment.service.ts` | `handleCallback()` | Serializable + 订单状态 CAS `updateMany`，count=0 静默跳过 + P2034 重试 | ✅ |

#### HIGH × 18 — 认证/授权/并发/业务/验证/基础设施

| # | 类别 | 修复内容 | 状态 |
|---|------|---------|------|
| H1 | 认证 | `group.controller.ts` join 注入 `@CurrentUser('sub') userId`，service 加去重（查 Booking 表），固定 +1 | ✅ |
| H2 | 认证 | `group.controller.ts` create/updateStatus 加 `PermissionGuard` + `@RequirePermission` | ✅ |
| H3 | 授权 | `booking.controller.ts` review 改为 `@UseGuards(SellerAuthGuard, SellerRoleGuard)` + company 归属校验 | ✅ |
| H4 | 授权 | `booking.controller.ts` invite 改为 `@UseGuards(SellerAuthGuard, SellerRoleGuard)` + company 归属校验 | ✅ |
| H5 | 授权 | `upload.controller.ts` DELETE 限制 admin-only（`@UseGuards(AdminAuthGuard)`） | ✅ |
| H6 | 并发 | `checkout.service.ts` 奖励预留 CAS 移入 Session 创建 Serializable 事务内，回滚自动恢复 | ✅ |
| H7 | 并发 | `payment.service.ts` FAILED 分支：Session 状态 + 奖励释放包裹在 Serializable 事务 + P2034 重试 | ✅ |
| H8 | 并发 | `checkout.service.ts` cancelSession 加 Serializable + P2034 重试 | ✅ |
| H9 | 并发 | `bonus-compensation.service.ts` cron 加 Redis 分布式锁（`RedisCoordinatorService.acquireLock`） | ✅ |
| H10 | 并发 | `check-in.service.ts` 加 Serializable + P2002 幂等处理 + P2034 重试 | ✅ |
| H11 | 并发 | `vip-upstream.service.ts` `checkExit()` 包裹 Serializable 事务 + CAS `updateMany` | ✅ |
| H12 | 业务 | `seller-refunds.service.ts` 退款 REFUNDING→REFUNDED/FAILED 状态更新包裹 Serializable + CAS | ✅ |
| H13 | 业务 | `admin-orders.service.ts` refund 加 `amount > order.totalAmount` 校验（合并入 C1） | ✅ |
| H14 | 数据 | `booking.service.ts` mapBooking 删除原始 `contactName`/`contactPhone`，仅返回脱敏版 | ✅ |
| H15 | 验证 | 新增 `bonus/dto/use-referral.dto.ts`、`withdraw.dto.ts`；`seller-company.dto.ts` 加 `UpdateHighlightsDto`、`AddDocumentDto` | ✅ |
| H16 | 验证 | 新增 `admin/products/dto` (`ToggleProductStatusDto`, `AuditProductDto`)、`admin/app-users/dto/toggle-ban.dto.ts`、`admin/orders/dto/admin-order.dto.ts` (`CancelOrderDto`) | ✅ |
| H17 | Schema | 6 个财务关系加 `onDelete: Restrict`（Order→User, Payment→Order, Refund→Order, RewardAllocation→Order, CompanyStaff→User/Company） | ✅ |
| M1 | 数据 | `admin-users.service.ts` findAll/findById 删除原始 `lastLoginIp`，仅返回 `lastLoginIpMasked` | ✅ |

#### MEDIUM × 5 — 索引/稳定性/常量

| # | 修复内容 | 状态 |
|---|---------|------|
| M5 | schema.prisma 新增 5 个 FK 索引（ProductMedia.productId, InventoryLedger.skuId, RewardAllocation.orderId, ShipmentTrackingEvent.shipmentId, RewardLedger.allocationId） | ✅ |
| M13 | `otp-cleanup.service.ts` cron 加 try-catch + logger.error | ✅ |
| M14 | `bonus-compensation.service.ts` 死信匹配提取为 `constants.ts` 常量 `DEAD_LETTER_REASON` | ✅ |
| M17 | 合并入 H7（payment FAILED 分支 Serializable） | ✅ |
| M6 | 合并入 H17（onDelete: Restrict） | ✅ |

> 新建文件 6 个：`bonus/dto/use-referral.dto.ts`、`bonus/dto/withdraw.dto.ts`、`admin/app-users/dto/toggle-ban.dto.ts`、`admin/orders/dto/admin-order.dto.ts`、`admin/products/dto/update-product.dto.ts`（含 ToggleProductStatusDto + AuditProductDto）、`seller/company/seller-company.dto.ts`（含 UpdateHighlightsDto + AddDocumentDto）。全量 `tsc --noEmit` + `prisma validate` 通过。

### 8.14 审计偏差修复计划执行（2026-03-01）

> 对应 `lovely-hugging-truffle.md` 计划文件 Phase 1~6，验证并补齐前端三端偏差。

| Phase | 内容 | 结果 | 新增/改动 |
|-------|------|------|-----------|
| 1 | 后端修复 | ✅ 已在九轮审计中完成 | — |
| 2A | 卖家 SKU price 修复 [P0] | ✅ 已存在 | 无 |
| 2B | 卖家换货管理页面 [P1] | ✅ 已存在 | `SellerLayout.tsx` 菜单名称微调 |
| 3A | 买家售后→换货 + 照片上传 [P0] | ✅ 已存在 | 无 |
| 3B | 买家结算 CheckoutSession [P0] | ✅ 已存在 | `OrderRepo.ts` 废弃方法标注 `@deprecated` |
| 4A | 购物车服务端迁移 [P0] | ✅ 已存在，补齐 3 项 | `ServerCart.ts` +originalPrice、`CartRepo.ts` +removePrizeItem、`useCartStore.ts` +removePrizeItem/originalPrice/clear 保留锁定、`cart.tsx` +loading/原价删除线/奖品可删 |
| 5A | 管理端权限常量 [P1] | ✅ 已存在 | 无 |
| 5B | 管理端换货仲裁页 [P1] | ✅ 已存在，补齐 | `replacements/index.tsx` 类型增强 + statusMap 抽出、`statusMaps.ts` +replacementStatusMap |
| 5C | 管理端抽奖管理页 [P1] | ✅ 已存在 | 无 |
| 5D | 管理端奖励商品页 [P1] | ✅ 已存在 | 无 |
| 5E | 管理端运费规则页 [P1] | ✅ 已存在 | 无 |
| 5F | 管理端普通树查看器 [P1] | ✅ 已存在 | `vip-tree.tsx` queryKey 修复 +treeDepth、`bonus.ts` +getNormalTreeChildren |
| 5G | 管理端路由与菜单 [P1] | ✅ 已存在 | 无 |
| 6A | LotteryRepo [P1] | ✅ 已存在 | 无 |
| 6B | ReplacementRepo [P1] | ✅ 已存在 | 无 |
| 6C | BonusRepo 普通树 [P1] | ✅ 已存在 | 无 |
| 6D | 首页抽奖入口 + 抽奖页 [P1] | ✅ 已存在 | 2026-03-01 转盘动画升级（SpinWheel+WheelPointer+Confetti+状态机） |

> 四端编译全部通过：backend `tsc --noEmit` ✅ / seller `tsc --noEmit` ✅ / admin `tsc --noEmit` ✅ / `prisma validate` ✅

### 8.15 收尾清理 + 生产准备（2026-03-01）

| 项目 | 内容 | 结果 |
|------|------|------|
| 废弃代码清理 | 删除 `order.service.ts` 中 `createFromCart`/`payOrder`/`batchPayOrders` 三个废弃方法 + 清理未使用 import/常量 | ✅ ~830 行死代码移除 |
| 全局 pageSize 上限 | 新建 `PaginationInterceptor`，全局拦截 pageSize/limit 夹紧到 [1,100]，page 最小 1 | ✅ 影响 26+ 分页端点 |
| Seed 数据对齐 | `o-001` 订单 PENDING_PAYMENT→PAID + 新增 Payment 记录 + paidAt 时间戳 | ✅ |
| .gitignore 加固 | 根目录 `.gitignore` 添加 `.env`（此前仅忽略 `.env*.local`）| ✅ |
| .env.example | 新建环境变量模板，覆盖数据库/Redis/三端 JWT/支付/上传/分润等全部变量 | ✅ |
| Prisma 迁移 | 手动创建 `20260301020000_add_ondelete_restrict_and_indexes`：2 个 FK CASCADE→RESTRICT + 4 个新 FK 索引 | ✅ |
| 文档同步 | `plan.md`（Phase 7 ✅ + 审查修复记录）、`backend.md`（v3.0）、`data-system.md`（CheckoutSession 模型 + onDelete + 索引）| ✅ |

> 四端编译全部通过：backend `tsc --noEmit` ✅ / seller `tsc --noEmit` ✅ / admin `tsc --noEmit` ✅ / `prisma validate` ✅

### 8.16 十轮跨端契约一致性审计修复（2026-03-01）

> 5 轮逐层深入审计，覆盖前后端枚举/字段/状态机/并发安全/业务口径一致性。共发现 25 项问题（1 项不成立），修复 24 项。

#### 第一轮：基础契约对齐（7 项报告，6 项确认）

| # | 严重度 | 问题 | 修复内容 | 状态 |
|---|--------|------|---------|------|
| R1-1 | 严重 | 支付回调链路冲突（前端 simulatePayment vs 后端签名/IP校验） | **不成立** — 有意的分层安全设计：开发环境自动放松检查，生产环境强制校验 | ⊘ |
| R1-2 | 高 | 订单状态枚举前后端不一致：管理端用 COMPLETED/CANCELLED/REFUNDING，后端是 RECEIVED/CANCELED/REFUNDED | `admin/src/constants/statusMaps.ts` + `admin/src/types/index.ts` 全部改为与后端 Schema 一致 | ✅ |
| R1-3 | 高 | 订单地址字段契约错位：后端存 recipientName/regionText，前端读 receiverName/province/city/district | `admin/src/pages/orders/detail.tsx` + `seller/src/pages/orders/detail.tsx` 改为优先读取 recipientName/regionText（保留旧字段 fallback） | ✅ |
| R1-4 | 中高 | 管理端物流字段名不一致：后端返回 `shipment`，管理端读 `shipmentInfo` | `admin/src/pages/orders/detail.tsx` 改为读取 `shipment` 字段 | ✅ |
| R1-5 | 中 | CheckoutSession 状态契约不一致：前端类型有 PENDING/CANCELLED，后端是 ACTIVE/PAID | `src/repos/OrderRepo.ts` 类型改为 `ACTIVE/PAID/COMPLETED/EXPIRED/FAILED` | ✅ |
| R1-6 | 中 | 换货状态枚举不一致：买家端用 PENDING，后端是 REQUESTED/UNDER_REVIEW | `src/repos/ReplacementRepo.ts` 改为 `REQUESTED/UNDER_REVIEW/APPROVED/REJECTED/SHIPPED/COMPLETED` | ✅ |
| R1-7 | 中 | 退款代码残留：管理端/卖家端仍有完整退款管理功能 | 路由注册和菜单入口已移除；页面文件/API客户端/状态常量保留备用 | ✅ |

#### 第二轮：编译阻塞 + 文案 + API 清理（5 项）

| # | 严重度 | 问题 | 修复内容 | 状态 |
|---|--------|------|---------|------|
| R2-1 | 高 | UNDER_REVIEW 未计入售后统计：`getStatusCounts()`/`getLatestIssue()` 遗漏该状态 | `order.service.ts` 三处查询均加入 `UNDER_REVIEW` | ✅ |
| R2-2 | 中 | 管理端编译阻塞：`PlatformProductPicker.tsx:54` useRef 缺初始值 | 改为 `useRef<ReturnType<typeof setTimeout> \| null>(null)` | ✅ |
| R2-3 | 中 | 买家端文案仍显示"退款/售后" | `src/constants/statuses.ts` + `me.tsx` + `orders/index.tsx` 改为"换货/售后"；订单列表新增 `afterSaleStatusLabels` 中文映射 | ✅ |
| R2-4 | 中 | 退款查询 API 对买家暴露：`GET /payments/order/:orderId/refunds` | `payment.controller.ts` 移除该端点 | ✅ |
| R2-5 | 低 | 退款后端死代码：`admin-orders.service.ts` 的 `refund()` ~115行 + `AdminRefundDto` 孤立 | 方法和 DTO 均已删除 | ✅ |

#### 第三轮：业务口径统一（3 项）

| # | 严重度 | 问题 | 修复内容 | 状态 |
|---|--------|------|---------|------|
| R3-1 | 高 | 售后角标与列表不一致：角标按活跃换货计数，列表筛选映射到 REFUNDED | `list()` 对 `afterSale` 特殊处理：`OR [status='REFUNDED', replacementRequests.some(active)]` | ✅ |
| R3-2 | 中 | 卖家报表仍保留退款口径：显示"退款率"、计算 refundRate | 前端改为"换货率"，后端改为查询 `ReplacementRequest` 计算 `replacementRate`/`pendingReplacementCount` | ✅ |
| R3-3 | 低-中 | 状态计数返回缺 delivered/canceled 键 | `getStatusCounts()` 初始化对象加入 `delivered: 0` 和 `canceled: 0`（共 7 键） | ✅ |

#### 第四轮：列表数据完整性 + 口径精细化（3 项）

| # | 严重度 | 问题 | 修复内容 | 状态 |
|---|--------|------|---------|------|
| R4-1 | 高 | afterSale 列表订单状态/进度展示不正确：mapOrder() 不返回 afterSaleStatus | `list()` 查询加入 `replacementRequests`/`refunds` include；`mapOrder()` 新增 afterSaleStatus/afterSaleReason/afterSaleType 计算与返回 | ✅ |
| R4-2 | 中 | 卖家"待换货"统计与待办列表口径不一致：统计含 UNDER_REVIEW，列表仅查 REQUESTED | 前端列表查询改为 `status: 'REQUESTED,UNDER_REVIEW'` | ✅ |
| R4-3 | 中 | "换货率"分母含已取消/退款订单 | 新增 `monthEffectiveOrders` 查询（排除 CANCELED/REFUNDED），`replacementRate` 以有效订单为分母 | ✅ |

#### 第五轮：状态机完整性 + 并发安全 + 链路闭环（4 项）

| # | 严重度 | 问题 | 修复内容 | 状态 |
|---|--------|------|---------|------|
| R5-1 | 高 | "待收货"链路漏掉 DELIVERED：入口/角标/筛选只用 shipping | 前端角标合并 `shipping + delivered`；后端 `list()` 对 `shipping` 筛选返回 `SHIPPED \| DELIVERED`；类型守卫加入 `delivered` | ✅ |
| R5-2 | 高 | 售后口径三处规则不一致：mapOrder() 的 hasRefundRecord 含已拒绝退款记录 | `hasRefundRecord` 改为 `order.status === 'REFUNDED'`（不再检查 `!!refund`），三处定义统一 | ✅ |
| R5-3 | 中 | 换货申请并发重复提交：check+create 不在同一事务 | `replacement.service.ts::apply()` + `order.service.ts::applyAfterSale()` 均包裹 Serializable 事务 + P2034 重试（MAX_RETRIES=3） | ✅ |
| R5-4 | 中-低 | UNDER_REVIEW 状态不可达：全系统无代码写入该状态 | `seller-replacements.service.ts::findById()` 新增 CAS 自动转换 `REQUESTED → UNDER_REVIEW`（卖家首次查看详情触发）；approve/reject 均接受 UNDER_REVIEW；管理端仲裁也支持 | ✅ |

#### 影响文件汇总

**后端**：
- `order.service.ts` — list/getStatusCounts/getLatestIssue/mapOrder/applyAfterSale 多处修复
- `replacement.service.ts` — apply() Serializable 事务化
- `seller-replacements.service.ts` — findById() 自动 REQUESTED→UNDER_REVIEW
- `seller-analytics.service.ts` — 退款→换货指标全面替换 + 分母口径修正
- `payment.controller.ts` — 移除买家退款查询端点
- `admin-orders.service.ts` — 移除死代码 refund() + AdminRefundDto

**买家 App**：
- `src/repos/OrderRepo.ts` — CheckoutSessionStatus 类型修正
- `src/repos/ReplacementRepo.ts` — ReplacementStatus 枚举修正
- `src/constants/statuses.ts` — "退款/售后"→"换货/售后"
- `app/(tabs)/me.tsx` — 角标合并 shipping+delivered、文案修正
- `app/orders/index.tsx` — 筛选/类型守卫修正、afterSaleStatusLabels 中文映射
- `app/checkout.tsx` — CheckoutSession 状态对齐

**管理后台**：
- `admin/src/constants/statusMaps.ts` — orderStatusMap 枚举修正
- `admin/src/types/index.ts` — OrderStatus 类型修正
- `admin/src/pages/orders/detail.tsx` — 地址字段 + 物流字段名修正
- `admin/src/components/PlatformProductPicker.tsx` — useRef 编译修复

**卖家后台**：
- `seller/src/pages/orders/detail.tsx` — 地址字段名修正
- `seller/src/pages/dashboard/index.tsx` — 待换货列表口径修正
- `seller/src/pages/analytics/index.tsx` — "退款率"→"换货率"

### 8.17 换货流程完整性 + 安全增强审计（2026-03-01）

> 聚焦换货全链路闭环、自动确认避让、列表口径精确、HTTP 语义合规、权限粒度提升。共 5 项，全部修复。

| # | 严重度 | 问题 | 修复内容 | 涉及文件 | 状态 |
|---|--------|------|---------|---------|------|
| R6-1 | 🔴高 | 换货流程卡死在 SHIPPED：卖家发货后换货进入 SHIPPED，订单映射为 afterSale，但买家端无"确认收到换货"按钮，`ReplacementRepo.confirm()` 从未被 UI 调用 | ① `app/orders/[id].tsx:274-285` 新增"确认收到换货"按钮（条件 `afterSaleStatus==='shipped'`）；② handler 调用 `OrderRepo.confirmReplacement(orderId)`；③ `src/repos/OrderRepo.ts:487-502` 新增 `confirmReplacement()` 方法（`POST /orders/{id}/replacement/confirm`）；④ `order.controller.ts:116-122` 新增 POST 端点；⑤ `order.service.ts:611-664` 新增 `confirmReplacementReceive()` — Serializable + CAS 原子 `SHIPPED→COMPLETED` + P2034 重试 + 审计日志 | `app/orders/[id].tsx` / `src/repos/OrderRepo.ts` / `order.controller.ts` / `order.service.ts` | ✅ |
| R6-2 | 🔴高 | 自动确认收货未避让换货中订单：`order-auto-confirm.service.ts` 仅按 `status+autoReceiveAt` 扫单，不检查活跃换货，可能对换货进行中订单自动确认并分润 | 查询新增 `replacementRequests: { none: { status: { in: ['REQUESTED','UNDER_REVIEW','APPROVED','SHIPPED'] } } }`，4 种活跃换货状态全覆盖 | `order-auto-confirm.service.ts:33-35` | ✅ |
| R6-3 | 🟡中 | 待收货列表与角标口径偏差：`list(status='shipping')` 查 SHIPPED/DELIVERED 不排除活跃换货，mapOrder 将其改为 afterSale，与 getStatusCounts 计数不一致 | ① `list()` shipping 分支新增 `replacementRequests: { none: ... }` 排除活跃换货订单；② afterSale 分支使用 `OR [REFUNDED, replacementRequests.some(active)]` 正确包含这些订单；列表/角标/映射三处口径统一 | `order.service.ts:106-122` | ✅ |
| R6-4 | 🟡中 | 卖家"查看详情"GET 有副作用：`GET /seller/replacements/:id` 自动执行 `REQUESTED→UNDER_REVIEW`，违反 HTTP GET 幂等语义 | ① `findById()` 改为纯读操作（移除状态转换）；② 新增 `POST /seller/replacements/:id/review` 端点 + `startReview()` 方法显式执行 `REQUESTED→UNDER_REVIEW`，Serializable + CAS 保护 | `seller-replacements.service.ts` / `seller-replacements.controller.ts` | ✅ |
| R6-5 | 🟡中低 | 换货权限校验是订单级而非商品项级：`items.some(i=>i.companyId===companyId)` 只要订单有本公司商品即可操作，历史多商家同单数据有越权风险 | 新增 `assertCompanyOwnsRequest()` 集中权限方法：① `orderItemId` 有值时精确匹配该项的 `companyId`；② `orderItemId` 为 null 时校验所有商品项均属同一公司，否则抛出"请联系平台仲裁"；5 个方法（findById/startReview/approve/reject/ship）统一调用 | `seller-replacements.service.ts:14-39` | ✅ |

#### 影响文件汇总

**后端**：
- `order.service.ts` — 新增 `confirmReplacementReceive()` 端点；`list()` shipping 分支排除活跃换货
- `order.controller.ts` — 新增 `POST /orders/:id/replacement/confirm`
- `order-auto-confirm.service.ts` — 查询排除有活跃换货的订单
- `seller-replacements.service.ts` — `findById()` 改纯读；新增 `startReview()` 显式状态转换；新增 `assertCompanyOwnsRequest()` 商品项级权限校验（5 方法统一调用）
- `seller-replacements.controller.ts` — 新增 `POST /seller/replacements/:id/review`

**买家 App**：
- `app/orders/[id].tsx` — 新增"确认收到换货"按钮（afterSaleStatus==='shipped' 时显示）+ handler
- `src/repos/OrderRepo.ts` — 新增 `confirmReplacement()` 方法

### 8.18 架构质量审计 — 双路实现 + 安全策略 + 权限一致性（2026-03-01）

> 聚焦售后双路端点一致性、支付安全策略、自动退款链路完整性、卖家发货权限、错误对象解包。共 5 项报告，4 项确认修复，1 项不成立。

| # | 严重度 | 问题 | 修复内容 | 涉及文件 | 状态 |
|---|--------|------|---------|---------|------|
| R7-1 | 严重 | C 端 USE_MOCK=false 时仍走前端直调支付回调路径，生产环境被安全策略拦截 | **不成立** — `WebhookIpGuard` 在白名单为空时开发环境自动放行，生产环境强制校验；`simulatePayment()` 本身是开发测试用途，生产由真实支付商回调 | — | ⊘ |
| R7-2 | 🔴高 | 售后流程"双路实现"且行为不一致：`/orders/:id/after-sale` 写 orderStatusHistory，`/replacements/orders/:orderId` 不写；前端调用的是后者导致审计断裂 | `replacement.service.ts` 的 `apply()` 和 `confirmReceive()` 均新增 `orderStatusHistory.create()` 写入，与 order 模块行为一致；审计链路统一 | `replacement.service.ts` | ✅ |
| R7-3 | 🔴高（条件触发） | 支付冲突分支仍创建 `Refund.REQUESTED` 退款单，但 Admin/Seller 主模块未引入 refunds module，退款单成为孤儿记录 | 不再落库 `Refund.REQUESTED`；改为 orderStatusHistory 中标记 `autoRefundRequired: true` + 事务外直接调用 `initiateRefund()` 渠道退款 | `payment.service.ts` | ✅ |
| R7-4 | 🟡中高（条件触发） | 卖家发货权限仍是"订单里有任意本店商品即可发整单"，混合商家历史订单有越权风险 | 新增 `assertCanShipOrder()` 双重校验：`hasMyItems` + `hasForeignItems` 检查，含其他公司商品时抛出"请联系平台处理发货"；事务内外双重调用 | `seller-orders.service.ts:28-36` | ✅ |
| R7-5 | 🟡中 | 卖家端换货 API 返回类型不一致：前端期望 `{ok:boolean}`，后端返回完整 ReplacementRequest 对象 | 前端 `seller/src/api/replacements.ts` 4 个方法返回类型从 `{ok:boolean}` 改为 `Promise<Replacement>`，与后端实际返回匹配 | `seller/src/api/replacements.ts` | ✅ |

### 8.19 架构质量审计 — 退款链路增强 + 端点统一 + 安全加固（2026-03-01）

> 聚焦自动退款财务对账缺口、前端错误展示、双路端点返回契约、卖家列表/发货口径、信息泄露。共 5 项，全部修复。

| # | 严重度 | 问题 | 修复内容 | 涉及文件 | 状态 |
|---|--------|------|---------|---------|------|
| R8-1 | 🔴高 | 自动退款链路不落 Refund 记录，财务对账漏记且失败后无重试任务 | ① 事务内先创建 `Refund`（status=REFUNDING）+ `RefundStatusHistory`，确保对账可见；② 事务外立即调 `initiateRefund()`，成功→REFUNDED / 失败→FAILED；③ 新增 `@Cron('0 */10 * * * *')` 补偿任务 `retryStaleAutoRefunds()`，扫描 FAILED/REFUNDING ≥5min 记录，每批 20 条重试；④ 所有状态变更通过 `updateAutoRefundRecord()` helper（Serializable + CAS + 历史记录） | `payment.service.ts`（+180 行） | ✅ |
| R8-2 | 🟡中高 | 管理端/卖家端错误对象解包不正确，`new Error(body.error)` 中 body.error 为对象导致显示 `[object Object]` | 两端均新增 `parseErrorMessage()` 函数：优先取 `displayMessage` → 回退 `message` → 回退默认值；所有 `new Error()` 改为 `new Error(parseErrorMessage(...))` | `admin/src/api/client.ts` / `seller/src/api/client.ts` | ✅ |
| R8-3 | 🟡中 | 售后"双路端点"仍并存且返回契约不同：申请换货 order 模块返回订单 DTO，replacement 模块返回换货单；确认换货一边返回 `{ok:true}` 一边返回换货单 | ① `order.service.ts` 删除 140 行（移除 `applyAfterSale()` 和 `confirmReplacementReceive()` 业务逻辑）；② order.controller 两个端点改为薄包装，委托 `ReplacementService`；③ `order.module.ts` 导入 `ReplacementModule`；④ 4 条路径统一返回 `ReplacementRequest` 对象 | `order.service.ts` / `order.controller.ts` / `order.module.ts` / `replacement.module.ts` | ✅ |
| R8-4 | 🟡中 | 卖家订单列表展示"含本店任一商品"的混合单，但发货已改为拒绝混合单，出现可见不可操作的订单 | 列表查询改为 `AND: [{ items: { some: { companyId } } }, { NOT: { items: { some: { companyId: { not: companyId } } } } }]`，等效 `every`，只展示全属本企业的订单 | `seller-orders.service.ts:45-51` | ✅ |
| R8-5 | 🟢低 | 换货模块对非本人订单/记录返回 `BadRequest`，泄露"资源存在但无权"信息 | 3 处权限校验（`apply` line 42 / `findById` line 139 / `confirmReceive` line 178）统一改为 `throw new NotFoundException('...')`，不存在与无权返回相同 404 + 相同消息 | `replacement.service.ts` | ✅ |

#### R7 + R8 影响文件汇总

**后端**：
- `payment.service.ts` — 自动退款链路重构：事务内创建 Refund + RefundStatusHistory → 事务外 initiateRefund → @Cron 补偿重试
- `order.service.ts` — 删除 140 行冗余双路业务逻辑（applyAfterSale / confirmReplacementReceive）
- `order.controller.ts` — 两个售后端点改为薄包装委托 ReplacementService
- `order.module.ts` — 新增 ReplacementModule 导入
- `replacement.module.ts` — 导出调整支持跨模块引用
- `replacement.service.ts` — 3 处 BadRequest→NotFoundException；新增 `confirmReceiveByOrder()` 支持 order 端点委托
- `seller-orders.service.ts` — 列表查询改为 AND+NOT 双重条件，只展示全属本企业订单

**管理后台 / 卖家后台前端**：
- `admin/src/api/client.ts` — 新增 `parseErrorMessage()` 解包函数
- `seller/src/api/client.ts` — 新增 `parseErrorMessage()` 解包函数

**买家 App**：
- `src/repos/OrderRepo.ts` — `confirmReplacement()` 返回类型对齐 `AfterSaleApplication`

### 8.20 架构质量审计 — 三端鉴权 + 卖家报表 + 数据隔离 + 状态同步 + DTO 校验（2026-03-01）

> R9 全面审计：覆盖上传鉴权链路、卖家收入统计、多商户数据隔离、换货状态同步、自动确认竞态、支付签名契约、DTO 运行时校验、token 刷新队列、退款模块注册、类型漂移。共 12 项，全部修复。

| # | 严重度 | 问题 | 修复内容 | 涉及文件 | 状态 |
|---|--------|------|---------|---------|------|
| R9-1 | 🔴严重 | 卖家上传鉴权链路与三端 JWT 隔离冲突：上传接口走全局买家 Guard，卖家 token（SELLER_JWT_SECRET）直接 401 | 上传控制器改为 `@Public()` + `@UseGuards(AnyAuthGuard)`，`AnyAuthGuard` 接受 `['jwt', 'seller-jwt', 'admin-jwt']` 三种策略 | `upload.controller.ts` / `any-auth.guard.ts`（新建） | ✅ |
| R9-2 | 🔴严重 | 卖家上传成功响应解析错误：Ant Design Dragger 绕过 axios 拦截器，收到 `{ok, data:{url}}` 但代码读 `f.response.url`（undefined） | 改为 `response?.data?.url \|\| response?.url` 兼容嵌套结构 | `seller/pages/products/edit.tsx` | ✅ |
| R9-3a | 🔴严重 | 卖家报表 overview 收入高估：`items:{some:{companyId}}` + `_sum:{totalAmount}` 对混单累计整单金额 | 新增 `strictCompanyOrderWhere()` 用 `AND + NOT` 排除混单，仅统计全属本企业订单 | `seller-analytics.service.ts` | ✅ |
| R9-3b | 🔴严重 | 卖家报表 salesTrend 重复累计：JOIN OrderItem 后 SUM(Order.totalAmount)，同单多商品翻倍 | 改为 `SUM(oi.unitPrice * oi.quantity)` 按商品项累计 + `NOT EXISTS` 排除混单 | `seller-analytics.service.ts` | ✅ |
| R9-3c | 🔴严重 | 卖家报表 productRanking 含取消/退款订单：LEFT JOIN 的 status 过滤在 ON 而非 WHERE | 改用 `CASE WHEN o.status NOT IN ('CANCELED','REFUNDED') THEN ... ELSE 0` 在聚合内过滤 | `seller-analytics.service.ts` | ✅ |
| R9-4 | 🔴严重 | 卖家物流详情混单泄露：`items: true` 无 companyId 过滤，返回整单所有 items | `hasMyItems + hasForeignItems` 双重检查，混单抛 ForbiddenException；返回前 `items.filter(companyId)` | `seller-shipments.service.ts` | ✅ |
| R9-5 | 🔴严重 | 买家"确认收到换货"后 Order.status 未同步（仍为 SHIPPED/DELIVERED），奖金分配未触发 | `confirmReceive()` 现在同时更新 Order.status → RECEIVED（CAS）、记录真实状态转换历史、事务后触发 `bonusAllocation.allocateForOrder()`（含 3 次指数退避重试） | `replacement.service.ts` | ✅ |
| R9-6 | 🔴严重 | 自动确认收货 TOCTOU 竞态：扫描排除活跃换货但事务内未重新校验 | 事务内新增 `replacementRequests` 查询（活跃状态 take:1），存在则 `return false` 跳过 | `order-auto-confirm.service.ts` | ✅ |
| R9-7 | 🟠高 | 支付回调签名依赖 `body.rawPayload.signature` 自定义结构，非标准"原始报文 + header 签名"模式 | 改为 `@Headers()` 提取签名（`x-webhook-signature` / `x-payment-signature` / `x-signature`），body 签名为 fallback；`crypto.timingSafeEqual()` 防时序攻击。物流回调同步改造 | `payment.controller.ts` / `payment.service.ts` / `shipment.controller.ts` / `shipment.service.ts` | ✅ |
| R9-8 | 🟡中 | 支付/物流回调用内联类型、地址接口用 interface，全局 ValidationPipe 无法校验 | 新建 `PaymentCallbackDto`、`ShipmentCallbackDto`（含 `@ValidateNested()` 嵌套事件）、`CreateAddressDto`、`UpdateAddressDto`，全部使用 class-validator 装饰器 | `dto/payment-callback.dto.ts`（新建）/ `dto/shipment-callback.dto.ts`（新建）/ `dto/create-address.dto.ts`（新建）/ `dto/update-address.dto.ts`（新建） | ✅ |
| R9-9 | 🟡中 | 管理端 token 刷新队列 Promise 仅有 resolve 无 reject，刷新失败后排队请求永久悬挂（卖家端已修复） | 管理端 `pendingRequests` 改为 `{resolve, reject}` 结构，新增 `rejectQueue()` 错误传播函数，刷新失败时所有排队请求收到 reject | `admin/src/api/client.ts` | ✅ |
| R9-10 | 🟡中 | `AdminRefundsModule` / `SellerRefundsModule` 已存在但未 import，FAILED 退款无管理入口 | `admin.module.ts` 导入 `AdminRefundsModule`，`seller.module.ts` 导入 `SellerRefundsModule`，端点生效 | `admin.module.ts` / `seller.module.ts` | ✅ |
| R9-11 | 🟡中 | 卖家订单详情：items 已按 companyId 过滤，但混单仍返回订单级敏感上下文（shipment/payments/refunds） | 新增 `foreignItemCount` 查询，混单直接抛 ForbiddenException("该订单包含其他企业商品") | `seller-orders.service.ts` | ✅ |
| R9-12 | 🟢低 | 前后端返回类型漂移（5 处）：admin ship/cancel 期望 Order 实为 {ok}、arbitrate 反向、buyer simulatePayment/cancelCheckoutSession 字段名不匹配 | 前端类型全部对齐后端实际返回：ship/cancel → `{ok:boolean}`、arbitrate → `AdminReplacement`、simulatePayment → `PaymentCallbackResult{code,message,orderIds?}`、cancelCheckoutSession → `{success:boolean}` | `admin/api/orders.ts` / `admin/api/replacements.ts` / `src/repos/OrderRepo.ts` | ✅ |

#### R9 影响文件汇总

**后端**：
- `upload.controller.ts` — `@Public()` + `@UseGuards(AnyAuthGuard)` 三端 JWT 兼容
- `common/guards/any-auth.guard.ts` — 新建，AuthGuard(['jwt', 'seller-jwt', 'admin-jwt'])
- `seller-analytics.service.ts` — 三个统计方法全面重写：strictCompanyOrderWhere + 按项累计 + CASE WHEN 过滤
- `seller-shipments.service.ts` — 混单检测 + 返回项过滤
- `seller-orders.service.ts` — 详情增加 foreignItemCount 混单拦截
- `replacement.service.ts` — confirmReceive 同步 Order.status + 触发奖金分配
- `order-auto-confirm.service.ts` — 事务内增加 replacementRequests 重新校验
- `payment.controller.ts` / `payment.service.ts` — 签名改为 Header 优先 + timingSafeEqual
- `shipment.controller.ts` / `shipment.service.ts` — 物流回调签名同步改造
- `dto/payment-callback.dto.ts` / `dto/shipment-callback.dto.ts` — 新建 class-validator DTO
- `dto/create-address.dto.ts` / `dto/update-address.dto.ts` — 新建 class-validator DTO
- `admin.module.ts` — 导入 AdminRefundsModule
- `seller.module.ts` — 导入 SellerRefundsModule

**管理后台前端**：
- `admin/src/api/client.ts` — token 刷新队列增加 reject 回调 + rejectQueue()
- `admin/src/api/orders.ts` — ship/cancel 返回类型对齐 `{ok:boolean}`
- `admin/src/api/replacements.ts` — arbitrate 返回类型对齐 `AdminReplacement`

**卖家后台前端**：
- `seller/src/pages/products/edit.tsx` — 上传响应解析改为 `response?.data?.url`

**买家 App**：
- `src/repos/OrderRepo.ts` — simulatePayment 返回 `PaymentCallbackResult`、cancelCheckoutSession 返回 `{success:boolean}`

---

## 九、实施阶段规划

### Phase A：数据模型与基础设施（后端优先） ✅

**优先级：最高 — 所有后续工作依赖此阶段**

1. ✅ Prisma Schema 变更：新增模型、修改枚举、新增字段
2. ✅ `prisma migrate` 生成迁移脚本
3. ✅ Seed 数据：创建平台公司（PLATFORM_COMPANY）、普通树单个系统根节点（rootId='NORMAL_ROOT', userId=null, level=0）
4. ✅ RuleConfig 初始化：写入所有 `NORMAL_*` 默认值 + `VIP_FREEZE_DAYS` 默认值
5. ✅ BonusConfigService 扩展：加载普通系统配置 + VIP冻结过期配置

### Phase B：普通用户树引擎（核心后端） ✅

**优先级：高 — 奖励系统核心**

1. ✅ `normal-upstream.service.ts` — 树分配核心（参考 vip-upstream.service.ts）
2. ✅ `normal-platform-split.service.ts` — 6项利润分割
3. ✅ `bonus-allocation.service.ts` — 路由决策增加 NORMAL_TREE
4. ✅ `reward-calculator.service.ts` — 普通用户利润计算公式
5. ✅ `bonus.service.ts` — 轮询平衡插入算法、首次收货入树逻辑
6. ✅ `FreezeExpireService` — 冻结奖励过期定时任务（同时处理普通和VIP两个系统）
7. ✅ **VIP冻结过期改造** — 修改 `vip-upstream.service.ts`：FROZEN ledger 写入 `meta.expiresAt`
8. ✅ 单元测试：树插入、分配路由、解锁逻辑、过期处理（含VIP过期新逻辑）

### Phase C：抽奖系统（后端+前端） — 后端 ✅ / 前端 ✅

**优先级：高 — 独立模块，可与 Phase B 并行**

1. ✅ `modules/lottery/` — 抽奖后端（lottery.service + controller + module）
2. ✅ `modules/admin/lottery/` — 管理后台抽奖管理后端（6 API：奖池CRUD + 记录查询 + 统计）
3. ✅ `modules/admin/platform-product/` — 奖励商品管理后端（4 API：CRUD）
4. ✅ 管理后台前端：奖池管理页、奖励商品管理页
5. ✅ 买家App前端：LotteryRepo + 首页抽奖入口 + 购物车奖品逻辑（服务端购物车已迁移）
6. ✅ 买家App前端：抽奖页转盘动画升级（2026-03-01）— SpinWheel SVG 等分扇形转盘 + WheelPointer 指针摆动 + Confetti 25 粒子庆祝爆发 + 5 阶段状态机（idle→spinning→decelerating→revealing→result_shown）+ AppBottomSheet 结果弹窗 + AiTypingEffect 逐字揭奖

> ~~审计补充（2026-02-28）~~：已修复。管理端奖池管理页 `admin/src/pages/lottery/index.tsx`、奖励商品页 `admin/src/pages/platform-products/index.tsx` 已创建；买家端 `LotteryRepo` + 首页入口已实现；购物车已迁移至服务端优先模式。

### Phase D：定价与运费改造 — 后端 ✅ / 前端 ✅

**优先级：中 — 影响面广但逻辑相对简单**

1. ✅ 后端：商品创建/更新时自动定价逻辑（seller-products.service 注入 BonusConfigService，price = cost × markupRate）
2. ✅ 卖家后台前端：SKU表单改造（只输入成本，售价自动计算只读展示）
3. ✅ 后端：ShippingRule 模块（5 API：CRUD + 运费预览，3D匹配引擎）
4. ✅ 管理后台前端：运费规则配置页面 `admin/src/pages/shipping-rules/index.tsx`
5. ✅ 后端：订单模块运费计算重写（ShippingRuleService 优先，ShippingTemplate 兜底）

> ~~审计补充（2026-02-28）~~：已修复。卖家商品编辑页 `seller/src/pages/products/edit.tsx` 已移除 SKU price 提交，改为 cost×markupRate 只读展示；管理端运费规则页已创建。

### Phase E：换货流程（替代退款） — 后端 ✅ / 前端 ✅

**优先级：中 — 影响售后体验**

1. ✅ 后端：replacement 模块（买家端 4 API + 卖家端 5 API + 管理端 3 API）
2. ✅ 买家App前端：换货申请页（照片上传+单选商品）、ReplacementRepo（查看/确认）
3. ✅ 卖家后台前端：换货管理页面 `seller/src/pages/replacements/`（列表+详情+审批/驳回/发货）
4. ✅ 管理后台前端：换货仲裁页面 `admin/src/pages/replacements/index.tsx`
5. ✅ 旧退款菜单已重命名为"历史退款"，新换货入口已添加

> ~~审计补充（2026-02-28）~~：已修复。买家 `after-sale` 页面已改为换货流程（含 photos 必填+单选 orderItemId）；卖家端新增换货管理页面；管理端新增换货仲裁页面。

### Phase F：管理后台配置整合 — 后端 ✅ / 前端 ✅

**优先级：低 — 配置类页面**

1. ✅ 普通系统参数配置页面（管理端已有 config 页面，权限常量已补齐）
2. ✅ VIP系统参数配置页面（独立，已存在）
3. ✅ 普通树查看器：后端 API + 管理前端 `admin/src/pages/bonus/normal-tree.tsx`
4. ✅ 菜单/权限更新：12 个权限常量已添加，5 个新菜单项已配置

> ~~审计补充（2026-02-28）~~：已修复。管理端 `admin/src/constants/permissions.ts` 已补齐 lottery/reward_products/shipping/replacements 权限常量，`AdminLayout.tsx` 菜单已同步。

### 数据迁移兼容修复（后端） ✅

**优先级：高 — 新旧数据结构冲突修复，Phase A-F 完成后立即执行**

1. ✅ `bonus.service.ts` — `getWallet()` 合并查询 RED_PACKET + NORMAL_RED_PACKET，返回分账户明细
2. ✅ `bonus.service.ts` — `requestWithdraw()` 支持 `accountType` 参数（'RED_PACKET' | 'NORMAL_RED_PACKET'），自动选择余额充足账户
3. ✅ `bonus.service.ts` — `getAvailableRewards()` 联查两类账户，sourceMap 新增 NORMAL_TREE/NORMAL_BROADCAST
4. ✅ `bonus-allocation.service.ts` — 过滤 `isPrize=true` 项，奖品不参与利润计算
5. ✅ `order.service.ts` — `getStatusCounts()` 使用联查（include ReplacementRequest）替代两次查询，换货订单计入 afterSale
6. ✅ `order.service.ts` — `getLatestIssue()` 同时查退款订单和活跃换货请求
7. ✅ `seller-products.service.ts` — `create()` 和 `updateSkus()` 增加服务层 cost>0 兜底校验
8. ✅ `freeze-expire.service.ts` — 新增无 expiresAt 的旧冻结奖励过期查询（基于 createdAt + maxFreezeDays）
9. ✅ `freeze-expire.service.ts` — accountType 路由使用共享 `getAccountTypeForScheme()` 函数
10. ✅ `normal-upstream.service.ts` — `unlockFrozenRewards()` 使用 `NORMAL_SCHEMES` 常量，同时匹配 NORMAL_TREE 和 NORMAL_BROADCAST
11. ✅ `constants.ts` — 新增 `NORMAL_SCHEMES` 常量和 `getAccountTypeForScheme()` 工具函数，消除 scheme 路由逻辑重复
12. ✅ 卖家/管理端退款服务加废弃文档注释，明确买家端已迁移至换货流程

### Phase G：前端集成与优化 ✅

**优先级：低 — 收尾**
**完成时间：2026-03-01**

1. ✅ 买家App：BonusRepo 已补齐 `getNormalTreeContext()`/`getNormalWallet()`/`getNormalRewards()` 方法
2. ✅ 买家App：奖励钱包区分VIP/普通奖励（wallet.tsx 双子账户卡片 + redpacks.tsx Tab 切换 + 来源 Tag 标签）
3. ✅ 买家App：冻结奖励倒计时和解锁条件展示（NormalRedPackCard 组件，含解锁条件/过期倒计时/≤3天红色警告）
4. ✅ 联调测试：TypeScript 编译通过（`npx tsc --noEmit`）、Mock 模式 UI 验证、审查 Agent 通过（0 Critical/High）
5. ✅ 更新 frontend.md（5.18 钱包 + 5.18.1 奖励列表设计稿）、plan.md（钱包/VIP 对齐记录）

---

### Phase H：P0 安全与资金修复（阻塞新功能） ✅

**优先级：最高 — 必须在新功能开发前完成**
**依赖：无**
**详见：`conflict1.md` P0 清单**
**完成时间：2026-02-28**

| # | 编号 | 问题 | 修复方案 | 状态 |
|---|------|------|---------|------|
| 1 | C5/H11/H9 | 管理端抽奖 API DTO 白名单化 + 业务约束校验 | 创建 `CreateLotteryPrizeDto`/`UpdateLotteryPrizeDto`，移除 `as any`，NO_PRIZE 强制 productId/skuId=null | ✅ |
| 2 | H6 | VIP rewardPool 归平台缺记账记录 | `vip-upstream.service.ts` no_ancestor/root 路径增加 `creditToPlatform()` | ✅ |
| 3 | H13+NEW-A2 | 提现审批/拒绝 frozen CAS 缺失 | `approveWithdraw`/`rejectWithdraw` frozen decrement 改为 `updateMany where: { frozen: { gte: amount } }` | ✅ |
| 4 | C3 | CartItem.prizeRecordId 缺唯一约束 | 新增 `@unique` 约束 + 迁移已部署 | ✅ |
| 5 | NEW-A1 | AuditLog modelMap 不含 LotteryPrize | `audit-log.interceptor.ts` modelMap 增加 `LotteryPrize: 'lotteryPrize'` | ✅ |
| 6 | NEW-S1 | 卖家退款审批库存恢复缺 Serializable | `seller-refunds.service.ts` 事务加 `isolationLevel: Serializable` | ✅ |

### Phase I：P1 业务逻辑修复 ✅

**优先级：高 — 确保业务正确性**
**依赖：Phase H**
**详见：`conflict1.md` P1 清单**
**完成时间：2026-02-28**

| # | 编号 | 问题 | 修复方案 | 状态 |
|---|------|------|---------|------|
| 7 | H5 | 购物车返回 SKU 原价而非奖品价 | `mapCartItem()` 读取 LotteryRecord.meta.prizePrice，返回 prizePrice + originalPrice | ✅ |
| 8 | M11 | 用户 API 暴露奖品概率 | `lottery.service.ts` getPrizes() select 移除 probability | ✅ |
| 9 | M13 | 奖励过期天数硬编码 30 天 | 新增配置项，替换 order.service.ts + bonus.service.ts 硬编码（→ F5 实施） | → Phase J |
| 10 | M1 | LotteryRecord 缺生命周期状态 | 新增 status 枚举 WON→IN_CART→EXPIRED→CONSUMED + 全链路状态管理 | ✅ |
| 11 | M3 | 门槛按整单跨公司计算 | 改为按 selectedItemIds / isSelected 驱动（→ F2 前置） | → Phase K |
| 12 | H8 | VIP 分配比例 sum 缺校验 | `bonus-config.service.ts` 增加 VIP 比例 sum=1.0 校验 + 更新时前置校验 + 回滚校验 | ✅ |
| 13 | NEW-A3 | UpdateConfigDto value 无类型校验 | 新建 `config-validation.ts`，24 个配置项按类型/范围校验 | ✅ |
| 14 | NEW-S2/S3/S4 | 卖家端事务隔离级别修复 | 发货/换货审批/商品创建加 Serializable，markupRate 移入事务 | ✅ |

### Phase J：F5 奖励过期可配置 + F4 平台公司设置 ✅

**优先级：中 — 无外部依赖，可独立实施**
**依赖：Phase I（M13 fix 合并入 F5）**
**详见：`new-features-design.md` §5 + §4**

**F5 奖励过期可配置（低复杂度）**：
1. ✅ `bonus-config.service.ts` 增加 `vipRewardExpiryDays`/`normalRewardExpiryDays` 字段+KEY_MAP+DEFAULTS+getSystemConfig
2. ✅ 替换 `order.service.ts` 三处 30 天硬编码 + `bonus.service.ts` 过期计算（按 RewardAccount.type 区分 VIP/NORMAL）
3. ✅ Seed 新增 `VIP_REWARD_EXPIRY_DAYS`/`NORMAL_REWARD_EXPIRY_DAYS` RuleConfig + config-validation 验证规则

**F4 平台公司设置（低复杂度）**：
4. ✅ Schema: Company 新增 `isPlatform Boolean @default(false)` + migration
5. ✅ Seed: 平台公司名更新为"爱买买app"，`isPlatform: true`（upsert update+create 双路径）
6. ✅ 用户端商品搜索 `product.service.ts list()` 增加 `company: { isPlatform: false }` 过滤
7. ✅ 卖家端 `seller-company.service.ts inviteStaff()` 排除 PLATFORM_COMPANY

### Phase K：F2 赠品锁定 + F3 奖品过期 ✅

**优先级：中高 — F1 订单重构的前置依赖**
**依赖：Phase J（F4 平台公司已就绪）**
**详见：`new-features-design.md` §2 + §3**

**F2 赠品锁定机制（中复杂度）**：
1. ✅ Schema: CartItem 新增 `isLocked`/`threshold`/`isSelected`/`createdAt` 字段 + migration
2. ✅ `cart.service.ts`: 锁定赠品操作限制（removePrizeItem 检查 isLocked，clearCart 保留锁定项）
3. ✅ `cart.service.ts`: `getCart()` 返回 isLocked/threshold/isSelected/unlockDeficit/selectedTotal/lockedGiftsInfo
4. ✅ 新增 `PATCH /cart/items/:skuId/select` 端点 + `toggleSelect()` 方法
5. ✅ `order.service.ts`: previewOrder/createFromCart 解锁赠品强制包含，未解锁排除（不再 throw）

**F3 奖品过期机制（中复杂度）**：
6. ✅ Schema: LotteryPrize 新增 `expirationHours`；CartItem 新增 `expiresAt` + expiresAt 索引
7. ✅ `cart.service.ts`: `getCart()` 调用前执行 `cleanExpiredPrizeItems()` + LotteryRecord→EXPIRED
8. ✅ 新增 `prize-expire.service.ts` 定时任务（每 15 分钟）扫描全局过期奖品购物车项
9. ✅ 管理端 DTO: CreateLotteryPrizeDto/UpdateLotteryPrizeDto 增加 `expirationHours`，Service 透传
10. ✅ `order.service.ts`: previewOrder/createFromCart 排除过期奖品（WHERE expiresAt>=now OR null）
11. ✅ `lottery.service.ts`: draw() 入购物车时设置 isLocked/threshold/expiresAt + meta 记录

### Phase L：F1 订单流程重构（付款后建单） — 后端 ✅ / 买家前端 ✅

**优先级：中 — 架构级重构，最后实施**
**依赖：Phase K（F2 锁定 + F3 过期机制已就绪）**
**详见：`new-features-design.md` §1**

1. ✅ Schema: 新增 `CheckoutSession` 模型 + `CheckoutSessionStatus` 枚举
2. ✅ Schema: Order 新增 `checkoutSessionId`；RewardLedgerStatus 新增 `RESERVED`
3. ✅ `POST /orders/checkout`: 创建 CheckoutSession（校验库存+计算总额+预留奖励+返回支付参数）
4. ✅ `POST /orders/checkout/:id/cancel`: 取消会话，释放预留奖励
5. ✅ `GET /orders/checkout/:id/status`: 前端轮询订单创建状态
6. ✅ `POST /payments/callback`: Serializable 事务原子创建订单+扣库存+清购物车+消费奖品记录
7. ✅ 新增定时任务：会话过期清理（ACTIVE 超 30 分钟→释放奖励→EXPIRED）
8. ✅ 超卖容忍：库存不足时允许负库存，通知卖家补货（R12）；`seed.ts` 已清理 `chk_product_sku_stock_non_negative` 约束
9. ✅ 封禁旧流程：`POST /orders` 与 `POST /orders/:id/pay` 返回 410；`createFromCart()`/`payOrder()` 仅保留兼容代码
10. ✅ 迁移数据：保留 PENDING_PAYMENT 枚举值用于历史数据查询
11. ✅ 买家前端切换：`app/checkout.tsx` 已改为 createCheckoutSession → simulatePayment → 轮询 status
12. ✅ 结算一致性：checkout 已传 addressId，地址验证已添加
13. ✅ 本地购物车修正：支付成功后调用 `clearCheckedItems()` 只清已结算项
14. ✅ 自动确认收货配置化：卖家/后台发货改为读取 `AUTO_CONFIRM_DAYS`
15. ✅ 奖池业务校验增强：`THRESHOLD_GIFT` 强制 `threshold>0 & prizePrice=0`，`DISCOUNT_BUY` 强制 `prizePrice>0` 且不高于 SKU 原价，`skuId` 必须属于 `productId`

> ~~审计补充（2026-02-28）~~：已修复。买家端结算页已完全切换至 CheckoutSession 流程，F1 端到端闭环已形成。

---

## 十、跨系统协同与冲突风险

### 10.1 数据流向图

```
[卖家设成本] → [后端自动定价 price=cost×1.3] → [买家下单] → [物流确认收货]
                                                                  ↓
                                                      [首次收货? → 入普通树]
                                                                  ↓
                                                         [用户是VIP？]
                                                        ↙            ↘
                                                  [是VIP]         [非VIP]
                                                     ↓                ↓
                                          [VIP六分公式          [普通六分公式]
                                           50/30/10/2/2/6]    [50/16/16/8/8/2]
                                                     ↓                ↓
                                          [VIP树分配]         [普通树分配]
                                          [k→第k祖辈]        [k→第k祖辈]
                                                     ↓                ↓
                                          [解锁/冻结]         [解锁/冻结]
                                          [VIP_FREEZE_DAYS]   [NORMAL_FREEZE_DAYS]
```

### 10.2 潜在冲突点

| 冲突 | 说明 | 解决方案 | 状态 |
|------|------|---------|------|
| 旧订单兼容 | 改造前的已有订单仍使用旧的NormalBroadcast分配记录 | 旧分配记录保留，新订单走新流程。allocateForOrder 根据订单创建时间决定走哪条路径 | ✅ |
| 商品价格迁移 | 旧商品有手动设置的 price，新系统要求 price = cost × 1.3 | 提供管理后台迁移工具：批量重算 price = cost × markupRate（仅对有 cost 的商品） | ⬜ 需迁移脚本 |
| SKU.cost 必填 | 旧SKU的 cost 可能为 null | Schema 改为 `Float @default(0)` + 服务层 cost>0 校验。创建/更新 SKU 时兜底校验 | ✅ |
| 退款→换货切换 | 已有的进行中退款请求 | 保留旧退款流程直到处理完毕，新订单走换货流程。卖家/管理端退款服务已加废弃注释 | ✅ |
| 运费切换 | 旧的商户ShippingTemplate → 新的平台ShippingRule | 迁移期间先创建平台规则，再逐步停用商户模板。新订单优先使用平台规则，异常时降级旧模板兜底 | ✅ |
| 奖励钱包双账户 | getWallet/requestWithdraw 仅查 RED_PACKET，遗漏 NORMAL_RED_PACKET | getWallet 返回合并+分账户明细；requestWithdraw 支持 accountType 参数，自动选择余额充足账户 | ✅ |
| 奖品项利润膨胀 | isPrize=true 的 OrderItem 参与分润计算导致利润池虚增 | bonus-allocation.service.ts 过滤 isPrize=true 项后再计算利润 | ✅ |
| 订单状态计数遗漏换货 | getStatusCounts 仅计 REFUNDED 为售后，getLatestIssue 仅查退款 | 两个方法均改为联查 ReplacementRequest（活跃状态），换货订单计入 afterSale | ✅ |
| VIP冻结奖励无过期 | 旧VIP冻结奖励 meta 无 expiresAt，FreezeExpireService SQL 过滤掉 | 新增第二条 SQL 查询：无 expiresAt 的冻结奖励按 createdAt + maxFreezeDays 判断过期 | ✅ |
| NORMAL_BROADCAST 解锁遗漏 | unlockFrozenRewards 仅匹配 NORMAL_TREE，旧 NORMAL_BROADCAST 冻结奖励永远无法解锁 | 解锁过滤和过期路由统一使用 NORMAL_SCHEMES 常量（含 NORMAL_TREE + NORMAL_BROADCAST） | ✅ |
| getAvailableRedPacks 缺普通来源 | sourceMap 无 NORMAL_TREE/NORMAL_BROADCAST，查询只从单账户 | 查询改为联查两类账户，sourceMap 新增普通来源映射 | ✅ |
| 买家购物车双轨 | 后端 `CartItem`（含奖品锁定/过期）与前端本地 Zustand 购物车并存 | 买家端已改为服务端购物车主链路，乐观更新+失败回滚 | ✅ 已修复 |
| 售后 DTO 不兼容 | 买家端提交退款参数，后端已切换换货 DTO（`photos` 必填） | 买家端已改造为 Replacement 页面（照片上传+单选商品）；旧入口重命名为"历史退款" | ✅ 已修复 |
| 卖家商品 DTO 不兼容 | 卖家端仍提交 `price`，后端强制 cost 自动定价且启用 whitelist | 卖家端已改造为成本输入 + 自动售价只读展示，SKU 提交移除 price | ✅ 已修复 |
| F1 前端未切换 | 后端已有 CheckoutSession，买家端仍走旧建单后支付 | 结算页已切换 createCheckoutSession + simulatePayment + 轮询 status | ✅ 已修复 |
| 运费子单分摊解释偏差 | 回调建单按金额比例拆 `session.shippingFee`，与分组规则计算结果可能不一致 | 已在会话中持久化每组运费快照并优先按快照建单（老会话比例拆分兜底） | ✅ 已修复 |

### 10.3 权限矩阵新增

| 权限标识 | 说明 | 分配 |
|---------|------|------|
| `lottery:read` | 查看抽奖配置和记录 | 管理员 |
| `lottery:manage` | 管理奖池、开关抽奖 | 管理员 |
| `reward_product:read` | 查看奖励商品 | 管理员 |
| `reward_product:manage` | 管理奖励商品 | 管理员 |
| `shipping:read` | 查看运费规则 | 管理员 |
| `shipping:manage` | 管理运费规则 | 管理员 |
| `normal_bonus:read` | 查看普通用户树和配置 | 管理员 |
| `normal_bonus:manage` | 管理普通用户树配置 | 管理员 |
| `replacement:read` | 查看换货请求 | 管理员、卖家 |
| `replacement:manage` | 审核换货请求 | 管理员、卖家 |

> ~~审计补充（2026-02-28）~~：已修复。管理端权限常量已按后端实际命名统一补齐（`admin/src/constants/permissions.ts`），PermissionGate 可正常接入。

---

## 十一、文档更新清单（实施完成后）

| 文档 | 更新内容 |
|------|---------|
| `CLAUDE.md` | 新增 plan-treeforuser.md 引用、更新技术架构决策 |
| `data-system.md` | 新增模型定义、更新枚举、标记废弃模型 |
| `backend.md` | 新增模块说明、API文档、定时任务 |
| `frontend.md` | 新增页面说明、组件规范、抽奖转盘设计 ✅（含 5.1b 抽奖页设计稿 + SpinWheel/WheelPointer/Confetti 组件 + Batch 10 + Phase 7） |
| `sales.md` | 更新卖家商品管理流程（成本→自动定价）、换货流程 |
| `plan.md` | 新增 Phase（普通用户系统改造）进度追踪 |
| `tofix-safe.md` | 追加 N01-N07 安全检查项 |
| `security-audit.md` | 更新并发安全章节（新增普通树相关） |
