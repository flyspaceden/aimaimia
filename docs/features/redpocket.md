# 平台红包系统 — 需求与实施计划

> **文档定位**：平台红包（优惠券）系统的完整设计方案，包含需求说明、数据模型、API 设计、管理后台页面、买家 App 改造、实施步骤
> **与分润奖励系统的关系**：完全独立。分润奖励（原"红包"）使用现有 `RewardAccount` / `RewardLedger` 体系，只能提现；平台红包使用全新的 `CouponCampaign` / `CouponInstance` 体系，只能结算抵扣

> **⚠️ 实施警告：本计划涉及先重命名旧系统再新增功能，极易混淆。开发时必须时刻区分"分润奖励"（Reward 体系，只能提现）和"平台红包"（Coupon 体系，结算抵扣）。部分前端页面的功能可以沿用，部分不能。如果对任何改动点属于哪个系统有疑问，必须先向用户确认，不要自行猜测或创造。**

---

## 一、概念定义

| 概念 | 说明 | 来源 | 用途 |
|------|------|------|------|
| **分润奖励** | VIP树/普通用户树向上传递的分润收入 | 用户消费 → 树结构分配 | 只能提现到银行卡/微信/支付宝 |
| **平台红包** | 平台主动发放给用户的优惠福利 | 平台运营活动 | 结算时抵扣付款金额 |

两套系统**数据模型完全独立**、**业务逻辑互不影响**。

### 1.1 分润奖励系统代码标识符重命名

为避免与平台红包系统混淆，分润奖励系统中所有含 `RedPack` / `redPack` / `RED_PACKET` 的代码标识符统一改为 `Reward` / `reward` 命名：

#### Prisma Schema 枚举值（需要数据库迁移）

| 位置 | 当前值 | 改为 | 说明 |
|------|--------|------|------|
| `RewardAccountType` | `RED_PACKET` | `VIP_REWARD` | VIP 分润奖励账户 |
| `RewardAccountType` | `NORMAL_RED_PACKET` | `NORMAL_REWARD` | 普通分润奖励账户 |

#### 配置键（RuleConfig）

| 当前键名 | 改为 | 说明 |
|----------|------|------|
| `VIP_REDPACK_EXPIRY_DAYS` | `VIP_REWARD_EXPIRY_DAYS` | VIP 已释放奖励有效期（天） |
| `NORMAL_REDPACK_EXPIRY_DAYS` | `NORMAL_REWARD_EXPIRY_DAYS` | 普通已释放奖励有效期（天） |
| `NORMAL_REDPACKET_PERCENT` | `NORMAL_REWARD_PERCENT` | 普通奖励分成比例 |

#### 后端方法名

| 位置 | 当前方法名 | 改为 |
|------|-----------|------|
| `bonus.service.ts` | `getNormalRedPacks()` | `getNormalRewards()` |
| `bonus.service.ts` | `getAvailableRedPacks()` | `getAvailableRewards()` |
| `bonus.controller.ts` | 对应路由处理器 | 同步更名 |
| `admin-bonus.service.ts` | 相关方法 | 同步更名 |

#### 后端 API 路由

| 当前路由 | 改为 |
|----------|------|
| `GET /bonus/wallet/normal-redpacks` | `GET /bonus/wallet/normal-rewards` |
| `GET /bonus/wallet/available-redpacks` | 移除（结算抵扣改用 Coupon 体系） |

#### 前端类型定义（`src/types/domain/Bonus.ts`）

| 当前类型名 | 改为 |
|-----------|------|
| `RedPackItem` | `RewardItem` |
| `NormalRedPackItem` | `NormalRewardItem` |

#### 前端组件

| 当前组件名 | 改为 |
|-----------|------|
| `RedPackCard` | `RewardCard` |
| `NormalRedPackCard` | `NormalRewardCard` |

#### 前端 Repository（`src/repos/BonusRepo.ts`）

| 当前方法名 | 改为 |
|-----------|------|
| `getNormalRedPacks()` | `getNormalRewards()` |
| `getAvailableRedPacks()` | 移除（改用 `CouponRepo.getCheckoutEligible()`） |

#### 前端路由与文件

| 当前 | 改为 |
|------|------|
| `app/me/redpacks.tsx`（路由 `/me/redpacks`） | `app/me/rewards.tsx`（路由 `/me/rewards`）— 分润奖励列表页 |
| `app/checkout-redpack.tsx` | 移除 — 结算红包选择改用新的 Coupon 选择组件 |

#### 管理后台

| 位置 | 当前标识 | 改为 |
|------|---------|------|
| `admin/src/api/bonus.ts` | 相关方法名 | 同步更名 |
| `admin/src/pages/bonus/` | 页面中引用的 redpack 相关变量 | 同步更名 |

#### 文档中的代码引用

所有 MD 文档中引用的上述标识符需同步更新（backtick 内的代码引用）。

> **注意**：`RewardAccount`、`RewardLedger`、`RewardAllocation` 等模型名保持不变，它们的命名已经是 `Reward` 前缀，无需修改。

---

## 二、平台红包类型与发放机制

