# Stock-Aware Repurchase And Low Stock Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inventory behavior consistent across repurchase, cart, checkout, buyer App, admin, and seller surfaces: zero-stock items cannot be added as real cart items, low-stock repurchase degrades to quantity 1, and low-stock display uses a configurable platform threshold.

**Architecture:** Keep the existing normal-goods payment callback oversell tolerance as a final concurrency fallback, but block every known zero-stock or known over-current-stock user action before checkout. Backend remains the source of truth for stock status and cart selectability; the App may render virtual zero-stock repurchase notices, but those notices are never persisted as `CartItem` rows.

**Tech Stack:** NestJS + Prisma + PostgreSQL Serializable transactions, React Native / Expo App Zustand cart store, React Query, Vite React admin/seller frontends, Jest unit tests, TypeScript build with `npx tsc -b`.

---

## Scope Check

This plan intentionally covers one inventory consistency feature across several surfaces because the bug crosses boundaries: backend cart state, repurchase, checkout, App display, and backstage SKU editing all read/write the same `ProductSKU.stock`. Do not split the P1 backend/App tasks; they must land together so zero-stock items cannot still sneak into checkout from another entry point. P2 admin/seller/after-sale tasks can be separate commits after the P1 chain passes.

## File Map

- Modify: `docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md` — source-of-truth rule change: zero stock is virtual, not a real added cart item.
- Modify: `backend/src/modules/order/repurchase.types.ts` — add `LOW_STOCK_ADJUSTED`, `OUT_OF_STOCK_VIRTUAL`, `stockStatus`, `stock`, `adjustedQuantity`, `virtual`.
- Modify: `src/types/domain/Order.ts` — mirror repurchase response fields for App.
- Modify: `src/types/domain/ServerCart.ts` — add `OUT_OF_STOCK` unavailable reason plus optional `sku.stock`/`stockStatus`/`selectable`; keep `product.stock` as a temporary compatibility mirror.
- Modify: `src/store/useCartStore.ts` — carry volatile SKU stock for display only, derive selectability from server `unavailableReason`, hold non-persisted virtual repurchase notices.
- Modify: `backend/src/modules/cart/cart.service.ts` — reject zero-stock add, force zero-stock existing cart items unselected, reject selecting zero-stock, keep reducing overstock quantity allowed.
- Modify: `backend/prisma/schema.prisma` — add cart-item lookup index for stock availability refresh.
- Create: `backend/prisma/migrations/20260518020000_stock_aware_cart_and_after_sale_idempotency/migration.sql` — add cart-item index and partial unique index for after-sale restock idempotency.
- Modify: `backend/src/modules/order/order.service.ts` — stock-aware repurchase, preview exclusion, after-sale stock follow-up references.
- Modify: `backend/src/modules/order/checkout.service.ts` — block known zero-stock and quantity-over-current-stock checkout creation before `CheckoutSession`.
- Modify: `backend/src/modules/admin/config/config-validation.ts` — validate `LOW_STOCK_DISPLAY_THRESHOLD`.
- Modify: `admin/src/pages/config/index.tsx` — expose low-stock threshold in platform settings.
- Create: `backend/src/modules/app-config/app-config.module.ts`
- Create: `backend/src/modules/app-config/app-config.service.ts`
- Create: `backend/src/modules/app-config/app-config.controller.ts`
- Modify: `backend/src/app.module.ts` — import `AppConfigModule`.
- Create: `src/repos/AppConfigRepo.ts`
- Modify: `seller/src/api/config.ts` — expose public low-stock threshold read to seller web list.
- Modify: `app/product/[id].tsx`, `app/cart.tsx`, `app/checkout.tsx`, `src/utils/repurchaseToast.ts`, `app/orders/index.tsx`, `app/orders/[id].tsx` — App inventory display, virtual notices, and checkout guards.
- Modify: `admin/src/pages/products/index.tsx`, `seller/src/pages/products/index.tsx`, `seller/src/pages/products/edit.tsx`, `admin/src/pages/products/edit.tsx` — per-SKU warning and negative stock display/repair.
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts` — idempotent return restock after successful returned-goods refund, guarded by the after-sale partial unique index.
- Test: `backend/src/modules/order/order-repurchase.spec.ts`
- Test: `backend/src/modules/cart/cart-stock-availability.spec.ts` (new)
- Test: `backend/src/modules/order/checkout-stock-availability.spec.ts` (new)
- Test: `backend/src/modules/admin/config/config-validation.spec.ts`
- Test: `backend/src/modules/after-sale/after-sale-refund.service.spec.ts`
- Docs: `docs/architecture/frontend.md`, `docs/architecture/data-system.md`, `plan.md`, `AGENTS.md`, `CLAUDE.md`

---

### Task 1: Platform Low-Stock Threshold Config

**Files:**
- Modify: `backend/src/modules/admin/config/config-validation.ts`
- Modify: `admin/src/pages/config/index.tsx`
- Create: `backend/src/modules/app-config/app-config.module.ts`
- Create: `backend/src/modules/app-config/app-config.service.ts`
- Create: `backend/src/modules/app-config/app-config.controller.ts`
- Modify: `backend/src/app.module.ts`
- Create: `src/repos/AppConfigRepo.ts`
- Test: `backend/src/modules/admin/config/config-validation.spec.ts`

- [ ] **Step 1: Add failing validation tests**

Append to `backend/src/modules/admin/config/config-validation.spec.ts`:

```ts
import { validateConfigValue } from './config-validation';

describe('LOW_STOCK_DISPLAY_THRESHOLD validation', () => {
  it('accepts integer threshold between 0 and 999', () => {
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 0)).toBeNull();
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 10)).toBeNull();
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 999)).toBeNull();
  });

  it('rejects invalid low-stock threshold values', () => {
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', -1)).toContain('最小值');
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 1000)).toContain('最大值');
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 1.5)).toContain('整数');
  });
});
```

- [ ] **Step 2: Run validation test and confirm failure**

Run:

```bash
cd backend && npx jest src/modules/admin/config/config-validation.spec.ts --runInBand
```

Expected: FAIL because `LOW_STOCK_DISPLAY_THRESHOLD` has no validation rule yet.

- [ ] **Step 3: Add validation rule**

In `backend/src/modules/admin/config/config-validation.ts`, add to `CONFIG_VALIDATION_RULES` near order/platform settings:

```ts
  LOW_STOCK_DISPLAY_THRESHOLD: {
    type: 'integer',
    description: 'App 低库存展示阈值（0 表示关闭“仅剩 x 件”展示）',
    min: 0,
    max: 999,
  },
```

- [ ] **Step 4: Add public App config service**

Create `backend/src/modules/app-config/app-config.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD = 10;

@Injectable()
export class AppConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig() {
    const row = await this.prisma.ruleConfig.findUnique({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      select: { value: true },
    });
    const raw = this.unwrap(row?.value, DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD);
    const lowStockDisplayThreshold =
      Number.isInteger(raw) && raw >= 0 && raw <= 999
        ? raw
        : DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD;

    return { lowStockDisplayThreshold };
  }

  private unwrap(raw: unknown, fallback: number): number {
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Object.prototype.hasOwnProperty.call(raw, 'value')
    ) {
      return Number((raw as { value?: unknown }).value);
    }
    return raw === undefined || raw === null ? fallback : Number(raw);
  }
}
```

Create `backend/src/modules/app-config/app-config.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from './app-config.service';

