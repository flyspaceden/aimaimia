# 团购付款即生成码与钱包统一消费积分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/superpowers/specs/2026-06-29-group-buy-instant-code-unified-wallet-design.md`：团购作为独立模块，付款后立即生成团购推荐码；组团成功后不接受退换货，仅支持收货 24 小时内质量问题联系客服补货；团购返还奖励在后端独立记账，在买家 App 钱包统一展示为可抵扣、可提现的消费积分。

**Architecture:** 保持团购、分润 Reward、产业基金三套后端账本边界。团购订单支付成功的同一 Serializable 事务内创建 `GroupBuyInstance + ACTIVE GroupBuyCode`，被推荐人付款后创建 `PENDING_REBATE` 冻结流水，被推荐人确认收货后释放为 `GroupBuyRebateAccount.balance`。`BonusService` 对 App 提供统一钱包视图；“总消费积分”只作为查询时汇总的 API 字段，不新增持久化总余额字段。普通商品结算和提现由后端自动按 Reward、GroupBuyRebate、IndustryFund 的规则拆账；App 不让用户选择资金来源。团购 checkout 继续现金支付，禁止红包、消费积分、团购返还、VIP 折扣和任何优惠。

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL Serializable transactions, Jest, Expo 54 / React Native 0.81, React Query, TypeScript 5.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-29-group-buy-instant-code-unified-wallet-design.md`
- Reward dual-track spec: `docs/superpowers/specs/2026-05-19-reward-dual-track-design.md`
- Refund rules: `docs/features/refund.md`
- Buyer App authority: `docs/architecture/frontend.md`
- Responsive authority: `docs/architecture/responsive-design.md`
- Safety checklist: `docs/issues/tofix-safe.md`
- Project task board: `plan.md`

## Scope Decisions

- 团购是独立模块：不把团购返还写进 `RewardAccount` / `RewardLedger`。
- App 展示统一消费积分：用户看到总余额、冻结中、可抵扣、可提现，不需要知道哪一笔来自分润或团购。
- 不新增数据库真实总余额字段：总消费积分只在 `/bonus/wallet` 等 App API 中查询时汇总，权威余额仍来自各来源账户和流水。
- 后端分账：提现、抵扣、流水详情仍保留 `VIP_REWARD` / `NORMAL_REWARD` / `INDUSTRY_FUND` / `GROUP_BUY_REBATE` 来源。
- 产业基金维持现有规则：只有买家同时是卖家企业 OWNER 时才显示入口/筛选；普通商品抵扣不使用产业基金；提现可按现有优先级在最后扣产业基金。
- 团购数字资产不改：团购不新增数字资产特例，沿用当前数字资产/消费资产逻辑。
- 团购订单不支持自助售后、取消退款、无理由退换、质量退换；仅展示“收货 24 小时内质量问题联系客服补货”的入口/文案。
- 历史已付款但还在 `QUALIFICATION_PENDING` 的团购实例需要一次性补生成码。

## File Structure

Backend group-buy lifecycle and rebates:

- Modify `backend/src/modules/group-buy/group-buy-code.util.ts`
- Modify `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Modify `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy.service.ts`
- Modify `backend/src/modules/group-buy/group-buy.service.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy-concurrency.spec.ts`
- Modify `backend/src/modules/order/checkout.service.ts`
- Modify `backend/src/modules/order/checkout-money-safety.spec.ts`
- Modify `backend/src/modules/order/checkout-pending.spec.ts`
- Create `backend/scripts/backfill-group-buy-instant-codes.ts`
- Create `backend/src/modules/group-buy/backfill-group-buy-instant-codes.spec.ts` if the script logic is extracted into a testable helper.

Backend checkout, wallet, and withdrawal:

- Modify `backend/src/modules/order/checkout.dto.ts`
- Modify `backend/src/modules/order/order.controller.ts`
- Modify `backend/src/modules/order/order.service.ts`
- Modify `backend/src/modules/order/order.service.cancel.spec.ts`
- Modify `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`
- Modify `backend/src/modules/bonus/bonus.service.ts`
- Modify `backend/src/modules/bonus/bonus.service.spec.ts`
- Modify `backend/src/modules/bonus/withdraw-payout.service.ts`
- Modify `backend/src/modules/bonus/withdraw-payout.service.spec.ts`
- Modify `backend/src/modules/bonus/withdraw-payout.concurrency.spec.ts`
- Use existing `backend/src/modules/bonus/reward-deduction.service.ts`
- Use existing `backend/src/modules/group-buy/group-buy-rebate-deduction.service.ts`

Backend order and after-sale restrictions:

- Modify `backend/src/modules/after-sale/after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.service.spec.ts`
- Modify `backend/src/modules/after-sale/after-sale.utils.ts` only if eligibility helpers own the order-type rule.
- Modify `backend/src/modules/after-sale/after-sale.utils.spec.ts` only if helper changed.
- Modify seller/admin after-sale services only if they expose group-buy self-service entry points.

Buyer App:

- Modify `src/types/domain/Bonus.ts`
- Modify `src/types/domain/GroupBuy.ts`
- Modify `src/types/domain/Order.ts`
- Modify `src/repos/BonusRepo.ts`
- Modify `src/repos/OrderRepo.ts`
- Modify `src/repos/GroupBuyRepo.ts` only if API response shape changes.
- Modify `app/me/wallet.tsx`
- Modify `app/me/vip.tsx`
- Modify `app/checkout.tsx`
- Modify `app/group-buy/index.tsx`
- Modify `app/group-buy/[activityId].tsx`
- Modify `app/group-buy/checkout.tsx`
- Modify `app/orders/[id].tsx`
- Modify `app/orders/after-sale/[id].tsx`
- Modify `src/components/group-buy/GroupBuyCurrentPanel.tsx`
- Modify `src/components/group-buy/GroupBuyProgressRail.tsx`
- Modify `src/components/group-buy/GroupBuyPurchaseGuardSheet.tsx`

Documentation:

- Modify `docs/architecture/frontend.md`
- Modify `docs/features/refund.md`
- Modify `docs/issues/tofix-safe.md`
- Modify `plan.md`
- Modify this plan file as tasks are completed.

## Execution Rules

- Before UI work, invoke the available frontend design guidance skill to satisfy the project `/ui-ux-pro-max` requirement.
- Every money, reward, withdrawal, checkout, and group-buy status mutation must use `Prisma.TransactionIsolationLevel.Serializable`.
- Write/update tests before implementation for each backend behavior change.
- Do not modify digital asset service, ledgers, or App pages except to confirm no new group-buy-specific behavior is needed.
- Do not stage unrelated dirty worktree files. If committing, stage explicit paths only.
- Keep existing group-buy cash-only checkout guard. Ordinary product checkout may use unified consumption points; group-buy checkout may not.

---

## Chunk 1: Payment Creates Active Group-Buy Code Immediately

### Task 1.1: Add Unique-Code Helper And Remove Return-Window Dependency

**Files:**
- Modify `backend/src/modules/group-buy/group-buy-code.util.ts`
- Modify `backend/src/modules/group-buy/group-buy-lifecycle.service.ts`
- Modify `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`

- [x] **Step 1: Add or update failing tests**

Update `group-buy-lifecycle.service.spec.ts` so `evaluateInitiatorOrder(orderId)` activates a paid group-buy instance without waiting for `order.status === RECEIVED` or `returnWindowExpiresAt <= now`.

Expected test cases:

```ts
it('activates a paid group-buy instance immediately without return-window wait', async () => {});
it('keeps existing active code idempotently when evaluate is called again', async () => {});
it('invalidates only when the paid order has refund or after-sale records', async () => {});
```

- [x] **Step 2: Extract reusable unique code generation**

Extend `group-buy-code.util.ts` with a transaction-aware helper so lifecycle and checkout share the same uniqueness loop:

```ts
import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function generateUniqueGroupBuyCode(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGroupBuyCode();
    const existing = await tx.groupBuyCode.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new InternalServerErrorException('团购推荐码生成失败');
}
```

- [x] **Step 3: Update lifecycle service**

In `GroupBuyLifecycleService.evaluateInitiatorOrder`:

- Treat `PAID`, `SHIPPED`, `RECEIVED`, and any paid/fulfillment state that cannot be cancelled as eligible for activation.
- Remove the `WAITING_RECEIVE` and `WAITING_RETURN_WINDOW` gates for new logic.
- Keep refund/after-sale invalidation for legacy or manually corrupted records.
- Use `generateUniqueGroupBuyCode(tx)` instead of the private method.

- [x] **Step 4: Run targeted tests**

```bash
cd backend
npm test -- group-buy-lifecycle.service.spec.ts --runInBand
```

Expected: lifecycle tests pass with the new immediate-activation rule.

### Task 1.2: Create Instance And Code During Payment Success

**Files:**
- Modify `backend/src/modules/order/checkout.service.ts`
- Modify `backend/src/modules/order/checkout-money-safety.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy-checkout.service.spec.ts`

- [x] **Step 1: Add failing payment-success tests**

Add a backend test that drives `CheckoutService.handlePaymentSuccess` for a `GROUP_BUY` checkout session and asserts:

- `GroupBuyInstance.status === SHARING`
- `GroupBuyInstance.activatedAt` is set
- One `GroupBuyCode` exists with `status === ACTIVE`
- `GroupBuyCode.activatedAt` is set
- The operation is idempotent on payment callback retry

- [x] **Step 2: Update `createGroupBuyRecordsAfterPayment`**

Inside the existing Serializable payment transaction:

```ts
const code = await generateUniqueGroupBuyCode(tx);
const ownInstance = await tx.groupBuyInstance.create({
  data: {
    userId: session.userId,
    activityId: bizMeta.groupBuyActivityId,
    initiatorOrderId: orderId,
    status: 'SHARING',
    activatedAt: now,
    priceSnapshot: Number(bizMeta.groupBuyPriceSnapshot ?? session.goodsAmount),
    shippingFeeSnapshot: Number(bizMeta.shippingFeeSnapshot ?? session.shippingFee ?? 0),
    freeShippingSnapshot: Boolean(bizMeta.freeShippingSnapshot),
    tierSnapshot: bizMeta.tierSnapshot,
    activitySnapshot: bizMeta,
    code: {
      create: {
        code,
        status: 'ACTIVE',
        activatedAt: now,
      },
    },
  },
});
```

Use the same transaction timestamp already used by payment success; if there is no local `now`, create one once and pass it through.

- [x] **Step 3: Preserve cash-only group-buy checkout**

Verify no change weakens `GroupBuyCheckoutService.assertCashOnly`. The test should continue to reject:

- `deductionAmount`
- `rewardId`
- `groupBuyRebateDeductionAmount`
- `couponInstanceIds`
- any VIP/platform discount field if present

- [x] **Step 4: Run targeted tests**

```bash
cd backend
npm test -- checkout-money-safety.spec.ts group-buy-checkout.service.spec.ts --runInBand
```

Expected: group-buy payment creates active code immediately and checkout still rejects all优惠/抵扣 inputs.

---

## Chunk 2: Referral Rebate Freezes On Payment And Releases On Receive

### Task 2.1: Create Pending Rebate Ledger When Referred User Pays

**Files:**
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`
- Modify `backend/src/modules/order/checkout.service.ts`

- [ ] **Step 1: Add failing pending-ledger tests**

Add tests for:

- 被推荐人付款成功后，推荐人的 `GroupBuyRebateLedger` 立即新增一条 `type=PENDING_REBATE,status=PENDING`。
- `GroupBuyRebateAccount.balance` 不增加，`reserved/withdrawn/deducted` 不变。
- 重复支付回调不会重复创建 pending ledger，靠 `idempotencyKey` 幂等。
- `candidateSequence` 对应 tier 快照金额正确。

- [ ] **Step 2: Add service method**

Add a transaction-aware method:

```ts
async createPendingReferralAfterPayment(
  tx: Prisma.TransactionClient,
  referralId: string,
  now = new Date(),
) { /* create account if missing, create pending ledger idempotently */ }
```

Rules:

- `idempotencyKey = GROUP_BUY_PENDING_REBATE:<referralId>`
- Pending ledger `balanceBefore` and `balanceAfter` both equal current available balance.
- Amount comes from the referred instance's `tierSnapshot[candidateSequence - 1]`.
- Store enough `meta` to audit: `candidateSequence`, `referredOrderId`, `referredInstanceId`, `source='REFERRED_PAYMENT'`.

- [ ] **Step 3: Wire payment path**

In `createGroupBuyRecordsAfterPayment`, after creating `GroupBuyReferral`, call `createPendingReferralAfterPayment(tx, referral.id, now)`.

If service injection would create a cycle, keep the transaction-aware logic in `CheckoutService` but route the pure amount calculation through `GroupBuyRebateService` in a later refactor. Prefer direct service reuse if module dependencies already allow it.

- [ ] **Step 4: Run targeted tests**

```bash
cd backend
npm test -- group-buy-rebate.service.spec.ts checkout-money-safety.spec.ts --runInBand
```

### Task 2.2: Release Pending Rebate On Referred Order Receive

**Files:**
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.ts`
- Modify `backend/src/modules/group-buy/group-buy-rebate.service.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy-lifecycle.service.spec.ts`

- [ ] **Step 1: Update release tests**

Change old tests that expected `WAITING_RETURN_WINDOW`. New expected behavior:

- Referred order `RECEIVED` releases rebate immediately.
- No 7-day return window condition is checked.
- Pending ledger status moves out of `PENDING`.
- A `RELEASE,status=AVAILABLE` ledger is created.
- `GroupBuyRebateAccount.balance` increases by released amount.
- Referral becomes `VALID` and `validAt` is set.