所有类型通过管理后台的"红包活动"统一配置，系统只需支持**触发条件 + 发放规则 + 使用规则**三层抽象，不为每种类型写死逻辑。

### 2.1 触发条件类型（TriggerType）

| 触发类型 | 标识 | 说明 | 发放方式 |
|----------|------|------|----------|
| 新用户注册 | `REGISTER` | 用户完成注册时自动发放 | 自动 |
| 首次下单 | `FIRST_ORDER` | 用户首次下单完成后发放 | 自动 |
| 生日 | `BIRTHDAY` | 用户生日当天/当月发放 | 自动 |
| 签到 | `CHECK_IN` | 连续签到达到天数阈值 | 自动 |
| 邀请新用户 | `INVITE` | 被邀请用户完成注册后发放给邀请人 | 自动 |
| 好评奖励 | `REVIEW` | 用户完成商品评价后发放 | 自动 |
| 分享 | `SHARE` | 用户分享商品/活动到社交平台后领取 | 用户领取 |
| 累计消费 | `CUMULATIVE_SPEND` | 累计消费金额达到阈值 | 自动 |
| 复购激励 | `WIN_BACK` | 用户超过 N 天未下单时发放 | 自动 |
| 节日活动 | `HOLIDAY` | 指定日期范围内发放/可领取 | 自动/用户领取 |
| 限时抢 | `FLASH` | 限量限时，先到先得 | 用户领取 |
| 手动发放 | `MANUAL` | 管理员手动指定用户发放 | 手动 |

### 2.2 使用规则（UsageRule）

| 规则维度 | 说明 | 配置项 |
|----------|------|--------|
| 最低消费门槛 | 订单金额达到门槛才能使用 | `minOrderAmount`（为 0 则无门槛） |
| 抵扣方式 | 固定金额 / 按比例折扣 | `discountType`: `FIXED`（固定金额）/ `PERCENT`（百分比折扣） |
| 抵扣金额/比例 | 固定金额或折扣百分比 | `discountValue`（金额或百分比 0-100） |
| 最高抵扣上限 | 百分比折扣时限制最大抵扣额 | `maxDiscountAmount`（仅 PERCENT 时有效） |
| 品类限制 | 限定适用的商品分类 | `applicableCategories`（空数组表示不限） |
| 店铺限制 | 限定适用的店铺（预留，当前平台发放不限店铺） | `applicableCompanyIds`（空数组表示不限） |
| 叠加规则 | 是否允许与同类红包叠加使用 | `stackable`: `true`/`false` |
| 叠加分组 | 同组红包是否可叠加（管理员配置） | `stackGroup`（同组内按 stackable 判断） |
| 每人限领 | 每个用户最多可领取几张 | `maxPerUser` |
| 总发放量 | 活动总共可发放多少张 | `totalQuota` |
| 有效期 | 从领取时起算的有效天数 | `validDays`（0 表示跟随活动结束时间） |

---

## 三、数据模型设计

### 3.1 新增枚举

```prisma
// 红包活动状态
enum CouponCampaignStatus {
  DRAFT        // 草稿
  ACTIVE       // 进行中
  PAUSED       // 已暂停
  ENDED        // 已结束
}

// 抵扣类型
enum CouponDiscountType {
  FIXED        // 固定金额（如减10元）
  PERCENT      // 百分比折扣（如打9折）
}

// 触发类型
enum CouponTriggerType {
  REGISTER          // 新用户注册
  FIRST_ORDER       // 首次下单
  BIRTHDAY          // 生日
  CHECK_IN          // 签到
  INVITE            // 邀请新用户
  REVIEW            // 好评
  SHARE             // 分享
  CUMULATIVE_SPEND  // 累计消费
  WIN_BACK          // 复购激励
  HOLIDAY           // 节日活动
  FLASH             // 限时抢
  MANUAL            // 手动发放
}

// 发放方式
enum CouponDistributionMode {
  AUTO              // 系统自动发放到用户账户
  CLAIM             // 用户主动领取
  MANUAL            // 管理员手动指定发放
}

// 红包实例状态
enum CouponInstanceStatus {
  AVAILABLE         // 可用
  RESERVED          // 已锁定（结算中）
  USED              // 已使用
  EXPIRED           // 已过期
  REVOKED           // 已撤回（管理员操作）
}
```

### 3.2 新增模型

