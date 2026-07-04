# 普通会员增长、分享码与成长系统 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/superpowers/specs/2026-07-03-normal-member-growth-share-design.md`，建立普通分享码、普通积分、成长值、积分兑换、会员等级和管理后台会员成长运营体系，同时复用现有红包系统。

**Status:** 2026-07-04 已在 `codex/normal-member-growth` 实现后端 Growth/NormalShare、管理后台会员成长、买家 App 普通成长中心、官网 `/s/{code}` 普通分享落地页和 App 延迟深链隔离；红包奖励复用现有 Coupon 能力。

**Architecture:** 新增独立 Growth 模块承载普通积分/成长值账户、流水、规则、等级、兑换和事件处理；新增 NormalShare 模块承载普通分享码和归因关系；管理后台新增“会员成长”菜单和配置页面。现有 Coupon/CouponCampaign/CouponInstance 链路只作为发券能力被调用，不重写红包模型、核销、订单抵扣或红包后台主链路。

**Tech Stack:** NestJS + Prisma + PostgreSQL + Jest；React Native + Expo + expo-router + React Query；Vite + React + Ant Design ProTable/ProForm；官网 Vite React。

**Authoritative spec:** `docs/superpowers/specs/2026-07-03-normal-member-growth-share-design.md`。

---

## Scope Guard

- 红包系统只复用，不重写、不替换、不大改。
- 普通积分不得写入 `RewardAccount`，不得提现，不得直接抵扣订单现金金额。
- 成长值不得消耗、不得兑换现金、不得影响普通树或 VIP 树收益。
- 普通分享码不得复用 `MemberProfile.referralCode`，不得走 `/r/{code}`，不得进入 VIP 树。
- 团购 `/gb/{code}`、VIP `/r/{code}`、普通分享 `/s/{code}` 三条链路必须隔离。
- 涉及积分余额、兑换、冲正、邀请奖励发放的写入必须幂等；余额类写入使用 Serializable 事务。

## File Map

### Prisma / Seed

- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/prisma/seed.ts`
- Create: `backend/prisma/migrations/<timestamp>_growth_member_system/migration.sql`

### Backend: Growth

- Create: `backend/src/modules/growth/growth.module.ts`
- Create: `backend/src/modules/growth/growth.controller.ts`
- Create: `backend/src/modules/growth/growth.service.ts`
- Create: `backend/src/modules/growth/growth-event.service.ts`
- Create: `backend/src/modules/growth/growth-exchange.service.ts`
- Create: `backend/src/modules/growth/growth-level.service.ts`
- Create: `backend/src/modules/growth/growth-expire.service.ts`
- Create: `backend/src/modules/growth/growth-coupon-adapter.service.ts`
- Create: `backend/src/modules/growth/dto/*.dto.ts`
- Create: `backend/src/modules/growth/*.spec.ts`
- Modify: `backend/src/app.module.ts`

### Backend: Normal Share

- Create: `backend/src/modules/normal-share/normal-share.module.ts`
- Create: `backend/src/modules/normal-share/normal-share.controller.ts`
- Create: `backend/src/modules/normal-share/normal-share.service.ts`
- Create: `backend/src/modules/normal-share/normal-share-deferred.service.ts`
- Create: `backend/src/modules/normal-share/dto/*.dto.ts`
- Create: `backend/src/modules/normal-share/*.spec.ts`
- Modify: `backend/src/app.module.ts`

### Backend: Existing Event Integration

- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/check-in/check-in.service.ts`
- Modify: `backend/src/modules/task/task.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts` or the actual refund-success handler after inspection
- Keep existing Coupon services intact; only add a narrow public issue method if no existing public method can issue a configured campaign safely.

### Backend: Admin

- Create: `backend/src/modules/admin/growth/admin-growth.module.ts`
- Create: `backend/src/modules/admin/growth/admin-growth.controller.ts`
- Create: `backend/src/modules/admin/growth/admin-growth.service.ts`
- Create: `backend/src/modules/admin/growth/dto/*.dto.ts`
- Create: `backend/src/modules/admin/growth/*.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
- Modify: `backend/src/modules/admin/common/constants.ts` if backend permission seed/constants require it

### Admin Frontend

- Modify: `admin/src/constants/permissions.ts`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Create: `admin/src/api/growth.ts`
- Create: `admin/src/pages/growth/dashboard.tsx`
- Create: `admin/src/pages/growth/behavior-rules.tsx`
- Create: `admin/src/pages/growth/categories.tsx`
- Create: `admin/src/pages/growth/levels.tsx`
- Create: `admin/src/pages/growth/exchange-items.tsx`
- Create: `admin/src/pages/growth/new-user-path.tsx`
- Create: `admin/src/pages/growth/share-codes.tsx`
- Create: `admin/src/pages/growth/user-records.tsx`
- Create: `admin/src/pages/growth/risk-events.tsx`
- Create: `admin/src/pages/growth/settings.tsx`
- Modify: `admin/src/types/index.ts`

### Buyer App

- Create: `src/types/domain/Growth.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/GrowthRepo.ts`
- Create: `src/repos/NormalShareRepo.ts`
- Modify: `src/repos/index.ts`
- Modify: `app/(tabs)/me.tsx`
- Create: `app/me/growth.tsx`
- Create: `app/me/points-exchange.tsx`
- Modify: `app/me/referral.tsx` or split into `app/me/share-code.tsx`
- Modify: `app/me/wallet.tsx` copy only, not wallet accounting logic
- Modify: `app/me/vip.tsx` copy and upgrade bridge

### Website

- Modify: `website/src/App.tsx`
- Create: `website/src/pages/NormalShareLanding.tsx`
- Modify: `website/src/pages/Resolve.tsx` or create separate normal-share resolver if current `/resolve` must remain VIP-only
- Modify: `website/src/lib/api.ts`

### Docs

- Modify after backend/admin: `docs/architecture/admin-frontend.md`
- Modify after buyer App: `docs/architecture/frontend.md`
- Modify after backend: `docs/architecture/backend.md`
- Modify after final implementation: `plan.md`

---

## Chunk 1: Schema 与 Growth 底座

### Task 1: Add Growth and NormalShare schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/prisma/seed.ts`
- Create: `backend/prisma/migrations/<timestamp>_growth_member_system/migration.sql`

- [ ] **Step 1: Write schema validation test note**

No Jest test is needed before schema edit. The failing check is Prisma validation after schema additions.

- [ ] **Step 2: Add enums or string-status comments**

Prefer Prisma enums if existing schema style allows:

```prisma
enum GrowthLedgerType {
  POINTS_EARN
  POINTS_SPEND
  POINTS_EXPIRE
  POINTS_REVERSE
  GROWTH_EARN
  GROWTH_REVERSE
  ADMIN_ADJUST
}

enum GrowthLedgerStatus {
  POSTED
  REVERSED
  VOIDED
}
```

- [ ] **Step 3: Add models**

Add models from the spec:

- `GrowthAccount`
- `GrowthLedger`
- `GrowthBehaviorCategory`
- `GrowthBehaviorRule`
- `GrowthLevel`
- `GrowthExchangeItem`
- `GrowthExchangeRecord`
- `NormalShareProfile`
- `NormalShareBinding`

Add indexes for query paths:

```prisma
@@index([userId, createdAt])
@@index([behaviorCode, createdAt])
@@index([refType, refId])
@@index([expiresAt])
```

- [ ] **Step 4: Seed defaults**

Add default behavior categories, behavior rules, levels, and growth settings to `backend/prisma/seed.ts`.

Defaults must match the spec values for:

- `NEWBIE`, `DAILY`, `SHOPPING`, `SHARE`, `INVITE`, `VIP`
- 新芽会员 through 星农会员
- register/sign-in/browse/favorite/share/first-order/review/repurchase/invite/VIP purchase rules

- [ ] **Step 5: Validate schema**

Run:

```bash
cd backend
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 6: Generate client**

Run:

```bash
cd backend
npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/seed.ts backend/prisma/migrations
git commit -m "feat: add growth member schema"
```

### Task 2: Add Growth module skeleton

**Files:**
- Create: `backend/src/modules/growth/growth.module.ts`
- Create: `backend/src/modules/growth/growth.controller.ts`
- Create: `backend/src/modules/growth/growth.service.ts`
- Create: `backend/src/modules/growth/growth-event.service.ts`
- Create: `backend/src/modules/growth/growth-level.service.ts`
- Create: `backend/src/modules/growth/growth.service.spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing service test**

Create `backend/src/modules/growth/growth.service.spec.ts`:

```ts
describe('GrowthService', () => {
  it('returns empty account defaults when user has no growth account', async () => {
    const prisma: any = {
      growthAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      growthLevel: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new GrowthService(prisma);
    await expect(service.getMe('u1')).resolves.toMatchObject({
      pointsBalance: 0,
      growthValue: 0,
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
cd backend
npx jest src/modules/growth/growth.service.spec.ts --runInBand
```

Expected: FAIL because module/service does not exist.

- [ ] **Step 3: Implement minimal module**

Implement:

- `GrowthService.getMe(userId)`
- `GrowthLevelService.resolveLevel(growthValue)`
- `GrowthController.GET /growth/me`

Register `GrowthModule` in `backend/src/app.module.ts`.

- [ ] **Step 4: Run test**

Run:

```bash
cd backend
npx jest src/modules/growth/growth.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/growth backend/src/app.module.ts
git commit -m "feat: add growth module skeleton"
```

---

## Chunk 2: 行为规则、发放、冲正与过期

### Task 3: Implement GrowthEventService with idempotent grants

**Files:**
- Modify: `backend/src/modules/growth/growth-event.service.ts`
- Create: `backend/src/modules/growth/growth-event.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- disabled rule does not grant
- idempotency key prevents duplicate grant
- daily/lifetime limits block repeated events
- VIP multipliers apply only when member is VIP
- `GrowthAccount` and `UserProfile` read cache update together

- [ ] **Step 2: Run failing tests**

```bash
cd backend
npx jest src/modules/growth/growth-event.service.spec.ts --runInBand
```

Expected: FAIL.

- [ ] **Step 3: Implement event processing**

Implement `receive(event)`:

```ts
type GrowthEvent = {
  userId: string;
  behaviorCode: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
};
```

Use Serializable transaction for:

- create `GrowthLedger`
- upsert/update `GrowthAccount`
- update `UserProfile.points/growthPoints/level/levelProgress` as read cache

- [ ] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/growth/growth-event.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/growth/growth-event.service.ts backend/src/modules/growth/growth-event.service.spec.ts
git commit -m "feat: grant growth rewards by behavior rule"
```

### Task 4: Implement reversal and expiration

**Files:**
- Create: `backend/src/modules/growth/growth-expire.service.ts`
- Create: `backend/src/modules/growth/growth-expire.service.spec.ts`
- Modify: `backend/src/modules/growth/growth-event.service.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- `reverseByRef(refType, refId)` creates reverse ledger and does not delete original
- reverse is idempotent
- points expiration deducts only ordinary points
- growth value never expires automatically

- [ ] **Step 2: Implement**

Add:

- `GrowthEventService.reverseByRef`
- `GrowthExpireService.expirePoints`
- Cron with Redis/schedule lock if existing infra pattern is available

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/growth/growth-expire.service.spec.ts src/modules/growth/growth-event.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/growth
git commit -m "feat: add growth reversal and expiration"
```

---

## Chunk 3: 红包复用与积分兑换

### Task 5: Add coupon adapter without rewriting coupon logic

**Files:**
- Create: `backend/src/modules/growth/growth-coupon-adapter.service.ts`
- Create: `backend/src/modules/growth/growth-coupon-adapter.service.spec.ts`
- Modify minimally if required: `backend/src/modules/coupon/coupon.service.ts`

- [ ] **Step 1: Inspect existing coupon public methods**

Check:

```bash
rg -n "handleTrigger|manualIssue|issue" backend/src/modules/coupon
```

Use existing `CouponEngineService.handleTrigger` for trigger-based coupons. For configured exchange items that must issue a specific campaign, prefer a narrow public wrapper in `CouponService` that reuses existing issue internals. Do not duplicate `CouponInstance` creation.

- [ ] **Step 2: Write failing adapter tests**

Cover:

- calls existing coupon trigger/campaign issue API
- does not create CouponInstance directly in Growth code
- propagates failure so积分扣减 can rollback

- [ ] **Step 3: Implement adapter**

`GrowthCouponAdapterService.issueExchangeCoupon({ userId, campaignId, source })`.

- [ ] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/growth/growth-coupon-adapter.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/growth/growth-coupon-adapter.service.ts backend/src/modules/growth/growth-coupon-adapter.service.spec.ts backend/src/modules/coupon/coupon.service.ts
git commit -m "feat: reuse coupons for growth rewards"
```

### Task 6: Implement exchange items

**Files:**
- Modify: `backend/src/modules/growth/growth-exchange.service.ts`
- Create: `backend/src/modules/growth/growth-exchange.service.spec.ts`
- Modify: `backend/src/modules/growth/growth.controller.ts`
- Create/modify DTOs in `backend/src/modules/growth/dto/`

- [ ] **Step 1: Write failing tests**

Cover:

- insufficient points rejected
- level gate rejected
- per-user daily/monthly limit enforced
- stock limit enforced
- coupon issue failure rolls back points deduction
- success creates `GrowthExchangeRecord` and `GrowthLedger`

- [ ] **Step 2: Implement**

Endpoints:

```text
GET  /growth/exchange/items
POST /growth/exchange/:itemId
GET  /growth/exchange/records
```

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/growth/growth-exchange.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/growth
git commit -m "feat: add growth points exchange"
```

---

## Chunk 4: 普通分享码与归因

### Task 7: Implement NormalShare module

**Files:**
- Create: `backend/src/modules/normal-share/normal-share.module.ts`
- Create: `backend/src/modules/normal-share/normal-share.controller.ts`
- Create: `backend/src/modules/normal-share/normal-share.service.ts`
- Create: `backend/src/modules/normal-share/normal-share.service.spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- creates one share code per user
- same user gets same code on repeat
- cannot bind own code
- invitee can only bind once
- disabled inviter code rejected
- VIP referral relationship is not overwritten

- [ ] **Step 2: Implement service and buyer endpoints**

Endpoints:

```text
GET  /normal-share/me
POST /normal-share/bind
GET  /normal-share/stats
GET  /normal-share/records
```

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/normal-share/normal-share.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/normal-share backend/src/app.module.ts
git commit -m "feat: add normal share codes"
```

### Task 8: Implement deferred normal-share landing support

**Files:**
- Create: `backend/src/modules/normal-share/normal-share-deferred.service.ts`
- Create: `backend/src/modules/normal-share/normal-share-deferred.service.spec.ts`
- Modify: `backend/src/modules/normal-share/normal-share.controller.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- `/s/{code}` create endpoint rejects invalid/disabled code
- stores cookie/fingerprint record
- resolve returns pending normal share code
- VIP deferred-link records are not touched

- [ ] **Step 2: Implement endpoints**

```text
POST /normal-share/deferred/create
GET  /normal-share/deferred/resolve
```

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/normal-share/normal-share-deferred.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/normal-share
git commit -m "feat: add normal share deferred attribution"
```

---

## Chunk 5: 业务事件接入

### Task 9: Register/check-in/task events

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/check-in/check-in.service.ts`
- Modify: `backend/src/modules/task/task.service.ts`
- Add specs near changed modules as needed

- [ ] **Step 1: Write failing tests**

Cover:

- register triggers `REGISTER`
- check-in triggers `CHECK_IN` while preserving existing coupon trigger
- task completion uses GrowthEventService instead of direct-only `UserProfile` increments where applicable
- existing `CouponEngineService.handleTrigger` calls remain intact

- [ ] **Step 2: Implement minimal event calls**

Inject `GrowthEventService` and call it after existing business writes succeed. Use idempotency keys:

```text
REGISTER:{userId}
CHECK_IN:{userId}:{yyyy-mm-dd}
TASK:{userId}:{taskId}
```

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/check-in/check-in.service.spec.ts src/modules/task/task.service.spec.ts --runInBand
```

Expected: PASS. If no existing specs, add focused specs for the changed service.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/auth backend/src/modules/check-in backend/src/modules/task
git commit -m "feat: connect growth events to onboarding tasks"
```

### Task 10: Order and refund events

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify after inspection: refund success service under `backend/src/modules/after-sale/`
- Add/modify focused specs under `backend/src/modules/order/` and `backend/src/modules/after-sale/`

- [ ] **Step 1: Locate confirmed receive and refund success paths**

Run:

```bash
rg -n "confirmReceive|RECEIVED|refund success|handleRefundSuccess|退款成功" backend/src/modules/order backend/src/modules/after-sale
```

- [ ] **Step 2: Write failing tests**

Cover:

- first ordinary order received triggers `FIRST_ORDER_RECEIVED`
- repeat ordinary order received triggers `REPURCHASE_RECEIVED`
- VIP package, group-buy, zero-yuan/prize-only orders do not trigger normal invite first-order reward
- refund/return/exchange success reverses shopping growth ledgers

- [ ] **Step 3: Implement**

Use idempotency keys:

```text
FIRST_ORDER_RECEIVED:{userId}:{orderId}
REPURCHASE_RECEIVED:{userId}:{orderId}
REVIEW_ORDER:{userId}:{orderId}:{reviewId}
NORMAL_INVITE_FIRST_ORDER:{inviteeUserId}:{orderId}
```

- [ ] **Step 4: Run tests**

```bash
cd backend
npx jest src/modules/order --runInBand
```

Expected: relevant order tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/order backend/src/modules/after-sale
git commit -m "feat: connect growth rewards to orders"
```

---

## Chunk 6: 管理后台 API

### Task 11: Admin Growth backend

**Files:**
- Create: `backend/src/modules/admin/growth/admin-growth.module.ts`
- Create: `backend/src/modules/admin/growth/admin-growth.controller.ts`
- Create: `backend/src/modules/admin/growth/admin-growth.service.ts`
- Create: `backend/src/modules/admin/growth/admin-growth.service.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- list/update behavior rules
- reject unknown behavior code creation unless code is in registered-event allowlist
- level thresholds must be increasing and include 0
- exchange item with coupon type requires `couponCampaignId`
- user manual adjustment requires reason and writes audit-compatible metadata

- [ ] **Step 2: Implement admin endpoints**

Implement endpoints from spec section 12.

Use `@Public()`, `AdminAuthGuard`, `PermissionGuard`, `@RequirePermission`, and `@AuditLog` patterns matching existing admin controllers.

- [ ] **Step 3: Run tests**

```bash
cd backend
npx jest src/modules/admin/growth/admin-growth.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/admin/growth backend/src/modules/admin/admin.module.ts
git commit -m "feat: add admin growth APIs"
```

---

## Chunk 7: 管理后台前端

### Task 12: Routes, permissions, and API client

**Files:**
- Modify: `admin/src/constants/permissions.ts`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Create: `admin/src/api/growth.ts`
- Modify: `admin/src/types/index.ts`

- [ ] **Step 1: Add permissions**

Add:

```ts
GROWTH_READ: 'growth:read',
GROWTH_MANAGE_RULES: 'growth:manage_rules',
GROWTH_MANAGE_EXCHANGE: 'growth:manage_exchange',
GROWTH_ADJUST_USER: 'growth:adjust_user',
GROWTH_RISK: 'growth:risk',
NORMAL_SHARE_READ: 'normal_share:read',
NORMAL_SHARE_MANAGE: 'normal_share:manage',
```

- [ ] **Step 2: Add API methods**

Create `admin/src/api/growth.ts` with typed wrappers for all `/admin/growth/*` and `/admin/normal-share/*` endpoints.

- [ ] **Step 3: Add lazy routes and menu items**

Add “会员成长” under the existing “运营活动” group.

- [ ] **Step 4: Build admin**

```bash
cd admin
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add admin/src/constants/permissions.ts admin/src/App.tsx admin/src/layouts/AdminLayout.tsx admin/src/api/growth.ts admin/src/types/index.ts
git commit -m "feat: add growth admin navigation"
```

### Task 13: Admin growth pages

**Files:**
- Create: `admin/src/pages/growth/dashboard.tsx`
- Create: `admin/src/pages/growth/behavior-rules.tsx`
- Create: `admin/src/pages/growth/categories.tsx`
- Create: `admin/src/pages/growth/levels.tsx`
- Create: `admin/src/pages/growth/exchange-items.tsx`
- Create: `admin/src/pages/growth/new-user-path.tsx`
- Create: `admin/src/pages/growth/share-codes.tsx`
- Create: `admin/src/pages/growth/user-records.tsx`
- Create: `admin/src/pages/growth/risk-events.tsx`
- Create: `admin/src/pages/growth/settings.tsx`

- [ ] **Step 1: Use frontend design guidance before UI work**

Before implementing UI, follow the project frontend rule and use the available frontend design guidance skill/instructions for admin pages.

- [ ] **Step 2: Implement pages with existing patterns**

Use Ant Design ProTable/ProForm patterns from:

- `admin/src/pages/coupons/campaigns.tsx`
- `admin/src/pages/coupons/campaign-form.tsx`
- `admin/src/pages/bonus/normal-config.tsx`
- `admin/src/pages/group-buy/settings.tsx`

- [ ] **Step 3: Required admin page behaviors**

Implement:

- behavior rules table + drawer
- levels table with threshold validation
- exchange items table with CouponCampaign selector
- new-user path editor
- share code list with disable/enable
- user records lookup
- risk events list
- settings form
- dashboard summary cards

- [ ] **Step 4: Build admin**

```bash
cd admin
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/growth
git commit -m "feat: add growth admin pages"
```

---

## Chunk 8: 买家 App

### Task 14: App repos and types

**Files:**
- Create: `src/types/domain/Growth.ts`
- Modify: `src/types/domain/index.ts`
- Create: `src/repos/GrowthRepo.ts`
- Create: `src/repos/NormalShareRepo.ts`
- Modify: `src/repos/index.ts`

- [ ] **Step 1: Add types**

Types must distinguish:

- `GrowthAccountSummary`
- `GrowthTask`
- `GrowthLedgerItem`
- `GrowthExchangeItem`
- `NormalShareProfile`
- `NormalShareStats`

- [ ] **Step 2: Add repos**

Implement API calls matching backend endpoints.

- [ ] **Step 3: Run TypeScript check**

Use the repo’s existing App validation command if available. At minimum:

```bash
npx tsc --noEmit
```

Expected: no TS errors, or document existing unrelated errors if present.

- [ ] **Step 4: Commit**

```bash
git add src/types/domain/Growth.ts src/types/domain/index.ts src/repos/GrowthRepo.ts src/repos/NormalShareRepo.ts src/repos/index.ts
git commit -m "feat: add buyer growth repos"
```

### Task 15: Growth center and exchange pages

**Files:**
- Modify: `app/(tabs)/me.tsx`
- Create: `app/me/growth.tsx`
- Create: `app/me/points-exchange.tsx`
- Modify: `app/me/wallet.tsx`
- Modify: `app/me/vip.tsx`

- [ ] **Step 1: Use frontend design guidance before UI work**

Follow project UI instructions for buyer App before editing screens.

- [ ] **Step 2: Implement Me tab module**

Show:

- ordinary level
- growth progress
- ordinary points
- today's tasks/sign-in entry
- member growth center entry
- VIP upgrade bridge

Do not mix ordinary points into wallet money balances.

- [ ] **Step 3: Implement `/me/growth`**

Show:

- level progress
- points balance
- new-user path
- tasks
- ledger links
- exchange entry

- [ ] **Step 4: Implement `/me/points-exchange`**

Show exchange items. Redemption calls `GrowthRepo.exchange(itemId)`.

- [ ] **Step 5: Run app checks**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: no new failures.

- [ ] **Step 6: Update docs**

Update:

- `docs/architecture/frontend.md`
- `plan.md`

- [ ] **Step 7: Commit**

```bash
git add app src docs/architecture/frontend.md plan.md
git commit -m "feat: add buyer growth center"
```

### Task 16: Normal share page and referral copy

**Files:**
- Modify: `app/me/referral.tsx` or create `app/me/share-code.tsx`
- Modify: `app/(tabs)/me.tsx`
- Modify: `src/utils/referralRelation.ts` if label routing changes

- [ ] **Step 1: Implement ordinary share UI**

Ordinary users see:

- 新人福利码
- QR code for `/s/{code}`
- copy/share actions
- invite stats
- rules

VIP users see ordinary share code and VIP referral code as two clearly separated sections.

- [ ] **Step 2: Preserve VIP referral behavior**

Do not change existing `/r/{code}` behavior or `BonusRepo.getMember()` semantics.

- [ ] **Step 3: Run checks**

```bash
npx tsc --noEmit
```

Expected: no new TS errors.

- [ ] **Step 4: Commit**

```bash
git add app/me/referral.tsx app/(tabs)/me.tsx src/utils/referralRelation.ts
git commit -m "feat: add normal share code UI"
```

---

## Chunk 9: Website landing

### Task 17: Add `/s/:code` landing and resolver

**Files:**
- Modify: `website/src/App.tsx`
- Create: `website/src/pages/NormalShareLanding.tsx`
- Modify: `website/src/pages/Resolve.tsx` or create a dedicated resolver
- Modify: `website/src/lib/api.ts`

- [ ] **Step 1: Add route**

Add:

```tsx
<Route path="/s/:code" element={<NormalShareLanding />} />
```

Ensure landing page is included in `isLandingPage`.

- [ ] **Step 2: Implement landing behavior**

Landing page calls:

```text
POST /normal-share/deferred/create
```

Then displays:

- inviter masked display
- App download button
- QR/download fallback
- newcomer benefit copy

- [ ] **Step 3: Keep `/r/:code` and `/gb/:code` behavior unchanged**

Do not reuse VIP deferred-link API for normal share.

- [ ] **Step 4: Build website**

```bash
cd website
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add website/src/App.tsx website/src/pages/NormalShareLanding.tsx website/src/pages/Resolve.tsx website/src/lib/api.ts
git commit -m "feat: add normal share landing page"
```

---

## Chunk 10: Verification and release docs

### Task 18: Full backend verification

- [ ] **Step 1: Prisma validation**

```bash
cd backend
npx prisma validate
```

Expected: valid.

- [ ] **Step 2: Backend tests**

```bash
cd backend
npm test -- --runInBand
```

Expected: PASS, or document unrelated pre-existing failures.

- [ ] **Step 3: Backend build**

```bash
cd backend
npm run build
```

Expected: build succeeds.

### Task 19: Full frontend verification

- [ ] **Step 1: Admin build**

```bash
cd admin
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Website build**

```bash
cd website
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Buyer App checks**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: no new failures.

### Task 20: Docs and final commit

**Files:**
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Update docs**

Document:

- Growth backend module
- Admin “会员成长” module
- Buyer growth center and normal share UI
- Coupon reuse boundary
- Ordinary points vs Reward consumption points naming boundary

- [ ] **Step 2: Final status check**

```bash
git status --short
```

Expected: only intended files changed.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/backend.md docs/architecture/admin-frontend.md docs/architecture/frontend.md plan.md
git commit -m "docs: document growth member system"
```

---

## Execution Order

Recommended implementation sequence:

1. Chunk 1: Schema and Growth skeleton.
2. Chunk 2: Behavior grants, reversal, expiration.
3. Chunk 3: Coupon adapter and exchange.
4. Chunk 6: Admin backend APIs.
5. Chunk 7: Admin frontend.
6. Chunk 8: Buyer App growth center.
7. Chunk 4: Normal share backend.
8. Chunk 5: Order/register/check-in integrations.
9. Chunk 9: Website landing.
10. Chunk 10: Full verification and docs.

Reason: the admin-configurable Growth foundation must exist before normal share rewards and App presentation depend on it.
