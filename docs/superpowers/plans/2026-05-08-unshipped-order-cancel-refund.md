# PAID 未发货取消退款收尾 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已写入代码的 PAID 未发货取消退款链路补齐为可上线能力，覆盖买家 App、卖家中心、管理后台、资金退款、红包/奖励恢复、分润隔离、文档与真机验证。

**Architecture:** 订单取消仍采用方案 A：`Order.status = CANCELED` 表示买家未发货撤单，退款进度由 `Refund.status` 承载。后端保持现有 `POST /orders/:id/cancel` 主链路，只补可视化 DTO、三端展示、异常运维入口、验证与文档同步，不把 PAID 未发货取消塞进售后状态机。

**Tech Stack:** NestJS / Prisma / PostgreSQL Serializable transaction / Alipay refund / React Native 0.81 + Expo 54 / seller/admin Vite + React 19 + Ant Design 5 / Jest / TypeScript

---

## Scope

本计划基于现状代码：

- App 已调用 `OrderRepo.cancelOrder(order.id)`。
- 后端已有 `cancelPaidUnshipped()`、`cancelEntireSessionUnshipped()`、`PaymentService.initiateRefund()` CheckoutSession fallback、`CouponService.restoreCouponsForOrder()`。
- 当前缺口是“退款状态可视化、跨系统联动呈现、真机验证、文档收口、分润隔离证明”。

不纳入本计划：

- 不重写售后系统。
- 不新增 Prisma enum。
- 不改变已发货后的退货/换货规则。
- 不自动推 GitHub / OTA / 生产。

## Business Rules

1. 普通商品订单 `PAID` 且没有任何 `Shipment.waybillNo`：买家可取消，全额原路退款，含运费。
2. 卖家已生成面单：买家不可直接取消，提示联系卖家撤销面单或发货后走售后。
3. 多商户 CheckoutSession：所有 sibling 都为 `PAID` 才整 session 取消；任一 sibling 已发货/已退/已取消则拒绝。
4. 取消成功后订单保持 `CANCELED`；退款进度由最近一条 `Refund` 表示：`REFUNDING / REFUNDED / FAILED`。
5. 平台红包在“未发货取消”场景恢复为 `AVAILABLE` 或 `EXPIRED`，不同于“已发货售后”规则。
6. 分润发放仅在订单变为 `RECEIVED` 后触发；`PAID -> CANCELED` 不应创建 `RewardAllocation`，不应创建 `NormalEligibleOrder` / `VipEligibleOrder`，不应增加 `selfPurchaseCount`。
7. 待确认：`VIP_PACKAGE` 是否完全禁止买家取消退款。当前卖家/管理后台 UI 文案为“VIP 开通礼包不支持退款”，实现前必须由用户确认；默认推荐禁止。

## File Map

Backend:

- Modify: `backend/src/modules/order/order.service.ts`
  - 暴露最新退款摘要字段给买家 App。
  - 如用户确认，增加 `VIP_PACKAGE` 禁止取消保护。
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`
  - 管理端订单列表/详情返回退款摘要。
- Modify: `backend/src/modules/seller/orders/seller-orders.service.ts`
  - 卖家端订单列表/详情返回本订单退款摘要。
- Modify: `backend/src/modules/admin/orders/admin-orders.controller.ts`
  - 可选 Phase 2：增加管理员手动重试退款接口。
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`
- Test: `backend/src/modules/payment/payment.service.refund.spec.ts`
- Test: `backend/src/modules/coupon/coupon.service.restore.spec.ts`
- Test: `backend/src/modules/bonus/engine/bonus-allocation.service.spec.ts` 或新增 focused spec
- Modify: `backend/src/modules/inbox/inbox.service.ts`（仅当现有 `send()` 能力不足时；优先复用现有站内信）

**Schema 现状（2026-05-07 已确认，本计划不动 Schema）**：
- `Refund.merchantRefundNo @unique`、`providerRefundId @unique` 已存在（schema.prisma:1518-1519），幂等键 DB 级保护已具备。
- `RefundStatusHistory` 已具备 `fromStatus/toStatus/remark/operatorId` 字段（schema.prisma:1535），Task 8 重试审计可直接写入。
- `Order` 本身没有 `companyId`；商户归属来自 `OrderItem.companyId`，Task 6.5 必须按订单项收集 companyId，再查 `CompanyStaff` OWNER 发送站内信。
- `Refund.amount` 是 `Float`（元），与 CLAUDE.md "金额单位 = Float / 元" 决策一致。

Buyer App:

- Modify: `src/types/domain/Order.ts`
- Modify: `app/orders/[id].tsx`
- Modify: `src/components/orders/StatusHero.tsx`（如需要按退款状态调整副文案）

Seller:

- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/constants/statusMaps.ts`
- Modify: `seller/src/pages/orders/index.tsx`
- Modify: `seller/src/pages/orders/detail.tsx`

Admin:

- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/statusMaps.ts`
- Modify: `admin/src/pages/orders/index.tsx`
- Modify: `admin/src/pages/orders/detail.tsx`
- Modify: `admin/src/api/orders.ts`（仅 Phase 2 手动重试退款需要）

Docs:

- Modify: `docs/features/refund.md`
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/issues/app-tofix3.md`
- Modify: `plan.md`
- Modify: `docs/operations/app-发布与OTA手册.md`（仅实际 OTA 后）

---

## Chunk 1: Backend Contract And Safety

### Task 1: 冻结取消退款 DTO 合同

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`
- Modify: `backend/src/modules/seller/orders/seller-orders.service.ts`
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`

- [x] **Step 1: 写失败测试：买家订单详情返回退款摘要**

在 `backend/src/modules/order/order.service.cancel.spec.ts` 增加 focused case。**禁止用 `(service as any).mapOrderDetail`** 测私有方法（重构会失败），而是通过 `prisma.order.findUnique` mock + 公开 `getById(orderId, userId)` 出口断言：

```ts
it('订单取消后 getById 在响应中暴露最新退款摘要', async () => {
  const { service, prisma } = makeService();
  prisma.order.findUnique.mockResolvedValue({
    id: 'o1',
    userId: 'u1',
    status: 'CANCELED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 65,
    goodsAmount: 60,
    shippingFee: 5,
    discountAmount: 0,
    createdAt: new Date('2026-05-08T00:00:00.000Z'),
    items: [],
    shipments: [],
    statusHistory: [],
    payments: [],
    afterSaleRequests: [],
    refunds: [{
      id: 'r1',
      amount: 65,
      status: 'REFUNDING',
      reason: '买家未发货取消订单',
      merchantRefundNo: 'AUTO-CANCEL-o1',
      providerRefundId: null,
      updatedAt: new Date('2026-05-08T00:01:00.000Z'),
    }],
  });

  const out = await service.getById('o1', 'u1');
  expect(out.refundSummary).toMatchObject({
    id: 'r1',
    amount: 65,
    status: 'REFUNDING',
    reason: '买家未发货取消订单',
  });
});
```

注意：`makeService()` 必须 mock `prisma.order.findUnique` 的 `include` 形态包含 `refunds: { orderBy, take: 1 }`，否则 mapper 拿不到 refunds。

Expected: FAIL，因为当前 DTO 没有 `refundSummary`。

- [x] **Step 2: 实现买家 DTO**

在 `mapOrder()` 或 `mapOrderDetail()` 中增加 helper：

```ts
private mapRefundSummary(refund?: any) {
  if (!refund) return null;
  return {
    id: refund.id,
    amount: refund.amount,
    status: refund.status,
    reason: refund.reason,
    merchantRefundNo: refund.merchantRefundNo,
    providerRefundId: refund.providerRefundId ?? null,
    updatedAt: refund.updatedAt?.toISOString?.() ?? refund.updatedAt ?? null,
  };
}
```

并在返回对象中加入：

```ts
refundSummary: this.mapRefundSummary(order.refunds?.[0]),
```

- [x] **Step 3: 管理后台 DTO 返回退款摘要和历史**

在 `admin-orders.service.ts:findAll()` 的 `include` 增加最近退款：

```ts
refunds: {
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { id: true, amount: true, status: true, reason: true, merchantRefundNo: true, updatedAt: true },
},
```

在列表 item mapper 中加：

```ts
refundSummary: this.mapRefundSummary(o.refunds?.[0]),
```

在 `findById()` 里保留 `refunds: true`，补 `statusHistory`：

```ts
refunds: {
  orderBy: { createdAt: 'desc' },
  include: { statusHistory: { orderBy: { createdAt: 'desc' } } },
},
```

- [x] **Step 4: 卖家后台 DTO 返回退款摘要**

在 `seller-orders.service.ts:findAll()` 和 `findById()` include 最近退款：

```ts
refunds: {
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { id: true, amount: true, status: true, reason: true, updatedAt: true },
},
```

返回：

```ts
refundSummary: this.mapRefundSummary(order.refunds?.[0]),
```

- [x] **Step 5: 验证 Refund 幂等约束存在（2026-05-07 已确认）**

`backend/prisma/schema.prisma:1511` `Refund` 模型已包含：
- `merchantRefundNo String @unique`（line 1519）
- `providerRefundId String? @unique`（line 1518）

`npx prisma validate` 通过。`AUTO-CANCEL-${orderId}` 幂等键已具备 DB 级保护，无需追加 migration。本步骤无须再跑代码。

- [x] **Step 6: 跑 focused tests**

Run:

```bash
cd backend
npm test -- --runTestsByPath src/modules/order/order.service.cancel.spec.ts
```

Expected: PASS。

### Task 2: 明确 VIP_PACKAGE 取消策略

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `app/orders/[id].tsx`
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`

Decision gate: 用户确认“VIP 礼包不支持买家取消退款”后执行本 Task；如用户选择允许 VIP 退款，跳过本 Task 并补 VIP 回退设计。

- [x] **Step 1: 写失败测试：VIP_PACKAGE PAID 取消被拒绝**

```ts
it('VIP_PACKAGE 不允许买家未发货取消退款', async () => {
  const { service, prisma } = makeService();
  prisma.order.findUnique.mockResolvedValue({
    id: 'vip-o1',
    userId: 'u1',
    status: 'PAID',
    bizType: 'VIP_PACKAGE',
    items: [],
  });

  await expect(service.cancelOrder('vip-o1', 'u1')).rejects.toThrow('VIP');
});
```

- [x] **Step 2: 后端 guard**

在 `cancelOrder()` 的 `PAID` 分支前加：

```ts
if (order.bizType === 'VIP_PACKAGE') {
  throw new BadRequestException('VIP 开通礼包不支持取消退款，请联系客服');
}
```

- [x] **Step 3: App 隐藏 VIP 取消按钮**

在 `app/orders/[id].tsx` 的 `case 'PAID'` 中按订单的 `bizType` 判断（不是用户级 VIP 标志——用户可能是 VIP 但这单是普通商品；用户不是 VIP 但这单是 VIP 礼包）：

```tsx
if (order.bizType !== 'VIP_PACKAGE') {
  secondary.push({
    label: canceling ? '取消中...' : '取消订单',
    onPress: handleCancel,
    disabled: canceling,
  });
}
```

如 `Order` 类型尚未暴露 `bizType`，先在 `src/types/domain/Order.ts` 补字段，并在 `mapOrder()` 中返回。

2026-05-08 review follow-up：已扩展 `StickyCTABar` 的 `CTAItem.disabled`，取消中按钮会真实禁用 Pressable，并保留 `cancelingRef` 作为逻辑防重入兜底。

- [x] **Step 4: 跑检查**

Run:

```bash
cd backend && npm test -- --runTestsByPath src/modules/order/order.service.cancel.spec.ts
npx tsc -b
```

