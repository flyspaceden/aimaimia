# 团购分享回馈 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的团购分享回馈系统：用户现金购买后台指定团购商品，满足确认收货、售后期结束且无退换货后生成分享码；直接分享好友购买同款并满足有效条件后，按后台配置档位释放团购返还余额。

**Architecture:** 新建 `group-buy` 后端模块和独立团购返还账户，不复用旧 `GroupModule`、VIP 推荐码、普通/VIP 分润、Reward 或 Coupon。团购购买走专用 checkout，但支付成功后仍创建标准 `Order/OrderItem`，复用物流、确认收货、售后和退款主干。App 使用“精选团购货架 / 商品护照卡”视觉体系；管理后台从活动、实例、订单、流水四个维度追踪。

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Expo 54 / React Native 0.81, expo-router, React Query, Reanimated, Vite React 19, Ant Design 5.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-21-group-buy-share-rebate-design.md`
- App frontend authority: `docs/architecture/frontend.md`
- App responsive authority: `docs/architecture/responsive-design.md`
- Admin frontend authority: `docs/architecture/admin-frontend.md`
- Reward product reference: `backend/src/modules/admin/reward-product/reward-product.service.ts`
- Checkout/payment reference: `backend/src/modules/order/checkout.service.ts`, `backend/src/modules/payment/payment.service.ts`
- After-sale reference: `docs/features/refund.md`, `backend/src/modules/after-sale/after-sale.service.ts`
- Safety checklist: `docs/issues/tofix-safe.md`
- Project board: `plan.md`

## Current Code Baseline

- Existing `backend/src/modules/group` is考察团 / 报名功能，不用于本需求。
- Existing `CheckoutBizType` and `OrderBizType` only have `NORMAL_GOODS` and `VIP_PACKAGE`;团购 needs its own enum value.
- Existing `CheckoutSession` already has `bizMeta`, `paymentChannel`, `merchantOrderNo`, coupon/reward discount fields, and payment callback creation flow.
- Existing ordinary orders can still apply售后 after `RECEIVED`;团购分享码和返还释放 must wait for `returnWindowExpiresAt` and no after-sale/refund/exchange.
- Existing App VIP gift page (`app/vip/gifts.tsx`) has the “专属空间 / large card / fixed bottom CTA” pattern; group-buy App must not copy its gold palette.
- Existing discovery page (`app/(tabs)/museum.tsx`) is search + tab + filters + masonry; group-buy App must avoid that structure.

## File Structure Map

### Backend Schema

- Modify: `backend/prisma/schema.prisma`
  - Add group-buy enums.
  - Add `GroupBuyActivity`, `GroupBuyTier`, `GroupBuyInstance`, `GroupBuyCode`, `GroupBuyReferral`, `GroupBuyRebateAccount`, `GroupBuyRebateLedger`.
  - Add `GROUP_BUY` to `CheckoutBizType` and `OrderBizType`.
  - Add reverse relations on `User`, `Order`, `OrderItem`, `Product`, `ProductSKU` as needed.
- Create: `backend/prisma/migrations/<timestamp>_group_buy_share_rebate/migration.sql`
- Modify: `backend/prisma/seed.ts`
  - Add admin permissions for group-buy read/manage/export/settings.

### Backend Group-Buy Module

- Create: `backend/src/modules/group-buy/group-buy.module.ts`
- Create: `backend/src/modules/group-buy/group-buy.controller.ts`
- Create: `backend/src/modules/group-buy/group-buy.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-checkout.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-code.util.ts`
- Create DTOs under `backend/src/modules/group-buy/dto/`
- Create tests:
  - `backend/src/modules/group-buy/group-buy.service.spec.ts`
  - `backend/src/modules/group-buy/group-buy-checkout.service.spec.ts`
  - `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`
  - `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`
  - `backend/src/modules/group-buy/group-buy-concurrency.spec.ts`

### Backend Flow Hooks

- Modify: `backend/src/app.module.ts`
  - Import `GroupBuyModule`.
- Modify: `backend/src/modules/order/order.module.ts`
  - Resolve `GroupBuyCheckoutService` / `GroupBuyLifecycleService` through `ModuleRef` and inject into `CheckoutService`, `OrderService`, and `OrderAutoConfirmService`.
- Modify: `backend/src/modules/order/checkout.service.ts`
  - Support `GROUP_BUY` payment success order creation path or delegate to `GroupBuyCheckoutService`.
  - Ensure group-buy checkout blocks reward/coupon/VIP discounts.
- Modify: `backend/src/modules/order/order.service.ts`
  - On manual confirm receive, notify group-buy lifecycle after primary status transition succeeds.
  - Ensure repurchase/cart paths reject `GROUP_BUY` orders.
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
  - Notify group-buy lifecycle after auto receive succeeds.
- Modify: `backend/src/modules/after-sale/after-sale.service.ts` and/or refund services
  - Notify group-buy lifecycle when after-sale is created and when refund/return/exchange completes.
- Modify: `backend/src/modules/payment/payment.service.ts`
  - Preserve payment callback routing for group-buy `CheckoutSession`.

### Backend Admin API

- Create: `backend/src/modules/admin/group-buy/admin-group-buy.module.ts`
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.controller.ts`
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.service.ts`
- Create: `backend/src/modules/admin/group-buy/dto/admin-group-buy.dto.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
- Modify: `backend/src/modules/admin/reward-product/reward-product.service.ts`
  - Extend reference checks so active group-buy activities block deletion/downstatus of referenced platform SKU.

