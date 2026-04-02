# 统一退换货系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有独立的换货（Replacement）和退款（Refund）系统合并为统一售后入口，支持7天无理由退货、质量问题退货/换货，包含分润保护机制。

**Architecture:** 在现有 ReplacementRequest 模型上扩展为 AfterSaleRequest（@@map 重命名），新增 14 个状态的完整状态机。后端合并 3 对模块（buyer/seller/admin），前端 3 端同步改造。分润系统新增 RETURN_FROZEN 状态实现 7 天退货保护期。

**Tech Stack:** NestJS + Prisma + PostgreSQL（后端）、React Native + Expo（买家App）、React + Ant Design ProTable（卖家/管理后台）

**关键参考文档：**
- 设计方案：`docs/superpowers/specs/2026-03-30-unified-after-sale-design.md`
- 业务规则：`refund.md`（23 条规则）
- 测试方案：`docs/superpowers/specs/2026-03-30-unified-after-sale-test-plan.md`（63 个测试用例）

---

## Task 1: Schema 迁移 — 枚举与模型扩展

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/2026XXXX_unified_after_sale/migration.sql`（Prisma 自动生成）

- [ ] **Step 1: 新增 3 个枚举**

在 `schema.prisma` 中添加（放在现有 `ReplacementStatus` 枚举附近）：

```prisma
enum AfterSaleType {
  NO_REASON_RETURN
  QUALITY_RETURN
  QUALITY_EXCHANGE
}

enum AfterSaleStatus {
  REQUESTED
  UNDER_REVIEW
  APPROVED
  REJECTED
  PENDING_ARBITRATION
  RETURN_SHIPPING
  RECEIVED_BY_SELLER
  SELLER_REJECTED_RETURN
  REFUNDING
  REFUNDED
  REPLACEMENT_SHIPPED
  COMPLETED
  CLOSED
  CANCELED
}

enum ReturnPolicy {
  RETURNABLE
  NON_RETURNABLE
  INHERIT
}
```

- [ ] **Step 2: 扩展 RewardLedgerStatus 枚举**

在现有枚举中新增 `RETURN_FROZEN`：

```prisma
enum RewardLedgerStatus {
  FROZEN
  AVAILABLE
  WITHDRAWN
  VOIDED
  RESERVED
  RETURN_FROZEN
}
```

- [ ] **Step 3: 改造 ReplacementRequest → AfterSaleRequest**

将现有 `ReplacementRequest` 模型重命名并扩展。保留所有现有字段，新增退货相关字段。关键改动：

1. 模型名改为 `AfterSaleRequest`，添加 `@@map("after_sale_request")`
2. 现有 `status` 字段类型从 `ReplacementStatus` 改为 `AfterSaleStatus`
3. 新增字段参见设计文档 2.2 节的完整模型定义
4. 保留所有现有关系（order, user, orderItem, virtualCallBindings）
5. 新增索引 `@@index([status, createdAt])`

注意：同步更新 Order 模型中的关系名从 `replacementRequests` 改为 `afterSaleRequests`，OrderItem 同理。

- [ ] **Step 4: 扩展 Category、Product、User、Order 模型**

```prisma
// Category 新增
returnPolicy ReturnPolicy @default(INHERIT)

// Product 新增
returnPolicy ReturnPolicy @default(INHERIT)

// User 新增
hasAgreedReturnPolicy Boolean @default(false)

// Order 新增（检查 deliveredAt 是否已存在，如有则复用）
deliveredAt           DateTime?
returnWindowExpiresAt DateTime?
```

- [ ] **Step 5: 运行 Prisma 迁移**

```bash
cd backend && npx prisma migrate dev --name unified_after_sale
```

- [ ] **Step 6: 验证**

```bash
cd backend && npx prisma validate && npx tsc --noEmit
```

确保编译通过。如有因模型重命名导致的引用错误，在后续 Task 中逐步修复。

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/
git commit -m "feat(schema): add unified after-sale enums, rename ReplacementRequest to AfterSaleRequest, extend models"
```

---

## Task 2: 后端 — 共享工具函数

**Files:**
- Create: `backend/src/modules/after-sale/after-sale.utils.ts`
- Create: `backend/src/modules/after-sale/after-sale.constants.ts`

- [ ] **Step 1: 创建常量文件**

