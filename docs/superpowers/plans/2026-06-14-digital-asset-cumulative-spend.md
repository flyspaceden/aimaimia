# 数字资产累计消费 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立独立的数字资产累计消费数据底座，在确认收货后累计用户商品实付金额，并在退款/退货成功后可审计扣回，同时提供买家 App 数字资产中心和管理后台完整管理页。

**Architecture:** 新增独立 `digital-asset` 后端模块，`DigitalAssetAccount` 只保存当前累计值，`DigitalAssetLedger` 保存所有正向、扣回、调整和回填流水。订单确认收货、自动确认收货、售后退款成功和历史回填都只调用同一个 `DigitalAssetService`，由服务内部统一处理金额口径、行级分摊、幂等键、Serializable 事务和审计。买家 App 只展示“累计消费金额”和规则占位，管理后台提供查询、导出、详情、超级管理员调整和占位设置。

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Expo 54 / React Native 0.81, React Query, Vite React 19, Ant Design 5.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-14-digital-asset-cumulative-spend-design.md`
- Data model authority: `docs/architecture/data-system.md`
- Buyer App authority: `docs/architecture/frontend.md`
- App responsive authority: `docs/architecture/responsive-design.md`
- Admin frontend authority: `docs/architecture/admin-frontend.md`
- Safety checklist: `docs/issues/tofix-safe.md`
- Project task board: `plan.md`

## Execution Status (2026-06-14)

- [x] Spec and plan registered in `AGENTS.md`; digital asset decision added as an independent system separate from Reward, Coupon, and referral/revenue-share counters.
- [x] Prisma schema, migration, and seed permissions added for `DigitalAssetAccount`, `DigitalAssetLedger`, `DigitalAssetLedgerType`, `DigitalAssetLedgerDirection`, and `digital_assets:*`.
- [x] Core backend module implemented with `DigitalAssetService`, buyer `/me/digital-assets` APIs, Serializable account mutations, unique ledger idempotency keys, and placeholder-only settings.
- [x] Order confirmation, auto confirmation, after-sale refund success, and direct auto-refund success paths wired to credit/debit digital asset ledgers without blocking the primary order/refund state transitions.
- [x] Historical backfill script added as dry-run by default with explicit `--execute` write mode.
- [x] Admin APIs added for overview, accounts, export, settings, account detail, ledger list, and super-admin adjustment.
- [x] Buyer App added “数字资产” entry under 我的页 and `/me/digital-assets`, using wording “累计消费金额”.
- [x] Admin frontend added `/digital-assets`, menu/route/permissions, CSV export, detail drawer, adjustment modal, and user detail card.
- [x] Documentation synced: `docs/architecture/data-system.md`, `docs/architecture/frontend.md`, `docs/architecture/admin-frontend.md`, `docs/issues/tofix-safe.md`, `plan.md`.
- [x] Verification: `backend npx prisma validate`, targeted backend Jest 9 suites / 91 tests, `backend npm run build`, root `npx tsc -b`, and `admin npm run build` passed.

## File Structure Map

### Backend Schema And Seed

- Modify: `backend/prisma/schema.prisma`
  - Add `DigitalAssetLedgerType`, `DigitalAssetLedgerDirection`.
  - Add `DigitalAssetAccount`, `DigitalAssetLedger`.
  - Add reverse relations on `User`, `Order`, `OrderItem`, `Refund`, `AfterSaleRequest`, `AdminUser`.
- Create: `backend/prisma/migrations/<timestamp>_digital_asset_cumulative_spend/migration.sql`
  - Add enums, tables, indexes, unique idempotency key, foreign keys.
- Modify: `backend/prisma/seed.ts`
  - Add `digital_assets:read`, `digital_assets:adjust`, `digital_assets:export`, `digital_assets:settings`.

### Backend Core Digital Asset Module

- Create: `backend/src/modules/digital-asset/digital-asset.module.ts`
  - Export `DigitalAssetService`.
- Create: `backend/src/modules/digital-asset/digital-asset.service.ts`
  - Own all account mutation APIs and all read APIs.
- Create: `backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts`
  - Pure functions for order asset amount, line allocation, refund reversal amount, rounding.
- Create: `backend/src/modules/digital-asset/digital-asset.controller.ts`
  - Buyer APIs under `/me/digital-assets`.
- Create: `backend/src/modules/digital-asset/dto/digital-asset-query.dto.ts`
  - Buyer/admin pagination and filter DTOs.
- Create: `backend/src/modules/digital-asset/dto/admin-adjust-digital-asset.dto.ts`
  - Admin adjustment DTO with validation.
- Create: `backend/src/modules/digital-asset/dto/update-digital-asset-settings.dto.ts`
  - Settings DTO for placeholder modules only.
- Create: `backend/src/modules/digital-asset/scripts/backfill-cumulative-spend.ts`
  - Dry-run capable two-phase historical backfill.
- Create tests:
  - `backend/src/modules/digital-asset/digital-asset-ledger-calculator.spec.ts`
  - `backend/src/modules/digital-asset/digital-asset.service.spec.ts`
  - `backend/src/modules/digital-asset/backfill-cumulative-spend.spec.ts`

### Backend Flow Hooks

- Modify: `backend/src/app.module.ts`
  - Import `DigitalAssetModule`.
- Modify: `backend/src/modules/order/order.module.ts`
  - Resolve `DigitalAssetService` through `ModuleRef` and inject into `OrderService` and `OrderAutoConfirmService`.
- Modify: `backend/src/modules/order/order.service.ts`
  - Add setter and fire-and-forget `creditOrderReceived(orderId, 'ORDER_RECEIVED')` after successful manual confirm receive.
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
  - Add setter and fire-and-forget `creditOrderReceived(orderId, 'ORDER_RECEIVED')` after successful auto confirm receive.
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
  - Add setter or constructor injection and call `reverseRefund(refundId)` after refund is marked `REFUNDED`.
- Inspect and modify only when a refund bypass path exists: `backend/src/modules/payment/payment.service.ts`
  - For non-after-sale auto-cancel refund success, call `reverseRefund(refundId)`; expected outcome is idempotent skip when no positive credit exists.

### Backend Admin API

- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.module.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- Create: `backend/src/modules/admin/digital-asset/dto/admin-digital-asset-query.dto.ts`
- Create: `backend/src/modules/admin/digital-asset/dto/admin-digital-asset-export.dto.ts`
- Create tests:
  - `backend/src/modules/admin/digital-asset/admin-digital-asset.service.spec.ts`
  - `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
  - Import `AdminDigitalAssetModule`.

### Buyer App

- Create: `src/types/domain/DigitalAsset.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/DigitalAssetRepo.ts`
- Modify: `src/repos/index.ts`
- Create: `app/me/digital-assets.tsx`
- Modify: `app/(tabs)/me.tsx`
- Modify if mock mode needs sample data: `src/mocks/index.ts` and a focused `src/mocks/digitalAsset.ts`

### Admin Frontend