Expected: PASS / no TypeScript errors。

### Task 2.5: 取消 vs 卖家生成面单 竞态保护

**Files:**
- Read-only check: `backend/src/modules/order/order.service.ts` (`cancelPaidUnshipped`)
- Read-only check: `backend/src/modules/seller/shipping/seller-shipping.service.ts` 生成面单入口
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`

业务规则 2 要求"卖家已生成面单则拒绝取消"。但如果两个事务并发（买家点取消的同一秒卖家点了生成面单），必须有锁保证只一边成功。

- [x] **Step 1: 验证现有事务隔离级别**

Read 两个入口的事务包装：

- `cancelPaidUnshipped` 是否用 `prisma.$transaction(..., { isolationLevel: 'Serializable' })`？
- 生成面单是否同样 Serializable？

如果有任一不是 Serializable，本任务暂停并向用户汇报，等用户决定加锁还是接受风险。

- [x] **Step 2: 写并发拒绝断言**

在 `order.service.cancel.spec.ts` 增加一条 case：先把 `prisma.shipment.findMany` mock 成"存在 waybillNo"，确认 `cancelOrder` 抛"卖家已生成发货面单"。这只覆盖串行路径，真正的并发用 staging Case 8 验证（见 Task 12）。

```ts
it('PAID 但已存在 waybillNo 时取消被拒绝', async () => {
  // ... mock prisma.order.findUnique 返回 PAID + 一个 shipment.waybillNo='SF123'
  await expect(service.cancelOrder('o1', 'u1')).rejects.toThrow(/面单|发货/);
});
```

### Task 2.6: 库存恢复 + 红包恢复 单测

**Files:**
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`
- Test: `backend/src/modules/coupon/coupon.service.restore.spec.ts`

Case 1 真机验收里检查"库存恢复 + InventoryLedger.RELEASE + CouponInstance 恢复"，但单测层面没有对应断言。补：

- [x] **Step 1: 取消时调用了库存恢复**

在 `order.service.cancel.spec.ts` 的 PAID 取消 case 里，传入 mock `inventoryService` 或 `prisma.inventoryLedger.create`，断言：

```ts
expect(prisma.inventoryLedger.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({ kind: 'RELEASE' }),
  }),
);
// 或断言 stock 字段被 increment 回原值
```

- [x] **Step 2: CouponInstance 恢复规则**

在 `coupon.service.restore.spec.ts` 写两条 focused case：

```ts
it('未过期 CouponInstance 在取消时恢复为 AVAILABLE', async () => {
  // mock instance.expiresAt 为未来时间
  await service.restoreCouponsForOrder('o1');
  expect(prisma.couponInstance.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'AVAILABLE' }) }),
  );
});

it('已过期 CouponInstance 在取消时恢复为 EXPIRED', async () => {
  // mock instance.expiresAt 为过去时间
  await service.restoreCouponsForOrder('o1');
  expect(prisma.couponInstance.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
  );
});
```

### Task 3: 分润隔离测试

**Files:**
- Test: `backend/src/modules/bonus/engine/bonus-allocation.service.spec.ts`
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`

- [x] **Step 1: 证明 CANCELED 不触发分润分配**

在 `bonus-allocation.service.spec.ts` 增加 case：

```ts
it('CANCELED 订单不会创建分润、有效消费或 selfPurchaseCount', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'o-canceled',
    status: 'CANCELED',
    bizType: 'NORMAL_GOODS',
  });

  await service.allocateForOrder('o-canceled');

  expect(prisma.rewardAllocation.create).not.toHaveBeenCalled();
  expect(prisma.normalEligibleOrder.create).not.toHaveBeenCalled();
  expect(prisma.vipEligibleOrder.create).not.toHaveBeenCalled();
  expect(prisma.normalProgress.update).not.toHaveBeenCalled();
  expect(prisma.normalProgress.updateMany).not.toHaveBeenCalled();
  expect(prisma.vipProgress.update).not.toHaveBeenCalled();
  expect(prisma.vipProgress.updateMany).not.toHaveBeenCalled();
});
```

- [x] **Step 2: 证明取消链路本身不调用 allocateForOrder**

在 `order.service.cancel.spec.ts` 的 PAID 取消 case 里传入 mock `bonusAllocation`：

```ts
expect(bonusAllocation.allocateForOrder).not.toHaveBeenCalled();
```

- [ ] **Step 3: 证明后续新订单仍可正常分润（仅 staging SQL 验证）**

不再要求 integration-style service test（mock 太浅会得到假阳性）。改为只在 staging Case 6（Task 12）用真 SQL 验证：

1. `o_cancel` 走 `PAID -> CANCELED`。
2. `o_normal` 走 `SHIPPED/DELIVERED -> RECEIVED`。
3. SQL 断言只对 `o_normal` 有 `RewardAllocation` 和有效消费记录。

Step 1 + Step 2 已经在单测层证明取消不创建分配；新订单的正向分配由现有 `bonus-allocation.service.spec.ts` 的既有 case 守护，不在本计划范围内重写。

- [x] **Step 4: 跑测试**

Run:

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/order/order.service.cancel.spec.ts \
  src/modules/bonus/engine/bonus-allocation.service.spec.ts
```

Expected: PASS。

---

## Chunk 2: Buyer App

### Task 4: 买家 App 展示退款进度

**Files:**
- Modify: `src/types/domain/Order.ts`
- Modify: `app/orders/[id].tsx`
- Modify: `src/components/orders/StatusHero.tsx`（如副文案集中在组件内）

- [x] **Step 1: 增加类型**

在 `src/types/domain/Order.ts` 增加：

```ts
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';

export type RefundSummary = {
  id: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  merchantRefundNo?: string;
  providerRefundId?: string | null;
  updatedAt?: string | null;
};
```

在 `Order` 中加：

```ts
refundSummary?: RefundSummary | null;
```

- [x] **Step 2: 订单详情增加退款提示块**

