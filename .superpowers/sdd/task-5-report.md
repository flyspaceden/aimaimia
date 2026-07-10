# Task 5 Report: Fund Captain V3 From Platform Retained Profit

## Scope

Implemented the payment-time captain V3 path without changing the bonus engine,
checkout, schema, or monthly settlement service.

Changed files:

- `backend/src/modules/captain/captain-attribution.service.ts`
- `backend/src/modules/captain/captain-attribution.service.spec.ts`
- `backend/src/modules/captain/captain-commission.service.ts`
- `backend/src/modules/captain/captain-commission.service.spec.ts`
- `backend/src/modules/profit/captain-profit-funding.ts`
- `backend/src/modules/profit/captain-profit-funding.spec.ts`

## Implementation

- Reads only the current `READY` payment profit snapshot and its snapshotted V3
  captain/member rules. It does not read current captain configuration or current
  captain relationships.
- Uses `C = captainEligibleProfitAmount` for direct and monthly maximum amounts.
- Calculates platform-retained funding in cents as
  `R = D - tree reward - industry fund - actual external direct reward`.
- Writes `PLATFORM_RETAINED_CREDIT=+R`,
  `CAPTAIN_DIRECT_HOLD=-directAmount`, and
  `CAPTAIN_MONTHLY_HOLD=-monthlyMaximum` with order-scoped idempotency keys.
- Creates exactly one frozen direct captain ledger and increments only frozen
  balance. The monthly hold is recorded only in `OrderProfitFundingLedger`.
- Creates a pending reconciliation task and no captain reward when total holds
  exceed `R`; configured rates are never reduced at runtime.
- Skips V2, disabled/pre-effective V3, non-ready snapshots, `D=0`, `C=0`, no or
  inactive direct relation/profile, and self-attribution.
- Keeps `SALES_V2` release/refund behavior intact. `PROFIT_V3` lifecycle handling
  filters out legacy indirect ledgers so only the direct layer can move.

Golden vector:

- `C=35.00`
- direct rate `11%` -> frozen direct `3.85`
- monthly maximum rate `4.5%` -> hidden monthly hold `1.58`
- total hold `5.43`, admitted only when `R >= 5.43`

## TDD Evidence

RED commands:

```bash
cd backend
npx jest src/modules/captain/captain-attribution.service.spec.ts \
  src/modules/captain/captain-commission.service.spec.ts --runInBand
npx jest src/modules/captain/captain-commission.service.spec.ts --runInBand
```

Observed failures before implementation:

- V3 golden-vector attribution returned `skipped` and wrote no funding ledgers.
- Excess holds did not create a reconciliation task.
- V3 release and refund processed a legacy indirect ledger in addition to the
  direct ledger.

GREEN commands:

```bash
cd backend
npx jest src/modules/profit/captain-profit-funding.spec.ts \
  src/modules/captain/captain-attribution.service.spec.ts \
  src/modules/captain/captain-commission.service.spec.ts --runInBand
npx jest src/modules/captain --runInBand
npm run build
git diff --check
```

Results at report time:

- Focused Task 5 tests: 25 passed, 0 failed.
- Captain group: 71 passed, 0 failed.
- Captain group plus funding helper: 74 passed, 0 failed.
- Backend Nest build: passed.
- Full working-tree diff check: passed.

## Scope Isolation

Concurrent Task 4 bonus-engine edits were present in the shared worktree during
verification. They were inspected only to confirm the same cent-level `R`
formula and are intentionally excluded from the Task 5 commit.