```prisma
// ==========================================
// 红包活动（管理员创建的活动/规则）
// ==========================================
model CouponCampaign {
  id                  String                @id @default(uuid())

  // 基本信息
  name                String                // 活动名称（如"2026春节红包"）
  description         String?               // 活动描述
  status              CouponCampaignStatus  @default(DRAFT)

  // 触发与发放
  triggerType          CouponTriggerType     // 触发条件类型
  distributionMode     CouponDistributionMode // 发放方式
  triggerConfig        Json?                 // 触发条件额外配置（如签到天数、消费阈值、未下单天数等）

  // 抵扣规则
  discountType         CouponDiscountType    // FIXED / PERCENT
  discountValue        Float                 // 金额（元）或百分比（0-100）
  maxDiscountAmount    Float?                // 百分比折扣时的最高抵扣额
  minOrderAmount       Float                 @default(0) // 最低消费门槛（0=无门槛）

  // 适用范围
  applicableCategories String[]              @default([]) // 限定品类（空=不限）
  applicableCompanyIds String[]              @default([]) // 限定店铺（空=不限，预留扩展）

  // 叠加规则
  stackable            Boolean               @default(true) // 是否可与同类叠加
  stackGroup           String?               // 叠加分组标识

  // 发放限制
  totalQuota           Int                   // 总发放量
  issuedCount          Int                   @default(0) // 已发放数量
  maxPerUser           Int                   @default(1) // 每人限领

  // 有效期
  validDays            Int                   @default(7)  // 领取后有效天数（0=跟随活动结束时间）
  startAt              DateTime              // 活动开始时间
  endAt                DateTime              // 活动结束时间

  // 审计
  createdBy            String                // 创建管理员 ID
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt

  // 关联
  instances            CouponInstance[]

  @@index([status, startAt, endAt])
  @@index([triggerType])
}

// ==========================================
// 红包实例（用户领取/获得的具体红包）
// ==========================================
model CouponInstance {
  id                  String                @id @default(uuid())

  // 关联
  campaignId          String
  campaign            CouponCampaign        @relation(fields: [campaignId], references: [id], onDelete: Restrict)
  userId              String
  user                User                  @relation(fields: [userId], references: [id], onDelete: Restrict)

  // 状态
  status              CouponInstanceStatus  @default(AVAILABLE)

  // 冗余抵扣信息（快照，避免活动修改后影响已发放红包）
  discountType        CouponDiscountType
  discountValue       Float
  maxDiscountAmount   Float?
  minOrderAmount      Float                 @default(0)

  // 有效期
  issuedAt            DateTime              @default(now()) // 发放时间
  expiresAt           DateTime              // 过期时间（issuedAt + validDays，或活动 endAt）

  // 使用记录
  usedAt              DateTime?             // 使用时间
  usedOrderId         String?               // 使用的订单 ID
  usedAmount          Float?                // 实际抵扣金额

  // 审计
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt

  // 使用记录关联
  usageRecords        CouponUsageRecord[]

  @@index([userId, status])
  @@index([campaignId])
  @@index([expiresAt])
  @@unique([campaignId, userId, issuedAt]) // 防止同一活动同一用户同一时刻重复发放
}

// ==========================================
// 红包使用记录（一笔订单可使用多张红包）
// ==========================================
model CouponUsageRecord {
  id                  String                @id @default(uuid())

  // 关联
  couponInstanceId    String
  couponInstance      CouponInstance        @relation(fields: [couponInstanceId], references: [id], onDelete: Restrict)
  orderId             String
  order               Order                 @relation(fields: [orderId], references: [id], onDelete: Restrict)

  // 抵扣详情
  discountAmount      Float                 // 本张红包实际抵扣金额

  // 审计
  createdAt           DateTime              @default(now())

  @@index([orderId])
  @@index([couponInstanceId])
}
```

### 3.3 现有模型变更

```prisma
// User 模型添加关联
model User {
  // ... 现有字段
  couponInstances     CouponInstance[]
}

// Order 模型添加关联
model Order {
  // ... 现有字段
  couponUsageRecords  CouponUsageRecord[]
  totalCouponDiscount Float?               // 红包总抵扣金额
}

// CheckoutSession 模型变更
model CheckoutSession {
  // ... 现有字段
  // 移除旧字段（分润奖励抵扣）：
  // redPackId         String?   ← 移除（不再支持分润奖励抵扣）
  // discountAmount    Float?    ← 移除

  // 新增字段（平台红包抵扣）：
  couponInstanceIds   String[]  @default([]) // 选中的红包实例 ID 列表
  totalCouponDiscount Float     @default(0)  // 红包总抵扣金额
}
```

---

## 四、后端 API 设计

### 4.1 买家端 API（`/api/v1/coupons`）

| 端点 | Method | 说明 | 认证 |
|------|--------|------|------|
| `/coupons/available` | GET | 查询当前可领取的红包活动列表 | 是 |
| `/coupons/my` | GET | 查询我的红包（支持状态筛选：AVAILABLE/USED/EXPIRED） | 是 |
| `/coupons/claim/:campaignId` | POST | 领取红包（用户主动领取类型） | 是 |
| `/coupons/checkout-eligible` | POST | 查询结算时可用的红包列表（传入商品信息，返回符合条件的红包） | 是 |

#### 关键 DTO

```typescript
// 查询可领取活动
interface AvailableCampaignDto {
  id: string;
  name: string;
  description: string;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  remainingQuota: number;      // 剩余可领数量
  userClaimedCount: number;    // 用户已领数量
  maxPerUser: number;
  startAt: string;
  endAt: string;
  distributionMode: 'AUTO' | 'CLAIM' | 'MANUAL';
}

// 我的红包
interface MyCouponDto {
  id: string;                  // CouponInstance ID
  campaignName: string;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  status: 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedOrderId: string | null;
  usedAmount: number | null;
}

// 结算可用红包查询请求
interface CheckoutEligibleRequest {
  orderAmount: number;         // 订单金额（不含运费）
  categoryIds: string[];       // 商品所属分类
  companyIds: string[];        // 商品所属店铺
}

// 结算可用红包查询响应
interface CheckoutEligibleCoupon extends MyCouponDto {
  estimatedDiscount: number;   // 预估可抵扣金额
  eligible: boolean;           // 是否满足使用条件
  ineligibleReason: string | null; // 不满足原因
}
```