```typescript
// after-sale.constants.ts
export const AFTER_SALE_CONFIG_KEYS = {
  RETURN_WINDOW_DAYS: 'RETURN_WINDOW_DAYS',
  NORMAL_RETURN_DAYS: 'NORMAL_RETURN_DAYS',
  FRESH_RETURN_HOURS: 'FRESH_RETURN_HOURS',
  RETURN_NO_SHIP_THRESHOLD: 'RETURN_NO_SHIP_THRESHOLD',
  SELLER_REVIEW_TIMEOUT_DAYS: 'SELLER_REVIEW_TIMEOUT_DAYS',
  BUYER_SHIP_TIMEOUT_DAYS: 'BUYER_SHIP_TIMEOUT_DAYS',
  SELLER_RECEIVE_TIMEOUT_DAYS: 'SELLER_RECEIVE_TIMEOUT_DAYS',
  BUYER_CONFIRM_TIMEOUT_DAYS: 'BUYER_CONFIRM_TIMEOUT_DAYS',
} as const;

export const AFTER_SALE_CONFIG_DEFAULTS: Record<string, number> = {
  RETURN_WINDOW_DAYS: 7,
  NORMAL_RETURN_DAYS: 7,
  FRESH_RETURN_HOURS: 24,
  RETURN_NO_SHIP_THRESHOLD: 50,
  SELLER_REVIEW_TIMEOUT_DAYS: 3,
  BUYER_SHIP_TIMEOUT_DAYS: 7,
  SELLER_RECEIVE_TIMEOUT_DAYS: 7,
  BUYER_CONFIRM_TIMEOUT_DAYS: 7,
};

// 「进行中」状态集合（用于防重复申请、Cron 判断）
export const ACTIVE_STATUSES = [
  'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PENDING_ARBITRATION',
  'RETURN_SHIPPING', 'RECEIVED_BY_SELLER', 'SELLER_REJECTED_RETURN',
  'REFUNDING', 'REPLACEMENT_SHIPPED',
] as const;

// 「终态」状态集合
export const TERMINAL_STATUSES = [
  'REFUNDED', 'COMPLETED', 'CLOSED', 'CANCELED', 'REJECTED',
] as const;
```

- [ ] **Step 2: 创建工具函数文件**

```typescript
// after-sale.utils.ts
import { PrismaClient, ReturnPolicy } from '@prisma/client';

/**
 * 解析商品最终退货政策：商品级 → 分类级向上查找 → 兜底 RETURNABLE
 */
export async function resolveReturnPolicy(
  prisma: PrismaClient,
  productId: string,
): Promise<'RETURNABLE' | 'NON_RETURNABLE'> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { returnPolicy: true, categoryId: true },
  });
  if (!product) return 'RETURNABLE';
  if (product.returnPolicy !== 'INHERIT') {
    return product.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
  }
  // 向上查分类链
  if (!product.categoryId) return 'RETURNABLE';
  let categoryId: string | null = product.categoryId;
  while (categoryId) {
    const cat = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { returnPolicy: true, parentId: true },
    });
    if (!cat) break;
    if (cat.returnPolicy !== 'INHERIT') {
      return cat.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
    }
    categoryId = cat.parentId;
  }
  return 'RETURNABLE';
}

/**
 * 计算退款金额（含红包分摊）
 */
export function calculateRefundAmount(
  unitPrice: number,
  quantity: number,
  orderGoodsAmount: number,
  orderTotalCouponDiscount: number | null,
  orderShippingFee: number,
  afterSaleType: string,
  isFullRefund: boolean,
): number {
  const itemAmount = unitPrice * quantity;
  const couponShare = orderGoodsAmount > 0 && orderTotalCouponDiscount
    ? orderTotalCouponDiscount * (itemAmount / orderGoodsAmount)
    : 0;
  let refundAmount = itemAmount - couponShare;
  // 全部退货 + 质量问题 → 退运费
  if (isFullRefund && afterSaleType !== 'NO_REASON_RETURN') {
    refundAmount += orderShippingFee;
  }
  return Math.round(refundAmount * 100) / 100;
}

/**
 * 判断是否需要寄回
 */
export function requiresReturnShipping(
  afterSaleType: string,
  itemAmount: number,
  threshold: number,
): boolean {
  if (afterSaleType === 'NO_REASON_RETURN') return true; // 无理由一律寄回
  return itemAmount > threshold; // 质量问题按阈值
}

/**
 * 判断时间窗口是否有效
 */
export function isWithinReturnWindow(
  deliveredAt: Date | null,
  receivedAt: Date | null,
  returnPolicy: 'RETURNABLE' | 'NON_RETURNABLE',
  afterSaleType: string,
  returnWindowDays: number,
  normalReturnDays: number,
  freshReturnHours: number,
): boolean {
  const baseTime = deliveredAt || receivedAt;
  if (!baseTime) return false;
  const now = new Date();

  if (afterSaleType === 'NO_REASON_RETURN') {
    if (returnPolicy === 'NON_RETURNABLE') return false;
    const deadline = new Date(baseTime.getTime() + returnWindowDays * 24 * 60 * 60 * 1000);
    return now <= deadline;
  }
  // 质量问题
  if (returnPolicy === 'NON_RETURNABLE') {
    // 生鲜：按小时
    const deadline = new Date(baseTime.getTime() + freshReturnHours * 60 * 60 * 1000);
    return now <= deadline;
  }
  // 普通商品质量问题
  const deadline = new Date(baseTime.getTime() + normalReturnDays * 24 * 60 * 60 * 1000);
  return now <= deadline;
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/after-sale/
git commit -m "feat(after-sale): add shared constants and utility functions"
```

---

## Task 3: 后端 — 买家端售后 DTO + Service + Controller + Module

**Files:**
- Create: `backend/src/modules/after-sale/dto/create-after-sale.dto.ts`
- Create: `backend/src/modules/after-sale/dto/return-shipping.dto.ts`
- Create: `backend/src/modules/after-sale/after-sale.service.ts`
- Create: `backend/src/modules/after-sale/after-sale.controller.ts`
- Create: `backend/src/modules/after-sale/after-sale.module.ts`

- [ ] **Step 1: 创建 DTO**

`create-after-sale.dto.ts` — 参见设计文档 3.2 节 apply() 入参：orderItemId, afterSaleType, reasonType?, reason?, photos[]。使用 class-validator 装饰器。afterSaleType 为质量问题时 reasonType 必填。photos 数组 min 1 max 10，每项为 http/https URL。

