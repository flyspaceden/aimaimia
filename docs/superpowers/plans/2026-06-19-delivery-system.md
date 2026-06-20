# Delivery System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated delivery business line inside the existing 爱买买 app/backend/admin/seller codebase, reusing current commerce logic while keeping delivery accounts, data, orders, pricing, manifests, and admin/seller surfaces independent.

**Architecture:** Use the same repository, same NestJS process, and same API domain, with three route prefixes: `/api/v1/delivery/*`, `/api/v1/delivery-admin/*`, and `/api/v1/delivery-seller/*`. Add a second Prisma schema/client and `DeliveryPrismaService` backed by `DELIVERY_DATABASE_URL`; reuse current payment, SF Express, OSS, SMS, and customer-service infrastructure through adapters while all delivery business records write only to the delivery database.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, Expo React Native, expo-router, Zustand, TanStack Query, Vite React, Ant Design, OSS, Alipay, WeChat Pay, SF Express.

---

## Scope Check

This is a large cross-system feature. Treat this document as the master implementation plan, and implement it in chunks. Each chunk should leave the product in a buildable state and be committed separately. Do not start UI buildout until the delivery database, API contracts, and auth guards are in place.

Most behavior should be copied from the existing app/admin/seller/backend. Do not redesign working flows unless the delivery spec explicitly requires a difference.

Primary spec: `docs/superpowers/specs/2026-06-19-delivery-system-design.md`

## Review Follow-up 2026-06-19

- [x] Add delivery checkout active-query endpoint and App polling fallback after native Alipay / WeChat payment returns.
- [x] Add buyer delivery customer-service API, App repo, and `/delivery/cs` page.
- [x] Wire buyer delivery unit edit form to admin unit-field config and existing province/city/district picker.
- [x] Store delivery unit province/city/district as 6-digit standard region codes from the picker.
- [x] Allow the shared RegionPicker to receive the delivery orange palette without changing normal App address pages.
- [x] Guard delivery center file downloads by merchant ownership and store SF waybill PDFs under `delivery/waybills/`.
- [x] Add delivery admin permission decorator/guard and annotate delivery-admin business controllers.
- [x] Verify with targeted backend Jest, App delivery repo and region Jest, App TypeScript, backend build, and delivery Prisma validate with a local placeholder URL.

## File Structure

### Backend foundation

- Create: `backend/prisma-delivery/schema.prisma`
- Create: `backend/prisma-delivery/migrations/**/migration.sql`
- Create: `backend/prisma-delivery/seed.ts`
- Modify: `backend/package.json`
- Modify: `.github/workflows/deploy-website.yml`
- Create: `backend/src/delivery-prisma/delivery-prisma.module.ts`
- Create: `backend/src/delivery-prisma/delivery-prisma.service.ts`
- Create: `backend/src/modules/delivery/delivery.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/src/modules/delivery/common/delivery-id.service.ts`
- Create: `backend/src/modules/delivery/common/delivery-id.service.spec.ts`
- Create: `backend/src/modules/delivery/common/delivery-audit.service.ts`
- Create: `backend/src/modules/delivery/common/delivery-money.ts`

### Backend auth and buyer delivery APIs

- Create: `backend/src/modules/delivery/auth/**`
- Create: `backend/src/modules/delivery/buyer/**`
- Create: `backend/src/modules/delivery/units/**`
- Create: `backend/src/modules/delivery/catalog/**`
- Create: `backend/src/modules/delivery/cart/**`
- Create: `backend/src/modules/delivery/checkout/**`
- Create: `backend/src/modules/delivery/orders/**`
- Create: `backend/src/modules/delivery/payments/**`
- Create: `backend/src/modules/delivery/shipping/**`
- Create: `backend/src/modules/delivery/manifests/**`
- Create: `backend/src/modules/delivery/customer-service/**`

### Backend admin and delivery center APIs

- Create: `backend/src/modules/delivery/admin/**`
- Create: `backend/src/modules/delivery/seller/**`
- Create: `backend/src/modules/delivery/products/**`
- Create: `backend/src/modules/delivery/pricing/**`
- Create: `backend/src/modules/delivery/inventory/**`
- Create: `backend/src/modules/delivery/settlement/**`
- Create: `backend/src/modules/delivery/config/**`
- Create: `backend/src/modules/delivery/stats/**`

### Buyer App

- Modify: `app/(tabs)/me.tsx`
- Create: `app/delivery/_layout.tsx`
- Create: `app/delivery/login.tsx`
- Create: `app/delivery/unit-select.tsx`
- Create: `app/delivery/unit-edit.tsx`
- Create: `app/delivery/(tabs)/_layout.tsx`
- Create: `app/delivery/(tabs)/products.tsx`
- Create: `app/delivery/(tabs)/me.tsx`
- Create: `app/delivery/product/[id].tsx`
- Create: `app/delivery/cart.tsx`
- Create: `app/delivery/checkout.tsx`
- Create: `app/delivery/payment-success.tsx`
- Create: `app/delivery/orders/index.tsx`
- Create: `app/delivery/orders/[id].tsx`
- Create: `app/delivery/manifests/index.tsx`
- Create: `src/repos/delivery/**`
- Create: `src/store/useDeliveryAuthStore.ts`
- Create: `src/store/useDeliveryCartStore.ts`
- Create: `src/theme/delivery.ts`

