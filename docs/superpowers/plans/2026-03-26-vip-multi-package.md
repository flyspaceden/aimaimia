# VIP 多档位礼包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand VIP purchase from a single price (399) to multiple configurable price tiers (399/899/1599), each with its own gift options and referral bonus rate.

**Architecture:** New `VipPackage` model sits above `VipGiftOption` as a grouping layer. Each package defines a price and referral bonus rate. Existing gift CRUD gains a `packageId` foreign key. Checkout reads price from VipPackage instead of global config. Referral bonus changes from fixed amount to `amount × rate`.

**Tech Stack:** Prisma + PostgreSQL / NestJS / React (Ant Design admin) / React Native (Expo buyer app)

**Spec:** `docs/superpowers/specs/2026-03-26-vip-multi-package-design.md`

---

### Task 1: Schema — Add VipPackage model and update related models

**Files:**
- Modify: `backend/prisma/schema.prisma:276-279` (after VipGiftOptionStatus enum)
- Modify: `backend/prisma/schema.prisma:1634-1654` (VipPurchase model)
- Modify: `backend/prisma/schema.prisma:2200-2214` (VipGiftOption model)

- [ ] **Step 1: Add VipPackage model after the VipGiftOptionStatus enum (line 279)**

Insert after line 279 (`INACTIVE  // 下架，前台不可选` closing brace):

```prisma
model VipPackage {
  id                String              @id @default(cuid())
  price             Float               // 档位价格（元），如 399 / 899 / 1599
  referralBonusRate Float               @default(0.15) // 推荐奖励比例，0.15 = 15%
  sortOrder         Int                 @default(0)
  status            VipGiftOptionStatus @default(ACTIVE) // 复用 ACTIVE/INACTIVE
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  giftOptions       VipGiftOption[]

  @@index([status, sortOrder])
}
```

- [ ] **Step 2: Add packageId to VipGiftOption model (line 2200-2214)**

Add `packageId` field and relation, update index:

```prisma
model VipGiftOption {
  id        String              @id @default(cuid())
  title     String
  subtitle  String?
  coverMode CoverMode           @default(AUTO_GRID)
  coverUrl  String?
  badge     String?
  sortOrder Int                 @default(0)
  status    VipGiftOptionStatus @default(ACTIVE)
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt
  items     VipGiftItem[]

  // 所属档位
  packageId String
  package   VipPackage @relation(fields: [packageId], references: [id], onDelete: Restrict)

  @@index([packageId, status, sortOrder])
}
```

- [ ] **Step 3: Add packageId and referralBonusRate to VipPurchase (line 1634-1654)**

Add two fields before `createdAt`:

```prisma
model VipPurchase {
  id               String              @id @default(cuid())
  userId           String              @unique
  user             User                @relation(fields: [userId], references: [id])
  orderId          String?             @unique
  order            Order?              @relation(fields: [orderId], references: [id])
  amount           Float               @default(399.00)
  status           VipPurchaseStatus   @default(PAID)

  // VIP 赠品快照
  giftOptionId     String?
  giftSkuId        String?
  giftSnapshot     Json?

  // 档位快照
  packageId         String?
  referralBonusRate Float?             // 购买时快照的推荐奖励比例

  // 来源与激活状态
  source           String?
  activationStatus VipActivationStatus @default(SUCCESS)
  activationError  String?

  createdAt        DateTime            @default(now())
}
```

- [ ] **Step 4: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: "✔ Your schema is valid"

- [ ] **Step 5: Create migration**

Run: `cd backend && npx prisma migrate dev --name add_vip_package_model`

This will:
1. Create `VipPackage` table
2. Add `packageId` column to `VipGiftOption` (will need data backfill — see Task 2)
3. Add `packageId` + `referralBonusRate` columns to `VipPurchase`

Note: The migration will fail if existing VipGiftOption rows lack a packageId. We handle this in Task 2 with a two-step approach: first make packageId optional, migrate, backfill, then make it required.

