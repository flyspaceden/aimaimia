# Group Buy Multi Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one group-buy activity contain multiple platform product SKUs while keeping the rebate base equal to the configured group-buy price.

**Architecture:** Add `GroupBuyActivityItem` as the activity composition table, keep `GroupBuyActivity.productId/skuId` as first-item compatibility fields, and make buyer/admin APIs return a normalized item list. Group-buy checkout generates multi-row `itemsSnapshot` with price allocations that sum to `activity.price`, so existing order creation, inventory deduction, refund, and group-buy lifecycle logic continue to work.

**Tech Stack:** NestJS + Prisma + PostgreSQL, React 19 + Ant Design admin, Expo React Native buyer App, Jest, node:test, TypeScript project references.

## Global Constraints

- Group-buy composition items must only reference platform-company products and active SKUs.
- Rebate amount is calculated from the configured group-buy activity price, not the sum of component SKU prices.
- Group-buy checkout remains cash-only: no reward deduction, group-buy rebate deduction, or platform coupon.
- A user can still occupy only one group-buy slot at a time.
- Existing one-SKU group-buy activities must remain readable and payable through fallback and migration backfill.
- Sensitive marketing copy remains excluded from App group-buy pages.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Add `GroupBuyActivityItem` and relations. |
| `backend/prisma/migrations/20260623020000_group_buy_activity_items/migration.sql` | Create item table and backfill current activities from `productId/skuId`. |
| `backend/src/modules/admin/group-buy/admin-group-buy.dto.ts` | Add `items` DTOs and keep legacy `productId/skuId` optional-compatible inputs. |
| `backend/src/modules/admin/group-buy/admin-group-buy.service.ts` | Validate/normalize activity items, save them transactionally, expose product catalog, and include items in activity reads. |
| `backend/src/modules/admin/group-buy/admin-group-buy.controller.ts` | Add product catalog route. |
| `backend/src/modules/admin/reward-product/reward-product.service.ts` | Extend reference protection to `GroupBuyActivityItem`. |
| `backend/src/modules/group-buy/group-buy.service.ts` | Return normalized item list, available stock, total weight, and item summary to buyer APIs. |
| `backend/src/modules/group-buy/group-buy-checkout.service.ts` | Build multi-item snapshots, price allocations, stock checks, and weight-based shipping. |
| `admin/src/api/group-buy.ts` / `admin/src/types/index.ts` | Add catalog and activity item types. |
| `admin/src/pages/group-buy/activities.tsx` | Replace single product/SKU fields with group-buy items editor. |
| `src/types/domain/GroupBuy.ts` / `src/repos/GroupBuyRepo.ts` | Add buyer item fields and mocks. |
| `src/components/group-buy/GroupBuyProductCard.tsx`, `app/group-buy/[activityId].tsx`, `app/gb/[code].tsx`, `app/group-buy/checkout.tsx` | Display group-buy item summaries and detail rows. |
| `docs/architecture/frontend.md`, `docs/architecture/admin-frontend.md`, `plan.md` | Document completed multi-item group-buy work. |

---

