# 售后链路收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `after-sale` 主干上补齐无理由换货、顺丰退货面单、售后退款幂等、退款/售后历史和三端接线，形成退款、退货、换货完整闭环。

**Architecture:** 后端先扩展 Prisma 模型和售后状态历史，再抽出 `AfterSaleRefundService`、`AfterSaleShippingPaymentService`、`AfterSaleReturnShippingService` 三个明确边界的服务。买家 App、卖家后台、管理后台只消费后端 eligibility、timeline、refund/waybill 摘要，不在前端自行推断售后资格。

**Tech Stack:** NestJS 11 + Prisma 6 + PostgreSQL + Serializable 事务；React Native 0.81 + Expo Router；React 19 + Vite + Ant Design 5；Jest + ts-jest。

---

## Scope Check

本计划覆盖 `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md` 的全量收口范围。它是一个完整售后链路改造，不拆成多个独立项目，因为退款状态、退货面单、仲裁路径、三端展示必须共用同一套模型和状态语义才能测试通过。

## File Structure

后端 Schema 和公共类型：

- Modify `backend/prisma/schema.prisma`：新增 `NO_REASON_EXCHANGE`、运费支付/运费责任/状态历史字段和关系。
- Create generated migration under `backend/prisma/migrations/` via `npx prisma migrate dev --name after_sale_chain_closure`。
- Modify `backend/src/modules/after-sale/after-sale.constants.ts`：扩展售后配置、状态集合、派生展示阈值。
- Modify `backend/src/modules/after-sale/after-sale.utils.ts`：四类售后资格、寄回、退款扣运费纯函数。
- Modify `backend/src/modules/after-sale/dto/create-after-sale.dto.ts`：无理由换货和目标 SKU 字段。
- Create `backend/src/modules/after-sale/dto/create-return-waybill.dto.ts`：买家生成退货面单请求。
- Create `backend/src/modules/after-sale/dto/create-shipping-payment.dto.ts`：买家退货运费支付请求。
- Create `backend/src/modules/after-sale/after-sale-status-history.service.ts`：售后状态历史统一写入。
- Create `backend/src/modules/after-sale/after-sale-refund.service.ts`：售后退款幂等创建、发起、成功/失败闭环、重试。
- Create `backend/src/modules/after-sale/after-sale-refund-consistency.service.ts`：售后退款双向关系巡检和告警。
- Create `backend/src/modules/after-sale/after-sale-shipping-payment.service.ts`：买家退货运费支付单、支付宝回调、运费原路退。
- Create `backend/src/modules/after-sale/after-sale-return-shipping.service.ts`：买家退回商家顺丰面单、取消、未揽收超时处理。
- Modify `backend/src/modules/after-sale/after-sale.service.ts`：申请、eligibility、申诉来源、详情、timeline。
- Modify `backend/src/modules/after-sale/after-sale.controller.ts`：新增 eligibility、退货面单、运费支付、timeline API。
- Modify `backend/src/modules/after-sale/after-sale.module.ts`：注册新服务并导出给 seller/admin/payment。

后端跨模块：

- Modify `backend/src/modules/payment/payment.service.ts`：识别 `AS_SHIP_PAY_` 支付回调，AS 退款补偿委托售后退款服务。
- Modify `backend/src/modules/payment/payment.module.ts`：用 `forwardRef` 连接 AfterSaleModule。
- Modify `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`：无理由换货、拒收回寄面单、退款统一服务。
- Modify `backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`：新增卖家拒收回寄面单和 timeline。
- Modify `backend/src/modules/seller/after-sale/dto/seller-after-sale.dto.ts`：拒收 DTO 去掉强制手填单号，新增 carrierCode。
- Modify `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`：仲裁状态、退款重试、详情增强。
- Modify `backend/src/modules/admin/after-sale/admin-after-sale.controller.ts`：新增退款重试和 timeline。
- Modify `backend/src/modules/order/order.service.ts`：订单详情返回 `afterSaleSummary`。

买家 App：

- Modify `src/types/domain/Order.ts`：售后类型、摘要、退货面单、运费支付状态。
- Modify `src/constants/statuses.ts`：新增无理由换货和退款人工处理文案。
- Modify `src/repos/AfterSaleRepo.ts`：eligibility、退货面单、运费支付、timeline。
- Modify `src/repos/OrderRepo.ts`：移除真实链路上的旧换货确认调用。
- Modify `app/orders/[id].tsx`：直达售后详情、用 afterSaleId 确认换货。
- Modify `app/orders/after-sale/[id].tsx`：申请售后选项来自 eligibility。
- Modify `app/orders/after-sale-detail/[id].tsx`：去掉手填物流主流程，展示面单、运费支付、退款状态和换货物流。

卖家后台：

- Modify `seller/src/api/after-sale.ts`：类型、timeline、回寄面单 API。
- Modify `seller/src/pages/after-sale/index.tsx`：类型标签和状态筛选。
- Modify `seller/src/pages/after-sale/detail.tsx`：`RECEIVED_BY_SELLER` 换货发货、拒收回寄面单、顺丰 carrier 选择。

管理后台：

- Modify `admin/src/api/after-sale.ts`：退款历史、状态历史、重试 API。
- Modify `admin/src/pages/after-sale/index.tsx`：仲裁 Drawer/Modal 详情、退款重试、真实失败原因。
- Modify `admin/src/pages/categories/index.tsx` only if existing copy needs to expose the ConfigKey wording; keep existing `RETURNABLE / NON_RETURNABLE / INHERIT` control.

文档和验证：

- Modify `docs/features/refund.md`：同步最新售后规则。
- Modify `docs/issues/app-tofix3.md`：同步顺丰退货面单相关收口项。
- Modify `docs/issues/tofix-safe.md`：登记/关闭本次资金和状态并发风险。
- Modify `plan.md`：更新上线冲刺售后链路进度。
- Modify `AGENTS.md` only if this plan path is not listed.

## Execution Rules

- 每个 Task 一个本地 commit，commit message 使用 `type(scope): 描述`。
- 涉及金额、退款、面单、状态迁移的写操作必须使用 `Prisma.TransactionIsolationLevel.Serializable`。
- 新增状态迁移必须同时写 `AfterSaleStatusHistory`。
- 不改旧用户无关数据；迁移异常只输出报告并阻断发布。
- 不 push；推送或 OTA 必须另行取得用户确认。

---

### Task 1: Prisma Schema And Migration

**Files:**
- Modify `backend/prisma/schema.prisma`
- Generated: `backend/prisma/migrations/*_after_sale_chain_closure/migration.sql`
- Test: Prisma validate and generated client

- [ ] **Step 1: Extend enums and models in Prisma schema**

Add these enum values and models to `backend/prisma/schema.prisma` near the existing after-sale/refund enums:

```prisma
enum AfterSaleType {
  NO_REASON_RETURN
  NO_REASON_EXCHANGE
  QUALITY_RETURN
  QUALITY_EXCHANGE
}

enum ReturnShippingPayer {
  BUYER
  SELLER
  PLATFORM
}

enum AfterSaleOperatorType {
  BUYER
  SELLER_STAFF
  ADMIN
  SYSTEM
}

enum AfterSaleShippingPaymentStatus {
  UNPAID
  PENDING
  PAID
  FAILED
  REFUNDING
  REFUNDED
  CLOSED
}
```

Add these fields to `AfterSaleRequest`:

```prisma
arbitrationSourceStatus AfterSaleStatus?
targetSkuId             String?
targetQuantity          Int?
returnCarrierCode       String?
returnWaybillUrl        String?
returnSfOrderId         String?
returnLabelUrl          String?
returnShippingFee       Float?
returnShippingPayer     ReturnShippingPayer?
returnShippingPaidAt    DateTime?
returnShippingFeeDeducted Boolean @default(false)
manualReviewReason      String?
manualReviewRequestedAt DateTime?
manualReviewResolvedAt  DateTime?
sellerReturnCarrierCode String?
sellerReturnCarrierName String?
sellerReturnWaybillNo   String?
sellerReturnWaybillUrl  String?
sellerReturnSfOrderId   String?
statusHistory           AfterSaleStatusHistory[]
shippingPayment         AfterSaleShippingPayment?
refundByRefundId        Refund? @relation("AfterSaleRefundByRefundId", fields: [refundId], references: [id])
refundByAfterSaleId     Refund? @relation("AfterSaleRefundByAfterSaleId")
```

Keep the existing legacy fields on `AfterSaleRequest`; do not remove or duplicate them:

```prisma
returnCarrierName String?
returnWaybillNo   String?
refundId          String?
```

Add `afterSaleId` and explicit relation names to `Refund`:

```prisma
afterSaleId String? @unique
afterSaleByAfterSaleId     AfterSaleRequest?  @relation("AfterSaleRefundByAfterSaleId", fields: [afterSaleId], references: [id])
afterSaleRequestsByRefundId AfterSaleRequest[] @relation("AfterSaleRefundByRefundId")
```