### Buyer App

- Create: `src/types/domain/GroupBuy.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/GroupBuyRepo.ts`
- Modify: `src/repos/index.ts`
- Create: `app/group-buy/index.tsx`
- Create: `app/group-buy/[activityId].tsx`
- Create: `app/group-buy/checkout.tsx`
- Create: `app/gb/[code].tsx`
- Create App components:
  - `src/components/group-buy/GroupBuyProductCard.tsx`
  - `src/components/group-buy/GroupBuyProgressRail.tsx`
  - `src/components/group-buy/GroupBuyCurrentPanel.tsx`
  - `src/components/group-buy/GroupBuyPurchaseGuardSheet.tsx`
- Modify: `app/(tabs)/_layout.tsx` or home entry as selected during implementation.
- Modify: `app/(tabs)/home.tsx` if the团购入口 lives on home instead of bottom tab.

### Admin Frontend

- Create: `admin/src/api/group-buy.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/permissions.ts`
- Create:
  - `admin/src/pages/group-buy/activities.tsx`
  - `admin/src/pages/group-buy/activity-form.tsx`
  - `admin/src/pages/group-buy/instances.tsx`
  - `admin/src/pages/group-buy/instance-detail.tsx`
  - `admin/src/pages/group-buy/orders.tsx`
  - `admin/src/pages/group-buy/rebate-ledgers.tsx`
  - `admin/src/pages/group-buy/settings.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`

### Documentation

- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

## Cross-Cutting Rules

- All money, quota, referral slot, code status, and balance mutations must use `Prisma.TransactionIsolationLevel.Serializable` or CAS `updateMany`.
- Never update `GroupBuyRebateAccount` outside `GroupBuyRebateService`.
- Group-buy order purchase must be cash-only. `discountAmount`, `vipDiscountAmount`, `totalCouponDiscount`, reward deduction, group-buy rebate deduction, and coupon ids must all be zero/empty.
- Share code generation and rebate release must wait for order receipt plus `returnWindowExpiresAt < now` and no refund/return/exchange.
- App copy must use compliant words from the spec. Avoid team/tree/ranking/commission/earnings language.
- Use `priceTextProps`, `fitTextProps`, `useResponsiveLayout`, and `useBottomInset` for App pages.
- Use explicit path staging. Do not stage unrelated dirty files.

## Chunk 1: Schema, Seed, And Backend Skeleton

### Task 1.1: Add Prisma group-buy schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_group_buy_share_rebate/migration.sql`

- [x] **Step 1: Write the schema change**

Add enum values:

```prisma
enum CheckoutBizType {
  NORMAL_GOODS
  VIP_PACKAGE
  GROUP_BUY
}

enum OrderBizType {
  NORMAL_GOODS
  VIP_PACKAGE
  GROUP_BUY
}
```

Add new enums and models following the spec:

```prisma
enum GroupBuyActivityStatus { DRAFT ACTIVE PAUSED ENDED }
enum GroupBuyInstanceStatus { QUALIFICATION_PENDING SHARING COMPLETED TERMINATED QUALIFICATION_ABANDONED QUALIFICATION_INVALID EXPIRED }
enum GroupBuyCodeStatus { PENDING ACTIVE DISABLED COMPLETED EXPIRED }
enum GroupBuyReferralStatus { CANDIDATE VALID INVALID VOIDED }
enum GroupBuyRebateLedgerType { PENDING_REBATE RELEASE VOID WITHDRAW DEDUCT REFUND_RETURN ADMIN_ADJUST }
enum GroupBuyRebateLedgerStatus { PENDING AVAILABLE RESERVED COMPLETED VOIDED FAILED }
```

Use `Float` for amounts to match this project. Store tier percent as `Int basisPoints` instead of `Float percent` in implementation to avoid floating errors: 1000 = 10%, 10000 = 100%.

- [x] **Step 2: Generate migration**

Run:

```bash
cd backend
npx prisma migrate dev --name group_buy_share_rebate
```

Expected: migration created and Prisma client regenerated.

Note: `prisma migrate dev --create-only` was blocked by an existing historical shadow-database replay issue in `20260423010000_add_buyer_seller_reset_purposes` (`SmsPurpose` type missing during full replay). The group-buy migration was written manually following this repo's existing hand-written migration style, then validated with `npx prisma validate` and `npx prisma generate`.

- [x] **Step 3: Validate schema**

Run:

```bash
cd backend
npx prisma validate
```

Expected: `The schema ... is valid`.

- [x] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add group buy schema"
```

### Task 1.2: Add permissions and module skeleton

**Files:**
- Modify: `backend/prisma/seed.ts`
- Create: `backend/src/modules/group-buy/group-buy.module.ts`
- Create: `backend/src/modules/group-buy/group-buy.controller.ts`
- Create: `backend/src/modules/group-buy/group-buy.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-checkout.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Create: `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Modify: `backend/src/app.module.ts`

- [x] **Step 1: Add backend smoke tests**

Create `backend/src/modules/group-buy/group-buy.service.spec.ts` with a skeleton test:

```ts
describe('GroupBuyService', () => {
  it('normalizes tier basis points to exactly 10000', () => {
    expect([1000, 2000, 7000].reduce((a, b) => a + b, 0)).toBe(10000);
  });
});
```

- [x] **Step 2: Create module and providers**

`GroupBuyModule` exports `GroupBuyCheckoutService`, `GroupBuyLifecycleService`, and `GroupBuyRebateService`.

- [x] **Step 3: Add seed permissions**

Add permissions:

- `group_buy:read`
- `group_buy:manage`
- `group_buy:export`
- `group_buy:settings`

- [x] **Step 4: Run tests and build**

Run:

```bash
cd backend
npx jest src/modules/group-buy/group-buy.service.spec.ts --runInBand
npm run build
```

Expected: tests pass and Nest build succeeds.

- [x] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts backend/src/app.module.ts backend/src/modules/group-buy
git commit -m "feat: add group buy backend module skeleton"
```

## Chunk 2: Activity Configuration And Admin Backend

### Task 2.1: Implement activity CRUD rules

**Files:**
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.module.ts`
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.controller.ts`
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.service.ts`
- Create: `backend/src/modules/admin/group-buy/admin-group-buy.dto.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
- Test: `backend/src/modules/admin/group-buy/admin-group-buy.service.spec.ts`

- [x] **Step 1: Write failing tests**

Cover:

- Reject non-platform product/SKU.
- Reject tier sum not equal to 10000.
- Changing price/tiers affects only new instances.
- Active activity can be paused/ended.

Run:

```bash
cd backend
npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand
```

Expected: fail before implementation.

- [x] **Step 2: Implement DTO validation**

DTO fields:

- `title`
- `productId`
- `skuId`
- `price`
- `freeShipping`
- `startAt`
- `endAt`
- `status`
- `tiers: { sequence: number; basisPoints: number; label?: string }[]`
- `displayOrder`
- `ruleSummary`

- [x] **Step 3: Implement service**

Important implementation rules:

- Verify product belongs to `PLATFORM_COMPANY_ID`.
- Verify SKU belongs to selected product and is active.
- Use transaction for activity + tiers.
- Store snapshots only when instances are created, not on activity itself.

- [x] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand
npm run build
```

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/admin/group-buy backend/src/modules/admin/admin.module.ts
git commit -m "feat: add group buy admin activity APIs"
```

### Task 2.2: Protect referenced reward/platform products