在 `app/orders/[id].tsx` 的 StatusHero 下方增加只读提示。**所有 6 种 RefundStatus 必须有 fallback**，避免上游退款流程产生新状态时 App 渲染空字符串：

```tsx
const refund = order.refundSummary;
const refundTextMap: Record<RefundStatus, (amt: number) => string> = {
  REQUESTED: () => '退款申请已提交，等待审核',
  APPROVED: (amt) => `退款已同意，处理中 ¥${amt.toFixed(2)}`,
  REJECTED: () => '退款申请被拒绝，请联系客服',
  REFUNDING: (amt) => `退款处理中 ¥${amt.toFixed(2)}，预计 1-3 个工作日到账`,
  REFUNDED: (amt) => `已原路退回 ¥${amt.toFixed(2)}`,
  FAILED: () => '退款失败，请联系客服处理',
};
const refundText = refund ? refundTextMap[refund.status]?.(refund.amount) ?? null : null;
```

渲染风格复用现有 `sectionRow`，不要新增大卡片嵌套卡片。

- [x] **Step 3: CANCELED 状态文案区分**

`StatusHero` 或详情页传入 `subtitle`：

```tsx
subtitle={
  order.status === 'CANCELED' && refund?.status === 'REFUNDED'
    ? '订单已取消，退款已原路退回'
    : order.status === 'CANCELED'
      ? '订单已取消，退款处理中'
      : order.status === 'PAID'
        ? '商家正在打包，预计 24 小时内发出'
        : undefined
}
```

- [ ] **Step 4: 本地类型检查**

Run（用 `tsc -b` 等效 CI，`--noEmit` 会漏严格类型错误）：

```bash
npx tsc -b
```

Expected: no TypeScript errors。

2026-05-08 结果：已运行 `npx tsc -b`，本次 App 变更相关类型错误已清零；命令仍被 `tests/e2e` / Playwright Node 类型缺失等既有问题阻断，详见执行记录。

### Task 5: App 真机取消路径交互验收

**Files:**
- No code after Task 4 unless test reveals bug.

- [ ] **Step 1: 单商户普通订单**

真机操作：

1. 下普通商品订单并支付宝付款。
2. 不让卖家生成面单。
3. App 订单详情点击取消。
4. 确认弹窗后取消成功。

Expected:

- App 显示 `CANCELED`。
- App 显示退款金额和 `REFUNDING/REFUNDED`。
- 订单列表数量从待发货移动到已取消。

- [ ] **Step 2: 已生成面单拒绝取消**

真机操作：

1. 卖家生成面单但不确认发货。
2. App 点击取消。

Expected:

- 后端返回“卖家已生成发货面单”类提示。
- 订单仍为 `PAID`。
- Refund 表不新增记录。

---

## Chunk 3: Seller Center

### Task 6: 卖家订单列表/详情显示取消与退款状态

**Files:**
- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/constants/statusMaps.ts`
- Modify: `seller/src/pages/orders/index.tsx`
- Modify: `seller/src/pages/orders/detail.tsx`

- [x] **Step 1: 增加类型**

在 `seller/src/types/index.ts` 加：

```ts
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';

export interface RefundSummary {
  id: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  updatedAt?: string | null;
}
```

在 `Order` 中加：

```ts
refundSummary?: RefundSummary | null;
```

- [x] **Step 2: 补齐退款状态映射**

在 `seller/src/constants/statusMaps.ts` 扩展：

```ts
export const refundStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待处理', color: 'warning' },
  APPROVED: { text: '已同意', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'error' },
  REFUNDING: { text: '退款中', color: 'processing' },
  REFUNDED: { text: '已退款', color: 'success' },
  FAILED: { text: '退款失败', color: 'error' },
};
```

- [x] **Step 3: 列表状态列增加退款标签**

在 `seller/src/pages/orders/index.tsx` 状态 render 里：

```tsx
{r.refundSummary && (
  <Tag color={refundStatusMap[r.refundSummary.status]?.color}>
    {refundStatusMap[r.refundSummary.status]?.text || r.refundSummary.status}
  </Tag>
)}
```

- [x] **Step 4: 详情页已取消提示带退款金额**

在 `seller/src/pages/orders/detail.tsx` 已取消 Alert 下方增加：

```tsx
{order.refundSummary && (
  <Alert
    message={`退款${refundStatusMap[order.refundSummary.status]?.text || order.refundSummary.status}`}
    description={`金额 ¥${order.refundSummary.amount.toFixed(2)}，原因：${order.refundSummary.reason}`}
    type={order.refundSummary.status === 'FAILED' ? 'error' : 'info'}
    showIcon
    style={{ marginBottom: 16, borderRadius: 8 }}
  />
)}
```

- [x] **Step 5: 类型检查**

Run（`tsc -b` 与 CI 一致，覆盖 references 严格性）：

```bash
cd seller
npx tsc -b
```

Expected: no TypeScript errors。

### Task 6.5: 买家取消后卖家被动通知

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`（`cancelPaidUnshipped` 内取消成功事务提交后）
- Modify: 现有站内消息入口（优先复用 `backend/src/modules/inbox/inbox.service.ts:send`，不要新增 notification 模块）
- Test: `backend/src/modules/order/order.service.cancel.spec.ts`

**业务背景**：买家点击取消后，卖家中心的订单从"待发货"列表立即消失。如果卖家正在备货/打包，没有任何通知会导致空包裹/客诉。

- [x] **Step 1: 在取消事务提交后发送卖家通知**

不要把通知 IO 放进取消事务。当前后端已经在 `order.service.ts` 取消成功后用 `this.inboxService.send()` 通知商户 OWNER；本任务不是新增通知模块，而是验证现有通知链路、补齐缺失单测，必要时调整文案/目标路由。

