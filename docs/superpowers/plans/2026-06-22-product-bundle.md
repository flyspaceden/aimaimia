# Product Bundle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ordinary sellable bundle products where one `Product` contains multiple existing single-product SKUs, while price belongs to the bundle and inventory, weight, display, and picking lists expand to the component SKUs.

**Architecture:** Add `Product.type = SIMPLE | BUNDLE` plus `ProductBundleItem` as the one-layer component table. Keep bundle products on the existing product, cart, CheckoutSession, order, after-sale, and seller/admin review paths; introduce a shared backend `ProductBundleService` so seller, cart, checkout, order mapping, and after-sale code all use the same validation, availability, snapshot, inventory, and weight rules.

**Tech Stack:** NestJS + Prisma + PostgreSQL, React Native + Expo, Vite + React + Ant Design, Jest/node:test.

**Spec:** `docs/superpowers/specs/2026-06-22-product-bundle-design.md`

---

## Scope Check

This is one cohesive feature, but it crosses many existing chains. Implement in chunks and commit after each task. Do not start frontend work until the backend response shapes for that chunk are stable. Before any frontend task, follow the project instruction to use `/ui-ux-pro-max`; if that slash tool is unavailable in the current harness, use the available `frontend-design` skill and note the substitution.

This work touches inventory, payment-time order creation, after-sale stock restore, shipping weight, and seller/admin authorization. Before each code chunk, check `docs/issues/tofix-safe.md` and update it if a new concurrency or money/state risk is discovered.

The current working tree may contain unrelated user changes. Stage only files listed in the active task.

---

## File Structure

### Backend Domain Foundation

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Add `ProductType`, `Product.type`, `Product.bundleItems`, `ProductSKU.bundleItems`, and `ProductBundleItem`; update InventoryLedger after-sale idempotency comment. |
| `backend/prisma/migrations/<timestamp>_product_bundles/migration.sql` | Add schema changes and replace the after-sale release partial unique index with a per-SKU idempotency index. |
| `backend/src/modules/product/product-bundle.service.ts` | Shared bundle validation, SKU merge, reference total, availability, weight, snapshot, and inventory movement helpers. |
| `backend/src/modules/product/product-bundle.service.spec.ts` | Unit tests for merge, validation, availability, weight, and inventory movement helpers. |
| `backend/src/modules/product/product.module.ts` | Export `ProductBundleService`. |

### Seller Product Backend

| File | Responsibility |
|------|----------------|
| `backend/src/modules/seller/products/seller-products.dto.ts` | Add `productType`, `bundleItems`, bundle source DTOs, and validation rules. |
| `backend/src/modules/seller/products/seller-products.service.ts` | Create/update/draft/submit bundle products, validate component SKUs, synthesize the bundle selling SKU, include bundle items in reads, block invalid child SKU removal where needed. |
| `backend/src/modules/seller/products/seller-products.controller.ts` | Expose bundle-aware create/update/draft endpoints and a source expansion endpoint if the frontend needs one. |
| `backend/src/modules/seller/products/seller-products.service.spec.ts` | Seller service tests for bundle creation, draft, submit, SKU validation, and delete/update guards. |
| `backend/src/modules/seller/products/seller-products-dto.spec.ts` | DTO validation tests. |

### Buyer Backend, Cart, Checkout, Orders, After-Sale

| File | Responsibility |
|------|----------------|
| `backend/src/modules/product/product.service.ts` | Return bundle type, bundle content, derived stock, and bundle detail data to the buyer App. |
| `backend/src/modules/cart/cart.module.ts` | Import `ProductModule`. |
| `backend/src/modules/cart/cart.service.ts` | Add/update/select bundle products using derived component stock, not bundle selling SKU stock. |
| `backend/src/modules/order/order.module.ts` | Import `ProductModule`. |
| `backend/src/modules/order/checkout.service.ts` | Build bundle snapshots, compute bundle shipping weight, validate component stock, deduct component SKU inventory on payment success. |
| `backend/src/modules/order/order.service.ts` | Map bundle snapshot to buyer order responses and repurchase paths. |
| `backend/src/modules/after-sale/after-sale-refund.service.ts` | Restore returned bundle inventory per component SKU using per-SKU idempotent ledger rows. |
| `backend/src/modules/after-sale/after-sale.service.ts` | Expose bundle snapshot in after-sale list/detail and enforce whole-bundle after-sale only. |
| `backend/src/modules/seller/orders/seller-orders.service.ts` | Return bundle snapshot to seller order list/detail. |
| `backend/src/modules/admin/products/admin-products.service.ts` | Include bundle items in product review/detail responses. |
| `backend/src/modules/admin/orders/admin-orders.service.ts` | Preserve bundle snapshot in admin order detail where order items are mapped. |

### Frontends