## Task 1: Database and Backend Contract Foundation

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260623020000_group_buy_activity_items/migration.sql`
- Modify: `backend/src/modules/admin/group-buy/admin-group-buy.dto.ts`
- Modify: `backend/src/modules/admin/group-buy/admin-group-buy.service.spec.ts`

**Interfaces:**
- Produces: `CreateGroupBuyActivityDto.items?: GroupBuyActivityItemInputDto[]`
- Produces: `UpdateGroupBuyActivityDto.items?: GroupBuyActivityItemInputDto[]`
- Produces: schema relation `GroupBuyActivity.items`

- [ ] **Step 1: Add failing admin service expectations**

Update `backend/src/modules/admin/group-buy/admin-group-buy.service.spec.ts` so `createDto` includes:

```ts
items: [
  { productId: 'product_1', skuId: 'sku_1', quantity: 1, sortOrder: 0 },
  { productId: 'product_2', skuId: 'sku_2', quantity: 2, sortOrder: 1 },
],
```

Extend the test transaction mock with:

```ts
groupBuyActivityItem: {
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  createMany: jest.fn().mockResolvedValue({ count: 2 }),
},
```

Add assertions:

```ts
expect(tx.groupBuyActivity.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    productId: 'product_1',
    skuId: 'sku_1',
  }),
}));
expect(tx.groupBuyActivityItem.createMany).toHaveBeenCalledWith({
  data: [
    expect.objectContaining({ activityId: 'activity_1', productId: 'product_1', skuId: 'sku_1', quantity: 1, sortOrder: 0 }),
    expect.objectContaining({ activityId: 'activity_1', productId: 'product_2', skuId: 'sku_2', quantity: 2, sortOrder: 1 }),
  ],
});
```

- [ ] **Step 2: Run failing backend test**

Run:

```bash
cd backend
npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand
```

Expected: fails because `items` DTO/schema logic does not exist.

- [ ] **Step 3: Add Prisma schema and migration**

Add relation in `GroupBuyActivity`:

```prisma
items GroupBuyActivityItem[]
```

Add model:

```prisma
model GroupBuyActivityItem {
  id         String           @id @default(cuid())
  activityId String
  activity   GroupBuyActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  productId  String
  product    Product          @relation(fields: [productId], references: [id], onDelete: Restrict)
  skuId      String
  sku        ProductSKU       @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity   Int
  sortOrder  Int              @default(0)
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  @@unique([activityId, skuId])
  @@index([activityId])
  @@index([productId])
  @@index([skuId])
}
```

Migration SQL:

```sql
CREATE TABLE "GroupBuyActivityItem" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupBuyActivityItem_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GroupBuyActivityItem" ("id", "activityId", "productId", "skuId", "quantity", "sortOrder", "createdAt", "updatedAt")
SELECT concat('gbai_', "id"), "id", "productId", "skuId", 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GroupBuyActivity"
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "GroupBuyActivityItem_activityId_skuId_key" ON "GroupBuyActivityItem"("activityId", "skuId");
CREATE INDEX "GroupBuyActivityItem_activityId_idx" ON "GroupBuyActivityItem"("activityId");
CREATE INDEX "GroupBuyActivityItem_productId_idx" ON "GroupBuyActivityItem"("productId");
CREATE INDEX "GroupBuyActivityItem_skuId_idx" ON "GroupBuyActivityItem"("skuId");

ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GroupBuyActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Add DTO input**

Add `GroupBuyActivityItemInputDto`:

```ts
export class GroupBuyActivityItemInputDto {
  @IsString({ message: '商品 ID 必须为字符串' })
  @IsNotEmpty({ message: '商品 ID 不能为空' })
  productId: string;

  @IsString({ message: 'SKU ID 必须为字符串' })
  @IsNotEmpty({ message: 'SKU ID 不能为空' })
  skuId: string;

  @IsInt({ message: '商品数量必须为整数' })
  @Min(1, { message: '商品数量必须大于 0' })
  quantity: number;

  @IsOptional()
  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;
}
```

Add to create/update DTOs:

```ts
@IsOptional()
@IsArray({ message: '团购商品组合必须为数组' })
@ValidateNested({ each: true })
@Type(() => GroupBuyActivityItemInputDto)
items?: GroupBuyActivityItemInputDto[];
```

- [ ] **Step 5: Verify schema**

Run:

```bash
cd backend
DATABASE_URL='postgresql://user:password@localhost:5432/aimm_test?schema=public' npx prisma validate
DATABASE_URL='postgresql://user:password@localhost:5432/aimm_test?schema=public' npx prisma generate
```

Expected: schema valid and Prisma Client generated.

---

## Task 2: Admin Backend Multi-Item Activity Logic