@Public()
@Controller('app/config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  @Get()
  getPublicConfig() {
    return this.service.getPublicConfig();
  }
}
```

Create `backend/src/modules/app-config/app-config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [AppConfigController],
  providers: [AppConfigService],
})
export class AppConfigModule {}
```

- [ ] **Step 5: Register AppConfigModule**

In `backend/src/app.module.ts`, add:

```ts
import { AppConfigModule } from './modules/app-config/app-config.module';
```

and add `AppConfigModule` to `imports` after `ConfigModule` or near buyer-facing modules:

```ts
    AppConfigModule,
```

- [ ] **Step 6: Add admin setting field**

In `admin/src/pages/config/index.tsx`, keep `ConfigMeta.group` as `'pricing' | 'lottery' | 'order'` and add to `CONFIG_SCHEMA` under order settings:

```ts
  {
    key: 'LOW_STOCK_DISPLAY_THRESHOLD',
    label: 'App 低库存展示阈值',
    group: 'order',
    type: 'number',
    min: 0,
    max: 999,
    step: 1,
    suffix: '件',
    integer: true,
    description: '库存 1..阈值时 App 展示“仅剩 x 件”；0 表示关闭低库存文案，但无库存仍会禁选',
    defaultValue: 10,
  },
```

- [ ] **Step 7: Add App config repo**

Create `src/repos/AppConfigRepo.ts`:

```ts
import { ApiClient } from './http/ApiClient';
import { Result, ok } from '../types';

export type PublicAppConfig = {
  lowStockDisplayThreshold: number;
};

const FALLBACK_CONFIG: PublicAppConfig = {
  lowStockDisplayThreshold: 10,
};

export const AppConfigRepo = {
  getPublicConfig: async (): Promise<Result<PublicAppConfig>> => {
    const result = await ApiClient.get<PublicAppConfig>('/app/config');
    if (!result.ok) return ok(FALLBACK_CONFIG);
    return ok({
      lowStockDisplayThreshold:
        Number.isInteger(result.data.lowStockDisplayThreshold) &&
        result.data.lowStockDisplayThreshold >= 0 &&
        result.data.lowStockDisplayThreshold <= 999
          ? result.data.lowStockDisplayThreshold
          : FALLBACK_CONFIG.lowStockDisplayThreshold,
    });
  },
};
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
cd backend && npx jest src/modules/admin/config/config-validation.spec.ts --runInBand
npx tsc -b
```

Expected: both PASS.

Commit:

```bash
git add backend/src/modules/admin/config/config-validation.ts backend/src/modules/admin/config/config-validation.spec.ts backend/src/modules/app-config backend/src/app.module.ts admin/src/pages/config/index.tsx src/repos/AppConfigRepo.ts
git commit -m "feat(config): expose low stock display threshold"
```

---

### Task 2: Backend Cart Stock Availability Guard

**Files:**
- Modify: `backend/src/modules/cart/cart.service.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260518020000_stock_aware_cart_and_after_sale_idempotency/migration.sql`
- Create: `backend/src/modules/cart/cart-stock-availability.spec.ts`
- Modify: `src/types/domain/ServerCart.ts`

- [ ] **Step 1: Write failing cart stock tests**

Create `backend/src/modules/cart/cart-stock-availability.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';

function createService(stock = 0) {
  const sku = {
    id: 'sku-zero',
    title: '龙虾',
    stock,
    status: 'ACTIVE',
    maxPerOrder: null,
    price: 234,
    product: { id: 'p1', title: '龙虾', status: 'ACTIVE', media: [] },
  };
  const cart = { id: 'cart1', userId: 'user1' };
  const prisma: any = {
    cart: {
      findUnique: jest.fn().mockResolvedValue(cart),
      create: jest.fn().mockResolvedValue(cart),
    },
    productSKU: { findUnique: jest.fn().mockResolvedValue(sku) },
    cartItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false, isSelected: true, sku }]),
    },
    lotteryRecord: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const redisCoord = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  };
  const bonusConfig = { getSystemConfig: jest.fn().mockResolvedValue({}) };
  const service = new CartService(prisma, { get: jest.fn() } as any, redisCoord as any, bonusConfig as any);
  jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart1', items: [] } as any);
  return { service, prisma };
}

describe('CartService stock availability', () => {
  it('rejects adding zero-stock normal SKU', async () => {
    const { service } = createService(0);
    await expect(service.addItem('user1', 'sku-zero', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips zero-stock normal SKU during login cart merge', async () => {
    const { service } = createService(0);
    const merged = await (service as any).mergeNormalItem('user1', { skuId: 'sku-zero', quantity: 1 });
    expect(merged).toBe(false);
  });

  it('rejects selecting zero-stock existing normal item', async () => {
    const { service } = createService(0);
    await expect(service.toggleSelect('user1', 'sku-zero', true)).rejects.toThrow('暂无库存');
  });

  it('allows reducing an existing quantity even when current stock is lower', async () => {
    const { service, prisma } = createService(1);
    await service.updateItemQuantity('user1', 'sku-zero', 1);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { quantity: 1 },
    });
  });
});
```

- [ ] **Step 2: Run cart tests and confirm failure**

Run:

```bash
cd backend && npx jest src/modules/cart/cart-stock-availability.spec.ts --runInBand
```

Expected: FAIL because zero-stock add/select are not rejected yet.

- [ ] **Step 3: Extend ServerCart stock contract**

In `src/types/domain/ServerCart.ts`, change `unavailableReason` union and add a real SKU-level stock object. Keep `product.stock` as a temporary compatibility mirror because older App code reads stock from `product.stock`; new code must prefer `item.sku.stock`.

```ts
  sku?: {
    stock: number;
    maxPerOrder?: number | null;
  };
  unavailableReason?:
    | 'SKU_INACTIVE'
    | 'PRODUCT_INACTIVE'
    | 'PRIZE_INACTIVE'
    | 'SKU_MISSING'
    | 'PRODUCT_MISSING'
    | 'OUT_OF_STOCK'
    | null;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  selectable?: boolean;
```

Update the comment above `product.stock`:

```ts
    /** @deprecated compatibility mirror of sku.stock; use item.sku.stock for SKU-level stock */
    stock: number;
```

- [ ] **Step 4: Add cart stock lookup index**

In `backend/prisma/schema.prisma`, add this index to `model CartItem`:

```prisma
  @@index([cartId, isPrize, isSelected])
```

In `backend/prisma/migrations/20260518020000_stock_aware_cart_and_after_sale_idempotency/migration.sql`, add the matching SQL:

```sql
CREATE INDEX IF NOT EXISTS "CartItem_cartId_isPrize_isSelected_idx"
ON "CartItem" ("cartId", "isPrize", "isSelected");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedger_after_sale_release_once_idx"
ON "InventoryLedger" ("refType", "refId")
WHERE "type" = 'RELEASE'
  AND "refType" = 'AFTER_SALE'
  AND "refId" IS NOT NULL;
```

- [ ] **Step 5: Add backend stock helpers**

In `backend/src/modules/cart/cart.service.ts`, add a local union near the existing `MergeResultItem` type:

```ts
type CartUnavailableReason = PrizeUnavailableReason | 'OUT_OF_STOCK';
```

Then change the local variable in `mapCartItem()`:

```ts
    let unavailableReason: CartUnavailableReason | null = null;
```

Add private helpers near other private methods:

```ts
  private getNormalStockUnavailableReason(item: any): 'OUT_OF_STOCK' | null {
    if (item.isPrize) return null;
    const stock = Number(item.sku?.stock ?? 0);
    return stock <= 0 ? 'OUT_OF_STOCK' : null;
  }

  private async forceOutOfStockNormalItemsUnselected(cartId: string) {
    const blocked = await this.prisma.cartItem.findMany({
      where: {
        cartId,
        isPrize: false,
        isSelected: true,
        sku: { stock: { lte: 0 } },
      },
      select: { id: true },
    });
    const ids = blocked.map((item) => item.id);
    if (ids.length === 0) return;
    await this.prisma.cartItem.updateMany({
      where: { id: { in: ids } },
      data: { isSelected: false },
    });
  }