### Delivery admin frontend

- Create: `delivery-admin/**` by copying `admin/**`, then pruning delivery-inapplicable modules.
- Modify: `.github/workflows/deploy-website.yml`
- Add pages under `delivery-admin/src/pages/**` for delivery users, units, merchants, products, pricing, orders, shipping, payments, manifests, settlement, customer service, audit, stats, and config.

### Delivery center frontend

- Create: `delivery-seller/**` by copying `seller/**`, then pruning delivery-inapplicable modules.
- Modify: `.github/workflows/deploy-website.yml`
- Add pages under `delivery-seller/src/pages/**` for dashboard, products, orders, shipping, inventory, fulfillment manifests, finance exports, company, staff, customer service, and account security.

### Documentation and operations

- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/architecture/seller.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/阿里云部署.md`
- Modify: `docs/features/shipping.md`
- Modify: `docs/features/智能客服.md`
- Modify: `plan.md`

---

## Chunk 1: Delivery Database And Prisma Foundation

### Task 1: Add the delivery Prisma schema and generated client

**Files:**
- Create: `backend/prisma-delivery/schema.prisma`
- Create: `backend/prisma-delivery/migrations/20260619010000_init_delivery/migration.sql`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the schema skeleton**

Create `backend/prisma-delivery/schema.prisma` with a custom client output:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/delivery-client"
}

datasource db {
  provider = "postgresql"
  url      = env("DELIVERY_DATABASE_URL")
}
```

Add v1 enums and models in the same file. Start with only fields needed by this plan, then expand during each backend task:

- `DeliverySequence`
- `DeliveryUser`
- `DeliveryAuthIdentity`
- `DeliveryAdminUser`
- `DeliverySellerStaff`
- `DeliveryUnit`
- `DeliveryAddress`
- `DeliveryMerchant`
- `DeliveryMerchantApplication`
- `DeliveryCategory`
- `DeliveryProductUnit`
- `DeliveryProduct`
- `DeliveryProductSku`
- `DeliveryPriceRule`
- `DeliveryShippingRule`
- `DeliveryShippingCost`
- `DeliveryUnitFieldConfig`
- `DeliveryInventoryLedger`
- `DeliveryCartItem`
- `DeliveryCheckoutSession`
- `DeliveryOrder`
- `DeliverySubOrder`
- `DeliveryOrderItem`
- `DeliveryPayment`
- `DeliveryShipment`
- `DeliveryManifestTemplate`
- `DeliveryManifest`
- `DeliveryManifestVersion`
- `DeliverySettlement`
- `DeliveryCustomerServiceConversation`
- `DeliveryConfig`
- `DeliveryAuditLog`

Use integer cents for all money fields. Use `String @id` for core delivery business tables that use readable IDs such as `PSDD...`; these IDs are internal delivery database IDs or business primary keys, not a second display-only number.

- [ ] **Step 2: Add Prisma scripts**

Modify `backend/package.json` scripts:

```json
{
  "prisma:delivery:generate": "prisma generate --schema prisma-delivery/schema.prisma",
  "prisma:delivery:migrate": "prisma migrate dev --schema prisma-delivery/schema.prisma",
  "prisma:delivery:deploy": "prisma migrate deploy --schema prisma-delivery/schema.prisma",
  "prisma:delivery:seed": "ts-node prisma-delivery/seed.ts"
}
```

- [ ] **Step 3: Validate schema**

Run:

```bash
cd backend
npx prisma validate --schema prisma-delivery/schema.prisma
```

Expected: schema validates.

- [ ] **Step 4: Generate delivery client**

Run:

```bash
cd backend
npm run prisma:delivery:generate
```

Expected: generated client exists under `backend/src/generated/delivery-client`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma-delivery/schema.prisma backend/prisma-delivery/migrations/20260619010000_init_delivery/migration.sql backend/package.json
git commit -m "feat(delivery): add isolated prisma schema"
```

### Task 2: Add DeliveryPrismaService and module wiring

**Files:**
- Create: `backend/src/delivery-prisma/delivery-prisma.service.ts`
- Create: `backend/src/delivery-prisma/delivery-prisma.module.ts`
- Create: `backend/src/modules/delivery/delivery.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write a service smoke test**

Create `backend/src/delivery-prisma/delivery-prisma.service.spec.ts`:

```ts
import { DeliveryPrismaService } from './delivery-prisma.service';

describe('DeliveryPrismaService', () => {
  it('is instantiable from generated delivery client', () => {
    const service = new DeliveryPrismaService();
    expect(service).toBeDefined();
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify the service is missing**

```bash
cd backend
npx jest src/delivery-prisma/delivery-prisma.service.spec.ts --runInBand
```

Expected: FAIL because `delivery-prisma.service.ts` does not exist.

- [ ] **Step 3: Implement service and module**

Create `backend/src/delivery-prisma/delivery-prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/delivery-client';