- Create: `admin/src/api/digital-assets.ts`
- Modify: `admin/src/constants/permissions.ts`
- Modify: `admin/src/types/index.ts`
- Create: `admin/src/pages/digital-assets/index.tsx`
- Create: `admin/src/pages/users/components/DigitalAssetCard.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `admin/src/pages/users/detail.tsx`

### Documentation

- Modify: `AGENTS.md`
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

## Cross-Cutting Rules

- All account balance writes must run inside `Prisma.TransactionIsolationLevel.Serializable`.
- Never update `DigitalAssetAccount.cumulativeSpendAmount` outside `DigitalAssetService`.
- Ledger `amount` is always positive; `direction` decides credit/debit semantics.
- Buyer App wording must use “累计消费金额”; do not use “余额”“可提现”“可兑换”“已获得股权”“已获得期权”.
- Admin adjustment requires both `digital_assets:adjust` permission and an admin role named `超级管理员`.
- Frontend implementation chunks must first invoke the available frontend design guidance (`frontend-design:frontend-design`) to satisfy the project `/ui-ux-pro-max` requirement.
- Use explicit path staging. Do not stage unrelated untracked files.

## Chunk 1: Backend Schema And Core Ledger Service

### Task 1.1: Add Prisma Models And Permission Seed

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_digital_asset_cumulative_spend/migration.sql`
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: Add failing schema expectation**

Run before editing to capture current absence:

```bash
cd backend
rg -n "DigitalAssetAccount|DigitalAssetLedger|digital_assets:read" prisma src
```

Expected: no model/permission definitions found.

- [ ] **Step 2: Update `schema.prisma`**

Add:

```prisma
enum DigitalAssetLedgerType {
  ORDER_RECEIVED
  REFUND_REVERSAL
  ADMIN_ADJUSTMENT
  BACKFILL
}

enum DigitalAssetLedgerDirection {
  CREDIT
  DEBIT
}

model DigitalAssetAccount {
  id                    String   @id @default(cuid())
  userId                String   @unique
  user                  User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  cumulativeSpendAmount Float    @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  ledgers DigitalAssetLedger[]

  @@index([cumulativeSpendAmount])
  @@index([updatedAt])
}

model DigitalAssetLedger {
  id             String                      @id @default(cuid())
  accountId      String
  account        DigitalAssetAccount         @relation(fields: [accountId], references: [id], onDelete: Restrict)
  userId         String
  user           User                        @relation(fields: [userId], references: [id], onDelete: Restrict)
  type           DigitalAssetLedgerType
  direction      DigitalAssetLedgerDirection
  amount         Float
  balanceAfter   Float
  orderId        String?
  order          Order?                      @relation(fields: [orderId], references: [id], onDelete: Restrict)
  orderItemId    String?
  orderItem      OrderItem?                  @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  refundId       String?
  refund         Refund?                     @relation(fields: [refundId], references: [id], onDelete: Restrict)
  afterSaleId    String?
  afterSale      AfterSaleRequest?           @relation(fields: [afterSaleId], references: [id], onDelete: Restrict)
  adminUserId    String?
  adminUser      AdminUser?                  @relation(fields: [adminUserId], references: [id], onDelete: Restrict)
  reason         String?
  idempotencyKey String                      @unique
  meta           Json?
  createdAt      DateTime                    @default(now())

  @@index([userId, createdAt])
  @@index([accountId, createdAt])
  @@index([orderId])
  @@index([orderItemId])
  @@index([refundId])
  @@index([afterSaleId])
  @@index([adminUserId, createdAt])
}
```

Add reverse relation fields with clear names:

```prisma
// User
digitalAssetAccount DigitalAssetAccount?
digitalAssetLedgers DigitalAssetLedger[]

// Order / OrderItem / Refund / AfterSaleRequest
digitalAssetLedgers DigitalAssetLedger[]

// AdminUser
digitalAssetLedgers DigitalAssetLedger[]
```

Also extend the existing `AuditAction` enum with `EXPORT` so数字资产导出 can be audited through `AdminAuditLog` without overloading unrelated actions:

```prisma
enum AuditAction {
  CREATE
  UPDATE
  DELETE
  STATUS_CHANGE
  LOGIN
  LOGOUT
  APPROVE
  REJECT
  REFUND
  SHIP
  CONFIG_CHANGE
  ROLLBACK
  EXPORT
}
```

- [ ] **Step 3: Add migration**

Use Prisma to generate, then inspect the SQL:

```bash
cd backend
npx prisma migrate dev --create-only --name digital_asset_cumulative_spend
```

Expected: migration file contains enum creation, both tables, indexes, unique `idempotencyKey`, and foreign keys with `RESTRICT`.
It must also include the PostgreSQL enum alteration for `AuditAction.EXPORT`.

- [ ] **Step 4: Add permissions to `seed.ts`**

Append to the existing `permissions` array:

```ts
{ code: 'digital_assets:read', module: 'digital_assets', action: 'read', description: '数字资产-查看' },
{ code: 'digital_assets:adjust', module: 'digital_assets', action: 'adjust', description: '数字资产-手动调整' },
{ code: 'digital_assets:export', module: 'digital_assets', action: 'export', description: '数字资产-导出' },
{ code: 'digital_assets:settings', module: 'digital_assets', action: 'settings', description: '数字资产-规则占位配置' },
```

Do not add these permissions to the staff allowlist. Super admin receives all permissions automatically; manager receives non-`admin_` permissions by existing seed logic, but backend adjustment still checks role name `超级管理员`.

- [ ] **Step 5: Validate schema**

```bash
cd backend
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 6: Commit schema changes**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/<timestamp>_digital_asset_cumulative_spend/migration.sql backend/prisma/seed.ts
git commit -m "feat(digital-asset): add cumulative spend schema"
```

### Task 1.2: Implement Pure Ledger Calculator With Tests First

**Files:**
- Create: `backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-ledger-calculator.spec.ts`

- [ ] **Step 1: Write failing calculator tests**

Cover these cases in `digital-asset-ledger-calculator.spec.ts`:

```ts
describe('digital asset ledger calculator', () => {
  it('calculates order asset amount excluding shipping, reward deduction, coupon and vip discount', () => {
    expect(calculateOrderAssetAmount({
      goodsAmount: 200,
      shippingFee: 12,
      discountAmount: 10,
      vipDiscountAmount: 20,
      totalCouponDiscount: 5,
    })).toBe(165);
  });

  it('allocates residual to the last non-prize line in stable createdAt/id order', () => {
    const result = allocateOrderAssetAmount({
      orderAssetAmount: 10,
      items: [
        { orderItemId: 'b', skuId: 's2', quantity: 1, unitPrice: 10, isPrize: false, createdAt: new Date('2026-01-02') },
        { orderItemId: 'a', skuId: 's1', quantity: 1, unitPrice: 10, isPrize: false, createdAt: new Date('2026-01-01') },
        { orderItemId: 'gift', skuId: 's3', quantity: 1, unitPrice: 999, isPrize: true, createdAt: new Date('2026-01-01') },
      ],
    });
    expect(result.allocations).toEqual([
      expect.objectContaining({ orderItemId: 'a', assetAmount: 5 }),
      expect.objectContaining({ orderItemId: 'b', assetAmount: 5 }),
    ]);
    expect(result.residualOrderItemId).toBe('b');
  });
});
```

Also test:
- negative formula clamps to 0;
- prize-only order allocates no item rows and asset amount is 0;
- partial refund caps at line remaining amount;
- whole-order fallback caps at order remaining amount;
- shipping portions are removed before reversal by passing `refundAmount`, `returnShippingFee`, and `shippingPaymentRefundAmount`;
- positive allocation returns a `residualOrderItemId` so ledger metadata can explain where rounding residual was placed.

