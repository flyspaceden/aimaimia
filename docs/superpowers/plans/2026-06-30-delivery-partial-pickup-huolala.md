# Delivery Partial Pickup Huolala Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the delivery-line “一次付款，多次提货” flow with Huolala enterprise carrier orders, platform freight cost accounting, App pickup visibility, admin freight management, and delivery-center batch fulfillment.

**Architecture:** Keep the existing isolated delivery line intact. Add `DeliveryPickupBatch` as the fulfillment layer between `DeliverySubOrder` and carrier orders; buyer-facing order data is aggregated by `DeliveryOrder`, while operational carrier calls, seller actions, and cost ledgers are bound to one `DeliverySubOrder` and one `merchantId`. Huolala enterprise API integration is hidden behind a carrier adapter so admin workflows can call, sync, cancel, and reconcile batches without exposing cost fields to delivery-center users.

**Tech Stack:** NestJS 11, Prisma delivery schema, PostgreSQL, React Native 0.81 + Expo 54, React 19 + Vite + Ant Design 5, Jest, tsx node tests.

## Global Constraints

- This feature only extends the isolated delivery business line: `app/delivery/**`, `backend/prisma-delivery/schema.prisma`, `backend/src/modules/delivery/**`, `delivery-admin/**`, and `delivery-seller/**`.
- Do not merge this with normal marketplace orders, normal shipping, normal after-sale, reward, coupon, digital asset, or referral logic.
- Buyer pays once at checkout: `totalAmountCents = goodsAmountCents + prepaidPickupShippingFeeCents`.
- Every Huolala actual fee after payment is paid by the platform enterprise/monthly account and recorded as platform cost.
- First version does not auto-refund or auto-collect freight difference from the buyer.
- A pickup batch must belong to exactly one `DeliverySubOrder` and one `merchantId`; do not combine multiple merchants into one Huolala order.
- Delivery admin can see prepaid freight, Huolala actual cost, freight difference, and cost ledgers.
- Delivery center can see batch goods, quantities, address, driver, vehicle, status, and fulfillment actions; it must not receive platform cost or margin fields.
- All money is stored in integer cents inside the delivery schema.
- All quantity reservation, release, and completion changes must run inside `Prisma.TransactionIsolationLevel.Serializable`.
- Huolala secrets and access tokens stay on the backend only.
- Keep current one-payment order creation semantics: payment callback creates the delivery order after successful payment.
- Use the current branch state as source of truth and do not stage unrelated dirty worktree files.

---

## File Structure

### Backend Schema And Core Types

- Modify `backend/prisma-delivery/schema.prisma`
  - Add pickup and carrier enums.
  - Extend `DeliveryCheckoutSession`, `DeliveryOrder`, `DeliverySubOrder`, and `DeliveryOrderItem`.
  - Add `DeliveryPickupBatch`, `DeliveryPickupBatchItem`, `DeliveryCarrierOrder`, and `DeliveryShippingCostLedger`.
  - Add relations from order, sub-order, order item, and checkout to the new models.
- Modify `backend/src/modules/delivery/common/delivery-id.service.ts`
  - Ensure ID generation supports `PSTH` for pickup batch and `PSCY` for carrier order if the service validates prefixes.
- Modify `backend/src/modules/delivery/checkout/dto/create-delivery-checkout.dto.ts`
  - Add pickup mode, planned pickup count, and optional pickup plan payload.
- Create `backend/src/modules/delivery/pickup/dto/delivery-pickup.dto.ts`
  - Shared request and response DTOs for buyer/admin/seller pickup APIs.
- Create `backend/src/modules/delivery/pickup/delivery-pickup.types.ts`
  - Internal TypeScript types for snapshots, totals, status mapping, and cost redaction.

### Backend Pickup And Carrier Services

- Create `backend/src/modules/delivery/pickup/delivery-pickup-plan.service.ts`
  - Validate buyer pickup plans, split by merchant sub-order, reserve quantities, and create batches after payment.
- Create `backend/src/modules/delivery/pickup/delivery-pickup.service.ts`
  - Query, update, complete, cancel, and expose buyer/admin/seller pickup views.
- Create `backend/src/modules/delivery/pickup/delivery-buyer-pickup.controller.ts`
  - Buyer read-only pickup endpoints.
- Create `backend/src/modules/delivery/pickup/delivery-admin-pickup.controller.ts`
  - Admin batch list, call Huolala, sync, cancel, cost adjustment, and freight dashboard.
- Create `backend/src/modules/delivery/pickup/delivery-seller-pickup.controller.ts`
  - Delivery-center batch list, mark ready, mark loaded, and exception reporting.
- Create `backend/src/modules/delivery/carriers/delivery-carrier.types.ts`
  - Adapter interface and normalized carrier result types.
- Create `backend/src/modules/delivery/carriers/huolala-carrier.service.ts`
  - Huolala enterprise API signing, quote, order request, detail sync, cancel, and status mapping.
- Modify `backend/src/modules/delivery/delivery.module.ts`
  - Register pickup controllers and carrier services.
- Modify `backend/src/modules/delivery/checkout/delivery-checkout.service.ts`
  - Price and snapshot pickup plan during checkout.
- Modify `backend/src/modules/delivery/orders/delivery-orders.service.ts`
  - Create pickup batches inside paid checkout order transaction and return pickup data in order details.

### Backend Tests

- Create `backend/src/modules/delivery/pickup/delivery-pickup-plan.service.spec.ts`
- Create `backend/src/modules/delivery/pickup/delivery-pickup.service.spec.ts`
- Create `backend/src/modules/delivery/carriers/huolala-carrier.service.spec.ts`
- Modify `backend/src/modules/delivery/checkout/delivery-checkout.service.spec.ts`
- Modify `backend/src/modules/delivery/orders/delivery-orders.service.spec.ts`
- Modify `backend/src/modules/delivery/shipping/delivery-seller-shipping.controller.spec.ts` only if legacy `/ship` behavior needs an explicit compatibility assertion.

### Buyer App

- Modify `src/repos/delivery/DeliveryOrderRepo.ts`
  - Add pickup types, estimate endpoint, checkout payload fields, and pickup response mapping.
- Create `src/utils/deliveryPickupPlan.ts`
  - Pure utility for default pickup-plan generation and validation.
- Create `src/utils/__tests__/deliveryPickupPlan.test.ts`
  - Unit tests for default splitting and validation.
- Modify `app/delivery/checkout.tsx`
  - Add pickup mode, pickup count selection, plan preview, and prepaid freight display.
- Modify `app/delivery/orders/index.tsx`
  - Add pickup status labels.
- Modify `app/delivery/orders/[id].tsx`
  - Add pickup progress, remaining quantities, and batch timeline.

### Delivery Admin Frontend

- Modify `delivery-admin/src/types/delivery-management.ts`
  - Add pickup, carrier, freight dashboard, and cost ledger types.
- Modify `delivery-admin/src/api/delivery-management.ts`
  - Add freight dashboard, pickup-batch list, call Huolala, sync, cancel, and manual adjustment APIs.
- Modify `delivery-admin/src/App.tsx`
  - Register `/freight-center` and `/pickup-batches`.