**注意**：`Order` 没有 `companyId`。商户归属来自 `OrderItem.companyId`；单订单取消用 `order.items` 收集 companyId，多商户整 session 取消用每个 sibling 的 items 找到对应 companyId，再查 `CompanyStaff where role=OWNER,status=ACTIVE` 得到 `userId`，最后调用 `InboxService.send({ userId, category, type, title, content, target })`。

`refundData.affectedCompanyIds` 由现有取消流程计算后传入：`cancelPaidUnshipped` 按 `order.items[].companyId` 去重排序，多商户 `cancelEntireSessionUnshipped` 按所有 sibling order 的 items 去重；本任务只消费这个结果，不重写 companyId 计算。

```ts
// cancelPaidUnshipped 末尾，事务提交之后（现有模式）
if (this.inboxService?.send && refundData.affectedCompanyIds.length > 0) {
  const owners = await this.prisma.companyStaff.findMany({
    where: {
      companyId: { in: refundData.affectedCompanyIds },
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { userId: true, companyId: true },
  });
  for (const owner of owners) {
    await this.inboxService.send({
      userId: owner.userId,
      category: 'order',
      type: 'order.canceled.by.buyer',
      title: '买家取消订单',
      content: `订单 ${order.id} 已被买家在发货前取消，库存已恢复，款项原路退回`,
      target: { route: '/orders/[id]', params: { id: order.id } },
    });
  }
}
```

如 `InboxService.send()` 当前不能满足卖家中心展示需求，本任务暂停，先与用户确认是否扩展 Inbox 前端展示或另接 Push；不要临时新增另一套通知服务。

- [x] **Step 2: 单测断言通知被调用**

```ts
// order.service.ts 中 InboxService 是 lazy-injected：
// private inboxService: any = null + service.setInboxService(...)
// 测试必须显式注入，否则 this.inboxService?.send guard 会 short-circuit，断言不会覆盖真实通知路径。
const injectInboxService = (service: OrderService) => {
  const inboxService = { send: jest.fn() };
  service.setInboxService(inboxService as any);
  return inboxService;
};

it('PAID 未发货取消成功后向卖家发通知', async () => {
  const { service, prisma } = makeService();
  const inboxService = injectInboxService(service);
  // mock companyStaff.findMany 返回 owner-user-1，并 mock cancelOrder 成功路径
  await service.cancelOrder('o1', 'u1');
  expect(inboxService.send).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner-user-1',
    category: 'order',
    type: 'order.canceled.by.buyer',
    target: { route: '/orders/[id]', params: { id: 'o1' } },
  }));
});

it('已生成面单导致取消失败时不发通知', async () => {
  const { service } = makeService();
  const inboxService = injectInboxService(service);
  // mock shipment 已存在
  await expect(service.cancelOrder('o2', 'u1')).rejects.toThrow();
  expect(inboxService.send).not.toHaveBeenCalled();
});
```

---

## Chunk 4: Admin