- [ ] **Step 2: Update `releaseReferralByOrderIfValid`**

Required behavior:

- Skip if referral already `VALID`.
- Return waiting status if referred order is not `RECEIVED`.
- Do not check `returnWindowExpiresAt`.
- Locate pending ledger by `GROUP_BUY_PENDING_REBATE:<referralId>`.
- Mark pending ledger `AVAILABLE` or `COMPLETED` so wallet pending aggregate no longer counts it.
- Create release ledger with `idempotencyKey=GROUP_BUY_RELEASE_REBATE:<referralId>`.
- Increment valid count and complete the group/code when tier target is reached.

- [ ] **Step 3: Keep invalidation narrow**

Because group-buy cannot be refunded or self-serviced after payment, invalidation should only handle corrupted/admin paths:

- refunded order
- deleted/voided order
- explicit admin void

Do not add a normal user path that lets users escape a paid group-buy order.

- [ ] **Step 4: Run targeted tests**

```bash
cd backend
npm test -- group-buy-rebate.service.spec.ts group-buy-lifecycle.service.spec.ts --runInBand
```

---

## Chunk 3: Block Group-Buy Cancel, Refund, And Self-Service After-Sale

### Task 3.1: Backend Order Cancel Guard

**Files:**
- Modify `backend/src/modules/order/order.service.ts`
- Modify `backend/src/modules/order/order.service.cancel.spec.ts`

- [ ] **Step 1: Add failing cancel test**

Add a test that a `GROUP_BUY` order in a normally cancellable status rejects buyer cancellation with a clear message:

```ts
expect(error.message).toContain('团购订单支付后不支持取消或退款');
```

- [ ] **Step 2: Implement guard**

Near existing VIP/non-normal order guards, reject `order.bizType === 'GROUP_BUY'`.

- [ ] **Step 3: Run test**

```bash
cd backend
npm test -- order.service.cancel.spec.ts --runInBand
```

### Task 3.2: Backend After-Sale Eligibility Guard

**Files:**
- Modify `backend/src/modules/after-sale/after-sale.service.ts`
- Modify `backend/src/modules/after-sale/after-sale.service.spec.ts`
- Modify `backend/src/modules/after-sale/after-sale.utils.ts` only if eligibility lives there.
- Modify `backend/src/modules/after-sale/after-sale.utils.spec.ts` only if helper changed.

- [ ] **Step 1: Add failing eligibility/apply tests**

Test both:

- `getEligibility` for group-buy order returns no self-service types and includes support wording.
- `createAfterSale` rejects group-buy order even if the caller manually posts a quality return/exchange type.

- [ ] **Step 2: Implement eligibility response**

Return a structured reason that the App can render:

```ts
{
  eligible: false,
  reasonCode: 'GROUP_BUY_SUPPORT_ONLY',
  reason: '团购订单支付后不支持退换货；收货后24小时内质量问题请联系客服补货。',
}
```

Keep this separate from standard after-sale windows.

- [ ] **Step 3: Run after-sale tests**

```bash
cd backend
npm test -- after-sale.service.spec.ts after-sale.utils.spec.ts --runInBand
```

---

## Chunk 4: Unified Wallet API With Separated Backend Ledgers

### Task 4.1: Wallet Summary Includes Group-Buy Rebate And Owner-Only Industry Fund

**Files:**
- Modify `backend/src/modules/bonus/bonus.service.ts`
- Modify `backend/src/modules/bonus/bonus.service.spec.ts`

- [ ] **Step 1: Add failing wallet summary tests**

Add tests for:

- Non-owner user: `balance = VIP_REWARD + NORMAL_REWARD + GROUP_BUY_REBATE`, no `industryFund` tab/section flag.
- Seller OWNER user: `balance` includes `INDUSTRY_FUND` and response sets `isSellerOwner=true`.
- `deductibleBalance = VIP_REWARD + NORMAL_REWARD + GROUP_BUY_REBATE` and excludes industry fund.
- `withdrawableBalance = balance`.
- `frozen` includes existing frozen Reward plus pending group-buy rebate.
- `groupBuyRebate.pending` is aggregated from `GroupBuyRebateLedger type=PENDING_REBATE,status=PENDING`.
- Prisma schema does not add a persisted total consumption-points account or balance field.

- [ ] **Step 2: Extend wallet response shape**

Recommended backend shape:

```ts
{
  balance,
  frozen,
  total,
  deductibleBalance,
  withdrawableBalance,
  isSellerOwner,
  vip,
  normal,
  industryFund: isSellerOwner ? industryFund : null,
  groupBuyRebate: {
    balance,
    pending,
    reserved,
    withdrawn,
    deducted,
    total,
  },
}
```