- Modify `delivery-admin/src/layouts/AdminLayout.tsx`
  - Add menu entries under “订单与履约”.
- Create `delivery-admin/src/pages/delivery-admin/freight-center.tsx`
  - Freight dashboard and reconciliation list.
- Create `delivery-admin/src/pages/delivery-admin/pickup-batches.tsx`
  - Batch list and operational actions.
- Modify `delivery-admin/src/pages/delivery-admin/order-detail.tsx`
  - Add full pickup, carrier, cost ledger, and audit timeline.
- Modify `delivery-admin/src/pages/delivery-admin/shipping-records.tsx`
  - Link legacy shipping records to the new freight center and pickup batches.

### Delivery Center Frontend

- Modify `delivery-seller/src/types/index.ts`
  - Add pickup batch DTOs without platform cost fields.
- Modify `delivery-seller/src/api/orders.ts`
  - Add pickup-batch list/detail/mark-ready/mark-loaded/report-exception functions.
- Modify `delivery-seller/src/App.tsx`
  - Register `/pickup-batches`.
- Modify `delivery-seller/src/layouts/SellerLayout.tsx`
  - Add pickup-batch menu entry under “订单履约”.
- Create `delivery-seller/src/pages/pickup-batches/index.tsx`
  - Delivery-center batch workbench.
- Modify `delivery-seller/src/pages/orders/detail.tsx`
  - Replace single shipment action with batch list actions for new multi-pickup orders while keeping legacy single-shipment display.
- Modify `delivery-seller/src/pages/orders/logistics.tsx`
  - Show Huolala driver and vehicle status for pickup batches.

### Documentation And Tracking

- Modify `docs/architecture/frontend.md`
  - Record App delivery checkout and order-detail pickup changes.
- Modify `docs/architecture/admin-frontend.md`
  - Record delivery-admin freight center and pickup-batch pages.
- Modify `docs/features/shipping.md`
  - Add a delivery-line section that distinguishes Huolala pickup batches from existing SF shipping.
- Modify `docs/issues/tofix-safe.md`
  - Add any new concurrency or state-transition issue discovered during implementation.
- Modify `plan.md`
  - Add or check the delivery partial-pickup implementation item.

---

## Shared Interfaces

Use these exact internal names across tasks unless implementation discovers an already-existing stronger local convention.

```ts
export type DeliveryPickupMode = 'SINGLE' | 'MULTI_BATCH';

export type DeliveryPickupStatus =
  | 'NOT_STARTED'
  | 'PARTIAL_PICKED'
  | 'ALL_PICKED'
  | 'CANCELED';

export type DeliveryPickupBatchStatus =
  | 'PLANNED'
  | 'READY_TO_CALL'
  | 'CALLING_CARRIER'
  | 'WAITING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'ARRIVED'
  | 'LOADED'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELED'
  | 'EXCEPTION';

export type DeliveryCarrierProvider = 'SF' | 'HUOLALA' | 'MANUAL';

export type DeliveryPickupPlanItemInput = {
  cartItemId: string;
  batchNo: number;
  quantity: number;
};

export type DeliveryPickupBatchView = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  merchantName?: string;
  batchNo: number;
  status: DeliveryPickupBatchStatus;
  provider: DeliveryCarrierProvider;
  plannedPickupAt: string | null;
  estimatedShippingFeeCents: number | null;
  actualCarrierCostCents?: number | null;
  shippingCostDiffCents?: number | null;
  carrierOrderNo?: string | null;
  driverSnapshot?: unknown;
  vehicleSnapshot?: unknown;
  items: Array<{
    id: string;
    orderItemId: string;
    skuId: string;
    productTitle: string;
    skuTitle: string;
    unitName: string;
    quantity: number;
    pickedQuantity: number;
  }>;
};
```

Seller-facing DTOs must omit the optional cost fields:

```ts
export type DeliverySellerPickupBatchView = Omit<
  DeliveryPickupBatchView,
  'estimatedShippingFeeCents' | 'actualCarrierCostCents' | 'shippingCostDiffCents'
>;
```

---

## Task 1: Delivery Schema, Enums, And Generated Client

**Files:**
- Modify: `backend/prisma-delivery/schema.prisma`
- Modify: `backend/src/modules/delivery/common/delivery-id.service.ts`
- Test: `backend/src/modules/delivery/common/delivery-id.service.spec.ts`

**Interfaces:**
- Produces: Prisma models and enums consumed by all later backend tasks.
- Produces: ID prefixes `PSTH` for pickup batches and `PSCY` for carrier orders.

- [ ] **Step 1: Add schema tests for new sequence prefixes**

Add assertions to `backend/src/modules/delivery/common/delivery-id.service.spec.ts`:

```ts
it('generates delivery pickup and carrier identifiers', async () => {
  await expect(service.next('PSTH')).resolves.toMatch(/^PSTH\d{13}$/);
  await expect(service.next('PSCY')).resolves.toMatch(/^PSCY\d{13}$/);
});
```

- [ ] **Step 2: Run the prefix test and confirm it fails if prefixes are validated**

Run:

```bash
cd backend
npm test -- delivery-id.service.spec.ts --runInBand
```

Expected before implementation: the new assertions fail only if `DeliveryIdService` restricts prefixes.

- [ ] **Step 3: Extend the delivery schema**

In `backend/prisma-delivery/schema.prisma`, add these enums near the current delivery order/shipment enums:

```prisma
enum DeliveryPickupMode {
  SINGLE
  MULTI_BATCH
}

enum DeliveryPickupStatus {
  NOT_STARTED
  PARTIAL_PICKED
  ALL_PICKED
  CANCELED
}

enum DeliveryPickupBatchStatus {
  PLANNED
  READY_TO_CALL
  CALLING_CARRIER
  WAITING_DRIVER
  DRIVER_ASSIGNED
  ARRIVED
  LOADED
  DELIVERING
  COMPLETED
  CANCELED
  EXCEPTION
}

enum DeliveryCarrierProvider {
  SF
  HUOLALA
  MANUAL
}

enum DeliveryCarrierPaymentMode {
  PLATFORM_MONTHLY
  PLATFORM_WALLET
  MANUAL_OFFLINE
}

enum DeliveryShippingCostLedgerType {
  PREPAID_BY_USER
  CARRIER_ESTIMATE
  CARRIER_ACTUAL
  MANUAL_ADJUSTMENT
}
```

Extend `DeliveryCheckoutSession`:

```prisma
  pickupMode                     DeliveryPickupMode   @default(SINGLE)
  plannedPickupCount             Int                  @default(1)
  pickupPlanSnapshot             Json?
  prepaidPickupShippingFeeCents  Int                  @default(0)
```

Extend `DeliveryOrder`:

```prisma
  pickupMode                     DeliveryPickupMode   @default(SINGLE)
  plannedPickupCount             Int                  @default(1)
  pickupStatus                   DeliveryPickupStatus @default(NOT_STARTED)
  prepaidPickupShippingFeeCents  Int                  @default(0)
  actualCarrierCostCents         Int                  @default(0)
  shippingCostDiffCents          Int                  @default(0)
```

Extend `DeliverySubOrder`:

```prisma
  pickupStatus                   DeliveryPickupStatus @default(NOT_STARTED)
```

Extend `DeliveryOrderItem`:

```prisma
  pickedQuantity                 Int                  @default(0)
  reservedPickupQuantity         Int                  @default(0)
```

Add relations:

```prisma
  pickupBatches DeliveryPickupBatch[]
```

to `DeliveryOrder` and `DeliverySubOrder`, and:

```prisma
  pickupBatchItems DeliveryPickupBatchItem[]
```

to `DeliveryOrderItem`.

Add models:

```prisma
model DeliveryPickupBatch {
  id                        String                    @id
  orderId                   String
  order                     DeliveryOrder             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  subOrderId                String
  subOrder                  DeliverySubOrder          @relation(fields: [subOrderId], references: [id], onDelete: Cascade)
  merchantId                String
  merchant                  DeliveryMerchant          @relation(fields: [merchantId], references: [id], onDelete: Restrict)
  batchNo                   Int
  status                    DeliveryPickupBatchStatus @default(PLANNED)
  provider                  DeliveryCarrierProvider   @default(HUOLALA)
  plannedPickupAt           DateTime?
  readyAt                   DateTime?
  calledAt                  DateTime?
  loadedAt                  DateTime?
  completedAt               DateTime?
  canceledAt                DateTime?
  receiverSnapshot          Json?
  senderSnapshot            Json?
  cargoSnapshot             Json?
  estimatedShippingFeeCents Int?
  actualCarrierCostCents    Int?
  shippingCostDiffCents     Int?
  createdByAdminId          String?
  lastOperatorType          DeliveryAuditActorType?
  lastOperatorId            String?
  remark                    String?
  createdAt                 DateTime                  @default(now())
  updatedAt                 DateTime                  @updatedAt

  items         DeliveryPickupBatchItem[]
  carrierOrders DeliveryCarrierOrder[]
  costLedgers   DeliveryShippingCostLedger[]

  @@unique([subOrderId, batchNo])
  @@index([orderId, status, createdAt])
  @@index([merchantId, status, createdAt])
}

model DeliveryPickupBatchItem {
  id              String              @id @default(cuid())
  batchId         String
  batch           DeliveryPickupBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  orderItemId     String
  orderItem       DeliveryOrderItem   @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  skuId           String
  productSnapshot Json
  quantity        Int
  pickedQuantity  Int                 @default(0)
  createdAt       DateTime            @default(now())

  @@unique([batchId, orderItemId])
  @@index([orderItemId])
}

model DeliveryCarrierOrder {
  id                 String                     @id
  batchId            String
  batch              DeliveryPickupBatch        @relation(fields: [batchId], references: [id], onDelete: Cascade)
  provider           DeliveryCarrierProvider
  outsideOrderId     String                     @unique
  carrierOrderNo     String?
  priceCalculateId   String?
  cityId             String?
  vehicleId          String?
  payType            DeliveryCarrierPaymentMode @default(PLATFORM_MONTHLY)
  status             String
  driverSnapshot     Json?
  vehicleSnapshot    Json?
  estimatePayload    Json?
  orderPayload       Json?
  detailPayload      Json?
  cancelPayload      Json?
  estimatedFeeCents  Int?
  actualFeeCents     Int?
  lastSyncedAt       DateTime?
  createdAt          DateTime                   @default(now())
  updatedAt          DateTime                   @updatedAt

  @@index([batchId, provider])
  @@index([carrierOrderNo])
}

model DeliveryShippingCostLedger {
  id              String                         @id @default(cuid())
  orderId         String
  order           DeliveryOrder                  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  subOrderId      String?
  subOrder        DeliverySubOrder?              @relation(fields: [subOrderId], references: [id], onDelete: SetNull)
  batchId         String?
  batch           DeliveryPickupBatch?           @relation(fields: [batchId], references: [id], onDelete: SetNull)
  provider        DeliveryCarrierProvider
  type            DeliveryShippingCostLedgerType
  amountCents     Int
  source          String
  sourceRefId     String?
  payloadSnapshot Json?
  createdByType   DeliveryAuditActorType
  createdById     String?
  createdAt       DateTime                       @default(now())

  @@index([orderId, createdAt])
  @@index([batchId, createdAt])
}
```

- [ ] **Step 4: Add missing back-relations**

Add relation arrays to referenced models if Prisma validation requires them:

```prisma
model DeliveryMerchant {
  pickupBatches DeliveryPickupBatch[]
}
```

Keep these relation additions in the same schema hunk as surrounding delivery relations.

- [ ] **Step 5: Validate and generate**

Run:

```bash
cd backend
npx prisma validate --schema prisma-delivery/schema.prisma
npm run prisma:delivery:generate
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Run the prefix test**

Run:

```bash
cd backend
npm test -- delivery-id.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma-delivery/schema.prisma backend/src/modules/delivery/common/delivery-id.service.ts backend/src/modules/delivery/common/delivery-id.service.spec.ts
git commit -m "feat(delivery): add pickup batch schema"
```

---

## Task 2: Checkout Pickup Plan Snapshot And Paid-Order Batch Creation

**Files:**
- Modify: `backend/src/modules/delivery/checkout/dto/create-delivery-checkout.dto.ts`
- Modify: `backend/src/modules/delivery/checkout/delivery-checkout.service.ts`
- Modify: `backend/src/modules/delivery/orders/delivery-orders.service.ts`
- Create: `backend/src/modules/delivery/pickup/delivery-pickup.types.ts`
- Create: `backend/src/modules/delivery/pickup/dto/delivery-pickup.dto.ts`
- Create: `backend/src/modules/delivery/pickup/delivery-pickup-plan.service.ts`
- Create: `backend/src/modules/delivery/pickup/delivery-pickup-plan.service.spec.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

**Interfaces:**
- Consumes: Prisma models from Task 1.
- Produces: `DeliveryPickupPlanService.buildCheckoutPickupSnapshot(...)`.
- Produces: `DeliveryPickupPlanService.createBatchesForPaidOrder(...)`.
- Produces: `POST /delivery/checkout/estimate-pickups` response shape consumed by App task.

- [ ] **Step 1: Write plan validation tests**

Create `backend/src/modules/delivery/pickup/delivery-pickup-plan.service.spec.ts` with tests named:

```ts
describe('DeliveryPickupPlanService', () => {
  it('rejects pickup plans whose item quantities do not equal cart quantities', async () => {});
  it('splits pickup plans by merchant sub-order and does not cross merchantId boundaries', async () => {});
  it('creates batch items and reserves quantities inside a serializable transaction', async () => {});
  it('writes prepaid freight ledger rows for the paid order', async () => {});
});
```

The second test fixture must include two merchants in one checkout and assert batch groups are keyed by `subOrderId` and `merchantId`.

- [ ] **Step 2: Run the failing pickup-plan test**

Run:

```bash
cd backend
npm test -- delivery-pickup-plan.service.spec.ts --runInBand
```

Expected: FAIL because `DeliveryPickupPlanService` does not exist.

- [ ] **Step 3: Add checkout DTO fields**

In `CreateDeliveryCheckoutDto`, add validated fields:

```ts
@IsOptional()
@IsEnum(DeliveryPickupMode, { message: 'pickupMode 必须是有效的提货方式' })
pickupMode?: DeliveryPickupMode;

@IsOptional()
@Type(() => Number)
@IsInt({ message: 'plannedPickupCount 必须是整数' })
@Min(1, { message: 'plannedPickupCount 至少为 1' })
@Max(5, { message: 'plannedPickupCount 最多为 5' })
plannedPickupCount?: number;

@IsOptional()
@IsArray({ message: 'pickupPlanItems 必须为数组' })
@ValidateNested({ each: true })
@Type(() => DeliveryPickupPlanItemDto)
pickupPlanItems?: DeliveryPickupPlanItemDto[];
```

Add `DeliveryPickupPlanItemDto` in `delivery-pickup.dto.ts`:

```ts
export class DeliveryPickupPlanItemDto {
  @IsString({ message: 'cartItemId 必须为字符串' })
  cartItemId!: string;

  @Type(() => Number)
  @IsInt({ message: 'batchNo 必须是整数' })
  @Min(1, { message: 'batchNo 至少为 1' })
  batchNo!: number;

  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 至少为 1' })
  quantity!: number;
}
```

- [ ] **Step 4: Implement pickup snapshot building**

Create `DeliveryPickupPlanService.buildCheckoutPickupSnapshot` with this public signature:

```ts
async buildCheckoutPickupSnapshot(params: {
  pickupMode: DeliveryPickupMode;
  plannedPickupCount: number;
  cartItems: CheckoutCartItemForPickup[];
  merchantGroups: Array<{ merchantId: string; merchantName?: string; goodsAmountCents: number }>;
  pickupPlanItems?: Array<{ cartItemId: string; batchNo: number; quantity: number }>;
  fallbackShippingFeeCents: number;
}): Promise<{
  pickupMode: DeliveryPickupMode;
  plannedPickupCount: number;
  pickupPlanSnapshot: Prisma.InputJsonValue;
  prepaidPickupShippingFeeCents: number;
  perBatchEstimates: Array<{
    merchantId: string;
    batchNo: number;
    estimatedShippingFeeCents: number;
  }>;
}>;
```

Implementation rules:

- If `pickupMode` is `SINGLE`, return one batch per merchant using current checkout shipping fee allocation.
- If `pickupMode` is `MULTI_BATCH`, require `plannedPickupCount >= 2`.
- If no explicit plan is passed, split each cart item quantity across `plannedPickupCount` batches using integer distribution: earlier batches receive the remainder.
- Validate the sum of all planned quantities per `cartItemId` equals the cart quantity.
- Generate batch estimates per merchant and batch. First implementation may use the current platform freight rule as fallback until Huolala quote is connected in Task 3.
- Persist snapshots only; do not call Huolala from checkout in this task.

- [ ] **Step 5: Wire checkout snapshots**

In `DeliveryCheckoutService.createCheckout`:

- Resolve `pickupMode = dto.pickupMode || 'SINGLE'`.
- Resolve `plannedPickupCount = pickupMode === 'MULTI_BATCH' ? (dto.plannedPickupCount || 2) : 1`.
- Call `buildCheckoutPickupSnapshot`.
- Set `shippingFeeCents = pickupSnapshot.prepaidPickupShippingFeeCents`.
- Set `totalAmountCents = goodsAmountCents + shippingFeeCents`.
- Save `pickupMode`, `plannedPickupCount`, `pickupPlanSnapshot`, and `prepaidPickupShippingFeeCents`.
- Include pickup info in `pricingSnapshot.totals`.

- [ ] **Step 6: Add pickup estimate endpoint**

Add to `DeliveryCheckoutController`:

```ts
@Post('estimate-pickups')
estimatePickups(
  @CurrentUser('deliveryUserId') deliveryUserId: string,
  @Body() dto: CreateDeliveryCheckoutDto,
) {
  return this.deliveryCheckoutService.estimatePickups(deliveryUserId, dto);
}
```

The returned JSON must include:

```ts
{
  goodsAmountCents: number;
  prepaidPickupShippingFeeCents: number;
  totalAmountCents: number;
  plannedPickupCount: number;
  perBatchEstimates: Array<{ merchantId: string; batchNo: number; estimatedShippingFeeCents: number }>;
}
```

- [ ] **Step 7: Create pickup batches during paid-order creation**

In `DeliveryOrdersService.createOrderFromPaidCheckout`, after creating `DeliveryOrderItem` rows and before deleting cart items, call:

```ts
await this.deliveryPickupPlanService.createBatchesForPaidOrder(tx, {
  orderId,
  checkout,
  subOrderIdsByMerchantId,
  createdByProviderTxnId: params.providerTxnId,
});
```

The service must:

- Create one `DeliveryPickupBatch` per merchant/batch in the snapshot.
- Create `DeliveryPickupBatchItem` rows.
- Increment `DeliveryOrderItem.reservedPickupQuantity`.
- Create `DeliveryShippingCostLedger` row with type `PREPAID_BY_USER` at order level.
- Use `PSTH` IDs.

- [ ] **Step 8: Register the service in the module**

Modify `DeliveryModule.providers` to include `DeliveryPickupPlanService`.

- [ ] **Step 9: Run backend tests**

Run:

```bash
cd backend
npm test -- delivery-pickup-plan.service.spec.ts delivery-checkout.service.spec.ts delivery-orders.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/delivery/checkout backend/src/modules/delivery/orders backend/src/modules/delivery/pickup backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): create pickup plans from paid checkout"
```

---

## Task 3: Huolala Carrier Adapter

**Files:**
- Create: `backend/src/modules/delivery/carriers/delivery-carrier.types.ts`
- Create: `backend/src/modules/delivery/carriers/huolala-carrier.service.ts`
- Create: `backend/src/modules/delivery/carriers/huolala-carrier.service.spec.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

**Interfaces:**
- Consumes: `DeliveryPickupBatch`.
- Produces: `HuolalaCarrierService.quote`, `requestOrder`, `getOrderDetail`, `cancelOrder`, `mapHuolalaStatus`.

- [ ] **Step 1: Write Huolala unit tests**

Create tests:

```ts
describe('HuolalaCarrierService', () => {
  it('signs sorted parameters with nonce and timestamp', () => {});
  it('maps driver assigned and completed states to delivery pickup statuses', () => {});
  it('uses pickup batch id as outsideOrderId for idempotent order request', async () => {});
  it('throws ServiceUnavailableException when required config is missing', async () => {});
});
```

- [ ] **Step 2: Run failing carrier tests**

Run:

```bash
cd backend
npm test -- huolala-carrier.service.spec.ts --runInBand
```

Expected: FAIL because carrier service does not exist.

- [ ] **Step 3: Define adapter types**

In `delivery-carrier.types.ts`:

```ts
export type DeliveryCarrierQuoteRequest = {
  outsideOrderId: string;
  cityId: string;
  vehicleId: string;
  sender: DeliveryCarrierParty;
  receiver: DeliveryCarrierParty;
  cargo: DeliveryCarrierCargo;
  plannedPickupAt?: Date;
};