### Task 7: 管理后台展示退款状态和审计历史

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/statusMaps.ts`
- Modify: `admin/src/pages/orders/index.tsx`
- Modify: `admin/src/pages/orders/detail.tsx`

- [x] **Step 1: 扩展类型**

在 `admin/src/types/index.ts` 的 `Order` 增加：

```ts
refundSummary?: Refund | null;
refunds?: Refund[];
```

确保 `Refund` 包含：

```ts
merchantRefundNo?: string;
providerRefundId?: string | null;
statusHistory?: RefundStatusHistoryItem[];
```

- [x] **Step 2: 增加退款状态映射**

在 `admin/src/constants/statusMaps.ts` 增加或补齐：

```ts
export const refundStatusMap: Record<string, StatusEntry> = {
  REQUESTED: { text: '待处理', color: 'orange' },
  APPROVED: { text: '已同意', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
  REFUNDING: { text: '退款中', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'green' },
  FAILED: { text: '退款失败', color: 'red' },
};
```

- [x] **Step 3: 订单列表状态列显示退款标签**

在 `admin/src/pages/orders/index.tsx` 状态列中追加：

```tsx
{r.refundSummary && (
  <Tag color={refundStatusMap[r.refundSummary.status]?.color}>
    {refundStatusMap[r.refundSummary.status]?.text || r.refundSummary.status}
  </Tag>
)}
```

- [x] **Step 4: 订单详情新增退款信息块**

在 `admin/src/pages/orders/detail.tsx` 支付信息后增加：

```tsx
{order.refunds?.length ? (
  <Card title="退款信息" style={{ marginBottom: 16 }}>
    <Table
      rowKey="id"
      pagination={false}
      size="small"
      dataSource={order.refunds}
      columns={[
        { title: '退款单号', dataIndex: 'merchantRefundNo' },
        { title: '金额', dataIndex: 'amount', render: (v: number) => `¥${v.toFixed(2)}` },
        { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={refundStatusMap[v]?.color}>{refundStatusMap[v]?.text || v}</Tag> },
        { title: '原因', dataIndex: 'reason' },
        { title: '更新时间', dataIndex: 'updatedAt', render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
      ]}
    />
  </Card>
) : null}
```

- [x] **Step 5: 类型检查**

Run：

```bash
cd admin
npx tsc -b
```

Expected: no TypeScript errors。

### Task 8: 管理后台退款异常处理入口（Phase 2，可在真机验证后做）

**Files:**
- Modify: `backend/src/modules/admin/orders/admin-orders.controller.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.module.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`
- Modify: `backend/src/modules/payment/payment.service.ts`（推荐：Cron 重试复用同一把 `refund-retry` advisory lock）
- Modify: `admin/src/api/orders.ts`
- Modify: `admin/src/pages/orders/detail.tsx`
- Test: `backend/src/modules/admin/orders/admin-orders.service.refund-retry.spec.ts`
- Test: `backend/src/modules/payment/payment.service.refund.spec.ts`

业务目标：当 `Refund.status = FAILED` 或长时间 `REFUNDING` 时，管理员可手动触发重试；仍然使用 `merchantRefundNo` 幂等，不新建退款单。

- [x] **Step 1: 后端 service 增加重试方法**

**资金安全要点**：
1. 外部调用（支付宝退款）**绝不能放进数据库事务**——长持锁 + 跨进程不可控会拖垮 DB。
2. 调支付宝前必须先抢一个短租约，防止 Cron 与管理员同时对同一 `merchantRefundNo` 发起重试。
3. 状态写回必须用 **CAS**（`where: { id, status: <oldStatus> }`），防止并发回写覆盖。
4. 必须处理 `initiateRefund throw` 的异常路径，避免 Refund 状态卡死。
5. 必须做服务端节流（同一 refund 30s 内只允许重试一次），防管理员连点。
6. 必须收口 `providerRefundId @unique` 的 `P2002`：事务内先预查冲突，仍撞唯一约束时在**事务外 catch 后另开短事务**写审计；不要在已经失败的事务里继续写 `RefundStatusHistory`。

```ts
// admin-orders.service.ts 顶部确认已有 / 补充：
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentService } from '../../payment/payment.service';

// admin-orders.module.ts 顶部补充：
import { PaymentModule } from '../../payment/payment.module';

// admin-orders.module.ts 需要导入 PaymentModule，与 admin/after-sale 模块保持一致：
imports: [BonusModule, ShipmentModule, UploadModule, PaymentModule]

// AdminOrdersService constructor 增加：
constructor(
  private prisma: PrismaService,
  private bonusConfig: BonusConfigService,
  private sfExpress: SfExpressService,
  private uploadService: UploadService,
  private paymentService: PaymentService,
) {}

async retryRefund(orderId: string, refundId: string, adminUserId: string) {
  const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund || refund.orderId !== orderId) throw new NotFoundException('退款单不存在');
  if (!['FAILED', 'REFUNDING'].includes(refund.status)) {
    throw new BadRequestException('当前退款状态不需要重试');
  }
  // 第一步：抢短租约（短事务，不调用外部）
  // 作用：把“允许重试”序列化，避免管理员请求之间并发；cron 复用同一把锁后也可覆盖 cron 并发。
  const lease = await this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('refund-retry'),
        hashtext(${refundId})
      )
    `;

    const fresh = await tx.refund.findUnique({ where: { id: refundId } });
    if (!fresh || fresh.orderId !== orderId) throw new NotFoundException('退款单不存在');
    if (!['FAILED', 'REFUNDING'].includes(fresh.status)) {
      return { acquired: false as const, reason: '状态已变更，无需重试' };
    }

    const recent = await tx.refundStatusHistory.findFirst({
      where: { refundId, remark: { contains: '手动重试开始' } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < 30_000) {
      return { acquired: false as const, reason: '请勿频繁重试，请 30 秒后再试' };
    }

    await tx.refundStatusHistory.create({
      data: {
        refundId,
        fromStatus: fresh.status,
        toStatus: fresh.status,
        remark: '管理员手动重试开始',
        operatorId: adminUserId,
      },
    });
    return { acquired: true as const, fromStatus: fresh.status };
  }, { isolationLevel: 'Serializable' });

  if (!lease.acquired) {
    throw new BadRequestException(lease.reason);
  }

  // 第二步：调外部（不在事务内）
  let result: { success: boolean; message?: string; providerRefundId?: string };
  try {
    result = await this.paymentService.initiateRefund(
      refund.orderId,
      refund.amount,
      refund.merchantRefundNo, // 复用幂等键
    );
  } catch (err) {
    // 外部调用异常也要落审计，状态保持 fromStatus
    await this.prisma.refundStatusHistory.create({
      data: {
        refundId,
        fromStatus: lease.fromStatus,
        toStatus: lease.fromStatus,
        remark: `管理员手动重试异常: ${(err as Error).message}`,
        operatorId: adminUserId,
      },
    });
    throw new BadRequestException('退款通道异常，请稍后再试或查看日志');
  }

  const toStatus = result.success ? 'REFUNDED' : 'FAILED';
  const providerRefundId = result.providerRefundId ?? refund.providerRefundId ?? null;

  // 第三步：短事务 + CAS 回写
  try {
    const writeBack = await this.prisma.$transaction(async (tx) => {
      if (providerRefundId) {
        const conflict = await tx.refund.findFirst({
          where: {
            providerRefundId,
            id: { not: refundId },
          },
          select: { id: true },
        });
        if (conflict) {
          await tx.refundStatusHistory.create({
            data: {
              refundId,
              fromStatus: lease.fromStatus,
              toStatus: lease.fromStatus,
              remark: `providerRefundId 冲突，跳过覆盖: ${providerRefundId}`,
              operatorId: adminUserId,
            },
          });
          return { status: 'providerRefundIdConflict' as const };
        }
      }

      const updated = await tx.refund.updateMany({
        where: { id: refundId, status: lease.fromStatus }, // CAS
        data: {
          status: toStatus,
          providerRefundId: providerRefundId ?? undefined,
        },
      });
      if (updated.count === 0) {
        // 状态被别处改了（Cron / 异步回调），放弃覆盖，但仍记审计
        await tx.refundStatusHistory.create({
          data: {
            refundId,
            fromStatus: lease.fromStatus,
            toStatus: lease.fromStatus,
            remark: `管理员手动重试时状态已被并发更新，跳过覆盖（外部结果: ${result.success ? '成功' : '失败'}）`,
            operatorId: adminUserId,
          },
        });
        return { status: 'concurrentSkip' as const };
      }
      await tx.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus: lease.fromStatus,
          toStatus,
          remark: result.success ? '管理员手动重试成功' : `管理员手动重试失败: ${result.message ?? ''}`,
          operatorId: adminUserId,
        },
      });
      return { status: 'written' as const };
    }, { isolationLevel: 'Serializable' });

    if (writeBack.status === 'providerRefundIdConflict') {
      throw new ConflictException('退款渠道流水号已被其他退款单占用，请人工核对');
    }
  } catch (err) {
    const isProviderRefundIdP2002 =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      String(err.meta?.target ?? '').includes('providerRefundId');

    if (!isProviderRefundIdP2002) throw err;

    // 唯一约束异常会让原事务失败；这里必须另开短事务记审计。
    await this.prisma.$transaction(async (tx) => {
      await tx.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus: lease.fromStatus,
          toStatus: lease.fromStatus,
          remark: `providerRefundId P2002 冲突，跳过覆盖: ${providerRefundId ?? '(empty)'}`,
          operatorId: adminUserId,
        },
      });
    }, { isolationLevel: 'Serializable' });
    throw new ConflictException('退款渠道流水号已被其他退款单占用，请人工核对');
  }

  return { ok: result.success, message: result.message };
}
```

