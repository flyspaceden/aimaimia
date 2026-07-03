# VIP 直推持续佣金 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/superpowers/specs/2026-07-03-vip-direct-referral-commission-design.md`：把 VIP 普通商品利润从六分扩展为七分，并在被直推 VIP 支付普通商品订单后，立即给直系推荐人生成可见的冻结佣金，售后窗口结束且无成功售后后释放。

**Architecture:** 保持现有 VIP 树上溯分润不变。新增 `VIP_DIRECT_REFERRAL_PERCENT` 作为 VIP 利润七分中的独立比例；`RewardCalculatorService.calculateVip()` 输出 `directReferralPool`；支付回调建单的 Serializable 事务内调用 `VipDirectReferralCommissionService.createFrozenForPaidOrder()` 写 `RewardAllocation + RewardLedger + RewardAccount.frozen`。佣金使用现有 `VIP_REWARD` 账户，不新增账户类型；释放由 `FreezeExpireService` 的新直推佣金释放任务处理；退款、取消、退货、换货成功继续通过现有奖励作废链路覆盖并补强审计。

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Vite React 19, Ant Design 5.

## Global Constraints

- This feature touches funds, rewards, payment callbacks, refund/after-sale state, and account balances. Every write that mutates `RewardAllocation`, `RewardLedger`, or `RewardAccount` must run inside `Prisma.TransactionIsolationLevel.Serializable`.
- Keep total VIP profit allocation conserved: `VIP_PLATFORM_PERCENT + VIP_REWARD_PERCENT + VIP_DIRECT_REFERRAL_PERCENT + VIP_INDUSTRY_FUND_PERCENT + VIP_CHARITY_PERCENT + VIP_TECH_PERCENT + VIP_RESERVE_PERCENT = 1`.
- `VIP_DIRECT_REFERRAL_PERCENT` defaults to `0`; existing production behavior remains `50/30/0/10/2/2/6` until operations changes the admin config.
- The direct commission is a separate stream from `VIP_REFERRAL` and `VIP_UPSTREAM`. Do not merge it into tree rewards and do not alter VIP tree placement logic.
- Direct commission applies only to paid `NORMAL_GOODS` orders from users who are already VIP. It does not apply to `VIP_PACKAGE`, `GROUP_BUY`, shipping, zero-profit items, prize items, or non-VIP buyers.
- If no valid direct inviter can receive the commission, route only this direct commission pool to platform. Do not reassign it to a tree ancestor.
- `VIP_DIRECT_REFERRAL` frozen ledgers must be excluded from generic freeze-expire voiding. They are released only after receipt plus return-window expiry and no active/successful after-sale.
- Frontend implementation for the admin page must first use the available frontend design guidance skill (`frontend-design:frontend-design`) to satisfy the project UI guidance requirement.
- Use explicit path staging. Do not stage unrelated dirty-worktree files.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-07-03-vip-direct-referral-commission-design.md`
- Backend architecture: `docs/architecture/backend.md`
- Data model authority: `docs/architecture/data-system.md`
- Admin frontend authority: `docs/architecture/admin-frontend.md`
- VIP purchase flow: `docs/features/buy-vip.md`
- Reward profit model: `docs/features/test-reward.md`
- Safety checklist: `docs/issues/tofix-safe.md`
- Project task board: `plan.md`

## File Structure Map

### Prisma And Config

- Modify: `backend/prisma/schema.prisma`
  - Add `VIP_DIRECT_REFERRAL` to `AllocationRuleType`.
- Create: `backend/prisma/migrations/20260703010000_vip_direct_referral_commission/migration.sql`
  - Add enum value and seed `VIP_DIRECT_REFERRAL_PERCENT = 0`.
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/production-bootstrap.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-config.service.ts`
- Modify: `backend/src/modules/admin/config/config-validation.ts`

### Backend Reward Calculation And Commission

- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts`
- Create: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts`
- Create: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.ts`
- Modify: `backend/src/modules/bonus/engine/constants.ts` only if label/account-type helpers need an explicit direct scheme constant.
- Modify: `backend/src/modules/bonus/bonus.module.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-reward.service.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`

### Admin Frontend

- Modify: `admin/src/pages/bonus/vip-config.tsx`
- Create: `scripts/__tests__/vip-direct-referral-admin-config.test.mjs`

### Documentation

- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/features/plan-treeforuser.md`
- Modify: `docs/features/test-reward.md`
- Modify: `docs/features/buy-vip.md`
- Modify: `plan.md`