Keep old fields `balance/frozen/total/vip/normal/industryFund` compatible for existing App screens.

- [ ] **Step 3: Keep total fields derived**

Do not add any model or column such as `ConsumptionPointsAccount`, `totalConsumptionPoints`, or `consumptionPointsBalance` as a persisted source of truth. `balance`, `frozen`, `total`, `deductibleBalance`, and `withdrawableBalance` must be calculated from `RewardAccount`, `RewardLedger`, `GroupBuyRebateAccount`, and `GroupBuyRebateLedger` at read time.

- [ ] **Step 4: Implement owner detection**

Use `CompanyStaff` with `role=OWNER` and active/non-deleted constraints matching seller auth code. Do not expose industry fund section based only on nonzero balance.

- [ ] **Step 5: Run tests**

```bash
cd backend
npm test -- bonus.service.spec.ts --runInBand
```

### Task 4.2: Wallet Ledger Merges Reward And Group-Buy Rows For App

**Files:**
- Modify `backend/src/modules/bonus/bonus.service.ts`
- Modify `backend/src/modules/bonus/bonus.service.spec.ts`

- [ ] **Step 1: Add failing ledger tests**

Test that `getWalletLedger()` returns a single time-ordered list including:

- Reward release/freeze/deduct/withdraw rows.
- Group-buy pending/release/deduct/withdraw rows.
- `accountType='GROUP_BUY_REBATE'` for group-buy rows.
- Industry fund rows only when `isSellerOwner=true`; otherwise they are hidden from the App wallet ledger.

- [ ] **Step 2: Implement merge**

Fetch Reward and GroupBuy ledgers separately, map to a common DTO, sort by `createdAt desc`, then paginate after merge for App. If the current endpoint relies on database pagination, keep page size modest and over-fetch each source to avoid missing newer rows.

Common DTO fields should include:

```ts
{
  id,
  sourceLedgerId,
  source: 'REWARD' | 'GROUP_BUY_REBATE',
  accountType,
  type,
  status,
  amount,
  balanceAfter,
  title,
  description,
  createdAt,
}
```

- [ ] **Step 3: Preserve backend audit detail**

Do not collapse rows in the database. The merge is a read model for App only.

- [ ] **Step 4: Run tests**

```bash
cd backend
npm test -- bonus.service.spec.ts --runInBand
```

---

## Chunk 5: Ordinary Checkout Uses One Consumption-Points Input And Backend Splits Sources

### Task 5.1: Preview Shows Unified Deductible Balance

**Files:**
- Modify `backend/src/modules/order/order.service.ts`
- Modify `backend/src/modules/order/order-preview-prize-exclusion.spec.ts`
- Modify `backend/src/modules/bonus/reward-deduction.service.ts` only if a helper is needed.
- Use `backend/src/modules/group-buy/group-buy-rebate-deduction.service.ts`

- [ ] **Step 1: Add failing preview tests**

For a normal goods checkout preview:

- User has Reward balance 10 and GroupBuyRebate balance 20.
- Product max ratio allows 15.
- Preview returns `pointsBalance=30` and `maxDeductible=15`.
- Industry fund balance does not increase `maxDeductible`.
- Group-buy checkout preview, if reachable, returns no deduction options.

- [ ] **Step 2: Implement combined preview calculation**

Keep one App-facing number:

```ts
const rewardAvailable = await rewardDeductionService.getDeductibleBalance(userId);
const groupBuyAvailable = await groupBuyRebateDeductionService.getDeductibleBalance(userId);
const ratioCap = goodsAmount * ratio;
const maxDeductible = Math.min(ratioCap, rewardAvailable + groupBuyAvailable);
```

If existing services do not expose balance-only helpers, add focused methods rather than duplicating account queries in `OrderService`.

- [ ] **Step 3: Run preview tests**

```bash
cd backend
npm test -- order-preview-prize-exclusion.spec.ts --runInBand
```

### Task 5.2: Checkout Session Splits One Deduction Amount

**Files:**
- Modify `backend/src/modules/order/checkout.service.ts`
- Modify `backend/src/modules/order/checkout.dto.ts`
- Modify `backend/src/modules/order/checkout-money-safety.spec.ts`
- Modify `backend/src/modules/group-buy/group-buy-rebate-deduction.service.spec.ts`
- Modify `backend/src/modules/bonus/reward-deduction.service.spec.ts`

- [ ] **Step 1: Add failing checkout tests**

Test normal goods checkout with one `deductionAmount`:

- Deducts Reward first.
- Deducts remaining amount from GroupBuyRebate.
- Saves `deductionGroupId` and `groupBuyRebateDeductionGroupId` on `CheckoutSession`.
- Payment success finalizes both reservations.
- Checkout expiration/cancel releases both reservations.
- User does not need to submit `groupBuyRebateDeductionAmount`.

- [ ] **Step 2: Implement split helper**

In `CheckoutService`, add a private helper or service method:

```ts
private async reserveUnifiedConsumptionPoints(tx, params) {
  const rewardPart = await this.rewardDeductionService.reserveUpTo(tx, {
    userId,
    requestedAmount,
    orderGoodsAmount,
    ratio,
  });
  const remaining = round2(requestedAmount - rewardPart.amount);
  const groupBuyPart = remaining > 0
    ? await this.groupBuyRebateDeductionService.reserve(tx, { userId, amount: remaining, ... })
    : null;
  return { rewardPart, groupBuyPart };
}
```

If `RewardDeductionService` currently only accepts exact amounts, extend it with a safe `reserveUpTo` helper that caps by available Reward balance. Keep all mutations in the outer Serializable transaction.

- [ ] **Step 3: Keep legacy explicit group-buy deduction safe**

If `groupBuyRebateDeductionAmount` remains in DTO for backwards compatibility, reject requests that send both:

```ts
if (dto.deductionAmount && dto.groupBuyRebateDeductionAmount) {
  throw new BadRequestException('请只提交一个消费积分抵扣金额');
}
```

App should use only `deductionAmount`.

- [ ] **Step 4: Ensure group-buy product checkout still rejects all deductions**

Do not route `GroupBuyCheckoutService` through the unified deduction helper.

- [ ] **Step 5: Run tests**

```bash
cd backend
npm test -- checkout-money-safety.spec.ts reward-deduction.service.spec.ts group-buy-rebate-deduction.service.spec.ts --runInBand
```

---

## Chunk 6: Unified Withdrawal Uses Separated Ledgers

### Task 6.1: `/bonus/withdraw` Can Consume Reward + GroupBuyRebate + Owner Industry Fund

**Files:**
- Modify `backend/src/modules/bonus/withdraw-payout.service.ts`
- Modify `backend/src/modules/bonus/withdraw-payout.service.spec.ts`
- Modify `backend/src/modules/bonus/withdraw-payout.concurrency.spec.ts`

- [ ] **Step 1: Add failing withdrawal tests**

Test `/bonus/withdraw` behavior:

- User with Reward 10 and GroupBuyRebate 20 can withdraw 25 from one App request.
- Service writes Reward `WITHDRAW` ledger and GroupBuyRebate `WITHDRAW` ledger in one withdraw group.
- For seller OWNER, industry fund is used only after Reward and GroupBuyRebate are exhausted.
- For non-owner, industry fund is not used even if a stale account row exists.
- Provider failure restores every source correctly.
- Idempotent retry does not double-deduct any source.

- [ ] **Step 2: Extend split type**

Use the existing `WithdrawSplit` shape but allow source `REWARD` to contain `fromGroupBuyRebateCents > 0`.

Recommended deduction priority:

1. VIP_REWARD
2. NORMAL_REWARD
3. GROUP_BUY_REBATE
4. INDUSTRY_FUND only when `isSellerOwner=true`

This preserves the current industry-last behavior while adding group-buy before industry.

- [ ] **Step 3: Create mixed ledgers**

Update `createWithdrawLedgers` so the non-`GROUP_BUY_REBATE` unified path also writes `groupBuyRebateLedger` when `fromGroupBuyRebateCents > 0`.

Ledger metadata:

```ts
{
  scheme: 'POINTS_WITHDRAW',
  groupId: `WG-${withdrawId}`,
  outBizNo,
  accountType: 'GROUP_BUY_REBATE',
  role: 'SECONDARY' | 'TERTIARY',
}
```

- [ ] **Step 4: Keep old group-buy-only API compatible**

Do not remove `requestGroupBuyRebateWithdraw()` yet. Mark it as legacy/internal in comments if needed, but App wallet should call the unified withdraw endpoint.

- [ ] **Step 5: Run tests**

```bash
cd backend
npm test -- withdraw-payout.service.spec.ts withdraw-payout.concurrency.spec.ts --runInBand
```

---

## Chunk 7: Buyer App Wallet Shows Unified Consumption Points

### Task 7.1: Update Types And Repo Mapping

**Files:**
- Modify `src/types/domain/Bonus.ts`
- Modify `src/repos/BonusRepo.ts`
- Modify `src/repos/OrderRepo.ts`