### 4.2 管理端 API（`/api/v1/admin/coupons`）

| 端点 | Method | 说明 | 权限 |
|------|--------|------|------|
| `/admin/coupons/campaigns` | GET | 红包活动列表（分页、筛选） | `coupon:read` |
| `/admin/coupons/campaigns` | POST | 创建红包活动 | `coupon:manage` |
| `/admin/coupons/campaigns/:id` | GET | 活动详情 | `coupon:read` |
| `/admin/coupons/campaigns/:id` | PATCH | 编辑活动 | `coupon:manage` |
| `/admin/coupons/campaigns/:id/status` | PATCH | 上下架（ACTIVE/PAUSED/ENDED） | `coupon:manage` |
| `/admin/coupons/campaigns/:id/instances` | GET | 活动发放记录（谁领了） | `coupon:read` |
| `/admin/coupons/campaigns/:id/usage` | GET | 活动使用记录（用在哪笔订单） | `coupon:read` |
| `/admin/coupons/campaigns/:id/manual-issue` | POST | 手动发放给指定用户 | `coupon:manage` |
| `/admin/coupons/stats` | GET | 红包数据统计总览 | `coupon:read` |
| `/admin/coupons/stats/:campaignId` | GET | 单个活动统计 | `coupon:read` |

#### 关键管理端 DTO

```typescript
// 创建红包活动
interface CreateCampaignDto {
  name: string;
  description?: string;
  triggerType: CouponTriggerType;
  distributionMode: CouponDistributionMode;
  triggerConfig?: Record<string, any>;  // 额外触发条件配置
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  applicableCategories?: string[];
  applicableCompanyIds?: string[];
  stackable?: boolean;
  stackGroup?: string;
  totalQuota: number;
  maxPerUser?: number;
  validDays?: number;
  startAt: string;
  endAt: string;
}

// 红包统计总览
interface CouponStatsOverview {
  totalCampaigns: number;          // 活动总数
  activeCampaigns: number;         // 进行中的活动
  totalIssued: number;             // 总发放量
  totalUsed: number;               // 总使用量
  totalDiscountAmount: number;     // 总抵扣金额
  usageRate: number;               // 使用率（已使用/已发放）
  dailyTrend: Array<{             // 近 7 天趋势
    date: string;
    issued: number;
    used: number;
    discountAmount: number;
  }>;
}

// 单个活动统计
interface CampaignStats {
  campaignId: string;
  campaignName: string;
  issuedCount: number;
  usedCount: number;
  expiredCount: number;
  totalDiscountAmount: number;
  usageRate: number;
  avgDiscountPerOrder: number;
}
```

### 4.3 结算流程改造

#### 现有流程（移除）
```
CheckoutSession 接受 redPackId → 锁定分润奖励 → 支付时抵扣
```

#### 新流程
```
1. 用户在结算页选择多张平台红包
2. POST /orders/checkout 传入 couponInstanceIds: string[]
3. CheckoutService.checkout():
   a. 校验每张红包：状态=AVAILABLE、未过期、满足门槛、品类匹配
   b. 校验叠加规则：同 stackGroup 内是否允许叠加
   c. 计算每张红包抵扣金额（FIXED 直接取值，PERCENT 按订单金额计算取 min(计算值, maxDiscountAmount)）
   d. 总抵扣不超过订单实付金额（不含运费，不能倒贴）
   e. Serializable 事务内：CAS 锁定所有红包（AVAILABLE → RESERVED）
   f. 创建 CheckoutSession，记录 couponInstanceIds + totalCouponDiscount
4. 支付成功回调：
   a. 红包状态 RESERVED → USED
   b. 创建 CouponUsageRecord
   c. 更新 Order.totalCouponDiscount
5. 会话过期/取消：
   a. 红包状态 RESERVED → AVAILABLE（释放）
```

---

## 五、管理后台页面设计

### 5.1 红包活动管理（`/admin/coupons/campaigns`）

**ProTable 列表页**

| 列 | 字段 | 说明 |
|----|------|------|
| 活动名称 | `name` | 可点击进入详情 |
| 触发类型 | `triggerType` | Tag 展示（颜色区分） |
| 发放方式 | `distributionMode` | 自动/领取/手动 |
| 抵扣规则 | `discountType` + `discountValue` | 如"满100减10" / "9折（最高减50）" |
| 发放进度 | `issuedCount / totalQuota` | 进度条 |
| 活动时间 | `startAt ~ endAt` | 日期范围 |
| 状态 | `status` | DRAFT/ACTIVE/PAUSED/ENDED |
| 操作 | - | 编辑 / 上架 / 暂停 / 结束 / 查看详情 |

**操作按钮**：
- 新建活动（打开 ProForm 抽屉）
- 批量上架/下架

