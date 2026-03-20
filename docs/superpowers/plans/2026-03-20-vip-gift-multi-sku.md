# VIP 赠品多商品组合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert VIP gift options from single-SKU to multi-SKU combos, allowing each gift package to contain multiple products with independent quantities.

**Architecture:** Introduce a `VipGiftItem` child table (one-to-many from `VipGiftOption`), remove `skuId`/`marketPrice` from parent, add `coverMode` enum for composite cover images. Update admin CRUD, buyer API, checkout flow, and VIP activation to operate on item arrays.

**Tech Stack:** NestJS + Prisma (PostgreSQL), React 19 + Ant Design 5 (admin), React Native + Expo (buyer app)

**Spec:** `docs/superpowers/specs/2026-03-20-vip-gift-multi-sku-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `backend/prisma/schema.prisma` | Add `CoverMode` enum, `VipGiftItem` model; modify `VipGiftOption`, `ProductSKU` |
| Create | `backend/prisma/migrations/<timestamp>_vip_gift_multi_sku/migration.sql` | Schema migration + data migration |
| Modify | `backend/src/modules/admin/vip-gift/vip-gift.dto.ts` | New multi-item DTOs |
| Modify | `backend/src/modules/admin/vip-gift/vip-gift.service.ts` | Multi-item CRUD, validation, price calculation |
| Modify | `backend/src/modules/admin/vip-gift/vip-gift.controller.ts` | Minor signature adjustments |
| Modify | `backend/src/modules/bonus/bonus.service.ts` | `getVipGiftOptions` multi-item response + `activateVipAfterPayment` signature |
| Modify | `backend/src/modules/bonus/bonus.controller.ts` | No changes expected (verify only) |
| Modify | `backend/src/modules/order/checkout.service.ts` | Multi-item stock validation, inventory reservation, snapshot |
| Modify | `backend/src/modules/admin/reward-product/reward-product.service.ts` | Update SKU reference queries from VipGiftOption to VipGiftItem |
| Modify | `backend/prisma/seed.ts` | Update VipGiftOption seed data for new items structure |
| Modify | `admin/src/api/vip-gifts.ts` | Updated TypeScript types and API input shapes |
| Modify | `admin/src/pages/vip-gifts/index.tsx` | Form.List multi-item editor, cover mode selector, updated columns |
| Modify | `src/types/domain/Bonus.ts` | Updated `VipGiftOption` interface |
| Modify | `src/store/useCheckoutStore.ts` | Updated `VipPackageSelection` interface |
| Modify | `src/repos/BonusRepo.ts` | No changes expected (verify only) |
| Modify | `app/vip/gifts.tsx` | Multi-item gift card display, cover mode rendering |
| Modify | `app/checkout.tsx` | Update VIP checkout validation (remove giftSkuId check) |

---

### Task 1: Prisma Schema — Add CoverMode Enum and VipGiftItem Model

**Files:**
- Modify: `backend/prisma/schema.prisma` (lines 271-287 enums area, lines 1031-1052 ProductSKU, lines 2167-2182 VipGiftOption)

- [ ] **Step 1: Add CoverMode enum**

After the existing `VipGiftOptionStatus` enum (~line 287), add:

```prisma
enum CoverMode {
  AUTO_GRID      // 宫格拼图（默认）
  AUTO_DIAGONAL  // 对角线分割
  AUTO_STACKED   // 层叠卡片
  CUSTOM         // 自定义上传
}
```

- [ ] **Step 2: Add VipGiftItem model**

After the `VipGiftOption` model, add:

```prisma
model VipGiftItem {
  id           String        @id @default(cuid())
  giftOptionId String
  giftOption   VipGiftOption @relation(fields: [giftOptionId], references: [id], onDelete: Cascade)
  skuId        String
  sku          ProductSKU    @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity     Int           @default(1)
  sortOrder    Int           @default(0)
  createdAt    DateTime      @default(now())

  @@unique([giftOptionId, skuId])
  @@index([giftOptionId])
}
```

- [ ] **Step 3: Modify VipGiftOption model**

Replace the existing `VipGiftOption` model with:

```prisma
model VipGiftOption {
  id        String              @id @default(cuid())
  title     String              // 方案标题
  subtitle  String?             // 副标题
  coverMode CoverMode           @default(AUTO_GRID) // 封面拼合样式
  coverUrl  String?             // 仅 CUSTOM 模式使用
  badge     String?             // 前台标签
  sortOrder Int                 @default(0)
  status    VipGiftOptionStatus @default(ACTIVE)
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt
  items     VipGiftItem[]       // 组合商品列表

  @@index([status, sortOrder])
}
```

Key changes: removed `skuId`, `sku` relation, `marketPrice`; added `coverMode`, `items`.

- [ ] **Step 4: Update ProductSKU reverse relation**

In the `ProductSKU` model (~line 1051), replace:
```prisma
  vipGiftOptions    VipGiftOption[]