## Chunk 1: Schema, Migration, And Seven-Way Config

### Task 1.1: Add Prisma Enum And RuleConfig Default

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260703010000_vip_direct_referral_commission/migration.sql`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/production-bootstrap.ts`

- [ ] Add `VIP_DIRECT_REFERRAL` to `AllocationRuleType` immediately after `VIP_UPSTREAM`:

```prisma
enum AllocationRuleType {
  NORMAL_BROADCAST
  NORMAL_TREE
  VIP_UPSTREAM
  VIP_DIRECT_REFERRAL
  VIP_PLATFORM_SPLIT
  PLATFORM_SPLIT
  ZERO_PROFIT
}
```

- [ ] Create `backend/prisma/migrations/20260703010000_vip_direct_referral_commission/migration.sql`:

```sql
ALTER TYPE "AllocationRuleType" ADD VALUE IF NOT EXISTS 'VIP_DIRECT_REFERRAL';

INSERT INTO "RuleConfig" (key, value, "updatedAt")
VALUES (
  'VIP_DIRECT_REFERRAL_PERCENT',
  '{"value": 0, "description": "VIP利润-直推持续佣金比例"}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] In `backend/prisma/seed.ts`, add the default near the other VIP ratio defaults:

```ts
{ key: 'VIP_DIRECT_REFERRAL_PERCENT', value: 0, desc: 'VIP利润-直推持续佣金比例' },
```

- [ ] In `backend/prisma/production-bootstrap.ts`, add the same default.

- [ ] Run:

```bash
cd backend
npx prisma validate
```

Expected: Prisma reports the schema is valid.

### Task 1.2: Extend Backend Config Loading And Validation

**Files:**

- Modify: `backend/src/modules/bonus/engine/bonus-config.service.ts`
- Modify: `backend/src/modules/admin/config/config-validation.ts`

- [ ] Extend `BonusConfig`:

```ts
vipDirectReferralPercent: number; // VIP直推持续佣金比例
```

- [ ] Add the key to `KEY_MAP`, `VIP_RATIO_KEYS`, `DEFAULTS`, `getVipConfig()`, `validateRatioUpdate()`, `validateSnapshotRatios()`, and `loadFromDb()`.

- [ ] Keep the default sum backward compatible:

```ts
vipPlatformPercent: 0.50,
vipRewardPercent: 0.30,
vipDirectReferralPercent: 0,
vipIndustryFundPercent: 0.10,
vipCharityPercent: 0.02,
vipTechPercent: 0.02,
vipReservePercent: 0.06,
```

- [ ] Update every VIP ratio sum to include seven keys, and update error text to name all seven:

```text
VIP_PLATFORM_PERCENT + VIP_REWARD_PERCENT + VIP_DIRECT_REFERRAL_PERCENT + VIP_INDUSTRY_FUND_PERCENT + VIP_CHARITY_PERCENT + VIP_TECH_PERCENT + VIP_RESERVE_PERCENT
```

- [ ] In `backend/src/modules/admin/config/config-validation.ts`, add validation metadata:

```ts
VIP_DIRECT_REFERRAL_PERCENT: {
  type: 'number',
  min: 0,
  max: 1,
  description: 'VIP利润-直推持续佣金比例',
},
```

- [ ] Add `VIP_DIRECT_REFERRAL_PERCENT` to `VIP_POOL_PERCENT_KEYS`.

- [ ] Add focused tests to existing config tests or create `backend/src/modules/bonus/engine/bonus-config.service.spec.ts` if none exists:
  - missing direct key loads as `0`;
  - `50/30/0/10/2/2/6` passes;
  - `50/25/5/10/2/2/6` passes;
  - a seven-key total not equal to `1` fails.

## Chunk 2: VIP Seven-Way Calculator

### Task 2.1: Add `directReferralPool` To VIP Calculation

**Files:**

- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`

- [ ] Extend `VipPoolCalculation`:

```ts
directReferralPool: number; // VIP直推持续佣金
```

- [ ] In zero-profit return, set `directReferralPool: 0`.

- [ ] In `calculateVip()`, compute six independent pools and let reserve absorb remainder:

```ts
const platformProfit = this.round2(profit * config.vipPlatformPercent);
const rewardPool = this.round2(profit * config.vipRewardPercent);
const directReferralPool = this.round2(profit * config.vipDirectReferralPercent);
const industryFund = this.round2(profit * config.vipIndustryFundPercent);
const charityFund = this.round2(profit * config.vipCharityPercent);
const techFund = this.round2(profit * config.vipTechPercent);
const reserveFund = this.round2(
  profit - platformProfit - rewardPool - directReferralPool - industryFund - charityFund - techFund,
);
```

- [ ] Include `directReferralPool` in the returned object and `snapshotVip()`.

- [ ] In `bonus-allocation.service.ts`, include `directReferralPool` in `VIP_UPSTREAM`, `VIP_EXITED`, and `VIP_PLATFORM_SPLIT` allocation `meta` for audit, but do not distribute it in those flows. Existing `VIP_UPSTREAM` must still use only `pools.rewardPool`.

- [ ] Add or update calculator tests:
  - profit `100` with `50/25/5/10/2/2/6` returns `rewardPool=25`, `directReferralPool=5`, `reserveFund=6`;
  - rounding still sums back to `profit` within `0.01`;
  - `vipDirectReferralPercent=0` preserves current six-way outputs.

## Chunk 3: Direct Referral Commission Service

### Task 3.1: Create The Commission Service

**Files:**

- Create: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts`
- Create: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] Create injectable `VipDirectReferralCommissionService` with dependencies:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly configService: BonusConfigService,
  private readonly calculator: RewardCalculatorService,
) {}
```

- [ ] Export a transaction-scoped entrypoint:

```ts
async createFrozenForPaidOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<'credited' | 'platform' | 'skipped'>
```

- [ ] The method must load the order with item costs and reject out of scope:
  - missing order -> `skipped`;
  - `order.bizType !== 'NORMAL_GOODS'` -> `skipped`;
  - buyer `MemberProfile.tier !== 'VIP'` -> `skipped`;
  - no positive non-prize profit -> `skipped`;
  - `config.vipDirectReferralPercent <= 0` -> `skipped`.

- [ ] Use the same profit input shape as confirmation-time VIP allocation:

```ts
const calcItems = order.items
  .filter((item) => !item.isPrize)
  .map((item) => ({
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    cost: item.sku?.cost ?? item.sku?.product?.cost ?? null,
    companyId: item.companyId ?? null,
  }));
const pools = this.calculator.calculateVip(calcItems, config);
```

- [ ] Use idempotency key:

```ts
const idempotencyKey = `ALLOC:ORDER_PAID:${orderId}:VIP_DIRECT_REFERRAL`;
```

- [ ] If a matching `RewardAllocation` already exists, return `skipped`.

- [ ] Determine receiver:
  - read buyer `MemberProfile.inviterUserId`;
  - fetch inviter `User` and require `status === 'ACTIVE'` and `deletionExecutedAt === null`;
  - if invalid or missing, route the amount to platform with `platformReason`.

- [ ] For a valid receiver, upsert `RewardAccount` of type `VIP_REWARD`, create allocation and frozen ledger, then increment `RewardAccount.frozen`:

```ts
meta: {
  scheme: 'VIP_DIRECT_REFERRAL',
  accountType: 'VIP_REWARD',
  sourceOrderId: orderId,
  sourceUserId: order.userId,
  directInviterUserId: inviterUserId,
  profit: pools.profit,
  ratio: config.vipDirectReferralPercent,
  directReferralPool: pools.directReferralPool,
  configSnapshot: pools.configSnapshot,
  releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
}
```

- [ ] Ledger shape for valid receiver:

```ts
entryType: 'FREEZE',
status: 'FROZEN',
refType: 'ORDER',
refId: orderId,
```

- [ ] For platform routing, create a `PLATFORM_PROFIT` account ledger with `entryType='RELEASE'`, `status='AVAILABLE'`, `refType='ORDER'`, `refId=orderId`, and meta:

```ts
{
  scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
  originalScheme: 'VIP_DIRECT_REFERRAL',
  routedToPlatform: true,
  platformReason,
  sourceUserId: order.userId,
  directInviterUserId: inviterUserId ?? null,
}
```

- [ ] Catch Prisma unique errors on `idempotencyKey` and return `skipped`.

- [ ] Register the provider and export it in `BonusModule`.

### Task 3.2: Service Unit Tests

**Files:**