@Injectable()
export class DeliveryPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Create `backend/src/delivery-prisma/delivery-prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { DeliveryPrismaService } from './delivery-prisma.service';

@Global()
@Module({
  providers: [DeliveryPrismaService],
  exports: [DeliveryPrismaService],
})
export class DeliveryPrismaModule {}
```

Create `backend/src/modules/delivery/delivery.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';

@Module({
  imports: [DeliveryPrismaModule],
})
export class DeliveryModule {}
```

Modify `backend/src/app.module.ts` to import `DeliveryModule`.

- [ ] **Step 4: Run backend build**

```bash
cd backend
npm run prisma:delivery:generate
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/src/delivery-prisma backend/src/modules/delivery/delivery.module.ts backend/src/app.module.ts
git commit -m "feat(delivery): wire delivery prisma service"
```

### Task 3: Add readable delivery ID generation

**Files:**
- Create: `backend/src/modules/delivery/common/delivery-id.service.ts`
- Create: `backend/src/modules/delivery/common/delivery-id.service.spec.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write failing ID tests**

Create tests covering the confirmed prefixes:

```ts
import { formatDeliveryId } from './delivery-id.service';

describe('formatDeliveryId', () => {
  it('formats readable delivery ids', () => {
    expect(formatDeliveryId('PSYH', 1)).toBe('PSYH0000000000001');
    expect(formatDeliveryId('PSSJ', 1)).toBe('PSSJ0000000000001');
    expect(formatDeliveryId('PSSP', 1)).toBe('PSSP0000000000001');
    expect(formatDeliveryId('PSDD', 1)).toBe('PSDD0000000000001');
    expect(formatDeliveryId('PSZDD', 1)).toBe('PSZDD000000000001');
    expect(formatDeliveryId('PSZF', 1)).toBe('PSZF0000000000001');
    expect(formatDeliveryId('PSQD', 1)).toBe('PSQD0000000000001');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx jest src/modules/delivery/common/delivery-id.service.spec.ts --runInBand
```

Expected: FAIL because utility is missing.

- [ ] **Step 3: Implement ID service**

Implement:

- `formatDeliveryId(prefix, value)`
- `DeliveryIdService.next(prefix)` using `DeliverySequence` rows in the delivery DB inside a transaction.
- Prefix constants for `PSYH`, `PSSJ`, `PSSP`, `PSDD`, `PSZDD`, `PSZF`, `PSQD`.

Use row-level locking or serializable transaction semantics so concurrent calls never duplicate IDs.

- [ ] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/delivery/common/delivery-id.service.spec.ts --runInBand
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/common backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add readable id generator"
```

---

## Chunk 2: Delivery Authentication, Units, And Shared Guards

### Task 4: Add delivery auth guards and JWT strategies

**Files:**
- Create: `backend/src/modules/delivery/auth/delivery-auth.module.ts`
- Create: `backend/src/modules/delivery/auth/delivery-user-jwt.strategy.ts`
- Create: `backend/src/modules/delivery/auth/delivery-admin-jwt.strategy.ts`
- Create: `backend/src/modules/delivery/auth/delivery-seller-jwt.strategy.ts`
- Create: `backend/src/modules/delivery/auth/guards/*.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write strategy unit tests**

Create tests that validate payload shape and ensure each strategy uses the right secret env key:

- `DELIVERY_USER_JWT_SECRET`
- `DELIVERY_ADMIN_JWT_SECRET`
- `DELIVERY_SELLER_JWT_SECRET`

- [ ] **Step 2: Run failing tests**

```bash
cd backend
npx jest src/modules/delivery/auth --runInBand
```

Expected: FAIL because auth module is missing.

- [ ] **Step 3: Implement strategies and guards**

Mirror current `admin-jwt` and `seller-jwt` patterns. Guard names:

- `DeliveryUserAuthGuard`
- `DeliveryAdminAuthGuard`
- `DeliverySellerAuthGuard`

JWT payloads must include delivery-specific subject IDs and must not use main `User.id`, `AdminUser.id`, or `CompanyStaff.id`.

- [ ] **Step 4: Build**

```bash
cd backend
npm run build
```

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/auth backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add isolated auth guards"
```

### Task 5: Add delivery user login and unit selection APIs

**Files:**
- Create: `backend/src/modules/delivery/buyer/delivery-buyer-auth.controller.ts`
- Create: `backend/src/modules/delivery/buyer/delivery-buyer-auth.service.ts`
- Create: `backend/src/modules/delivery/buyer/dto/*.ts`
- Create: `backend/src/modules/delivery/seller-applications/delivery-seller-application.controller.ts`
- Create: `backend/src/modules/delivery/seller-applications/delivery-seller-application.service.ts`
- Create: `backend/src/modules/delivery/seller-applications/dto/*.ts`
- Create: `backend/src/modules/delivery/units/delivery-units.controller.ts`
- Create: `backend/src/modules/delivery/units/delivery-units.service.ts`
- Create: `backend/src/modules/delivery/units/dto/*.ts`
- Create: `backend/src/modules/delivery/admin/unit-field-config.controller.ts`
- Create: `backend/src/modules/delivery/admin/unit-field-config.service.ts`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

- Phone OTP login creates or finds `DeliveryUser`.
- WeChat login creates or finds independent `DeliveryAuthIdentity`.
- Delivery center public application endpoint creates `DeliveryMerchantApplication` without requiring seller login.
- User with no unit gets `requiresUnit=true`.
- Creating first unit allows entering delivery mall.
- Switching unit only permits units owned by the current delivery user.
- Admin-configured delivery unit fields support label, sort order, visibility, required flag, and PDF/Excel inclusion.

- [ ] **Step 2: Run tests**

```bash
cd backend
npx jest src/modules/delivery/buyer src/modules/delivery/units --runInBand
```

Expected: FAIL because services are missing.

- [ ] **Step 3: Implement buyer auth and unit APIs**

Routes:

```text
POST /api/v1/delivery/auth/phone-login
POST /api/v1/delivery/auth/wechat-login
POST /api/v1/delivery-seller/merchant-applications
GET  /api/v1/delivery/me
GET  /api/v1/delivery/units
POST /api/v1/delivery/units
PATCH /api/v1/delivery/units/:id
POST /api/v1/delivery/units/:id/select
GET  /api/v1/delivery-admin/unit-field-config
PATCH /api/v1/delivery-admin/unit-field-config
```

Use delivery database only. Reuse SMS sending infrastructure but store OTP/session/rate-limit records in delivery tables or delivery-scoped tables. The public delivery center application endpoint powers the `申请入驻` button on the delivery center login page; review and approval are handled under `/api/v1/delivery-admin/merchant-applications`.

Keep fixed fulfillment fields protected: unit name, contact name, contact phone, province/city/district, and detailed address cannot be fully removed because they are required for checkout, shipping, PDF, Excel, and customer service.

- [ ] **Step 4: Run tests and build**

```bash
cd backend
npx jest src/modules/delivery/buyer src/modules/delivery/units --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/buyer backend/src/modules/delivery/units backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add user auth and units"
```

---

## Chunk 3: Catalog, Pricing, Cart, Checkout, And Orders

### Task 6: Add delivery product catalog and pricing engine

**Files:**
- Create: `backend/src/modules/delivery/catalog/**`
- Create: `backend/src/modules/delivery/products/**`
- Create: `backend/src/modules/delivery/pricing/**`
- Create: `backend/src/modules/delivery/inventory/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write pricing tests**

Test the confirmed priority:

```text
SKU固定售价
> SKU数量阶梯加价率
> 商品级数量阶梯加价率
> 商家级数量阶梯加价率
> 商家默认加价率
> 平台默认加价率
```

Also test that the seller-side DTO never returns platform final price, markup rate, or margin.

- [ ] **Step 2: Run tests**

```bash
cd backend
npx jest src/modules/delivery/pricing src/modules/delivery/products --runInBand
```

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement catalog and pricing**

Buyer routes:

```text
GET /api/v1/delivery/categories
GET /api/v1/delivery/products
GET /api/v1/delivery/products/:id
```

Admin routes:

```text
GET/POST/PATCH /api/v1/delivery-admin/products
POST /api/v1/delivery-admin/products/:id/approve
POST /api/v1/delivery-admin/products/:id/reject
GET/POST/PATCH /api/v1/delivery-admin/pricing-rules
```

Seller routes:

```text
GET/POST/PATCH /api/v1/delivery-seller/products
POST /api/v1/delivery-seller/products/:id/submit
PATCH /api/v1/delivery-seller/skus/:id/stock
```

Store money in cents. Copy current draft/audit/status conventions where practical.

- [ ] **Step 4: Run tests and build**

```bash
cd backend
npx jest src/modules/delivery/pricing src/modules/delivery/products src/modules/delivery/catalog --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/catalog backend/src/modules/delivery/products backend/src/modules/delivery/pricing backend/src/modules/delivery/inventory backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add catalog pricing and inventory"
```

### Task 7: Add delivery cart and checkout

**Files:**
- Create: `backend/src/modules/delivery/cart/**`
- Create: `backend/src/modules/delivery/checkout/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write checkout tests**

Cover:

- Cart is scoped by `deliveryUserId + deliveryUnitId`.
- Quantity must satisfy `minOrderQuantity` and `orderStepQuantity`.
- Multi-merchant checkout creates one checkout session with merchant groups.
- Checkout locks price, shipping fee, address, unit, and note snapshots.
- No VIP, coupon, reward, digital-asset, or referral data participates.

- [ ] **Step 2: Run tests**

```bash
cd backend
npx jest src/modules/delivery/cart src/modules/delivery/checkout --runInBand
```

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement cart and checkout APIs**

Routes:

```text
GET    /api/v1/delivery/cart
POST   /api/v1/delivery/cart/items
PATCH  /api/v1/delivery/cart/items/:id
DELETE /api/v1/delivery/cart/items/:id
POST   /api/v1/delivery/checkout
GET    /api/v1/delivery/checkout/:id
```

Copy current cart/checkout validation patterns. Use delivery pricing engine for final buyer price. Shipping fee calculation must use delivery-owned `DeliveryShippingRule` rows copied into the delivery database; do not read the main database shipping-rule tables during delivery checkout.

- [ ] **Step 4: Run tests and build**

```bash
cd backend
npx jest src/modules/delivery/cart src/modules/delivery/checkout --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/cart backend/src/modules/delivery/checkout backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add cart and checkout"
```

### Task 8: Add payment callback, order creation, and inventory deduction

**Files:**
- Create: `backend/src/modules/delivery/orders/**`
- Create: `backend/src/modules/delivery/payments/**`
- Modify: existing payment dispatch files under `backend/src/modules/payment/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write idempotency and inventory tests**

Cover:

- Repeated payment callback does not duplicate delivery order.
- Stock is deducted once.
- Stock cannot become negative.
- Payment success with order/stock failure creates delivery payment abnormal record.
- Delivery order does not create main `Order`, `DigitalAssetLedger`, rewards, coupons, or referral progress.

- [ ] **Step 2: Run failing tests**

```bash
cd backend
npx jest src/modules/delivery/orders src/modules/delivery/payments --runInBand
```

Expected: FAIL because modules are incomplete.

- [ ] **Step 3: Implement delivery payment routing**

Reuse existing Alipay/WeChat services. Add a delivery payment order number prefix such as `PSZF...` and route callbacks into delivery payment service by merchant order number.

Order creation must run in a transaction with strong isolation:

1. Lock checkout session.
2. Verify payment amount.
3. Recalculate stock availability from delivery DB.
4. Deduct delivery SKU stock.
5. Create `DeliveryOrder`, `DeliverySubOrder`, `DeliveryOrderItem`.
6. Create or update `DeliveryPayment`.
7. Mark checkout consumed.
8. Trigger manifest generation job or synchronous generation result.

- [ ] **Step 4: Run tests and build**

```bash
cd backend
npx jest src/modules/delivery/orders src/modules/delivery/payments --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/delivery/orders backend/src/modules/delivery/payments backend/src/modules/payment backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add payment order creation"
```

---

## Chunk 4: Shipping, Manifests, Settlement, Customer Service

### Task 9: Copy SF Express shipping flow into delivery

**Files:**
- Create: `backend/src/modules/delivery/shipping/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write shipping tests**

Cover:

- Uses `weightGram` only.
- Does not require length/width/height.
- Copies current SF monthly-account behavior.
- Writes shipments and cost records to delivery tables only.

- [ ] **Step 2: Implement delivery shipping**

Routes:

```text
POST /api/v1/delivery-seller/orders/:subOrderId/ship
GET  /api/v1/delivery-seller/orders/:subOrderId/shipments
GET  /api/v1/delivery/orders/:orderId/shipments
GET  /api/v1/delivery-admin/shipping-records
```

Reuse current SF adapter and copy current advisory-lock/idempotency behavior. Do not add new SF pricing modes.

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/delivery/shipping --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/delivery/shipping backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add sf shipping flow"
```

### Task 10: Add PDF/Excel manifest generation

**Files:**
- Create: `backend/src/modules/delivery/manifests/**`
- Modify: `backend/src/modules/delivery/orders/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write manifest permission tests**

Cover:

- Buyer/admin complete manifest includes final prices.
- Delivery center fulfillment PDF contains no amount fields.
- Delivery center finance export contains only seller-visible supply/settlement amounts.
- Template columns support name, order, show/hide, and protected fixed columns.
- Regeneration creates v2/v3 and does not delete historical objects.

- [ ] **Step 2: Implement three template types**

Template types:

```text
BUYER_FULL
SELLER_FULFILLMENT
SELLER_FINANCE
```

Routes:

```text
GET  /api/v1/delivery/manifests
GET  /api/v1/delivery/orders/:orderId/manifest
GET  /api/v1/delivery-admin/manifests
POST /api/v1/delivery-admin/manifests/:id/regenerate
GET  /api/v1/delivery-seller/orders/:subOrderId/fulfillment-manifest
GET  /api/v1/delivery-seller/finance/export
```

Store files under `delivery/manifests/` in OSS. Enforce the `delivery/` prefix in upload/storage service calls.

- [ ] **Step 3: Run tests and build**

```bash
cd backend
npx jest src/modules/delivery/manifests --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/delivery/manifests backend/src/modules/delivery/orders backend/src/modules/delivery/delivery.module.ts
git commit -m "feat(delivery): add manifests and exports"
```

### Task 11: Add settlement, customer service copy, audit, and stats

**Files:**
- Create: `backend/src/modules/delivery/settlement/**`
- Create: `backend/src/modules/delivery/customer-service/**`
- Create: `backend/src/modules/delivery/admin/**`
- Create: `backend/src/modules/delivery/seller/**`
- Create: `backend/src/modules/delivery/config/**`
- Create: `backend/src/modules/delivery/stats/**`
- Modify: `backend/src/modules/delivery/delivery.module.ts`

- [ ] **Step 1: Write service tests**

Cover:

- Settlement becomes available only when order is received/completed.
- Admin can mark settlement as paid and audit is written.
- Delivery customer service reads/writes delivery DB only.
- Stats aggregate delivery DB only.

- [ ] **Step 2: Implement APIs**

Admin routes:

```text
/api/v1/delivery-admin/users
/api/v1/delivery-admin/units
/api/v1/delivery-admin/merchants
/api/v1/delivery-admin/merchant-applications
/api/v1/delivery-admin/orders
/api/v1/delivery-admin/payments/abnormal
/api/v1/delivery-admin/settlements
/api/v1/delivery-admin/config
/api/v1/delivery-admin/audit
/api/v1/delivery-admin/stats
/api/v1/delivery-admin/cs
```

Seller routes:

```text
/api/v1/delivery-seller/dashboard
/api/v1/delivery-seller/orders
/api/v1/delivery-seller/settlements
/api/v1/delivery-seller/cs
/api/v1/delivery-seller/company
/api/v1/delivery-seller/staff
```

- [ ] **Step 3: Run backend test suite subset and build**

```bash
cd backend
npx jest src/modules/delivery --runInBand
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/delivery
git commit -m "feat(delivery): add admin seller settlement cs"
```

---

## Chunk 5: Buyer App Delivery Module

### Task 12: Add App delivery API repos and stores

**Files:**
- Create: `src/repos/delivery/DeliveryAuthRepo.ts`
- Create: `src/repos/delivery/DeliveryUnitRepo.ts`
- Create: `src/repos/delivery/DeliveryProductRepo.ts`
- Create: `src/repos/delivery/DeliveryCartRepo.ts`
- Create: `src/repos/delivery/DeliveryOrderRepo.ts`
- Create: `src/repos/delivery/DeliveryManifestRepo.ts`
- Create: `src/repos/delivery/index.ts`
- Create: `src/store/useDeliveryAuthStore.ts`
- Create: `src/store/useDeliveryCartStore.ts`
- Create: `src/theme/delivery.ts`

- [ ] **Step 1: Add repo tests or pure mapper tests**

Test URL prefixes and response mapping for `/delivery/*`.

- [ ] **Step 2: Implement repos and stores**

Use existing `ApiClient` and current App repo patterns. Keep delivery auth tokens separate from normal App auth state.

- [ ] **Step 3: Run App typecheck**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/repos/delivery src/store/useDeliveryAuthStore.ts src/store/useDeliveryCartStore.ts src/theme/delivery.ts
git commit -m "feat(app): add delivery repos and state"
```

### Task 13: Add App entry, delivery tabs, products, cart, checkout, orders

**Files:**
- Modify: `app/(tabs)/me.tsx`
- Create: `app/delivery/_layout.tsx`
- Create: `app/delivery/login.tsx`
- Create: `app/delivery/unit-select.tsx`
- Create: `app/delivery/unit-edit.tsx`
- Create: `app/delivery/(tabs)/_layout.tsx`
- Create: `app/delivery/(tabs)/products.tsx`
- Create: `app/delivery/(tabs)/me.tsx`
- Create: `app/delivery/product/[id].tsx`
- Create: `app/delivery/cart.tsx`
- Create: `app/delivery/checkout.tsx`
- Create: `app/delivery/payment-success.tsx`
- Create: `app/delivery/orders/index.tsx`
- Create: `app/delivery/orders/[id].tsx`
- Create: `app/delivery/manifests/index.tsx`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Add navigation entry**

In `app/(tabs)/me.tsx`, add a 常用工具 button labeled `配送` that routes to `/delivery`.

- [ ] **Step 2: Implement delivery gate**

`app/delivery/_layout.tsx` should gate:

```text
no delivery token -> /delivery/login
token but no unit -> /delivery/unit-select
token and unit -> /delivery/(tabs)/products
```

- [ ] **Step 3: Implement two delivery tabs**

Only tabs:

```text
商品
我的
```

Use orange delivery theme. Add `返回爱买买平台` in delivery "我的 > 常用工具".

- [ ] **Step 4: Copy shopping flow**

Copy current product list/detail/cart/checkout/order patterns, but bind only to delivery repos and delivery stores.

Remove VIP, coupon, reward, digital asset, referral, lottery, after-sale, and normal order entry points.

- [ ] **Step 5: Run App checks**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: pass.

- [ ] **Step 6: Update docs and commit**

```bash
git add app/delivery app/'(tabs)'/me.tsx src/repos/delivery src/store src/theme/delivery.ts docs/architecture/frontend.md plan.md
git commit -m "feat(app): add delivery shopping module"
```

---

## Chunk 6: Delivery Admin Frontend

### Task 14: Create delivery-admin app shell

**Files:**
- Create: `delivery-admin/**`
- Modify: `admin/src/pages/login/index.tsx`
- Modify: `.github/workflows/deploy-website.yml`

- [ ] **Step 1: Copy admin package**

Copy `admin/` to `delivery-admin/`. Keep the same stack and scripts.

- [ ] **Step 2: Change identity and API client**

Update:

- package name to `delivery-admin`
- localStorage token keys to `delivery_admin_token` and `delivery_admin_refresh_token`
- auth routes to `/delivery-admin/auth/*`
- main display title to `配送管理后台`
- theme to light blue
- login page switch button to `切换爱买买管理后台`

Also modify the existing 爱买买管理后台 login page `admin/src/pages/login/index.tsx` to add `切换配送管理后台`, linking to `https://delivery-admin.ai-maimai.com` in production and the test delivery-admin domain in staging/local configuration.

- [ ] **Step 3: Prune unavailable modules**

Remove routes and menus for:

- VIP
- coupons
- rewards/wallet
- digital assets
- bonus/referral
- lottery
- refunds/returns/after-sale refund flow

- [ ] **Step 4: Run build**

```bash
cd admin && npm run build
cd ../delivery-admin && npm install && npm run build
```

Expected: both builds pass.

- [ ] **Step 5: Commit**

```bash
git add delivery-admin admin/src/pages/login/index.tsx .github/workflows/deploy-website.yml
git commit -m "feat(delivery-admin): add admin shell"
```

### Task 15: Add delivery-admin pages

**Files:**
- Create/modify: `delivery-admin/src/pages/**`
- Create/modify: `delivery-admin/src/api/**`
- Create/modify: `delivery-admin/src/types/**`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Implement pages against backend APIs**

Pages:

- dashboard
- delivery users
- delivery units
- merchants and onboarding review
- products and product audit
- pricing rules
- orders
- shipping records
- abnormal payments
- manifests/templates
- settlements
- customer service
- audit logs
- stats
- config

- [ ] **Step 2: Enforce price visibility rules**

Admin can see final buyer prices and seller supply prices, but UI must clearly separate buyer amount, seller settlement amount, and platform margin.

- [ ] **Step 3: Run build**

```bash
cd delivery-admin
npm run build
```

Expected: pass.

- [ ] **Step 4: Update docs and commit**

```bash
git add delivery-admin docs/architecture/admin-frontend.md plan.md
git commit -m "feat(delivery-admin): add delivery management pages"
```

---

## Chunk 7: Delivery Center Frontend

### Task 16: Create delivery-seller app shell

**Files:**
- Create: `delivery-seller/**`
- Modify: `seller/src/pages/login/index.tsx`
- Modify: `.github/workflows/deploy-website.yml`

- [ ] **Step 1: Copy seller package**

Copy `seller/` to `delivery-seller/`. Keep the same stack and scripts.

- [ ] **Step 2: Change identity and API client**

Update:

- package name to `delivery-seller`
- visible name to `配送中心`
- localStorage token keys to `delivery_seller_token` and `delivery_seller_refresh_token`
- auth routes to `/delivery-seller/auth/*`
- theme to orange
- login page switch button to `切换爱买买卖家中心`
- login page application button to `申请入驻`

Also modify the existing 爱买买卖家中心 login page `seller/src/pages/login/index.tsx` to add `切换配送中心`, linking to `https://delivery-seller.ai-maimai.com` in production and the test delivery-seller domain in staging/local configuration.

- [ ] **Step 3: Prune unavailable modules**

Remove routes and menus for:

- after-sale
- refunds
- returns
- normal seller-only features not used by delivery

- [ ] **Step 4: Run build**

```bash
cd seller && npm run build
cd ../delivery-seller && npm install && npm run build
```

Expected: both builds pass.

- [ ] **Step 5: Commit**

```bash
git add delivery-seller seller/src/pages/login/index.tsx .github/workflows/deploy-website.yml
git commit -m "feat(delivery-seller): add delivery center shell"
```

### Task 17: Add delivery center pages and exports

**Files:**
- Create/modify: `delivery-seller/src/pages/**`
- Create/modify: `delivery-seller/src/api/**`
- Create/modify: `delivery-seller/src/types/**`
- Modify: `docs/architecture/seller.md`
- Modify: `plan.md`

- [ ] **Step 1: Implement pages**

Pages:

- dashboard
- product drafts and submit review
- product list and edit
- SKU stock
- orders
- ship order
- logistics
- fulfillment PDF
- finance exports
- company info
- staff and permissions
- customer service/work orders
- account security

- [ ] **Step 2: Enforce delivery center visibility rules**

Delivery center UI must not show:

- platform final sale price
- platform markup rate
- platform margin
- buyer complete payment amount

Fulfillment PDF must not show any amount, including supply/cost/finished price.

Finance exports may show only seller-visible supply/settlement amounts.

- [ ] **Step 3: Run build**

```bash
cd delivery-seller
npm run build
```

Expected: pass.

- [ ] **Step 4: Update docs and commit**

```bash
git add delivery-seller docs/architecture/seller.md plan.md
git commit -m "feat(delivery-seller): add delivery center pages"
```

---

## Chunk 8: Deployment, Legal, Seeds, And End-to-End Verification

### Task 18: Update CI/CD and server deployment docs

**Files:**
- Modify: `.github/workflows/deploy-website.yml`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/阿里云部署.md`
- Modify: `docs/operations/staging-to-production.md`

- [ ] **Step 1: Add delivery frontend targets**

In deploy workflow, add production and staging target dirs:

```text
/www/wwwroot/delivery-admin/
/www/wwwroot/delivery-seller/
/www/wwwroot/test-delivery-admin/
/www/wwwroot/test-delivery-seller/
```

Build `delivery-admin` and `delivery-seller` with `VITE_API_BASE_URL` pointing to current API base.

- [ ] **Step 2: Add backend delivery Prisma deploy**

In backend deploy step, run:

```bash
npx prisma generate
npx prisma migrate deploy
npx prisma generate --schema prisma-delivery/schema.prisma
npx prisma migrate deploy --schema prisma-delivery/schema.prisma
npm run build
pm2 reload $PM2_NAME --update-env
```

- [ ] **Step 3: Document env vars**

Document:

```text
DELIVERY_DATABASE_URL
DELIVERY_USER_JWT_SECRET
DELIVERY_ADMIN_JWT_SECRET
DELIVERY_SELLER_JWT_SECRET
```

Also add delivery admin/seller domains to backend `CORS_ORIGINS`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-website.yml docs/operations/deployment.md docs/operations/阿里云部署.md docs/operations/staging-to-production.md
git commit -m "chore(delivery): add deployment configuration"
```

### Task 19: Add delivery legal pages and seed data

**Files:**
- Create/modify: website legal content under current website/legal source paths
- Create: `backend/prisma-delivery/seed.ts`
- Modify: `docs/legal` or relevant source legal content if the project stores legal text there

- [ ] **Step 1: Add legal pages**

Add URLs:

```text
/legal/delivery-terms
/legal/delivery-privacy
/legal/delivery-seller-agreement
```

Use placeholder operational legal text if final counsel text is not ready, but mark it as needing legal review before production.

- [ ] **Step 2: Add seed**

Seed:

- delivery super admin
- operations/admin/finance/customer-service roles
- delivery merchant and OWNER
- delivery product categories and units
- delivery products and SKUs
- delivery user
- delivery unit
- address
- template configs
- customer-service config

- [ ] **Step 3: Run seed in staging database only**

```bash
cd backend
DELIVERY_DATABASE_URL="$STAGING_DELIVERY_DATABASE_URL" npm run prisma:delivery:seed
```

Expected: seed finishes and prints created IDs.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma-delivery/seed.ts docs/legal website docs/operations
git commit -m "feat(delivery): add legal pages and seed data"
```

### Task 20: Run integrated verification

**Files:**
- Modify docs as needed after verification:
  - `docs/operations/阿里云部署.md`
  - `docs/architecture/frontend.md`
  - `docs/architecture/backend.md`
  - `docs/architecture/admin-frontend.md`
  - `docs/architecture/seller.md`
  - `plan.md`

- [ ] **Step 1: Backend verification**

```bash
cd backend
npx prisma validate
npx prisma validate --schema prisma-delivery/schema.prisma
npm run prisma:generate
npm run prisma:delivery:generate
npm run build
npx jest src/modules/delivery --runInBand
```

Expected: all pass.

- [ ] **Step 2: App verification**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: pass.

- [ ] **Step 3: Frontend verification**

```bash
cd admin && npm run build
cd ../seller && npm run build
cd ../delivery-admin && npm run build
cd ../delivery-seller && npm run build
```

Expected: all builds pass.

- [ ] **Step 4: Manual end-to-end smoke test**

In staging:

1. App normal `我的 > 常用工具 > 配送` enters delivery.
2. Delivery phone login works.
3. No unit forces create unit.
4. Delivery 商品 tab lists only delivery products.
5. Add item respecting起订量 and购买步长.
6. Checkout pays with test/sandbox payment as appropriate.
7. Payment creates delivery order and suborder only in delivery DB.
8. Buyer complete manifest has final prices.
9. Delivery center can see only its suborder.
10. Delivery center fulfillment PDF has no money fields.
11. Delivery center finance export has only seller-visible settlement fields.
12. Delivery admin sees abnormal payments, manifests, pricing, settlement, audit logs.
13. Normal app orders/VIP/reward/digital assets do not change.

- [ ] **Step 5: Update docs and commit**

```bash
git add docs/architecture/frontend.md docs/architecture/backend.md docs/architecture/admin-frontend.md docs/architecture/seller.md docs/operations/阿里云部署.md plan.md
git commit -m "docs(delivery): record verification and rollout notes"
```

---

## Final Release Checklist

- [ ] Aliyun DNS records added for `delivery-admin`, `delivery-seller`, `test-delivery-admin`, `test-delivery-seller`.
- [ ] 宝塔站点 and SSL configured for all four domains.
- [ ] `DELIVERY_DATABASE_URL` configured in staging and production.
- [ ] Delivery JWT secrets configured in staging and production.
- [ ] Backend `CORS_ORIGINS` includes delivery admin/seller domains.
- [ ] Delivery Prisma migrations deployed to staging.
- [ ] Delivery seed run in staging.
- [ ] All backend delivery tests pass.
- [ ] App typecheck passes.
- [ ] Admin, seller, delivery-admin, delivery-seller builds pass.
- [ ] Staging E2E smoke test passes.
- [ ] User signs off before production deploy.