`return-shipping.dto.ts` — returnCarrierName (必填, max 50), returnWaybillNo (必填, max 50)。

- [ ] **Step 2: 创建 after-sale.service.ts**

实现设计文档 3.2 节的全部方法：
- `apply()` — 11 步校验流程 + Serializable 事务 + P2034 重试。调用 `resolveReturnPolicy()`、`isWithinReturnWindow()`、`calculateRefundAmount()`、`requiresReturnShipping()`。
- `cancel()` — 检查状态 REQUESTED/UNDER_REVIEW → CANCELED
- `fillReturnShipping()` — 检查状态 APPROVED + requiresReturn → RETURN_SHIPPING
- `confirmReceive()` — 检查状态 REPLACEMENT_SHIPPED → COMPLETED，触发奖励归平台
- `escalate()` — 检查状态 REJECTED/SELLER_REJECTED_RETURN → PENDING_ARBITRATION
- `acceptClose()` — 检查状态 REJECTED/SELLER_REJECTED_RETURN → CLOSED
- `list()` — 分页查询用户的售后申请
- `findById()` — 查询单个售后详情（校验所有权）
- `agreePolicy()` — 更新 user.hasAgreedReturnPolicy = true

关键：所有状态转换使用 `prisma.$transaction` Serializable 隔离级别 + `updateMany` CAS 模式（where 条件包含当前状态）。

读取配置值通过 `prisma.ruleConfig.findUnique({ where: { key } })` 并提供默认值兜底。

售后成功（REFUNDED/COMPLETED）时调用奖励归平台逻辑（Task 6 实现，此处先预留方法调用）。

- [ ] **Step 3: 创建 after-sale.controller.ts**

路由前缀 `/after-sale`，使用全局买家 Guard（不需要 `@Public()`）：
- `POST /after-sale/orders/:orderId` → apply()
- `GET /after-sale` → list()
- `GET /after-sale/:id` → findById()
- `POST /after-sale/:id/cancel` → cancel()
- `POST /after-sale/:id/return-shipping` → fillReturnShipping()
- `POST /after-sale/:id/confirm` → confirmReceive()
- `POST /after-sale/:id/escalate` → escalate()
- `POST /after-sale/:id/accept-close` → acceptClose()
- `GET /after-sale/return-policy` → 返回退换货协议文本
- `POST /after-sale/agree-policy` → agreePolicy()

- [ ] **Step 4: 创建 after-sale.module.ts**

导入 PrismaModule。导出 AfterSaleService（供 Order 模块和其他模块引用）。

- [ ] **Step 5: 在 AppModule 中注册**

在 `backend/src/app.module.ts` 中 imports 数组添加 `AfterSaleModule`。

- [ ] **Step 6: 编译验证**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/after-sale/ backend/src/app.module.ts
git commit -m "feat(after-sale): add buyer-facing after-sale service with full state machine"
```

---

## Task 4: 后端 — 卖家端售后 Service + Controller + Module

**Files:**
- Create: `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`
- Create: `backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`
- Create: `backend/src/modules/seller/after-sale/seller-after-sale.module.ts`
- Create: `backend/src/modules/seller/after-sale/dto/seller-after-sale.dto.ts`

- [ ] **Step 1: 创建 DTO**

- `ApproveDto` — note?: string (max 500)
- `RejectDto` — reason: string (必填, max 500)
- `RejectReturnDto` — reason: string, photos: string[], returnWaybillNo: string
- `ShipDto` — (空，或 carrierCode 用于面单)
- `GenerateWaybillDto` — carrierCode: string (max 16)

- [ ] **Step 2: 创建 seller-after-sale.service.ts**

实现设计文档 3.3 节。所有写方法先调用 `assertCompanyOwnsRequest(companyId, afterSaleId)` 校验数据隔离（沿用现有 seller-replacements.service.ts 的模式）。

方法列表：findAll, findById, startReview, approve, reject, confirmReceiveReturn, rejectReturn, ship, generateWaybill, cancelWaybill。

角色限制在 Controller 层通过 `@UseGuards(SellerAuthGuard, SellerRoleGuard)` + `@Roles('OWNER', 'MANAGER')` 实现（只读方法不加角色限制）。

`approve()` 中：如果 requiresReturn=false 且 afterSaleType 是退货，自动触发退款（调用 PaymentService.initiateRefund，创建 Refund 记录）。

`confirmReceiveReturn()` 中：如果 afterSaleType 是退货，自动触发退款。

- [ ] **Step 3: 创建 Controller 和 Module**

路由前缀 `/seller/after-sale`，使用 `@Public()` + `@UseGuards(SellerAuthGuard)` 模式（与现有 seller 模块一致）。

Module 导入 PrismaModule、SellerShippingModule（面单功能）。注册到 SellerModule。

- [ ] **Step 4: 编译验证 + Commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/seller/after-sale/
git commit -m "feat(seller-after-sale): add seller after-sale management service"
```

---

## Task 5: 后端 — 管理端售后 Service + Controller + Module