| File | Responsibility |
|------|----------------|
| `seller/src/types/index.ts` | Add `ProductType`, `ProductBundleItem`, bundle item snapshots on product/order item types. |
| `seller/src/api/products.ts` | Add bundle request/response fields and optional source expansion API. |
| `seller/src/pages/products/edit.tsx` | Add product type selector, bundle content editor, reference total, source bundle expansion, and bundle submit payload. |
| `seller/src/pages/products/index.tsx` | Show product type tag and bundle summary in the seller product list. |
| `seller/src/pages/orders/detail.tsx` | Show bundle contents in seller order detail. |
| `seller/src/utils/waybillPrint.ts` | Expand bundle snapshots and add SKU-level picking summary to the printable packing slip. Preserve existing uncommitted user edits. |
| `seller/test/waybillPrint.test.ts` | Cover bundle expansion and SKU picking summary. Preserve existing uncommitted user tests. |
| `admin/src/types/index.ts` | Add product type and bundle content types. |
| `admin/src/pages/products/index.tsx` | Show product type and bundle content in product review/detail flows. |
| `admin/src/pages/products/edit.tsx` | Display bundle contents read-only or guarded edit fields, depending on existing review UI pattern. |
| `src/types/domain/Product.ts` | Add bundle fields to buyer product types. |
| `src/types/domain/ServerCart.ts` | Add bundle summary fields to cart items. |
| `src/types/domain/Order.ts` | Add bundle item snapshot fields to order/after-sale item types. |
| `src/repos/ProductRepo.ts`, `src/repos/CartRepo.ts`, `src/repos/OrderRepo.ts` | Ensure live and mock paths carry bundle fields without dropping them. |
| `app/product/[id].tsx` | Show bundle contents on product detail. |
| `app/cart.tsx`, `app/checkout.tsx` | Show bundle summary and use derived stock returned by backend. |
| `app/orders/[id].tsx`, `src/components/cards/OrderItemRow.tsx`, `src/components/orders/ShopGroup.tsx` | Show bundle snapshot on orders. |
| `app/orders/after-sale/[id].tsx`, `app/orders/after-sale-detail/[id].tsx` | Show bundle snapshot and prevent child-item-only after-sale UI. |

### Docs

| File | Responsibility |
|------|----------------|
| `docs/architecture/data-system.md` | Add ProductType and ProductBundleItem. |
| `docs/architecture/seller.md` | Add bundle product seller/admin UX and API notes. |
| `docs/architecture/frontend.md` | Add buyer App bundle display surfaces after frontend implementation. |
| `docs/architecture/responsive-design.md` | Add bundle content checklist if new compact rows require responsive constraints. |
| `plan.md` | Add progress entry for bundle products. |

---

## Chunk 1: Backend Domain Foundation

### Task 1: Prisma Schema and Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_product_bundles/migration.sql`

- [ ] **Step 1: Inspect the current after-sale release unique index**

Run:

```bash
rg -n "InventoryLedger_after_sale_release_once_idx|ProductStatus|model Product|model ProductSKU" backend/prisma
```

Expected: See the existing partial unique index on `("refType", "refId")`, `ProductStatus`, `Product`, and `ProductSKU`.

- [ ] **Step 2: Add schema declarations**

In `backend/prisma/schema.prisma`, add near `ProductStatus`:

```prisma
enum ProductType {
  SIMPLE
  BUNDLE
}
```

In `model Product`, add:

```prisma
type        ProductType @default(SIMPLE)
bundleItems ProductBundleItem[] @relation("ProductBundleItems")
```

In `model ProductSKU`, add:

```prisma
bundleItems ProductBundleItem[]
```

After `ProductSKU` or near product relations, add:

```prisma
model ProductBundleItem {
  id              String     @id @default(cuid())
  bundleProductId String
  bundleProduct   Product    @relation("ProductBundleItems", fields: [bundleProductId], references: [id], onDelete: Cascade)
  skuId           String
  sku             ProductSKU @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity        Int
  sortOrder       Int        @default(0)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@unique([bundleProductId, skuId])
  @@index([bundleProductId])
  @@index([skuId])
}
```

Update the InventoryLedger comment to say the after-sale partial unique index is per `refType/refId/skuId`.

- [ ] **Step 3: Create migration**

Run:

```bash
cd backend
npx prisma migrate dev --name product_bundles
```

Expected: Migration is created and Prisma Client regenerates.

- [ ] **Step 4: Patch migration for after-sale idempotency index**

In the generated migration, include raw SQL to replace the old partial unique index:

```sql
DROP INDEX IF EXISTS "InventoryLedger_after_sale_release_once_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedger_after_sale_release_once_idx"
ON "InventoryLedger" ("refType", "refId", "skuId")
WHERE "type" = 'RELEASE'
  AND "refType" = 'AFTER_SALE'
  AND "refId" IS NOT NULL;
```

Expected: normal single-SKU after-sale still has one unique row, bundle after-sale can have one row per component SKU.

- [ ] **Step 5: Validate Prisma**

Run:

```bash
cd backend
npx prisma validate
npm run prisma:generate
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(prisma): add bundle product model"
```

### Task 2: Shared ProductBundleService

**Files:**
- Create: `backend/src/modules/product/product-bundle.service.ts`
- Create: `backend/src/modules/product/product-bundle.service.spec.ts`
- Modify: `backend/src/modules/product/product.module.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/modules/product/product-bundle.service.spec.ts` with tests for:

```ts
describe('ProductBundleService', () => {
  it('merges duplicate SKU rows and preserves first sort order', async () => {});
  it('rejects component SKU from another company', async () => {});
  it('rejects component SKU whose product type is BUNDLE', async () => {});
  it('computes availability as min(floor(stock / quantity))', async () => {});
  it('computes total weight from component weights', async () => {});
  it('builds component inventory movements from an order snapshot', async () => {});
});
```

Run:

```bash
cd backend
npm test -- --runTestsByPath src/modules/product/product-bundle.service.spec.ts
```

Expected: fail because `ProductBundleService` does not exist.

- [ ] **Step 2: Implement ProductBundleService**

Create `backend/src/modules/product/product-bundle.service.ts` with focused helpers:

```ts
export type BundleItemInput = { skuId: string; quantity: number; sortOrder?: number };
export type NormalizedBundleItem = { skuId: string; quantity: number; sortOrder: number };
export type BundleSnapshotItem = {
  skuId: string;
  productId: string;
  productTitle: string;
  skuTitle: string;
  quantityPerBundle: number;
  bundleQuantity: number;
  totalQuantity: number;
  unitPriceAtCheckout: number;
  image: string;
  weightGram: number;
};
export type InventoryMovement = {
  skuId: string;
  quantity: number;
  companyId: string;
  label: string;
};
```

Required methods:

```ts
mergeBundleItems(items: BundleItemInput[]): NormalizedBundleItem[];
calculateAvailability(items: Array<{ stock: number; quantity: number }>): number;
calculateTotalWeightGram(items: Array<{ weightGram: number; quantity: number }>): number;
buildInventoryMovements(snapshotItem: { skuId: string; quantity: number; companyId: string; productSnapshot?: any }): InventoryMovement[];
```

Add async validation methods that accept a Prisma transaction/client:

```ts
async validateSellerBundleItems(tx, companyId: string, items: BundleItemInput[], options?: { allowDraft?: boolean })
```

Validation must enforce:

- `quantity > 0`
- all SKUs exist
- SKU product belongs to `companyId`
- SKU status is `ACTIVE`
- product status is valid for the operation
- product audit status is `APPROVED` when submitting or selling
- product type is not `BUNDLE`
- `weightGram > 0`

- [ ] **Step 3: Export the service**

Modify `backend/src/modules/product/product.module.ts`:

```ts
providers: [ProductService, SemanticFillService, ProductBundleService],
exports: [ProductService, SemanticFillService, ProductBundleService],
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
npm test -- --runTestsByPath src/modules/product/product-bundle.service.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/product/product-bundle.service.ts backend/src/modules/product/product-bundle.service.spec.ts backend/src/modules/product/product.module.ts
git commit -m "feat(product): add bundle helper service"
```

---

## Chunk 2: Seller Product Backend

### Task 3: Bundle DTOs and Seller Service Writes

