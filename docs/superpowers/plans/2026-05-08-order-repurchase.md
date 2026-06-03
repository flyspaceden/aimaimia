# Order Repurchase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the buyer App “再次购买” flow for completed normal orders by adding a backend repurchase endpoint that safely returns eligible items to the cart and wiring the existing App buttons to it.

**Architecture:** Add `POST /api/v1/orders/:id/repurchase` in the order module. The backend owns eligibility, idempotency, Serializable cart writes, per-item result reporting, and returns a fresh `ServerCart`; the App hydrates the cart store from that response and navigates to `/cart`.

**Tech Stack:** NestJS 11, Prisma 6, RedisCoordinatorService, @nestjs/throttler, Jest, React Native 0.81, Expo Router 6, Zustand, TypeScript.

---

## File Structure

Backend:
- Create `backend/src/modules/order/repurchase.types.ts`: response contracts and skip reason union for the repurchase endpoint.
- Create `backend/src/modules/order/order-repurchase.spec.ts`: Jest unit tests for ownership/status/type checks, item skip reasons, price change reporting, idempotency, selected-state behavior, and Serializable retry.
- Modify `backend/src/modules/order/order.service.ts`: inject Redis and CartService, add `repurchase()`, helper functions, structured logging, `mapOrder()` `skuId` and `repurchasable`.
- Modify `backend/src/modules/order/order.controller.ts`: add throttled `POST :id/repurchase` endpoint before deprecated dynamic post routes.
- Modify `backend/src/modules/order/order.module.ts`: import `CartModule` so `OrderService` can use `CartService.getCart()`.
- Modify `backend/src/modules/cart/cart.module.ts`: export `CartService`.
- Modify `backend/src/modules/order/map-order.spec.ts`: assert `skuId` and lightweight `repurchasable`; update direct `OrderService` construction after constructor injection changes.
- Modify `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`: update direct `OrderService` construction after constructor injection changes.
- Modify `backend/src/modules/order/order.service.cancel.spec.ts`: update direct `OrderService` construction after constructor injection changes.

App:
- Modify `src/types/domain/Order.ts`: add `repurchasable`, `RepurchaseResult`, and skip reason types.
- Modify `src/store/useCartStore.ts`: add `replaceFromServer(cart: ServerCart, forceSelectedSkuIds?: string[])`, reuse existing server-cart mapping, preserve local deselection for unrelated existing items, and force-select repurchased SKUs.
- Modify `src/repos/OrderRepo.ts`: add `repurchase(orderId)` with real API and mock support.
- Create `src/utils/repurchaseToast.ts`: centralize repurchase success/partial-success toast formatting.
- Modify `src/utils/index.ts`: export the repurchase toast helper.
- Modify `src/components/cards/OrderCard.tsx`: add disabled support for primary/secondary action buttons.
- Modify `app/orders/[id].tsx`: wire detail-page “再次购买” with loading, result toast, cart hydration, and navigation.
- Modify `app/orders/index.tsx`: wire list-card “再次购买” with loading-per-order and same result handling.

Docs:
- Modify `docs/architecture/frontend.md`: update order page CTA status.
- Modify `plan.md`: record this order-link task.
- Modify `AGENTS.md`: register this implementation plan if the file is tracked in the current branch; if it remains untracked in this workspace, keep the local entry but do not include unrelated `AGENTS.md` in the implementation commit.

---

### Task 1: Backend Contracts And Order DTO Mapping

**Files:**
- Create: `backend/src/modules/order/repurchase.types.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/map-order.spec.ts`

- [ ] **Step 1: Write failing mapOrder tests**

Edit `backend/src/modules/order/map-order.spec.ts` and append:

```ts
it('mapOrder exposes skuId and lightweight repurchasable for completed normal orders', () => {
  const order = {
    id: 'o-received',
    status: 'RECEIVED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 100,
    createdAt: new Date(),
    items: [{
      id: 'i-normal',
      skuId: 'sku-normal',
      unitPrice: 50,
      quantity: 2,
      companyId: 'c1',
      isPrize: false,
      productSnapshot: { productId: 'p1', title: '苹果', skuTitle: '5斤装', image: 'http://img/apple.jpg' },
    }],
    afterSaleRequests: [],
    refunds: [],
    shipments: [],
  };

  const out = (service as any).mapOrder(order);

  expect(out.repurchasable).toBe(true);
  expect(out.items[0]).toMatchObject({
    skuId: 'sku-normal',
    productId: 'p1',
    isPrize: false,
  });
});

it('mapOrder marks all-prize completed orders as not repurchasable', () => {
  const order = {
    id: 'o-prize-only',
    status: 'RECEIVED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 0,
    createdAt: new Date(),
    items: [{
      id: 'i-prize',
      skuId: 'sku-prize',
      unitPrice: 0,
      quantity: 1,
      companyId: 'platform',
      isPrize: true,
      productSnapshot: { productId: 'p-prize', title: '奖品', skuTitle: '默认', image: '' },
    }],
    afterSaleRequests: [],
    refunds: [],
    shipments: [],
  };

  const out = (service as any).mapOrder(order);

  expect(out.repurchasable).toBe(false);
});
```

- [ ] **Step 2: Run mapOrder tests and verify failure**

Run:

```bash
cd backend
npx jest src/modules/order/map-order.spec.ts --runInBand
```

Expected: FAIL because `repurchasable` is undefined or `skuId` is missing from mapped order items.

- [ ] **Step 3: Add repurchase response contracts**

Create `backend/src/modules/order/repurchase.types.ts`:

```ts
export type RepurchaseSkipReason =
  | 'PRIZE_ITEM'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'COMPANY_INACTIVE'
  | 'PLATFORM_PRODUCT'
  | 'MAX_PER_ORDER_EXCEEDED';

export type RepurchaseResultItem = {
  orderItemId: string;
  skuId: string;
  title: string;
  quantity: number;
  status: 'ADDED' | 'SKIPPED';
  reason?: RepurchaseSkipReason;
  priceChanged?: boolean;
  originalPrice?: number;
  currentPrice?: number;
  message?: string;
};

export type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
  cart: unknown;
  items: RepurchaseResultItem[];
};
```

- [ ] **Step 4: Implement `skuId` and `repurchasable` mapping**

In `backend/src/modules/order/order.service.ts`, update the `snapshot` object inside `private mapOrder(...)`:

```ts
return {
  id: item.id,
  productId: ps.productId || item.skuId,
  skuId: item.skuId,
  title: ps.title || '',
  skuTitle: ps.skuTitle || '',
  image: ps.image || '',
  price: item.unitPrice,
  quantity: item.quantity,
  companyId: item.companyId,
  companyName: company?.name,
  companyLogo: company?.logoUrl ?? null,
  isPrize: !!item.isPrize,
};
```

Then add `repurchasable` in the object returned by `mapOrder(...)`:

```ts
repurchasable:
  order.status === 'RECEIVED' &&
  (order.bizType || 'NORMAL_GOODS') === 'NORMAL_GOODS' &&
  (order.items || []).some((item: any) => !item.isPrize),
```

- [ ] **Step 5: Run mapOrder tests and verify pass**

Run:

```bash
cd backend
npx jest src/modules/order/map-order.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add backend/src/modules/order/repurchase.types.ts backend/src/modules/order/order.service.ts backend/src/modules/order/map-order.spec.ts
git commit -m "feat(orders): expose repurchase eligibility"
```

---

### Task 2: Backend Repurchase Service Tests

**Files:**
- Create: `backend/src/modules/order/order-repurchase.spec.ts`
- Modify later in Task 3: `backend/src/modules/order/order.service.ts`

- [ ] **Step 1: Create failing repurchase service tests**