```

- [ ] **Step 6: Reject zero-stock add and login merge**

In `addItem()`, after SKU/Product active checks and before maxPerOrder:

```ts
    if (sku.stock <= 0) {
      throw new BadRequestException('商品暂无库存，无法加入购物车');
    }
```

Inside the transaction, re-read SKU with `tx.productSKU.findUnique({ where: { id: skuId }, include: { product: true } })` before checking existing quantity, and repeat the `stock <= 0` check so concurrent admin stock changes are respected. Run this cart write transaction with Serializable isolation:

```ts
        await this.prisma.$transaction(async (tx) => {
          // existing find/update/create logic
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

In `mergeNormalItem()`, after active checks and before `ensureCart()`, skip zero-stock normal goods instead of creating a row:

```ts
    if (sku.stock <= 0) {
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'out_of_stock',
          userId,
          skuId: item.skuId,
        }),
      );
      return false;
    }
```

Also switch the `mergeNormalItem()` write transaction to Serializable and re-read the SKU inside the transaction before update/create:

```ts
    let merged = false;
    await this.prisma.$transaction(async (tx) => {
      const freshSku = await tx.productSKU.findUnique({
        where: { id: item.skuId },
        include: { product: true },
      });
      if (!freshSku || freshSku.status !== 'ACTIVE' || freshSku.product.status !== 'ACTIVE' || freshSku.stock <= 0) {
        merged = false;
        return;
      }
      const existing = await tx.cartItem.findFirst({
        where: { cartId: cart.id, skuId: item.skuId, isPrize: false },
      });
      if (existing) {
        const newQty = existing.quantity + item.quantity;
        if (newQty > freshSku.stock) throw new BadRequestException(`商品当前仅剩 ${freshSku.stock} 件`);
        await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
      } else {
        if (item.quantity > freshSku.stock) throw new BadRequestException(`商品当前仅剩 ${freshSku.stock} 件`);
        await tx.cartItem.create({ data: { cartId: cart.id, skuId: item.skuId, quantity: item.quantity } });
      }
      merged = true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return merged;
```

In `updateItemQuantity()`, move the cart item read, SKU re-read, stock/maxPerOrder checks, and quantity update into one Serializable transaction. Keep the current rule that decreasing quantity is allowed even when current stock is lower than the old cart quantity; only increasing is blocked by `stock` and `maxPerOrder`:

```ts
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { cartId: cart.id, skuId, isPrize: false },
      });
      if (!item) throw new NotFoundException('购物车中没有该商品');

      const sku = await tx.productSKU.findUnique({
        where: { id: skuId },
        include: { product: true },
      });
      if (!sku) throw new NotFoundException('商品规格不存在');
      if (sku.status !== 'ACTIVE') throw new BadRequestException('该规格已下架');
      if (sku.product.status !== 'ACTIVE') throw new BadRequestException('商品已下架');

      const isIncreasingQuantity = quantity > item.quantity;
      if (isIncreasingQuantity && sku.stock <= 0) throw new BadRequestException('商品暂无库存，无法增加数量');
      if (isIncreasingQuantity && quantity > sku.stock) throw new BadRequestException(`商品当前仅剩 ${sku.stock} 件`);
      if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
        throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
      }

      await tx.cartItem.update({
        where: { id: item.id },
        data: { quantity },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

- [ ] **Step 7: Reject selecting zero-stock**

In `toggleSelect()`, replace the standalone `findFirst()` + `update()` with one Serializable transaction:

```ts
    await this.prisma.$transaction(async (tx) => {
      const freshItem = await tx.cartItem.findFirst({
        where: { cartId: cart.id, skuId, isPrize: false },
        include: { sku: true },
      });
      if (!freshItem) throw new NotFoundException('购物车中没有该商品');
      if (isSelected && Number(freshItem.sku?.stock ?? 0) <= 0) {
        await tx.cartItem.update({
          where: { id: freshItem.id },
          data: { isSelected: false },
        });
        throw new BadRequestException('商品暂无库存，无法选择结算');
      }
      await tx.cartItem.update({
        where: { id: freshItem.id },
        data: { isSelected },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

- [ ] **Step 8: Mark zero-stock cart items unavailable**

In `getCart()`, after `cleanExpiredPrizeItems(cart.id)` and before the `cartItem.findMany()` call, call:

```ts
    await this.forceOutOfStockNormalItemsUnselected(cart.id);
```

In `mapCartItem()`, set normal item unavailable reason before returning:

```ts
    unavailableReason = unavailableReason ?? this.getNormalStockUnavailableReason(item);
```

Return optional stock status:

```ts
      sku: {
        stock: sku?.stock || 0,
        maxPerOrder: sku?.maxPerOrder ?? null,
      },
      stockStatus: (sku?.stock ?? 0) <= 0 ? 'OUT_OF_STOCK' : 'NORMAL',
      selectable: !unavailableReason && !item.isLocked,
```

- [ ] **Step 9: Verify and commit**

Run:

```bash
cd backend && npx jest src/modules/cart/cart-stock-availability.spec.ts src/modules/cart/cart-prize-lifecycle.spec.ts --runInBand
npx prisma validate
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add backend/src/modules/cart/cart.service.ts backend/src/modules/cart/cart-stock-availability.spec.ts backend/prisma/schema.prisma backend/prisma/migrations/20260518020000_stock_aware_cart_and_after_sale_idempotency/migration.sql src/types/domain/ServerCart.ts
git commit -m "fix(cart): block zero stock normal items"
```

---

### Task 3: Stock-Aware Repurchase With Virtual Zero-Stock Notices

**Files:**
- Modify: `backend/src/modules/order/repurchase.types.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-repurchase.spec.ts`
- Modify: `src/types/domain/Order.ts`

- [ ] **Step 1: Add failing repurchase tests**

Append to `backend/src/modules/order/order-repurchase.spec.ts`:

```ts
  it('degrades low-stock repurchase to quantity 1 and overwrites existing cart row', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } }] }),
      skus: [makeSku({ id: 'sku-1', stock: 1, price: 234 })],
      cartItems: [{ id: 'ci-1', skuId: 'sku-1', quantity: 3, isPrize: false, isSelected: true }],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(1);
    expect(result.items[0]).toMatchObject({
      status: 'ADDED',
      reason: 'LOW_STOCK_ADJUSTED',
      stockStatus: 'LOW_STOCK',
      stock: 1,
      adjustedQuantity: 1,
    });
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { quantity: 1, isSelected: true },
    });
  });

  it('counts repeated low-stock order rows as one adjusted cart quantity', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({
        items: [
          { id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 2, isPrize: false, productSnapshot: { title: '龙虾' } },
          { id: 'oi-2', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } },
        ],
      }),
      skus: [makeSku({ id: 'sku-1', stock: 1, price: 234 })],
      cartItems: [],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(1);
    expect(result.items.filter((item: any) => item.reason === 'LOW_STOCK_ADJUSTED')).toHaveLength(2);
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 1, isSelected: true }),
    }));
  });

  it('returns virtual result and does not create cart row when stock is zero', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } }] }),
      skus: [makeSku({ id: 'sku-1', stock: 0, price: 234 })],
      cartItems: [],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(0);
    expect(result.skippedQuantity).toBe(3);
    expect(result.items[0]).toMatchObject({
      status: 'SKIPPED',
      reason: 'OUT_OF_STOCK_VIRTUAL',
      stockStatus: 'OUT_OF_STOCK',
      stock: 0,
      virtual: true,
    });
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run repurchase tests and confirm failure**

Run:

```bash
cd backend && npx jest src/modules/order/order-repurchase.spec.ts --runInBand
```

Expected: FAIL because new reason fields and low-stock logic do not exist.

- [ ] **Step 3: Extend repurchase types**

In `backend/src/modules/order/repurchase.types.ts` and `src/types/domain/Order.ts`, extend:

```ts
export type RepurchaseSkipReason =
  | 'PRIZE_ITEM'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'COMPANY_INACTIVE'
  | 'PLATFORM_PRODUCT'
  | 'MAX_PER_ORDER_EXCEEDED'
  | 'LOW_STOCK_ADJUSTED'
  | 'OUT_OF_STOCK_VIRTUAL';

export type RepurchaseResultItem = {
  orderItemId: string;
  skuId: string;
  title: string;
  quantity: number;
  status: 'ADDED' | 'SKIPPED';
  reason?: RepurchaseSkipReason;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  stock?: number;
  adjustedQuantity?: number;
  virtual?: boolean;
  priceChanged?: boolean;
  originalPrice?: number;
  currentPrice?: number;
  message?: string;
};
```

- [ ] **Step 4: Implement repurchase stock rule**

In `backend/src/modules/order/order.service.ts`, inside the `for (const [skuId, group]...)` loop, replace `nextQuantity` logic with:

```ts
              const currentStock = Number(group.sku.stock ?? 0);
              const existingRows = existingGroupsBySkuId.get(skuId) ?? [];
              const existing = existingRows[0] as any | undefined;
              const existingQuantity = existingRows.reduce((sum, item) => sum + item.quantity, 0);
              const desiredQuantity = existingQuantity + group.totalQuantity;
              const duplicateIds = existingRows.slice(1).map((item) => item.id);
              if (duplicateIds.length > 0) {
                await tx.cartItem.deleteMany({
                  where: { id: { in: duplicateIds } },
                });
              }

              if (group.sku.maxPerOrder !== null && group.sku.maxPerOrder < 1) {
                for (const item of group.items) {
                  output.push(this.repurchaseSkipped(
                    item,
                    'MAX_PER_ORDER_EXCEEDED',
                    '该商品当前不可购买',
                  ));
                }
                continue;
              }

              if (currentStock <= 0) {
                if (existing) {
                  await tx.cartItem.update({
                    where: { id: existing.id },
                    data: { isSelected: false },
                  });
                }
                for (const item of group.items) {
                  output.push({
                    orderItemId: item.id,
                    skuId,
                    title: this.repurchaseTitle(item),
                    quantity: item.quantity,
                    status: 'SKIPPED',
                    reason: 'OUT_OF_STOCK_VIRTUAL',
                    stockStatus: 'OUT_OF_STOCK',
                    stock: currentStock,
                    virtual: true,
                    message: '商品暂无库存，未加入购物车',
                  });
                }
                continue;
              }

              const finalQuantity = desiredQuantity > currentStock ? 1 : desiredQuantity;
              const lowStockAdjusted = desiredQuantity > currentStock;
```

This duplicate cleanup happens before every stock branch, including `OUT_OF_STOCK_VIRTUAL`, so stale duplicate rows cannot keep an old selected quantity after the first row is forced unselected.

Then use `finalQuantity` in update/create:

```ts
                  data: { quantity: finalQuantity, isSelected: true },
```

and:

```ts
                  data: { cartId: cart.id, skuId, quantity: finalQuantity, isSelected: true },
```

When pushing ADDED item results, replace the current `for (const item of group.items)` output loop with this allocation block. Only the first adjusted row contributes `1` to the summary; additional rows carry `adjustedQuantity: 0` so repeated historical rows do not inflate `addedQuantity`.

```ts
              let remainingAdjustedQuantity = lowStockAdjusted ? finalQuantity : group.totalQuantity;
              for (const item of group.items) {
                const originalPrice = item.unitPrice;
                const currentPrice = group.sku.price;
                const priceChanged = Math.abs(originalPrice - currentPrice) > 0.01;
                const adjustedQuantity = lowStockAdjusted
                  ? Math.min(remainingAdjustedQuantity, item.quantity)
                  : undefined;
                if (lowStockAdjusted) {
                  remainingAdjustedQuantity = Math.max(0, remainingAdjustedQuantity - adjustedQuantity);
                }
                output.push({
                  orderItemId: item.id,
                  skuId,
                  title: this.repurchaseTitle(item),
                  quantity: item.quantity,
                  status: 'ADDED',
                  reason: lowStockAdjusted ? 'LOW_STOCK_ADJUSTED' : undefined,
                  stockStatus: lowStockAdjusted ? 'LOW_STOCK' : 'NORMAL',
                  stock: currentStock,
                  adjustedQuantity,
                  priceChanged,
                  originalPrice,
                  currentPrice,
                  message: lowStockAdjusted
                    ? `当前仅剩 ${currentStock} 件，已按 1 件加入购物车`
                    : priceChanged ? '商品价格已变动，请到购物车确认' : undefined,
                });
              }
```

- [ ] **Step 5: Fix summary quantities for adjusted rows**

In `buildRepurchaseSummary()`, change `addedQuantity` to sum `adjustedQuantity` when present:

```ts
      addedQuantity: added.reduce((sum, item) => sum + (item.adjustedQuantity ?? item.quantity), 0),
```

This is required for repeated same-SKU order rows: the real cart quantity is one row with quantity `1`, even if the historical order had multiple rows for the same SKU. Confirm tests assert `addedQuantity=1` for both single-row and repeated-row low-stock cases, and `skippedQuantity=3` for zero-stock virtual cases.

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd backend && npx jest src/modules/order/order-repurchase.spec.ts --runInBand
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add backend/src/modules/order/repurchase.types.ts backend/src/modules/order/order.service.ts backend/src/modules/order/order-repurchase.spec.ts src/types/domain/Order.ts
git commit -m "fix(order): make repurchase stock aware"
```

---

### Task 4: Checkout And Preview Stock Enforcement

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Create: `backend/src/modules/order/checkout-stock-availability.spec.ts`
- Modify: `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`

- [ ] **Step 1: Add failing checkout tests**

Create `backend/src/modules/order/checkout-stock-availability.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

function validAddress() {
  return {
    id: 'a1',
    userId: 'user1',
    regionText: '北京市/北京市/朝阳区',
    regionCode: 'CN-BJ-CY',
    recipientName: '张三',
    phone: '13800000000',
    detail: '街道一号',
  };
}

function createService(stock: number) {
  const sku = {
    id: 'sku-1',
    productId: 'p1',
    title: '龙虾',
    price: 234,
    cost: 100,
    stock,
    status: 'ACTIVE',
    maxPerOrder: null,
    weightGram: 1000,
    product: { id: 'p1', companyId: 'c1', title: '龙虾', status: 'ACTIVE', media: [] },
  };
  const prisma: any = {
    checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
    productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
    cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
    cartItem: { findMany: jest.fn().mockResolvedValue([{ id: 'ci1', cartId: 'cart1', skuId: 'sku-1', quantity: 3, isPrize: false }]) },
    address: { findUnique: jest.fn().mockResolvedValue(validAddress()) },
    vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
    rewardLedger: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const bonusConfig: any = {
    getSystemConfig: jest.fn().mockResolvedValue({
      normalFreeShippingThreshold: 0,
      vipFreeShippingThreshold: 0,
      defaultShippingFee: 0,
    }),
  };
  return new CheckoutService(prisma, bonusConfig);
}

describe('CheckoutService stock availability', () => {
  it('rejects known zero-stock normal item before creating checkout session', async () => {
    const service = createService(0);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects normal item quantity greater than current known stock', async () => {
    const service = createService(1);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 3, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('仅剩 1 件');
  });
});
```

- [ ] **Step 2: Run checkout stock tests and confirm failure**

Run:

```bash
cd backend && npx jest src/modules/order/checkout-stock-availability.spec.ts --runInBand
```

Expected: FAIL because checkout currently allows zero stock.

- [ ] **Step 3: Block known zero/overstock in checkout**

In `backend/src/modules/order/checkout.service.ts`, replace the stock warn block around current `sku.stock <= 0` with:

```ts
      if (!prizeCartItem) {
        if (sku.stock <= 0) {
          throw new BadRequestException(`商品「${sku.product.title}」暂无库存，请从购物车移除后再结算`);
        }
        if (item.quantity > sku.stock) {
          throw new BadRequestException(`商品「${sku.product.title}」当前仅剩 ${sku.stock} 件，请调整数量`);
        }
      }
```

Keep VIP package reservation CAS unchanged. Keep payment callback negative stock tolerance unchanged for concurrent stock changes after checkout creation.

- [ ] **Step 4: Add preview exclusion for normal stock failures**

In `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`, add:

```ts
  it('excludes zero-stock normal SKU from preview instead of pricing it', async () => {
    const zeroStockSku = {
      id: 'sku-zero',
      productId: 'product-zero',
      title: '龙虾 SKU',
      price: 234,
      stock: 0,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 1000,
      product: {
        id: 'product-zero',
        title: '龙虾',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
    };
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([zeroStockSku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue({ userId: 'user1', regionCode: '110000' }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = { getSystemConfig: jest.fn().mockResolvedValue({ normalFreeShippingThreshold: 0, vipFreeShippingThreshold: 0, defaultShippingFee: 0 }) };
    const service = new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any);

    const result = await service.previewOrder('user1', {
      items: [{ skuId: 'sku-zero', quantity: 1, cartItemId: 'ci-zero' }],
      addressId: 'addr1',
    } as any);

    expect(result.groups).toEqual([]);
    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({ skuId: 'sku-zero', reason: '商品暂无库存', isPrize: false }),
    ]);
  });
```

- [ ] **Step 5: Implement preview exclusion**

In `OrderService.previewOrder()`, after active status checks and before pricing:

```ts
      if (!prizeCi) {
        if (sku.stock <= 0) {
          excludedItems.push({
            cartItemId: (item as any).cartItemId,
            skuId: sku.id,
            reason: '商品暂无库存',
            isPrize: false,
          });
          continue;
        }
        if (item.quantity > sku.stock) {
          excludedItems.push({
            cartItemId: (item as any).cartItemId,
            skuId: sku.id,
            reason: `商品当前仅剩 ${sku.stock} 件`,
            isPrize: false,
          });
          continue;
        }
      }
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd backend && npx jest src/modules/order/checkout-stock-availability.spec.ts src/modules/order/order-preview-prize-exclusion.spec.ts --runInBand
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add backend/src/modules/order/checkout.service.ts backend/src/modules/order/order.service.ts backend/src/modules/order/checkout-stock-availability.spec.ts backend/src/modules/order/order-preview-prize-exclusion.spec.ts
git commit -m "fix(checkout): block known unavailable stock"
```

---

### Task 5: Buyer App Stock Display, Virtual Notices, And Checkout Guard

**Files:**
- Modify: `src/store/useCartStore.ts`
- Modify: `src/store/useAuthStore.ts`
- Modify: `src/utils/repurchaseToast.ts`
- Modify: `app/orders/index.tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `app/cart.tsx`
- Modify: `app/product/[id].tsx`
- Modify: `app/checkout.tsx`
- Modify: `src/types/domain/ServerCart.ts`
- Modify: `src/types/domain/Order.ts`
- Create: `src/utils/stockDisplay.ts`

- [ ] **Step 1: Add stock display helper**

Create `src/utils/stockDisplay.ts`:

```ts
export type StockStatus = 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export function getStockStatus(stock: number | undefined | null, threshold: number): StockStatus {
  const value = Number(stock ?? 0);
  if (value <= 0) return 'OUT_OF_STOCK';
  if (threshold > 0 && value <= threshold) return 'LOW_STOCK';
  return 'NORMAL';
}

export function getStockText(stock: number | undefined | null, threshold: number): string | null {
  const value = Number(stock ?? 0);
  const status = getStockStatus(value, threshold);
  if (status === 'OUT_OF_STOCK') return '无库存';
  if (status === 'LOW_STOCK') return `仅剩 ${value} 件`;
  return null;
}
```

- [ ] **Step 2: Add virtual notice state to cart store**

In `src/store/useCartStore.ts`, add type:

```ts
export type VirtualCartNotice = {
  skuId: string;
  title: string;
  message: string;
};
```

Add to `CartState`:

```ts
  virtualNotices: VirtualCartNotice[];
  setVirtualNotices: (items: VirtualCartNotice[]) => void;
  clearVirtualNotice: (skuId: string) => void;
  clearVirtualNotices: () => void;
```

Initialize and implement:

```ts
      virtualNotices: [],
      setVirtualNotices: (items) => set({ virtualNotices: items }),
      clearVirtualNotice: (skuId) =>
        set((state) => ({
          virtualNotices: state.virtualNotices.filter((item) => item.skuId !== skuId),
        })),
      clearVirtualNotices: () => set({ virtualNotices: [] }),
```

Update `serverToLocal()` to copy SKU stock as a volatile display field. Prefer the new `si.sku.stock`, and fall back to the temporary compatibility mirror `si.product.stock`.

```ts
  stock: si.sku?.stock ?? si.product.stock,
```

Add `stock?: number;` to `CartItem`, with this comment:

```ts
  /** SKU 库存快照，仅用于当前会话展示；不可作为持久化后的选择裁决 */
  stock?: number;
```

In `replaceFromServer()` and `syncFromServer()`, clear stale virtual notices after successful server hydration:

```ts
      replaceFromServer: (cart, forceSelectedSkuIds = []) => {
        // ...existing mapping...
        set((state) => {
          // keep existing selected-id reconciliation, but include virtualNotices: []
          return {
            items: entries.map(({ local }) => local),
            selectedIds: nextSelectedIds,
            virtualNotices: [],
          };
        });
      },
```

`syncFromServer()` should also end in a state write with `virtualNotices: []`.

- [ ] **Step 3: Make selectable logic stock-aware**

In `useCartStore.ts`, keep selection authority on server `unavailableReason` and lock state. Do not use persisted `stock` for selectability because Zustand persists cart items and stock can become stale after cold start.

```ts
export const isSelectableCartItem = (item: CartItem) =>
  !item.unavailableReason &&
  !item.isLocked;
```

In the persist `partialize`, strip volatile stock and virtual notices:

```ts
      partialize: (state) => ({
        items: state.items.map(({ stock, ...item }) => item),
        selectedIds: Array.from(state.selectedIds),
      }),
```

In `src/store/useAuthStore.ts`, update the logout cart reset to clear notices:

```ts
useCartStore.setState({ items: [], selectedIds: new Set<string>(), virtualNotices: [] });
```

Document this invariant in a short code comment near `CartItem.stock`: stock is display state; `unavailableReason` is the checkout/selectability裁决 state.

- [ ] **Step 4: Set virtual notices after repurchase**

In both `app/orders/index.tsx` and `app/orders/[id].tsx`, after `const result = r.data`, hydrate the real cart first, then set virtual notices so `replaceFromServer()` does not clear the notice from the same repurchase action:

```ts
replaceCartFromServer(result.cart);
const virtualNotices = result.items
  .filter((item) => item.virtual || item.reason === 'OUT_OF_STOCK_VIRTUAL')
  .map((item) => ({
    skuId: item.skuId,
    title: item.title,
    message: item.message || '商品暂无库存，未加入购物车',
  }));
useCartStore.getState().setVirtualNotices(virtualNotices);
```

If `addedQuantity === 0` but `virtualNotices.length > 0`, still navigate to `/cart` so the user sees the virtual explanation.

- [ ] **Step 5: Improve repurchase toast**

In `src/utils/repurchaseToast.ts`, use virtual count:

```ts
  const virtualCount = result.items.filter((item) => item.virtual || item.reason === 'OUT_OF_STOCK_VIRTUAL').length;
  if (virtualCount > 0 && result.addedQuantity === 0) {
    return { message: '商品暂无库存，未加入购物车', type: 'info' };
  }
  if (virtualCount > 0) {
    return {
      message: `已加入 ${result.addedQuantity} 件商品，${virtualCount} 个商品暂无库存${priceSuffix}`,
      type: 'info',
    };
  }
```

Keep the existing skipped/price changed branches after this block.

- [ ] **Step 6: Render virtual notices in cart**

In `app/cart.tsx`, read:

```ts
const virtualNotices = useCartStore((s) => s.virtualNotices);
const clearVirtualNotice = useCartStore((s) => s.clearVirtualNotice);
```

Also update `unavailableText()` in `app/cart.tsx`:

```ts
    case 'OUT_OF_STOCK':
      return '无库存';
```

In `ListHeaderComponent`, after the select-all row, render:

```tsx
{virtualNotices.map((notice) => (
  <View key={notice.skuId} style={[styles.card, { borderColor: colors.danger, borderWidth: 1, backgroundColor: colors.surface }]}>
    <View style={{ flex: 1 }}>
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
        {notice.title}
      </Text>
      <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
        {notice.message}
      </Text>
    </View>
    <Pressable onPress={() => clearVirtualNotice(notice.skuId)} hitSlop={8}>
      <MaterialCommunityIcons name="delete-outline" size={20} color={colors.danger} />
    </Pressable>
  </View>
))}
```

- [ ] **Step 7: Show stock text and disable zero-stock buttons on product detail**

In `app/product/[id].tsx`, import:

```ts
import { useQuery } from '@tanstack/react-query';
import { AppConfigRepo } from '../../src/repos/AppConfigRepo';
import { getStockText, getStockStatus } from '../../src/utils/stockDisplay';
```

Use existing React Query import if already present. Add:

```ts
const { data: appConfigResult } = useQuery({
  queryKey: ['app-config'],
  queryFn: AppConfigRepo.getPublicConfig,
  staleTime: 1000 * 60 * 60,
});
const lowStockThreshold = appConfigResult?.ok ? appConfigResult.data.lowStockDisplayThreshold : 10;
const activeStockStatus = getStockStatus(selectedSku?.stock ?? 0, lowStockThreshold);
const activeStockText = getStockText(selectedSku?.stock ?? 0, lowStockThreshold);
const canBuyActiveSku = activeStockStatus !== 'OUT_OF_STOCK';
```

Replace raw `库存: {sku.stock}` with:

```tsx
{getStockText(sku.stock, lowStockThreshold) && (
  <Text style={[typography.captionSm, { color: sku.stock <= 0 ? colors.danger : colors.warning, marginTop: 2 }]}>
    {getStockText(sku.stock, lowStockThreshold)}
  </Text>
)}
```

In each add/buy `onPress`, first guard:

```ts
if (!canBuyActiveSku) {
  show({ message: '商品暂无库存，无法加入购物车', type: 'info' });
  return;
}
```

Set disabled style on buttons when `!canBuyActiveSku`.

Use the same `['app-config']` query key and `staleTime: 1000 * 60 * 60` in `app/cart.tsx` and `app/checkout.tsx` when rendering stock text. This keeps App config to one cached request per hour across the App.

In `app/cart.tsx`, render SKU-level stock text under the title:

```tsx
{getStockText(item.stock, lowStockThreshold) && (
  <Text style={[typography.captionSm, { color: Number(item.stock ?? 0) <= 0 ? colors.danger : colors.warning, marginTop: 2 }]}>
    {getStockText(item.stock, lowStockThreshold)}
  </Text>
)}
```

In `app/checkout.tsx`, render the same text on checkout item rows and keep checkout blocking based on server refresh plus `unavailableReason`.

- [ ] **Step 8: Prevent checkout navigation with zero-stock selected local rows**

In `app/cart.tsx`, before `router.push('/checkout')`, add:

```ts
const blocked = selectedItems.some((item) => item.unavailableReason === 'OUT_OF_STOCK' || Number(item.stock ?? 1) <= 0);
if (blocked) {
  show({ message: '有商品暂无库存，请移除后再结算', type: 'warning' });
  return;
}
```

In `app/checkout.tsx`, after `syncFromServer()` completes on entry, selected items already rehydrate; before create session, add:

```ts
const blocked = cartItems.some((item) => item.unavailableReason === 'OUT_OF_STOCK' || Number(item.stock ?? 1) <= 0);
if (blocked) {
  show({ message: '有商品暂无库存，请返回购物车处理', type: 'warning' });
  return;
}
```

- [ ] **Step 9: Verify and commit**

Run:

```bash
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add src/store/useCartStore.ts src/store/useAuthStore.ts src/utils/stockDisplay.ts src/utils/repurchaseToast.ts src/types/domain/ServerCart.ts src/types/domain/Order.ts src/repos/AppConfigRepo.ts app/cart.tsx app/product/[id].tsx app/checkout.tsx app/orders/index.tsx app/orders/[id].tsx
git commit -m "fix(app): show stock aware cart states"
```

---

### Task 6: Admin And Seller Inventory Visibility

**Files:**
- Modify: `admin/src/pages/products/index.tsx`
- Modify: `admin/src/pages/products/edit.tsx`
- Modify: `seller/src/api/config.ts`
- Modify: `seller/src/pages/products/index.tsx`
- Modify: `seller/src/pages/products/edit.tsx`

- [ ] **Step 1: Add shared low-stock threshold reads**

In `seller/src/api/config.ts`, add a public App config read:

```ts
export const getPublicAppConfig = (): Promise<{ lowStockDisplayThreshold: number }> =>
  client.get('/app/config');
```

In `admin/src/pages/products/index.tsx`, import:

```ts
import { useQuery } from '@tanstack/react-query';
import { getConfigs } from '@/api/config';
import { extractConfigValue, type Product, type ProductSKU } from '@/types';
```

Then inside `ProductListPage()`:

```ts
const { data: configRows = [] } = useQuery({
  queryKey: ['admin', 'configs', 'low-stock-threshold'],
  queryFn: getConfigs,
  staleTime: 1000 * 60 * 60,
});
const lowStockThreshold = (() => {
  const row = configRows.find((item) => item.key === 'LOW_STOCK_DISPLAY_THRESHOLD');
  const value = Number(row ? extractConfigValue(row) : 10);
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : 10;
})();
```

In `seller/src/pages/products/index.tsx`, import and query:

```ts
import { getPublicAppConfig } from '@/api/config';
```

```ts
const { data: appConfig } = useQuery({
  queryKey: ['app-config'],
  queryFn: getPublicAppConfig,
  staleTime: 1000 * 60 * 60,
});
const lowStockThreshold = appConfig?.lowStockDisplayThreshold ?? 10;
```

- [ ] **Step 2: Replace total-only stock warning with per-SKU warning**

In `admin/src/pages/products/index.tsx`, make sure the `@/types` import uses `extractConfigValue, type Product, type ProductSKU` as shown in Step 1.

`seller/src/pages/products/index.tsx` already imports `ProductSKU`. In both list pages, replace `LOW_STOCK_THRESHOLD = 10` and total-only helpers with:

```ts
function getStockSummary(product: Product, threshold: number) {
  const skus = product.skus ?? [];
  const total = skus.reduce((sum, sku) => sum + (sku.stock ?? 0), 0);
  const minSku = skus.reduce<ProductSKU | undefined>((min, sku) => {
    if (!min) return sku;
    return (sku.stock ?? 0) < (min.stock ?? 0) ? sku : min;
  }, undefined);
  const owedSkus = skus.filter((sku) => (sku.stock ?? 0) < 0);
  const zeroCount = skus.filter((sku) => (sku.stock ?? 0) <= 0).length;
  const lowCount = threshold > 0
    ? skus.filter((sku) => (sku.stock ?? 0) > 0 && (sku.stock ?? 0) <= threshold).length
    : 0;
  return { total, minSku, owedSkus, zeroCount, lowCount };
}
```

Call `getStockSummary(r, lowStockThreshold)` in every product row. Use `zeroCount > 0 || lowCount > 0` for warnings instead of `total < 10` or `stock < LOW_STOCK_THRESHOLD`.

- [ ] **Step 3: Display negative stock as owed stock**

In `seller/src/pages/products/index.tsx`, add `Tooltip` and `Typography` to the Ant Design import and add `const { Text } = Typography;` near the top. `admin/src/pages/products/index.tsx` already has both.

In stock column renderers, display:

```tsx
const { total, minSku, owedSkus, zeroCount, lowCount } = getStockSummary(r, lowStockThreshold);
const hasOwed = (minSku?.stock ?? 0) < 0;
const owedText = owedSkus
  .map((sku) => `${sku.title || sku.id}: 欠货 ${Math.abs(sku.stock ?? 0)} 件`)
  .join('\n');
return (
  <Space direction="vertical" size={0}>
    <Text type={hasOwed || zeroCount > 0 ? 'danger' : lowCount > 0 ? 'warning' : undefined}>
      {total}
    </Text>
    {hasOwed && (
      <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{owedText}</pre>}>
        <Text type="danger" style={{ fontSize: 12 }}>
          {owedSkus.length} 个规格欠货
        </Text>
      </Tooltip>
    )}
    {!hasOwed && zeroCount > 0 && <Text type="danger" style={{ fontSize: 12 }}>{zeroCount} 个规格无库存</Text>}
    {!hasOwed && zeroCount === 0 && lowCount > 0 && <Text type="warning" style={{ fontSize: 12 }}>{lowCount} 个规格低库存</Text>}
  </Space>
);
```

- [ ] **Step 4: Add edit-page hint for negative initial stock**

In `admin/src/pages/products/edit.tsx`, add `min={0}` and `precision={0}` to the SKU stock `InputNumber`:

```tsx
<InputNumber min={0} precision={0} style={{ width: 120 }} />
```

In both `admin/src/pages/products/edit.tsx` and `seller/src/pages/products/edit.tsx`, add a responsive hint inside each `Form.List name="skus"` row, next to the stock `Form.Item`:

```tsx
<Form.Item noStyle shouldUpdate={(prev, cur) => prev.skus?.[field.name]?.stock !== cur.skus?.[field.name]?.stock}>
  {({ getFieldValue }) => {
    const stock = Number(getFieldValue(['skus', field.name, 'stock']) ?? 0);
    return stock < 0 ? (
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        当前为超卖欠货，请填写补货后的可售库存（不能保存负数）
      </Typography.Text>
    ) : null;
  }}
</Form.Item>
```

In seller single-SKU sections that use `name="singleStock"`, add a separate responsive hint:

```tsx
<Form.Item noStyle shouldUpdate={(prev, cur) => prev.singleStock !== cur.singleStock}>
  {({ getFieldValue }) => (
    Number(getFieldValue('singleStock') ?? 0) < 0 ? (
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        当前为超卖欠货，请填写补货后的可售库存（不能保存负数）
      </Typography.Text>
    ) : null
  )}
</Form.Item>
```

Keep `min={0}` for input; the user repairs negative inventory by entering `0+`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add admin/src/pages/products/index.tsx admin/src/pages/products/edit.tsx seller/src/api/config.ts seller/src/pages/products/index.tsx seller/src/pages/products/edit.tsx
git commit -m "fix(web): surface per sku low stock warnings"
```

---

### Task 7: Return Refund Inventory Restock

**Files:**
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.spec.ts`

- [ ] **Step 1: Add failing restock test**

Append to `backend/src/modules/after-sale/after-sale-refund.service.spec.ts`:

```ts
it('restocks returned normal item exactly once when return refund succeeds', async () => {
  const tx: any = {
    refund: { findUnique: jest.fn().mockResolvedValue({ id: 'refund1', status: 'REFUNDING', afterSaleId: 'as1', amount: 234 }) , update: jest.fn() },
    afterSaleRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'as1',
        orderId: 'order1',
        userId: 'user1',
        status: 'REFUNDING',
        afterSaleType: 'QUALITY_RETURN',
        requiresReturn: true,
        orderItem: { skuId: 'sku1', quantity: 2, isPrize: false },
      }),
      update: jest.fn(),
    },
    refundStatusHistory: { create: jest.fn() },
    productSKU: { update: jest.fn() },
    inventoryLedger: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    afterSaleStatusHistory: { create: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

  await service.handleRefundSuccess('refund1', 'provider1');

  expect(tx.productSKU.update).toHaveBeenCalledWith({
    where: { id: 'sku1' },
    data: { stock: { increment: 2 } },
  });
  expect(tx.inventoryLedger.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      skuId: 'sku1',
      type: 'RELEASE',
      qty: 2,
      refType: 'AFTER_SALE',
      refId: 'as1',
    }),
  }));
});