Add the two new models:

```prisma
model AfterSaleStatusHistory {
  id           String                 @id @default(cuid())
  afterSaleId  String
  afterSale    AfterSaleRequest       @relation(fields: [afterSaleId], references: [id], onDelete: Cascade)
  fromStatus   AfterSaleStatus?
  toStatus     AfterSaleStatus
  reason       String?
  operatorType AfterSaleOperatorType?
  operatorId   String?
  meta         Json?
  createdAt    DateTime               @default(now())

  @@index([afterSaleId, createdAt])
  @@map("after_sale_status_history")
}

model AfterSaleShippingPayment {
  id                String                         @id @default(cuid())
  afterSaleId       String                         @unique
  afterSale         AfterSaleRequest               @relation(fields: [afterSaleId], references: [id], onDelete: Cascade)
  amount            Float
  status            AfterSaleShippingPaymentStatus @default(UNPAID)
  merchantPaymentNo String                         @unique
  providerPaymentNo String?
  provider          String                         @default("ALIPAY")
  paidAt            DateTime?
  refundedAt        DateTime?
  failureReason     String?
  createdAt         DateTime                       @default(now())
  updatedAt         DateTime                       @updatedAt

  @@index([status, createdAt])
  @@map("after_sale_shipping_payments")
}
```

The two `Refund` relations must use explicit relation names. Running `npx prisma validate` with unnamed `Refund.afterSaleId` plus `AfterSaleRequest.refundId` relations is expected to fail.

- [ ] **Step 2: Run schema validation before migration**

Run:

```bash
cd backend && npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 3: Generate migration and client**

Run:

```bash
cd backend && npx prisma migrate dev --name after_sale_chain_closure
cd backend && npx prisma generate
```

Expected: migration generated under `backend/prisma/migrations/`, Prisma Client generated without relation errors.

- [ ] **Step 4: Add migration safety notes**

Open the generated SQL and verify it does not drop existing after-sale/refund data. If PostgreSQL enum changes require raw SQL, keep enum additions additive.

Grandfather existing after-sale rows in the migration or a one-off backfill script:

```sql
UPDATE after_sale_request
SET "returnShippingPayer" = CASE
  WHEN "afterSaleType" = 'NO_REASON_RETURN' THEN 'BUYER'
  ELSE 'SELLER'
END
WHERE "requiresReturn" = true
  AND "returnShippingPayer" IS NULL;
```

Existing rows with `"returnWaybillNo" IS NOT NULL` and `"returnSfOrderId" IS NULL` are legacy manual-logistics rows. They stay valid, display as legacy logistics in all three frontends, and do not require `AfterSaleShippingPayment`.

Before applying this backfill outside a local dev database, run the generated migration and the backfill on staging first, then verify the actual PostgreSQL column names with:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'after_sale_request'
  AND column_name IN ('requiresReturn', 'returnShippingPayer', 'returnWaybillNo', 'returnSfOrderId');
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(after-sale): extend schema for chain closure"
```

### Task 2: Backend Pure Rules And Eligibility

**Files:**
- Modify `backend/src/modules/after-sale/after-sale.constants.ts`
- Modify `backend/src/modules/after-sale/after-sale.utils.ts`
- Modify `backend/src/modules/after-sale/after-sale.utils.spec.ts`
- Modify `backend/src/modules/after-sale/dto/create-after-sale.dto.ts`
- Modify `backend/src/modules/after-sale/after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.controller.ts`

- [ ] **Step 1: Write failing utility tests**

Add tests to `backend/src/modules/after-sale/after-sale.utils.spec.ts`:

```ts
import {
  calculateRefundAmount,
  isWithinReturnWindow,
  requiresReturnShipping,
} from './after-sale.utils';

describe('requiresReturnShipping', () => {
  it('无理由换货低金额免寄回，高金额需要寄回', () => {
    expect(requiresReturnShipping('NO_REASON_EXCHANGE', 49, 50)).toBe(false);
    expect(requiresReturnShipping('NO_REASON_EXCHANGE', 51, 50)).toBe(true);
  });
});

describe('isWithinReturnWindow', () => {
  it('无理由换货使用 RETURNABLE 商品的七天窗口', () => {
    const deliveredAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(isWithinReturnWindow(deliveredAt, null, 'RETURNABLE', 'NO_REASON_EXCHANGE', 7, 7, 24)).toBe(true);
  });

  it('NON_RETURNABLE 商品不允许无理由换货', () => {
    const deliveredAt = new Date();
    expect(isWithinReturnWindow(deliveredAt, null, 'NON_RETURNABLE', 'NO_REASON_EXCHANGE', 7, 7, 24)).toBe(false);
  });
});

describe('calculateRefundAmount', () => {
  it('无理由退货从退款中扣除退货运费且退款最低为 0', () => {
    const refund = calculateRefundAmount(20, 1, 20, 0, 0, 0, 0, 'NO_REASON_RETURN', false, 25);
    expect(refund).toBe(0);
  });
});
```

- [ ] **Step 2: Run utility tests and confirm failure**

Run:

```bash
cd backend && npm test -- after-sale.utils.spec.ts
```

Expected: FAIL because `NO_REASON_EXCHANGE` and the extra `calculateRefundAmount` parameter are not implemented.

- [ ] **Step 3: Implement pure rule changes**

Update `calculateRefundAmount` signature in `after-sale.utils.ts`:

```ts
export function calculateRefundAmount(
  unitPrice: number,
  quantity: number,
  orderGoodsAmount: number,
  orderTotalCouponDiscount: number,
  orderRewardDiscount: number,
  orderVipDiscount: number,
  orderShippingFee: number,
  afterSaleType: string,
  isFullRefund: boolean,
  returnShippingFeeToDeduct = 0,
): number {
  const itemAmount = unitPrice * quantity;
  const totalDiscount = Math.min(
    orderGoodsAmount,
    Math.max(0, orderTotalCouponDiscount || 0) +
      Math.max(0, orderRewardDiscount || 0) +
      Math.max(0, orderVipDiscount || 0),
  );
  const discountShare =
    orderGoodsAmount > 0 && totalDiscount > 0
      ? totalDiscount * (itemAmount / orderGoodsAmount)
      : 0;

  let refundAmount = Math.max(0, itemAmount - discountShare);
  if (isFullRefund && afterSaleType !== 'NO_REASON_RETURN') {
    refundAmount += orderShippingFee;
  }
  if (afterSaleType === 'NO_REASON_RETURN' && returnShippingFeeToDeduct > 0) {
    refundAmount = Math.max(0, refundAmount - returnShippingFeeToDeduct);
  }
  return Math.round(refundAmount * 100) / 100;
}
```

Update `requiresReturnShipping`:

```ts
export function requiresReturnShipping(
  afterSaleType: string,
  itemAmount: number,
  threshold: number,
): boolean {
  if (afterSaleType === 'NO_REASON_RETURN') return true;
  if (afterSaleType === 'NO_REASON_EXCHANGE') return itemAmount > threshold;
  return itemAmount > threshold;
}
```

Update `isWithinReturnWindow` no-reason branch:

```ts
if (afterSaleType === 'NO_REASON_RETURN' || afterSaleType === 'NO_REASON_EXCHANGE') {
  if (returnPolicy === 'NON_RETURNABLE') return false;
  const deadline = baseMs + returnWindowDays * 24 * 60 * 60 * 1000;
  return now.getTime() < deadline;
}
```

- [ ] **Step 4: Extend CreateAfterSaleDto**

Update `backend/src/modules/after-sale/dto/create-after-sale.dto.ts`:

```ts
@ValidateIf((o) =>
  o.afterSaleType === AfterSaleType.QUALITY_RETURN ||
  o.afterSaleType === AfterSaleType.QUALITY_EXCHANGE,
)
@IsNotEmpty({ message: '质量问题售后必须选择理由类型' })
@IsEnum(ReplacementReasonType, { message: 'reasonType 必须为有效的理由类型' })
reasonType?: ReplacementReasonType;

@IsOptional()
@IsString({ message: 'targetSkuId 必须为字符串' })
targetSkuId?: string;
```

In `AfterSaleService.apply`, enforce same SKU for this phase:

```ts
if (dto.afterSaleType === AfterSaleType.NO_REASON_EXCHANGE && dto.targetSkuId && dto.targetSkuId !== orderItem.skuId) {
  throw new BadRequestException('本期仅支持同 SKU 换货');
}
```

- [ ] **Step 5: Add eligibility endpoint**

Add controller method:

```ts
@Get('orders/:orderId/eligibility')
getEligibility(
  @CurrentUser('sub') userId: string,
  @Param('orderId') orderId: string,
) {
  return this.afterSaleService.getEligibility(userId, orderId);
}
```

