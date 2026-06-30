# Task 1 Report: Delivery Schema, Enums, And Generated Client

## Scope completed

- Extended `backend/prisma-delivery/schema.prisma` with the new pickup/carrier/cost-ledger enums.
- Extended `DeliveryCheckoutSession`, `DeliveryOrder`, `DeliverySubOrder`, and `DeliveryOrderItem` with the briefed pickup and cost fields.
- Added `DeliveryPickupBatch`, `DeliveryPickupBatchItem`, `DeliveryCarrierOrder`, and `DeliveryShippingCostLedger`.
- Added required reverse relations, including `DeliveryMerchant.pickupBatches`, `DeliveryOrder.shippingCostLedgers`, `DeliveryOrder.pickupBatches`, `DeliverySubOrder.shippingCostLedgers`, `DeliverySubOrder.pickupBatches`, and `DeliveryOrderItem.pickupBatchItems`.
- Extended `DeliveryIdService` to accept `PSTH` and `PSCY`.

## TDD flow

### RED

- Added the required spec:
  - `service.next('PSTH')` matches `^PSTH\\d{13}$`
  - `service.next('PSCY')` matches `^PSCY\\d{13}$`
- First test run was blocked because this worktree did not yet have `src/generated/delivery-client`.
- Generated the existing delivery client to restore the test prerequisite.
- Re-ran the focused test and confirmed the expected failure:
  - `Invalid delivery prefix: PSTH`

### GREEN

- Added `PSTH` and `PSCY` to `DELIVERY_ID_PREFIXES`.
- Implemented the schema changes from the brief.
- `prisma validate` passed without needing extra relation-name disambiguation beyond the added reverse fields.
- Regenerated the delivery Prisma client.
- Re-ran the focused prefix spec and it passed.

## Verification

Executed from `backend` in this worktree:

```bash
npm test -- delivery-id.service.spec.ts --runInBand
DELIVERY_DATABASE_URL=postgresql://user:pass@localhost:5432/delivery npx prisma validate --schema prisma-delivery/schema.prisma
npm run prisma:delivery:generate
npm test -- delivery-id.service.spec.ts --runInBand
```

Results:

- Focused prefix test: PASS
- Prisma schema validation: PASS
- Delivery Prisma client generation: PASS

## Commit

Planned commit message from brief:

```bash
feat(delivery): add pickup batch schema
```

## Notes

- The generated client was required as a local prerequisite for Jest compilation in this worktree.
- No checkout, pickup service, Huolala integration logic, or UI work was implemented.

## Review fix: enforce pickup batch suborder tuple

### What I changed

- Added `@@unique([id, orderId, merchantId])` to `DeliverySubOrder` so Prisma can expose a database-level unique tuple covering the owning order and merchant.
- Changed `DeliveryPickupBatch.subOrder` to a composite relation on `[subOrderId, orderId, merchantId] -> [id, orderId, merchantId]`.
- Kept the direct `order` and `merchant` relations on `DeliveryPickupBatch`; Prisma validation accepts them, and the composite `subOrder` relation now prevents mismatched `subOrderId` / `orderId` / `merchantId` combinations from being stored.

### Tests run and results

- `DELIVERY_DATABASE_URL=postgresql://user:pass@localhost:5432/delivery npx prisma validate --schema prisma-delivery/schema.prisma` -> PASS
- `npm run prisma:delivery:generate` -> PASS
- `npm test -- delivery-id.service.spec.ts --runInBand` -> PASS

### Files changed

- `backend/prisma-delivery/schema.prisma`
- `.superpowers/sdd/task-1-report.md`

## Re-review fix: enforce pickup batch item suborder tuple

### What I changed

- Added `subOrderId` to `DeliveryPickupBatchItem` and made both its `batch` and `orderItem` relations share that same field.
- Added `@@unique([id, subOrderId])` to `DeliveryPickupBatch` and `DeliveryOrderItem` so Prisma can enforce composite foreign keys from batch items.
- Changed `DeliveryPickupBatchItem.batch` to reference `[batchId, subOrderId] -> DeliveryPickupBatch[id, subOrderId]`.
- Changed `DeliveryPickupBatchItem.orderItem` to reference `[orderItemId, subOrderId] -> DeliveryOrderItem[id, subOrderId]`.
- Kept the item uniqueness scoped to `@@unique([batchId, orderItemId])`; the shared `subOrderId` now makes cross-sub-order mismatches fail at the database relation level.