**ProForm 创建/编辑表单**：
- 基本信息：活动名称、描述
- 触发条件：下拉选择触发类型 + 动态表单（根据类型显示不同配置项，如签到天数、消费阈值等）
- 发放方式：自动/用户领取/手动
- 抵扣规则：固定金额/百分比 + 金额/比例输入 + 最高抵扣 + 最低消费门槛
- 适用范围：品类多选、店铺多选（预留）
- 叠加设置：是否可叠加 + 叠加分组
- 发放限制：总量、每人限领、有效天数
- 活动时间：起止日期选择器

### 5.2 发放记录页（`/admin/coupons/campaigns/:id/instances`）

| 列 | 字段 | 说明 |
|----|------|------|
| 用户 | `userId` / 昵称 | 领取用户 |
| 发放时间 | `issuedAt` | - |
| 过期时间 | `expiresAt` | 即将过期标红 |
| 状态 | `status` | AVAILABLE/USED/EXPIRED/REVOKED |
| 使用订单 | `usedOrderId` | 可点击跳转 |
| 抵扣金额 | `usedAmount` | - |

**操作**：撤回（REVOKED）— 仅 AVAILABLE 状态可撤回

### 5.3 使用记录页（`/admin/coupons/usage`）

| 列 | 字段 | 说明 |
|----|------|------|
| 订单编号 | `orderId` | 可点击跳转 |
| 用户 | `userId` | - |
| 活动名称 | `campaignName` | - |
| 抵扣金额 | `discountAmount` | - |
| 使用时间 | `createdAt` | - |

### 5.4 红包统计页（`/admin/coupons/stats`）

**顶部 KPI 卡片**：
- 活动总数 / 进行中活动数
- 总发放量 / 总使用量
- 总抵扣金额
- 平均使用率

**图表区域**：
- 近 7 天发放/使用趋势柱状图
- 各活动使用率对比条形图
- 抵扣金额分布饼图（按触发类型）

### 5.5 菜单与权限

在管理后台侧边栏"红包管理"下新增：

```
红包管理
├── 红包活动          /admin/coupons/campaigns
├── 发放记录          /admin/coupons/instances
├── 使用记录          /admin/coupons/usage
└── 红包统计          /admin/coupons/stats
```

权限标识：
- `coupon:read` — 查看红包活动/记录/统计
- `coupon:manage` — 创建/编辑/上下架/手动发放/撤回

---

## 六、买家 App 改造

### 6.1 现有结算红包选择流程（已存在，需改造）

当前买家 App 已有完整的结算红包选择 UI 流程：

```
checkout.tsx [红包 按钮]
  → router.push('/checkout-redpack', { orderTotal, currentRedPackId })
    → checkout-redpack.tsx
      → BonusRepo.getAvailableRedPacks() → GET /bonus/redpacks/available
      → RedPackCard 组件（金额+来源+有效期+单选Radio）
      → 可用/不可用分组（按 minOrderAmount 过滤）
      → 确认选择 → router.replace('/checkout', { redPackId, redPackAmount })
  → checkout.tsx 接收参数，计算抵扣，提交订单时传 redPackId
```

**现有限制**：
- 仅支持**单选**（一次只能选一张）
- 数据类型 `RedPackItem` 仅支持固定金额，无百分比折扣
- 数据来源是分润奖励系统（`BonusRepo`）

### 6.2 结算红包选择改造（完整方案）

在现有 UI 基础上改造，复用 `checkout-redpack.tsx` 页面，改为支持平台红包多选 + 百分比折扣：

#### 6.2.1 数据源切换

| 改动 | 原来 | 改为 |
|------|------|------|
| API 调用 | `BonusRepo.getAvailableRedPacks()` | `CouponRepo.getCheckoutEligible(params)` |
| 后端路由 | `GET /bonus/redpacks/available` | `POST /coupons/checkout-eligible` |
| 数据类型 | `RedPackItem` | `CheckoutEligibleCoupon`（见下方） |
| 传参 | 无参数 | 传入 `orderAmount` + `categoryIds` + `companyIds` 用于精确过滤 |

#### 6.2.2 选择模式：单选 → 多选

| 改动 | 原来 | 改为 |
|------|------|------|
| 选择状态 | `selectedId: string \| null` | `selectedIds: Set<string>` |
| 选择交互 | Radio 单选切换 | Checkbox 多选 + 叠加规则校验 |
| 叠加校验 | 无 | 选中时检查 `stackable` 和 `stackGroup`，不允许的组合灰显提示 |
| 总抵扣显示 | 单张金额 | 实时累加所有选中红包的抵扣额 |
| 抵扣上限 | 无 | 总抵扣不超过商品金额（不含运费） |

#### 6.2.3 百分比折扣支持

| 抵扣类型 | 金额区显示 | 说明区显示 |
|----------|-----------|-----------|
| FIXED | `¥10` | "满100可用" 或 "无门槛" |
| PERCENT | `9折` 或 `8.5折` | "满200可用，最高减50" |

百分比折扣的 `estimatedDiscount` 由后端根据订单金额预计算返回。