Implement `getEligibility` in `AfterSaleService` returning `NO_REASON_RETURN / NO_REASON_EXCHANGE / QUALITY_RETURN / QUALITY_EXCHANGE` options with `enabled`, `disabledReason`, `deadlineAt`, `requiresReturn`, `returnShippingPayer`, `estimatedRefundAmount`, `estimatedReturnShippingFee`, `requiresBuyerShippingPayment`.

- [ ] **Step 6: Run tests**

```bash
cd backend && npm test -- after-sale.utils.spec.ts
cd backend && npx prisma validate
```

Expected: utility tests pass and Prisma schema validates.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/after-sale/after-sale.constants.ts backend/src/modules/after-sale/after-sale.utils.ts backend/src/modules/after-sale/after-sale.utils.spec.ts backend/src/modules/after-sale/dto/create-after-sale.dto.ts backend/src/modules/after-sale/after-sale.service.ts backend/src/modules/after-sale/after-sale.controller.ts
git commit -m "feat(after-sale): add eligibility rules"
```

### Task 3: Status History And Refund Service

**Files:**
- Create `backend/src/modules/after-sale/after-sale-status-history.service.ts`
- Create `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Create `backend/src/modules/after-sale/after-sale-refund-consistency.service.ts`
- Create `backend/src/modules/after-sale/after-sale-refund.service.spec.ts`
- Modify `backend/src/modules/after-sale/after-sale.module.ts`
- Modify `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`
- Modify `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale-timeout.service.ts`
- Modify `backend/src/modules/payment/payment.service.ts`

- [ ] **Step 1: Write refund service tests**

Create `backend/src/modules/after-sale/after-sale-refund.service.spec.ts` with real mocked Prisma assertions:

```ts
describe('AfterSaleRefundService', () => {
  const tx = {
    afterSaleRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refund: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    refundStatusHistory: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn((cb) => cb(tx)),
    refund: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
    });
  });

  it('createOrGetRefund uses AS-afterSaleId as stable merchantRefundNo', async () => {
    await service.startRefund('as_001', { type: 'SYSTEM' });

    expect(tx.refund.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantRefundNo: 'AS-as_001' },
      create: expect.objectContaining({
        afterSaleId: 'as_001',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
      }),
    }));
  });

  it('handleRefundFailure keeps after-sale status at REFUNDING', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      status: 'REFUNDING',
    });

    await service.handleRefundFailure('refund_001', '支付宝失败');

    expect(tx.refund.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('handleRefundSuccess writes REFUNDED and creates status history once', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      status: 'REFUNDING',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      status: 'REFUNDING',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        providerRefundId: 'provider_refund_001',
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
  });
});
```

Add a real database-backed concurrency test in the same file or a separate `after-sale-refund.concurrency.spec.ts`:

```ts
it('creates one refund when startRefund is called concurrently for the same afterSaleId', async () => {
  const afterSale = await seedRefundableAfterSale(prisma, { id: 'as_concurrent_001' });

  await Promise.all(
    Array.from({ length: 5 }, () =>
      service.startRefund(afterSale.id, { type: 'SYSTEM' }).catch((err) => err),
    ),
  );

  const refunds = await prisma.refund.findMany({
    where: { merchantRefundNo: `AS-${afterSale.id}` },
  });
  expect(refunds).toHaveLength(1);
});
```

Define `seedRefundableAfterSale` in the concurrency spec with real Prisma writes:

```ts
async function seedRefundableAfterSale(prisma: PrismaService, input: { id: string }) {
  const order = await prisma.order.create({ data: createPaidDeliveredOrderSeed() });
  return prisma.afterSaleRequest.create({
    data: {
      id: input.id,
      orderId: order.id,
      userId: order.userId,
      afterSaleType: 'QUALITY_RETURN',
      reason: '质量问题',
      photos: ['https://example.test/p.jpg'],
      status: 'RECEIVED_BY_SELLER',
      requiresReturn: true,
      refundAmount: 88,
    },
  });
}
```

- [ ] **Step 2: Run new tests and confirm failure**

```bash
cd backend && npm test -- after-sale-refund.service.spec.ts
```

Expected: FAIL until service files exist and mocks are wired.

- [ ] **Step 3: Implement status history service**

Create `after-sale-status-history.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AfterSaleOperatorType, AfterSaleStatus, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AfterSaleStatusHistoryService {
  create(tx: Tx, input: {
    afterSaleId: string;
    fromStatus?: AfterSaleStatus | null;
    toStatus: AfterSaleStatus;
    reason?: string;
    operatorType?: AfterSaleOperatorType;
    operatorId?: string;
    meta?: Prisma.InputJsonValue;
  }) {
    return tx.afterSaleStatusHistory.create({
      data: {
        afterSaleId: input.afterSaleId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        reason: input.reason,
        operatorType: input.operatorType,
        operatorId: input.operatorId,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
  }
}
```

- [ ] **Step 4: Implement refund service boundary**

Create `after-sale-refund.service.ts` with these public methods:

```ts
async createOrGetRefund(afterSaleId: string): Promise<Refund>
async startRefund(afterSaleId: string, operator: { type: AfterSaleOperatorType; id?: string }): Promise<Refund>
async handleRefundSuccess(refundId: string, providerRefundId?: string | null): Promise<void>
async handleRefundFailure(refundId: string, reason: string): Promise<void>
async retryRefund(refundId: string, operator: { type: AfterSaleOperatorType; id?: string }): Promise<Refund>
```

Use this refund key:

```ts
const merchantRefundNo = `AS-${afterSaleId}`;
```

Use this transaction pattern for writes:

```ts
await this.prisma.$transaction(async (tx) => {
  const request = await tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
  if (!request) throw new NotFoundException('售后单不存在');
  const refund = await tx.refund.upsert({
    where: { merchantRefundNo },
    create: {
      orderId: request.orderId,
      afterSaleId,
      amount: request.refundAmount || 0,
      status: 'REFUNDING',
      reason: '售后退款',
      merchantRefundNo,
    },
    update: {},
  });
  await tx.afterSaleRequest.update({
    where: { id: afterSaleId },
    data: { status: 'REFUNDING', refundId: refund.id },
  });
  await this.history.create(tx, { afterSaleId, fromStatus: request.status, toStatus: 'REFUNDING', operatorType: operator.type, operatorId: operator.id });
  return refund;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

`retryRefund` must preserve the existing 30 second retry throttle and `refund-retry` advisory lock:

```ts
await tx.$queryRaw`
  SELECT pg_advisory_xact_lock(
    hashtext('refund-retry'),
    hashtext(${refundId})
  )
`;