- [ ] **Step 2: Run failing tests**

```bash
cd backend
npm test -- digital-asset-ledger-calculator
```

Expected: FAIL because calculator file/functions do not exist.

- [ ] **Step 3: Implement calculator**

Export these functions and types:

```ts
export function roundMoney(value: number): number;
export function calculateOrderAssetAmount(order: {
  goodsAmount: number;
  shippingFee?: number | null;
  discountAmount?: number | null;
  vipDiscountAmount?: number | null;
  totalCouponDiscount?: number | null;
}): number;

export function allocateOrderAssetAmount(input: {
  orderAssetAmount: number;
  items: Array<{
    orderItemId: string;
    skuId: string | null;
    quantity: number;
    unitPrice: number;
    isPrize: boolean;
    createdAt: Date;
  }>;
}): {
  allocations: Array<{
    orderItemId: string;
    skuId: string | null;
    quantity: number;
    grossAmount: number;
    assetAmount: number;
  }>;
  residualOrderItemId: string | null;
};

export function calculateRefundProductAmount(input: {
  refundAmount: number;
  returnShippingFee?: number | null;
  shippingPaymentRefundAmount?: number | null;
}): number;

export function clampReversalAmount(input: {
  requestedAmount: number;
  lineRemainingAmount?: number;
  orderRemainingAmount: number;
}): number;
```

Rules:
- `roundMoney` uses `Math.round((value + Number.EPSILON) * 100) / 100`.
- sort non-prize lines by `createdAt ASC`, then `orderItemId ASC`.
- calculate each line by gross amount ratio; round all but last to 2 decimals; last receives residual.
- `residualOrderItemId` is the final non-prize `orderItemId` after sorting, or `null` when no allocation exists.
- `calculateRefundProductAmount` returns `max(0, refundAmount - returnShippingFee - shippingPaymentRefundAmount)` rounded to 2 decimals.
- reject non-finite numbers by treating them as 0.

- [ ] **Step 4: Run calculator tests**

```bash
cd backend
npm test -- digital-asset-ledger-calculator
```

Expected: PASS.

- [ ] **Step 5: Commit calculator**

```bash
git add backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts backend/src/modules/digital-asset/digital-asset-ledger-calculator.spec.ts
git commit -m "test(digital-asset): cover cumulative spend calculations"
```

### Task 1.3: Implement DigitalAssetService And Buyer Controller

**Files:**
- Create: `backend/src/modules/digital-asset/digital-asset.module.ts`
- Create: `backend/src/modules/digital-asset/digital-asset.service.ts`
- Create: `backend/src/modules/digital-asset/digital-asset.controller.ts`
- Create: `backend/src/modules/digital-asset/dto/digital-asset-query.dto.ts`
- Create: `backend/src/modules/digital-asset/dto/admin-adjust-digital-asset.dto.ts`
- Create: `backend/src/modules/digital-asset/dto/update-digital-asset-settings.dto.ts`
- Create: `backend/src/modules/digital-asset/digital-asset.service.spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing service tests**

Test these behaviors with mocked Prisma transaction:
- `creditOrderReceived(orderId, 'ORDER_RECEIVED')` creates account and ledger with idempotency key `order:{orderId}:cumulative-spend-credit`.
- repeated `creditOrderReceived` skips without changing balance.
- source `'BACKFILL'` uses the same idempotency key and ledger `type='BACKFILL'` only on first write.
- `reverseRefund(refundId)` resolves `Refund.afterSaleId`, skips if `after-sale:{afterSaleId}:cumulative-spend-reversal` already exists, otherwise writes `refund:{refundId}:cumulative-spend-reversal`.
- `reverseAfterSale(afterSaleId)` delegates to `reverseRefund` when售后单 has `refundId`.
- `reverseAfterSale(afterSaleId)` without `refundId` writes fallback idempotency key `after-sale:{afterSaleId}:cumulative-spend-reversal`.
- refund reversal ledger `meta.reversedItems` includes `orderItemId`, `quantity`, `originalAssetAmount`, `reversedAmount`.
- positive credit ledger `meta` includes both `itemAllocations` and `residualOrderItemId`.
- refund fallback subtracts `AfterSaleRequest.returnShippingFee` and refunded `AfterSaleShippingPayment.amount` when present before calculating the product reversal amount.
- duplicate `clientIdempotencyKey` on `adjustByAdmin` returns the existing result without writing a second ledger.
- negative admin adjustment refuses to make balance negative.
- every write calls Prisma transaction with `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }`.

- [ ] **Step 2: Run failing service tests**

```bash
cd backend
npm test -- digital-asset.service
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement module and service public API**

`DigitalAssetService` must expose:

```ts
creditOrderReceived(orderId: string, source: 'ORDER_RECEIVED' | 'BACKFILL'): Promise<void>;
reverseRefund(refundId: string): Promise<void>;
reverseAfterSale(afterSaleId: string): Promise<void>;
adjustByAdmin(params: {
  targetUserId: string;
  adminUserId: string;
  amount: number;
  direction: 'CREDIT' | 'DEBIT';
  reason: string;
  clientIdempotencyKey?: string;
}): Promise<void>;
getSummary(userId: string): Promise<{
  cumulativeSpendAmount: number;
  modules: Array<{ key: string; title: string; status: 'COMING_SOON'; description: string }>;
}>;
listLedgers(userId: string, query: { page?: number; pageSize?: number; type?: string }): Promise<{
  items: Array<{
    id: string;
    type: string;
    direction: 'CREDIT' | 'DEBIT';
    amount: number;
    balanceAfter: number;
    title: string;
    description?: string;
    orderId?: string;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}>;
```

Implementation constraints:
- `creditOrderReceived` loads the order with `items`, ignores missing/non-received orders by throwing `BadRequestException` for live calls and logging skip for backfill caller.
- positive ledger `meta.itemAllocations` stores `orderItemId`, `skuId`, `quantity`, `grossAmount`, `assetAmount`; `meta.residualOrderItemId` stores the line that absorbed the rounding residual.
- `reverseRefund` must compute reversals from `RefundItem` first, then `AfterSaleRequest.orderItemId/refundAmount`, then whole-order fallback.
- `reverseAfterSale` without `refundId` must use `after-sale:{afterSaleId}:cumulative-spend-reversal`, include `afterSaleId` on the ledger, and still write `meta.reversedItems`.
- fallback product refund amount must be calculated as `refundAmount - (returnShippingFee ?? 0) - (refunded afterSaleShippingPayment.amount ?? 0)`, clamped to 0.
- reversal must inspect prior credit ledger metadata and prior debit ledgers for the order to cap remaining amount.
- reversal ledger `meta.reversedItems` must store every affected line: `orderItemId`, `quantity`, `originalAssetAmount`, `alreadyReversedAmount`, `reversedAmount`.
- use `idempotencyKey` unique lookup before doing work and catch unique conflicts as no-op.
- `adjustByAdmin` generates `admin-adjust:{adminUserId}:{targetUserId}:{uuid}` when client key is missing; client key must be namespaced before storing.

- [ ] **Step 4: Implement buyer controller**

Routes:

```ts
@Controller('me/digital-assets')
export class DigitalAssetController {
  @Get('summary')
  getSummary(@CurrentUser('sub') userId: string) {
    return this.digitalAssetService.getSummary(userId);
  }

  @Get('ledgers')
  listLedgers(@CurrentUser('sub') userId: string, @Query() query: DigitalAssetQueryDto) {
    return this.digitalAssetService.listLedgers(userId, query);
  }
}
```