- [ ] **Step 1: Invoke frontend design guidance**

Before editing UI code, invoke `frontend-design:frontend-design` and follow the existing quiet wallet/dashboard style.

- [ ] **Step 2: Extend wallet types**

Add fields matching backend:

```ts
export type WalletSourceType =
  | 'VIP_REWARD'
  | 'NORMAL_REWARD'
  | 'INDUSTRY_FUND'
  | 'GROUP_BUY_REBATE';

export interface WalletSummary {
  balance: number;
  frozen: number;
  total: number;
  deductibleBalance: number;
  withdrawableBalance: number;
  isSellerOwner: boolean;
  vip?: WalletAccountSummary;
  normal?: WalletAccountSummary;
  industryFund?: WalletAccountSummary | null;
  groupBuyRebate?: WalletAccountSummary & { pending: number };
}
```

- [ ] **Step 3: Keep App checkout one-input**

`OrderRepo.createCheckoutSession` should continue to submit `deductionAmount` only. Add no user-visible split fields.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

### Task 7.2: Update Wallet UI

**Files:**
- Modify `app/me/wallet.tsx`
- Modify `app/me/vip.tsx`

- [ ] **Step 1: Wallet total**

Show one top-level “消费积分” total from `wallet.balance`. Also show:

- 可抵扣：`wallet.deductibleBalance`
- 可提现：`wallet.withdrawableBalance`
- 冻结中：`wallet.frozen`

Keep text concise; do not explain backend source splitting in the main UI.

- [ ] **Step 2: Ledger list labels**

Map group-buy rows:

- `PENDING_REBATE` + `PENDING`: `团购返还冻结中`
- `RELEASE` + `AVAILABLE`: `团购返还到账`
- `DEDUCT`: `团购返还抵扣`
- `WITHDRAW`: `团购返还提现`

Display them inside the same wallet ledger list.

- [ ] **Step 3: Owner-only industry fund**

Only show industry fund tab/filter/card when `wallet.isSellerOwner === true`.

Non-owner users must not see an empty “产业基金” tab.

- [ ] **Step 4: VIP page**

If `app/me/vip.tsx` shows wallet breakdown, apply the same owner-only industry fund rule there.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

---

## Chunk 8: Buyer App Group-Buy And Order Rules Copy

### Task 8.1: Group-Buy Pages Reflect Immediate Code And No Returns

**Files:**
- Modify `app/group-buy/index.tsx`
- Modify `app/group-buy/[activityId].tsx`
- Modify `app/group-buy/checkout.tsx`
- Modify `src/components/group-buy/GroupBuyCurrentPanel.tsx`
- Modify `src/components/group-buy/GroupBuyProgressRail.tsx`
- Modify `src/components/group-buy/GroupBuyPurchaseGuardSheet.tsx`
- Modify `src/types/domain/GroupBuy.ts`

- [ ] **Step 1: Update type shape if backend exposes pending rebate**

Add optional fields such as:

```ts
pendingRebateAmount?: number;
availableRebateAmount?: number;
shareCodeStatus?: 'ACTIVE' | 'COMPLETED' | 'DISABLED' | 'EXPIRED';
```

- [ ] **Step 2: Update status wording**

Replace any “收货 7 天后生成/释放” copy with:

- `付款成功后立即生成团购推荐码`
- `被推荐人付款后返还奖励进入冻结，确认收货后到账`
- `团购订单支付后不支持退换货；收货后24小时内质量问题请联系客服补货`

- [ ] **Step 3: Keep checkout cash-only copy**

`app/group-buy/checkout.tsx` already says group-buy cannot use消费积分、红包、团购返还余额. Keep or tighten this wording; do not add deduction controls.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

### Task 8.2: Order Detail And After-Sale Pages Hide Self-Service Entry

**Files:**
- Modify `app/orders/[id].tsx`
- Modify `app/orders/after-sale/[id].tsx`
- Modify `src/types/domain/Order.ts`
- Modify `src/repos/AfterSaleRepo.ts` only if eligibility DTO changes.

- [ ] **Step 1: Order detail**

For `bizType === 'GROUP_BUY'`:

- Hide cancel/refund/after-sale buttons.
- Show compact rule line: `团购订单支付后不支持退换货；收货后24小时内质量问题请联系客服补货。`
- If a customer-service route exists, link to it. If not, show the existing support/contact entry used elsewhere in the App.

- [ ] **Step 2: After-sale application page**

If a user navigates directly to `/orders/after-sale/[id]` for a group-buy order, show the support-only message and no application form.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

---

## Chunk 9: Historical Backfill And Operational Safety