**Files:**
- Modify: `backend/src/modules/admin/group-buy/admin-group-buy.service.ts`
- Modify: `backend/src/modules/admin/group-buy/admin-group-buy.controller.ts`
- Modify: `backend/src/modules/admin/group-buy/admin-group-buy.service.spec.ts`
- Modify: `backend/src/modules/admin/reward-product/reward-product.service.ts`

**Interfaces:**
- Consumes: `GroupBuyActivityItemInputDto[]`
- Produces: `AdminGroupBuyService.normalizeActivityItems(dto)` as internal helper
- Produces: `GET /admin/group-buy/product-catalog`

- [ ] **Step 1: Add failing tests**

Add tests to `admin-group-buy.service.spec.ts`:

```ts
it('rejects empty activity items', async () => {
  const { tx, service } = buildPrisma();
  await expect(service.create({ ...createDto, items: [] } as any)).rejects.toThrow('请至少添加一个团购商品');
  expect(tx.groupBuyActivity.create).not.toHaveBeenCalled();
});

it('rejects an item whose sku does not belong to the selected product', async () => {
  const { tx, service } = buildPrisma();
  tx.productSKU.findUnique.mockResolvedValueOnce({ id: 'sku_2', productId: 'other_product', status: 'ACTIVE', weightGram: 1000 });
  await expect(service.create({
    ...createDto,
    items: [{ productId: 'product_1', skuId: 'sku_2', quantity: 1 }],
  } as any)).rejects.toThrow('SKU 不属于所选商品');
});
```

- [ ] **Step 2: Implement normalize and save**

Implement helpers:

```ts
private getRawActivityItems(dto: CreateGroupBuyActivityDto | UpdateGroupBuyActivityDto, existing?: { productId: string; skuId: string } | null) {
  if (Array.isArray(dto.items) && dto.items.length > 0) return dto.items;
  const productId = dto.productId ?? existing?.productId;
  const skuId = dto.skuId ?? existing?.skuId;
  return productId && skuId ? [{ productId, skuId, quantity: 1, sortOrder: 0 }] : [];
}

private normalizeActivityItems(items: Array<{ productId: string; skuId: string; quantity: number; sortOrder?: number }>) {
  if (items.length === 0) throw new BadRequestException('请至少添加一个团购商品');
  const merged = new Map<string, { productId: string; skuId: string; quantity: number; sortOrder: number }>();
  items.forEach((item, index) => {
    const quantity = Math.floor(Number(item.quantity));
    if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException('团购商品数量必须大于 0');
    const existing = merged.get(item.skuId);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    merged.set(item.skuId, {
      productId: item.productId,
      skuId: item.skuId,
      quantity,
      sortOrder: item.sortOrder ?? index,
    });
  });
  return Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}
```

Use normalized first item for compatibility `productId/skuId`. On create, create activity first, then `groupBuyActivityItem.createMany`. On update, delete and recreate items when `dto.items`, `dto.productId`, or `dto.skuId` is provided.

- [ ] **Step 3: Add item validation**

Replace single `assertPlatformProductSku` usage with validation for every normalized item. Validate:

```ts
product.companyId === PLATFORM_COMPANY_ID
product.status === ProductStatus.ACTIVE
sku.productId === productId
sku.status === SkuStatus.ACTIVE
sku.weightGram > 0
```

- [ ] **Step 4: Add product catalog**

Service method returns active platform products with SKUs and optional bundle expansion fields:

```ts
async getProductCatalog(keyword?: string) {
  return this.prisma.product.findMany({
    where: { companyId: PLATFORM_COMPANY_ID, status: ProductStatus.ACTIVE, title: keyword ? { contains: keyword, mode: 'insensitive' } : undefined },
    take: 100,
    orderBy: { createdAt: 'desc' },
    include: {
      skus: { where: { status: SkuStatus.ACTIVE }, orderBy: { createdAt: 'asc' } },
      media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
      bundleItems: { orderBy: { sortOrder: 'asc' }, include: { sku: { include: { product: { include: { media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 } } } } } } },
    },
  });
}
```