**Files:**
- Create: `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- Create: `backend/src/modules/admin/after-sale/admin-after-sale.controller.ts`
- Create: `backend/src/modules/admin/after-sale/admin-after-sale.module.ts`
- Create: `backend/src/modules/admin/after-sale/dto/arbitrate-after-sale.dto.ts`

- [ ] **Step 1: 创建 DTO**

`ArbitrateAfterSaleDto` — status: 'APPROVED' | 'REJECTED' (必填), reason?: string (max 500)

- [ ] **Step 2: 创建 admin-after-sale.service.ts**

实现设计文档 3.4 节。

`arbitrate()` — 核心仲裁逻辑：
1. 检查当前状态在可仲裁集合内（PENDING_ARBITRATION, REQUESTED, UNDER_REVIEW）
2. 记录 arbitrationSource = 当前状态
3. 仲裁 REJECTED → 状态改为 REJECTED
4. 仲裁 APPROVED：
   - 来源 PENDING_ARBITRATION 且 arbitrationSource=REJECTED → 按 APPROVED 正常流程
   - 来源 PENDING_ARBITRATION 且 arbitrationSource=SELLER_REJECTED_RETURN → 退货直接退款(→REFUNDING)，换货等待卖家发货(→APPROVED)
   - 其他来源 → 按 APPROVED 正常流程

`getStats()` — 按 afterSaleType + status 分组 COUNT

`findAll()` — 分页列表，支持按 status/afterSaleType/companyId/keyword 筛选

`findById()` — 完整详情含订单/用户/商家信息

- [ ] **Step 3: 创建 Controller 和 Module**

路由前缀 `/admin/after-sale`，使用 `@Public()` + `@UseGuards(AdminAuthGuard, PermissionGuard)` 模式。
- findAll/findById/getStats: `@Permission('after-sale:read')`
- arbitrate: `@Permission('after-sale:arbitrate')` + `@AuditLog()`

注册到 AdminModule。

- [ ] **Step 4: 编译验证 + Commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/admin/after-sale/
git commit -m "feat(admin-after-sale): add admin after-sale arbitration service"
```

---

## Task 6: 后端 — 分润奖励系统改造

**Files:**
- Modify: `backend/src/modules/bonus/engine/normal-upstream.service.ts`
- Modify: `backend/src/modules/bonus/engine/vip-upstream.service.ts`
- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.ts`
- Modify: `backend/src/modules/bonus/engine/constants.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Create: `backend/src/modules/after-sale/after-sale-reward.service.ts`

- [ ] **Step 1: 更新 constants.ts**

新增常量：
```typescript
export const RETURN_FREEZE_STATUS = 'RETURN_FROZEN';
```

- [ ] **Step 2: 修改 normal-upstream.service.ts 和 vip-upstream.service.ts**

在创建 RewardLedger 记录时，将 `status: 'FROZEN'` 改为 `status: 'RETURN_FROZEN'`。搜索所有 `prisma.rewardLedger.create` 调用中 `status: 'FROZEN'` 的位置，改为 `RETURN_FROZEN`。

注意：只修改**新发放的奖励**的初始状态，不影响 RELEASE/WITHDRAW 等其他操作。

- [ ] **Step 3: 修改 freeze-expire.service.ts**

在现有 `handleFreezeExpire()` Cron 方法中新增 RETURN_FROZEN 解冻逻辑：

```typescript
// 新增：退货保护期解冻
const returnFrozenLedgers = await this.prisma.rewardLedger.findMany({
  where: { status: 'RETURN_FROZEN', entryType: 'FREEZE' },
  take: BATCH_SIZE,
  include: { allocation: { include: { order: true } } },
});

for (const ledger of returnFrozenLedgers) {
  const order = ledger.allocation?.order;
  if (!order?.returnWindowExpiresAt) continue;
  if (order.returnWindowExpiresAt > new Date()) continue; // 窗口未过期

  // 检查是否有进行中的售后
  const activeAfterSale = await this.prisma.afterSaleRequest.findFirst({
    where: {
      orderId: order.id,
      status: { in: ACTIVE_STATUSES },
    },
  });
  if (activeAfterSale) continue; // 有进行中售后，保持 RETURN_FROZEN

  // 安全转为 FROZEN
  await this.prisma.$transaction(async (tx) => {
    await tx.rewardLedger.updateMany({
      where: { id: ledger.id, status: 'RETURN_FROZEN' },
      data: { status: 'FROZEN' },
    });
  }, { isolationLevel: 'Serializable' });
}
```

- [ ] **Step 4: 创建 after-sale-reward.service.ts**

售后成功时的奖励归平台逻辑：

```typescript
async voidRewardsForOrder(orderId: string): Promise<void> {
  // 1. 查找该订单所有 RETURN_FROZEN 奖励
  const ledgers = await this.prisma.rewardLedger.findMany({
    where: {
      allocation: { orderId },
      status: { in: ['RETURN_FROZEN', 'FROZEN', 'AVAILABLE'] },
      entryType: 'FREEZE',
    },
  });

  if (ledgers.length === 0) return;

  // 兜底告警：如果有 FROZEN/AVAILABLE（不应该出现）
  const unexpected = ledgers.filter(l => l.status !== 'RETURN_FROZEN');
  if (unexpected.length > 0) {
    this.logger.warn(`数据纠偏：订单 ${orderId} 有 ${unexpected.length} 条非 RETURN_FROZEN 奖励被回收`);
  }

  await this.prisma.$transaction(async (tx) => {
    for (const ledger of ledgers) {
      // CAS：只处理仍在目标状态的记录
      const updated = await tx.rewardLedger.updateMany({
        where: { id: ledger.id, status: ledger.status },
        data: { status: 'VOIDED' },
      });
      if (updated.count === 0) continue;

      // 创建 VOID 条目（审计留痕）
      await tx.rewardLedger.create({
        data: {
          accountId: ledger.accountId,
          userId: PLATFORM_USER_ID,  // 收益方改为平台
          entryType: 'VOID',
          amount: ledger.amount,
          status: 'VOIDED',
          refType: 'AFTER_SALE',
          refId: orderId,
          meta: { originalUserId: ledger.userId, reason: '售后成功，奖励归平台' },
        },
      });
    }
  }, { isolationLevel: 'Serializable' });
}
```