**Alternative approach if migration fails:** Temporarily make `packageId` optional on VipGiftOption (`String?`), run migration, backfill in Task 2, then change to required and run another migration.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add VipPackage model for multi-tier VIP pricing"
```

---

### Task 2: Seed data — Create default VipPackages and backfill existing data

**Files:**
- Modify: `backend/prisma/seed.ts:1315-1316` (VIP_PRICE / VIP_REFERRAL_BONUS config)
- Modify: `backend/prisma/seed.ts:2409-2495` (vipGiftOptions section)

- [ ] **Step 1: Add VipPackage seed data before the vipGiftOptions section**

Insert before line 2406 (`// VIP 赠品方案`):

```typescript
  // ============================================================
  // VIP 档位（VipPackage）
  // ============================================================
  const vipPackages = [
    { id: 'vpkg-001', price: 399, referralBonusRate: 0.15, sortOrder: 0, status: 'ACTIVE' as const },
    { id: 'vpkg-002', price: 899, referralBonusRate: 0.15, sortOrder: 1, status: 'ACTIVE' as const },
    { id: 'vpkg-003', price: 1599, referralBonusRate: 0.15, sortOrder: 2, status: 'ACTIVE' as const },
  ];

  for (const pkg of vipPackages) {
    await prisma.vipPackage.upsert({
      where: { id: pkg.id },
      update: {},
      create: pkg,
    });
  }
  console.log(`✅ ${vipPackages.length} 个VIP档位已创建`);
```

- [ ] **Step 2: Add packageId to each vipGiftOption (all default to vpkg-001)**

Update each gift option object in the `vipGiftOptions` array to include `packageId: 'vpkg-001'`:

```typescript
  const vipGiftOptions = [
    {
      id: 'vgo-001',
      title: '普洱茶饼·生茶',
      subtitle: '云南古树普洱 357g 生茶饼',
      coverMode: 'AUTO_GRID' as const,
      badge: '臻选',
      sortOrder: 0,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-001a', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-002',
      title: '五常大米 10kg 家庭装',
      subtitle: '有机稻花香 真空锁鲜',
      coverMode: 'AUTO_GRID' as const,
      badge: '热销',
      sortOrder: 1,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-002b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-003',
      title: '阿克苏冰糖心苹果 10斤',
      subtitle: '新疆产地直发 特大果',
      coverMode: 'AUTO_GRID' as const,
      badge: '鲜品',
      sortOrder: 2,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-003b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-004',
      title: '赣南脐橙 10斤礼盒',
      subtitle: '当季甜橙 甜度≥13°',
      coverMode: 'AUTO_GRID' as const,
      badge: '应季',
      sortOrder: 3,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-004', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-005',
      title: '茅台镇酱香白酒双瓶装',
      subtitle: '53度坤沙酒 500ml×2 礼盒',
      coverMode: 'AUTO_GRID' as const,
      badge: '尊享',
      sortOrder: 4,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-005b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-006',
      title: '长白山野生蜂蜜',
      subtitle: '椴树原蜜 无添加 1000g',
      coverMode: 'AUTO_GRID' as const,
      badge: null as string | null,
      sortOrder: 5,
      status: 'ACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-006', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-007',
      title: '普洱茶饼·熟茶（已下架）',
      subtitle: '云南古树普洱 357g 熟茶饼',
      coverMode: 'AUTO_GRID' as const,
      badge: null as string | null,
      sortOrder: 99,
      status: 'INACTIVE' as const,
      packageId: 'vpkg-001',
      items: [{ skuId: 'sku-vip-001b', quantity: 1, sortOrder: 0 }],
    },
  ];
```

- [ ] **Step 3: Remove VIP_PRICE and VIP_REFERRAL_BONUS from ruleConfigs seed (lines 1315-1316)**

Delete these two lines from the `ruleConfigs` array:
```typescript
    { key: 'VIP_PRICE', value: 399.0, desc: 'VIP 礼包价格（元）' },
    { key: 'VIP_REFERRAL_BONUS', value: 50.0, desc: 'VIP 推荐奖励金额（元）' },
```

- [ ] **Step 4: Run seed to verify**