Controller route:

```ts
@Get('product-catalog')
findProductCatalog(@Query('keyword') keyword?: string) {
  return this.service.getProductCatalog(keyword);
}
```

- [ ] **Step 5: Extend reward product reference protection**

In `reward-product.service.ts`, include `groupBuyActivityItem.findMany` when checking references. Add blockers with `团购活动`.

- [ ] **Step 6: Run backend tests**

Run:

```bash
cd backend
npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts src/modules/admin/reward-product/reward-product.service.spec.ts --runInBand
```

Expected: all tests pass.

---

## Task 3: Buyer API and Checkout Multi-Item Snapshots

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy.service.ts`
- Modify: `backend/src/modules/group-buy/group-buy-checkout.service.ts`
- Modify: `backend/src/modules/group-buy/group-buy.service.spec.ts`
- Modify: `backend/src/modules/group-buy/group-buy-checkout.service.spec.ts`

**Interfaces:**
- Produces buyer payload fields: `items`, `availableStock`, `totalWeightGram`, `itemSummary`
- Produces checkout helper `buildSnapshotItems(activity): SnapshotItem[]`

- [ ] **Step 1: Add failing buyer API test**

In `group-buy.service.spec.ts`, mock `items` with two rows and assert:

```ts
expect(result.items[0]).toEqual(expect.objectContaining({
  availableStock: 4,
  totalWeightGram: 3500,
  itemSummary: '大龙虾×1、蜜瓜礼盒×2',
  items: [
    expect.objectContaining({ productId: 'product_1', skuId: 'sku_1', quantity: 1 }),
    expect.objectContaining({ productId: 'product_2', skuId: 'sku_2', quantity: 2 }),
  ],
}));
```

- [ ] **Step 2: Add failing checkout test**

In `group-buy-checkout.service.spec.ts`, add a two-item activity and assert created session:

```ts
expect(tx.checkoutSession.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    goodsAmount: 1000,
    itemsSnapshot: [
      expect.objectContaining({ skuId: 'sku_1', quantity: 1, unitPrice: 625 }),
      expect.objectContaining({ skuId: 'sku_2', quantity: 2, unitPrice: 187.5 }),
    ],
  }),
}));
```

Use reference amounts `sku_1.price * 1 = 1000`, `sku_2.price * 2 = 600`, so `1000` group-buy price allocates `625` and `375` total.

- [ ] **Step 3: Include and map activity items**

In `GroupBuyService.activityInclude`, include:

```ts
items: {
  orderBy: { sortOrder: 'asc' as const },
  include: {
    product: { select: { id: true, title: true, media: { select: { id: true, url: true, sortOrder: true }, orderBy: { sortOrder: 'asc' as const }, take: 1 } } },
    sku: { select: { id: true, title: true, stock: true, weightGram: true, price: true } },
  },
}
```

Add helpers that fallback to legacy single product/SKU when `items` is empty.

- [ ] **Step 4: Implement checkout snapshot allocation**

In `GroupBuyCheckoutService`, include activity `items`. Build normalized items. Implement cents allocation:

```ts
private allocateGroupBuyPrice(items: Array<{ referenceAmount: number }>, totalPrice: number) {
  const totalCents = Math.round(totalPrice * 100);
  const referenceTotal = items.reduce((sum, item) => sum + Math.max(0, item.referenceAmount), 0);
  if (referenceTotal <= 0) {
    const base = Math.floor(totalCents / items.length);
    return items.map((_, index) => index === items.length - 1 ? totalCents - base * (items.length - 1) : base);
  }
  let allocated = 0;
  return items.map((item, index) => {
    if (index === items.length - 1) return totalCents - allocated;
    const cents = Math.floor(totalCents * Math.max(0, item.referenceAmount) / referenceTotal);
    allocated += cents;
    return cents;
  });
}
```

Convert each allocated total to unit price:

```ts
unitPrice = Number((allocatedCents / 100 / item.quantity).toFixed(2))
```

- [ ] **Step 5: Update stock and shipping**

Stock check:

```ts
const availableStock = Math.min(...items.map((item) => Math.floor(item.sku.stock / item.quantity)));
if (availableStock <= 0) throw new BadRequestException('团购活动商品库存不足');
```

Shipping weight:

```ts
const totalWeight = items.reduce((sum, item) => sum + item.sku.weightGram * item.quantity, 0);
```

- [ ] **Step 6: Run group-buy tests**

Run:

```bash
cd backend
npx jest src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts --runInBand
```

Expected: all tests pass.

---

## Task 4: Admin Frontend Multi-Item Editor

**Files:**
- Modify: `admin/src/api/group-buy.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/group-buy/activities.tsx`
- Modify: `admin/test/groupBuyActivityForm.test.ts`

**Interfaces:**
- Consumes: `getGroupBuyProductCatalog(keyword?: string)`
- Produces form field `items: GroupBuyActivityItemInput[]`

- [ ] **Step 1: Add static failing test**

Update `admin/test/groupBuyActivityForm.test.ts` to assert:

```ts
assert.equal(source.includes('团购商品组合'), true);
assert.equal(source.includes('GroupBuyItemsEditor'), true);
assert.equal(source.includes('name=\"productId\" label=\"平台商品\"'), false);
```

- [ ] **Step 2: Add admin types and API**

Add types:

```ts
export interface AdminGroupBuyActivityItem {
  id?: string;
  productId: string;
  skuId: string;
  quantity: number;
  sortOrder: number;
  product?: AdminGroupBuyProductSnapshot | null;
  sku?: AdminGroupBuySkuSnapshot | null;
}