Cron 重试同一类退款时也应在调用 `initiateRefund()` 前尝试同一把 `refund-retry` advisory lock；若本期不改 cron，必须在 Task 12 Case 5 里压测“cron + 管理员手动重试”并确认支付宝按 `merchantRefundNo` 幂等返回，不产生重复退款。

- [x] **Step 1.1: 补 providerRefundId 冲突单测**

在 `backend/src/modules/admin/orders/admin-orders.service.refund-retry.spec.ts` 增加：

```ts
it('手动重试遇到 providerRefundId P2002 时另开事务写审计并抛 ConflictException', async () => {
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`providerRefundId`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['providerRefundId'] },
    },
  );
  prisma.refund.findUnique.mockResolvedValue({
    id: 'r1',
    orderId: 'o1',
    amount: 65,
    status: 'FAILED',
    merchantRefundNo: 'AUTO-CANCEL-o1',
    providerRefundId: null,
  });
  paymentService.initiateRefund.mockResolvedValue({
    success: true,
    providerRefundId: 'PROVIDER-REF-1',
  });

  const leaseTx = {
    $executeRaw: jest.fn(),
    refund: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', orderId: 'o1', status: 'FAILED' }) },
    refundStatusHistory: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };
  const auditTx = {
    refundStatusHistory: { create: jest.fn() },
  };
  prisma.$transaction
    .mockImplementationOnce(async (callback: any) => callback(leaseTx))
    .mockRejectedValueOnce(p2002)
    .mockImplementationOnce(async (callback: any) => callback(auditTx));

  await expect(service.retryRefund('o1', 'r1', 'admin1')).rejects.toThrow(ConflictException);
  expect(auditTx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      refundId: 'r1',
      fromStatus: 'FAILED',
      toStatus: 'FAILED',
      remark: expect.stringContaining('providerRefundId P2002 冲突'),
      operatorId: 'admin1',
    }),
  }));
});
```

2026-05-08 review follow-up：同一 spec 追加覆盖 30 秒节流、`initiateRefund` 抛异常审计、CAS `updateMany.count=0` 并发跳过三条路径。

- [x] **Step 2: Controller 加受权限保护接口**

```ts
@Post(':id/refunds/:refundId/retry')
@RequirePermission('orders:refund')
retryRefund(@Param('id') id: string, @Param('refundId') refundId: string, @CurrentAdmin('sub') adminUserId: string) {
  return this.ordersService.retryRefund(id, refundId, adminUserId);
}
```

- [x] **Step 3: 前端按钮只在异常状态显示**

在 `admin/src/pages/orders/detail.tsx` 的退款表格 action 列：

```tsx
{['FAILED', 'REFUNDING'].includes(record.status) && (
  <Button size="small" danger onClick={() => handleRetryRefund(record.id)}>
    重试退款
  </Button>
)}
```

使用 `App.useApp().modal.confirm`，禁止静态 `Modal.confirm`。

---

## Chunk 5: Documents And Release State

### Task 9: 文档同步

**Files:**
- Modify: `docs/features/refund.md`
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/issues/app-tofix3.md`
- Modify: `plan.md`

- [x] **Step 1: refund.md 增加规则 24**

新增：

```md
## 规则 24：未发货取消订单

- 适用状态：`PAID` 且卖家尚未生成电子面单。
- 退款金额：整单实付金额全额退回，含运费。
- 平台红包：因商品未发货，恢复 CouponInstance；未过期恢复 AVAILABLE，已过期恢复 EXPIRED。
- 分润：不触发分润发放，不创建有效消费记录。
- 已生成面单：买家不可直接取消，需联系卖家撤销面单，或发货后按售后规则处理。
- 多商户订单：同一 CheckoutSession 下所有订单均未发货才允许整单取消。
```

- [x] **Step 2: data-system.md 更新状态机**

补 `PAID -> CANCELED` 边，说明原因是“买家未发货取消，触发 Refund”。

- [x] **Step 3: app-tofix3.md 更新状态**

将 Bug 88 / 89 / 90 的代码状态、验证状态分开：

- 代码完成：已完成。
- 真机验证：待跑 / 已跑。
- 文档同步：完成后打勾。

- [x] **Step 4: plan.md 更新**

完成后标记：

- `R-RS11` 真机 case 1.1
- `R-RS12` 多商户退款验证
- `R-RS13` 售后退款回归
- `R-RS14` 文档同步

只在真实跑通后打 ✅，不要提前标。

### Task 10: 发布与回滚说明

**Files:**
- Modify: `docs/operations/app-发布与OTA手册.md`（仅 OTA 后）
- No server deployment docs unless实际部署

- [ ] **Step 1: Staging 发布前说明**

推 staging 前告知用户：

- 后端改动会触发 GitHub Actions 部署。
- 无 Prisma migration。
- 回滚路径：`git revert <commit_sha> && git push origin staging`。
- 若已产生真实退款记录，代码回滚不会撤销支付宝退款，需要财务/对账处理。

- [ ] **Step 2: App OTA 必须前置支付宝 sandbox 标志**

每次 `eas update preview` 必须前置 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`，否则真机付款会报"商家订单参数异常"（已踩过的坑）。命令模板：