Create `backend/src/modules/order/order-repurchase.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';

const activeCompany = { id: 'c1', status: 'ACTIVE', isPlatform: false, name: '青禾农场' };
const inactiveCompany = { id: 'c2', status: 'SUSPENDED', isPlatform: false, name: '停业农场' };
const platformCompany = { id: 'platform', status: 'ACTIVE', isPlatform: true, name: '爱买买app' };

function makeSku(overrides: any = {}) {
  const company = overrides.company ?? activeCompany;
  return {
    id: overrides.id ?? 'sku-1',
    title: overrides.title ?? '5斤装',
    price: overrides.price ?? 30,
    stock: overrides.stock ?? 100,
    status: overrides.status ?? 'ACTIVE',
    maxPerOrder: overrides.maxPerOrder ?? null,
    product: {
      id: overrides.productId ?? 'p1',
      title: overrides.productTitle ?? '苹果',
      status: overrides.productStatus ?? 'ACTIVE',
      companyId: company.id,
      company,
      media: [{ url: 'http://img/apple.jpg' }],
    },
  };
}

function makeOrder(overrides: any = {}) {
  return {
    id: overrides.id ?? 'order-1',
    userId: overrides.userId ?? 'user-1',
    status: overrides.status ?? 'RECEIVED',
    bizType: overrides.bizType ?? 'NORMAL_GOODS',
    items: overrides.items ?? [{
      id: 'oi-1',
      skuId: 'sku-1',
      unitPrice: 25,
      quantity: 2,
      isPrize: false,
      productSnapshot: { title: '苹果' },
    }],
  };
}

function createHarness(options: {
  order?: any;
  skus?: any[];
  cartItems?: any[];
  redisCached?: string | null;
  acquireLock?: boolean | null;
  txErrorOnce?: boolean;
} = {}) {
  const order = options.order ?? makeOrder();
  const skus = options.skus ?? [makeSku()];
  const cartItems = options.cartItems ?? [];
  let txCalls = 0;

  const tx = {
    cart: {
      findUnique: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
      create: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
    },
    cartItem: {
      findMany: jest.fn(async () => cartItems),
      update: jest.fn(async (args) => ({ id: args.where.id, ...args.data })),
      create: jest.fn(async (args) => ({ id: 'new-cart-item', ...args.data })),
    },
  };

  const prisma: any = {
    order: {
      findUnique: jest.fn(async () => order),
    },
    productSKU: {
      findMany: jest.fn(async () => skus),
    },
    cart: {
      findUnique: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
    },
    cartItem: {
      findMany: jest.fn(async () => cartItems),
    },
    $transaction: jest.fn(async (callback: any) => {
      txCalls += 1;
      if (options.txErrorOnce && txCalls === 1) {
        const err: any = new Prisma.PrismaClientKnownRequestError('serialization failure', {
          code: 'P2034',
          clientVersion: 'test',
        });
        throw err;
      }
      return callback(tx);
    }),
  };

  const redis: any = {
    get: jest.fn(async (key: string) => key.includes(':result:') ? (options.redisCached ?? null) : null),
    acquireLock: jest.fn(async () => options.acquireLock ?? true),
    set: jest.fn(async () => true),
    releaseLock: jest.fn(async () => true),
  };

  const cartService: any = {
    getCart: jest.fn(async () => ({
      id: 'cart-1',
      items: [{
        id: 'ci-1',
        skuId: 'sku-1',
        quantity: 2,
        isSelected: true,
        product: {
          id: 'p1',
          title: '苹果',
          image: 'http://img/apple.jpg',
          price: 30,
          originalPrice: null,
          stock: 100,
          maxPerOrder: null,
        },
      }],
    })),
  };

  const service = new OrderService(prisma, {} as any, {} as any, redis, cartService);
  return { service, prisma, redis, cartService, tx };
}

describe('OrderService.repurchase', () => {
  it('throws 404 when order does not belong to user', async () => {
    const { service } = createHarness({ order: makeOrder({ userId: 'other-user' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects non-RECEIVED orders', async () => {
    const { service } = createHarness({ order: makeOrder({ status: 'PAID' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-NORMAL_GOODS orders by whitelist', async () => {
    const { service } = createHarness({ order: makeOrder({ bizType: 'VIP_PACKAGE' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds valid normal items and returns price change metadata', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 25, quantity: 2, isPrize: false, productSnapshot: { title: '苹果' } }] }),
      skus: [makeSku({ price: 30 })],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(1);
    expect(result.addedQuantity).toBe(2);
    expect(result.priceChangedCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      status: 'ADDED',
      priceChanged: true,
      originalPrice: 25,
      currentPrice: 30,
    });
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 2, isSelected: true }),
    }));
  });

  it('skips prize, inactive company, platform product, inactive product, inactive sku, missing sku, and maxPerOrder overflow', async () => {
    const order = makeOrder({
      items: [
        { id: 'oi-prize', skuId: 'sku-prize', unitPrice: 0, quantity: 1, isPrize: true, productSnapshot: { title: '奖品' } },
        { id: 'oi-company', skuId: 'sku-company', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '停业商品' } },
        { id: 'oi-platform', skuId: 'sku-platform', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '平台商品' } },
        { id: 'oi-product', skuId: 'sku-product', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '商品下架' } },
        { id: 'oi-sku', skuId: 'sku-sku', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '规格下架' } },
        { id: 'oi-missing', skuId: 'sku-missing', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '缺失规格' } },
        { id: 'oi-limit', skuId: 'sku-limit', unitPrice: 10, quantity: 2, isPrize: false, productSnapshot: { title: '限购商品' } },
      ],
    });
    const { service } = createHarness({
      order,
      skus: [
        makeSku({ id: 'sku-company', company: inactiveCompany }),
        makeSku({ id: 'sku-platform', company: platformCompany }),
        makeSku({ id: 'sku-product', productStatus: 'INACTIVE' }),
        makeSku({ id: 'sku-sku', status: 'INACTIVE' }),
        makeSku({ id: 'sku-limit', maxPerOrder: 3 }),
      ],
      cartItems: [{ id: 'ci-limit', skuId: 'sku-limit', quantity: 2, isPrize: false }],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(0);
    expect(result.skippedItemCount).toBe(7);
    expect(result.items.map((item: any) => item.reason)).toEqual([
      'PRIZE_ITEM',
      'COMPANY_INACTIVE',
      'PLATFORM_PRODUCT',
      'PRODUCT_INACTIVE',
      'SKU_INACTIVE',
      'SKU_MISSING',
      'MAX_PER_ORDER_EXCEEDED',
    ]);
  });

  it('updates existing cart item quantity and forces isSelected=true', async () => {
    const { service, tx } = createHarness({
      cartItems: [{ id: 'ci-1', skuId: 'sku-1', quantity: 1, isPrize: false, isSelected: false }],
    });

    await service.repurchase('order-1', 'user-1');

    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { quantity: 3, isSelected: true },
    });
  });

  it('aggregates repeated order items with the same SKU into one cart write', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({
        items: [
          { id: 'oi-1', skuId: 'sku-1', unitPrice: 25, quantity: 2, isPrize: false, productSnapshot: { title: '苹果' } },
          { id: 'oi-2', skuId: 'sku-1', unitPrice: 25, quantity: 3, isPrize: false, productSnapshot: { title: '苹果' } },
        ],
      }),
      skus: [makeSku({ id: 'sku-1', price: 25 })],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(2);
    expect(result.addedQuantity).toBe(5);
    expect(tx.cartItem.create).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 5, isSelected: true }),
    }));
  });

  it('returns cached result for duplicate requests but refreshes cart from CartService', async () => {
    const cached = JSON.stringify({
      addedItemCount: 1,
      addedQuantity: 2,
      skippedItemCount: 0,
      skippedQuantity: 0,
      priceChangedCount: 0,
      cart: { id: 'cart-1', items: [{ id: 'stale-item' }] },
      items: [],
    });
    const { service, prisma, cartService } = createHarness({ redisCached: cached });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    // cart 必须来自 cartService.getCart，不是缓存里的 stale 快照
    expect(cartService.getCart).toHaveBeenCalledWith('user-1');
    expect(result.cart).toMatchObject({ id: 'cart-1' });
    expect((result.cart as any).items[0].id).not.toBe('stale-item');
  });

  it('returns 409 when Redis is unavailable (acquireLock returns null)', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { service, prisma } = createHarness({ acquireLock: null });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('does not cache validation failures and releases the processing lock', async () => {
    const { service, redis } = createHarness({ order: makeOrder({ status: 'PAID' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith(
      'order:repurchase:lock:user-1:order-1',
      'repurchase:user-1:order-1',
    );
  });

  it('retries once after Prisma P2034 serialization conflict', async () => {
    const { service, prisma } = createHarness({ txErrorOnce: true });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run repurchase tests and verify failure**

Run:

```bash
cd backend
npx jest src/modules/order/order-repurchase.spec.ts --runInBand
```

Expected: FAIL because `OrderService.repurchase` does not exist and the constructor does not accept Redis/CartService yet.

- [ ] **Step 3: Commit failing tests**

Run:

```bash
git add backend/src/modules/order/order-repurchase.spec.ts
git commit -m "test(orders): cover repurchase flow"
```

---

### Task 3: Backend Repurchase Implementation

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order.controller.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/cart/cart.module.ts`
- Modify: `backend/src/modules/order/map-order.spec.ts`
- Modify: `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`
- Modify: `backend/src/modules/order/order.service.cancel.spec.ts`

- [ ] **Step 0: Pre-check Cart schema invariants**