- [ ] **Step 5: 修改 bonus.service.ts**

在钱包余额查询中排除 RETURN_FROZEN。搜索查询 RewardLedger 余额的位置，将 `status: { in: ['FROZEN', 'AVAILABLE'] }` 等条件确认不包含 `RETURN_FROZEN`。

- [ ] **Step 6: 编译验证 + Commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/bonus/ backend/src/modules/after-sale/after-sale-reward.service.ts
git commit -m "feat(bonus): add RETURN_FROZEN state, 7-day return protection freeze, reward-to-platform on after-sale success"
```

---

## Task 7: 后端 — 订单模块改造

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order.controller.ts`

- [ ] **Step 1: 修改 order.service.ts**

1. **DELIVERED 状态转换时**：设置 `deliveredAt = now`，`returnWindowExpiresAt = now + RETURN_WINDOW_DAYS天`
2. **confirmReceive() 中**：如果 `deliveredAt` 仍为 null，兜底设置 `deliveredAt = receivedAt`，`returnWindowExpiresAt = receivedAt + RETURN_WINDOW_DAYS天`
3. **confirmReceive() 中**：奖励发放后的状态已在 Task 6 中改为 RETURN_FROZEN（无需此处改动，因为是 upstream service 的行为）
4. **list() / mapOrder()**：售后状态映射从查 AfterSaleRequest 取（替换原来分别查 Refund + ReplacementRequest 的逻辑）。返回 `returnWindowExpiresAt`、商品 `returnPolicy` 信息。
5. **getStatusCounts()**：售后中计数从 AfterSaleRequest 的 ACTIVE_STATUSES 取。
6. **全部退货检测**：在售后退款完成后（Task 3 的 service 中回调），检查该订单是否所有 OrderItem 都已退款。如是，更新订单状态 → REFUNDED。

- [ ] **Step 2: 修改 order.controller.ts**

将 `POST /orders/:id/after-sale` 路由改为转发到 `AfterSaleService.apply()`（或标记 deprecated，新路由在 AfterSaleController）。
将 `POST /orders/:id/replacement/confirm` 改为转发到 `AfterSaleService.confirmReceive()`。

- [ ] **Step 3: 编译验证 + Commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/order/
git commit -m "feat(order): integrate after-sale with order lifecycle, add return window tracking"
```

---

## Task 8: 后端 — 超时 Cron + 配置种子

**Files:**
- Create: `backend/src/modules/after-sale/after-sale-timeout.service.ts`
- Modify: `backend/prisma/seed.ts`（或对应的种子文件）

- [ ] **Step 1: 创建 after-sale-timeout.service.ts**

```typescript
@Injectable()
export class AfterSaleTimeoutService {
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleTimeouts() {
    await this.handleSellerReviewTimeout();
    await this.handleBuyerShipTimeout();
    await this.handleSellerReceiveTimeout();
    await this.handleBuyerConfirmTimeout();
  }
  // 四个超时方法，参见设计文档第八章
  // 每个方法：查询超时记录 → Serializable 事务 + CAS 更新
}
```

实现设计文档第八章的 4 个超时场景。每个方法读取对应的配置值（带默认值兜底），批量查询超时记录（BATCH_SIZE=100），逐条在 Serializable 事务中 CAS 更新。

卖家验收超时自动通过后，根据 afterSaleType 决定后续：退货 → 自动触发退款；换货 → 等待卖家发货。

- [ ] **Step 2: 注册到 AfterSaleModule**

在 `after-sale.module.ts` 的 providers 中添加 `AfterSaleTimeoutService`。

- [ ] **Step 3: 种子数据 — 插入默认配置**

在种子文件中 upsert 8 个配置项到 RuleConfig 表（使用 AFTER_SALE_CONFIG_DEFAULTS 的值）。

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/after-sale/ backend/prisma/
git commit -m "feat(after-sale): add timeout cron service and seed default config values"
```

---

## Task 9: 后端 — 清理旧模块引用

**Files:**
- Modify: `backend/src/modules/replacement/` (标记 deprecated 或删除)
- Modify: `backend/src/modules/admin/replacements/` (标记 deprecated 或删除)
- Modify: `backend/src/modules/seller/replacements/` (标记 deprecated 或删除)
- Modify: `backend/src/modules/admin/refunds/` (标记 deprecated 或删除)
- Modify: `backend/src/modules/seller/refunds/` (标记 deprecated 或删除)
- Modify: 所有引用旧模块的 import 语句

- [ ] **Step 1: 更新 AppModule / SellerModule / AdminModule 的 imports**

移除旧的 ReplacementModule、AdminReplacementsModule、SellerReplacementsModule、AdminRefundsModule、SellerRefundsModule。替换为新的 AfterSaleModule、AdminAfterSaleModule、SellerAfterSaleModule。