const recentRetry = await tx.refundStatusHistory.findFirst({
  where: {
    refundId,
    toStatus: 'REFUNDING',
    remark: { contains: '手动重试' },
    createdAt: { gte: new Date(Date.now() - 30_000) },
  },
});
if (recentRetry) {
  throw new BadRequestException('请勿频繁重试，请 30 秒后再试');
}
```

- [ ] **Step 5: Replace scattered refund creation**

In seller/admin/timeout services, remove local `triggerRefund` / `createRefundInTx` implementations and call:

```ts
await this.afterSaleRefundService.startRefund(request.id, {
  type: 'SELLER_STAFF',
  id: staffId,
});
```

For admin:

```ts
await this.afterSaleRefundService.startRefund(request.id, {
  type: 'ADMIN',
  id: adminId,
});
```

For timeout:

```ts
await this.afterSaleRefundService.startRefund(request.id, {
  type: 'SYSTEM',
});
```

- [ ] **Step 6: Delegate AS refund compensation**

In `PaymentService.retryStaleAutoRefunds`, after a successful `AS-` refund result, call:

```ts
if (claim.merchantRefundNo.startsWith('AS-') && this.afterSaleRefundService) {
  await this.afterSaleRefundService.handleRefundSuccess(refund.id, result.providerRefundId || null);
  continue;
}
```

On failure:

```ts
if (claim.merchantRefundNo.startsWith('AS-') && this.afterSaleRefundService) {
  await this.afterSaleRefundService.handleRefundFailure(refund.id, result.message);
  continue;
}
```

- [ ] **Step 7: Add refund relation consistency scanner**

Create `backend/src/modules/after-sale/after-sale-refund-consistency.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AfterSaleRefundConsistencyService {
  private readonly logger = new Logger(AfterSaleRefundConsistencyService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 5 3 * * *')
  async scan() {
    const mismatches = await this.prisma.$queryRaw<Array<{
      afterSaleId: string;
      requestRefundId: string | null;
      refundId: string | null;
      refundAfterSaleId: string | null;
    }>>`
      SELECT
        a.id AS "afterSaleId",
        a."refundId" AS "requestRefundId",
        r.id AS "refundId",
        r."afterSaleId" AS "refundAfterSaleId"
      FROM after_sale_request a
      FULL JOIN "Refund" r
        ON r."afterSaleId" = a.id OR a."refundId" = r.id
      WHERE r."afterSaleId" IS NOT NULL
        AND (
          a.id IS NULL
          OR a."refundId" IS NULL
          OR a."refundId" <> r.id
          OR r."afterSaleId" <> a.id
        )
      LIMIT 100
    `;

    if (mismatches.length > 0) {
      this.logger.error(`售后退款双向关系不一致: ${JSON.stringify(mismatches)}`);
    }
    return mismatches;
  }
}
```

Register it in `AfterSaleModule`. Add a unit test that mocks `$queryRaw` returning one mismatch and asserts `scan()` returns it.

- [ ] **Step 8: Run focused backend tests**

```bash
cd backend && npm test -- after-sale-refund.service.spec.ts after-sale-refund-consistency.service.spec.ts payment.service.refund.spec.ts admin-orders.service.refund-retry.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/after-sale backend/src/modules/seller/after-sale backend/src/modules/admin/after-sale backend/src/modules/payment
git commit -m "feat(after-sale): centralize refund lifecycle"
```

### Task 4: Shipping Payment And Payment Callback

**Files:**
- Create `backend/src/modules/after-sale/after-sale-shipping-payment.service.ts`
- Create `backend/src/modules/after-sale/after-sale-shipping-payment.service.spec.ts`
- Modify `backend/src/modules/after-sale/after-sale.module.ts`
- Modify `backend/src/modules/payment/payment.service.ts`
- Modify `backend/src/modules/payment/payment.controller.ts`
- Modify `backend/src/modules/payment/payment.module.ts`

- [ ] **Step 1: Write shipping payment tests**

Create tests with mocked Prisma and checkout service calls:

```ts
describe('AfterSaleShippingPaymentService', () => {
  const tx = {
    afterSaleRequest: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    afterSaleShippingPayment: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn((cb) => cb(tx)) };
  const checkoutService = { handlePaymentSuccess: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.afterSaleRequest.findFirst.mockResolvedValue({
      id: 'as_001',
      userId: 'user_001',
      status: 'APPROVED',
      requiresReturn: true,
      returnShippingPayer: 'BUYER',
    });
    tx.afterSaleShippingPayment.upsert.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      amount: 18,
      status: 'UNPAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    });
  });

  it('creates one payment using AS_SHIP_PAY-afterSaleId', async () => {
    await service.createOrGetPaymentForBuyer('user_001', 'as_001');

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantPaymentNo: 'AS_SHIP_PAY_as_001' },
      create: expect.objectContaining({
        afterSaleId: 'as_001',
        amount: 18,
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      }),
    }));
  });

  it('marks payment paid without creating an order', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      status: 'UNPAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    });

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_001', new Date('2026-05-09T00:00:00Z'));

    expect(tx.afterSaleShippingPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantPaymentNo: 'AS_SHIP_PAY_as_001' },
      data: expect.objectContaining({ status: 'PAID', providerPaymentNo: 'trade_001' }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({ returnShippingPaidAt: expect.any(Date) }),
    }));
    expect(checkoutService.handlePaymentSuccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
cd backend && npm test -- after-sale-shipping-payment.service.spec.ts
```

Expected: FAIL until service exists.

- [ ] **Step 3: Implement service**

Public methods:

```ts
async estimateReturnShippingFee(afterSaleId: string): Promise<number>
async createOrGetPayment(afterSaleId: string): Promise<AfterSaleShippingPayment>
async handlePaymentSuccess(merchantPaymentNo: string, providerPaymentNo?: string | null, paidAt?: Date): Promise<void>
async handlePaymentFailure(merchantPaymentNo: string, reason: string): Promise<void>
async refundShippingPayment(afterSaleId: string, reason: string): Promise<void>
```

Implement `estimateReturnShippingFee` without hardcoding inside the method:

First add the config key in `backend/src/modules/after-sale/after-sale.constants.ts`:

```ts
RETURN_SHIPPING_FEE_DEFAULT: 'RETURN_SHIPPING_FEE_DEFAULT',
```

And default:

```ts
RETURN_SHIPPING_FEE_DEFAULT: 10,
```

```ts
async estimateReturnShippingFee(afterSaleId: string): Promise<number> {
  const configured = await getConfigValue(
    this.prisma,
    'RETURN_SHIPPING_FEE_DEFAULT',
    10,
  );
  return Math.max(0, Math.round(configured * 100) / 100);
}
```

This phase uses `RuleConfig.RETURN_SHIPPING_FEE_DEFAULT` for buyer-paid return shipping estimates, with `10` yuan as the fallback. A later phase may replace this with a real SF quotation API without changing the payment/waybill state machine.

Use this status transition for success:

```ts
await tx.afterSaleShippingPayment.update({
  where: { merchantPaymentNo },
  data: { status: 'PAID', providerPaymentNo, paidAt },
});
await tx.afterSaleRequest.update({
  where: { id: payment.afterSaleId },
  data: { returnShippingPaidAt: paidAt ?? new Date() },
});
```

- [ ] **Step 4: Route payment callback**

In `PaymentService.handlePaymentCallback`, before the old `Payment` lookup, add:

```ts
if (merchantOrderNo.startsWith('AS_SHIP_PAY_') && this.afterSaleShippingPaymentService) {
  if (status === 'SUCCESS') {
    await this.afterSaleShippingPaymentService.handlePaymentSuccess(
      merchantOrderNo,
      providerTxnId,
      paidAt ? new Date(paidAt) : new Date(),
    );
    return { code: 'SUCCESS', message: '售后退货运费支付成功' };
  }
  await this.afterSaleShippingPaymentService.handlePaymentFailure(merchantOrderNo, '支付失败');
  return { code: 'SUCCESS', message: '售后退货运费支付失败已记录' };
}
```

In `PaymentController.handleAlipayNotify`, amount verification must allow `AS_SHIP_PAY_`:

```ts
if (status === 'SUCCESS' && body.out_trade_no.startsWith('AS_SHIP_PAY_')) {
  await this.paymentService.assertAfterSaleShippingPaymentAmountMatches(
    body.out_trade_no,
    body.total_amount,
  );
}
```

Implement `PaymentService.assertAfterSaleShippingPaymentAmountMatches(outTradeNo, totalAmount)`:

```ts
async assertAfterSaleShippingPaymentAmountMatches(outTradeNo: string, totalAmount: string) {
  const payment = await this.prisma.afterSaleShippingPayment.findUnique({
    where: { merchantPaymentNo: outTradeNo },
    select: { amount: true, status: true },
  });
  if (!payment) throw new BadRequestException('售后退货运费支付单不存在');
  const expectedFen = Math.round(payment.amount * 100);
  const actualFen = Math.round(Number(totalAmount) * 100);
  if (expectedFen !== actualFen) {
    throw new BadRequestException(`售后退货运费金额不匹配: expected=${expectedFen}, actual=${actualFen}`);
  }
}
```

- [ ] **Step 5: Run focused tests**

```bash
cd backend && npm test -- after-sale-shipping-payment.service.spec.ts payment.controller.spec.ts payment.service.confirm-alipay.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/after-sale backend/src/modules/payment
git commit -m "feat(after-sale): add return shipping payment"
```

### Task 5: Buyer Return Waybill Service

**Files:**
- Create `backend/src/modules/after-sale/after-sale-return-shipping.service.ts`
- Create `backend/src/modules/after-sale/after-sale-return-shipping.service.spec.ts`
- Create `backend/src/modules/after-sale/dto/create-return-waybill.dto.ts`
- Create `backend/src/modules/after-sale/dto/create-shipping-payment.dto.ts`
- Modify `backend/src/modules/after-sale/after-sale.controller.ts`
- Modify `backend/src/modules/after-sale/after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale-timeout.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.module.ts`

- [ ] **Step 1: Write return waybill tests**

Create tests for these behaviors:

```ts
describe('AfterSaleReturnShippingService', () => {
  const tx = {
    afterSaleRequest: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn((cb) => cb(tx)) };
  const shippingService = {
    createCarrierWaybill: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.afterSaleRequest.findFirst.mockResolvedValue({
      id: 'as_001',
      userId: 'user_1',
      orderId: 'order_001',
      status: 'APPROVED',
      requiresReturn: true,
      returnShippingPayer: 'BUYER',
      returnShippingPaidAt: new Date('2026-05-09T00:00:00Z'),
      order: { addressSnapshot: { receiverName: '买家', receiverPhone: '13800000000' } },
      orderItem: { companyId: 'company_001' },
    });
    shippingService.createCarrierWaybill.mockResolvedValue({
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      waybillNo: 'SF1234567890',
      waybillUrl: 'https://sf.example/waybill',
      labelUrl: 'https://sf.example/label',
      sfOrderId: 'sf_order_001',
    });
  });

  it('rejects waybill creation when buyer-paid shipping is unpaid', async () => {
    tx.afterSaleRequest.findFirst.mockResolvedValueOnce({
      id: 'as_001',
      userId: 'user_1',
      status: 'APPROVED',
      requiresReturn: true,
      returnShippingPayer: 'BUYER',
      returnShippingPaidAt: null,
    });

    await expect(service.createReturnWaybill('user_1', 'as_001')).rejects.toThrow('请先支付退货运费');
  });

  it('uses AS_RETURN-afterSaleId as idempotency key', async () => {
    expect(service.getReturnWaybillBizNo('as_001')).toBe('AS_RETURN_as_001');
  });

  it('moves approved request to RETURN_SHIPPING after waybill success', async () => {
    await service.createReturnWaybill('user_1', 'as_001');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalledWith(expect.objectContaining({
      bizNo: 'AS_RETURN_as_001',
      carrierCode: 'SF',
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'RETURN_SHIPPING',
        returnWaybillNo: 'SF1234567890',
        returnSfOrderId: 'sf_order_001',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleId: 'as_001',
        toStatus: 'RETURN_SHIPPING',
      }),
    }));
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
cd backend && npm test -- after-sale-return-shipping.service.spec.ts
```

Expected: FAIL until service exists.

- [ ] **Step 3: Implement return waybill service**

The service must use this direction:

```ts
const sender = buyerAddressSnapshot;
const receiver = companyAfterSaleAddress;
const bizNo = `AS_RETURN_${afterSaleId}`;
```

Use `SellerShippingService.createCarrierWaybill()` with a clear wrapper input. After success:

```ts
await tx.afterSaleRequest.update({
  where: { id: afterSaleId },
  data: {
    status: 'RETURN_SHIPPING',
    returnCarrierCode: result.carrierCode,
    returnCarrierName: result.carrierName,
    returnWaybillNo: result.waybillNo,
    returnWaybillUrl: result.waybillUrl,
    returnLabelUrl: result.labelUrl,
    returnSfOrderId: result.sfOrderId,
    returnShippingFee: estimatedFee,
    returnShippingPayer,
  },
});
```

- [ ] **Step 4: Add buyer endpoints**

In controller:

```ts
@Post(':id/return-shipping-payment')
createReturnShippingPayment(
  @CurrentUser('sub') userId: string,
  @Param('id') id: string,
) {
  return this.afterSaleShippingPaymentService.createOrGetPaymentForBuyer(userId, id);
}

@Post(':id/return-waybill')
createReturnWaybill(
  @CurrentUser('sub') userId: string,
  @Param('id') id: string,
) {
  return this.afterSaleReturnShippingService.createReturnWaybill(userId, id);
}
```

- [ ] **Step 5: Implement no-pickup timeout**

In `AfterSaleTimeoutService`, replace the unresolved buyer ship timeout branch with:

```ts
if (!request.returnWaybillNo || requiresBuyerPaymentButUnpaid) {
  await this.closeBuyerShipTimeoutRequest(tx, request);
  return;
}

const cancelResult = await this.afterSaleReturnShippingService.cancelIfNotPickedUp(request.id);
if (cancelResult.cancelled) {
  await this.afterSaleShippingPaymentService.refundShippingPayment(request.id, '退货面单未揽收，售后关闭退还运费');
  await this.closeBuyerShipTimeoutRequest(tx, request);
  return;
}

await tx.afterSaleRequest.update({
  where: { id: request.id },
  data: {
    manualReviewReason: '退货面单已揽收或取消失败',
    manualReviewRequestedAt: new Date(),
  },
});
```

- [ ] **Step 6: Run focused tests**

```bash
cd backend && npm test -- after-sale-return-shipping.service.spec.ts seller-shipping.service.spec.ts
cd backend && npx prisma validate
```

Expected: tests pass and schema validates.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/after-sale
git commit -m "feat(after-sale): generate buyer return waybills"
```

### Task 6: Buyer AfterSale Service Integration

**Files:**
- Modify `backend/src/modules/after-sale/after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.controller.ts`
- Modify `backend/src/modules/after-sale/after-sale-timeout.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.service.spec.ts`

- [ ] **Step 1: Add service integration tests**

Create `backend/src/modules/after-sale/after-sale.service.spec.ts` with cases:

```ts
describe('AfterSaleService integration rules', () => {
  const tx = {
    order: { findUnique: jest.fn() },
    afterSaleRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    afterSaleStatusHistory: { create: jest.fn() },
    product: { findUnique: jest.fn() },
    category: { findUnique: jest.fn() },
    ruleConfig: { findUnique: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((cb) => cb(tx)) };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.order.findUnique.mockResolvedValue({
      id: 'order_001',
      userId: 'user_001',
      status: 'DELIVERED',
      deliveredAt: new Date(),
      goodsAmount: 100,
      shippingFee: 0,
      totalCouponDiscount: 0,
      discountAmount: 0,
      vipDiscountAmount: 0,
      items: [{
        id: 'item_001',
        skuId: 'sku_001',
        sku: { productId: 'product_001' },
        unitPrice: 100,
        quantity: 1,
        isPrize: false,
      }],
    });
    tx.product.findUnique.mockResolvedValue({ returnPolicy: 'RETURNABLE', categoryId: null });
    tx.ruleConfig.findUnique.mockResolvedValue(null);
    tx.afterSaleRequest.findFirst.mockResolvedValue(null);
    tx.afterSaleRequest.create.mockResolvedValue({ id: 'as_001' });
  });

  it('creates NO_REASON_EXCHANGE with targetSkuId equal to original sku', async () => {
    await service.apply('user_001', 'order_001', {
      orderItemId: 'item_001',
      afterSaleType: 'NO_REASON_EXCHANGE',
      photos: ['https://example.test/p.jpg'],
    } as any);

    expect(tx.afterSaleRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleType: 'NO_REASON_EXCHANGE',
        targetSkuId: 'sku_001',
        targetQuantity: 1,
        returnShippingPayer: 'BUYER',
      }),
    }));
  });

  it('escalate records arbitrationSourceStatus before setting PENDING_ARBITRATION', async () => {
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      userId: 'user_001',
      status: 'SELLER_REJECTED_RETURN',
    });
    tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 1 });

    await service.escalate('user_001', 'as_001');

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001', userId: 'user_001', status: 'SELLER_REJECTED_RETURN' },
      data: expect.objectContaining({
        status: 'PENDING_ARBITRATION',
        arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fromStatus: 'SELLER_REJECTED_RETURN',
        toStatus: 'PENDING_ARBITRATION',
      }),
    }));
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
cd backend && npm test -- after-sale.service.spec.ts
```

Expected: FAIL until service changes are implemented.

- [ ] **Step 3: Update apply flow**

In `apply`, include completed no-reason exchange in completed replacement detection:

```ts
afterSaleType: { in: ['QUALITY_EXCHANGE', 'NO_REASON_EXCHANGE'] },
status: 'COMPLETED',
```

Set target fields:

```ts
targetSkuId: dto.targetSkuId || orderItem.skuId,
targetQuantity: orderItem.quantity,
```

Use `returnShippingPayer`:

```ts
const returnShippingPayer =
  dto.afterSaleType === AfterSaleType.NO_REASON_RETURN ||
  dto.afterSaleType === AfterSaleType.NO_REASON_EXCHANGE
    ? 'BUYER'
    : 'SELLER';
```

- [ ] **Step 4: Update escalate flow**

In `escalate`, use CAS from current status:

```ts
const currentStatus = request.status;
const result = await tx.afterSaleRequest.updateMany({
  where: { id, userId, status: currentStatus },
  data: {
    status: 'PENDING_ARBITRATION',
    arbitrationSourceStatus: currentStatus,
    arbitrationSource: 'BUYER',
  },
});
```

Write status history in the same transaction, using the enum-backed operator type:

```ts
await this.history.create(tx, {
  afterSaleId: id,
  fromStatus: currentStatus,
  toStatus: 'PENDING_ARBITRATION',
  reason: '买家申请平台仲裁',
  operatorType: 'BUYER',
  operatorId: userId,
});
```

- [ ] **Step 5: Add timeline endpoint**

Controller:

```ts
@Get(':id/timeline')
getTimeline(@CurrentUser('sub') userId: string, @Param('id') id: string) {
  return this.afterSaleService.getTimeline(userId, id);
}
```

Service returns:

```ts
return {
  items: histories.map((h) => ({
    id: h.id,
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    reason: h.reason,
    operatorType: h.operatorType,
    createdAt: h.createdAt,
  })),
};
```

- [ ] **Step 6: Run tests**

```bash
cd backend && npm test -- after-sale.service.spec.ts after-sale.utils.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/after-sale
git commit -m "feat(after-sale): wire buyer service flow"
```

### Task 7: Seller And Admin Backend Integration

**Files:**
- Modify `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`
- Modify `backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`
- Modify `backend/src/modules/seller/after-sale/dto/seller-after-sale.dto.ts`
- Create `backend/src/modules/seller/after-sale/seller-after-sale.service.spec.ts`
- Modify `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- Modify `backend/src/modules/admin/after-sale/admin-after-sale.controller.ts`
- Modify `backend/src/modules/admin/after-sale/dto/arbitrate-after-sale.dto.ts`
- Create `backend/src/modules/admin/after-sale/admin-after-sale.service.spec.ts`

- [ ] **Step 1: Write seller tests**

Test cases:

```ts
function createSellerAfterSaleServiceWithMocks() {
  return new SellerAfterSaleService(
    prisma as any,
    configService as any,
    shippingService as any,
    paymentService as any,
    afterSaleRewardService as any,
    inboxService as any,
  );
}

describe('SellerAfterSaleService exchange support', () => {
  const service = createSellerAfterSaleServiceWithMocks();

  it('treats NO_REASON_EXCHANGE as exchange type', async () => {
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      afterSaleType: 'NO_REASON_EXCHANGE',
      status: 'APPROVED',
      order: { items: [{ id: 'item_001', companyId: 'company_001' }] },
      orderItemId: 'item_001',
    });

    await service.generateWaybill('company_001', 'staff_001', 'as_001', 'SF');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalled();
  });

  it('allows RECEIVED_BY_SELLER exchange to generate replacement waybill', async () => {
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_002',
      afterSaleType: 'NO_REASON_EXCHANGE',
      status: 'RECEIVED_BY_SELLER',
      order: { items: [{ id: 'item_001', companyId: 'company_001' }] },
      orderItemId: 'item_001',
    });

    await service.generateWaybill('company_001', 'staff_001', 'as_002', 'SF');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalledWith(expect.objectContaining({
      bizNo: 'AS_as_002',
    }));
  });
});
```

- [ ] **Step 2: Write admin arbitration tests**

Test cases:

```ts
function createAdminAfterSaleServiceWithMocks() {
  return new AdminAfterSaleService(
    prisma as any,
    paymentService as any,
    afterSaleRewardService as any,
    inboxService as any,
    afterSaleRefundService as any,
  );
}