export type DeliveryCarrierParty = {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  lat?: number;
  lng?: number;
};

export type DeliveryCarrierCargo = {
  name: string;
  quantity: number;
  weightKg: number;
  remark?: string;
};

export type DeliveryCarrierQuoteResult = {
  provider: 'HUOLALA';
  priceCalculateId: string;
  estimatedFeeCents: number;
  rawPayload: unknown;
};

export type DeliveryCarrierOrderResult = {
  provider: 'HUOLALA';
  outsideOrderId: string;
  carrierOrderNo: string;
  status: string;
  rawPayload: unknown;
};
```

- [ ] **Step 4: Implement Huolala service**

Create `HuolalaCarrierService` with constructor dependencies:

```ts
constructor(private readonly configService: ConfigService) {}
```

Required config keys:

- `DELIVERY_HUOLALA_ENABLED`
- `DELIVERY_HUOLALA_APP_KEY`
- `DELIVERY_HUOLALA_APP_SECRET`
- `DELIVERY_HUOLALA_ACCESS_TOKEN`
- `DELIVERY_HUOLALA_PAY_TYPE`
- `DELIVERY_HUOLALA_MONTHLY_ACCOUNT_ID`

Public methods:

```ts
isAvailable(): boolean;
quote(request: DeliveryCarrierQuoteRequest): Promise<DeliveryCarrierQuoteResult>;
requestOrder(request: DeliveryCarrierQuoteRequest & { priceCalculateId: string }): Promise<DeliveryCarrierOrderResult>;
getOrderDetail(input: { carrierOrderNo?: string; outsideOrderId?: string }): Promise<DeliveryCarrierDetailResult>;
cancelOrder(input: { carrierOrderNo: string; reason: string }): Promise<DeliveryCarrierCancelResult>;
mapHuolalaStatus(rawStatus: string): DeliveryPickupBatchStatus;
```

The signer must:

- Add `app_key`, `access_token`, `nonce_str`, and `timestamp`.
- Sort all request parameters by key.
- Concatenate key/value pairs with the configured secret according to Huolala docs.
- MD5 hash to lowercase hex.

Use Node built-in `fetch`. If the project linter rejects global `fetch`, inject a small private `requestJson` wrapper and test it with a stub.

- [ ] **Step 5: Register carrier service**

Modify `DeliveryModule.providers` to include `HuolalaCarrierService`.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend
npm test -- huolala-carrier.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/delivery/carriers backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add huolala carrier adapter"
```

---

## Task 4: Admin Pickup, Freight, Cost, And Audit APIs

**Files:**
- Create: `backend/src/modules/delivery/pickup/delivery-pickup.service.ts`
- Create: `backend/src/modules/delivery/pickup/delivery-admin-pickup.controller.ts`
- Create: `backend/src/modules/delivery/pickup/delivery-pickup.service.spec.ts`
- Modify: `backend/src/modules/delivery/orders/delivery-orders.service.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

**Interfaces:**
- Consumes: pickup batches from Task 2 and Huolala adapter from Task 3.
- Produces: admin endpoints under `/delivery-admin/freight` and `/delivery-admin/pickup-batches`.

- [ ] **Step 1: Write admin service tests**

Create tests:

```ts
describe('DeliveryPickupService admin flows', () => {
  it('lists freight batches with prepaid, actual, and difference fields for admin', async () => {});
  it('calls Huolala once per batch and stores carrier order idempotently', async () => {});
  it('syncs carrier detail and updates actual cost ledger', async () => {});
  it('rejects manual cost adjustment without admin actor id', async () => {});
});
```

- [ ] **Step 2: Run failing admin pickup tests**

Run:

```bash
cd backend
npm test -- delivery-pickup.service.spec.ts --runInBand
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement admin freight dashboard**

Add `DeliveryPickupService.getFreightDashboard(query)` returning:

```ts
{
  prepaidPickupShippingFeeCents: number;
  actualCarrierCostCents: number;
  shippingCostDiffCents: number;
  exceptionBatchCount: number;
}
```

Filters:

- `from`
- `to`
- `merchantId`
- `unitId`
- `status`

- [ ] **Step 4: Implement admin batch list**

Add `DeliveryPickupService.listAdminPickupBatches(query)` returning paged items:

```ts
{
  items: DeliveryPickupBatchView[];
  total: number;
  page: number;
  pageSize: number;
}
```

Each item includes cost fields and latest carrier order fields.

- [ ] **Step 5: Implement call Huolala**

Add `DeliveryPickupService.callHuolala(batchId, adminId)`:

- Load batch with items, order, and sub-order.
- Reject if batch is `COMPLETED`, `CANCELED`, or already has a carrier order with `carrierOrderNo`.
- Create or reuse `outsideOrderId = batch.id`.
- Call `HuolalaCarrierService.quote` if current quote is missing or expired.
- Call `HuolalaCarrierService.requestOrder`.
- Store `DeliveryCarrierOrder`.
- Update batch status to `WAITING_DRIVER` or mapped status.
- Write `DeliveryAuditLog` with module `delivery-pickup`.

- [ ] **Step 6: Implement sync and cancel**

Add:

```ts
syncCarrier(batchId: string, adminId: string): Promise<DeliveryPickupBatchView>;
cancelCarrier(batchId: string, adminId: string, reason: string): Promise<DeliveryPickupBatchView>;
manualAdjustCost(batchId: string, adminId: string, amountCents: number, remark: string): Promise<DeliveryPickupBatchView>;
```

Rules:

- `syncCarrier` stores actual cost as `CARRIER_ACTUAL` once per carrier detail payload version.
- `cancelCarrier` rejects `LOADED`, `DELIVERING`, and `COMPLETED`.
- `manualAdjustCost` requires non-empty remark and creates `MANUAL_ADJUSTMENT` ledger.

- [ ] **Step 7: Add controller routes**

Create `DeliveryAdminPickupController`:

```ts
@Controller('delivery-admin')
export class DeliveryAdminPickupController {
  @Get('freight/dashboard') getDashboard() {}
  @Get('freight/batches') listFreightBatches() {}
  @Get('pickup-batches') listPickupBatches() {}
  @Post('pickup-batches/:id/call-huolala') callHuolala() {}
  @Post('pickup-batches/:id/sync-carrier') syncCarrier() {}
  @Post('pickup-batches/:id/cancel-carrier') cancelCarrier() {}
  @Post('pickup-batches/:id/manual-adjust-cost') manualAdjustCost() {}
}
```

Use `DeliveryAdminAuthGuard`, `DeliveryAdminPermissionGuard`, and `delivery:orders:read` or `delivery:orders:write` permissions.

- [ ] **Step 8: Extend admin order detail backend response**

In `DeliveryOrdersService.getAdminOrder` or the existing admin ops service that serves `/delivery-admin/orders/:id`, include:

- `pickupMode`
- `plannedPickupCount`
- `pickupStatus`
- `prepaidPickupShippingFeeCents`
- `actualCarrierCostCents`
- `shippingCostDiffCents`
- `pickupBatches`
- `shippingCostLedgers`

- [ ] **Step 9: Register service and controller**