export interface GroupBuyCatalogProduct {
  id: string;
  title: string;
  type?: 'SIMPLE' | 'BUNDLE';
  status: string;
  media?: ProductMedia[];
  skus: AdminGroupBuySkuSnapshot[];
  bundleItems?: Array<{
    productId: string;
    skuId: string;
    quantity: number;
    product?: AdminGroupBuyProductSnapshot;
    sku?: AdminGroupBuySkuSnapshot;
  }>;
}
```

API:

```ts
export const getGroupBuyProductCatalog = (keyword?: string): Promise<GroupBuyCatalogProduct[]> =>
  client.get('/admin/group-buy/product-catalog', { params: keyword ? { keyword } : undefined });
```

- [ ] **Step 3: Add editor component**

Inside `activities.tsx`, implement `GroupBuyItemsEditor` using Ant Design `Select`, `Table`, `InputNumber`, `Image`, and summary text. Required behavior:

- `addSku` appends `{ productId, skuId, quantity: 1, sortOrder }`
- duplicates merge quantities
- `expandBundleSource` appends source `bundleItems`
- row quantity updates clamp to integer >= 1
- delete removes row
- summary shows reference total, available stock, and total weight

- [ ] **Step 4: Replace product/SKU form controls**

Remove single `productId` and `skuId` Form.Item UI. Store `items` in form and in component state. `openCreate` initializes `items` to `[]`; `openEdit` maps `record.items` or legacy product/sku into rows.

`buildPayload` sends:

```ts
items: normalizeActivityItems(values.items ?? []),
productId: normalizedItems[0]?.productId,
skuId: normalizedItems[0]?.skuId,
```

- [ ] **Step 5: Run admin checks**

Run:

```bash
node --test admin/test/groupBuyActivityForm.test.ts
cd admin && npm run build
```

Expected: static test and admin build pass.

---

## Task 5: Buyer App Types and Display

**Files:**
- Modify: `src/types/domain/GroupBuy.ts`
- Modify: `src/repos/GroupBuyRepo.ts`
- Modify: `src/components/group-buy/GroupBuyProductCard.tsx`
- Modify: `app/group-buy/[activityId].tsx`
- Modify: `app/gb/[code].tsx`
- Modify: `app/group-buy/checkout.tsx`

**Interfaces:**
- Consumes `GroupBuyActivity.items`, `availableStock`, `itemSummary`
- Produces display-only item summary rows

- [ ] **Step 1: Add types and mocks**

Add:

```ts
export interface GroupBuyActivityItem {
  productId: string;
  skuId: string;
  productTitle: string;
  skuTitle: string;
  imageUrl: string | null;
  quantity: number;
  stock: number;
  weightGram: number | null;
}
```

Extend `GroupBuyActivity` with `items`, `availableStock`, `totalWeightGram`, `itemSummary`. Update mocks with two-item examples.

- [ ] **Step 2: Product card**

Use:

```ts
const stockLabel = activity.availableStock > 0 ? `可组合 ${activity.availableStock}` : '暂时无货';
```

Show `activity.itemSummary || product/sku fallback`.

- [ ] **Step 3: Detail and landing pages**

Add an unframed/card-like 8px panel titled `包含商品`, rendering each item:

```tsx
{activity.items.map((item) => (
  <View key={item.skuId}>
    <Text>{item.productTitle}</Text>
    <Text>{item.skuTitle} x{item.quantity}</Text>
  </View>
))}
```

- [ ] **Step 4: Checkout page**

Show `activity.itemSummary` in the order summary and use `availableStock` for disabled state/fallback checks.

- [ ] **Step 5: Run App TypeScript**

Run:

```bash
npx tsc -b --noEmit --pretty false
```

Expected: pass.

---

## Task 6: Docs, Full Verification, and Commit

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

**Interfaces:**
- Produces release-ready change set with tests recorded.

- [ ] **Step 1: Update docs**

Add concise entries that multi-item group-buy activities now support platform SKU combinations, App item summaries, and checkout multi-item snapshots.

- [ ] **Step 2: Run full verification**

Run:

```bash
cd backend
DATABASE_URL='postgresql://user:password@localhost:5432/aimm_test?schema=public' npx prisma validate
DATABASE_URL='postgresql://user:password@localhost:5432/aimm_test?schema=public' npx prisma generate
npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/admin/reward-product/reward-product.service.spec.ts --runInBand
npm run build
cd ..
node --test admin/test/groupBuyActivityForm.test.ts
npx tsc -b --noEmit --pretty false
cd admin && npm run build
```

Expected: every command exits 0. Admin build may emit existing chunk-size warnings only.

- [ ] **Step 3: Search forbidden copy**

Run:

```bash
rg -n "分享回馈活动|分享回馈|仅一级直接推荐|仅统计本人直接推荐|仅直接推荐" app src/components/group-buy src/repos/GroupBuyRepo.ts admin/src/pages/group-buy -S
```

Expected: no matches.

- [ ] **Step 4: Commit**

Run:

```bash
git status --short
git add backend/prisma/schema.prisma backend/prisma/migrations/20260623020000_group_buy_activity_items/migration.sql backend/src/modules/admin/group-buy backend/src/modules/group-buy backend/src/modules/admin/reward-product admin/src/api/group-buy.ts admin/src/types/index.ts admin/src/pages/group-buy/activities.tsx admin/test/groupBuyActivityForm.test.ts src/types/domain/GroupBuy.ts src/repos/GroupBuyRepo.ts src/components/group-buy/GroupBuyProductCard.tsx app/group-buy app/gb docs/architecture/frontend.md docs/architecture/admin-frontend.md plan.md
git commit -m "feat: support multi-item group buy activities"
```

Expected: one commit containing only multi-item group-buy implementation.

---

## Self-Review

- Spec coverage: data model, admin configuration, buyer display, checkout stock/weight/price allocation, reference protection, tests, and docs are covered by Tasks 1-6.
- Placeholder scan: no unfinished placeholder markers are present.
- Type consistency: `items`, `availableStock`, `totalWeightGram`, and `itemSummary` are introduced in backend buyer mapping and consumed by App/admin types.