### Tests run and results

- `DELIVERY_DATABASE_URL=postgresql://user:pass@localhost:5432/delivery npx prisma validate --schema prisma-delivery/schema.prisma` -> PASS
- `npm run prisma:delivery:generate` -> PASS
- `npm test -- delivery-id.service.spec.ts --runInBand` -> PASS

### Files changed

- `backend/prisma-delivery/schema.prisma`
- `.superpowers/sdd/task-1-report.md`

## Review fix: constrain shipping cost ledger lineage

### What I changed

- Added `@@unique([id, orderId])` to `DeliverySubOrder` so `DeliveryShippingCostLedger.subOrder` can bind through `[subOrderId, orderId]` and reject ledgers that point at a sub-order from another order.
- Added `@@unique([id, orderId, subOrderId])` to `DeliveryPickupBatch` so `DeliveryShippingCostLedger.batch` can bind through `[batchId, orderId, subOrderId]` and reject ledgers whose batch does not belong to the same order and sub-order lineage.
- Changed `DeliveryShippingCostLedger.subOrder` from the standalone `subOrderId -> id` relation to the composite optional relation `[subOrderId, orderId] -> DeliverySubOrder[id, orderId]`.
- Changed `DeliveryShippingCostLedger.batch` from the standalone `batchId -> id` relation to the composite optional relation `[batchId, orderId, subOrderId] -> DeliveryPickupBatch[id, orderId, subOrderId]`.
- Preserved order-level `PREPAID_BY_USER` rows by keeping both `subOrderId` and `batchId` nullable.
- Prisma validates this optional-composite layout, but because SQL composite foreign keys do not fire when one member is `NULL`, schema alone still cannot forbid `batchId != null` together with `subOrderId = null`. The ledger lineage is now constrained whenever a sub-order or batch lineage is present; batch-bound writes still need to keep `subOrderId` populated.

### Tests run and results

- `DELIVERY_DATABASE_URL=postgresql://user:pass@localhost:5432/delivery npx prisma validate --schema prisma-delivery/schema.prisma` -> PASS
- `npm run prisma:delivery:generate` -> PASS
- `npm test -- delivery-id.service.spec.ts --runInBand` -> PASS

### Files changed

- `backend/prisma-delivery/schema.prisma`
- `.superpowers/sdd/task-1-report.md`

## Follow-up fix: strengthen shipping cost ledger batch lineage

### What I changed

- Added `@@unique([id, orderId])` to `DeliveryPickupBatch` so a ledger can always bind any non-null `batchId` to the same `orderId`, even when `subOrderId` is null.
- Changed `DeliveryShippingCostLedger.batch` to the optional composite relation `[batchId, orderId] -> DeliveryPickupBatch[id, orderId]`.
- Added a second named optional relation `DeliveryShippingCostLedger.batchSubOrder` on `[batchId, subOrderId] -> DeliveryPickupBatch[id, subOrderId]`, with the reverse field `DeliveryPickupBatch.costLedgersBySubOrder`.
- Kept `DeliveryShippingCostLedger.subOrder` on `[subOrderId, orderId] -> DeliverySubOrder[id, orderId]`.
- This combination preserves order-level rows with both `subOrderId` and `batchId` null, enforces same-order lineage whenever `batchId` is present, and additionally enforces same-sub-order lineage whenever both `batchId` and `subOrderId` are present.

### Tests run and results

- `DELIVERY_DATABASE_URL=postgresql://user:pass@localhost:5432/delivery npx prisma validate --schema prisma-delivery/schema.prisma` -> PASS
- `npm run prisma:delivery:generate` -> PASS
- `npm test -- delivery-id.service.spec.ts --runInBand` -> PASS

### Files changed

- `backend/prisma-delivery/schema.prisma`
- `.superpowers/sdd/task-1-report.md`