**Files:**
- Modify: `backend/src/modules/seller/products/seller-products.dto.ts`
- Modify: `backend/src/modules/seller/products/seller-products.service.ts`
- Modify: `backend/src/modules/seller/products/seller-products.controller.ts`
- Modify: `backend/src/modules/seller/products/seller-products.module.ts`
- Test: `backend/src/modules/seller/products/seller-products-dto.spec.ts`
- Test: `backend/src/modules/seller/products/seller-products.service.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

Add tests to `seller-products-dto.spec.ts`:

```ts
it('rejects BUNDLE create without bundleItems', async () => {});
it('rejects bundle item quantity <= 0', async () => {});
it('allows SIMPLE create without bundleItems', async () => {});
```

Run:

```bash
cd backend
npm test -- --runTestsByPath src/modules/seller/products/seller-products-dto.spec.ts
```

Expected: fail because bundle fields do not exist.

- [ ] **Step 2: Add DTO fields**

Add:

```ts
export class BundleItemDto {
  @IsString()
  @IsNotEmpty()
  skuId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
```

Add to create/update/draft DTOs:

```ts
@IsOptional()
@IsIn(['SIMPLE', 'BUNDLE'])
productType?: 'SIMPLE' | 'BUNDLE';

@IsOptional()
@IsArray()
@ValidateNested({ each: true })
@Type(() => BundleItemDto)
bundleItems?: BundleItemDto[];
```

If `productType === 'BUNDLE'`, service-level validation must require at least one valid bundle item when submitting.

- [ ] **Step 3: Write failing seller service tests**

Add tests:

```ts
it('creates BUNDLE product with one selling SKU and normalized bundleItems', async () => {});
it('uses bundle component weight as selling SKU weight', async () => {});
it('stores selling SKU stock as 0 and never as derived stock', async () => {});
it('rejects cross-company component SKU', async () => {});
it('rejects component SKU whose product type is BUNDLE', async () => {});
it('allows draft BUNDLE with incomplete items but rejects submitDraft until valid', async () => {});
```

Run:

```bash
cd backend
npm test -- --runTestsByPath src/modules/seller/products/seller-products.service.spec.ts
```

Expected: fail.

- [ ] **Step 4: Inject ProductBundleService**

Modify `seller-products.service.ts` constructor to receive `ProductBundleService`. `SellerProductsModule` already imports `ProductModule`; verify it exports the new service.

- [ ] **Step 5: Implement create/update/draft handling**

Rules:

- `SIMPLE` path remains existing behavior.
- `BUNDLE` create validates `bundleItems` in the same Serializable transaction.
- `BUNDLE` create synthesizes exactly one selling SKU:

```ts
{
  title: dto.skus?.[0]?.specName ?? '组合默认规格',
  price: +(bundleCost * markupRate).toFixed(2),
  cost: bundleCost,
  stock: 0,
  weightGram: bundleTotalWeightGram,
}
```

Use the existing single-cost field from the seller form as bundle cost. Do not expose or rely on bundle selling SKU stock.

- [ ] **Step 6: Include bundleItems in reads**

Update `findAll`, `findById`, `create`, `update`, `createDraft`, `updateDraft`, and `submitDraft` include/select shapes to return:

```ts
bundleItems: {
  orderBy: { sortOrder: 'asc' },
  include: {
    sku: {
      include: {
        product: {
          include: {
            media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    },
  },
}
```

Also return derived fields for seller UI:

- `bundleReferenceTotal`
- `bundleAvailableStock`
- `bundleTotalWeightGram`

- [ ] **Step 7: Guard child SKU removal**

When `updateSkus` would remove or inactivate a simple SKU, reject if it is referenced by any non-DRAFT bundle product. Message: `该规格已被组合商品引用，请先修改组合商品`.

- [ ] **Step 8: Run backend tests**

Run:

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/seller/products/seller-products-dto.spec.ts \
  src/modules/seller/products/seller-products.service.spec.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/seller/products backend/src/modules/product/product.module.ts
git commit -m "feat(seller): support bundle product writes"
```

### Task 4: Admin Review Backend

**Files:**
- Modify: `backend/src/modules/admin/products/admin-products.service.ts`
- Test: `backend/src/modules/admin/products/admin-products.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it('returns bundleItems on product detail for admin review', async () => {});
it('does not expose DRAFT bundle products in admin list', async () => {});
it('returns bundle reference total and total weight for review display', async () => {});
```

- [ ] **Step 2: Include bundle details**

Update `findAll` and `findById` includes to return bundle contents and derived values. Keep DRAFT exclusion unchanged.

- [ ] **Step 3: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath src/modules/admin/products/admin-products.service.spec.ts
npm run build
git add backend/src/modules/admin/products
git commit -m "feat(admin): expose bundle details for review"
```

---

## Chunk 3: Buyer Product, Cart, Checkout, Order, After-Sale

### Task 5: Buyer Product API Mapping

**Files:**
- Modify: `backend/src/modules/product/product.service.ts`
- Test: create or extend `backend/src/modules/product/product.service.spec.ts`

- [ ] **Step 1: Write failing product mapping tests**

Cover:

- list item for BUNDLE returns `type: 'BUNDLE'`
- list item `stock` is derived from components
- detail returns `bundleItems`
- detail returns bundle selling SKU as selectable SKU but component list separately

- [ ] **Step 2: Update list/detail include and mappers**

In `ProductService.list` include bundle items. In `mapToListItem`:

```ts
const isBundle = product.type === 'BUNDLE';
const stock = isBundle
  ? this.productBundleService.calculateAvailability(...)
  : activeSkus.reduce(...);
```

In `mapToDetail`, include:

```ts
type: product.type,
bundleItems: product.bundleItems.map(...),
bundleReferenceTotal,
bundleAvailableStock,
bundleTotalWeightGram,
```

- [ ] **Step 3: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath src/modules/product/product.service.spec.ts
git add backend/src/modules/product
git commit -m "feat(product): expose bundle products to buyers"
```

### Task 6: Cart Bundle Availability

**Files:**
- Modify: `backend/src/modules/cart/cart.module.ts`
- Modify: `backend/src/modules/cart/cart.service.ts`
- Test: `backend/src/modules/cart/cart-stock-availability.spec.ts`
- Test: `backend/src/modules/cart/cart-max-per-order.spec.ts`

- [ ] **Step 1: Write failing cart tests**

Add tests:

```ts
it('allows adding bundle when all component SKUs have enough stock', async () => {});
it('rejects adding bundle when a component SKU is out of stock', async () => {});
it('rejects increasing bundle quantity beyond derived availability', async () => {});
it('marks bundle cart item OUT_OF_STOCK from component stock, not selling SKU stock', async () => {});
```

- [ ] **Step 2: Import ProductModule and inject ProductBundleService**

Modify `CartModule` imports:

```ts
imports: [BonusModule, ProductModule]
```

- [ ] **Step 3: Replace stock checks for bundle SKUs**

In `addItem`, `updateItemQuantity`, selection checks, and cart response mapping:

```ts
if (sku.product.type === 'BUNDLE') {
  const availability = await this.productBundleService.getAvailabilityForBundleProduct(txOrPrisma, sku.product.id);
  if (quantity > availability) throw new BadRequestException(`组合商品当前仅剩 ${availability} 件`);
} else {
  // existing sku.stock checks
}
```

Never use bundle selling SKU `stock` for availability.

- [ ] **Step 4: Include bundle summary in cart response**

Return cart item product summary:

```ts
product: {
  ...,
  type: 'BUNDLE',
  bundleItems: [...],
  stock: bundleAvailableStock,
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/cart/cart-stock-availability.spec.ts \
  src/modules/cart/cart-max-per-order.spec.ts
git add backend/src/modules/cart
git commit -m "feat(cart): support bundle stock checks"
```

### Task 7: Checkout Snapshot, Shipping Weight, and Inventory Deduction

**Files:**
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`
- Test: `backend/src/modules/order/checkout-stock-availability.spec.ts`
- Test: `backend/src/modules/order/checkout-shipping-lock.spec.ts`
- Test: `backend/src/modules/order/checkout-money-safety.spec.ts`

- [ ] **Step 1: Write failing checkout tests**

Cover:

```ts
it('rejects bundle checkout when a component SKU has insufficient stock', async () => {});
it('uses component SKU weights for bundle shipping detail', async () => {});
it('stores bundleItems in productSnapshot', async () => {});
it('deducts component SKU inventory on payment success', async () => {});
it('does not deduct bundle selling SKU stock on payment success', async () => {});
```

- [ ] **Step 2: Import ProductModule and inject ProductBundleService**

Modify `OrderModule` imports and `CheckoutService` constructor.

- [ ] **Step 3: Extend SnapshotItem semantics**

Keep the order item as the bundle selling SKU, but add bundle snapshot data:

```ts
productSnapshot: {
  productId,
  companyId,
  productType: 'BUNDLE',
  title,
  skuTitle,
  image,
  price: unitPrice,
  bundleItems: BundleSnapshotItem[],
  bundleTotalWeightGram,
}
```

- [ ] **Step 4: Build bundle snapshots during createCheckoutSession**

When `sku.product.type === 'BUNDLE'`:

- validate component SKUs are still active and approved
- compute availability from components
- reject if requested bundle quantity exceeds availability
- set `unitPrice` from the bundle selling SKU
- set `companyId` to the bundle product company
- compute shipping weight from `bundleTotalWeightGram * item.quantity`

For SIMPLE products, keep current behavior.

- [ ] **Step 5: Deduct component inventory on payment success**

Replace the inventory loop with helper output:

```ts
for (const item of items) {
  const movements = this.productBundleService.buildInventoryMovements(item);
  for (const movement of movements) {
    await tx.productSKU.update({
      where: { id: movement.skuId },
      data: { stock: { decrement: movement.quantity } },
    });
    await tx.inventoryLedger.create({
      data: {
        skuId: movement.skuId,
        type: 'RESERVE',
        qty: -movement.quantity,
        refType: 'ORDER',
        refId: refOrderId,
      },
    });
  }
}
```

Keep the existing VIP_PACKAGE reservation migration path unchanged.

- [ ] **Step 6: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/order/checkout-stock-availability.spec.ts \
  src/modules/order/checkout-shipping-lock.spec.ts \
  src/modules/order/checkout-money-safety.spec.ts
git add backend/src/modules/order
git commit -m "feat(checkout): expand bundle inventory and weight"
```

### Task 8: Order Mapping, Repurchase, and After-Sale Restore

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Test: `backend/src/modules/order/map-order.spec.ts`
- Test: `backend/src/modules/order/order-repurchase.spec.ts`
- Test: `backend/src/modules/after-sale/after-sale-refund.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```ts
it('maps bundleItems from productSnapshot into order item response', async () => {});
it('repurchases a bundle as the bundle selling SKU after checking derived stock', async () => {});
it('restocks each bundle component SKU once when returned bundle is refunded', async () => {});
it('does not double-restock bundle components on duplicate refund notifications', async () => {});
```

- [ ] **Step 2: Map bundle snapshots**

In `mapOrder` / `mapOrderDetail`, include:

```ts
bundleItems: ps.bundleItems || [],
productType: ps.productType || 'SIMPLE',
```

- [ ] **Step 3: Update repurchase**

For BUNDLE order items, re-add the bundle selling SKU if current derived availability is sufficient. If any component is out of stock, use the existing virtual out-of-stock result style and do not add a cart row.

- [ ] **Step 4: Update after-sale display and whole-bundle rule**

Use `orderItem.productSnapshot.bundleItems` for after-sale detail display. Do not add any child selection UI or child refund calculation.

- [ ] **Step 5: Update after-sale stock restore**

In `after-sale-refund.service.ts`, build restock rows:

- SIMPLE: current `orderItem.skuId`, `orderItem.quantity`
- BUNDLE: each `bundleItems[].skuId`, `bundleItems[].totalQuantity`

Use the new per-SKU partial unique index. Query existing release ledgers by `refType/refId` and SKU set, then increment only missing SKU rows.

- [ ] **Step 6: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/order/map-order.spec.ts \
  src/modules/order/order-repurchase.spec.ts \
  src/modules/after-sale/after-sale-refund.service.spec.ts
git add backend/src/modules/order backend/src/modules/after-sale
git commit -m "feat(order): map and restore bundle snapshots"
```

### Task 9: Seller/Admin Order Backend

**Files:**
- Modify: `backend/src/modules/seller/orders/seller-orders.service.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`
- Test: `backend/src/modules/seller/orders/seller-orders.service.spec.ts`
- Test: add or extend `backend/src/modules/admin/orders/admin-orders.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Seller order detail and admin order detail should include `bundleItems` from `productSnapshot`.

- [ ] **Step 2: Map bundle snapshots**

For each order item response:

```ts
bundleItems: (item.productSnapshot as any)?.bundleItems || []
productType: (item.productSnapshot as any)?.productType || 'SIMPLE'
```

- [ ] **Step 3: Run tests and commit**

```bash
cd backend
npm test -- --runTestsByPath \
  src/modules/seller/orders/seller-orders.service.spec.ts
npm run build
git add backend/src/modules/seller/orders backend/src/modules/admin/orders
git commit -m "feat(orders): expose bundle snapshots to back offices"
```

---

## Chunk 4: Seller and Admin Frontends

### Task 10: Seller Product Create/Edit UI

**Files:**
- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/api/products.ts`
- Modify: `seller/src/pages/products/edit.tsx`
- Modify: `seller/src/pages/products/index.tsx`
- Docs after task: `docs/architecture/seller.md`, `plan.md`

- [ ] **Step 1: Run required frontend design gate**

Use `/ui-ux-pro-max` before UI changes. If unavailable, use `frontend-design` and note it in the implementation summary.

- [ ] **Step 2: Add types**

Add:

```ts
export type ProductType = 'SIMPLE' | 'BUNDLE';
export interface ProductBundleItem {
  skuId: string;
  quantity: number;
  sortOrder?: number;
  productTitle?: string;
  skuTitle?: string;
  imageUrl?: string | null;
  price?: number;
  stock?: number;
  weightGram?: number;
}
```

Extend `Product` with `type`, `bundleItems`, `bundleReferenceTotal`, `bundleAvailableStock`, `bundleTotalWeightGram`.

- [ ] **Step 3: Add bundle payload helpers**

In `seller/src/api/products.ts`, type create/update/draft payloads to accept:

```ts
productType?: ProductType;
bundleItems?: Array<{ skuId: string; quantity: number; sortOrder?: number }>;
```

- [ ] **Step 4: Implement UI**

In `ProductCreateForm`:

- segmented control: 普通商品 / 组合商品
- bundle content table with add/remove quantity controls
- SKU picker limited to current merchant product SKUs returned by seller product API
- source bundle selector that expands existing bundle's child SKUs
- duplicate SKU merge
- reference total display: `sum(price * quantity)`
- derived availability display
- bundle cost uses the existing single-cost field label adjusted to `组合成本价`
- hide independent stock input for BUNDLE

Keep create/edit/draft branches consistent with the existing draft behavior.

- [ ] **Step 5: List page display**

In `products/index.tsx`, show a `组合` tag for `type === 'BUNDLE'` and a compact bundle item count.

- [ ] **Step 6: Build and docs**

Run:

```bash
cd seller
npm run build
```

Update:

- `docs/architecture/seller.md`
- `plan.md`

Commit:

```bash
git add seller/src/types/index.ts seller/src/api/products.ts seller/src/pages/products/edit.tsx seller/src/pages/products/index.tsx docs/architecture/seller.md plan.md
git commit -m "feat(seller): add bundle product editor"
```

### Task 11: Admin Product Review UI

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/products/index.tsx`
- Modify: `admin/src/pages/products/edit.tsx`
- Docs after task: `plan.md`

- [ ] **Step 1: Run required frontend design gate**

Use `/ui-ux-pro-max` or `frontend-design` fallback.

- [ ] **Step 2: Add types and display**

Show bundle content in product review/detail:

- component product/SKU
- quantity
- current price subtotal
- reference total
- total weight

Do not expose cross-merchant edits.

- [ ] **Step 3: Build and commit**

```bash
cd admin
npm run build
git add admin/src/types/index.ts admin/src/pages/products/index.tsx admin/src/pages/products/edit.tsx plan.md
git commit -m "feat(admin): review bundle product contents"
```

### Task 12: Seller Order Detail and Print Sheet

**Files:**
- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/pages/orders/detail.tsx`
- Modify: `seller/src/utils/waybillPrint.ts`
- Modify: `seller/test/waybillPrint.test.ts`
- Docs after task: `docs/architecture/seller.md`, `plan.md`

- [ ] **Step 1: Preserve existing uncommitted print files**

Before editing, inspect:

```bash
git status --short seller/src/utils/waybillPrint.ts seller/test/waybillPrint.test.ts
git diff -- seller/src/utils/waybillPrint.ts seller/test/waybillPrint.test.ts
```

These files may contain user changes. Work with them; do not overwrite them.

- [ ] **Step 2: Write failing print test**

Add a bundle order fixture:

```ts
{
  title: '水果礼盒',
  quantity: 2,
  productType: 'BUNDLE',
  bundleItems: [
    { productTitle: '红富士苹果', skuTitle: '5斤装', totalQuantity: 4 },
    { productTitle: '皇冠梨', skuTitle: '3斤装', totalQuantity: 2 },
  ],
}
```

Assert the HTML contains both:

- nested bundle detail under `水果礼盒 x2`
- picking summary rows for `红富士苹果 / 5斤装 x4`

- [ ] **Step 3: Implement seller display and print expansion**

In order detail, show bundle contents under the order item. In print HTML, render:

- original order rows
- nested bundle lines
- SKU-level picking summary across normal and bundle items

Do not print prices.

- [ ] **Step 4: Run tests/build and commit**

```bash
cd seller
node --test test/waybillPrint.test.ts
npm run build
git add seller/src/types/index.ts seller/src/pages/orders/detail.tsx seller/src/utils/waybillPrint.ts seller/test/waybillPrint.test.ts docs/architecture/seller.md plan.md
git commit -m "feat(seller): print bundle picking details"
```

---

## Chunk 5: Buyer App Frontend

### Task 13: Buyer Types and Product Detail

**Files:**
- Modify: `src/types/domain/Product.ts`
- Modify: `src/repos/ProductRepo.ts`
- Modify: `app/product/[id].tsx`
- Docs after task: `docs/architecture/frontend.md`, `docs/architecture/responsive-design.md`, `plan.md`

- [ ] **Step 1: Run required frontend design gate**

Use `/ui-ux-pro-max` or `frontend-design` fallback.

- [ ] **Step 2: Add buyer product bundle types**

Add:

```ts
export type ProductType = 'SIMPLE' | 'BUNDLE';
export type ProductBundleItem = {
  skuId: string;
  productId: string;
  productTitle: string;
  skuTitle: string;
  quantity: number;
  image?: string;
};
```

Extend `Product` and `ProductDetail` with `type`, `bundleItems`, `bundleAvailableStock`, `bundleTotalWeightGram`.

- [ ] **Step 3: Render bundle contents on detail**

In `app/product/[id].tsx`, add a compact “组合内容” section with fixed row constraints so text does not overlap at large font sizes.

- [ ] **Step 4: Validate**

Run:

```bash
npx tsc --noEmit --pretty false
```

If the Expo project uses a different typecheck path, use the existing project command and record it.

- [ ] **Step 5: Docs and commit**

```bash
git add src/types/domain/Product.ts src/repos/ProductRepo.ts app/product/[id].tsx docs/architecture/frontend.md docs/architecture/responsive-design.md plan.md
git commit -m "feat(app): show bundle product contents"
```

### Task 14: Buyer Cart, Checkout, Orders, and After-Sale Display

**Files:**
- Modify: `src/types/domain/ServerCart.ts`
- Modify: `src/types/domain/Order.ts`
- Modify: `src/repos/CartRepo.ts`
- Modify: `src/repos/OrderRepo.ts`
- Modify: `app/cart.tsx`
- Modify: `app/checkout.tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `src/components/cards/OrderItemRow.tsx`
- Modify: `src/components/orders/ShopGroup.tsx`
- Modify: `app/orders/after-sale/[id].tsx`
- Modify: `app/orders/after-sale-detail/[id].tsx`
- Docs after task: `docs/architecture/frontend.md`, `plan.md`

- [ ] **Step 1: Run required frontend design gate**

Use `/ui-ux-pro-max` or `frontend-design` fallback.

- [ ] **Step 2: Extend cart and order types**

Add bundle snapshot fields to `ServerCartItem` and `OrderItem`:

```ts
productType?: 'SIMPLE' | 'BUNDLE';
bundleItems?: Array<{
  skuId: string;
  productTitle: string;
  skuTitle: string;
  quantityPerBundle?: number;
  totalQuantity?: number;
  image?: string;
}>;
```

- [ ] **Step 3: Render bundle summaries**

Add compact bundle summary rows in:

- cart
- checkout
- order detail
- order cards where space allows
- after-sale detail

Do not add child-item after-sale selection; keep one after-sale action for the whole order item.

- [ ] **Step 4: Validate**

Run:

```bash
npx tsc --noEmit --pretty false
```

- [ ] **Step 5: Docs and commit**

```bash
git add src/types/domain/ServerCart.ts src/types/domain/Order.ts src/repos/CartRepo.ts src/repos/OrderRepo.ts app/cart.tsx app/checkout.tsx app/orders/[id].tsx src/components/cards/OrderItemRow.tsx src/components/orders/ShopGroup.tsx app/orders/after-sale/[id].tsx app/orders/after-sale-detail/[id].tsx docs/architecture/frontend.md plan.md
git commit -m "feat(app): render bundle snapshots in cart and orders"
```

---

## Chunk 6: Final Verification and Docs

### Task 15: Architecture Docs and Safety Checklist

**Files:**
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/seller.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/responsive-design.md`
- Modify: `docs/issues/tofix-safe.md` if any new issue is found or resolved
- Modify: `plan.md`

- [ ] **Step 1: Update docs**

Document:

- `ProductType`
- `ProductBundleItem`
- seller bundle editor
- buyer bundle display
- checkout inventory expansion
- after-sale whole-bundle rule
- seller print picking summary

- [ ] **Step 2: Safety audit**

Review `docs/issues/tofix-safe.md` checklist against:

- Serializable inventory deductions
- after-sale per-SKU idempotency
- cross-merchant SKU validation
- no bundle nesting
- snapshot-based print and after-sale restore

Update the file only if the implementation fixes or discovers a tracked safety issue.

- [ ] **Step 3: Commit docs**

```bash
git add docs/architecture/data-system.md docs/architecture/seller.md docs/architecture/frontend.md docs/architecture/responsive-design.md docs/issues/tofix-safe.md plan.md
git commit -m "docs: document bundle product flow"
```

### Task 16: Full Verification

**Files:** none unless fixing failures.

- [ ] **Step 1: Prisma and backend**

```bash
cd backend
npx prisma validate
npm run build
npm test -- --runTestsByPath \
  src/modules/product/product-bundle.service.spec.ts \
  src/modules/seller/products/seller-products.service.spec.ts \
  src/modules/cart/cart-stock-availability.spec.ts \
  src/modules/order/checkout-stock-availability.spec.ts \
  src/modules/order/checkout-shipping-lock.spec.ts \
  src/modules/order/map-order.spec.ts \
  src/modules/after-sale/after-sale-refund.service.spec.ts
```

Expected: all pass.

- [ ] **Step 2: Seller and admin builds**

```bash
cd seller
npm run build
node --test test/waybillPrint.test.ts

cd ../admin
npm run build
```

Expected: all pass.

- [ ] **Step 3: Buyer app typecheck/export smoke**

```bash
npx tsc --noEmit --pretty false
```

If this project requires Expo export for the final smoke, run:

```bash
npx expo export --platform web --output-dir /tmp/aimaimai-bundle-export
```

Expected: typecheck and export pass, or only documented non-blocking Expo warnings appear.

- [ ] **Step 4: Manual verification**

Verify in staging or local seeded data:

1. Seller creates BUNDLE draft from two simple SKUs.
2. Seller expands existing BUNDLE as a source; final rows are simple SKUs and duplicates merge.
3. Seller sees reference total and enters bundle cost.
4. Admin sees bundle content and approves it.
5. Buyer sees bundle content in detail/cart/checkout/order.
6. Checkout uses component availability.
7. Payment success deducts component SKU stock only.
8. Seller order print shows nested bundle content and SKU picking summary.
9. After-sale return refund restores component SKU stock once.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git status --short
git add <only files fixed during verification>
git commit -m "fix: stabilize bundle product verification"
```

---

## Rollback Plan

1. Before production release, rollback is `git revert` of the feature commits plus dropping the generated migration in non-production environments.
2. After migration reaches production, do not drop tables casually. Hide bundle creation in seller UI, reject `productType=BUNDLE` create/update in backend, and leave existing bundle rows readable for historical orders.
3. If bundle checkout is unsafe, disable BUNDLE products by setting affected products to `INACTIVE`; existing historical orders remain readable because order snapshots carry bundle contents.
4. If after-sale restock idempotency is wrong, pause bundle after-sale completion and patch `InventoryLedger_after_sale_release_once_idx` plus restore logic before resuming.

---

## Execution Handoff

Implement with one fresh worker/checkpoint per task if subagents are available. If not, use `superpowers:executing-plans` in this session and stop after each chunk for review.