it('does not restock again when after-sale RELEASE ledger already exists', async () => {
  const tx: any = {
    refund: { findUnique: jest.fn().mockResolvedValue({ id: 'refund1', status: 'REFUNDING', afterSaleId: 'as1', amount: 234 }), update: jest.fn() },
    afterSaleRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'as1',
        orderId: 'order1',
        userId: 'user1',
        status: 'REFUNDING',
        afterSaleType: 'QUALITY_RETURN',
        requiresReturn: true,
        orderItem: { skuId: 'sku1', quantity: 2, isPrize: false },
      }),
      update: jest.fn(),
    },
    refundStatusHistory: { create: jest.fn() },
    productSKU: { update: jest.fn() },
    inventoryLedger: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ledger-existing' }),
      create: jest.fn(),
    },
    afterSaleStatusHistory: { create: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

  await service.handleRefundSuccess('refund1', 'provider1');

  expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
  expect(tx.productSKU.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run after-sale test and confirm failure**

Run:

```bash
cd backend && npx jest src/modules/after-sale/after-sale-refund.service.spec.ts --runInBand
```

Expected: FAIL because refund success does not restock.

- [ ] **Step 3: Include order item in refund success lookup**

In `handleRefundSuccess()`, change `tx.afterSaleRequest.findUnique` to:

```ts
        const request = await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
          include: {
            orderItem: {
              select: { skuId: true, quantity: true, isPrize: true },
            },
          },
        });
```

- [ ] **Step 4: Add idempotent restock helper**

The migration created in Task 2 already includes the partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedger_after_sale_release_once_idx"
ON "InventoryLedger" ("refType", "refId")
WHERE "type" = 'RELEASE'
  AND "refType" = 'AFTER_SALE'
  AND "refId" IS NOT NULL;
```

Inside the `if (request.status !== 'REFUNDED')` transition block, before returning completed payload, add this helper. Create the ledger before incrementing stock so the unique index prevents duplicate stock increments under concurrent retry:

```ts
          const shouldRestock =
            request.requiresReturn === true &&
            (request.afterSaleType === 'NO_REASON_RETURN' || request.afterSaleType === 'QUALITY_RETURN') &&
            request.orderItem &&
            request.orderItem.isPrize !== true;

          if (shouldRestock) {
            const existingLedger = await tx.inventoryLedger.findFirst({
              where: {
                type: 'RELEASE',
                refType: 'AFTER_SALE',
                refId: request.id,
              },
            });
            if (!existingLedger) {
              try {
                await tx.inventoryLedger.create({
                  data: {
                    skuId: request.orderItem.skuId,
                    type: 'RELEASE',
                    qty: request.orderItem.quantity,
                    refType: 'AFTER_SALE',
                    refId: request.id,
                  },
                });
              } catch (error) {
                if (
                  error instanceof Prisma.PrismaClientKnownRequestError &&
                  error.code === 'P2002'
                ) {
                  return;
                }
                throw error;
              }
              await tx.productSKU.update({
                where: { id: request.orderItem.skuId },
                data: { stock: { increment: request.orderItem.quantity } },
              });
            }
          }
```

Do not restock `NO_REASON_EXCHANGE`/`QUALITY_EXCHANGE` here; exchange inventory is a separate shipment/replacement flow and needs its own audit if changed.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd backend && npx jest src/modules/after-sale/after-sale-refund.service.spec.ts --runInBand
npx tsc -b
```

Expected: PASS.

Commit:

```bash
git add backend/src/modules/after-sale/after-sale-refund.service.ts backend/src/modules/after-sale/after-sale-refund.service.spec.ts
git commit -m "fix(after-sale): restock returned refunded items"
```

---

### Task 8: Documentation, Regression Matrix, And Final Verification

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/data-system.md`
- Modify: `plan.md`
- Modify: `docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update docs**

In `docs/architecture/frontend.md`, add a buyer App inventory note under cart/order or responsive shopping sections:

```md
库存体验：App 使用平台配置 `LOW_STOCK_DISPLAY_THRESHOLD` 控制“仅剩 x 件”展示；0 库存普通商品不能作为真实购物车项新增，复购仅展示虚拟提示；已有 0 库存购物车项不可选、不可结算、可删除。
```

In `plan.md`, add an entry near Phase 4 repurchase:

```md
- [x] **Phase 4 补充 · 库存感知复购与低库存展示（2026-05-18）** — 复购低库存降级为 1、0 库存虚拟提示不入真实购物车、购物车/结算禁选无库存、后台低库存阈值、售后退货退款回填库存。
```

In `AGENTS.md`, register this plan:

```md
- `docs/superpowers/plans/2026-05-18-stock-aware-repurchase-low-stock-display.md` — 库存感知复购与低库存展示实施计划（后端库存裁决 / App 虚拟无库存提示 / 后台低库存阈值 / 售后库存回填，**库存体验与库存一致性实施排程**）
```

In both `AGENTS.md` and `CLAUDE.md`, update the inventory architecture decision from:

```md
| 超卖容忍 | 允许库存变为负数，卖家收到补货通知，不退款 |
```

to:

```md
| 超卖容忍 | 已知无库存/超当前库存的普通商品在加购、复购、购物车勾选和 CheckoutSession 前拦截；支付回调阶段仍允许并发后的普通商品库存变为负数，卖家收到补货通知，不退款 |
```

In `docs/architecture/data-system.md`, document `InventoryLedger.refType='AFTER_SALE'` for returned-goods refund restock and the partial unique index:

```md
库存流水补充：退货退款成功后的库存回填使用 `InventoryLedger(type=RELEASE, refType=AFTER_SALE, refId=<afterSaleId>)` 记录幂等流水；数据库通过部分唯一索引保证同一个售后单只回填一次。
```

In `docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md`, align the cart response shape with the implementation:

```ts
type ServerCartItem = {
  sku?: {
    stock: number;
    maxPerOrder?: number | null;
  };
  product: {
    /** compatibility mirror of sku.stock during rollout */
    stock: number;
  };
  isSelected: boolean;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  selectable?: boolean;
};
```

- [ ] **Step 2: Run focused backend tests**

Run:

```bash
cd backend && npx jest \
  src/modules/cart/cart-stock-availability.spec.ts \
  src/modules/order/order-repurchase.spec.ts \
  src/modules/order/checkout-stock-availability.spec.ts \
  src/modules/order/order-preview-prize-exclusion.spec.ts \
  src/modules/admin/config/config-validation.spec.ts \
  src/modules/after-sale/after-sale-refund.service.spec.ts \
  --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript build**

Run from repo root:

```bash
npx tsc -b
```

Expected: PASS.

- [ ] **Step 4: Static grep audit**

Run:

```bash
test "$(rg -n "OUT_OF_STOCK" backend/src/modules/cart/cart.service.ts src/types/domain/ServerCart.ts app/cart.tsx | wc -l | tr -d ' ')" -ge 3
test "$(rg -n "LOW_STOCK_DISPLAY_THRESHOLD" backend/src admin/src src docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md | wc -l | tr -d ' ')" -ge 4
test "$(rg -n "stock: \\{ decrement" backend/src/modules/order/checkout.service.ts | wc -l | tr -d ' ')" -ge 1
test "$(rg -n "refType: 'AFTER_SALE'|refType=AFTER_SALE" backend/src docs/architecture/data-system.md backend/prisma/migrations | wc -l | tr -d ' ')" -ge 2
test "$(rg -n "LOW_STOCK_THRESHOLD = 10|stock < 10" admin/src/pages/products/index.tsx seller/src/pages/products/index.tsx | wc -l | tr -d ' ')" -eq 0
```

Expected: all commands exit `0`. These assertions verify zero-stock handling is explicit, payment callback still has the R12 decrement fallback, after-sale restock is idempotent, and admin/seller no longer hard-code threshold `10`.

- [ ] **Step 5: Manual real-device matrix**

Use Android real device with large font and virtual navigation keys:

1. Product SKU stock `0`: product detail shows “无库存”; add cart and buy now do not create cart item.
2. Completed order quantity `3`, current stock `1`: repurchase lands cart quantity `1`, selected, shows “仅剩 1 件”.
3. Completed order quantity `3`, current stock `0`: repurchase navigates to cart with virtual “无库存，未加入购物车” notice; real cart has no new item.
4. Existing cart item becomes stock `0`: sync cart; item is unchecked, disabled, can delete, cannot checkout.
5. Existing cart item quantity `3`, current stock `1`: reducing to `1` works; increasing beyond `1` fails.
6. Checkout page after stock changes to `0`: preview excludes or create session blocks with clear message.
7. Admin threshold changed from `10` to `5`: product detail/cart low-stock text follows threshold.
8. Returned item refund success: SKU stock increments once and `InventoryLedger` has `refType=AFTER_SALE`.

- [ ] **Step 6: Final commit**

Commit docs after verification:

```bash
git add docs/architecture/frontend.md docs/architecture/data-system.md plan.md docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md AGENTS.md CLAUDE.md
git commit -m "docs(stock): record stock aware rollout"
```

Do not push or OTA until the user explicitly says `推` / `push` / `ota` / `上测试`.