Confirm `backend/prisma/schema.prisma` already has `Cart.userId @unique`; otherwise `tx.cart.findUnique({ where: { userId } })` and `tx.cart.create({ data: { userId } })` will fail at runtime. Run:

```bash
rg -n "model Cart\\b" -A 20 backend/prisma/schema.prisma
```

Expected: the `userId` field is annotated with `@unique` (or the model has a unique index on `userId`). If not, stop and surface to the user before proceeding — this plan does not migrate the schema.

- [ ] **Step 1: Export CartService and import CartModule into OrderModule**

Change `backend/src/modules/cart/cart.module.ts`:

```ts
@Module({
  imports: [BonusModule],
  controllers: [CartController],
  providers: [CartService, PrizeExpireService],
  exports: [CartService],
})
export class CartModule {}
```

Change `backend/src/modules/order/order.module.ts`:

```ts
import { CartModule } from '../cart/cart.module';
```

Update the `imports` array:

```ts
imports: [
  BonusModule,
  ShippingRuleModule,
  AfterSaleModule,
  CouponModule,
  InboxModule,
  CartModule,
  forwardRef(() => PaymentModule),
],
```

- [ ] **Step 2: Inject RedisCoordinatorService and CartService**

In `backend/src/modules/order/order.service.ts`, add imports:

```ts
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { CartService } from '../cart/cart.service';
import { RepurchaseResult, RepurchaseResultItem, RepurchaseSkipReason } from './repurchase.types';
```

Change constructor:

```ts
constructor(
  private prisma: PrismaService,
  private bonusAllocation: BonusAllocationService,
  private bonusConfig: BonusConfigService,
  private redisCoord: RedisCoordinatorService,
  private cartService: CartService,
) {}
```

Update every existing direct `new OrderService(...)` test. Grep must return only 5-argument construction afterward:

```ts
// backend/src/modules/order/map-order.spec.ts
service = new OrderService({} as any, {} as any, {} as any, {} as any, {} as any);
```

```ts
// backend/src/modules/order/order-preview-prize-exclusion.spec.ts
service: new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any),
```

```ts
// backend/src/modules/order/order.service.cancel.spec.ts
const service = new OrderService(prisma as any, bonusAllocation as any, {} as any, {} as any, {} as any);
```

Verify the direct-construction sites:

```bash
rg -n "new OrderService\\(" backend/src/modules/order -S
```

Expected: the three direct construction sites all pass five constructor arguments.

- [ ] **Step 3: Add repurchase helper methods**

Add these private helpers inside `OrderService`:

```ts
private repurchaseTitle(item: any): string {
  const ps = (item.productSnapshot as any) || {};
  return ps.title || item.sku?.product?.title || item.skuId;
}

private repurchaseSkipped(
  item: any,
  reason: RepurchaseSkipReason,
  message: string,
): RepurchaseResultItem {
  return {
    orderItemId: item.id,
    skuId: item.skuId,
    title: this.repurchaseTitle(item),
    quantity: item.quantity,
    status: 'SKIPPED',
    reason,
    message,
  };
}

private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

private buildRepurchaseSummary(items: RepurchaseResultItem[], cart: unknown): RepurchaseResult {
  const added = items.filter((item) => item.status === 'ADDED');
  const skipped = items.filter((item) => item.status === 'SKIPPED');
  return {
    addedItemCount: added.length,
    addedQuantity: added.reduce((sum, item) => sum + item.quantity, 0),
    skippedItemCount: skipped.length,
    skippedQuantity: skipped.reduce((sum, item) => sum + item.quantity, 0),
    priceChangedCount: added.filter((item) => item.priceChanged).length,
    cart,
    items,
  };
}
```

- [ ] **Step 4: Implement `repurchase()`**

Add this public method to `OrderService`:

```ts
async repurchase(orderId: string, userId: string): Promise<RepurchaseResult> {
  const resultKey = `order:repurchase:result:${userId}:${orderId}`;
  const lockKey = `order:repurchase:lock:${userId}:${orderId}`;
  const lockOwner = `repurchase:${userId}:${orderId}`;

  // 命中幂等缓存时仅复用 items[] 结果，cart 字段重查最新，避免 60s 窗口内购物车被
  // 其它操作（手动删项、加购等）改动导致 replaceFromServer 把过期 cart 写回去。
  const cached = await this.redisCoord.get(resultKey);
  if (cached) {
    const cachedResult = JSON.parse(cached) as RepurchaseResult;
    const freshCart = await this.cartService.getCart(userId);
    return { ...cachedResult, cart: freshCart };
  }

  // acquireLock 返回 null 表示 Redis 不可用：fail-closed，直接 409，避免无幂等保护下重复加购。
  const acquired = await this.redisCoord.acquireLock(lockKey, lockOwner, 60_000);
  if (acquired !== true) {
    // acquired === false：有别的请求正在处理；轮询 5s 内能等到结果就复用，否则 409。
    if (acquired === false) {
      for (let wait = 0; wait < 10; wait++) {
        await this.sleep(500);
        const retryCache = await this.redisCoord.get(resultKey);
        if (retryCache) {
          const cachedResult = JSON.parse(retryCache) as RepurchaseResult;
          const freshCart = await this.cartService.getCart(userId);
          return { ...cachedResult, cart: freshCart };
        }
      }
    }
    throw new ConflictException('再次购买处理中，请稍后重试');
  }

  try {
    const cachedAfterLock = await this.redisCoord.get(resultKey);
    if (cachedAfterLock) {
      const cachedResult = JSON.parse(cachedAfterLock) as RepurchaseResult;
      const freshCart = await this.cartService.getCart(userId);
      return { ...cachedResult, cart: freshCart };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单未找到');
    }
    if (order.status !== 'RECEIVED') {
      throw new BadRequestException('仅已完成订单支持再次购买');
    }
    if ((order.bizType || 'NORMAL_GOODS') !== 'NORMAL_GOODS') {
      throw new BadRequestException('当前订单类型不支持再次购买');
    }

    const skuIds = [...new Set((order.items || []).map((item: any) => item.skuId).filter(Boolean))];
    const skus = skuIds.length > 0
      ? await this.prisma.productSKU.findMany({
          where: { id: { in: skuIds } },
          include: {
            product: {
              include: {
                company: true,
                media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
              },
            },
          },
        })
      : [];
    const skuMap = new Map(skus.map((sku: any) => [sku.id, sku]));

    const MAX_RETRIES = 3;
    let resultItems: RepurchaseResultItem[] = [];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        resultItems = await this.prisma.$transaction(async (tx) => {
          let cart = await tx.cart.findUnique({ where: { userId } });
          if (!cart) {
            cart = await tx.cart.create({ data: { userId } });
          }

          const existingItems = await tx.cartItem.findMany({
            where: { cartId: cart.id, isPrize: false, skuId: { in: skuIds } },
          });
          const existingBySkuId = new Map(existingItems.map((item: any) => [item.skuId, item]));
          const output: RepurchaseResultItem[] = [];
          const purchasableBySkuId = new Map<string, { sku: any; items: any[]; totalQuantity: number }>();

          for (const item of order.items as any[]) {
            if (item.isPrize) {
              output.push(this.repurchaseSkipped(item, 'PRIZE_ITEM', '奖品不支持再次购买'));
              continue;
            }

            const sku = skuMap.get(item.skuId) as any;
            if (!sku) {
              output.push(this.repurchaseSkipped(item, 'SKU_MISSING', '商品规格不存在'));
              continue;
            }
            if (sku.status !== 'ACTIVE') {
              output.push(this.repurchaseSkipped(item, 'SKU_INACTIVE', '商品规格已下架'));
              continue;
            }
            if (sku.product?.status !== 'ACTIVE') {
              output.push(this.repurchaseSkipped(item, 'PRODUCT_INACTIVE', '商品已下架'));
              continue;
            }
            if (sku.product?.company?.status !== 'ACTIVE') {
              output.push(this.repurchaseSkipped(item, 'COMPANY_INACTIVE', '商家当前不可售'));
              continue;
            }
            if (sku.product?.company?.isPlatform) {
              output.push(this.repurchaseSkipped(item, 'PLATFORM_PRODUCT', '平台奖品商品不支持再次购买'));
              continue;
            }

            const group = purchasableBySkuId.get(item.skuId);
            if (group) {
              group.items.push(item);
              group.totalQuantity += item.quantity;
            } else {
              purchasableBySkuId.set(item.skuId, { sku, items: [item], totalQuantity: item.quantity });
            }
          }

          for (const [skuId, group] of purchasableBySkuId.entries()) {
            const existing = existingBySkuId.get(skuId) as any;
            const nextQuantity = (existing?.quantity ?? 0) + group.totalQuantity;
            if (group.sku.maxPerOrder != null && nextQuantity > group.sku.maxPerOrder) {
              for (const item of group.items) {
                output.push(this.repurchaseSkipped(
                  item,
                  'MAX_PER_ORDER_EXCEEDED',
                  existing
                    ? `该商品每单限购 ${group.sku.maxPerOrder} 件，购物车已有 ${existing.quantity} 件`
                    : `该商品每单限购 ${group.sku.maxPerOrder} 件`,
                ));
              }
              continue;
            }

            if (existing) {
              await tx.cartItem.update({
                where: { id: existing.id },
                data: { quantity: nextQuantity, isSelected: true },
              });
            } else {
              await tx.cartItem.create({
                data: { cartId: cart.id, skuId, quantity: group.totalQuantity, isSelected: true },
              });
            }

            for (const item of group.items) {
              const originalPrice = item.unitPrice;
              const currentPrice = group.sku.price;
              const priceChanged = Math.abs(originalPrice - currentPrice) > 0.01;
              output.push({
                orderItemId: item.id,
                skuId,
                title: this.repurchaseTitle(item),
                quantity: item.quantity,
                status: 'ADDED',
                priceChanged,
                originalPrice,
                currentPrice,
                message: priceChanged ? '商品价格已变动，请到购物车确认' : undefined,
              });
            }
          }

          return output;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(`repurchase 序列化冲突，第 ${attempt + 1}/${MAX_RETRIES} 次重试`);
          continue;
        }
        throw err;
      }
    }

    const cart = await this.cartService.getCart(userId);
    const result = this.buildRepurchaseSummary(resultItems, cart);
    await this.redisCoord.set(resultKey, JSON.stringify(result), 60_000);
    this.logger.log(JSON.stringify({
      action: 'order_repurchase',
      userId,
      orderId,
      addedQuantity: result.addedQuantity,
      skippedQuantity: result.skippedQuantity,
      priceChangedCount: result.priceChangedCount,
    }));
    return result;
  } finally {
    await this.redisCoord.releaseLock(lockKey, lockOwner);
  }
}
```

- [ ] **Step 5: Add throttled controller endpoint**

In `backend/src/modules/order/order.controller.ts`, import `Throttle`:

```ts
import { Throttle } from '@nestjs/throttler';
```

Add this method before `@Get(':id')`:

```ts
@Post(':id/repurchase')
@Throttle({ user: { ttl: 60000, limit: 10 } })
repurchase(
  @CurrentUser('sub') userId: string,
  @Param('id') id: string,
) {
  return this.orderService.repurchase(id, userId);
}
```

Verify the `user` throttle bucket is backed by the custom tracker:

```bash
cd backend
rg -n "AppThrottlerGuard|generateKey|APP_GUARD|@Throttle\\(\\{ user" src -S
```