Use existing buyer auth pattern; do not mark these endpoints `@Public()`.

- [ ] **Step 5: Register module**

Import `DigitalAssetModule` in `backend/src/app.module.ts`.

- [ ] **Step 6: Run tests and build**

```bash
cd backend
npm test -- digital-asset.service digital-asset-ledger-calculator
npx prisma validate
npm run build
```

Expected: all tests PASS, Prisma schema valid, Nest build succeeds.

- [ ] **Step 7: Commit backend core**

```bash
git add backend/src/modules/digital-asset backend/src/app.module.ts
git commit -m "feat(digital-asset): add cumulative spend ledger service"
```

## Chunk 2: Backend Order, Refund, And Backfill Integration

### Task 2.1: Hook Manual And Automatic Confirm Receive

**Files:**
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
- Create or modify tests:
  - `backend/src/modules/order/order.service.digital-asset.spec.ts`
  - `backend/src/modules/order/order-auto-confirm.digital-asset.spec.ts`

- [ ] **Step 1: Write failing hook tests**

Manual confirm test:
- setup order transitions to `RECEIVED`;
- assert `digitalAssetService.creditOrderReceived(orderId, 'ORDER_RECEIVED')` is called once after transaction succeeds;
- assert failure of digital asset call is logged and does not make `confirmReceive` throw.

Auto confirm test:
- setup eligible order;
- assert auto confirm calls `creditOrderReceived(orderId, 'ORDER_RECEIVED')`;
- assert repeated invocation is safe because service idempotency is the source of truth.

- [ ] **Step 2: Run failing hook tests**

```bash
cd backend
npm test -- order.service.digital-asset order-auto-confirm.digital-asset
```

Expected: FAIL because order services do not yet know `DigitalAssetService`.

- [ ] **Step 3: Add service setters**

In `order.service.ts`:

```ts
private digitalAssetService?: DigitalAssetService;

setDigitalAssetService(service: DigitalAssetService) {
  this.digitalAssetService = service;
}
```

After successful bonus fire-and-forget setup, call:

```ts
this.digitalAssetService?.creditOrderReceived(orderId, 'ORDER_RECEIVED').catch((err) => {
  const safeErr = sanitizeErrorForLog(err);
  this.logger.error(
    JSON.stringify({
      event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER',
      orderId,
      error: safeErr.message,
      stack: safeErr.stack,
      failedAt: new Date().toISOString(),
    }),
  );
  this.prisma.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus: 'RECEIVED',
      toStatus: 'RECEIVED',
      reason: '数字资产累计失败',
      meta: { deadLetter: true, event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER', error: safeErr.message },
    },
  }).catch(() => undefined);
});
```

In `order-auto-confirm.service.ts`, add the same setter and dead-letter style call after the fresh status check passes.

- [ ] **Step 4: Inject through `OrderModule`**

In `backend/src/modules/order/order.module.ts`:
- import `DigitalAssetService` and `DigitalAssetModule`;
- add `DigitalAssetModule` to imports;
- in `onModuleInit`, resolve via `this.moduleRef.get(DigitalAssetService, { strict: false })`;
- call setters on `orderService` and `orderAutoConfirmService`.

If a circular dependency appears, wrap `DigitalAssetModule` with `forwardRef(() => DigitalAssetModule)` and keep setter injection.

- [ ] **Step 5: Run hook tests**

```bash
cd backend
npm test -- order.service.digital-asset order-auto-confirm.digital-asset
```

Expected: PASS.

- [ ] **Step 6: Commit confirm receive hooks**

```bash
git add backend/src/modules/order/order.module.ts backend/src/modules/order/order.service.ts backend/src/modules/order/order-auto-confirm.service.ts backend/src/modules/order/order.service.digital-asset.spec.ts backend/src/modules/order/order-auto-confirm.digital-asset.spec.ts
git commit -m "feat(digital-asset): credit cumulative spend on received orders"
```

### Task 2.2: Hook Refund Success Reversals

**Files:**
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Inspect and modify only when setter/module wiring requires it: `backend/src/modules/after-sale/after-sale.module.ts`
- Inspect and modify only when a final refund bypass path exists: `backend/src/modules/payment/payment.service.ts`
- Create or modify tests:
  - `backend/src/modules/after-sale/after-sale-refund.digital-asset.spec.ts`
  - `backend/src/modules/payment/payment.service.digital-asset-refund.spec.ts`

- [ ] **Step 1: Write failing refund hook tests**

Cover:
- `AfterSaleRefundService.handleRefundSuccess(refundId)` marks refund and after-sale as `REFUNDED`, then calls `digitalAssetService.reverseRefund(refundId)`.
- if `reverseRefund` throws, refund success still completes and writes an error log.
- payment auto-cancel refund path calls reversal only after final `REFUNDED` state, and service skips if no credit exists.

- [ ] **Step 2: Run failing refund hook tests**

```bash
cd backend
npm test -- after-sale-refund.digital-asset payment.service.digital-asset-refund
```

Expected: FAIL because refund services are not hooked.

- [ ] **Step 3: Inject `DigitalAssetService`**

Prefer setter injection if `AfterSaleModule` already has circular references. Otherwise use constructor injection from `DigitalAssetModule`.

Call after successful transaction in `handleRefundSuccess`:

```ts
this.digitalAssetService?.reverseRefund(refundId).catch((err) => {
  const safeErr = sanitizeErrorForLog(err);
  this.logger.error(
    JSON.stringify({
      event: 'DIGITAL_ASSET_REFUND_REVERSAL_DEAD_LETTER',
      refundId,
      error: safeErr.message,
      stack: safeErr.stack,
      failedAt: new Date().toISOString(),
    }),
  );
});
```

Do not call inside the same refund status transaction; refund success must not be rolled back by asset reversal failure.

- [ ] **Step 4: Add payment auto-cancel hook if the refund can bypass `AfterSaleRefundService`**

Search:

```bash
cd backend
rg -n "REFUNDED|handleRefundSuccess|restoreAutoCancelDeduction|providerRefundId|wechat|queryRefund|refundNotify" src/modules/payment src/modules/order src/modules/after-sale
```

Check支付宝同步成功、微信退款通知、微信补偿查单、订单取消自动退款四类路径。If a refund reaches `REFUNDED` without `AfterSaleRefundService`, call `reverseRefund(refund.id)` after the refund status is final. If no such bypass exists, add a test proving all final after-sale refunds pass through `AfterSaleRefundService`.

- [ ] **Step 5: Run refund hook tests**

```bash
cd backend
npm test -- after-sale-refund.digital-asset payment.service.digital-asset-refund digital-asset.service
```

Expected: PASS.

- [ ] **Step 6: Commit refund hooks**

```bash
git add backend/src/modules/after-sale backend/src/modules/payment/payment.service.ts backend/src/modules/after-sale/after-sale-refund.digital-asset.spec.ts backend/src/modules/payment/payment.service.digital-asset-refund.spec.ts
git commit -m "feat(digital-asset): reverse cumulative spend on refunds"
```

### Task 2.3: Implement Historical Backfill Script