describe('AdminAfterSaleService arbitration', () => {
  const service = createAdminAfterSaleServiceWithMocks();

  it('approves seller rejected return as refunding for return type', async () => {
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_return_001',
      status: 'SELLER_REJECTED_RETURN',
      arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
      afterSaleType: 'NO_REASON_RETURN',
    });
    afterSaleRefundService.startRefund.mockResolvedValue({ id: 'refund_001' });

    await service.arbitrate('as_return_001', { status: 'APPROVED', reason: '买家举证成立' }, 'admin_001');

    expect(afterSaleRefundService.startRefund).toHaveBeenCalledWith('as_return_001', {
      type: 'ADMIN',
      id: 'admin_001',
    });
  });

  it('approves seller rejected return as received by seller for exchange type', async () => {
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_exchange_001',
      status: 'SELLER_REJECTED_RETURN',
      arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
      afterSaleType: 'NO_REASON_EXCHANGE',
    });
    prisma.afterSaleRequest.update.mockResolvedValue({ id: 'as_exchange_001', status: 'RECEIVED_BY_SELLER' });

    await service.arbitrate('as_exchange_001', { status: 'APPROVED', reason: '买家举证成立' }, 'admin_001');

    expect(prisma.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_exchange_001' },
      data: expect.objectContaining({ status: 'RECEIVED_BY_SELLER' }),
    }));
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