- Create: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts`

- [ ] Test valid direct VIP consumption:
  - creates `RewardAllocation.ruleType = VIP_DIRECT_REFERRAL`;
  - creates `RewardLedger.meta.scheme = VIP_DIRECT_REFERRAL`;
  - increments inviter `VIP_REWARD.frozen`.

- [ ] Test no inviter:
  - no receiver ledger;
  - platform account balance increments;
  - allocation meta includes `routedToPlatform: true`.

- [ ] Test invalid inviter status `BANNED` and deleted inviter `deletionExecutedAt != null` route to platform.

- [ ] Test non-VIP buyer, `VIP_PACKAGE`, `GROUP_BUY`, zero-profit order, and `vipDirectReferralPercent=0` all skip.

- [ ] Test duplicate call with same order does not create duplicate allocation or ledger.

## Chunk 4: Payment Success Hook

### Task 4.1: Inject The Service Into Checkout

**Files:**

- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] In `CheckoutService`, add a setter-backed dependency:

```ts
private vipDirectReferralCommissionService: VipDirectReferralCommissionService | null = null;

setVipDirectReferralCommissionService(service: VipDirectReferralCommissionService) {
  this.vipDirectReferralCommissionService = service;
}
```

- [ ] In `OrderModule.onModuleInit()`, resolve the service through `ModuleRef` after `BonusService` resolution:

```ts
const vipDirectReferralCommissionService = this.moduleRef.get(
  VipDirectReferralCommissionService,
  { strict: false },
);
if (vipDirectReferralCommissionService) {
  this.checkoutService.setVipDirectReferralCommissionService(vipDirectReferralCommissionService);
} else {
  throw new Error('[OrderModule] VipDirectReferralCommissionService 未注入，直推佣金冻结不可用，启动中止');
}
```

- [ ] Ensure `VipDirectReferralCommissionService` is exported from `BonusModule`, otherwise `ModuleRef` in `OrderModule` cannot resolve it reliably.

### Task 4.2: Create Frozen Commission Inside Payment Transaction

**Files:**

- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify tests: `backend/src/modules/order/checkout-money-safety.spec.ts` or create `backend/src/modules/order/checkout-vip-direct-referral.spec.ts`

- [ ] After each normal goods `order` is created and its status history is written, call:

```ts
if (
  sessionBizType === 'NORMAL_GOODS' &&
  this.vipDirectReferralCommissionService
) {
  await this.vipDirectReferralCommissionService.createFrozenForPaidOrder(tx, order.id);
}
```

- [ ] Keep the call inside the existing payment-success Serializable transaction. Do not run this as fire-and-forget outside the transaction.

- [ ] Do not call the service for `VIP_PACKAGE` or `GROUP_BUY`.

- [ ] Add checkout integration tests:
  - ordinary VIP buyer payment calls the direct service once per created order;
  - VIP package payment does not call it;
  - group-buy payment does not call it;
  - duplicate payment callback returns existing order ids and does not call direct service again.

## Chunk 5: Release And Void Semantics

### Task 5.1: Exclude Direct Commission From Generic Freeze Expiry

**Files:**

- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.ts`

- [ ] In both raw SQL queries in `handleFreezeExpire()`, add:

```sql
AND COALESCE(meta->>'scheme', '') <> 'VIP_DIRECT_REFERRAL'
```

- [ ] Add a test around `handleFreezeExpire()` proving an expired `VIP_DIRECT_REFERRAL` `FROZEN` ledger is not voided by the generic expiration path.

### Task 5.2: Release Direct Commission After Return Window

**Files:**

- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.ts`
- Modify or create tests: `backend/src/modules/bonus/engine/freeze-expire.service.spec.ts`

- [ ] Import `ACTIVE_STATUSES` and `SUCCESS_STATUSES` from `backend/src/modules/after-sale/after-sale.constants.ts`.

- [ ] Add a new cron method using the existing ten-minute cadence:

```ts
@Cron(CronExpression.EVERY_10_MINUTES)
async handleVipDirectReferralRelease(): Promise<void>
```

- [ ] Candidate query:

```sql
SELECT rl.id, rl."userId", rl."accountId", rl.amount, rl.meta, rl."refId"
FROM "RewardLedger" rl
JOIN "Order" o ON rl."refId" = o.id
WHERE rl.status = 'FROZEN'
  AND rl."entryType" = 'FREEZE'
  AND rl."refType" = 'ORDER'
  AND rl.meta->>'scheme' = 'VIP_DIRECT_REFERRAL'
  AND o.status = 'RECEIVED'
  AND o."returnWindowExpiresAt" IS NOT NULL
  AND o."returnWindowExpiresAt" < NOW()