Run: `cd backend && npx prisma db seed`
Expected: Console output includes "✅ 3 个VIP档位已创建" and "✅ 7 个VIP赠品方案已创建"

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(seed): add VipPackage seed data, link gifts to packages"
```

---

### Task 3: Backend — VipPackage admin CRUD

**Files:**
- Create: `backend/src/modules/admin/vip-package/vip-package.dto.ts`
- Create: `backend/src/modules/admin/vip-package/vip-package.service.ts`
- Create: `backend/src/modules/admin/vip-package/vip-package.controller.ts`
- Create: `backend/src/modules/admin/vip-package/vip-package.module.ts`
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.module.ts` (import VipPackageModule)

- [ ] **Step 1: Create VipPackage DTO**

Create `backend/src/modules/admin/vip-package/vip-package.dto.ts`:

```typescript
import {
  IsNumber,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VipGiftOptionStatus } from '@prisma/client';

export class CreateVipPackageDto {
  @Type(() => Number)
  @IsNumber({}, { message: '价格必须为数字' })
  @Min(0.01, { message: '价格不能小于 0.01' })
  @Max(99999, { message: '价格不能超过 99999' })
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '推荐奖励比例必须为数字' })
  @Min(0, { message: '推荐奖励比例不能小于 0' })
  @Max(1, { message: '推荐奖励比例不能超过 1' })
  referralBonusRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;
}

export class UpdateVipPackageDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '价格必须为数字' })
  @Min(0.01, { message: '价格不能小于 0.01' })
  @Max(99999, { message: '价格不能超过 99999' })
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '推荐奖励比例必须为数字' })
  @Min(0, { message: '推荐奖励比例不能小于 0' })
  @Max(1, { message: '推荐奖励比例不能超过 1' })
  referralBonusRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;
}
```

- [ ] **Step 2: Create VipPackage Service**

Create `backend/src/modules/admin/vip-package/vip-package.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateVipPackageDto, UpdateVipPackageDto } from './vip-package.dto';

@Injectable()
export class VipPackageService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.vipPackage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      include: {
        _count: { select: { giftOptions: true } },
      },
    });
  }

  async create(dto: CreateVipPackageDto) {
    return this.prisma.vipPackage.create({
      data: {
        price: dto.price,
        referralBonusRate: dto.referralBonusRate ?? 0.15,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? 'ACTIVE',
      },
    });
  }

  async update(id: string, dto: UpdateVipPackageDto) {
    await this.ensureExists(id);
    return this.prisma.vipPackage.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const pkg = await this.prisma.vipPackage.findUnique({
      where: { id },
      include: { _count: { select: { giftOptions: true } } },
    });
    if (!pkg) throw new BadRequestException('档位不存在');
    if (pkg._count.giftOptions > 0) {
      throw new BadRequestException(
        `该档位下还有 ${pkg._count.giftOptions} 个赠品方案，请先移除或转移`,
      );
    }
    return this.prisma.vipPackage.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const pkg = await this.prisma.vipPackage.findUnique({ where: { id } });
    if (!pkg) throw new BadRequestException('档位不存在');
    return pkg;
  }
}
```

- [ ] **Step 3: Create VipPackage Controller**

Create `backend/src/modules/admin/vip-package/vip-package.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { PermissionGuard } from '../common/permission.guard';
import { Permission } from '../common/permission.decorator';
import { AuditLog } from '../audit/audit-log.decorator';
import { VipPackageService } from './vip-package.service';
import { CreateVipPackageDto, UpdateVipPackageDto } from './vip-package.dto';

@Controller('admin/vip/packages')
@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
export class VipPackageController {
  constructor(private service: VipPackageService) {}

  @Get()
  @Permission('config:read')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Permission('config:update')
  @AuditLog('创建 VIP 档位')
  create(@Body() dto: CreateVipPackageDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Permission('config:update')
  @AuditLog('更新 VIP 档位')
  update(@Param('id') id: string, @Body() dto: UpdateVipPackageDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Permission('config:update')
  @AuditLog('删除 VIP 档位')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: Create VipPackage Module**

Create `backend/src/modules/admin/vip-package/vip-package.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { VipPackageController } from './vip-package.controller';
import { VipPackageService } from './vip-package.service';