#### 6.2.4 返回参数变更

| 改动 | 原来 | 改为 |
|------|------|------|
| 返回参数 | `redPackId: string` + `redPackAmount: string` | `couponIds: string`（JSON 数组序列化）+ `couponDiscount: string` |
| checkout.tsx 接收 | 解析单个 ID | 解析 ID 数组 |
| 提交订单 | `createCheckoutSession({ redPackId })` | `createCheckoutSession({ couponInstanceIds })` |

#### 6.2.5 checkout.tsx 改动

- 红包按钮文字保持"红包"（这是平台红包概念）
- 选中后显示"已选 N 张红包，-¥XX.XX"
- `previewOrder()` 传入 `couponInstanceIds` 替代 `redPackId`
- `createCheckoutSession()` 传入 `couponInstanceIds` 替代 `redPackId`
- 底部价格明细显示"红包抵扣 -¥XX.XX"

### 6.3 分润奖励页面重命名（UI 文字变更）

所有前端页面中涉及分润系统的"红包"字样改为"奖励"或"分润奖励"：

| 页面 | 原文字 | 新文字 |
|------|--------|--------|
| `app/me/wallet.tsx` | 红包钱包 | 奖励钱包 |
| `app/me/wallet.tsx` | VIP红包 / 普通红包 | VIP奖励 / 普通奖励 |
| `app/me/wallet.tsx` | VIP上级红包 +¥12.30 | VIP上级奖励 +¥12.30 |
| `app/me/rewards.tsx`（原 `redpacks.tsx`） | 我的红包 | 我的奖励 |
| `app/me/rewards.tsx` | VIP红包 / 普通红包 Tab | VIP奖励 / 普通奖励 Tab |
| `app/me/bonus-tree.tsx` | 我的红包树 | 我的分润树 |
| `app/me/bonus-tree.tsx` | 红包收取进度 | 奖励收取进度 |
| `app/me/bonus-tree.tsx` | 最近收到的红包 | 最近收到的奖励 |
| `app/me/vip.tsx` | 分润红包 | 分润奖励 |
| `app/(tabs)/me.tsx` | 红包树 | 分润树 |
| 通知/消息 | 红包到账 | 奖励到账 |

### 6.4 红包列表页改造（我的红包）

买家 App "我的"页面中现有的红包入口，后端 API 改为返回平台红包数据：

- Tab：可用 / 已使用 / 已过期
- API 改为调用 `CouponRepo.getMyCoupons(status)`
- 红包卡片展示：活动名称、抵扣规则描述、最低消费门槛、有效期倒计时
- 可用红包卡片可跳转到适用商品页（预留）

### 6.5 红包领取入口

- 首页/活动页展示可领取的红包活动
- 弹窗/Banner 提示（如新人红包、节日红包）
- 领取按钮调用 `CouponRepo.claimCoupon(campaignId)`
- 领取成功后动画提示 + 跳转到"我的红包"

### 6.6 新增 Repository

```typescript
// src/repos/CouponRepo.ts
class CouponRepo {
  // 查询可领取的红包活动
  getAvailableCampaigns(): Promise<Result<AvailableCampaignDto[]>>;

  // 领取红包
  claimCoupon(campaignId: string): Promise<Result<MyCouponDto>>;

  // 查询我的红包（分页 + 状态筛选）
  getMyCoupons(status?: CouponInstanceStatus): Promise<Result<PaginatedData<MyCouponDto>>>;

  // 查询结算可用红包（传入订单信息，返回符合条件的红包 + 预估抵扣额）
  getCheckoutEligible(params: CheckoutEligibleRequest): Promise<Result<CheckoutEligibleCoupon[]>>;
}
```

### 6.7 前端数据类型

```typescript
// src/types/domain/Coupon.ts

// 结算可用红包（后端预计算 estimatedDiscount）
interface CheckoutEligibleCoupon {
  id: string;                          // CouponInstance ID
  campaignName: string;                // 活动名称
  discountType: 'FIXED' | 'PERCENT';   // 抵扣类型
  discountValue: number;               // 金额（元）或折扣值（如 10 表示打 9 折）
  maxDiscountAmount: number | null;    // 百分比折扣时的最高抵扣额
  minOrderAmount: number;              // 最低消费门槛
  estimatedDiscount: number;           // 后端根据订单金额预计算的抵扣额
  eligible: boolean;                   // 是否满足使用条件
  ineligibleReason: string | null;     // 不满足原因
  stackable: boolean;                  // 是否可叠加
  stackGroup: string | null;           // 叠加分组
  expiresAt: string;                   // 过期时间
}

// 我的红包
interface MyCouponDto {
  id: string;
  campaignName: string;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  status: 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedOrderId: string | null;
  usedAmount: number | null;
}
```

---

## 七、自动发放引擎设计

### 7.1 事件驱动发放