**Files:**
- Create: `backend/src/modules/digital-asset/scripts/backfill-cumulative-spend.ts`
- Create: `backend/src/modules/digital-asset/backfill-cumulative-spend.spec.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing backfill tests**

Cover:
- phase 1 credits orders where `receivedAt IS NOT NULL`;
- phase 1 credits legacy `status='RECEIVED'` with missing `receivedAt`;
- phase 1 only credits `status='REFUNDED'` when `receivedAt IS NOT NULL`;
- unshipped cancel refunds are skipped;
- phase 2 scans `Refund.status='REFUNDED'` for credited orders;
- phase 2 scans `AfterSaleRequest.status='REFUNDED'` fallback only when no usable `refundId` or `Refund` row exists;
- dry-run reports counts but does not call write methods;
- rerun is restartable because service idempotency keys are reused.

- [ ] **Step 2: Run failing backfill tests**

```bash
cd backend
npm test -- backfill-cumulative-spend
```

Expected: FAIL because script does not exist.

- [ ] **Step 3: Implement script**

CLI behavior:

```bash
ts-node src/modules/digital-asset/scripts/backfill-cumulative-spend.ts --dry-run --batch-size=200
ts-node src/modules/digital-asset/scripts/backfill-cumulative-spend.ts --batch-size=200 --start-after-order-id=<id>
```

Output JSON summary:

```json
{
  "dryRun": true,
  "creditedOrders": 0,
  "reversedRefunds": 0,
  "reversedAfterSales": 0,
  "skipped": 0,
  "failed": [],
  "creditAmount": 0,
  "reversalAmount": 0,
  "netAmount": 0
}
```

Implementation:
- instantiate Nest application context or a minimal service factory using existing `PrismaService` and `DigitalAssetService`;
- process phase 1 and phase 2 separately;
- paginate by stable `createdAt ASC, id ASC`;
- never build one huge in-memory list;
- dry-run uses calculator and existing ledger lookups but does not call write methods.

- [ ] **Step 4: Add package script if useful**

Add to `backend/package.json`:

```json
"digital-asset:backfill": "ts-node src/modules/digital-asset/scripts/backfill-cumulative-spend.ts"
```

- [ ] **Step 5: Run backfill tests**

```bash
cd backend
npm test -- backfill-cumulative-spend
```

Expected: PASS.

- [ ] **Step 6: Run backend integration validation**

```bash
cd backend
npm test -- digital-asset order.service.digital-asset order-auto-confirm.digital-asset after-sale-refund.digital-asset backfill-cumulative-spend
npm run build
```

Expected: all selected tests PASS and build succeeds.

- [ ] **Step 7: Commit backfill**

```bash
git add backend/src/modules/digital-asset/scripts/backfill-cumulative-spend.ts backend/src/modules/digital-asset/backfill-cumulative-spend.spec.ts backend/package.json
git commit -m "feat(digital-asset): add cumulative spend backfill"
```

## Chunk 3: Backend Admin Digital Asset API

### Task 3.1: Add Admin Digital Asset Module

**Files:**
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.module.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- Create: `backend/src/modules/admin/digital-asset/dto/admin-digital-asset-query.dto.ts`
- Create: `backend/src/modules/admin/digital-asset/dto/admin-digital-asset-export.dto.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.spec.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write failing admin service tests**

Cover:
- account list filters by userId, nickname, phone, min/max amount, sort by updated time;
- stats endpoint returns account count, cumulative spend total, today credit, today debit, admin adjustment count;
- account detail returns masked phone, user profile, cumulative amount, recent ledgers, summary stats;
- ledgers endpoint paginates and includes order/refund/afterSale refs;
- account export returns CSV bytes/string with masked phone, user id, member tier, cumulative amount, updated time;
- ledger export returns CSV bytes/string with user id, masked phone, ledger type, direction, amount, balance after, order/refund/afterSale refs, reason, created time;
- export writes `AdminAuditLog` with `action='EXPORT'`, `module='digital_assets'`, export mode, filters, admin id, ip, userAgent;
- settings stores placeholder module labels, descriptions, and enable switches; it rejects `conversionRatio`, `equityRatio`, asset value, wage, option, and equity rule fields.

- [ ] **Step 2: Write failing admin controller tests**

Cover:
- all routes require `AdminAuthGuard` and `PermissionGuard`;
- read routes require `digital_assets:read`;
- adjust route requires `digital_assets:adjust`;
- export requires `digital_assets:export`;
- settings read/patch requires `digital_assets:settings`;
- non-super-admin adjustment returns 403 even with permission;
- super admin adjustment writes `AdminAuditLog`;
- export endpoint writes `AdminAuditLog` for both `mode='accounts'` and `mode='ledgers'`.

- [ ] **Step 3: Run failing tests**

```bash
cd backend
npm test -- admin-digital-asset
```

Expected: FAIL because module does not exist.

- [ ] **Step 4: Implement admin service**

Service methods:

```ts
getStats(): Promise<AdminDigitalAssetStats>;
listAccounts(query: AdminDigitalAssetAccountQueryDto): Promise<AdminDigitalAssetAccountPage>;
getAccount(userId: string): Promise<AdminDigitalAssetAccountDetail>;
listAccountLedgers(userId: string, query: AdminDigitalAssetLedgerQueryDto): Promise<AdminDigitalAssetLedgerPage>;
adjustAccount(
  userId: string,
  adminUserId: string,
  dto: AdminAdjustDigitalAssetDto,
  requestMeta: { ip?: string; userAgent?: string },
): Promise<void>;
exportDigitalAssets(
  query: AdminDigitalAssetExportDto,
  adminUserId: string,
  requestMeta: { ip?: string; userAgent?: string },
): Promise<{ filename: string; contentType: 'text/csv; charset=utf-8'; body: string }>;
getSettings(): Promise<DigitalAssetSettings>;
updateSettings(dto: UpdateDigitalAssetSettingsDto, adminUserId: string): Promise<DigitalAssetSettings>;
```

`DigitalAssetSettings` shape:

```ts
{
  modules: Array<{
    key: 'assetValue' | 'level' | 'benefits' | 'equity';
    title: string;
    enabled: boolean;
    description: string;
  }>;
  updatedAt?: string;
  updatedByAdminId?: string;
}
```

`adjustAccount` must:
- load admin roles and require `role.name === '超级管理员'`;
- call `DigitalAssetService.adjustByAdmin`;
- create `AdminAuditLog` with `action='UPDATE'`, `module='digital_assets'`, `targetType='User'`, `targetId=userId`, before/after cumulative amounts, reason, admin id, ip, userAgent.

`exportDigitalAssets` must:
- support `query.mode: 'accounts' | 'ledgers'`;
- use account filters for `accounts`, and user/type/direction/date filters for `ledgers`;
- mask phone numbers in CSV;
- write `AdminAuditLog` with `action='EXPORT'`, `module='digital_assets'`, `summary`, `after: { mode, filters, rowCount }`, `isReversible=false`;
- return filename `digital-assets-accounts-YYYYMMDD-HHmmss.csv` or `digital-assets-ledgers-YYYYMMDD-HHmmss.csv`.

- [ ] **Step 5: Implement admin controller**

Routes:

