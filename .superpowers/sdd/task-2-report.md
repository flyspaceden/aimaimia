# Task 2 Report: Integer-Cent Discounted Order Profit Calculator

## Scope

- Added the integer-cent profit input/output contract and item breakdown types.
- Added capacity-aware largest-remainder allocation with `OrderItem.id` ordering.
- Added the pure order profit snapshot calculator and focused golden/boundary tests.
- No existing source, schema, checkout, or documentation files were modified.

## TDD Evidence

### RED

Command:

```bash
cd backend && npx jest src/modules/profit/order-profit-snapshot-calculator.spec.ts --runInBand
```

Result: exit code 1. Jest failed before running tests with the expected missing implementation error:

```text
TS2307: Cannot find module './order-profit-snapshot-calculator'
Test Suites: 1 failed, 1 total
```

### GREEN

Command:

```bash
cd backend && npx jest src/modules/profit/order-profit-snapshot-calculator.spec.ts --runInBand
```

Result: exit code 0.

```text
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
Snapshots:   0 total
```

Covered vectors and boundaries:

- Golden discounted-profit vectors, including zero-floor behavior.
- Explicit item discounts before VIP, Reward, group-buy, and Coupon allocation.
- Remaining-capacity redistribution and deterministic last-cent allocation.
- Prize exclusion and missing/non-positive cost reconciliation.
- Gross and discount-capacity conservation failures.
- Positive/negative item margin aggregation before the order-level floor.
- Captain-eligible profit subset with `0 <= C <= D`.
- No duplicate deduction of promotions already reflected in `unitPriceCents`.
- Safe-integer aggregate overflow and allocator exceptions fail closed without throwing.
- Non-finite item costs and top-level order amounts are sanitized before persistence.
- Half-up yuan-to-cent conversion and unsafe conversion rejection.
- Captain-eligible loss with only non-eligible profit keeps `C=0`.

## Verification

```text
git diff --check  -> exit code 0
cd backend && npm run build -> exit code 0 (nest build)
```

Two independent review rounds were completed. All Critical and Important findings were fixed;
the final focused suite passed 28/28.