- [ ] **Step 2: 处理旧模块文件**

为旧模块的 Controller 添加 `@Deprecated()` 注释和重定向说明，或直接删除（如果确认无其他地方引用）。保留旧文件作为参考直到前端全部迁移完成也可以。

建议：v1 先保留旧路由做 302 重定向，避免前端升级期间断裂。

- [ ] **Step 3: 全量编译验证**

```bash
cd backend && npx tsc --noEmit
```

修复所有 import/类型引用错误。

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "refactor(backend): deprecate old replacement/refund modules, wire up unified after-sale modules"
```

---

## Task 10: 买家 App — 类型 + Repo + 常量

**Files:**
- Modify: `src/types/domain/Order.ts`
- Create: `src/repos/AfterSaleRepo.ts`
- Modify: `src/constants/statuses.ts`
- Modify: `src/repos/index.ts`

- [ ] **Step 1: 更新 Order.ts 类型定义**

新增类型：
```typescript
export type AfterSaleType = 'NO_REASON_RETURN' | 'QUALITY_RETURN' | 'QUALITY_EXCHANGE';

export type AfterSaleStatus =
  | 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
  | 'PENDING_ARBITRATION' | 'RETURN_SHIPPING' | 'RECEIVED_BY_SELLER'
  | 'SELLER_REJECTED_RETURN' | 'REFUNDING' | 'REFUNDED'
  | 'REPLACEMENT_SHIPPED' | 'COMPLETED' | 'CLOSED' | 'CANCELED';

export type AfterSaleRequest = {
  id: string;
  orderId: string;
  orderItemId: string;
  afterSaleType: AfterSaleType;
  reasonType?: string;
  reason?: string;
  photos: string[];
  status: AfterSaleStatus;
  requiresReturn: boolean;
  refundAmount?: number;
  isPostReplacement: boolean;
  returnCarrierName?: string;
  returnWaybillNo?: string;
  sellerRejectReason?: string;
  sellerRejectPhotos?: string[];
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  order?: Pick<Order, 'id' | 'status' | 'totalAmount'>;
  orderItem?: { id: string; unitPrice: number; quantity: number; productSnapshot?: any };
};
```

在 Order 类型中新增：`returnWindowExpiresAt?: string`、`returnPolicy?: 'RETURNABLE' | 'NON_RETURNABLE'`。

- [ ] **Step 2: 创建 AfterSaleRepo.ts**

```typescript
export const AfterSaleRepo = {
  apply: (orderId: string, dto: CreateAfterSaleDto) =>
    http.post<AfterSaleRequest>(`/after-sale/orders/${orderId}`, dto),
  list: (page = 1, pageSize = 20) =>
    http.get<PaginationResult<AfterSaleRequest>>('/after-sale', { params: { page, pageSize } }),
  getById: (id: string) =>
    http.get<AfterSaleRequest>(`/after-sale/${id}`),
  cancel: (id: string) =>
    http.post(`/after-sale/${id}/cancel`),
  fillReturnShipping: (id: string, dto: { returnCarrierName: string; returnWaybillNo: string }) =>
    http.post(`/after-sale/${id}/return-shipping`, dto),
  confirmReceive: (id: string) =>
    http.post(`/after-sale/${id}/confirm`),
  escalate: (id: string) =>
    http.post(`/after-sale/${id}/escalate`),
  acceptClose: (id: string) =>
    http.post(`/after-sale/${id}/accept-close`),
  getReturnPolicy: () =>
    http.get<{ content: string }>('/after-sale/return-policy'),
  agreePolicy: () =>
    http.post('/after-sale/agree-policy'),
};
```

- [ ] **Step 3: 更新 statuses.ts**

新增 afterSaleStatus 中文映射（14 个状态）和 afterSaleType 映射（3 种类型）。

- [ ] **Step 4: Commit**

```bash
git add src/types/ src/repos/ src/constants/
git commit -m "feat(app): add AfterSale types, repo, and status constants"
```

---

## Task 11: 买家 App — 售后申请表单页重写

**Files:**
- Modify: `app/orders/after-sale/[id].tsx`

- [ ] **Step 1: 重写售后表单**

基于现有页面结构（保留 photo upload、reason chips 等 UI 模式），改造为：

1. **Step 1 区域**：选择单个 OrderItem（radio 单选，非 checkbox）。过滤掉 isPrize=true 的商品。
2. **Step 2 区域**：售后类型选择。根据商品 returnPolicy + 时间窗口动态展示可选类型。调用后端或本地计算判断哪些类型可用。
3. **Step 3 区域**：照片上传（沿用现有逻辑）
4. **Step 4 区域**：原因选择（仅质量问题时显示）+ 补充说明
5. **Step 5 区域**：确认提交，展示退款金额预估 + 是否需要寄回 + 运费说明

提交调用 `AfterSaleRepo.apply()`，成功后 invalidate queries，跳转到售后详情页。

调用 `/ui-ux-pro-max` 获取设计指导。

- [ ] **Step 2: Commit**

```bash
git add app/orders/after-sale/
git commit -m "feat(app): rewrite after-sale application form with unified return/exchange flow"
```

---

## Task 12: 买家 App — 售后列表 + 详情页

**Files:**
- Create: `app/orders/after-sale/index.tsx`
- Create: `app/orders/after-sale/detail/[id].tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `app/orders/index.tsx`