Expected: `AppThrottlerGuard` is registered as an `APP_GUARD`, `generateKey()` branches on `throttlerName === 'user'`, and this endpoint is listed as the first `@Throttle({ user: ... })` route.

- [ ] **Step 6: Run backend repurchase tests**

Run:

```bash
cd backend
npx jest src/modules/order/order-repurchase.spec.ts src/modules/order/map-order.spec.ts src/modules/order/order-preview-prize-exclusion.spec.ts src/modules/order/order.service.cancel.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Run Prisma validation**

Run:

```bash
cd backend
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/order.controller.ts backend/src/modules/order/order.module.ts backend/src/modules/cart/cart.module.ts backend/src/modules/order/map-order.spec.ts backend/src/modules/order/order-preview-prize-exclusion.spec.ts backend/src/modules/order/order.service.cancel.spec.ts
git commit -m "feat(orders): add repurchase endpoint"
```

---

### Task 4: App Types, Repo, And Cart Hydration

**Files:**
- Modify: `src/types/domain/Order.ts`
- Modify: `src/store/useCartStore.ts`
- Modify: `src/repos/OrderRepo.ts`

- [ ] **Step 1: Add App types**

In `src/types/domain/Order.ts`, add import:

```ts
import { ServerCart } from './ServerCart';
```

Add these types after `RefundSummary`:

```ts
export type RepurchaseSkipReason =
  | 'PRIZE_ITEM'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'COMPANY_INACTIVE'
  | 'PLATFORM_PRODUCT'
  | 'MAX_PER_ORDER_EXCEEDED';

export type RepurchaseResultItem = {
  orderItemId: string;
  skuId: string;
  title: string;
  quantity: number;
  status: 'ADDED' | 'SKIPPED';
  reason?: RepurchaseSkipReason;
  priceChanged?: boolean;
  originalPrice?: number;
  currentPrice?: number;
  message?: string;
};

export type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
  cart: ServerCart;
  items: RepurchaseResultItem[];
};
```

Add to `Order`:

```ts
repurchasable?: boolean;
```

- [ ] **Step 2: Add `replaceFromServer` to cart store**

In `src/store/useCartStore.ts`, update import:

```ts
import { CartMergeResultItem, Product, ServerCart, ServerCartItem } from '../types';
```

Add to `CartState`:

```ts
/** 用服务端购物车响应直接覆盖本地购物车（用于复购等接口返回 cart 的场景） */
replaceFromServer: (cart: ServerCart, forceSelectedSkuIds?: string[]) => void;
```

Add method inside the store object before `syncFromServer`:

```ts
replaceFromServer: (cart, forceSelectedSkuIds = []) => {
  const forceSelected = new Set(forceSelectedSkuIds);
  const entries = cart.items.map((source) => {
    const local = serverToLocal(source);
    return { source, local };
  });
  set((state) => {
    const previousKeys = new Set(state.items.map(itemKey));
    const nextSelectedIds = new Set<string>();
    for (const { source, local } of entries) {
      if (!isSelectableCartItem(local)) continue;
      const key = itemKey(local);
      if (forceSelected.has(source.skuId)) {
        nextSelectedIds.add(key);
      } else if (previousKeys.has(key)) {
        if (state.selectedIds.has(key)) nextSelectedIds.add(key);
      } else if (source.isSelected !== false) {
        nextSelectedIds.add(key);
      }
    }
    return {
      items: entries.map((entry) => entry.local),
      selectedIds: nextSelectedIds,
      loading: false,
    };
  });
},
```

- [ ] **Step 3: Add `OrderRepo.repurchase`**

In `src/repos/OrderRepo.ts`, update imports:

```ts
import {
  Order,
  OrderItem,
  OrderStatus,
  PaginationResult,
  PaymentMethod,
  ShipmentDetail,
  Result,
  err,
  PendingCheckout,
  RepurchaseResult,
} from '../types';
import { CartRepo } from './CartRepo';
```

Add to the backend interface comment:

```ts
 * - `POST /api/v1/orders/{id}/repurchase` → 再次购买：可复购商品加入购物车
```

Add method inside `OrderRepo` after `getById`:

```ts
  /**
   * 再次购买
   * - 后端接口：`POST /api/v1/orders/{id}/repurchase`
   * - 成功时返回最新 ServerCart，调用方应直接 hydrate useCartStore
   */
  repurchase: async (orderId: string): Promise<Result<RepurchaseResult>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', '订单未找到', '订单未找到'));
      }
      if (order.status !== 'RECEIVED' || order.bizType === 'VIP_PACKAGE') {
        return err(createAppError('INVALID_STATE', '当前订单不支持再次购买', '当前订单不支持再次购买'));
      }

      const items = [];
      let addedQuantity = 0;
      let skippedQuantity = 0;
      for (const item of order.items) {
        if (item.isPrize) {
          skippedQuantity += item.quantity;
          items.push({
            orderItemId: item.id,
            skuId: item.skuId ?? item.productId,
            title: item.title,
            quantity: item.quantity,
            status: 'SKIPPED' as const,
            reason: 'PRIZE_ITEM' as const,
            message: '奖品不支持再次购买',
          });
          continue;
        }
        const skuId = item.skuId ?? item.productId;
        const cartResult = await CartRepo.addItem(skuId, item.quantity, {
          id: item.productId,
          title: item.title,
          image: item.image,
          price: item.price,
        });
        if (!cartResult.ok) return cartResult as unknown as Result<RepurchaseResult>;
        addedQuantity += item.quantity;
        items.push({
          orderItemId: item.id,
          skuId,
          title: item.title,
          quantity: item.quantity,
          status: 'ADDED' as const,
          priceChanged: false,
          originalPrice: item.price,
          currentPrice: item.price,
        });
      }
      const cart = await CartRepo.get();
      if (!cart.ok) return cart as unknown as Result<RepurchaseResult>;
      return simulateRequest({
        addedItemCount: items.filter((item) => item.status === 'ADDED').length,
        addedQuantity,
        skippedItemCount: items.filter((item) => item.status === 'SKIPPED').length,
        skippedQuantity,
        priceChangedCount: 0,
        cart: cart.data,
        items,
      });
    }

    return ApiClient.post<RepurchaseResult>(`/orders/${orderId}/repurchase`);
  },