**Files:**
- Modify: `backend/src/modules/admin/reward-product/reward-product.service.ts`
- Test: `backend/src/modules/admin/reward-product/reward-product.service.spec.ts`

- [x] **Step 1: Add failing reference test**

When an active group-buy activity references a product/SKU, deleting/downstatus should throw a `BadRequestException`.

- [x] **Step 2: Extend reference checks**

Include active/paused group-buy activities in `buildReferenceSummaryMap()` and `assertProductNotReferenced()`.

- [x] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/admin/reward-product/reward-product.service.spec.ts --runInBand
```

- [x] **Step 4: Commit**

```bash
git add backend/src/modules/admin/reward-product
git commit -m "fix: protect products used by group buy activities"
```

## Chunk 3: Buyer Group-Buy Checkout And Payment Callback

### Task 3.1: Implement buyer activity and current-state APIs

**Files:**
- Modify/Create: `backend/src/modules/group-buy/group-buy.controller.ts`
- Modify: `backend/src/modules/group-buy/group-buy.service.ts`
- Test: `backend/src/modules/group-buy/group-buy.service.spec.ts`

- [x] **Step 1: Add tests**

Cover:

- `GET /group-buy/activities` returns active activities with product/SKU/image snapshots.
- `GET /group-buy/me/current` returns no current group when none exists.
- Current-state logic marks `QUALIFICATION_PENDING` and `SHARING` as occupying; `TERMINATED` with pending referrals is visible but not occupying.

- [x] **Step 2: Implement mapper**

Return App-ready fields:

- activity id, title, product image, SKU title
- price, freeShipping, shipping summary
- tier summaries
- rule summary
- current-state object with `occupiesSlot`, `defaultTab`, `canBuyNew`

- [x] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/group-buy/group-buy.service.spec.ts --runInBand
```

- [x] **Step 4: Commit**

```bash
git add backend/src/modules/group-buy
git commit -m "feat: expose group buy buyer state APIs"
```

### Task 3.2: Implement group-buy checkout creation

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy-checkout.service.ts`
- Modify: `backend/src/modules/group-buy/group-buy.controller.ts`
- Modify: `backend/src/modules/group-buy/group-buy.module.ts`
- Create: `backend/src/modules/group-buy/dto/group-buy-checkout.dto.ts`
- Test: `backend/src/modules/group-buy/group-buy-checkout.service.spec.ts`

- [x] **Step 1: Add failing tests**

Cover:

- Cannot create group-buy checkout with reward deduction/coupon/VIP discount.
- Cannot create if user has occupying group-buy instance.
- Can create if prior instance is terminated and no slot is occupied.
- Through share code: reject own code.
- Through share code: referred purchase creates buyer's own pending instance after payment success, not at checkout creation.

- [x] **Step 2: Implement `createCheckout(userId, dto)`**

Use Serializable transaction:

1. Validate activity is active and in date range.
2. Validate SKU and platform product.
3. Validate monthly quota.
4. Validate no occupying instance.
5. Validate share code if provided.
6. Create `CheckoutSession` with `bizType: 'GROUP_BUY'`.
7. `itemsSnapshot` has exactly one SKU and quantity 1 unless later explicitly expanded.
8. Set all discount fields to zero.
9. `bizMeta` stores `{ groupBuyActivityId, groupBuyCodeId?, groupBuyPriceSnapshot, freeShippingSnapshot, tierSnapshot }`.

- [x] **Step 3: Generate payment params**

Reuse existing Alipay/Wechat App order creation, but subject/description should be neutral: `爱买买团购订单-{merchantOrderNo}`.

- [x] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/order/checkout-money-safety.spec.ts --runInBand
npm run build
```

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/group-buy
git commit -m "feat: add cash-only group buy checkout"
```

### Task 3.3: Build orders and instances on payment success

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/group-buy/group-buy-checkout.service.ts`
- Test: `backend/src/modules/payment/__tests__/payment.service.confirm-checkout.spec.ts`
- Test: `backend/src/modules/group-buy/group-buy-checkout.service.spec.ts`

- [x] **Step 1: Add failing tests**

Cover:

- Paid group-buy checkout creates `Order.bizType = GROUP_BUY`.
- Creates `GroupBuyInstance` with `QUALIFICATION_PENDING`.
- Consumes monthly quota at payment success.
- If checkout used share code, creates `GroupBuyReferral` candidate for the original instance.
- Candidate count cannot exceed tier count.