Modify `DeliveryModule.controllers` and `providers`.

- [ ] **Step 10: Run admin backend tests**

Run:

```bash
cd backend
npm test -- delivery-pickup.service.spec.ts delivery-orders.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/delivery/pickup backend/src/modules/delivery/orders backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): expose admin pickup freight APIs"
```

---

## Task 5: Delivery Center Pickup APIs With Cost Redaction

**Files:**
- Create: `backend/src/modules/delivery/pickup/delivery-seller-pickup.controller.ts`
- Modify: `backend/src/modules/delivery/pickup/delivery-pickup.service.ts`
- Modify: `backend/src/modules/delivery/pickup/delivery-pickup.service.spec.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

**Interfaces:**
- Consumes: `DeliveryPickupService`.
- Produces: seller endpoints under `/delivery-seller/pickup-batches`.

- [ ] **Step 1: Write seller redaction and state tests**

Add tests:

```ts
describe('DeliveryPickupService seller flows', () => {
  it('lists only batches for the seller merchantId', async () => {});
  it('omits prepaid and actual freight fields from seller batch views', async () => {});
  it('marks a planned batch ready and writes audit log', async () => {});
  it('marks an arrived batch loaded and does not complete quantities until carrier completion sync', async () => {});
  it('records seller exception reports without exposing cost fields', async () => {});
});
```

- [ ] **Step 2: Run failing seller tests**

Run:

```bash
cd backend
npm test -- delivery-pickup.service.spec.ts --runInBand
```

Expected: FAIL until seller methods exist.

- [ ] **Step 3: Implement seller query methods**

Add:

```ts
listSellerPickupBatches(merchantId: string, query: PickupBatchQuery): Promise<PagedResult<DeliverySellerPickupBatchView>>;
getSellerPickupBatch(merchantId: string, batchId: string): Promise<DeliverySellerPickupBatchView>;
```

Both methods must filter by `merchantId` and call a redaction mapper that removes:

- `prepaidShippingFeeCents`
- `prepaidPickupShippingFeeCents`
- `estimatedShippingFeeCents`
- `actualCarrierCostCents`
- `shippingCostDiffCents`
- cost ledger rows

- [ ] **Step 4: Implement seller actions**

Add:

```ts
markReady(merchantId: string, staffId: string, batchId: string): Promise<DeliverySellerPickupBatchView>;
markLoaded(merchantId: string, staffId: string, batchId: string): Promise<DeliverySellerPickupBatchView>;
reportException(merchantId: string, staffId: string, batchId: string, message: string): Promise<DeliverySellerPickupBatchView>;
```

Rules:

- `markReady` allowed from `PLANNED` and `EXCEPTION`.
- `markLoaded` allowed from `ARRIVED` and `DRIVER_ASSIGNED`.
- `reportException` allowed before `COMPLETED` or `CANCELED`.
- Every action writes `DeliveryAuditLog`.

- [ ] **Step 5: Add seller controller**

Create routes:

```ts
@Controller('delivery-seller/pickup-batches')
export class DeliverySellerPickupController {
  @Get() list() {}
  @Get(':id') detail() {}
  @Post(':id/mark-ready') markReady() {}
  @Post(':id/mark-loaded') markLoaded() {}
  @Post(':id/report-exception') reportException() {}
}
```

Use `DeliverySellerAuthGuard`, `DeliverySellerPermissionGuard`, `orders:read`, and `orders:write`.

- [ ] **Step 6: Run seller backend tests**

Run:

```bash
cd backend
npm test -- delivery-pickup.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/delivery/pickup backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add seller pickup batch APIs"
```

---

## Task 6: Buyer App Checkout And Order Pickup Experience

**Files:**
- Modify: `src/repos/delivery/DeliveryOrderRepo.ts`
- Create: `src/utils/deliveryPickupPlan.ts`
- Create: `src/utils/__tests__/deliveryPickupPlan.test.ts`
- Modify: `app/delivery/checkout.tsx`
- Modify: `app/delivery/orders/index.tsx`
- Modify: `app/delivery/orders/[id].tsx`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

**Interfaces:**
- Consumes: buyer checkout and order APIs from Tasks 2 and 4.
- Produces: buyer pickup count selection, one-payment freight display, and pickup progress views.

- [ ] **Step 1: Write pickup-plan utility tests**

Create `src/utils/__tests__/deliveryPickupPlan.test.ts`:

```ts
import {
  buildDefaultDeliveryPickupPlan,
  validateDeliveryPickupPlan,
} from '../deliveryPickupPlan';