```bash
cd backend && npm test -- seller-after-sale.service.spec.ts admin-after-sale.service.spec.ts
```

Expected: FAIL until implementation exists.

- [ ] **Step 4: Implement seller type guards**

Add helpers:

```ts
const isExchangeType = (type: string) =>
  type === 'QUALITY_EXCHANGE' || type === 'NO_REASON_EXCHANGE';

const isReturnType = (type: string) =>
  type === 'QUALITY_RETURN' || type === 'NO_REASON_RETURN';
```

Use these guards in `approve`, `confirmReceiveReturn`, `ship`, `generateWaybill`.

- [ ] **Step 5: Add seller rejected return waybill**

Controller:

```ts
@Post(':id/seller-return-waybill')
generateSellerReturnWaybill(
  @CurrentSeller() seller: CurrentSellerPayload,
  @Param('id') id: string,
  @Body() dto: { carrierCode?: string },
) {
  return this.service.generateSellerReturnWaybill(seller.companyId, seller.staffId, id, dto.carrierCode || 'SF');
}
```

Service must only allow `SELLER_REJECTED_RETURN` and use:

```ts
const bizNo = `AS_REJECT_RETURN_${request.id}`;
```

- [ ] **Step 6: Implement admin arbitration**

`ARBITRABLE_STATUSES`:

```ts
const ARBITRABLE_STATUSES = [
  'PENDING_ARBITRATION',
  'REQUESTED',
  'UNDER_REVIEW',
  'REJECTED',
  'SELLER_REJECTED_RETURN',
] as const;
```

For `SELLER_REJECTED_RETURN` approval:

```ts
if (isReturnType(request.afterSaleType)) {
  await this.afterSaleRefundService.startRefund(request.id, { type: 'ADMIN', id: adminId });
  return this.findById(request.id);
}

await tx.afterSaleRequest.update({
  where: { id: request.id },
  data: { status: 'RECEIVED_BY_SELLER' },
});
```

Extend admin list query DTO/service to support manual review filtering:

```ts
if (manualReview === 'pending') {
  where.manualReviewReason = { not: null };
  where.manualReviewResolvedAt = null;
}
```

- [ ] **Step 7: Add admin retry endpoint**

Controller:

```ts
@Post(':id/refunds/:refundId/retry')
retryRefund(
  @CurrentAdmin('sub') adminId: string,
  @Param('id') id: string,
  @Param('refundId') refundId: string,
) {
  return this.service.retryRefund(id, refundId, adminId);
}
```

Service implementation must call `AfterSaleRefundService.retryRefund(refundId, { type: 'ADMIN', id: adminId })`. Do not call `PaymentService.initiateRefund()` directly from the controller/service. `AfterSaleRefundService.retryRefund` owns the `refund-retry` advisory lock and 30 second throttle shown in Task 3.

- [ ] **Step 8: Run focused tests**

```bash
cd backend && npm test -- seller-after-sale.service.spec.ts admin-after-sale.service.spec.ts after-sale-refund.service.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 9: Commit seller backend changes**

```bash
git add backend/src/modules/seller/after-sale
git commit -m "feat(seller/after-sale): wire exchange and return waybills"
```

- [ ] **Step 10: Commit admin backend changes**

```bash
git add backend/src/modules/admin/after-sale
git commit -m "feat(admin/after-sale): wire arbitration and refund retry"
```

### Task 8: Order Summary And Backend Verification

**Files:**
- Modify `backend/src/modules/order/order.service.ts`
- Modify `backend/src/modules/order/map-order.spec.ts`
- Modify `backend/src/modules/after-sale/after-sale-reward.service.ts`

- [ ] **Step 1: Write order mapping test**

Add to `backend/src/modules/order/map-order.spec.ts`:

```ts
it('maps active afterSaleSummary with id and shipping payment status', () => {
  const mapped = service.mapOrder({
    id: 'order_1',
    afterSaleRequests: [{
      id: 'as_1',
      status: 'APPROVED',
      afterSaleType: 'NO_REASON_EXCHANGE',
      requiresReturn: true,
      refundAmount: null,
      shippingPayment: { status: 'UNPAID' },
    }],
  } as any);

  expect(mapped.afterSaleSummary).toMatchObject({
    id: 'as_1',
    status: 'APPROVED',
    type: 'NO_REASON_EXCHANGE',
    requiresReturn: true,
    requiresBuyerShippingPayment: true,
    returnShippingPaymentStatus: 'UNPAID',
  });
});