```ts
@Controller('admin/digital-assets')
export class AdminDigitalAssetController {
  @Get('stats')
  @RequirePermission('digital_assets:read')
  getStats(): Promise<AdminDigitalAssetStats>;

  @Get('accounts')
  @RequirePermission('digital_assets:read')
  listAccounts(@Query() query: AdminDigitalAssetAccountQueryDto): Promise<AdminDigitalAssetAccountPage>;

  @Get('accounts/:userId')
  @RequirePermission('digital_assets:read')
  getAccount(@Param('userId') userId: string): Promise<AdminDigitalAssetAccountDetail>;

  @Get('accounts/:userId/ledgers')
  @RequirePermission('digital_assets:read')
  listLedgers(
    @Param('userId') userId: string,
    @Query() query: AdminDigitalAssetLedgerQueryDto,
  ): Promise<AdminDigitalAssetLedgerPage>;

  @Post('accounts/:userId/adjust')
  @RequirePermission('digital_assets:adjust')
  adjust(
    @Param('userId') userId: string,
    @CurrentAdmin('sub') adminUserId: string,
    @Body() dto: AdminAdjustDigitalAssetDto,
    @Req() req: Request,
  ): Promise<void>;

  @Get('export')
  @RequirePermission('digital_assets:export')
  export(
    @Query() query: AdminDigitalAssetExportDto,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string>;

  @Get('settings')
  @RequirePermission('digital_assets:settings')
  getSettings(): Promise<DigitalAssetSettings>;

  @Patch('settings')
  @RequirePermission('digital_assets:settings')
  updateSettings(
    @CurrentAdmin('sub') adminUserId: string,
    @Body() dto: UpdateDigitalAssetSettingsDto,
  ): Promise<DigitalAssetSettings>;
}
```

The export method must set:

```ts
res.setHeader('Content-Type', result.contentType);
res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
return result.body;
```

Use existing admin controller patterns:
- `@Public()`
- `@UseGuards(AdminAuthGuard, PermissionGuard)`
- `@UseInterceptors(AuditLogInterceptor)` when useful;
- route-specific `@RequirePermission('digital_assets:read' | 'digital_assets:adjust' | 'digital_assets:export' | 'digital_assets:settings')`;
- `@CurrentAdmin('sub')`.

- [ ] **Step 6: Register admin module**

Import `AdminDigitalAssetModule` in `backend/src/modules/admin/admin.module.ts`.

- [ ] **Step 7: Run admin API tests and backend build**

```bash
cd backend
npm test -- admin-digital-asset digital-asset.service
npm run build
```

Expected: PASS and build succeeds.

- [ ] **Step 8: Commit admin API**

```bash
git add backend/src/modules/admin/digital-asset backend/src/modules/admin/admin.module.ts
git commit -m "feat(admin): add digital asset management api"
```

## Chunk 4: Buyer App Digital Asset Center

### Task 4.1: Add Buyer Types And Repository

**Files:**
- Create: `src/types/domain/DigitalAsset.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/DigitalAssetRepo.ts`
- Modify: `src/repos/index.ts`
- Create: `src/mocks/digitalAsset.ts`
- Modify: `src/mocks/index.ts`

- [ ] **Step 1: Invoke frontend design guidance**

Use `frontend-design:frontend-design` before frontend code changes. Capture decisions:
- page is a tool surface, not a marketing landing page;
- stable dimensions for money card and module tiles;
- avoid promise-like wording and large hero-scale type inside compact panels.

- [ ] **Step 2: Add types**

`src/types/domain/DigitalAsset.ts`:

```ts
export type DigitalAssetLedgerType = 'ORDER_RECEIVED' | 'REFUND_REVERSAL' | 'ADMIN_ADJUSTMENT' | 'BACKFILL';
export type DigitalAssetLedgerDirection = 'CREDIT' | 'DEBIT';

export interface DigitalAssetModuleStatus {
  key: 'assetValue' | 'level' | 'benefits' | 'equity';
  title: string;
  status: 'COMING_SOON';
  description: string;
}

export interface DigitalAssetSummary {
  cumulativeSpendAmount: number;
  modules: DigitalAssetModuleStatus[];
}

export interface DigitalAssetLedger {
  id: string;
  type: DigitalAssetLedgerType;
  direction: DigitalAssetLedgerDirection;
  amount: number;
  balanceAfter: number;
  title: string;
  description?: string;
  orderId?: string;
  createdAt: string;
}
```

Export it from `src/types/domain/index.ts`.

- [ ] **Step 3: Add repository**

`src/repos/DigitalAssetRepo.ts`:

```ts
import { Result, PaginationResult, DigitalAssetLedger, DigitalAssetLedgerType, DigitalAssetSummary } from '../types';

export const DigitalAssetRepo = {
  getSummary: async (): Promise<Result<DigitalAssetSummary>> => {
    if (USE_MOCK) return simulateRequest(mockDigitalAssetSummary);
    return ApiClient.get<DigitalAssetSummary>('/me/digital-assets/summary');
  },
  listLedgers: async (params?: { page?: number; pageSize?: number; type?: DigitalAssetLedgerType }): Promise<Result<PaginationResult<DigitalAssetLedger>>> => {
    if (USE_MOCK) return simulateRequest(mockDigitalAssetLedgers);
    return ApiClient.get<PaginationResult<DigitalAssetLedger>>('/me/digital-assets/ledgers', params);
  },
};
```

`src/mocks/digitalAsset.ts` must export `mockDigitalAssetSummary` and `mockDigitalAssetLedgers`; `mockDigitalAssetLedgers` must be shaped as `PaginationResult<DigitalAssetLedger>`.

- [ ] **Step 4: Run app TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS, or only pre-existing unrelated errors; record any unrelated failures before proceeding.

- [ ] **Step 5: Commit types/repo**

```bash
git add src/types/domain/DigitalAsset.ts src/types/domain/index.ts src/repos/DigitalAssetRepo.ts src/repos/index.ts src/mocks/digitalAsset.ts src/mocks/index.ts
git commit -m "feat(app): add digital asset client contract"
```

### Task 4.2: Add Digital Asset Center Page And Me Entry

**Files:**
- Create: `app/me/digital-assets.tsx`
- Modify: `app/(tabs)/me.tsx`
- Modify: `docs/architecture/frontend.md`

- [ ] **Step 1: Create page**

Invoke `frontend-design:frontend-design` again if Task 4.2 is implemented separately from Task 4.1.

Use existing App patterns:
- `Screen`;
- `AppHeader` or current local header pattern from sibling `app/me/*.tsx`;
- `useQuery` for `['digital-assets', 'summary']`;
- `useQuery` or `useInfiniteQuery` for ledgers;
- `ErrorState`, skeleton, empty state;
- `priceTextProps` for money;
- `useResponsiveLayout` for compact/large-text layout.
- do not use `Dimensions.get` at module top level.

Required copy:
- page title: `数字资产中心`;
- main label: `累计消费金额`;
- module descriptions: `规则待公布` or `待开放`;
- empty state: `暂无累计消费记录`;
- no “余额/可兑换/可提现/已获得股权/已获得期权”.

- [ ] **Step 2: Add entry to `TOOL_GRID_BASE`**

In `app/(tabs)/me.tsx`, add one item:

```ts
{ label: '数字资产', icon: 'diamond-stone-outline' as const, route: '/me/digital-assets' },
```

Place it near “我的红包/我的发票” so the entry is discoverable but still in the existing tool grid.

- [ ] **Step 3: Verify login gating**

Use existing tool grid `requireLogin` flow. If the grid currently allows unauthenticated navigation for some tools, wrap this route so unauthenticated users see the existing login prompt.