@Module({
  controllers: [VipPackageController],
  providers: [VipPackageService],
  exports: [VipPackageService],
})
export class VipPackageModule {}
```

- [ ] **Step 5: Register VipPackageModule in the admin module**

Find the admin parent module (check `backend/src/modules/admin/` for the root admin module that imports VipGiftModule) and add `VipPackageModule` to its imports.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin/vip-package/
git commit -m "feat(admin): add VipPackage CRUD for multi-tier VIP pricing"
```

---

### Task 4: Backend — Update VipGiftOption to require packageId

**Files:**
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.dto.ts:34-74` (CreateVipGiftOptionDto)
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.dto.ts:77-119` (UpdateVipGiftOptionDto)
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.service.ts` (findAll, create, update)
- Modify: `backend/src/modules/admin/vip-gift/vip-gift.controller.ts` (findAll query params)

- [ ] **Step 1: Add packageId to CreateVipGiftOptionDto**

In `backend/src/modules/admin/vip-gift/vip-gift.dto.ts`, add to `CreateVipGiftOptionDto` (before `title`):

```typescript
  @IsString({ message: '档位 ID 必须为字符串' })
  packageId: string;
```

Add `IsString` to the existing import from `class-validator` if not present (it already is).

- [ ] **Step 2: Add packageId to UpdateVipGiftOptionDto**

In the same file, add to `UpdateVipGiftOptionDto`:

```typescript
  @IsOptional()
  @IsString({ message: '档位 ID 必须为字符串' })
  packageId?: string;
```

- [ ] **Step 3: Update VipGiftService to handle packageId**

In `backend/src/modules/admin/vip-gift/vip-gift.service.ts`:

- In `findAll()`: Add optional `packageId` filter parameter. If provided, add `where: { packageId }` to the query. Also include `packageId` and `package: { select: { id: true, price: true } }` in the select.

- In `create()`: Include `packageId` in the create data. Validate that the referenced VipPackage exists and is ACTIVE.

- In `update()`: If `packageId` is provided, validate it exists and is ACTIVE, then update the field.

- [ ] **Step 4: Update VipGiftController to accept packageId filter**

In `backend/src/modules/admin/vip-gift/vip-gift.controller.ts`, update `findAll` to accept `@Query('packageId') packageId?: string` and pass it to the service.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/admin/vip-gift/
git commit -m "feat(admin): add packageId to VipGiftOption CRUD"
```

---