| 触发事件 | 监听点 | 发放逻辑 |
|----------|--------|----------|
| 用户注册 | `AuthService.register()` 完成后 | 查找 REGISTER 类型活动，自动发放 |
| 首次下单 | `OrderService.createOrder()` 完成后 | 查找 FIRST_ORDER 类型活动，首单才发放 |
| 用户评价 | `ReviewService.createReview()` 完成后 | 查找 REVIEW 类型活动，发放 |
| 邀请注册 | `AuthService.register()` 有推荐人时 | 查找 INVITE 类型活动，发放给邀请人 |
| 签到达标 | `CheckInService.checkIn()` 连续天数达标 | 查找 CHECK_IN 类型活动，发放 |
| 累计消费 | `OrderService.confirmReceive()` 后统计 | 查找 CUMULATIVE_SPEND 类型活动，达标发放 |

### 7.2 定时任务

| 任务 | 频率 | 逻辑 |
|------|------|------|
| 生日红包发放 | 每天 0:00 | 查找当天/当月生日用户，发放 BIRTHDAY 活动红包 |
| 复购激励 | 每天 0:00 | 查找超过 N 天未下单的用户，发放 WIN_BACK 活动红包 |
| 红包过期 | 每小时 | 扫描 expiresAt < now() 且 status=AVAILABLE 的实例，改为 EXPIRED |
| 活动结束 | 每小时 | 扫描 endAt < now() 且 status=ACTIVE 的活动，改为 ENDED |

### 7.3 幂等与安全

- **幂等键**：`${campaignId}:${userId}:${triggerEvent}` 防止重复发放
- **限领检查**：发放前检查用户已领数量 < maxPerUser
- **库存检查**：发放前检查 issuedCount < totalQuota（CAS 操作）
- **事务隔离**：发放操作在 Serializable 隔离级别事务内执行
- **并发控制**：多个触发事件同时到达时，通过 CAS + P2034 重试保证一致性

---

## 八、实施步骤

### Phase A0：分润奖励系统代码标识符重命名（前置步骤）

> 将所有 `RedPack` / `redPack` / `RED_PACKET` 标识符改为 `Reward` / `reward` / `VIP_REWARD` / `NORMAL_REWARD`，消除与平台红包系统的命名混淆。

| 步骤 | 操作 | 文件 |
|------|------|------|
| A0.1 | Prisma 枚举值重命名：`RED_PACKET` → `VIP_REWARD`，`NORMAL_RED_PACKET` → `NORMAL_REWARD` | `backend/prisma/schema.prisma` |
| A0.2 | 数据库迁移（枚举值变更 + 已有数据迁移脚本） | `npx prisma migrate dev` |
| A0.3 | 后端代码全量替换：Service / Controller / DTO / 配置键 | `backend/src/modules/bonus/**` |
| A0.4 | 后端种子数据中的枚举值更新 | `backend/prisma/seed.ts` |
| A0.5 | RuleConfig 配置键重命名（`*_REDPACK_*` → `*_REWARD_*`） | `bonus-config.service.ts` + 种子数据 |
| A0.6 | 前端类型重命名：`RedPackItem` → `RewardItem`，`NormalRedPackItem` → `NormalRewardItem` | `src/types/domain/Bonus.ts` |
| A0.7 | 前端 BonusRepo 方法重命名 + 路由路径更新 | `src/repos/BonusRepo.ts` |
| A0.8 | 前端组件重命名：`RedPackCard` → `RewardCard`，`NormalRedPackCard` → `NormalRewardCard` | 相关组件文件 |
| A0.9 | 前端路由文件重命名：`redpacks.tsx` → `rewards.tsx`，移除 `checkout-redpack.tsx` | `app/me/` |
| A0.10 | 管理后台 API 层 + 页面中的 redpack 引用同步更新 | `admin/src/api/bonus.ts` + 相关页面 |
| A0.11 | 所有 MD 文档中 backtick 内的旧标识符引用更新 | 各 `.md` 文件 |
| A0.12 | TypeScript 编译 + Prisma validate 验证 | 全端 |

### Phase A：数据模型与基础设施（平台红包）

| 步骤 | 操作 | 文件 |
|------|------|------|
| A1 | Prisma Schema 新增 5 枚举 + 3 模型 | `backend/prisma/schema.prisma` |
| A2 | 修改 CheckoutSession 模型（移除旧 `rewardId` 字段，新增 `couponInstanceIds`） | 同上 |
| A3 | 修改 Order 模型（新增 `totalCouponDiscount`） | 同上 |
| A4 | 生成迁移 + 种子数据 | `npx prisma migrate dev` |
| A5 | 新增 TypeScript 类型定义 | `src/types/domain/Coupon.ts` |

### Phase B：后端红包模块

| 步骤 | 操作 | 文件 |
|------|------|------|
| B1 | 创建 CouponModule | `backend/src/modules/coupon/coupon.module.ts` |
| B2 | CouponService — CRUD + 发放 + 领取 + 过期 | `coupon.service.ts` |
| B3 | CouponController — 买家端 4 个 API | `coupon.controller.ts` |
| B4 | AdminCouponController — 管理端 10 个 API | `admin-coupon.controller.ts` |
| B5 | CouponEngineService — 自动发放引擎 + 定时任务 | `coupon-engine.service.ts` |
| B6 | 集成到 CheckoutService — 红包校验 + 锁定 + 释放 | 修改 `checkout.service.ts` |