### Task 9.1: Backfill Active Codes And Pending Rebates

**Files:**
- Create `backend/scripts/backfill-group-buy-instant-codes.ts`
- Add script entry in `backend/package.json` if desired: `"group-buy:backfill-instant-codes": "ts-node scripts/backfill-group-buy-instant-codes.ts"`
- Create `backend/src/modules/group-buy/backfill-group-buy-instant-codes.spec.ts` if logic is extracted.

- [ ] **Step 1: Build dry-run script**

Script must dry-run by default and require `--execute` to write.

Dry-run report:

- count of paid `QUALIFICATION_PENDING` instances needing active codes
- count of `CANDIDATE` referrals needing pending ledgers
- count of received referrals that can release immediately
- count of skipped invalid/refunded/after-sale records

- [ ] **Step 2: Write mode**

In `--execute` mode, in Serializable batches:

- Create active code for paid initiator instances and set status `SHARING`.
- Create missing `PENDING_REBATE` ledgers for paid referred orders.
- Release eligible received referrals immediately by calling the same service path as order receive.
- Never overwrite an existing code.

- [ ] **Step 3: Add script test or documented smoke command**

If extracted helper is practical:

```bash
cd backend
npm test -- backfill-group-buy-instant-codes.spec.ts --runInBand
```

Otherwise document smoke commands in the script header and this plan:

```bash
cd backend
npm run group-buy:backfill-instant-codes
npm run group-buy:backfill-instant-codes -- --execute
```

### Task 9.2: Safety Checklist Documentation

**Files:**
- Modify `docs/issues/tofix-safe.md`

- [ ] **Step 1: Record reviewed risk areas**

Add an entry that this change touches:

- 支付成功状态转换
- 推荐奖励冻结/释放
- 钱包提现扣款
- 普通商品结算抵扣
- 团购售后禁用

- [ ] **Step 2: Mark mitigations**

Document:

- Serializable transaction boundaries
- idempotency keys for pending/release/withdraw/deduct
- payment callback retry behavior
- group-buy self-service after-sale/cancel guards

---

## Chunk 10: Documentation And Final Verification

### Task 10.1: Sync Product And App Docs

**Files:**
- Modify `docs/architecture/frontend.md`
- Modify `docs/features/refund.md`
- Modify `plan.md`
- Modify this plan file as tasks complete.

- [ ] **Step 1: Frontend docs**

Document:

- Wallet shows unified consumption points total.
- Ledger includes group-buy返还 rows.
- Industry fund is owner-only.
- Group-buy pages say payment immediately generates share code.
- Group-buy order detail uses support-only quality issue copy.

- [ ] **Step 2: Refund docs**

Add group-buy special rule:

- No self-service refund/return/exchange.
- Only quality issue within 24h after receipt, handled by customer service as reshipment/replacement.
- No refund.

- [ ] **Step 3: Project task board**

Update `plan.md` with the implementation status and any remaining manual test items.

### Task 10.2: Verification Commands

- [ ] **Step 1: Prisma validation**

```bash
cd backend
npx prisma validate
```

- [ ] **Step 2: Backend targeted Jest**

```bash
cd backend
npm test -- group-buy-lifecycle.service.spec.ts group-buy-rebate.service.spec.ts group-buy-checkout.service.spec.ts checkout-money-safety.spec.ts bonus.service.spec.ts withdraw-payout.service.spec.ts withdraw-payout.concurrency.spec.ts order.service.cancel.spec.ts after-sale.service.spec.ts --runInBand
```

- [ ] **Step 3: Backend build**

```bash
cd backend
npm run build
```

- [ ] **Step 4: Buyer App typecheck and tests**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

- [ ] **Step 5: Manual App smoke checks**

Run the App locally and verify:

- Group-buy purchase success shows an active share code immediately.
- Referred payment creates a frozen rebate visible in wallet.
- Referred order receive releases rebate into available consumption points.
- Normal checkout can use one consumption-points deduction input that includes group-buy rebate.
- Group-buy checkout shows no deduction/coupon controls.
- Wallet ledger shows Reward and group-buy rebate rows in one list.
- Non-owner user does not see industry fund tab/section.
- Group-buy order detail has no cancel/after-sale button and shows 24h support-only copy.

### Task 10.3: Completion Criteria

- [ ] All targeted backend tests pass.
- [ ] `npx prisma validate` passes.
- [ ] `backend npm run build` passes.
- [ ] Buyer App TypeScript check passes.
- [ ] Docs and `plan.md` are updated.
- [ ] No digital asset behavior was changed.
- [ ] Git diff contains only files required by this plan.