it('maps legacy manual return logistics without requiring shipping payment', () => {
  const mapped = service.mapOrder({
    id: 'order_legacy',
    afterSaleRequests: [{
      id: 'as_legacy',
      status: 'RETURN_SHIPPING',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      returnShippingPayer: null,
      returnCarrierName: '顺丰速运',
      returnWaybillNo: 'SFOLD123',
      returnSfOrderId: null,
      shippingPayment: null,
    }],
  } as any);

  expect(mapped.afterSaleSummary).toMatchObject({
    id: 'as_legacy',
    returnShippingPaymentStatus: 'NOT_REQUIRED',
    returnShippingPayer: 'SELLER',
    isLegacyManualReturnShipping: true,
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
cd backend && npm test -- map-order.spec.ts
```

Expected: FAIL until `afterSaleSummary` exists.

- [ ] **Step 3: Implement order summary**

In order include/select, add active after-sale requests with shipping payment. In mapper:

```ts
const returnShippingPayer =
  activeAfterSale.returnShippingPayer ??
  (activeAfterSale.afterSaleType === 'NO_REASON_RETURN' || activeAfterSale.afterSaleType === 'NO_REASON_EXCHANGE'
    ? 'BUYER'
    : 'SELLER');

afterSaleSummary: activeAfterSale
  ? {
      id: activeAfterSale.id,
      status: activeAfterSale.status,
      type: activeAfterSale.afterSaleType,
      requiresReturn: activeAfterSale.requiresReturn,
      refundAmount: activeAfterSale.refundAmount,
      returnShippingPayer,
      returnShippingCostNote:
        returnShippingPayer === 'SELLER'
          ? '质量售后退货运费由商家承担，平台生成顺丰面单，不进入本次退款金额'
          : undefined,
      isLegacyManualReturnShipping: Boolean(activeAfterSale.returnWaybillNo && !activeAfterSale.returnSfOrderId),
      requiresBuyerShippingPayment:
        activeAfterSale.requiresReturn &&
        returnShippingPayer === 'BUYER' &&
        activeAfterSale.shippingPayment?.status !== 'PAID',
      returnShippingPaymentStatus: activeAfterSale.shippingPayment?.status || 'NOT_REQUIRED',
    }
  : null,
```

- [ ] **Step 4: Fix reward service duplicate select**

In `AfterSaleRewardService.checkAndMarkOrderRefunded`, remove duplicate `select` blocks while preserving existing behavior.

- [ ] **Step 5: Run backend verification**

```bash
cd backend && npm test -- after-sale.utils.spec.ts after-sale-refund.service.spec.ts after-sale-shipping-payment.service.spec.ts after-sale-return-shipping.service.spec.ts map-order.spec.ts
cd backend && npx prisma validate
cd backend && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/order backend/src/modules/after-sale
git commit -m "feat(orders): expose after-sale summary"
```

### Task 9: Buyer App Integration

**Files:**
- Modify `src/types/domain/Order.ts`
- Modify `src/constants/statuses.ts`
- Modify `src/repos/AfterSaleRepo.ts`
- Modify `src/repos/OrderRepo.ts`
- Modify `app/orders/[id].tsx`
- Modify `app/orders/after-sale/[id].tsx`
- Modify `app/orders/after-sale-detail/[id].tsx`
- Modify `docs/architecture/frontend.md`
- Modify `plan.md`

- [ ] **Step 1: Extend buyer types**

In `src/types/domain/Order.ts`:

```ts
export type AfterSaleType =
  | 'NO_REASON_RETURN'
  | 'NO_REASON_EXCHANGE'
  | 'QUALITY_RETURN'
  | 'QUALITY_EXCHANGE';

export type ReturnShippingPaymentStatus =
  | 'NOT_REQUIRED'
  | 'UNPAID'
  | 'PAID'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'FAILED'
  | 'CLOSED';

export type OrderAfterSaleSummary = {
  id: string;
  status: AfterSaleDetailStatus;
  type: AfterSaleType;
  requiresReturn: boolean;
  refundAmount?: number | null;
  returnShippingPayer?: 'BUYER' | 'SELLER' | 'PLATFORM';
  returnShippingCostNote?: string;
  isLegacyManualReturnShipping?: boolean;
  requiresBuyerShippingPayment?: boolean;
  returnShippingPaymentStatus?: ReturnShippingPaymentStatus;
};
```

- [ ] **Step 2: Extend repo**

In `src/repos/AfterSaleRepo.ts`, add:

```ts
getEligibility: async (orderId: string): Promise<Result<AfterSaleEligibilityResponse>> =>
  ApiClient.get<AfterSaleEligibilityResponse>(`/after-sale/orders/${orderId}/eligibility`),

createReturnShippingPayment: async (id: string): Promise<Result<AfterSaleShippingPayment>> =>
  ApiClient.post<AfterSaleShippingPayment>(`/after-sale/${id}/return-shipping-payment`),

createReturnWaybill: async (id: string): Promise<Result<AfterSaleRequest>> =>
  ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/return-waybill`),

getTimeline: async (id: string): Promise<Result<AfterSaleTimelineResponse>> =>
  ApiClient.get<AfterSaleTimelineResponse>(`/after-sale/${id}/timeline`),
```

- [ ] **Step 3: Update apply page**

In `app/orders/after-sale/[id].tsx`, replace local type inference with:

```ts
const eligibilityQuery = useQuery({
  queryKey: ['after-sale-eligibility', orderId],
  queryFn: async () => {
    const res = await AfterSaleRepo.getEligibility(orderId);
    if (!res.ok) throw new Error(res.error.message);
    return res.data;
  },
});
```

Render only enabled options:

```ts
const enabledOptions = selectedItem?.options.filter((option) => option.enabled) ?? [];
```

- [ ] **Step 4: Update detail page**

In `app/orders/after-sale-detail/[id].tsx`, remove hand-filled return carrier as primary action. Add actions:

```ts
if (detail.requiresBuyerShippingPayment && detail.returnShippingPaymentStatus === 'UNPAID') {
  return <Button title="支付退货运费" onPress={handlePayReturnShipping} />;
}

if (detail.status === 'APPROVED' && detail.requiresReturn && detail.returnShippingPaymentStatus !== 'UNPAID') {
  return <Button title="生成顺丰退货面单" onPress={handleCreateReturnWaybill} />;
}
```

Refund display:

```ts
const shippingCostText =
  detail.returnShippingPayer === 'SELLER'
    ? '质量售后退货运费由商家承担，平台顺丰面单寄回，不会作为单独退款打给你'
    : undefined;

const refundText =
  detail.refundStatus === 'FAILED' && detail.refundEscalatedToManual
    ? '退款已转人工处理'
    : detail.status === 'REFUNDING'
      ? '退款处理中'
      : '退款完成';
```

- [ ] **Step 5: Update order detail**

In `app/orders/[id].tsx`, use:

```ts
router.push(`/orders/after-sale-detail/${order.afterSaleSummary.id}`);
```

For replacement confirmation:

```ts
await AfterSaleRepo.confirmReceive(order.afterSaleSummary.id);
```

- [ ] **Step 6: Run buyer type check**

Run:

```bash
npx tsc -b
```

Expected: TypeScript exits 0.

- [ ] **Step 7: Update docs required by project rules**

Update `docs/architecture/frontend.md` buyer order/after-sale sections and `plan.md` Batch progress with the exact files completed.

- [ ] **Step 8: Commit**

```bash
git add src/types/domain/Order.ts src/constants/statuses.ts src/repos/AfterSaleRepo.ts src/repos/OrderRepo.ts app/orders/[id].tsx app/orders/after-sale/[id].tsx app/orders/after-sale-detail/[id].tsx docs/architecture/frontend.md plan.md
git commit -m "feat(app): wire after-sale closure"
```

### Task 10: Seller Frontend Integration

**Files:**
- Modify `seller/src/api/after-sale.ts`
- Modify `seller/src/pages/after-sale/index.tsx`
- Modify `seller/src/pages/after-sale/detail.tsx`

- [ ] **Step 1: Extend seller API types**

In `seller/src/api/after-sale.ts`:

```ts
export type SellerAfterSaleType =
  | 'NO_REASON_RETURN'
  | 'NO_REASON_EXCHANGE'
  | 'QUALITY_RETURN'
  | 'QUALITY_EXCHANGE';

export const generateSellerReturnWaybill = (
  id: string,
  carrierCode = 'SF',
): Promise<WaybillResult> =>
  client.post(`/seller/after-sale/${id}/seller-return-waybill`, { carrierCode });

export const getAfterSaleTimeline = (id: string): Promise<{ items: AfterSaleTimelineItem[] }> =>
  client.get(`/seller/after-sale/${id}/timeline`);
```

- [ ] **Step 2: Fix status button matrix**

In `seller/src/pages/after-sale/detail.tsx`:

```ts
const isExchange = afterSale.afterSaleType === 'QUALITY_EXCHANGE' || afterSale.afterSaleType === 'NO_REASON_EXCHANGE';
const isReturn = afterSale.afterSaleType === 'QUALITY_RETURN' || afterSale.afterSaleType === 'NO_REASON_RETURN';
const canShipReplacement = isExchange && ['APPROVED', 'RECEIVED_BY_SELLER'].includes(afterSale.status);
```

For `RECEIVED_BY_SELLER`, do not call `approveAfterSale`. Render:

```tsx
{canShipReplacement && (
  <Button type="primary" onClick={() => handleGenerateWaybill('SF')}>
    生成换货面单
  </Button>
)}
```

- [ ] **Step 3: Update reject-return modal**

Replace required manual `returnWaybillNo` with generated waybill action:

```tsx
<Button onClick={() => generateSellerReturnWaybill(afterSale.id, 'SF')}>
  生成回寄面单
</Button>
```

- [ ] **Step 4: Run seller build**

```bash
cd seller && npm run build
```

Expected: build exits 0.

- [ ] **Step 5: Commit**

```bash
git add seller/src/api/after-sale.ts seller/src/pages/after-sale/index.tsx seller/src/pages/after-sale/detail.tsx
git commit -m "feat(seller): wire after-sale exchange flow"
```

### Task 11: Admin Frontend Integration

**Files:**
- Modify `admin/src/api/after-sale.ts`
- Modify `admin/src/pages/after-sale/index.tsx`
- Modify `admin/src/pages/categories/index.tsx` if copy needs config key clarity

- [ ] **Step 1: Extend admin API**

In `admin/src/api/after-sale.ts`:

```ts
export const retryAfterSaleRefund = (
  afterSaleId: string,
  refundId: string,
): Promise<AdminAfterSale> =>
  client.post(`/admin/after-sale/${afterSaleId}/refunds/${refundId}/retry`);

export const getAfterSaleTimeline = (
  id: string,
): Promise<{ items: AfterSaleTimelineItem[] }> =>
  client.get(`/admin/after-sale/${id}/timeline`);
```

Add fields:

```ts
refund?: {
  id: string;
  amount: number;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';
  merchantRefundNo: string;
  providerRefundId?: string | null;
};
refundHistory?: Array<{ id: string; fromStatus?: string | null; toStatus: string; remark?: string; createdAt: string }>;
statusHistory?: Array<{ id: string; fromStatus?: string | null; toStatus: string; reason?: string; operatorType?: string; createdAt: string }>;
manualReviewReason?: string | null;
manualReviewRequestedAt?: string | null;
manualReviewResolvedAt?: string | null;
```

- [ ] **Step 2: Add refund retry action**

Use Ant Design hook API only:

```tsx
const { message, modal } = App.useApp();

const handleRetryRefund = (record: AdminAfterSale) => {
  if (!record.refund?.id) return;
  modal.confirm({
    title: '重试售后退款',
    content: `确认重试退款单 ${record.refund.merchantRefundNo}？`,
    onOk: async () => {
      await retryAfterSaleRefund(record.id, record.refund!.id);
      message.success('已发起退款重试');
      actionRef.current?.reload();
    },
  });
};
```

- [ ] **Step 3: Show arbitration source and histories**

In the detail Drawer/Modal, render:

```tsx
<Descriptions.Item label="仲裁来源状态">{record.arbitrationSourceStatus || '-'}</Descriptions.Item>
<Descriptions.Item label="退货运费责任">{record.returnShippingPayer || '-'}</Descriptions.Item>
<Descriptions.Item label="退货运费">{record.returnShippingFee ?? '-'}</Descriptions.Item>
<Descriptions.Item label="人工处理原因">{record.manualReviewReason || '-'}</Descriptions.Item>
<Descriptions.Item label="退款状态">{record.refund?.status || '-'}</Descriptions.Item>
```

Add a table filter for manual review:

```tsx
{
  title: '人工处理',
  dataIndex: 'manualReviewReason',
  valueType: 'select',
  valueEnum: {
    pending: { text: '待人工处理' },
  },
  transform: (value) => value === 'pending' ? { manualReview: 'pending' } : {},
}
```

- [ ] **Step 4: Run admin build**

```bash
cd admin && npm run build
```

Expected: build exits 0.

- [ ] **Step 5: Commit**

```bash
git add admin/src/api/after-sale.ts admin/src/pages/after-sale/index.tsx admin/src/pages/categories/index.tsx
git commit -m "feat(admin): expose after-sale refund operations"
```

### Task 12: Final Verification And Documentation

**Files:**
- Modify `docs/features/refund.md`
- Modify `docs/issues/app-tofix3.md`
- Modify `docs/issues/tofix-safe.md`
- Modify `docs/architecture/frontend.md`
- Modify `plan.md`
- Modify `AGENTS.md`

- [ ] **Step 1: Update authoritative docs**

Add the following facts to `docs/features/refund.md`:

```markdown
- 售后类型为 `NO_REASON_RETURN`、`NO_REASON_EXCHANGE`、`QUALITY_RETURN`、`QUALITY_EXCHANGE`。
- 商品/分类 `RETURNABLE` 默认 7 天无理由退/换；`NON_RETURNABLE` 默认 24 小时内仅支持质量退/换。
- 买家退回商家的主流程为平台生成顺丰退货面单。
- 无理由退货运费优先从退款扣除，不足时买家先付。
- 无理由换货高金额寄回时买家先付退货运费。
- 质量退/换寄回运费由商家承担；买家不垫付、不单独收运费退款，平台生成顺丰面单，成本在商家责任记录中体现。
- 旧手填物流售后单继续展示原快递公司和单号，不强制补退货面单或运费支付单。
```

Add a closed-loop note to `docs/issues/tofix-safe.md` for:

```markdown
- 售后退款 `AS-${afterSaleId}` 幂等键和 Serializable 事务。
- 买家退货运费支付 `AS_SHIP_PAY_${afterSaleId}` 幂等键。
- 退货面单 `AS_RETURN_${afterSaleId}` 幂等键。
- 卖家拒收回寄面单 `AS_REJECT_RETURN_${afterSaleId}` 幂等键。
- `Refund.afterSaleId` 与 `AfterSaleRequest.refundId` 双向一致性巡检每日执行，发现错链/孤儿/重复关系后管理端告警。
```

- [ ] **Step 2: Run backend verification**

```bash
cd backend && npx prisma validate
cd backend && npm test -- after-sale.utils.spec.ts after-sale.service.spec.ts after-sale-refund.service.spec.ts after-sale-refund-consistency.service.spec.ts after-sale-shipping-payment.service.spec.ts after-sale-return-shipping.service.spec.ts seller-after-sale.service.spec.ts admin-after-sale.service.spec.ts map-order.spec.ts payment.service.refund.spec.ts payment.controller.spec.ts
cd backend && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run frontend verification**

```bash
npx tsc -b
cd seller && npm run build
cd admin && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run repo hygiene checks**

```bash
git diff --check
rg -n "TO""DO|TB""D|实施计划中""明确|待""定" docs/superpowers/plans/2026-05-09-after-sale-chain-closure.md docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because no forbidden marker is found.

- [ ] **Step 5: Commit docs**

```bash
git add docs/features/refund.md docs/issues/app-tofix3.md docs/issues/tofix-safe.md docs/architecture/frontend.md plan.md AGENTS.md
git commit -m "docs(after-sale): sync closure implementation notes"
```

## Self-Review

Spec coverage:

- Four after-sale types: Tasks 1, 2, 9, 10, 11.
- Category/product policy and ConfigKey defaults: Task 2.
- Buyer return waybill: Task 5.
- Buyer return shipping payment: Task 4.
- Quality issue shipping cost responsibility: Tasks 2, 5, 11, 12.
- Seller rejected return arbitration paths: Task 7.
- Refund failure buyer/admin split: Tasks 3, 9, 11.
- No-pickup timeout: Task 5.
- Seller rejected return waybill API: Task 7.
- Refund/after-sale dual consistency: Task 1 explicit relation names, Task 3 consistency scanner, Task 12 docs/verification.
- Concurrency coverage: Task 3 includes a `Promise.all` same-afterSaleId refund creation test; Tasks 4/5/7 cover payment, waybill, and arbitration idempotency contracts.
- Existing in-flight after-sale compatibility: Task 1 grandfather backfill and Task 8 legacy manual logistics mapping.

Type consistency:

- `NO_REASON_EXCHANGE` is added to Prisma, backend DTO, buyer types, seller types, admin display.
- `returnShippingPaymentStatus` values match `AfterSaleShippingPaymentStatus` plus buyer-only `NOT_REQUIRED`.
- Refund service uses `AS-${afterSaleId}`; shipping payment uses `AS_SHIP_PAY_${afterSaleId}`; buyer return waybill uses `AS_RETURN_${afterSaleId}`; seller rejected return uses `AS_REJECT_RETURN_${afterSaleId}`.
- `AfterSaleRequest.refundId` and `Refund.afterSaleId` use named Prisma relations: `AfterSaleRefundByRefundId` and `AfterSaleRefundByAfterSaleId`.
- Buyer App verification uses `npx tsc -b`; seller/admin verification uses `npm run build`.

Execution handoff:

- Execute tasks in order. Task 9 can start only after Tasks 1-8 backend API contracts are implemented.
- Seller and admin frontend tasks can run after Task 7 backend contracts are implemented.