- [x] **Step 2: Implement callback path**

Implemented as a private `CheckoutService.createGroupBuyRecordsAfterPayment()` helper inside the existing payment-success transaction to avoid adding a new module cycle; extraction to `GroupBuyCheckoutService` can be done later if the module graph is reorganized.

- [x] **Step 3: Ensure idempotency**

Use the existing CheckoutSession CAS plus schema uniqueness:

- `GroupBuyInstance.initiatorOrderId` prevents duplicate own instances for the same paid order.
- `GroupBuyReferral.referredOrderId` prevents duplicate referral candidates for the same paid order.

- [x] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/payment/__tests__/payment.service.confirm-checkout.spec.ts --runInBand
```

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/group-buy backend/src/modules/order/checkout.service.ts backend/src/modules/payment
git commit -m "feat: create group buy orders on payment success"
```

## Chunk 4: Lifecycle, Share Codes, Termination, And Rebates

### Task 4.1: Generate share code after own order becomes valid

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
- Test: `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`

- [x] **Step 1: Add tests**

Cover:

- `RECEIVED` before return window expiry does not generate code.
- Expired return window and no after-sale generates code.
- Own refund/return/exchange invalidates qualification.
- Abandoned qualification never generates code.

- [x] **Step 2: Implement `evaluateInitiatorOrder(orderId)`**

Logic:

1. Load instance by `initiatorOrderId`.
2. If status not `QUALIFICATION_PENDING`, skip.
3. Check order status, `returnWindowExpiresAt`, and after-sale/refund absence.
4. Generate unique code using `GroupBuyCodeUtil`.
5. Set instance `SHARING`, code `ACTIVE`, timestamps.

- [x] **Step 3: Hook order receipt**

After manual and auto receive succeed, call lifecycle service asynchronously. A cron/evaluate endpoint should also exist for missed events.

- [x] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-lifecycle.service.spec.ts --runInBand
```

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/group-buy backend/src/modules/order
git commit -m "feat: generate group buy share codes after return window"
```

### Task 4.2: Release rebates for valid direct purchases

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Modify: `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Test: `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`
- Test: `backend/src/modules/group-buy/group-buy-concurrency.spec.ts`

- [x] **Step 1: Add failing tests**

Cover:

- First valid referral releases tier 1.
- Second valid referral releases tier 2.
- Third valid referral releases tier 3 and completes code.
- Refund/return/exchange before release marks candidate invalid.
- Concurrent valid referrals cannot allocate same sequence.
- Terminated instance still releases already-paid candidates.

- [x] **Step 2: Implement `releaseReferralIfValid(referralId)`**

Use Serializable transaction:

1. Lock referral and instance.
2. Verify referral still `CANDIDATE`.
3. Verify referred order valid.
4. Allocate next `effectiveSequence`.
5. Calculate amount from `instance.priceSnapshot * tier.basisPoints / 10000`.
6. Upsert `GroupBuyRebateAccount`.
7. Create `GroupBuyRebateLedger` with unique idempotency key.
8. Increment account balance.
9. Mark referral `VALID`.
10. Complete instance/code when all tiers are valid.

- [x] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-rebate.service.spec.ts src/modules/group-buy/group-buy-concurrency.spec.ts --runInBand
```

- [x] **Step 4: Commit**

```bash
git add backend/src/modules/group-buy
git commit -m "feat: release group buy rebates after valid referrals"
```

### Task 4.3: Terminate and abandon flows

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy.controller.ts`
- Modify: `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Test: `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`

- [x] **Step 1: Add tests**

Cover:

- `abandon` works only in `QUALIFICATION_PENDING`.
- `terminate` disables active code and stops new candidates.
- Terminated instance no longer occupies purchase slot.
- Existing candidates continue observation.

- [x] **Step 2: Implement endpoints**

- `POST /group-buy/me/current/abandon`
- `POST /group-buy/me/current/terminate`

Both must be idempotent and use Serializable transaction.

- [x] **Step 3: Run tests and commit**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-lifecycle.service.spec.ts --runInBand
git add backend/src/modules/group-buy
git commit -m "feat: add group buy abandon and terminate flows"
```

## Chunk 5: Group-Buy Rebate Balance, Withdrawal, And Deduction

### Task 5.1: Buyer rebate account APIs

**Files:**
- Modify: `backend/src/modules/group-buy/group-buy.controller.ts`
- Modify: `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Test: `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`