```

- [ ] **Step 4: Run App typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/types/domain/Order.ts src/store/useCartStore.ts src/repos/OrderRepo.ts
git commit -m "feat(app/orders): add repurchase client contract"
```

---

### Task 5: App Order Buttons

**Files:**
- Create: `src/utils/repurchaseToast.ts`
- Modify: `src/utils/index.ts`
- Modify: `src/components/cards/OrderCard.tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `app/orders/index.tsx`

- [ ] **Step 1: Add shared toast formatter**

Create `src/utils/repurchaseToast.ts`:

```ts
import { RepurchaseResult } from '../types';

type ToastType = 'success' | 'info';

export function formatRepurchaseToast(result: RepurchaseResult): { message: string; type: ToastType } {
  const priceSuffix = result.priceChangedCount > 0 ? '，部分商品价格已变动，请到购物车确认' : '';
  if (result.skippedQuantity > 0) {
    return {
      message: `已加入 ${result.addedQuantity} 件商品，${result.skippedQuantity} 件不可购买${priceSuffix}`,
      type: 'info',
    };
  }

  return {
    message: `已加入购物车${priceSuffix}`,
    type: result.priceChangedCount > 0 ? 'info' : 'success',
  };
}
```

Add to `src/utils/index.ts`:

```ts
export * from './repurchaseToast';
```

- [ ] **Step 2: Add disabled support to OrderCard action buttons**

In `src/components/cards/OrderCard.tsx`, extend props:

```ts
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
```

Change the component signature:

```ts
export function OrderCard({
  order,
  onPress,
  onPrimaryAction,
  onSecondaryAction,
  primaryLabel,
  secondaryLabel,
  primaryDisabled = false,
  secondaryDisabled = false,
}: Props) {
```

Update the secondary action button:

```tsx
<Pressable
  onPress={secondaryDisabled ? undefined : onSecondaryAction}
  disabled={secondaryDisabled}
  accessibilityState={{ disabled: secondaryDisabled }}
>
  <Text style={[
    typography.caption,
    {
      color: colors.text.secondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginRight: 8,
      opacity: secondaryDisabled ? 0.5 : 1,
    },
  ]}>
    {secondaryLabel}
  </Text>
</Pressable>
```

Update the primary action button:

```tsx
<Pressable
  onPress={primaryDisabled ? undefined : onPrimaryAction}
  disabled={primaryDisabled}
  accessibilityState={{ disabled: primaryDisabled }}
>
  <Text style={[
    typography.caption,
    {
      color: colors.text.inverse,
      backgroundColor: statusColor,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 4,
      fontWeight: '600',
      opacity: primaryDisabled ? 0.5 : 1,
    },
  ]}>
    {primaryLabel}
  </Text>
</Pressable>
```

- [ ] **Step 3: Wire detail-page button**

In `app/orders/[id].tsx`, change store import:

```ts
import { useAuthStore, useCartStore } from '../../src/store';
```

Add utility import:

```ts
import { formatRepurchaseToast } from '../../src/utils';
```

Add state near `canceling`:

```ts
const [repurchasing, setRepurchasing] = React.useState(false);
const replaceCartFromServer = useCartStore((s) => s.replaceFromServer);
```

Add helper before CTA mapping:

```ts
const handleRepurchase = async () => {
  if (repurchasing || order.repurchasable === false) return;
  setRepurchasing(true);
  try {
    const r = await OrderRepo.repurchase(order.id);
    if (r.ok === false) {
      show({ message: r.error.displayMessage ?? '再次购买失败', type: 'error' });
      return;
    }
    const result = r.data;
    if (result.addedQuantity <= 0) {
      show({ message: '原订单商品当前不可再次购买', type: 'info' });
      return;
    }
    replaceCartFromServer(
      result.cart,
      result.items.filter((item) => item.status === 'ADDED').map((item) => item.skuId),
    );
    show(formatRepurchaseToast(result));
    router.push('/cart');
  } finally {
    setRepurchasing(false);
  }
};
```

Update `RECEIVED` CTA:

```ts
case 'RECEIVED':
  primary = {
    label: repurchasing ? '加入中...' : '再次购买',
    onPress: handleRepurchase,
    disabled: repurchasing || order.repurchasable === false,
  };
  break;
```

- [ ] **Step 4: Wire list-page button**

In `app/orders/index.tsx`, change imports:

```ts
import React, { useMemo, useState } from 'react';
import { useAuthStore, useCartStore } from '../../src/store';
import { formatRepurchaseToast } from '../../src/utils';
```

Inside `useOrderActions()`, add:

```ts
const replaceCartFromServer = useCartStore((s) => s.replaceFromServer);
const [repurchasingOrderId, setRepurchasingOrderId] = useState<string | null>(null);
```

Add helper inside `useOrderActions()`:

```ts
const handleRepurchase = async (order: Order) => {
  if (repurchasingOrderId || order.repurchasable === false) return;
  setRepurchasingOrderId(order.id);
  try {
    const r = await OrderRepo.repurchase(order.id);
    if (r.ok === false) {
      show({ message: r.error.displayMessage ?? '再次购买失败', type: 'error' });
      return;
    }
    const result = r.data;
    if (result.addedQuantity <= 0) {
      show({ message: '原订单商品当前不可再次购买', type: 'info' });
      return;
    }
    replaceCartFromServer(
      result.cart,
      result.items.filter((item) => item.status === 'ADDED').map((item) => item.skuId),
    );
    show(formatRepurchaseToast(result));
    router.push('/cart');
  } finally {
    setRepurchasingOrderId(null);
  }
};
```

Update the `RECEIVED` action:

```ts
case 'RECEIVED':
  return {
    primaryLabel: repurchasingOrderId === order.id ? '加入中...' : '再次购买',
    primaryAction: () => handleRepurchase(order),
    // 与 handleRepurchase() 的函数级 guard 保持一致：任意一笔复购中，全列表复购按钮禁用。
    primaryDisabled: repurchasingOrderId !== null || order.repurchasable === false,
  } as const;
```

Pass the disabled state into `OrderCard` in `renderItem`:

```tsx
<OrderCard
  order={item}
  onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })}
  primaryLabel={'primaryLabel' in ctas ? ctas.primaryLabel : undefined}
  onPrimaryAction={'primaryAction' in ctas ? ctas.primaryAction : undefined}
  primaryDisabled={'primaryDisabled' in ctas ? ctas.primaryDisabled : undefined}
  secondaryLabel={'secondaryLabel' in ctas ? ctas.secondaryLabel : undefined}
  onSecondaryAction={'secondaryAction' in ctas ? ctas.secondaryAction : undefined}