### Task 5: Backend — Update buyer-facing VIP gift options API

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts:402-484` (getVipGiftOptions method)
- Modify: `src/types/domain/Bonus.ts:147-163` (buyer app types)
- Modify: `src/repos/BonusRepo.ts:182-215` (buyer app repo)

- [ ] **Step 1: Rewrite getVipGiftOptions in bonus.service.ts**

Replace the current `getVipGiftOptions()` method (lines 402-484) with:

```typescript
  /** 获取 VIP 档位列表及各档位赠品方案（前台） */
  async getVipGiftOptions() {
    const packages = await this.prisma.vipPackage.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      select: {
        id: true,
        price: true,
        sortOrder: true,
        giftOptions: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            subtitle: true,
            coverMode: true,
            coverUrl: true,
            badge: true,
            items: {
              orderBy: { sortOrder: 'asc' },
              select: {
                skuId: true,
                quantity: true,
                sku: {
                  select: {
                    id: true,
                    title: true,
                    price: true,
                    stock: true,
                    status: true,
                    product: {
                      select: {
                        title: true,
                        status: true,
                        media: {
                          where: { type: 'IMAGE' },
                          orderBy: { sortOrder: 'asc' },
                          take: 1,
                          select: { url: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      packages: packages.map((pkg) => ({
        id: pkg.id,
        price: pkg.price,
        sortOrder: pkg.sortOrder,
        giftOptions: pkg.giftOptions.map((opt) => {
          const totalPrice = opt.items.reduce(
            (sum, item) => sum + item.sku.price * item.quantity,
            0,
          );
          const available = opt.items.length > 0 && opt.items.every(
            (item) =>
              item.sku.status === 'ACTIVE' &&
              item.sku.product?.status === 'ACTIVE' &&
              item.sku.stock >= item.quantity,
          );
          return {
            id: opt.id,
            title: opt.title,
            subtitle: opt.subtitle,
            coverMode: opt.coverMode,
            coverUrl: opt.coverUrl,
            badge: opt.badge,
            totalPrice,
            available,
            items: opt.items.map((item) => ({
              skuId: item.skuId,
              productTitle: item.sku.product?.title || '',
              productImage: item.sku.product?.media?.[0]?.url || null,
              skuTitle: item.sku.title,
              price: item.sku.price,
              quantity: item.quantity,
            })),
          };
        }),
      })),
    };
  }
```

Also remove the `this.bonusConfig.getVipConfig()` call that was used to get `vipPrice` — it's no longer needed here.

- [ ] **Step 2: Update buyer app types**

In `src/types/domain/Bonus.ts`, replace `VipGiftOptionsResponse` (lines 159-163):

```typescript
// VIP 档位
export interface VipPackage {
  id: string;
  price: number;
  sortOrder: number;
  giftOptions: VipGiftOption[];
}

// VIP 档位列表响应
export interface VipGiftOptionsResponse {
  packages: VipPackage[];
}
```

- [ ] **Step 3: Update BonusRepo**

In `src/repos/BonusRepo.ts`, update `getVipGiftOptions()` mock data to return the new `{ packages: [...] }` shape instead of `{ options: [...], vipPrice: ... }`. Update the live API call return type accordingly.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts src/types/domain/Bonus.ts src/repos/BonusRepo.ts
git commit -m "feat(api): return VIP packages grouped by tier in buyer API"
```

---

### Task 6: Backend — Update checkout to use VipPackage price

**Files:**
- Modify: `backend/src/modules/order/vip-checkout.dto.ts` (add packageId field)
- Modify: `backend/src/modules/order/checkout.service.ts:669+` (checkoutVipPackage method)

- [ ] **Step 1: Add packageId to VipCheckoutDto**

In `backend/src/modules/order/vip-checkout.dto.ts`, add before `giftOptionId`:

```typescript
  /** 选中的 VIP 档位 ID */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  packageId: string;
```

- [ ] **Step 2: Update checkoutVipPackage in checkout.service.ts**

Replace the price reading logic at the start of the method:

```
旧 (line 671-672):
  const vipConfig = await this.bonusConfig.getVipConfig();
  const vipPrice = vipConfig.vipPrice;

新:
  const pkg = await this.prisma.vipPackage.findUnique({
    where: { id: dto.packageId },
  });
  if (!pkg || pkg.status !== 'ACTIVE') {
    throw new BadRequestException('VIP 档位不存在或已下架');
  }
  const vipPrice = pkg.price;
```

- [ ] **Step 3: Add giftOption-to-package validation**

After loading the giftOption, add validation:

```typescript
  if (giftOption.packageId !== dto.packageId) {
    throw new BadRequestException('赠品方案与所选档位不匹配');
  }
```

- [ ] **Step 4: Add package info to bizMeta**

In the `bizMeta` object, add:

```typescript
    vipPackageId: pkg.id,
    referralBonusRate: pkg.referralBonusRate,
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/order/vip-checkout.dto.ts backend/src/modules/order/checkout.service.ts
git commit -m "feat(checkout): read VIP price from VipPackage instead of global config"
```

---

### Task 7: Backend — Update VIP activation and referral bonus

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts:158-164` (referral bonus in purchaseVip)
- Modify: `backend/src/modules/bonus/bonus.service.ts:198-204` (activateVipAfterPayment signature)
- Modify: `backend/src/modules/order/order.service.ts` (caller of activateVipAfterPayment)

- [ ] **Step 1: Update VipPurchase creation to include packageId and referralBonusRate**

Find where `vipPurchase` is created in `bonus.service.ts` (inside `purchaseVip` and `activateVipAfterPayment` methods). Add `packageId` and `referralBonusRate` to the `create` data.

For `activateVipAfterPayment`, the method needs to receive `packageId` and `referralBonusRate` from the checkout session's bizMeta. Update the method signature:

```typescript
  async activateVipAfterPayment(
    userId: string,
    orderId: string,
    giftOptionId: string,
    amount: number,
    giftSnapshot: Record<string, any>,
    packageId?: string,
    referralBonusRate?: number,
  ) {
```

- [ ] **Step 2: Change referral bonus from fixed amount to percentage**

In `bonus.service.ts`, replace lines 159-163:

```typescript
  // 旧:
  const referralBonus = config.vipReferralBonus;

  // 新:
  const referralBonusRate = vipPurchase.referralBonusRate ?? 0;
  const referralBonus = Math.round(vipPurchase.amount * referralBonusRate * 100) / 100;
```

Apply the same change in `activateVipAfterPayment`.

- [ ] **Step 3: Update caller in order.service.ts**

Find where `activateVipAfterPayment` is called in `order.service.ts` (payment callback handler). Pass `packageId` and `referralBonusRate` from the checkout session's `bizMeta`:

```typescript
  await this.bonusService.activateVipAfterPayment(
    session.userId,
    order.id,
    (session.bizMeta as any)?.vipGiftOptionId,
    session.goodsAmount,
    session.itemsSnapshot as any,
    (session.bizMeta as any)?.vipPackageId,
    (session.bizMeta as any)?.referralBonusRate,
  );
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts backend/src/modules/order/order.service.ts
git commit -m "feat(bonus): calculate referral bonus as amount × rate instead of fixed value"
```

---

### Task 8: Backend — Clean up BonusConfigService (remove vipPrice / vipReferralBonus)

**Files:**
- Modify: `backend/src/modules/bonus/engine/bonus-config.service.ts:5-18,66-78,133-145,217-233`
- Modify: `backend/src/modules/admin/config/config-validation.ts:121-132`
- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts:270-315` (snapshots)

- [ ] **Step 1: Remove from VipBonusConfig interface (line 15-16)**

Remove `vipPrice` and `vipReferralBonus` from the `VipBonusConfig` interface.

- [ ] **Step 2: Remove from KEY_MAP (lines 77-78)**

Remove:
```
  VIP_PRICE: 'vipPrice',
  VIP_REFERRAL_BONUS: 'vipReferralBonus',
```

- [ ] **Step 3: Remove from DEFAULTS (lines 144-145)**

Remove:
```
  vipPrice: 399.0,
  vipReferralBonus: 50.0,
```

- [ ] **Step 4: Remove from getVipConfig return (lines 227-228)**

Remove `vipPrice` and `vipReferralBonus` from the return object in `getVipConfig()`.

- [ ] **Step 5: Remove from config-validation.ts (lines 121-132)**

Remove the `VIP_PRICE` and `VIP_REFERRAL_BONUS` entries from `CONFIG_VALIDATION_RULES`.

- [ ] **Step 6: Clean up reward-calculator snapshots**

In `reward-calculator.service.ts`, remove `vipMinAmount` references from the `snapshot()` and `snapshotVip()` methods (these were already non-functional). Keep only the fields that still exist in the interface.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/bonus/engine/ backend/src/modules/admin/config/config-validation.ts
git commit -m "refactor(config): remove VIP_PRICE and VIP_REFERRAL_BONUS from global config"
```

---

### Task 9: Admin frontend — VIP config page cleanup

**Files:**
- Modify: `admin/src/pages/bonus/vip-config.tsx:82-92,116-126,184`

- [ ] **Step 1: Remove VIP_PRICE from CONFIG_SCHEMA (lines 82-92)**

Remove the entire `VIP_PRICE` object from the `CONFIG_SCHEMA` array.

- [ ] **Step 2: Remove VIP_REFERRAL_BONUS from CONFIG_SCHEMA (lines ~116-126, after VIP_MIN_AMOUNT was already removed)**

Remove the entire `VIP_REFERRAL_BONUS` object from the `CONFIG_SCHEMA` array.

- [ ] **Step 3: Update GROUP_DESCRIPTIONS.vip**

Change from:
```
'VIP基础设置控制VIP礼包定价、推荐奖励和树结构参数。调整这些参数会影响VIP系统的用户获取成本和奖励分配广度。'
```
To:
```
'VIP基础设置控制奖励树结构参数。调整这些参数会影响VIP系统的奖励分配广度。VIP 档位价格和推荐奖励比例在「购买VIP赠品」页面管理。'
```

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/bonus/vip-config.tsx
git commit -m "refactor(admin): remove VIP_PRICE and VIP_REFERRAL_BONUS from VIP config page"
```

---

### Task 10: Admin frontend — Add VipPackage management to gifts page

**Files:**
- Modify: `admin/src/api/vip-gifts.ts` (add VipPackage types and API calls)
- Modify: `admin/src/pages/vip-gifts/index.tsx` (add package management section, update gift table)

- [ ] **Step 1: Add VipPackage types and API functions to vip-gifts.ts**

In `admin/src/api/vip-gifts.ts`, add:

```typescript
// ===== VIP 档位 =====

export interface VipPackage {
  id: string;
  price: number;
  referralBonusRate: number;
  sortOrder: number;
  status: VipGiftOptionStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { giftOptions: number };
}

export interface CreateVipPackageInput {
  price: number;
  referralBonusRate?: number;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
}

export interface UpdateVipPackageInput {
  price?: number;
  referralBonusRate?: number;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
}

export const getVipPackages = (): Promise<VipPackage[]> =>
  client.get('/admin/vip/packages');

export const createVipPackage = (data: CreateVipPackageInput): Promise<VipPackage> =>
  client.post('/admin/vip/packages', data);

export const updateVipPackage = (id: string, data: UpdateVipPackageInput): Promise<VipPackage> =>
  client.patch(`/admin/vip/packages/${id}`, data);

export const deleteVipPackage = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/vip/packages/${id}`);
```

Also add `packageId` to `VipGiftOption`, `CreateVipGiftOptionInput`, and `UpdateVipGiftOptionInput` interfaces.

- [ ] **Step 2: Add VipPackage management Card to vip-gifts page**

At the top of the page (above the ProTable), add a Card showing all packages. Use `useQuery` to fetch packages. Display each package as a card with price, referral rate (as %), and gift count. Add edit/delete buttons. Add "新增档位" button.

- [ ] **Step 3: Add package edit Modal**

Create a Modal with Form containing:
- `price` (InputNumber, suffix: 元)
- `referralBonusRate` (InputNumber, displayed as %, e.g. input 15 → store 0.15)
- `status` (Radio: 上架/下架)

Use for both create and edit (prefill form values on edit).

- [ ] **Step 4: Add packageId filter and column to gift table**

- Add a `packageId` filter Select above the ProTable (options from packages query)
- Add a "所属档位" column to ProTable that displays `¥{package.price}`
- Update the gift create/edit Drawer to include a "所属档位" Select (required, options from packages)

- [ ] **Step 5: Remove old VIP price display**

Remove the `vipPrice` query, the `vipPriceConfig` variable, and the "当前 VIP 统一价格" text from the Alert description.

- [ ] **Step 6: Commit**

```bash
git add admin/src/api/vip-gifts.ts admin/src/pages/vip-gifts/index.tsx
git commit -m "feat(admin): add VIP package management and tier-based gift filtering"
```

---

### Task 11: Buyer App — Add package tab selection to VIP purchase page

**Files:**
- Modify: `app/vip/gifts.tsx` (add price tabs, update data flow)
- Modify: `src/store/useCheckoutStore.ts:12-27` (add packageId to VipPackageSelection)

- [ ] **Step 1: Add packageId to VipPackageSelection**

In `src/store/useCheckoutStore.ts`, add `packageId` to the `VipPackageSelection` interface:

```typescript
export interface VipPackageSelection {
  packageId: string;        // 新增：选中的档位 ID
  giftOptionId: string;
  title: string;
  coverMode?: string;
  coverUrl?: string;
  totalPrice: number;
  price: number;
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

- [ ] **Step 2: Update VipGiftsScreen to use packages data**

In `app/vip/gifts.tsx`:

Replace the data extraction:
```typescript
// 旧:
const giftOptions = giftData?.ok ? giftData.data.options : [];
const vipPrice = giftData?.ok ? giftData.data.vipPrice : 399;

// 新:
const packages = giftData?.ok ? giftData.data.packages : [];
const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
const currentPackage = packages[selectedPackageIndex];
const giftOptions = currentPackage?.giftOptions ?? [];
const vipPrice = currentPackage?.price ?? 0;
```

- [ ] **Step 3: Add price tab UI component**

Insert between the title section and the referral bar, a horizontal row of price tab Pressables:

```typescript
{/* 价格档位选择 */}
{packages.length > 0 && (
  <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.priceTabs}>
    {packages.map((pkg, index) => (
      <Pressable
        key={pkg.id}
        onPress={() => {
          setSelectedPackageIndex(index);
          setSelectedIndex(null); // 重置赠品选择
          flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }}
        style={[
          styles.priceTab,
          selectedPackageIndex === index && styles.priceTabActive,
        ]}
      >
        <Text style={[
          styles.priceTabAmount,
          selectedPackageIndex === index && styles.priceTabAmountActive,
        ]}>
          ¥{pkg.price}
        </Text>
        <Text style={[
          styles.priceTabLabel,
          selectedPackageIndex === index && styles.priceTabLabelActive,
        ]}>
          VIP 礼包
        </Text>
        <Text style={styles.priceTabCount}>
          {pkg.giftOptions.length} 款可选
        </Text>
      </Pressable>
    ))}
  </Animated.View>
)}
```

- [ ] **Step 4: Add price tab styles**

Add to `StyleSheet.create`:

```typescript
  priceTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  priceTab: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: VIP.cardBorder,
    backgroundColor: VIP.cardBg,
    alignItems: 'center',
  },
  priceTabActive: {
    borderColor: VIP.goldPrimary,
    backgroundColor: 'rgba(201,169,110,0.12)',
  },
  priceTabAmount: {
    fontSize: 22,
    fontWeight: '700',
    color: VIP.subtleGray,
  },
  priceTabAmountActive: {
    color: VIP.goldPrimary,
  },
  priceTabLabel: {
    fontSize: 11,
    color: VIP.subtleGray,
    marginTop: 4,
  },
  priceTabLabelActive: {
    color: VIP.warmWhite,
  },
  priceTabCount: {
    fontSize: 10,
    color: VIP.subtleGray,
    marginTop: 2,
  },
```

- [ ] **Step 5: Update handleCheckout to include packageId**

```typescript
  const handleCheckout = useCallback(() => {
    if (selectedIndex === null || !currentPackage) return;
    const selected = giftOptions[selectedIndex];
    if (!selected || !selected.available) return;

    setVipPackageSelection({
      packageId: currentPackage.id,
      giftOptionId: selected.id,
      title: selected.title,
      coverMode: selected.coverMode,
      coverUrl: selected.coverUrl ?? undefined,
      totalPrice: selected.totalPrice,
      price: currentPackage.price,
      items: selected.items,
    });

    router.push('/checkout');
  }, [selectedIndex, giftOptions, currentPackage, setVipPackageSelection, router]);
```

- [ ] **Step 6: Commit**

```bash
git add app/vip/gifts.tsx src/store/useCheckoutStore.ts src/types/domain/Bonus.ts
git commit -m "feat(app): add VIP price tier selection tabs on purchase page"
```

---

### Task 12: Update CLAUDE.md with new spec reference

**Files:**
- Modify: `CLAUDE.md` (add spec doc reference)

- [ ] **Step 1: Add spec doc to CLAUDE.md 相关文档 section**

Add to the document list:

```markdown
- `docs/superpowers/specs/2026-03-26-vip-multi-package-design.md` — VIP 多档位礼包设计方案（VipPackage 数据模型、多价格结账、按比例推荐奖励、管理后台档位管理、买家App档位选择，**VIP 多档位系统权威来源**）
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add VIP multi-package spec reference to CLAUDE.md"
```