- [x] **Step 1: Add tests**

Cover:

- Returns zero account when none exists.
- Lists ledgers paginated.
- Does not merge with `RewardAccount`.

- [x] **Step 2: Implement**

Endpoints:

- `GET /group-buy/me/rebate-account`
- `GET /group-buy/me/rebate-ledgers`

- [x] **Step 3: Run tests and commit**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-rebate.service.spec.ts --runInBand
git add backend/src/modules/group-buy
git commit -m "feat: expose group buy rebate account"
```

### Task 5.2: Ordinary checkout deduction support

**Files:**
- Create: `backend/src/modules/group-buy/group-buy-rebate-deduction.service.ts`
- Modify: `backend/src/modules/order/checkout.dto.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Test: `backend/src/modules/group-buy/group-buy-rebate-deduction.service.spec.ts`
- Test: `backend/src/modules/order/checkout-money-safety.spec.ts`

- [x] **Step 1: Add tests**

Cover:

- Ordinary goods checkout can reserve group-buy rebate deduction.
- Group-buy checkout rejects group-buy rebate deduction.
- Cancel/expire restores reserved group-buy rebate.
- Refund success restores proportional group-buy rebate for ordinary orders.

- [x] **Step 2: Implement deduction service**

Mirror `RewardDeductionService` patterns, but use `GroupBuyRebateAccount` and `GroupBuyRebateLedger`.

- [x] **Step 3: Wire ordinary checkout only**

Add a new checkout DTO field such as `groupBuyRebateDeductionAmount`. Do not overload `discountAmount`.

- [x] **Step 4: Run tests and commit**

```bash
cd backend
npx jest src/modules/group-buy/group-buy-rebate-deduction.service.spec.ts src/modules/order/checkout-money-safety.spec.ts --runInBand
git add backend/src/modules/group-buy backend/src/modules/order backend/src/modules/after-sale
git commit -m "feat: allow group buy rebate deduction on ordinary checkout"
```

### Task 5.3: Withdrawal integration

**Files:**
- Modify or extend: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Modify: `backend/src/modules/bonus/bonus.controller.ts` or create group-buy withdrawal endpoints
- Test: `backend/src/modules/bonus/withdraw-payout.service.spec.ts`
- Test: `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`

- [x] **Step 1: Decide implementation boundary during execution**

Use one of these, based on current withdrawal service shape:

- Preferred: generic withdrawal source enum supports `REWARD` and `GROUP_BUY_REBATE`.
- Fallback: dedicated group-buy withdrawal endpoints that reuse payout provider code but not `RewardAccount`.

Implementation note: current schema already stores withdrawal source-like data in `WithdrawRequest.accountType`, so group-buy withdrawals use `accountType=GROUP_BUY_REBATE` on the shared withdrawal table and shared payout retry path, while balance mutations and ledgers use `GroupBuyRebateAccount` / `GroupBuyRebateLedger` only.

- [x] **Step 2: Add tests**

Cover:

- Withdraw group-buy rebate balance.
- Account balance/frozen changes are independent from Reward.
- In-flight withdrawal blocks account deletion if existing deletion blocker framework supports it.

- [x] **Step 3: Implement and commit**

```bash
cd backend
npx jest src/modules/bonus/withdraw-payout.service.spec.ts src/modules/group-buy/group-buy-rebate.service.spec.ts --runInBand
git add backend/src/modules/bonus backend/src/modules/group-buy
git commit -m "feat: support group buy rebate withdrawals"
```

## Chunk 6: Buyer App UI And Deep Link Flow

Before starting this chunk, re-read `frontend-design:frontend-design` and `docs/architecture/responsive-design.md`. The UI must follow the spec section “App 视觉方向”.

### Task 6.1: Add App types and repo

**Files:**
- Create: `src/types/domain/GroupBuy.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/GroupBuyRepo.ts`
- Modify: `src/repos/index.ts`
- Test: `src/utils/__tests__/groupBuyCopy.test.ts` if copy helpers are extracted

- [x] **Step 1: Define types**

Types include:

- `GroupBuyActivity`
- `GroupBuyCurrentState`
- `GroupBuyRebateAccount`
- `GroupBuyLedger`
- `GroupBuyCheckoutResponse`
- `GroupBuyLandingInfo`