- [ ] **Step 1: 创建售后列表页**

使用 `<Screen>` + FlatList 实现。调用 `AfterSaleRepo.list()`。每项显示：售后类型标签 + 商品名 + 金额 + 状态 + 创建时间。点击跳转详情页。

- [ ] **Step 2: 创建售后详情页**

参见设计文档 9.3 节的 14 个状态展示规则。根据 status 动态渲染：
- 操作按钮（撤销/填物流/确认收货/升级仲裁/接受关闭）
- 进度时间线
- 商品信息 + 照片 + 退款金额
- 卖家验收不通过时展示拒绝原因和举证照片

调用 `/ui-ux-pro-max` 获取设计指导。

- [ ] **Step 3: 修改订单详情页**

在 `app/orders/[id].tsx` 中：
- 替换现有 VIP_PACKAGE 检查逻辑为统一的售后入口
- 根据 returnPolicy 显示小字提示
- 售后进行中显示状态 + 跳转链接
- "申请售后"按钮条件：订单在 DELIVERED/RECEIVED + 窗口期内 + 非 VIP

- [ ] **Step 4: 修改订单列表页**

在 `app/orders/index.tsx` 中统一售后状态筛选（从 AfterSaleRequest 取状态）。

- [ ] **Step 5: Commit**

```bash
git add app/orders/
git commit -m "feat(app): add after-sale list and detail pages, update order detail with return policy"
```

---

## Task 13: 买家 App — 结账协议 + 商品详情提示

**Files:**
- Modify: 结账相关页面（`app/checkout-*.tsx` 或对应文件）
- Modify: 商品详情页（`app/category/` 或对应文件）

- [ ] **Step 1: 结账页协议弹窗**

在结账流程中：
1. 查询用户 `hasAgreedReturnPolicy`（可从 me 接口返回）
2. 如果 false，弹出 Modal 展示退换货协议内容（从 `AfterSaleRepo.getReturnPolicy()` 获取或本地静态文本）
3. 用户勾选确认 → 调用 `AfterSaleRepo.agreePolicy()`
4. 成功后继续结账流程

- [ ] **Step 2: 商品详情页小字提示**

根据商品的 returnPolicy（从商品详情 API 返回）显示小字：
- RETURNABLE: 「支持7天无理由退换」
- NON_RETURNABLE: 「签收后24小时内如有质量问题可申请售后」
- VIP/奖品: 「不支持退换」

- [ ] **Step 3: Commit**

```bash
git add app/
git commit -m "feat(app): add return policy agreement on checkout, product detail return policy hint"
```

---

## Task 14: 卖家后台 — 前端改造

**Files:**
- Create: `seller/src/pages/after-sale/index.tsx`
- Create: `seller/src/pages/after-sale/detail.tsx`
- Create: `seller/src/api/after-sale.ts`
- Modify: `seller/src/layouts/SellerLayout.tsx`
- Modify: `seller/src/constants/statusMaps.ts`
- Modify: `seller/src/pages/products/index.tsx`

- [ ] **Step 1: 创建 API 层**

`seller/src/api/after-sale.ts` — 对接全部卖家端 API 路由。沿用现有 `client.ts` 的 axios 实例。

- [ ] **Step 2: 更新 statusMaps.ts**

新增 `afterSaleStatusMap`（14 状态）、`afterSaleTypeMap`（3 类型）。沿用现有配色规范。

- [ ] **Step 3: 创建列表页**

`seller/src/pages/after-sale/index.tsx` — ProTable，Tab 筛选（全部/待审核/待验收/待发货/已完成），售后类型筛选。操作列按状态渲染按钮。参考现有 `seller/src/pages/replacements/index.tsx` 的 ProTable 模式。

- [ ] **Step 4: 创建详情页**

`seller/src/pages/after-sale/detail.tsx` — 参考现有 detail.tsx。按状态展示不同操作区。新增：验收通过/不通过区域（填原因+上传照片+寄回单号）。

- [ ] **Step 5: 修改菜单**

`SellerLayout.tsx` 中将"换货管理"改为"售后管理"，路由指向 `/after-sale`。移除隐藏的"退款记录"菜单项。

- [ ] **Step 6: 商品编辑页新增退货政策下拉**

在 `seller/src/pages/products/index.tsx` 的商品编辑区域新增下拉：
- 跟随分类（当前：XXX）— 默认
- 支持7天无理由退货
- 不支持7天无理由退货

需要从后端获取当前分类的 returnPolicy 值来动态显示。

- [ ] **Step 7: 路由配置**

在 `seller/src/App.tsx` 中注册新路由 `/after-sale` 和 `/after-sale/:id`。

- [ ] **Step 8: Commit**

```bash
git add seller/
git commit -m "feat(seller): unified after-sale management page, product return policy editor"
```

---

## Task 15: 管理后台 — 前端改造

**Files:**
- Create: `admin/src/pages/after-sale/index.tsx`
- Create: `admin/src/api/after-sale.ts`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `admin/src/constants/statusMaps.ts`
- Modify: `admin/src/pages/categories/index.tsx`
- Modify: `admin/src/pages/products/index.tsx`

- [ ] **Step 1: 创建 API 层**

`admin/src/api/after-sale.ts` — 对接全部管理端 API 路由。

- [ ] **Step 2: 更新 statusMaps.ts**

