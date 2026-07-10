# Restore Paid VIP Referral Bonus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the one-time referral bonus for paid VIP package activation without granting it for cumulative-spend auto-upgrades, then backfill the confirmed missing 51.87 yuan reward.

**Architecture:** Reconnect the existing `grantVipReferralBonus()` method inside the paid `activateVipAfterPayment()` Serializable transaction after referral-context resolution. Use the `VipPurchase` amount and rate snapshots, preserve current VIP-tree relationship rules, and add a defensive ledger lookup keyed by `VIP_REFERRAL + vipPurchaseId` before crediting. Production backfill uses the same ledger shape and a Serializable, re-runnable transaction.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, TypeScript.

## Global Constraints

- Only paid `APP_VIP_PACKAGE` activation grants this one-time bonus.
- Cumulative-spend automatic VIP upgrade never grants it.
- Amount is truncated to cents from `VipPurchase.amount × VipPurchase.referralBonusRate`.
- Existing inactive-recipient platform fallback remains unchanged.
- All balance and ledger writes run at Serializable isolation.
- Publish only this scoped change through clean `staging` and `main` worktrees.

---

### Task 1: Lock the paid-package regression

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`

**Interfaces:**
- Consumes: `resolveVipUpgradeReferralContext(tx, userId)` and `grantVipReferralBonus(tx, inviterUserId, inviteeUserId, amount, vipPurchaseId)`.
- Produces: paid VIP activation calls the existing grant method once with the snapshot-derived amount.

- [ ] **Step 1: Replace the test that forbids paid-package awards**

Change the paid-package test to expect `grantVipReferralBonus` with the valid direct inviter, invitee, truncated snapshot amount, and `VipPurchase.id`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && npm test -- --runInBand src/modules/bonus/bonus.service.spec.ts -t "付费 VIP 包激活按购买快照发放一次性 VIP 推荐奖励"`

Expected: FAIL because `grantVipReferralBonus` has zero calls.

- [ ] **Step 3: Restore the minimal activation call**

After `resolveVipUpgradeReferralContext()`, calculate:

```ts
const referralBonusRateSnapshot = vipPurchase.referralBonusRate ?? 0;
const referralBonus = Math.floor(vipPurchase.amount * referralBonusRateSnapshot * 100) / 100;
if (referralContext.directInviterUserId && referralBonus > 0) {
  await this.grantVipReferralBonus(
    tx,
    referralContext.directInviterUserId,
    userId,
    referralBonus,
    vipPurchase.id,
  );
}
```

- [ ] **Step 4: Run the focused test and full BonusService suite**

Run:

```bash
cd backend
npm test -- --runInBand src/modules/bonus/bonus.service.spec.ts
```

Expected: 1 suite passes with all tests green.

### Task 2: Add defensive grant idempotency and document the restored rule

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `docs/features/buy-vip.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

**Interfaces:**
- Consumes: `RewardLedger.refType`, `RewardLedger.refId`, `RewardLedger.deletedAt`.
- Produces: `grantVipReferralBonus()` returns without a second balance mutation when an active ledger already exists for the purchase.

- [ ] **Step 1: Write and run the duplicate-grant failing test**

Mock an existing `VIP_REFERRAL` ledger for the same `vipPurchaseId`, call the private grant method through the service test, and assert no account or ledger mutation. Run the named test and verify it fails before the guard exists.

- [ ] **Step 2: Add the minimal existing-ledger guard**

At the start of `grantVipReferralBonus()`, query:

```ts
const existing = await tx.rewardLedger.findFirst({
  where: {
    refType: 'VIP_REFERRAL',
    refId: vipPurchaseId,
    deletedAt: null,
  },
  select: { id: true },
});
if (existing) return;
```

- [ ] **Step 3: Update rule and safety documentation**

Record that paid VIP packages grant the snapshot-based one-time reward, auto-upgrades do not, and the 2026-07-05 regression was caused by over-broad removal during referral unification.

- [ ] **Step 4: Run focused tests, build, Prisma validation, and diff checks**

Run:

```bash
cd backend
npm test -- --runInBand src/modules/bonus/bonus.service.spec.ts
npm run build
DATABASE_URL='postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder' npx prisma validate
cd ..
git diff --check
```

Expected: all commands exit 0.

### Task 3: Publish narrowly and backfill production

**Files:**
- No additional source files.
- Update: `docs/operations/阿里云部署.md` with the exact production SQL/transaction result after success.

**Interfaces:**
- Consumes: validated scoped staging commit.
- Produces: equivalent staging/main commits and one production `VIP_REFERRAL` ledger for the affected purchase.

- [ ] **Step 1: Commit and push the scoped staging change**

Review `git diff --stat`, commit only the files named above, push `HEAD:staging`, and record the commit hash.

- [ ] **Step 2: Cherry-pick into a clean main worktree**

Create a clean worktree from the current `origin/main`, cherry-pick the staging commit, and rerun the Task 2 verification commands.

- [ ] **Step 3: Push main and verify production deploy commit**

Push `HEAD:main`, wait for deployment, then verify `/www/wwwroot/aimaimai-prod-src/backend` reports the new main commit and the service is online.

- [ ] **Step 4: Execute the exact-user Serializable backfill**

Re-read 32, 119, the `VipPurchase`, and existing ledgers. Abort unless all preconditions match. In one Serializable transaction, upsert 32's `VIP_REWARD` account, create the 51.87 `VIP_REFERRAL` release ledger, and increment the available balance. If the ledger already exists, return an idempotent skip.

- [ ] **Step 5: Verify production state**

Confirm exactly one ledger references the affected `VipPurchase.id`, its amount is 51.87 and status is AVAILABLE, account balance increased once, the referral/tree relation is unchanged, and a second dry run reports skip.