LIMIT ${BATCH_SIZE}
```

- [ ] Batch-query after-sale status for candidate order ids:
  - if any status in `ACTIVE_STATUSES`, skip release;
  - if any status in `SUCCESS_STATUSES`, void the ledger to platform as a backstop;
  - if only terminal failure statuses such as `REJECTED`, `CANCELED`, or `CLOSED`, release.

- [ ] Implement `releaseVipDirectReferralLedger()` as an independent Serializable transaction:
  - CAS `RewardLedger` from `FROZEN/FREEZE` to `AVAILABLE/RELEASE`;
  - decrement receiver account `frozen`;
  - increment receiver account `balance`;
  - keep `refType='ORDER'`, `refId=orderId`;
  - add meta fields `releasedAt`, `releaseReason`.

- [ ] Implement `voidVipDirectReferralLedgerToPlatform()` as a backstop for success-after-sale candidates missed by the primary after-sale path:
  - CAS `FROZEN/FREEZE` to `VOIDED/VOID`;
  - decrement receiver account `frozen`;
  - create `PLATFORM_PROFIT` available ledger with `scheme='VIP_DIRECT_REFERRAL_VOID'`;
  - increment platform account `balance`;
  - record original ledger id and original receiver id.

- [ ] Tests:
  - received order before return window expiry stays frozen;
  - received order after return window expiry releases;
  - active after-sale blocks release;
  - rejected/canceled after-sale still releases;
  - successful after-sale voids to platform and does not release;
  - repeated cron run is idempotent.

### Task 5.3: Ensure Cancellation And After-Sale Void Direct Commission

**Files:**

- Modify: `backend/src/modules/after-sale/after-sale-reward.service.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- Modify or add tests:
  - `backend/src/modules/after-sale/after-sale-reward.service.spec.ts`
  - `backend/src/modules/bonus/engine/bonus-allocation.service.spec.ts`

- [ ] Confirm `AfterSaleRewardService.voidRewardsForOrder()` already includes `FROZEN` `refType='ORDER'` ledgers. Add tests specifically using `meta.scheme='VIP_DIRECT_REFERRAL'`.

- [ ] Confirm late released direct commission is covered by the existing defensive scan of `entryType='RELEASE'`, `status='AVAILABLE'`. Add a regression test.

- [ ] In `BonusAllocationService.rollbackForOrder()`, ensure direct commission allocations are included because they have `orderId`. Add a regression test with `AllocationRuleType.VIP_DIRECT_REFERRAL`.

- [ ] If `rollbackForOrder()` voids a `VIP_DIRECT_REFERRAL` ledger, create the same platform mirror used by after-sale voiding, or refactor a shared helper so cancellation/refund and after-sale audits are consistent.

- [ ] Do not change VIP eligible order rollback or normal tree rollback behavior beyond including the new direct allocation in generic ledger voiding.

## Chunk 6: Wallet Labels And Admin Seven-Way UI

### Task 6.1: Wallet/Reward Labels

**Files:**

- Modify: `backend/src/modules/bonus/bonus.service.ts`

- [ ] Add source mapping:

```ts
VIP_DIRECT_REFERRAL: 'VIP 直推佣金',
```

- [ ] Where wallet ledger DTOs expose `scheme` or `refType`, ensure `VIP_DIRECT_REFERRAL` is displayed separately from `VIP_REFERRAL` and `VIP_UPSTREAM`.

- [ ] Add/adjust tests if wallet ledger mapping has existing coverage.

### Task 6.2: Admin Seven-Way Ratio UI

**Files:**

- Modify: `admin/src/pages/bonus/vip-config.tsx`
- Create: `scripts/__tests__/vip-direct-referral-admin-config.test.mjs`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

- [ ] Before editing this frontend file, use `frontend-design:frontend-design` for admin UI guidance.

- [ ] In `CONFIG_SCHEMA`, insert:

```ts
{
  key: 'VIP_DIRECT_REFERRAL_PERCENT',
  label: 'VIP直推佣金占比',
  group: 'ratio',
  type: 'percent',
  min: 0,
  max: 1,
  step: 0.01,
  description: 'VIP利润中给直系推荐人的持续佣金比例',
  defaultValue: 0,
}
```

- [ ] Update `RATIO_KEYS` from six to seven keys.

- [ ] Update `RECOMMENDED_RATIOS`:

```ts
VIP_PLATFORM_PERCENT: 0.50,
VIP_REWARD_PERCENT: 0.25,
VIP_DIRECT_REFERRAL_PERCENT: 0.05,
VIP_INDUSTRY_FUND_PERCENT: 0.10,
VIP_CHARITY_PERCENT: 0.02,
VIP_TECH_PERCENT: 0.02,
VIP_RESERVE_PERCENT: 0.06,
```

- [ ] Update all visible copy:
  - `VIP 利润六分比例` -> `VIP 利润七分比例`;
  - `六项合计` -> `七项合计`;
  - `以下六项须合计 = 100%（50/30/10/2/2/6）` -> `以下七项须合计 = 100%（50/25/5/10/2/2/6）`;
  - recommend button/modal copy must include direct commission.

- [ ] Keep batch-save behavior. Do not save seven ratios one by one.

- [ ] Static UI test should assert:
  - file contains `VIP_DIRECT_REFERRAL_PERCENT`;
  - seven `RATIO_KEYS`;
  - recommended ratios sum to 1;
  - visible text says seven-way, not six-way.

## Chunk 7: Documentation And Safety Notes

### Task 7.1: Update Architecture And Feature Docs

**Files:**

- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/features/plan-treeforuser.md`
- Modify: `docs/features/test-reward.md`
- Modify: `docs/features/buy-vip.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [ ] Document new `AllocationRuleType.VIP_DIRECT_REFERRAL`.

- [ ] Document new config key and default production-compatible ratio `50/30/0/10/2/2/6`.

- [ ] Document recommended operational template `50/25/5/10/2/2/6`.

- [ ] Document that direct commission is part of VIP profit split and not an additional platform subsidy.

- [ ] Document the frozen lifecycle:
  - payment success -> `FROZEN`;
  - confirm receipt -> still `FROZEN`;
  - return window expired and no active/success after-sale -> `AVAILABLE`;
  - cancel/refund/return/exchange success -> `VOIDED`.

- [ ] Update `docs/issues/tofix-safe.md` with the new safety invariant:

```text
VIP_DIRECT_REFERRAL FROZEN ledgers are excluded from generic freeze expiry and are released only by receipt-plus-return-window logic.
```

- [ ] Update `plan.md` with a new checklist item for VIP direct referral commission implementation.

## Chunk 8: Verification

### Task 8.1: Targeted Tests

- [ ] Run Prisma validation:

```bash
cd backend
npx prisma validate
```

Expected: schema valid.

- [ ] Run backend targeted tests:

```bash
cd backend
npm test -- \
  src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts \
  src/modules/bonus/engine/bonus-allocation.service.spec.ts \
  src/modules/after-sale/after-sale-reward.service.spec.ts \
  src/modules/order/checkout-vip-direct-referral.spec.ts \
  --runInBand
```

Expected: all targeted tests pass.

- [ ] If `freeze-expire.service.spec.ts` is added, include it in the targeted command:

```bash
cd backend
npm test -- src/modules/bonus/engine/freeze-expire.service.spec.ts --runInBand
```

Expected: direct commission release and generic-expiry exclusion tests pass.

- [ ] Run admin static UI test:

```bash
node scripts/__tests__/vip-direct-referral-admin-config.test.mjs
```

Expected: seven-way UI assertions pass.

### Task 8.2: Build Verification

- [ ] Run backend build:

```bash
cd backend
npm run build
```

Expected: TypeScript build succeeds.

- [ ] Run admin build:

```bash
cd admin
npm run build
```

Expected: Vite admin build succeeds.

- [ ] Run root type check when backend/admin targeted builds pass:

```bash
npx tsc -b --noEmit --pretty false
```

Expected: no TypeScript errors.

### Task 8.3: Manual Acceptance Checklist

- [ ] Admin page shows seven sliders/inputs and the total badge says `七项合计：100%`.
- [ ] Default backend config with no existing direct key behaves as `50/30/0/10/2/2/6`.
- [ ] Switching to recommended template produces `50/25/5/10/2/2/6`.
- [ ] A VIP direct invitee normal-goods payment creates a visible frozen VIP reward for the direct inviter.
- [ ] The same order confirmation still runs existing `VIP_UPSTREAM` on `VIP_REWARD_PERCENT`, not on direct commission.
- [ ] Before return-window expiry, the direct commission remains frozen.
- [ ] After return-window expiry with no successful after-sale, it becomes available.
- [ ] Successful refund/return/exchange voids the direct commission and it never releases.
- [ ] No direct inviter or invalid inviter routes the direct commission pool to platform only.
