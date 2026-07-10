# Task 3 Report: Payment-Time Profit And Relationship Snapshots

## Scope

- Added immutable revision-1 `OrderProfitSnapshot` creation for every paid `NORMAL_GOODS` suborder.
- Persisted the per-suborder `groupBuyRebateDeductionAmount` and aligned cross-merchant discount allocation with the calculator order: VIP, Reward, group-buy rebate, Coupon.
- Captured transaction-consistent buyer, direct inviter, VIP/normal ancestor, captain and RuleConfig facts without process-cached config reads.
- Added idempotent reconciliation tasks for missing, zero or invalid SKU cost; reconciliation-required orders remain paid but do not enter direct/captain reward paths.
- Extracted the existing direct-relation semantics for reuse by snapshot and direct commission code.
- Added lock-first, re-read-after-lock normal-tree enrollment so concurrent first payments converge on one node.
- Excluded `VIP_PACKAGE` at the whole-order boundary and retained duplicate payment callback idempotency.

## TDD Evidence

### Initial RED

Command:

```bash
cd backend
npx jest src/modules/profit/order-profit-snapshot.service.spec.ts src/modules/order/checkout-profit-snapshot.spec.ts --runInBand
```

Result: exit code 1. TypeScript reported the expected missing `order-profit-snapshot.service`, `normal-tree-resolver` and `CheckoutService.setOrderProfitSnapshotService` implementation.

### Boundary RED

After the first minimal implementation, focused tests were extended before each fix and failed for the intended reasons:

- Reconciliation-required snapshots still called the legacy direct reward path.
- Normal-tree placement selected the first available parent instead of the least occupied parent.
- Independent VIP and Reward merchant allocations over-discounted one suborder by one cent.
- `NaN` and infinite SKU cost threw from `yuanToCents` instead of entering reconciliation.
- Non-finite or unsafe top-level order amounts and item unit prices threw before reaching the calculator.

Each failure was rerun to GREEN after the corresponding minimal production change.

## Safety Review

- The existing payment callback remains `Serializable`; snapshot, reconciliation task, normal-tree enrollment, status history and attribution decisions use the same transaction client.
- The checkout CAS continues to own duplicate callback idempotency; the snapshot service also returns the existing current snapshot and never creates revision 2.
- The migration partial unique current-snapshot index and reconciliation unique key remain the database backstops.
- Normal-tree enrollment takes advisory lock `2026022801` before any progress/node create, then re-reads progress and node state under the lock.
- No Task 4 VIP/normal reward amount algorithm or Task 5 captain V3 amount algorithm was changed.

## Verification

```bash
cd backend
npx jest src/modules/profit/order-profit-snapshot.service.spec.ts src/modules/order/checkout-profit-snapshot.spec.ts src/modules/order/checkout-captain-attribution.spec.ts src/modules/order/checkout-vip-direct-referral.spec.ts --runInBand
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
npm run build
cd ..
git diff --check
```

- Brief focused suites: 4 passed, 30 tests passed.
- Prisma schema validation: passed.
- Nest backend build: passed.
- `git diff --check`: passed.

Additional regression evidence:

- All checkout suites: 14 passed, 87 tests passed.
- Shared direct-relation consumer suite: 1 passed, 16 tests passed.