```
with:
```prisma
  vipGiftItems      VipGiftItem[]
```

- [ ] **Step 5: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: "Your schema is valid."

- [ ] **Step 6: Generate and customize migration**

Run: `cd backend && npx prisma migrate dev --name vip_gift_multi_sku --create-only`

Then edit the generated `migration.sql` to add the data migration step. Between the CREATE TABLE and the DROP COLUMN steps, insert:

```sql
-- Migrate existing single-SKU data to VipGiftItem rows
INSERT INTO "VipGiftItem" ("id", "giftOptionId", "skuId", "quantity", "sortOrder", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "skuId",
  1,
  0,
  NOW()
FROM "VipGiftOption"
WHERE "skuId" IS NOT NULL;
```

Ensure the DROP COLUMN for `skuId` and `marketPrice` comes AFTER this INSERT.

- [ ] **Step 7: Apply migration**

Run: `cd backend && npx prisma migrate dev`
Expected: migration applies without errors.

- [ ] **Step 8: Verify Prisma Client regenerated**

Run: `cd backend && npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(prisma): add VipGiftItem model and CoverMode enum for multi-SKU gift combos"
```

---

### Task 2: Backend DTOs — Multi-Item Validation

**Files:**
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.dto.ts` (102 lines total)

- [ ] **Step 1: Rewrite the DTO file**

Replace entire contents of `vip-gift.dto.ts`:

```typescript
import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VipGiftOptionStatus, CoverMode } from '@prisma/client';

export class VipGiftItemDto {
  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateVipGiftOptionDto {
  @IsString()
  @MaxLength(60)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  badge?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus)
  status?: VipGiftOptionStatus;

  @IsOptional()
  @IsEnum(CoverMode)
  coverMode?: CoverMode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coverUrl?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VipGiftItemDto)
  items: VipGiftItemDto[];
}

export class UpdateVipGiftOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  badge?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus)
  status?: VipGiftOptionStatus;

  @IsOptional()
  @IsEnum(CoverMode)
  coverMode?: CoverMode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VipGiftItemDto)
  items?: VipGiftItemDto[];
}

export class UpdateVipGiftOptionStatusDto {
  @IsEnum(VipGiftOptionStatus)
  status: VipGiftOptionStatus;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/admin/vip-gift/vip-gift.dto.ts
git commit -m "feat(vip-gift): update DTOs for multi-item gift combos"
```

---

### Task 3: Backend Admin Service — Multi-Item CRUD

**Files:**
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.service.ts` (247 lines)

- [ ] **Step 1: Rewrite vip-gift.service.ts**

Replace entire file. Key changes from the existing implementation:

1. **`findAll()`**: Include `items` with nested `sku.product`, compute `totalPrice` per option
2. **`findOne()`**: Same nested includes
3. **`create()`**: Transaction — create VipGiftOption + batch create VipGiftItems; validate all SKUs; clear coverUrl if not CUSTOM
4. **`update()`**: Transaction — update option fields; if `items` provided, delete all existing items + recreate; re-validate SKUs; clear coverUrl if coverMode != CUSTOM
5. **`delete()`**: Cascade handles items automatically
6. **`getSkuReferences()`**: Query VipGiftItem table instead of VipGiftOption.skuId
7. **`validateItemSkus()`**: New method — validates all SKU IDs in items array belong to platform, are ACTIVE, and no duplicates

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { CoverMode, VipGiftOptionStatus } from '@prisma/client';
import {
  CreateVipGiftOptionDto,
  UpdateVipGiftOptionDto,
} from './vip-gift.dto';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';

const ITEMS_INCLUDE = {
  items: {
    include: {
      sku: {
        include: {
          product: { select: { id: true, title: true, media: true, status: true } },
        },
      },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
};

@Injectable()
export class VipGiftService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  async findAll(
    page = 1,
    pageSize = 20,
    status?: VipGiftOptionStatus,
  ) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.vipGiftOption.findMany({
        where,
        include: ITEMS_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.vipGiftOption.count({ where }),
    ]);

    const vipConfig = await this.bonusConfig.getVipConfig();
    const vipPrice = vipConfig.vipPrice ?? 399;

    const enriched = items.map((opt) => ({
      ...opt,
      totalPrice: opt.items.reduce(
        (sum, item) => sum + item.sku.price * item.quantity,
        0,
      ),
    }));

    return { items: enriched, total, page, pageSize, vipPrice };
  }

  async findOne(id: string) {
    const option = await this.prisma.vipGiftOption.findUnique({
      where: { id },
      include: ITEMS_INCLUDE,
    });
    if (!option) throw new NotFoundException('赠品方案不存在');

    return {
      ...option,
      totalPrice: option.items.reduce(
        (sum, item) => sum + item.sku.price * item.quantity,
        0,
      ),
    };
  }

  async create(dto: CreateVipGiftOptionDto) {
    // 校验所有 SKU
    await this.validateItemSkus(dto.items.map((i) => i.skuId));

    // 检查 items 内 skuId 不重复
    const skuIds = dto.items.map((i) => i.skuId);
    if (new Set(skuIds).size !== skuIds.length) {
      throw new BadRequestException('组合内商品规格不能重复');
    }

    // CUSTOM 模式必须提供 coverUrl
    const coverMode = dto.coverMode ?? CoverMode.AUTO_GRID;
    if (coverMode === CoverMode.CUSTOM && !dto.coverUrl) {
      throw new BadRequestException('自定义封面模式必须上传封面图');
    }

    return this.prisma.vipGiftOption.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        badge: dto.badge,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? VipGiftOptionStatus.ACTIVE,
        coverMode,
        coverUrl: coverMode === CoverMode.CUSTOM ? dto.coverUrl : null,
        items: {
          create: dto.items.map((item, idx) => ({
            skuId: item.skuId,
            quantity: item.quantity,
            sortOrder: item.sortOrder ?? idx,
          })),
        },
      },
      include: ITEMS_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateVipGiftOptionDto) {
    const existing = await this.prisma.vipGiftOption.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('赠品方案不存在');

    // 确定 coverMode
    const coverMode = dto.coverMode ?? existing.coverMode;
    if (coverMode === CoverMode.CUSTOM && dto.coverMode === CoverMode.CUSTOM && !dto.coverUrl && !existing.coverUrl) {
      throw new BadRequestException('自定义封面模式必须上传封面图');
    }

    // 如果提供了 items，校验
    if (dto.items) {
      await this.validateItemSkus(dto.items.map((i) => i.skuId));
      const skuIds = dto.items.map((i) => i.skuId);
      if (new Set(skuIds).size !== skuIds.length) {
        throw new BadRequestException('组合内商品规格不能重复');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 如果传了 items，先删后建
      if (dto.items) {
        await tx.vipGiftItem.deleteMany({ where: { giftOptionId: id } });
        await tx.vipGiftItem.createMany({
          data: dto.items.map((item, idx) => ({
            giftOptionId: id,
            skuId: item.skuId,
            quantity: item.quantity,
            sortOrder: item.sortOrder ?? idx,
          })),
        });
      }

      return tx.vipGiftOption.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
          ...(dto.badge !== undefined && { badge: dto.badge }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.coverMode !== undefined && { coverMode: dto.coverMode }),
          coverUrl: coverMode === CoverMode.CUSTOM
            ? (dto.coverUrl ?? existing.coverUrl)
            : null,
        },
        include: ITEMS_INCLUDE,
      });
    });
  }

  async updateStatus(id: string, status: VipGiftOptionStatus) {
    const existing = await this.prisma.vipGiftOption.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('赠品方案不存在');

    return this.prisma.vipGiftOption.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.vipGiftOption.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('赠品方案不存在');

    // items 通过 onDelete: Cascade 自动删除
    await this.prisma.vipGiftOption.delete({ where: { id } });
    return { ok: true };
  }

  async getRewardProductSkus(productId?: string) {
    const where: any = {
      status: 'ACTIVE',
      product: {
        status: 'ACTIVE',
        company: { isPlatform: true },
      },
    };
    if (productId) where.productId = productId;

    return this.prisma.productSKU.findMany({
      where,
      include: {
        product: { select: { id: true, title: true, media: true } },
      },
      take: 100,
    });
  }

  async getSkuReferences(skuId: string) {
    const [vipGiftItems, lotteryPrizes] = await Promise.all([
      this.prisma.vipGiftItem.findMany({
        where: { skuId, giftOption: { status: 'ACTIVE' } },
        include: {
          giftOption: { select: { id: true, title: true, status: true } },
        },
      }),
      this.prisma.lotteryPrize.findMany({
        where: { skuId },
        select: { id: true, name: true },
      }),
    ]);

    // 去重父级 VipGiftOption
    const uniqueOptions = new Map<string, any>();
    for (const item of vipGiftItems) {
      uniqueOptions.set(item.giftOption.id, item.giftOption);
    }

    return {
      vipGiftOptions: Array.from(uniqueOptions.values()),
      lotteryPrizes,
      totalReferences: uniqueOptions.size + lotteryPrizes.length,
    };
  }

  /** 校验所有 SKU 属于平台公司且为 ACTIVE 状态 */
  private async validateItemSkus(skuIds: string[]) {
    for (const skuId of skuIds) {
      const sku = await this.prisma.productSKU.findUnique({
        where: { id: skuId },
        include: {
          product: {
            include: { company: { select: { isPlatform: true } } },
          },
        },
      });

      if (!sku) {
        throw new BadRequestException(`商品规格 ${skuId} 不存在`);
      }
      if (!sku.product.company?.isPlatform) {
        throw new BadRequestException(
          `商品「${sku.product.title}」不属于平台奖励商品`,
        );
      }
      if (sku.product.status !== 'ACTIVE') {
        throw new BadRequestException(
          `商品「${sku.product.title}」未上架`,
        );
      }
      if (sku.status !== 'ACTIVE') {
        throw new BadRequestException(
          `商品规格「${sku.title}」未上架`,
        );
      }
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/admin/vip-gift/vip-gift.service.ts
git commit -m "feat(vip-gift): rewrite admin service for multi-item gift combos"
```

---

### Task 4: Backend Admin Controller — Signature Adjustments

**Files:**
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.controller.ts` (124 lines)

- [ ] **Step 1: Update controller**

The controller needs minimal changes — the service interface changed but the route shapes stay similar. Read the current file and verify all method calls match the updated service signatures. Key change: `create()` and `update()` now pass DTOs that include `items[]` instead of `skuId`.

No structural change to routes. Verify the controller still passes `CreateVipGiftOptionDto` and `UpdateVipGiftOptionDto` to service methods (it already does — the DTO class names didn't change, only their contents).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit (if changes were made)**

```bash
git add backend/src/modules/admin/vip-gift/vip-gift.controller.ts
git commit -m "fix(vip-gift): adjust controller for updated service signatures"
```

---

### Task 5: Backend Buyer-Side — Bonus Service getVipGiftOptions

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts` (lines 404-457 `getVipGiftOptions` method)

- [ ] **Step 1: Update getVipGiftOptions method**

Replace the `getVipGiftOptions` method (~lines 404-457). The new version queries `items` with nested SKU/product and computes `totalPrice` and `available` per option:

```typescript
async getVipGiftOptions() {
  const options = await this.prisma.vipGiftOption.findMany({
    where: { status: 'ACTIVE' },
    include: {
      items: {
        include: {
          sku: {
            include: {
              product: { select: { id: true, title: true, media: true, status: true } },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });

  const vipPrice = await this.bonusConfig.getNumber('VIP_PRICE', 399);

  const enriched = options.map((opt) => {
    const totalPrice = opt.items.reduce(
      (sum, item) => sum + item.sku.price * item.quantity,
      0,
    );
    const available = opt.items.every(
      (item) =>
        item.sku.status === 'ACTIVE' &&
        item.sku.product.status === 'ACTIVE' &&
        item.sku.stock >= item.quantity,
    );

    return {
      id: opt.id,
      title: opt.title,
      subtitle: opt.subtitle,
      badge: opt.badge,
      coverMode: opt.coverMode,
      coverUrl: opt.coverUrl,
      totalPrice,
      available,
      items: opt.items.map((item) => ({
        skuId: item.sku.id,
        productTitle: item.sku.product.title,
        productImage: (item.sku.product.media as any[])?.[0]?.url ?? null,
        skuTitle: item.sku.title,
        price: item.sku.price,
        quantity: item.quantity,
      })),
    };
  });

  return { options: enriched, vipPrice };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts
git commit -m "feat(bonus): update getVipGiftOptions for multi-item response"
```

---

### Task 6: Backend — VIP Activation Flow

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts` (lines 198-275 `activateVipAfterPayment` method)

- [ ] **Step 1: Update activateVipAfterPayment signature and body**

Change the method signature to remove `giftSkuId` parameter. Update the VipPurchase write to set `giftSkuId: null` for new records:

Old signature (~line 198):
```typescript
async activateVipAfterPayment(
  userId: string,
  orderId: string,
  giftOptionId: string,
  giftSkuId: string,
  amount: number,
  giftSnapshot: Record<string, any>,
)
```

New signature:
```typescript
async activateVipAfterPayment(
  userId: string,
  orderId: string,
  giftOptionId: string,
  amount: number,
  giftSnapshot: Record<string, any>,
)
```

In the VipPurchase upsert/create data block, change:
```typescript
giftSkuId: giftSkuId,
```
to:
```typescript
giftSkuId: null,
```

- [ ] **Step 2: Find and update all callers of activateVipAfterPayment**

Search for all call sites (should be in `checkout.service.ts` payment callback area). Update to remove the `giftSkuId` argument. This will be finalized in Task 7.

- [ ] **Step 3: Do NOT commit yet** — Task 7 modifies the caller (checkout.service.ts). These two tasks must be committed together to avoid a broken intermediate state.

---

### Task 7: Backend — Checkout Service Multi-Item Support

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts` (lines 670-870 VIP checkout area)

- [ ] **Step 1: Read checkout.service.ts VIP section**

Read lines 670-870 to understand the full VIP checkout flow. Key areas to change:
- Gift option query (currently reads `giftOption.skuId`, `giftOption.sku`)
- Stock validation (single SKU → multi-item)
- `itemsSnapshot` construction (single item → array of items)
- `bizMeta` construction (remove `giftSkuId`, add `giftOptionId` + `itemCount`)
- Inventory reservation (single RESERVE → per-item RESERVE)
- Payment callback `activateVipAfterPayment` call (remove `giftSkuId` arg)

- [ ] **Step 2: Update gift option query**

Change the `findUnique` to include `items` with nested SKU/product instead of direct `sku`:

```typescript
const giftOption = await this.prisma.vipGiftOption.findUnique({
  where: { id: giftOptionId },
  include: {
    items: {
      include: {
        sku: {
          include: {
            product: {
              select: { id: true, title: true, media: true, status: true, companyId: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    },
  },
});
```

- [ ] **Step 3: Update stock validation**

Replace single-SKU checks with per-item loop:

```typescript
if (!giftOption || giftOption.status !== 'ACTIVE') {
  throw new BadRequestException('赠品方案不可用');
}
if (giftOption.items.length === 0) {
  throw new BadRequestException('赠品方案无商品');
}
for (const item of giftOption.items) {
  if (item.sku.status !== 'ACTIVE' || item.sku.product.status !== 'ACTIVE') {
    throw new BadRequestException(`商品「${item.sku.product.title}」已下架`);
  }
  if (item.sku.stock < item.quantity) {
    throw new BadRequestException(`商品「${item.sku.product.title}」库存不足`);
  }
}
```

- [ ] **Step 4: Update itemsSnapshot construction**

Replace single-item snapshot with multi-item array:

```typescript
const itemsSnapshot = giftOption.items.map((item) => ({
  skuId: item.sku.id,
  productId: item.sku.product.id,
  title: item.sku.product.title,
  skuTitle: item.sku.title,
  image: (item.sku.product.media as any[])?.[0]?.url ?? null,
  unitPrice: item.sku.price,
  quantity: item.quantity,
  isPrize: false,
}));
```

- [ ] **Step 5: Update bizMeta**

```typescript
const bizMeta = {
  type: 'VIP_PACKAGE',
  vipGiftOptionId: giftOption.id,
  giftTitle: giftOption.title,
  giftCoverMode: giftOption.coverMode,
  giftCoverUrl: giftOption.coverUrl,
  giftBadge: giftOption.badge,
  itemCount: giftOption.items.length,
  snapshotPrice: vipPrice,
};
```

- [ ] **Step 6: Update inventory reservation to per-item**

Replace single RESERVE with per-item loop. **Must preserve CAS (Compare-And-Swap) pattern for concurrency safety:**

```typescript
for (const item of giftOption.items) {
  // CAS: 只有库存充足时才扣减，防止并发超卖
  const updated = await tx.productSKU.updateMany({
    where: { id: item.sku.id, stock: { gte: item.quantity } },
    data: { stock: { decrement: item.quantity } },
  });
  if (updated.count === 0) {
    throw new BadRequestException(`商品「${item.sku.product.title}」库存不足`);
  }

  await tx.inventoryLedger.create({
    data: {
      skuId: item.sku.id,
      type: 'RESERVE',
      qty: -item.quantity,
      refId: checkoutSession.id,
      refType: 'CHECKOUT_SESSION',
    },
  });
}
```

**Important:** Use `qty`/`refId`/`refType` (not `delta`/`referenceId`/`referenceType`) — these are the actual InventoryLedger field names. Keep `refType: 'CHECKOUT_SESSION'` to match `releaseVipReservation` logic.

- [ ] **Step 7: Update payment callback to build new giftSnapshot**

In the payment callback section, construct the new-format giftSnapshot from `itemsSnapshot` (converting field names to match spec format), and call `activateVipAfterPayment` without `giftSkuId`:

```typescript
// 将 itemsSnapshot 格式转换为 giftSnapshot.items 格式
const giftItems = (order.itemsSnapshot as any[]).map((snap) => ({
  skuId: snap.skuId,
  skuTitle: snap.skuTitle,
  productTitle: snap.title,
  productImage: snap.image,
  price: snap.unitPrice,
  quantity: snap.quantity,
}));

const giftSnapshot = {
  title: bizMeta.giftTitle,
  coverMode: bizMeta.giftCoverMode,
  coverUrl: bizMeta.giftCoverUrl,
  badge: bizMeta.giftBadge,
  items: giftItems,
};

await this.bonusService.activateVipAfterPayment(
  order.userId,
  order.id,
  bizMeta.vipGiftOptionId,
  order.amount,
  giftSnapshot,
);
```

- [ ] **Step 8: Update bizMeta validation in payment callback**

Change `if (!bizMeta.giftSkuId)` check to `if (!bizMeta.vipGiftOptionId)`.

- [ ] **Step 9: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 10: Commit (includes Task 6 changes)**

```bash
git add backend/src/modules/bonus/bonus.service.ts backend/src/modules/order/checkout.service.ts
git commit -m "feat(checkout+bonus): multi-item VIP gift checkout, activation, and inventory reservation"
```

---

### Task 8: Admin Frontend — API Types

**Files:**
- Modify: `admin/src/api/vip-gifts.ts` (112 lines)

- [ ] **Step 1: Rewrite API types and functions**

Replace the type definitions (lines 1-72) with:

```typescript
import client from './client';

export type CoverMode = 'AUTO_GRID' | 'AUTO_DIAGONAL' | 'AUTO_STACKED' | 'CUSTOM';
export type VipGiftOptionStatus = 'ACTIVE' | 'INACTIVE';

export interface VipGiftItemInfo {
  id: string;
  skuId: string;
  quantity: number;
  sortOrder: number;
  sku: {
    id: string;
    title: string;
    price: number;
    stock: number;
    product: {
      id: string;
      title: string;
      media: Array<{ url: string }>;
    };
  };
}

export interface VipGiftOption {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  coverMode: CoverMode;
  coverUrl: string | null;
  sortOrder: number;
  status: VipGiftOptionStatus;
  items: VipGiftItemInfo[];
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface VipGiftItemInput {
  skuId: string;
  quantity: number;
  sortOrder?: number;
}

export interface CreateVipGiftOptionInput {
  title: string;
  subtitle?: string;
  badge?: string;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
  coverMode?: CoverMode;
  coverUrl?: string;
  items: VipGiftItemInput[];
}

export interface UpdateVipGiftOptionInput {
  title?: string;
  subtitle?: string;
  badge?: string;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
  coverMode?: CoverMode;
  coverUrl?: string;
  items?: VipGiftItemInput[];
}

// ... keep existing RewardSkuOption and all API functions unchanged
// (getVipGiftOptions, getVipGiftOption, createVipGiftOption, updateVipGiftOption,
//  updateVipGiftOptionStatus, deleteVipGiftOption, getRewardSkus, getSkuReferences)
```

The API function implementations (lines 73-112) remain the same — only the type shapes changed.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: will have errors in `pages/vip-gifts/index.tsx` (fixed in Task 9)

- [ ] **Step 3: Commit**

```bash
git add admin/src/api/vip-gifts.ts
git commit -m "feat(admin): update VIP gift API types for multi-item combos"
```

---

### Task 9: Admin Frontend — VIP Gifts Page Rewrite

**Files:**
- Modify: `admin/src/pages/vip-gifts/index.tsx` (572 lines)

This is the largest frontend change. The page needs:
1. **ProTable columns**: Replace product/SKU/marketPrice columns with "组合内容" and "组合总价"
2. **Drawer form**: Replace single product/SKU selector with Form.List for multiple items
3. **Cover mode section**: Radio group + upload for CUSTOM mode
4. **Price summary**: Auto-calculated total at bottom of items list

- [ ] **Step 1: Rewrite the VIP gifts page**

Replace the entire `admin/src/pages/vip-gifts/index.tsx` with the new implementation. Key sections:

**Imports**: Add `Form, InputNumber, Radio, Upload, Image` from antd; add `MinusCircleOutlined, PlusOutlined, UploadOutlined` from ant icons.

**State**: Remove `selectedProduct`, `productSkus` single-product state. Add state for tracking product/SKU per item row.

**ProTable columns**:
- "方案标题" (title)
- "组合内容" — render `option.items.map(i => `${i.sku.product.title}×${i.quantity}`).join(', ')`
- "组合总价" — render `option.totalPrice` formatted as ¥
- "标签" (badge)
- "排序值" (sortOrder)
- "状态" (status toggle)
- "操作" (edit, delete)

**Drawer form — items section (Form.List)**:
```tsx
<Form.List name="items" rules={[{ validator: async (_, items) => {
  if (!items || items.length === 0) throw new Error('请至少添加一个商品');
}}]}>
  {(fields, { add, remove }) => (
    <>
      {fields.map((field, index) => (
        <div key={field.key} style={{ background: '#fafafa', borderRadius: 8, padding: 12, marginBottom: 8, position: 'relative' }}>
          {/* Product image thumbnail (from selected SKU) */}
          {/* Product search Select with 400ms debounce */}
          {/* SKU Select (filtered by product) */}
          {/* Quantity InputNumber (min 1, max 99) */}
          {/* Price display: 单价 × 数量 = 小计 */}
          {/* Remove button */}
        </div>
      ))}
      <Button type="dashed" onClick={() => add({ quantity: 1 })} block icon={<PlusOutlined />}>
        添加商品
      </Button>
    </>
  )}
</Form.List>
```

**Drawer form — cover mode section** (visible only when items.length > 1):
```tsx
<Form.Item name="coverMode" label="封面样式">
  <Radio.Group>
    <Radio value="AUTO_GRID">宫格拼图</Radio>
    <Radio value="AUTO_DIAGONAL">对角线分割</Radio>
    <Radio value="AUTO_STACKED">层叠卡片</Radio>
    <Radio value="CUSTOM">自定义上传</Radio>
  </Radio.Group>
</Form.Item>
{/* Conditionally show Upload when coverMode === 'CUSTOM' */}
```

**Price summary**:
```tsx
<div style={{ background: '#f0f7ff', borderRadius: 8, padding: '10px 12px' }}>
  <span>组合总价（自动计算）</span>
  <span style={{ color: '#C9A96E', fontWeight: 700, fontSize: 16 }}>
    ¥{totalPrice.toFixed(2)}
  </span>
</div>
```

**Submit handler**: Construct `CreateVipGiftOptionInput` with `items[]` array from form values.

**Edit handler**: When opening drawer for edit, populate form with existing items (map `option.items` to form field values including product search pre-fill).

NOTE: All UI text must be in Chinese. No English abbreviations visible to admin.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual smoke test**

Run: `cd admin && npm run dev`
Open admin panel → 用户与奖励 → 购买VIP赠品
Verify:
- List loads with "组合内容" and "组合总价" columns
- Drawer opens with Form.List for adding items
- Can add multiple product rows, each with product search → SKU → quantity
- Price auto-sums
- Cover mode radio appears when >1 item
- Submit creates successfully

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/vip-gifts/index.tsx
git commit -m "feat(admin): rewrite VIP gift page with multi-item Form.List editor"
```

---

### Task 10: Buyer App — Types and Store

**Files:**
- Modify: `src/types/domain/Bonus.ts` (lines 134-150)
- Modify: `src/store/useCheckoutStore.ts` (lines 12-18)

- [ ] **Step 1: Update Bonus.ts VipGiftOption type**

Replace the `VipGiftOption` and `VipGiftOptionsResponse` interfaces (~lines 134-150):

```typescript
export type CoverMode = 'AUTO_GRID' | 'AUTO_DIAGONAL' | 'AUTO_STACKED' | 'CUSTOM';

export interface VipGiftItemInfo {
  skuId: string;
  productTitle: string;
  productImage: string | null;
  skuTitle: string;
  price: number;
  quantity: number;
}

export interface VipGiftOption {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  coverMode: CoverMode;
  coverUrl: string | null;
  totalPrice: number;
  available: boolean;
  items: VipGiftItemInfo[];
}

export interface VipGiftOptionsResponse {
  options: VipGiftOption[];
  vipPrice: number;
}
```

- [ ] **Step 2: Update useCheckoutStore.ts VipPackageSelection**

Replace the `VipPackageSelection` interface (~lines 12-18):

```typescript
export interface VipPackageSelection {
  giftOptionId: string;
  title: string;
  coverMode?: string;
  coverUrl?: string;
  totalPrice: number;
  price: number;            // VIP 价格
  items: Array<{
    skuId: string;
    productTitle: string;
    productImage: string | null;
    skuTitle: string;
    price: number;
    quantity: number;
  }>;
}
```

Update the `setVipPackageSelection` references if needed to match new shape.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: will have errors in `app/vip/gifts.tsx` (fixed in Task 11)

- [ ] **Step 4: Commit**

```bash
git add src/types/domain/Bonus.ts src/store/useCheckoutStore.ts
git commit -m "feat(app): update VIP gift types and store for multi-item combos"
```

---

### Task 11: Buyer App — Gift Selection Page

**Files:**
- Modify: `app/vip/gifts.tsx` (892 lines)

- [ ] **Step 1: Update GiftCard component**

In the `GiftCard` component (~lines 155-248), update to display multi-item info:

1. **Cover image**: Instead of `item.coverUrl`, render based on `item.coverMode`:
   - Single item (items.length === 1): show `items[0].productImage`
   - `AUTO_GRID` / `AUTO_DIAGONAL` / `AUTO_STACKED`: render a composite view using product images from `item.items`
   - `CUSTOM`: show `item.coverUrl`

2. **Content summary**: Below title, show item list like `深海大虾×2 + 红酒×1`

3. **Price**: Show `item.totalPrice` instead of `item.marketPrice`

4. **Available check**: Use `item.available` (already computed by backend)

- [ ] **Step 2: Update selection handler**

In the selection handler (~lines 318-324), update to pass the new `VipPackageSelection` shape:

```typescript
setVipPackageSelection({
  giftOptionId: selected.id,
  title: selected.title,
  coverMode: selected.coverMode,
  coverUrl: selected.coverUrl ?? undefined,
  totalPrice: selected.totalPrice,
  price: vipPrice,
  items: selected.items,
});
```

- [ ] **Step 3: Create GiftCoverImage component**

Create a reusable component (inline in the same file or as a helper) that renders the composite cover image based on `coverMode`:

```typescript
function GiftCoverImage({ option }: { option: VipGiftOption }) {
  // Single item — use product image directly
  if (option.items.length === 1) {
    return <Image source={{ uri: option.items[0].productImage }} ... />;
  }
  // CUSTOM — use coverUrl
  if (option.coverMode === 'CUSTOM' && option.coverUrl) {
    return <Image source={{ uri: option.coverUrl }} ... />;
  }
  // AUTO modes — render composite from item images
  const images = option.items.map(i => i.productImage).filter(Boolean);
  switch (option.coverMode) {
    case 'AUTO_GRID': return <GridCover images={images} />;
    case 'AUTO_DIAGONAL': return <DiagonalCover images={images} />;
    case 'AUTO_STACKED': return <StackedCover images={images} />;
    default: return <GridCover images={images} />;
  }
}
```

For AUTO_GRID: Use `View` with flexbox — 2 items side by side, 3 items top-1 + bottom-2, 4 items 2×2, 5+ items first-4 + "+N" badge.

For AUTO_DIAGONAL/AUTO_STACKED: Use absolute positioning with React Native views and appropriate clipping (or simpler: overlapping images with transforms).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/vip/gifts.tsx
git commit -m "feat(app): update VIP gift page for multi-item display with cover modes"
```

---

### Task 12: Backend — Reward Product Service SKU Reference Fix

**Files:**
- Modify: `backend/src/modules/admin/reward-product/reward-product.service.ts`

The `reward-product.service.ts` directly queries `VipGiftOption.skuId` in `getProductReferenceCounts()` and `assertProductNotReferenced()`. After migration, `skuId` no longer exists on `VipGiftOption` — must query via `VipGiftItem`.

- [ ] **Step 1: Read the file and locate the two methods**

Read `reward-product.service.ts` and find:
- `getProductReferenceCounts()` — queries `vipGiftOption.count({ where: { skuId: ... } })`
- `assertProductNotReferenced()` — checks if any `VipGiftOption` references the SKU

- [ ] **Step 2: Update queries to use VipGiftItem**

Replace:
```typescript
// Old: count VipGiftOptions referencing this SKU
this.prisma.vipGiftOption.count({ where: { skuId: { in: skuIds } } })
```
With:
```typescript
// New: count VipGiftItems referencing this SKU
this.prisma.vipGiftItem.count({ where: { skuId: { in: skuIds } } })
```

Apply the same pattern to `assertProductNotReferenced()`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/admin/reward-product/reward-product.service.ts
git commit -m "fix(reward-product): update SKU reference queries for VipGiftItem"
```

---

### Task 13: Buyer App — Checkout Page Fix

**Files:**
- Modify: `app/checkout.tsx` (~line 294)

The checkout page validates `vipPackageSelection.giftSkuId`, which no longer exists on `VipPackageSelection`.

- [ ] **Step 1: Read checkout.tsx and find giftSkuId references**

Search for `giftSkuId` in `app/checkout.tsx`. Replace any validation checks using `giftSkuId` with `giftOptionId`:

```typescript
// Old:
if (!vipPackageSelection.giftSkuId) { ... }

// New:
if (!vipPackageSelection.giftOptionId) { ... }
```

Also update any payload construction that passes `giftSkuId` to the checkout API — replace with `giftOptionId`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/checkout.tsx
git commit -m "fix(app): update VIP checkout validation for multi-item gift"
```

---

### Task 14: Backend — Seed Data Update

**Files:**
- Modify: `backend/prisma/seed.ts` (lines ~2409-2489 VipGiftOption area)

- [ ] **Step 1: Read seed.ts VipGiftOption section**

Find the section that creates `VipGiftOption` records using `skuId`/`marketPrice`.

- [ ] **Step 2: Update to use nested items create**

Replace:
```typescript
await prisma.vipGiftOption.create({
  data: {
    title: '...',
    skuId: 'some-sku-id',
    marketPrice: 199,
    // ...
  },
});
```
With:
```typescript
await prisma.vipGiftOption.create({
  data: {
    title: '...',
    coverMode: 'AUTO_GRID',
    items: {
      create: [
        { skuId: 'some-sku-id', quantity: 1, sortOrder: 0 },
      ],
    },
    // ...
  },
});
```

- [ ] **Step 3: Verify seed runs**

Run: `cd backend && npx prisma db seed`
Expected: seed completes without errors

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "fix(seed): update VipGiftOption seed data for multi-item structure"
```

---

### Task 15: Final Verification and Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Full backend TypeScript check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Full admin frontend TypeScript check**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Full buyer app TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: "Your schema is valid."

- [ ] **Step 5: Search for stale references**

Search codebase for any remaining references to the old single-SKU pattern:
- `giftOption.skuId` (should only exist in VipPurchase compat code)
- `giftOption.sku` (should be gone from VipGiftOption context)
- `giftOption.marketPrice` (should be gone)
- `VipPackageSelection.*giftSkuId` (should be gone)

Fix any stale references found.

- [ ] **Step 6: Update CLAUDE.md**

Add this plan to CLAUDE.md related documents section if not already present.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: cleanup stale references from VIP gift multi-SKU migration"
```