新增统一的 `afterSaleStatusMap`（14 状态）和 `afterSaleTypeMap`（3 类型），替换原有分散的 replacementStatusMap 和 refundStatusMap。

- [ ] **Step 3: 创建售后仲裁页**

`admin/src/pages/after-sale/index.tsx` — 合并原换货仲裁 + 退款仲裁页。包含：
- 顶部统计面板（按类型+状态分组）
- ProTable 列表，Tab 筛选
- 仲裁弹窗（保留模板功能，参考现有 admin/src/pages/replacements/index.tsx 的 ARBITRATION_TEMPLATES 模式，新增退货退款模板）
- SELLER_REJECTED_RETURN 状态展示双方举证

- [ ] **Step 4: 修改菜单**

`AdminLayout.tsx` 中将"换货仲裁"+"退款仲裁"合并为"售后仲裁"，路由 `/after-sale`。

- [ ] **Step 5: 分类管理新增退货政策**

在 `admin/src/pages/categories/index.tsx` 中：
- 列表新增「退货政策」列
- 编辑弹窗新增下拉：支持退货 / 不支持退货 / 继承父分类

- [ ] **Step 6: 商品列表展示退货政策**

在 `admin/src/pages/products/index.tsx` 中新增只读的「退货政策」列。

- [ ] **Step 7: 系统配置页新增售后配置**

在现有系统配置页面中新增「售后配置」分区，管理 8 个配置项。使用现有 AdminConfigService 的 API 模式。

- [ ] **Step 8: 路由配置 + Commit**

```bash
git add admin/
git commit -m "feat(admin): unified after-sale arbitration page, category return policy, system config"
```

---

## Task 16: 集成验证 — 编译 + 基础流程测试

**Files:** 无新增，验证全栈

- [ ] **Step 1: 后端全量编译**

```bash
cd backend && npx prisma validate && npx tsc --noEmit
```

- [ ] **Step 2: 后端启动测试**

```bash
cd backend && npm run start:dev
```

确认无启动错误，所有模块正确注册。

- [ ] **Step 3: 前端编译验证**

```bash
cd seller && npx tsc --noEmit
cd admin && npx tsc --noEmit
```

- [ ] **Step 4: 基础 API 测试**

使用 curl 或 Postman 测试核心 API：
- POST /after-sale/orders/:orderId（提交售后）
- GET /after-sale（列表）
- POST /seller/after-sale/:id/approve（卖家同意）
- POST /admin/after-sale/:id/arbitrate（管理员仲裁）

- [ ] **Step 5: Commit 最终修复**

```bash
git add .
git commit -m "fix: resolve integration issues across unified after-sale system"
```

---

## Task 17: 测试执行 — 按测试方案逐项验证

**Files:**
- Reference: `docs/superpowers/specs/2026-03-30-unified-after-sale-test-plan.md`

- [ ] **Step 1: P0 测试（21 个用例）**

执行 T-INT-01~08（核心流程）、T-INT-14~18（奖励）、T-INT-19~22（并发）、T-INT-27~29（并行/仲裁约束）。所有 P0 必须通过。

- [ ] **Step 2: P1 测试（13 个用例）**

执行 T-INT-09~13（仲裁+超时）、T-INT-23~26（撤销+关闭）、T-EDGE-01~04（边界）。

- [ ] **Step 3: P2 测试（7 个用例）**

执行 T-UNIT-01~04（单元测试）、T-API-01~03（权限校验）。

- [ ] **Step 4: P3 端到端（6 个用例）**

执行 T-E2E-01~06（全链路）。

- [ ] **Step 5: P4 前端 + 回归（15 项）**

执行 T-FE-01~03（三端手动验证）、REG-01~12（回归测试）。

- [ ] **Step 6: 修复发现的问题并 Commit**

```bash
git add .
git commit -m "fix: resolve issues found during test execution"
```

---

## 任务依赖关系

```
Task 1 (Schema)
  ↓
Task 2 (Utils)
  ↓
Task 3 (Buyer Service) ──→ Task 7 (Order Module)
  ↓                              ↓
Task 4 (Seller Service)    Task 8 (Cron + Config)
  ↓                              ↓
Task 5 (Admin Service)     Task 6 (Reward System)
  ↓                              ↓
Task 9 (Cleanup) ←────────────────┘
  ↓
Task 10 (App Types) → Task 11 (App Form) → Task 12 (App Pages) → Task 13 (App Checkout)
  ↓
Task 14 (Seller FE)
  ↓
Task 15 (Admin FE)
  ↓
Task 16 (Integration Verify)
  ↓
Task 17 (Test Execution)
```

**可并行的任务组：**
- Task 3 + Task 6 + Task 8（后端不同模块，无文件冲突）
- Task 4 + Task 5（卖家/管理端独立）
- Task 11 + Task 14 + Task 15（三端前端独立）

---

## 预估工作量

| Phase | Tasks | 说明 |
|-------|-------|------|
| Phase A: Schema + 工具 | Task 1-2 | 基础设施 |
| Phase B: 后端核心 | Task 3-8 | 6 个后端模块 |
| Phase C: 后端清理 | Task 9 | 旧模块处理 |
| Phase D: 前端三端 | Task 10-15 | 买家App + 卖家 + 管理 |
| Phase E: 验证测试 | Task 16-17 | 63 个测试用例 |