describe('deliveryPickupPlan', () => {
  it('splits quantity remainder into earlier batches', () => {
    expect(buildDefaultDeliveryPickupPlan([{ cartItemId: 'ci1', quantity: 5 }], 2)).toEqual([
      { cartItemId: 'ci1', batchNo: 1, quantity: 3 },
      { cartItemId: 'ci1', batchNo: 2, quantity: 2 },
    ]);
  });

  it('rejects plan totals that do not equal cart quantities', () => {
    expect(validateDeliveryPickupPlan(
      [{ cartItemId: 'ci1', quantity: 5 }],
      [{ cartItemId: 'ci1', batchNo: 1, quantity: 4 }],
    ).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing utility tests**

Run:

```bash
npx jest src/utils/__tests__/deliveryPickupPlan.test.ts --runInBand
```

Expected: FAIL because the utility does not exist.

- [ ] **Step 3: Implement utility functions**

Create:

```ts
export type DeliveryPickupCartItem = {
  cartItemId: string;
  quantity: number;
};

export type DeliveryPickupPlanItem = {
  cartItemId: string;
  batchNo: number;
  quantity: number;
};

export function buildDefaultDeliveryPickupPlan(
  items: DeliveryPickupCartItem[],
  plannedPickupCount: number,
): DeliveryPickupPlanItem[] {
  return items.flatMap((item) => {
    const base = Math.floor(item.quantity / plannedPickupCount);
    const remainder = item.quantity % plannedPickupCount;
    return Array.from({ length: plannedPickupCount }, (_, index) => ({
      cartItemId: item.cartItemId,
      batchNo: index + 1,
      quantity: base + (index < remainder ? 1 : 0),
    })).filter((planItem) => planItem.quantity > 0);
  });
}
```

Also implement `validateDeliveryPickupPlan` returning `{ ok: true } | { ok: false; message: string }`.

- [ ] **Step 4: Extend repository types and methods**

In `DeliveryOrderRepo.ts`:

- Add checkout payload fields:

```ts
pickupMode?: 'SINGLE' | 'MULTI_BATCH';
plannedPickupCount?: number;
pickupPlanItems?: DeliveryPickupPlanItem[];
```

- Add `estimatePickups(payload)` mapped from `/delivery/checkout/estimate-pickups`.
- Add order fields:

```ts
pickupMode: string;
plannedPickupCount: number;
pickupStatus: string;
prepaidPickupShippingFee: number;
items[].pickedQuantity: number;
items[].remainingQuantity: number;
pickupBatches: DeliveryPickupBatch[];
```

- [ ] **Step 5: Update checkout UI**

In `app/delivery/checkout.tsx`:

- Add local state `pickupMode`, `plannedPickupCount`, `pickupPlanItems`.
- Add segmented buttons for `1 / 2 / 3 / 自定义`.
- Use `buildDefaultDeliveryPickupPlan` when count changes.
- Include pickup fields in `checkoutSignature`.
- Call `DeliveryOrderRepo.estimatePickups` before locking checkout.
- Show:
  - `预计提货次数`
  - `预计提货运费`
  - `后续叫车由平台安排，用户无需再次支付`

- [ ] **Step 6: Update order list and detail UI**

In `app/delivery/orders/index.tsx`:

- Map `PARTIAL_PICKED` to `部分提货中`.
- Map `ALL_PICKED` to `已全部提货`.

In `app/delivery/orders/[id].tsx`:

- Add a “提货进度” panel.
- Show each item’s purchased, picked, and remaining quantity.
- Show each batch’s status, planned items, carrier order number, driver, vehicle, and completed time.
- Keep legacy “物流信息” panel for orders that have no pickup batches.

- [ ] **Step 7: Update docs and plan**

Update:

- `docs/architecture/frontend.md` with App delivery checkout and order detail changes.
- `plan.md` with the delivery partial-pickup App item.

- [ ] **Step 8: Run App verification**

Run:

```bash
npx jest src/utils/__tests__/deliveryPickupPlan.test.ts --runInBand
npx tsc --noEmit
```

Expected: PASS and no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/repos/delivery/DeliveryOrderRepo.ts src/utils/deliveryPickupPlan.ts src/utils/__tests__/deliveryPickupPlan.test.ts app/delivery/checkout.tsx app/delivery/orders/index.tsx 'app/delivery/orders/[id].tsx' docs/architecture/frontend.md plan.md
git commit -m "feat(delivery): add buyer partial pickup flow"
```

---

## Task 7: Delivery Admin Freight Center And Pickup Operations UI

**Files:**
- Modify: `delivery-admin/src/types/delivery-management.ts`
- Modify: `delivery-admin/src/api/delivery-management.ts`
- Modify: `delivery-admin/src/App.tsx`
- Modify: `delivery-admin/src/layouts/AdminLayout.tsx`
- Create: `delivery-admin/src/pages/delivery-admin/freight-center.tsx`
- Create: `delivery-admin/src/pages/delivery-admin/pickup-batches.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/order-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/shipping-records.tsx`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

**Interfaces:**
- Consumes: admin APIs from Task 4.
- Produces: admin freight center, pickup-batch operations page, and full order fulfillment record.

- [ ] **Step 1: Add TypeScript types**

In `delivery-admin/src/types/delivery-management.ts`, add:

```ts
export type DeliveryFreightDashboard = {
  prepaidPickupShippingFeeCents: number;
  actualCarrierCostCents: number;
  shippingCostDiffCents: number;
  exceptionBatchCount: number;
};

export type DeliveryPickupBatch = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  merchantName?: string;
  batchNo: number;
  status: string;
  provider: string;
  plannedPickupAt: string | null;
  estimatedShippingFeeCents: number | null;
  actualCarrierCostCents: number | null;
  shippingCostDiffCents: number | null;
  carrierOrderNo: string | null;
  driverSnapshot: JsonValue | null;
  vehicleSnapshot: JsonValue | null;
  items: Array<{
    id: string;
    orderItemId: string;
    skuId: string;
    productTitle: string;
    skuTitle: string;
    unitName: string;
    quantity: number;
    pickedQuantity: number;
  }>;
};
```

- [ ] **Step 2: Add API methods**

In `delivery-admin/src/api/delivery-management.ts`, add:

```ts
export const getDeliveryFreightDashboard = (params?: Record<string, QueryValue>): Promise<DeliveryFreightDashboard> =>
  client.get(withQuery('/delivery-admin/freight/dashboard', params));

export const getDeliveryPickupBatches = (
  params?: PaginationParams & { status?: string; merchantId?: string; unitId?: string },
): Promise<PagedResult<DeliveryPickupBatch>> =>
  client.get(withQuery('/delivery-admin/pickup-batches', params));

export const callDeliveryHuolala = (id: string): Promise<DeliveryPickupBatch> =>
  client.post(`/delivery-admin/pickup-batches/${id}/call-huolala`);

export const syncDeliveryCarrier = (id: string): Promise<DeliveryPickupBatch> =>
  client.post(`/delivery-admin/pickup-batches/${id}/sync-carrier`);

export const cancelDeliveryCarrier = (id: string, reason: string): Promise<DeliveryPickupBatch> =>
  client.post(`/delivery-admin/pickup-batches/${id}/cancel-carrier`, { reason });

export const adjustDeliveryPickupCost = (
  id: string,
  payload: { amountCents: number; remark: string },
): Promise<DeliveryPickupBatch> =>
  client.post(`/delivery-admin/pickup-batches/${id}/manual-adjust-cost`, payload);
```

- [ ] **Step 3: Add routes and menu**

In `delivery-admin/src/App.tsx`, add lazy imports and routes:

```tsx
const FreightCenterPage = lazy(() => import('@/pages/delivery-admin/freight-center'));
const PickupBatchesPage = lazy(() => import('@/pages/delivery-admin/pickup-batches'));
```

Routes:

```tsx
<Route path="freight-center" element={<FreightCenterPage />} />
<Route path="pickup-batches" element={<PickupBatchesPage />} />
```

In `AdminLayout`, add menu items under “订单与履约”:

```tsx
{ path: '/freight-center', name: '运费中心', permission: 'delivery:orders:read' },
{ path: '/pickup-batches', name: '提货批次', permission: 'delivery:orders:read' },
```

- [ ] **Step 4: Build freight center page**

Create `freight-center.tsx` with:

- Four metric cards: 预收运费, 货拉拉实际成本, 运费差额, 异常批次.
- Table columns: 订单号, 批次号, 商家, 状态, 预计运费, 实际成本, 差额, 货拉拉订单号, 司机, 车辆, 更新时间.
- Row actions: 同步, 取消, 调整成本, 查看订单.
- Use `Modal.confirm` for cancel and adjustment.

- [ ] **Step 5: Build pickup batches page**

Create `pickup-batches.tsx` with:

- Filters: status, merchantId, keyword, date range.
- Table grouped by order/sub-order.
- Actions: 叫货拉拉, 同步, 取消, 调整成本.
- Disable 叫车 for `COMPLETED` and `CANCELED`.

- [ ] **Step 6: Extend order detail page**

In `order-detail.tsx`, add sections:

- 支付拆分: 商品金额, 预收提货运费, 总支付.
- 提货计划: plannedPickupCount and each batch item.
- 批次履约记录: status, Huolala order, driver, vehicle, operator timeline.
- 成本记录: prepaid, estimate, actual, adjustment, difference.

- [ ] **Step 7: Update docs**

Update:

- `docs/architecture/admin-frontend.md`
- `plan.md`

- [ ] **Step 8: Build admin frontend**

Run:

```bash
cd delivery-admin
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 9: Commit**

```bash
git add delivery-admin/src docs/architecture/admin-frontend.md plan.md
git commit -m "feat(delivery-admin): add freight and pickup batch management"
```

---

## Task 8: Delivery Center Pickup Batch Workbench

**Files:**
- Modify: `delivery-seller/src/types/index.ts`
- Modify: `delivery-seller/src/api/orders.ts`
- Modify: `delivery-seller/src/App.tsx`
- Modify: `delivery-seller/src/layouts/SellerLayout.tsx`
- Create: `delivery-seller/src/pages/pickup-batches/index.tsx`
- Modify: `delivery-seller/src/pages/orders/detail.tsx`
- Modify: `delivery-seller/src/pages/orders/logistics.tsx`

**Interfaces:**
- Consumes: seller APIs from Task 5.
- Produces: cost-redacted delivery-center batch workflow.

- [ ] **Step 1: Add seller types**

In `delivery-seller/src/types/index.ts`, add:

```ts
export interface PickupBatch {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  batchNo: number;
  status: string;
  provider: string;
  plannedPickupAt?: string | null;
  carrierOrderNo?: string | null;
  driverSnapshot?: unknown;
  vehicleSnapshot?: unknown;
  items: Array<{
    id: string;
    orderItemId: string;
    skuId: string;
    productTitle: string;
    skuTitle: string;
    unitName: string;
    quantity: number;
    pickedQuantity: number;
  }>;
}
```

Do not add cost fields to this type.

- [ ] **Step 2: Add API methods**

In `delivery-seller/src/api/orders.ts`, add:

```ts
export const getPickupBatches = (params?: QueryParams): Promise<PaginatedData<PickupBatch>> =>
  client.get('/delivery-seller/pickup-batches', { params });

export const getPickupBatch = (id: string): Promise<PickupBatch> =>
  client.get(`/delivery-seller/pickup-batches/${id}`);

export const markPickupBatchReady = (id: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/mark-ready`, {});

export const markPickupBatchLoaded = (id: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/mark-loaded`, {});

export const reportPickupBatchException = (id: string, message: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/report-exception`, { message });
```

- [ ] **Step 3: Add routes and menu**

In `delivery-seller/src/App.tsx`, add:

```tsx
const PickupBatchesPage = lazy(() => import('@/pages/pickup-batches/index'));
<Route path="pickup-batches" element={<RequirePermission permission="orders:read"><PickupBatchesPage /></RequirePermission>} />
```

In `SellerLayout`, add under “订单履约”:

```tsx
{ path: '/pickup-batches', name: '提货批次', icon: <TruckOutlined />, permission: 'orders:read' }
```

- [ ] **Step 4: Build pickup-batch page**

Create `delivery-seller/src/pages/pickup-batches/index.tsx`:

- Table columns: 批次号, 订单号, 状态, 商品, 数量, 收货单位, 司机, 车辆, 预计到达.
- Actions: 已备货, 已交货, 异常反馈.
- Use `Modal.confirm` for actions.
- Never render freight cost fields.

- [ ] **Step 5: Extend order detail and logistics pages**

In `orders/detail.tsx`:

- If order has `pickupBatches`, render batch cards instead of only the legacy shipment button.
- Keep legacy `shipOrder` button for orders with no pickup batches.

In `orders/logistics.tsx`:

- Show Huolala driver and vehicle status for pickup batches.
- Keep existing shipment tracking for legacy SF records.

- [ ] **Step 6: Build seller frontend**

Run:

```bash
cd delivery-seller
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 7: Commit**

```bash
git add delivery-seller/src
git commit -m "feat(delivery-seller): add pickup batch workbench"
```

---

## Task 9: Final Verification, Safety Review, And Documentation Closure

**Files:**
- Modify: `docs/features/shipping.md`
- Modify: `docs/issues/tofix-safe.md` only if a new safety issue is found.
- Modify: `plan.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified implementation ready for staging deployment.

- [ ] **Step 1: Run backend validation**

Run:

```bash
cd backend
npx prisma validate --schema prisma-delivery/schema.prisma
npm run prisma:delivery:generate
npm test -- delivery-pickup-plan.service.spec.ts delivery-pickup.service.spec.ts huolala-carrier.service.spec.ts delivery-checkout.service.spec.ts delivery-orders.service.spec.ts --runInBand
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Run App validation**

Run:

```bash
npx jest src/utils/__tests__/deliveryPickupPlan.test.ts --runInBand
npx tsc --noEmit
```

Expected: PASS and no TypeScript errors.

- [ ] **Step 3: Run delivery-admin validation**

Run:

```bash
cd delivery-admin
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run delivery-seller validation**

Run:

```bash
cd delivery-seller
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Manual staging smoke test**

Use staging after deployment and verify:

- Buyer selects two pickup batches and pays once.
- Paid order contains one `DeliveryOrder`, merchant `DeliverySubOrder` rows, and pickup batches.
- Admin freight center shows prepaid freight, actual Huolala cost, and difference.
- Admin can call Huolala for one batch and sync status.
- Delivery center sees the batch, marks ready, marks loaded, and cannot see any platform cost.
- Buyer order detail shows purchased, picked, remaining, and batch status.

- [ ] **Step 6: Safety checklist**

Review `docs/issues/tofix-safe.md` against:

- checkout and payment amount snapshots.
- pickup quantity reservation and release.
- Huolala order idempotency by `outsideOrderId`.
- seller `merchantId` isolation.
- cost redaction in seller DTOs.
- manual adjustment audit logs.

If a new issue remains unresolved, append it to `docs/issues/tofix-safe.md` with owner, reproduction path, and mitigation.

- [ ] **Step 7: Documentation closure**

Update `docs/features/shipping.md`:

- Add “配送业务线多次提货与货拉拉” section.
- Explain it is separate from normal商城顺丰发货.
- Record Huolala enterprise API endpoints used.
- Record platform monthly-account cost treatment.

Update `plan.md`:

- Mark implemented subtasks.
- Add any release checklist item discovered during smoke testing.

- [ ] **Step 8: Commit verification docs**

```bash
git add docs/features/shipping.md docs/issues/tofix-safe.md plan.md
git commit -m "docs(delivery): document partial pickup verification"
```

---

## Execution Notes

- Implement in a clean worktree or a dedicated branch/worktree before touching code because the current workspace may contain unrelated dirty files.
- Do not push until the user explicitly asks for staging or production release.
- Keep each task commit narrow; do not combine App, admin, seller, and backend UI changes in one commit.
- If Huolala credentials are not available during implementation, keep carrier HTTP calls behind `DELIVERY_HUOLALA_ENABLED=false` and verify mocked adapter tests plus manual carrier fallback. Do not put placeholder credentials in repository files.

## Coverage Check

- One payment including future freight: Tasks 2 and 6.
- Buyer chooses pickup count at purchase: Task 6.
- Paid order creates batches: Task 2.
- Huolala enterprise API: Task 3 and Task 4.
- Platform monthly-account actual cost: Task 3 and Task 4.
- Admin freight optimization: Task 7.
- Admin full order record: Task 4 and Task 7.
- Delivery center changes: Task 5 and Task 8.
- Cost hidden from delivery center: Task 5 and Task 8.
- Serializable quantity and money operations: Task 1, Task 2, Task 4, Task 5, Task 9.
