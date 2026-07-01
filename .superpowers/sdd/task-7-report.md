# Task 7 Report: Delivery Admin Freight Center And Pickup Operations UI

## Summary

- Added delivery-admin freight center at `/freight-center` with prepaid freight, Huolala actual cost, cost difference, exception batch metrics, and batch-level freight table.
- Added delivery-admin pickup batch operations at `/pickup-batches` with supported filters, order/sub-order batch grouping, item expansion, Huolala call/sync/cancel actions, and manual cost adjustment.
- Extended delivery order detail with payment split, pickup plan, batch fulfillment records, and shipping cost ledger display when the backend provides ledger rows.
- Linked legacy shipping records to the new freight center and pickup batch pages while preserving existing SF shipping records.
- Updated delivery-admin routing/menu, API client, shared types, `docs/architecture/admin-frontend.md`, and `plan.md`.

## Changed Files

- `delivery-admin/src/types/delivery-management.ts`
- `delivery-admin/src/api/delivery-management.ts`
- `delivery-admin/src/App.tsx`
- `delivery-admin/src/layouts/AdminLayout.tsx`
- `delivery-admin/src/pages/delivery-admin/freight-center.tsx`
- `delivery-admin/src/pages/delivery-admin/pickup-batches.tsx`
- `delivery-admin/src/pages/delivery-admin/order-detail.tsx`
- `delivery-admin/src/pages/delivery-admin/shipping-records.tsx`
- `docs/architecture/admin-frontend.md`
- `plan.md`
- `.superpowers/sdd/task-7-report.md`

## Build And Checks

- `cd delivery-admin && npm run build` passed.
- `git diff --check` passed.

## Known Limitations

- Backend `listAdminPickupBatches` supports `status`, `merchantId`, `unitId`, `from`, and `to`; the pages do not send unsupported keyword filters.
- The order detail cost ledger section only renders ledger rows returned by the backend. If `shippingCostLedgers` is empty, it falls back to aggregate cost fields instead of inventing ledger rows.
- Huolala driver and vehicle snapshots are provider JSON. The UI extracts common name/phone/plate/model keys and falls back to `-` when those keys are absent.