- [ ] **Step 4: Run App checks**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: TypeScript passes; Jest passes or only unrelated pre-existing legal/test failures are documented.

- [ ] **Step 5: Manual responsive check**

Run Expo locally for manual responsive checks:

```bash
npx expo start
```

Check Android-like narrow viewport and large text:
- main amount does not overflow;
- bottom ledger list is not blocked by virtual navigation;
- module tiles do not overlap text.
- ledger pagination/load-more correctly appends the next page and preserves scroll position.

- [ ] **Step 6: Commit buyer app UI**

```bash
git add 'app/(tabs)/me.tsx' app/me/digital-assets.tsx docs/architecture/frontend.md
git commit -m "feat(app): add digital asset center"
```

## Chunk 5: Admin Frontend Digital Asset Management

### Task 5.1: Add Admin API Client And Types

**Files:**
- Create: `admin/src/api/digital-assets.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/permissions.ts`

- [ ] **Step 1: Invoke frontend design guidance**

Use `frontend-design:frontend-design` before admin UI changes. Keep this page dense and operational: filters, table, detail drawer, adjustment modal, and settings should be scan-friendly rather than decorative.

- [ ] **Step 2: Add types**

Add:

```ts
export type DigitalAssetLedgerType = 'ORDER_RECEIVED' | 'REFUND_REVERSAL' | 'ADMIN_ADJUSTMENT' | 'BACKFILL';
export type DigitalAssetLedgerDirection = 'CREDIT' | 'DEBIT';

export interface DigitalAssetStats {
  accountCount: number;
  cumulativeSpendTotal: number;
  todayCreditAmount: number;
  todayDebitAmount: number;
  adminAdjustmentCount: number;
}

export interface DigitalAssetAccountRow {
  userId: string;
  phoneMasked: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  memberTier: 'NORMAL' | 'VIP';
  cumulativeSpendAmount: number;
  lastLedgerAt: string | null;
  updatedAt: string;
}

export interface DigitalAssetLedgerRow {
  id: string;
  userId: string;
  type: DigitalAssetLedgerType;
  direction: DigitalAssetLedgerDirection;
  amount: number;
  balanceAfter: number;
  title: string;
  description?: string;
  orderId?: string | null;
  refundId?: string | null;
  afterSaleId?: string | null;
  adminUserId?: string | null;
  reason?: string | null;
  createdAt: string;
}

export interface DigitalAssetAccountDetail extends DigitalAssetAccountRow {
  phone: string | null;
  createdAt: string;
  latestLedgers: DigitalAssetLedgerRow[];
  summary: {
    creditAmount: number;
    debitAmount: number;
    orderCreditCount: number;
    refundReversalCount: number;
    adminAdjustmentCount: number;
  };
}

export interface DigitalAssetModuleSetting {
  key: 'assetValue' | 'level' | 'benefits' | 'equity';
  title: string;
  enabled: boolean;
  description: string;
}

export interface DigitalAssetSettings {
  modules: DigitalAssetModuleSetting[];
  updatedAt?: string;
  updatedByAdminId?: string;
}

export interface UpdateDigitalAssetSettingsPayload {
  modules: DigitalAssetModuleSetting[];
}

export interface DigitalAssetAccountQuery extends PaginationParams {
  keyword?: string;
  userId?: string;
  phone?: string;
  nickname?: string;
  minAmount?: number;
  maxAmount?: number;
  updatedFrom?: string;
  updatedTo?: string;
  sortBy?: 'cumulativeSpendAmount' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface DigitalAssetLedgerQuery extends PaginationParams {
  type?: DigitalAssetLedgerType;
  direction?: DigitalAssetLedgerDirection;
  startDate?: string;
  endDate?: string;
}

export interface DigitalAssetExportParams extends DigitalAssetAccountQuery, DigitalAssetLedgerQuery {
  mode: 'accounts' | 'ledgers';
}

export interface AdjustDigitalAssetPayload {
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: string;
  clientIdempotencyKey?: string;
}
```

Fields must match backend responses, not the raw Prisma model.

- [ ] **Step 3: Add API client**

`admin/src/api/digital-assets.ts` should use the existing unwrapped `client`:

```ts
export const getDigitalAssetStats = (): Promise<DigitalAssetStats> =>
  client.get('/admin/digital-assets/stats');

export const getDigitalAssetAccounts = (params?: DigitalAssetAccountQuery): Promise<PaginatedData<DigitalAssetAccountRow>> =>
  client.get('/admin/digital-assets/accounts', { params });

export const getDigitalAssetAccount = (userId: string): Promise<DigitalAssetAccountDetail> =>
  client.get(`/admin/digital-assets/accounts/${userId}`);

export const getDigitalAssetLedgers = (
  userId: string,
  params?: DigitalAssetLedgerQuery,
): Promise<PaginatedData<DigitalAssetLedgerRow>> =>
  client.get(`/admin/digital-assets/accounts/${userId}/ledgers`, { params });

export const adjustDigitalAssetAccount = (userId: string, payload: AdjustDigitalAssetPayload): Promise<void> =>
  client.post(`/admin/digital-assets/accounts/${userId}/adjust`, payload);

export const exportDigitalAssets = (params: DigitalAssetExportParams): Promise<Blob> =>
  client.get('/admin/digital-assets/export', { params, responseType: 'blob' });

export const getDigitalAssetSettings = (): Promise<DigitalAssetSettings> =>
  client.get('/admin/digital-assets/settings');

export const updateDigitalAssetSettings = (payload: UpdateDigitalAssetSettingsPayload): Promise<DigitalAssetSettings> =>
  client.patch('/admin/digital-assets/settings', payload);
```

The export function must be wired in the page so `mode='accounts'` downloads account rows and `mode='ledgers'` downloads ledger rows. If the existing response interceptor does not preserve `Blob`, use a local helper in this API file with the same auth token header and `responseType: 'blob'`.

- [ ] **Step 4: Add permissions**

In `admin/src/constants/permissions.ts`, add:

```ts
DIGITAL_ASSETS_READ: 'digital_assets:read',
DIGITAL_ASSETS_ADJUST: 'digital_assets:adjust',
DIGITAL_ASSETS_EXPORT: 'digital_assets:export',
DIGITAL_ASSETS_SETTINGS: 'digital_assets:settings',
```

- [ ] **Step 5: Run admin build**

```bash
cd admin
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 6: Commit admin client**

```bash
git add admin/src/api/digital-assets.ts admin/src/types/index.ts admin/src/constants/permissions.ts
git commit -m "feat(admin): add digital asset client contract"
```

### Task 5.2: Add Admin Page, Menu, Route, And User Detail Card

**Files:**
- Create: `admin/src/pages/digital-assets/index.tsx`
- Create: `admin/src/pages/users/components/DigitalAssetCard.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `admin/src/pages/users/detail.tsx`
- Modify: `docs/architecture/admin-frontend.md`

- [ ] **Step 1: Build `DigitalAssetsPage`**

Page must include:
- statistic cards: account count, cumulative spend total, today credit, today debit, admin adjustments;
- filter form: keyword/userId/phone/nickname, amount min/max, updated date range;
- account table: user, masked phone, member tier, cumulative amount, updated time, action;
- detail drawer: summary, recent ledgers, order/refund/afterSale refs;
- adjustment modal: direction, amount, reason, generated `clientIdempotencyKey`;
- two CSV export actions: account export using current account filters and ledger export using current selected user/date/type filters;
- settings section for placeholder module titles, descriptions, and enable switches only.