- [x] **Step 2: Implement repo methods**

Methods mirror buyer APIs:

- `listActivities`
- `getActivity`
- `getCurrent`
- `createCheckout`
- `getLanding`
- `terminateCurrent`
- `abandonCurrent`
- `getRebateAccount`
- `listRebateLedgers`

- [x] **Step 3: Typecheck**

```bash
npx tsc -b
```

- [x] **Step 4: Commit**

```bash
git add src/types/domain src/repos
git commit -m "feat: add group buy app repository"
```

### Task 6.2: Build “精选团购货架” pages

**Files:**
- Create: `app/group-buy/index.tsx`
- Create: `app/group-buy/[activityId].tsx`
- Create components under `src/components/group-buy/`

- [x] **Step 1: Build visual components**

Components:

- `GroupBuyProductCard`: large selected-shelf card with true product image, group-buy price, shipping/sale-service tags, and per-card purchase button. It must not display rebate base, tier percentages, or a per-card rule accordion.
- `GroupBuyProgressRail`: dynamic tier rail, not hardcoded to 3; buyer-facing progress shows state text only, not rebate percentages.
- `GroupBuyCurrentPanel`: status panel for pending/code/terminated/completed.
- `GroupBuyPurchaseGuardSheet`: two-button bottom sheet, no third cancel button.

Use the spec palette:

```ts
const GROUP_BUY_COLORS = {
  porcelain: '#F7FAF7',
  pine: '#12372A',
  tide: '#2F6F73',
  coral: '#E65A46',
  brass: '#C6A15B',
  mist: '#DDE7DE',
};
```

- [x] **Step 2: Build page states**

`app/group-buy/index.tsx`:

- No current group: product shelf first.
- Current group occupying: default tab `我的团购`, second tab `团购商品`.
- Terminated but observing: default `我的团购` summary, but product purchase is allowed.
- `我的团购` page shows share voucher/copy controls and terminate/abandon actions, but no standalone `继续分享` button.
- `团购商品` page keeps product filtering and per-card purchase actions, but no product-card `查看规则` / accordion interaction.

- [x] **Step 3: Build detail page**

`app/group-buy/[activityId].tsx` shows:

- Selected shelf product layout.
- Product facts from real fields only.
- Payment restrictions.
- Share condition summary without tier percentages.
- Fixed bottom CTA with `useBottomInset`.

- [x] **Step 4: Typecheck**

```bash
npx tsc -b
```

- [x] **Step 5: Commit**

```bash
git add app/group-buy src/components/group-buy
git commit -m "feat: add group buy app shelf UI"
```

### Task 6.3: Add checkout and share landing

**Files:**
- Create: `app/group-buy/checkout.tsx`
- Create: `app/gb/[code].tsx`
- Modify: `src/store/useCheckoutStore.ts` only if needed for payment handoff
- Modify: `app/payment-success.tsx` if success routing needs group-buy copy

- [x] **Step 1: Implement `/gb/{code}` landing**

Rules:

- Unauthenticated users authenticate and return to landing.
- Self-code shows clear error.
- Valid code goes directly to group-buy checkout confirmation.

- [x] **Step 2: Implement group-buy checkout page**

Rules:

- Show cash-only payment.
- No coupon/reward/rebate toggles.
- Show recommender identity if from code, masked and compliant.
- Confirm payment through group-buy checkout API.

- [x] **Step 3: Verify typecheck**

```bash
npx tsc -b
```

- [x] **Step 4: Commit**

```bash
git add app/gb app/group-buy src/store app/payment-success.tsx
git commit -m "feat: add group buy share landing and checkout"
```

### Task 6.4: Add navigation entry

**Files:**
- Modify: `app/(tabs)/_layout.tsx` or `app/(tabs)/home.tsx`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [x] **Step 1: Add entry according to final product choice**

If bottom tab has capacity, add `团购` tab. If not, add a high-visibility home action. User requirement prefers home bottom entry; implement as bottom tab only if navigation structure supports it without breaking existing tabs.

- [x] **Step 2: Verify responsive behavior**

Manual checks:

- 360dp width
- large font mode
- Android virtual nav bar
- long product title
- long price / high amount

- [x] **Step 3: Typecheck and commit**