/>
```

- [ ] **Step 5: Run App typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/utils/repurchaseToast.ts src/utils/index.ts src/components/cards/OrderCard.tsx app/orders/[id].tsx app/orders/index.tsx
git commit -m "feat(app/orders): wire repurchase buttons"
```

---

### Task 6: Documentation And Verification

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`
- Modify if tracked/appropriate: `AGENTS.md`

- [ ] **Step 1: Update frontend architecture doc**

In `docs/architecture/frontend.md`, update the order-page implementation notes near the order page/CTA section with:

```md
- 再次购买（2026-05-08）：`RECEIVED` 普通商品订单调用 `POST /orders/:id/repurchase`，后端按白名单 `NORMAL_GOODS`、跳过奖品/VIP/平台商品/下架商品/停业商户/超限购项，返回最新购物车；App 直接 hydrate cart store 后跳转 `/cart`，由购物车/结算页重新确认价格、运费、红包和赠品解锁。
```

- [ ] **Step 2: Update plan.md**

Append a short section near the order-page worklog:

```md
## 订单再次购买（2026-05-08）

- [x] 设计文档：`docs/superpowers/specs/2026-05-08-order-repurchase-design.md`
- [x] 实施计划：`docs/superpowers/plans/2026-05-08-order-repurchase.md`
- [ ] 后端：`POST /orders/:id/repurchase`，含幂等、限流、Serializable、逐项结果
- [ ] App：订单列表/详情“再次购买”接入真实复购并跳购物车
- [ ] 验证：后端 Jest + Prisma validate + App TypeScript
```

- [ ] **Step 3: Update AGENTS.md index**

If `AGENTS.md` is tracked in the implementation workspace, add this line after the repurchase spec entry:

```md
- `docs/superpowers/plans/2026-05-08-order-repurchase.md` — 已完成订单再次购买实施计划（后端复购接口 / 幂等限流 / 购物车合并 / App 按钮接入 / 验证清单，**订单复购实施排程**）
```

If `AGENTS.md` is still untracked in the implementation workspace, add the line locally but do not include unrelated untracked `AGENTS.md` in the feature commit.

- [ ] **Step 4: Run backend focused verification**

Run:

```bash
cd backend
npx jest src/modules/order/order-repurchase.spec.ts src/modules/order/map-order.spec.ts src/modules/order/order-preview-prize-exclusion.spec.ts src/modules/order/order.service.cancel.spec.ts --runInBand
npx prisma validate
```

Expected:
- Jest: all tests pass.
- Prisma: schema is valid.

- [ ] **Step 5: Run App TypeScript verification**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Inspect git diff for unrelated changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan are modified, plus pre-existing unrelated dirty files that must remain untouched.

- [ ] **Step 7: Commit docs and final verification**

Run:

```bash
git add docs/architecture/frontend.md plan.md docs/superpowers/plans/2026-05-08-order-repurchase.md
git commit -m "docs(orders): document repurchase implementation"
```

If `AGENTS.md` is tracked and only contains the new repurchase plan index change, include it:

```bash
git add AGENTS.md
git commit -m "docs(agents): index repurchase implementation plan"
```

If `AGENTS.md` is untracked or contains unrelated local content, do not add it.

---

## Final Acceptance

The feature is complete when:
- `POST /api/v1/orders/:id/repurchase` exists and is throttled by the `user` bucket.
- Only `RECEIVED` + `NORMAL_GOODS` orders can be repurchased.
- Prize items, platform-company products, inactive company products, inactive product/SKU items, missing SKU items, and max-per-order overflow items are skipped with structured reasons.
- Existing cart rows are incremented and forced selected; legacy duplicate normal rows for the same SKU are counted for max-per-order and consolidated when safe.
- Duplicate requests within the 60 second result-cache window do not increment cart quantity twice when Redis is available, and the returned `cart` is always a fresh `cartService.getCart()` snapshot rather than the cached one.
- When Redis is unavailable (`acquireLock` returns `null`), the endpoint fails closed with a 409 instead of skipping idempotency.
- If result-cache write fails after cart mutation, the endpoint returns 409 and leaves the lock to expire naturally.
- App detail and list buttons hydrate cart from response and navigate to `/cart`; unrelated existing deselected cart items stay deselected, while repurchased SKUs are force-selected. The list page disables all repurchase buttons while one repurchase request is in flight.
- Price-change messaging is shown when `priceChangedCount > 0`.
- Focused Jest tests, Prisma validation, and App TypeScript verification pass.