### Phase C：管理后台页面

| 步骤 | 操作 | 文件 |
|------|------|------|
| C1 | 红包活动列表页（ProTable） | `admin/src/pages/coupons/campaigns.tsx` |
| C2 | 创建/编辑活动表单（ProForm 抽屉） | `admin/src/pages/coupons/campaign-form.tsx` |
| C3 | 发放记录页 | `admin/src/pages/coupons/instances.tsx` |
| C4 | 使用记录页 | `admin/src/pages/coupons/usage.tsx` |
| C5 | 红包统计页（KPI + 图表） | `admin/src/pages/coupons/stats.tsx` |
| C6 | API 层 + 类型定义 | `admin/src/api/coupon.ts` + `admin/src/types/index.ts` |
| C7 | 菜单 + 路由 + 权限注册 | `admin/src/routes.tsx` + `admin/src/constants/permissions.ts` |

### Phase D：结算流程改造

| 步骤 | 操作 | 文件 |
|------|------|------|
| D1 | CheckoutService 移除旧分润奖励抵扣逻辑（Phase A0 已重命名） | `backend/src/modules/order/checkout.service.ts` |
| D2 | CheckoutService 新增多红包校验 + CAS 锁定 + 释放 | 同上 |
| D3 | 支付回调中红包状态 RESERVED→USED + 创建 UsageRecord | `backend/src/modules/payment/payment.service.ts` |
| D4 | CheckoutSession 过期/取消释放红包 | `checkout.service.ts` |

### Phase E：买家 App UI

| 步骤 | 操作 | 文件 |
|------|------|------|
| E1 | 创建 CouponRepo | `src/repos/CouponRepo.ts` |
| E2 | 新增 Coupon 类型定义（`CheckoutEligibleCoupon` / `MyCouponDto` 等） | `src/types/domain/Coupon.ts` |
| E3 | 分润奖励页面 UI 文字重命名（红包→奖励） | `wallet.tsx` / `rewards.tsx` / `bonus-tree.tsx` / `vip.tsx` / `me.tsx` |
| E4 | 结算红包选择页改造：单选→多选 + 百分比折扣 + 叠加校验 + 数据源切换 | `app/checkout-redpack.tsx` |
| E5 | 结算页改造：接收多张红包参数 + 传 `couponInstanceIds` 给后端 | `app/checkout.tsx` |
| E6 | 红包列表页改造（"我的红包"展示平台红包） | 现有红包入口页，后端 API 改为 CouponRepo |
| E7 | 红包领取入口（首页/弹窗/活动页） | `app/(tabs)/home.tsx` 等 |

### Phase F：自动发放引擎

| 步骤 | 操作 | 文件 |
|------|------|------|
| F1 | 注册/首单/评价/签到等事件触发发放 | 各模块 Service 添加事件调用 |
| F2 | 生日/复购/过期 Cron 定时任务 | `coupon-engine.service.ts` |
| F3 | 幂等键 + CAS + Serializable 保护 | `coupon.service.ts` |

### Phase G：联调测试与文档更新

| 步骤 | 操作 |
|------|------|
| G1 | 全流程联调：创建活动 → 用户领取 → 结算抵扣 → 支付 → 过期 |
| G2 | 并发安全测试：多张红包同时锁定、过期与使用竞态 |
| G3 | 更新 `data-system.md`（新增模型）|
| G4 | 更新 `backend.md`（新增 API）|
| G5 | 更新 `frontend.md`（UI 变更）|
| G6 | 更新 `plan.md`（标记 Phase 完成状态）|
| G7 | 更新 `tofix-safe.md`（新增安全检查项）|

---

## 九、安全检查清单

| 检查项 | 说明 |
|--------|------|
| 红包锁定 CAS | AVAILABLE→RESERVED 必须在 Serializable 事务内使用 CAS，防止同一红包被多个订单锁定 |
| 总抵扣上限 | 红包总抵扣不得超过订单商品金额（不含运费），不能产生负数支付 |
| 库存扣减 CAS | 发放时 issuedCount 用 CAS 递增，防止超发 |
| 过期与使用竞态 | 过期 Cron 和用户使用可能同时操作同一红包，需 CAS 保护 |
| 领取防刷 | 限制领取频率 + maxPerUser 校验在事务内 |
| 金额精度 | 百分比折扣计算使用 Number(toFixed(2))，避免浮点误差 |
| 撤回安全 | 管理员撤回仅允许 AVAILABLE 状态，USED/RESERVED 不可撤回 |
| 活动修改限制 | ACTIVE 状态的活动只允许修改名称/描述/总量/时间，不允许修改核心规则 |

---

## 十、未来扩展（当前不做）

| 功能 | 说明 |
|------|------|
| 卖家自建红包 | 卖家在自己店铺创建红包/优惠券，数据隔离到 companyId |
| 红包组合包 | 多张红包打包成"大礼包"发放 |
| 拼手气红包 | 随机金额红包（总金额固定，每人领取金额随机） |
| 裂变红包 | 分享链接，好友打开可领取，传播链路追踪 |
| 跨店满减 | 跨多个店铺的满减活动 |