Use `useAuthStore().hasPermission` or existing permission helper for button visibility. Hide or disable adjustment for non-super-admin in UI, but show backend errors if the role check rejects.

- [ ] **Step 2: Add route**

In `admin/src/App.tsx`:

```ts
const DigitalAssetsPage = lazy(() => import('@/pages/digital-assets/index'));
```

Add:

```tsx
<Route path="digital-assets" element={<DigitalAssetsPage />} />
```

- [ ] **Step 3: Add menu item**

In `admin/src/layouts/AdminLayout.tsx`, add “数字资产” under the “用户与奖励” group with permission `PERMISSIONS.DIGITAL_ASSETS_READ`.

- [ ] **Step 4: Add user detail card**

Create `admin/src/pages/users/components/DigitalAssetCard.tsx` and import it in `admin/src/pages/users/detail.tsx`. The card must show:
- cumulative spend amount;
- latest ledger title/time;
- link to `/digital-assets?userId=<id>`.

Fetch its data through `getDigitalAssetAccount(userId)` and keep the component self-contained so the existing user detail page does not grow large.

- [ ] **Step 5: Run admin build**

```bash
cd admin
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 6: Manual admin UI check**

Run the admin dev server for manual UI checks:

```bash
cd admin
npm run dev
```

Verify:
- `/digital-assets` route loads from the menu;
- filters update the account table;
- account detail drawer shows ledger fields and refs;
- account export and ledger export both download CSV files;
- non-super-admin cannot submit adjustment;
- super-admin adjustment refreshes stats, list row, detail drawer, and user detail card;
- settings only allows placeholder titles/descriptions/enabled switches and does not expose conversion ratios.

- [ ] **Step 7: Commit admin UI**

```bash
git add admin/src/pages/digital-assets/index.tsx admin/src/pages/users/components/DigitalAssetCard.tsx admin/src/App.tsx admin/src/layouts/AdminLayout.tsx admin/src/pages/users/detail.tsx docs/architecture/admin-frontend.md
git commit -m "feat(admin): add digital asset management page"
```

## Chunk 6: Documentation, Safety Review, And Final Verification

### Task 6.1: Sync Architecture And Safety Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [ ] **Step 1: Register plan in `AGENTS.md`**

Add the implementation plan path near the spec:

```md
`docs/superpowers/plans/2026-06-14-digital-asset-cumulative-spend.md` — 数字资产累计消费实施计划（Schema/核心记账服务/订单与退款接入/历史回填/买家 App 数字资产中心/管理后台数字资产页/安全验证拆分，**数字资产累计消费实施排程**）
```

- [ ] **Step 2: Update data-system doc**

Document:
- new enums;
- new models;
- relations;
- amount unit remains Float / 元;
- idempotency keys;
- refund reversal and historical backfill rules.

- [ ] **Step 3: Update frontend docs**

In `docs/architecture/frontend.md`, document:
- `/me/digital-assets`;
- entry from “我的”;
- wording constraints;
- responsive checks.

In `docs/architecture/admin-frontend.md`, document:
- `/digital-assets`;
- permissions;
- table/detail/adjust/export/settings.

- [ ] **Step 4: Update safety tracker**

Append a digital asset safety section to `docs/issues/tofix-safe.md`:
- Serializable transactions used for every balance write;
- idempotency key coverage;
- refund reversal cap;
- cross-source refund/afterSale dedupe;
- admin super-admin check and audit log;
- backfill dry-run and rerun safety.

If implementation reveals a real unresolved race, add it as an open issue instead of marking it safe.

- [ ] **Step 5: Update `plan.md`**

Add or check off the digital asset cumulative spend task according to actual implementation status.

- [ ] **Step 6: Commit docs**

```bash
git add AGENTS.md docs/architecture/data-system.md docs/architecture/frontend.md docs/architecture/admin-frontend.md docs/issues/tofix-safe.md plan.md
git commit -m "docs(digital-asset): sync cumulative spend implementation docs"
```

### Task 6.2: Full Verification And Independent Review

**Files:**
- No new feature files unless review finds issues.

- [ ] **Step 1: Run backend verification**

```bash
cd backend
npx prisma validate
npm test -- digital-asset admin-digital-asset order.service.digital-asset order-auto-confirm.digital-asset after-sale-refund.digital-asset backfill-cumulative-spend
npm run build
```

Expected: schema valid, selected tests PASS, build succeeds.

- [ ] **Step 2: Run buyer App verification**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: TypeScript passes and tests pass, or any unrelated pre-existing failures are documented with exact error summary.

- [ ] **Step 3: Run admin frontend verification**

```bash
cd admin
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 3a: Verify admin UI flows**

Run the admin app locally for final UI flow checks:

```bash
cd admin
npm run dev
```

Then use Browser/Playwright or manual browser checks to verify:
- `/digital-assets` is reachable from the “用户与奖励” menu;
- account filters update table rows without layout overlap;
- detail drawer shows account summary and ledger refs;
- account CSV export and ledger CSV export both download files;
- non-super-admin adjustment is hidden/disabled and backend rejection is surfaced if submitted;
- super-admin adjustment refreshes stats, table row, drawer, and user detail card;
- settings UI only edits placeholder module titles/descriptions.

Expected: all listed flows work, or any blocker is fixed before final completion.

- [ ] **Step 4: Run text safety audit**

```bash
rg -n "余额|可兑换|可提现|已获得股权|已获得期权" app/me/digital-assets.tsx src admin/src/pages/digital-assets
```

Expected: no forbidden buyer-facing promise wording in the digital asset buyer page. Admin wording may mention “调整” and “导出”, but must not define conversion value.

- [ ] **Step 5: Review changed file list**

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional files changed. Unrelated local `.docx`, `apk/`, or unrelated spec files are not staged.

- [ ] **Step 6: Dispatch independent read-only code review**

Use an independent Explore/reviewer agent with this prompt:

```text
Review the digital asset cumulative spend implementation. Read only. Focus on:
- Serializable balance writes and idempotency.
- Confirm receive and auto-confirm hooks.
- Refund and after-sale cross-source dedupe.
- Historical backfill correctness.
- Admin super-admin adjustment enforcement and audit logging.
- Buyer wording constraints and responsive risks.
- Admin page permission and data-contract correctness.
Return findings with file/line references. Do not modify files.
```

- [ ] **Step 7: Fix review findings**

For each real finding:
- write a regression test first when feasible;
- implement the smallest fix;
- rerun the relevant verification command;
- commit with a focused message.

- [ ] **Step 8: Final verification**

Rerun:

```bash
cd backend
npx prisma validate
npm test -- digital-asset admin-digital-asset order.service.digital-asset order-auto-confirm.digital-asset after-sale-refund.digital-asset backfill-cumulative-spend
npm run build
cd ../admin
npm run build
cd ..
npx tsc --noEmit
npm test -- --runInBand
rg -n "余额|可兑换|可提现|已获得股权|已获得期权" app/me/digital-assets.tsx src admin/src/pages/digital-assets
git status --short
```

Expected: schema validation, selected backend tests, backend build, admin build, buyer TypeScript, buyer tests, and wording audit pass. `git status --short` shows no unintended staged/untracked feature changes beyond known unrelated local files.