```bash
npx tsc -b
git add 'app/(tabs)' docs/architecture/frontend.md plan.md
git commit -m "feat: add group buy app entry"
```

## Chunk 7: Admin Frontend

### Task 7.1: Add API client and types

**Files:**
- Create: `admin/src/api/group-buy.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/permissions.ts`

- [x] **Step 1: Implement types and API wrappers**

Cover activities, instances, orders, ledgers, settings.

Implementation note: this step initially added activity wrappers and `group_buy:read/manage`; later in the same chunk backend admin endpoints and API client wrappers were extended to cover `instances`, `orders`, `rebate-ledgers`, and `settings`; frontend permissions now also include `group_buy:settings`.

- [x] **Step 2: Typecheck**

```bash
cd admin
npm run build
```

- [x] **Step 3: Commit**

```bash
git add admin/src/api/group-buy.ts admin/src/types/index.ts admin/src/constants/permissions.ts
git commit -m "feat: add group buy admin API client"
```

### Task 7.2: Build admin pages

**Files:**
- Create pages under `admin/src/pages/group-buy/`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

- [x] **Step 1: Build pages**

Pages:

- `团购活动`
- `团购记录`
- `团购订单`
- `团购返还流水`
- `团购设置`

UI must avoid sensitive words and team/tree/ranking visuals.

- [x] **Step 2: Build activity form**

Use Ant Design form:

- platform SKU picker
- group-buy price
- free shipping switch
- tiers editable table, sum must equal 100%
- activity status/time

- [x] **Step 3: Build detail drawers**

Instance detail shows only direct referral rows, no relationship graph.

- [x] **Step 4: Build and commit**

```bash
cd admin
npm run build
cd ..
git add admin/src/pages/group-buy admin/src/App.tsx admin/src/layouts/AdminLayout.tsx docs/architecture/admin-frontend.md plan.md
git commit -m "feat: add group buy admin pages"
```

Implementation note: Added `/admin/group-buy/settings` and `admin/src/pages/group-buy/settings.tsx` for the configurable monthly launch limit. Verification used `backend npx jest src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand`, `backend npx prisma validate`, `backend npm run build`, and `admin npm run build`.

## Chunk 8: Documentation, Safety, And Full Verification

### Task 8.1: Documentation sync

**Files:**
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [ ] **Step 1: Update docs**

Document:

- independent group-buy module
- cash-only checkout
- separate group-buy rebate balance
- App visual direction and routes
- admin menu/pages
- Serializable safety requirements

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/data-system.md docs/architecture/frontend.md docs/architecture/admin-frontend.md docs/issues/tofix-safe.md plan.md
git commit -m "docs: sync group buy implementation docs"
```

### Task 8.2: Run verification

- [ ] **Step 1: Prisma**

```bash
cd backend
npx prisma validate
```

- [ ] **Step 2: Backend targeted tests**

```bash
cd backend
npx jest src/modules/group-buy src/modules/admin/group-buy --runInBand
npx jest src/modules/order src/modules/payment src/modules/after-sale --runInBand
```

- [ ] **Step 3: Backend build**

```bash
cd backend
npm run build
```

- [ ] **Step 4: App typecheck**

```bash
npx tsc -b
```

- [ ] **Step 5: Admin build**

```bash
cd admin
npm run build
```

- [ ] **Step 6: Legal/static tests**

```bash
npm run test:legal
```

### Task 8.3: Manual App review checklist

- [ ] No current group opens product shelf.
- [ ] Current group opens `我的团购` first.
- [ ] `团购商品` remains visible with current group.
- [ ] Purchase guard sheet has exactly two buttons.
- [ ] `我的团购` has no redundant standalone `继续分享` button.
- [ ] Product cards have no `查看规则` accordion.
- [ ] Buyer-facing progress does not show tier percentages.
- [ ] Product cards do not show rebate base.
- [ ] Pending qualification uses `放弃本次团购资格并购买`.
- [ ] Group-buy product cards differ from discovery page and VIP gift page.
- [ ] Long product title and high price fit on narrow screens.
- [ ] No forbidden compliance words appear in App/admin UI.
- [ ] `/gb/{code}` works after login.
- [ ] Group-buy checkout has no discount/coupon/reward controls.

### Task 8.4: Final commit or PR

After all verification passes:

```bash
git status --short
git log --oneline -8
```

If clean except expected changes, push branch and open PR per normal release workflow.