```bash
EXPO_PUBLIC_ALIPAY_SANDBOX=true npx eas update --channel preview --message "PAID 未发货取消退款链路收尾"
```

生产 channel（`production`）由用户决定时机，且必须显式不带 sandbox 标志。

- [ ] **Step 3: App OTA 后记录**

如执行 EAS Update，更新 `docs/operations/app-发布与OTA手册.md` 第六章，记录 channel、update id、commit、变更说明。

---

## Chunk 6: Verification Matrix

### Task 11: Automated Verification

Run:

```bash
cd backend
npx prisma validate
npm test -- --runTestsByPath \
  src/modules/order/order.service.cancel.spec.ts \
  src/modules/admin/orders/admin-orders.service.refund-retry.spec.ts \
  src/modules/payment/payment.service.refund.spec.ts \
  src/modules/coupon/coupon.service.restore.spec.ts \
  src/modules/bonus/engine/bonus-allocation.service.spec.ts
npx tsc -b
```

Expected:

- Prisma schema valid.
- All focused tests pass.
- TypeScript no errors.

**全量回归（Phase 完成必跑，CLAUDE.md 强制要求）**：

```bash
cd backend
npm test
```

Expected: 全部 spec PASS，无新增失败。

**前端三端类型检查**（用 `tsc -b`，等效 CI；`--noEmit` / `npm run build` 会漏严格类型错误）：

```bash
# 买家 App（在仓库根目录）
npx tsc -b

cd seller && npx tsc -b
cd ../admin && npx tsc -b
```

Expected: 三端 TS 无错误。

### Task 12: Staging 真机验证

- [ ] **Case 1: 单商户 PAID 未发货取消**

Expected:

- App: `CANCELED` + refund status visible.
- DB: `Order.status=CANCELED`。
- DB: `Refund.status=REFUNDING/REFUNDED`，`merchantRefundNo` starts with `AUTO-CANCEL-`。
- DB: stock restored, InventoryLedger has `RELEASE`。
- DB: CouponInstance restored to `AVAILABLE/EXPIRED`。
- DB: no `RewardAllocation` for this order。
- Seller: 订单从待发货移到已取消，显示退款状态。
- Admin: 订单详情显示退款信息。

- [ ] **Case 2: 已生成面单拒绝取消**

Expected:

- App shows backend error.
- Order remains `PAID`。
- No new Refund row。
- Seller can continue cancel waybill or ship。

- [ ] **Case 3: 多商户全 PAID 整 session 取消**

Expected:

- 所有 sibling orders `CANCELED`。
- 每个 order 一条 Refund。
- 每个 seller 只看到自己订单取消。
- 红包/奖励只恢复一次，不重复。

- [ ] **Case 4: 多商户部分已发货拒绝取消**

Expected:

- Cancel request rejected。
- 已 PAID sibling 不被误取消。
- 已 SHIPPED sibling 不受影响。

- [ ] **Case 5: 退款失败兜底**

Method:

- 在 staging 临时让支付宝退款失败，或 mock `AlipayService.refund` 返回 false。

Expected:

- Order remains `CANCELED`。
- Refund remains `REFUNDING` or becomes `FAILED`。
- Cron can retry。
- Admin shows异常状态。

- [ ] **Case 6: 分润不受影响**

SQL/后台检查：

1. 取消订单 `o_cancel` 没有 `RewardAllocation`。
2. `NormalEligibleOrder` / `VipEligibleOrder` 没有 `o_cancel`。
3. 用户 `selfPurchaseCount` 没因 `o_cancel` 增加。
4. 同一用户下一笔正常订单确认收货后，分润按下一笔真实 `RECEIVED` 订单计算。

- [ ] **Case 7: 售后退款回归**

验证 R-RS09 没破坏售后：

- 已发货/已收货订单走售后退款。
- Refund 可以通过 CheckoutSession fallback 原路退。
- 售后退款不恢复平台红包本体，仅按规则分摊退款金额。

- [ ] **Case 8: 取消 vs 生成面单 并发竞态**

Method:

- 在 staging DB 预先放一条 PAID 未发货订单。
- 同时（用两个 curl/Postman tab）打：买家 `POST /orders/:id/cancel` + 卖家生成面单接口。

Expected:

- 二者只一边成功，另一边返回明确错误。
- DB 不出现：`Order.status=CANCELED` + `Shipment.waybillNo` 同时存在的脏状态。
- 不出现重复 Refund 记录。
- 若两边都"成功"返回 → 立刻向用户报告，需要补 Serializable + select-for-update。

- [ ] **Case 9: 卖家通知到达**

Expected:

- 买家成功取消 PAID 未发货订单后，对应商户的卖家中心收到"买家取消订单"通知（站内消息 / 红点 / Push 任一存在即可）。
- 失败取消（已生成面单被拒）不发通知。

---

## Answer: 分润影响结论

PAID 未发货取消退款不会影响之后的分润，前提是实现和验证满足本计划的断言。

原因：

1. 当前分润入口是 `BonusAllocationService.allocateForOrder(orderId)`，它只处理 `Order.status === RECEIVED` 的订单。
2. 买家未发货取消是 `PAID -> CANCELED`，不会进入 `RECEIVED`。
3. 因此不应创建 `RewardAllocation`，不应创建普通/VIP有效消费记录，不应增加 `selfPurchaseCount`。
4. 已取消订单后续也不会被自动确认收货 cron 处理，因为状态不是 `SHIPPED/DELIVERED`。
5. 计划中的测试会把这些作为硬性验收，避免未来改动误把取消单算进分润。

需要区分的是：取消时恢复的 `RewardLedger VOIDED -> AVAILABLE` 是“结算时已占用/核销的用户奖励余额或奖励抵扣恢复”，不是给上级发放新的分润。它是把这笔未发货订单使用掉的权益还回去，不会制造新的分润收入。
