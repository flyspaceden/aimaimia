## Task 8 Report: Delivery Center Pickup Batch Workbench

### Summary
- Added delivery-seller pickup batch types and API methods for list/detail/mark-ready/mark-loaded/report-exception.
- Registered `/pickup-batches` under the seller layout and added the “提货批次” menu entry under “订单履约”.
- Built a dense Ant Design pickup batch workbench with batch goods, quantities, status, unit/address fallback, driver, vehicle, timing, ready/loaded actions, and exception feedback.
- Extended order detail to prefer pickup batch operations when `pickupBatches` exist while preserving the legacy `shipOrder` action for orders without pickup batches.
- Extended logistics tracking to show Huolala pickup batch status, driver, and vehicle while keeping legacy shipment tracking.
- Added a delivery-seller contract test that locks pickup batch route/API/page wiring and checks that seller-facing batch views do not render freight amount fields.
- Review follow-up: added cost-redacted `pickupBatches` to seller order list/detail responses so the order detail and logistics pages do not silently fall back to legacy shipment data.
- Review follow-up: gated order detail batch actions and legacy confirm-shipment action behind `orders:write`.

### Changed Files
- `delivery-seller/src/types/index.ts`
- `delivery-seller/src/api/orders.ts`
- `delivery-seller/src/App.tsx`
- `delivery-seller/src/layouts/SellerLayout.tsx`
- `delivery-seller/src/pages/pickup-batches/index.tsx`
- `delivery-seller/src/pages/orders/detail.tsx`
- `delivery-seller/src/pages/orders/logistics.tsx`
- `delivery-seller/test/deliveryCenterContracts.test.ts`
- `backend/src/modules/delivery/seller/delivery-seller-ops.service.ts`
- `backend/src/modules/delivery/seller/delivery-seller-ops.service.spec.ts`

### Validation
- `cd delivery-seller && npm test -- deliveryCenterContracts.test.ts`
  - Passed: 26/26 tests.
- `cd delivery-seller && npm run build`
  - Passed: TypeScript build and Vite production build completed.
  - Note: Vite reported the existing large chunk size warning for vendor bundles.
- `cd backend && npm test -- delivery-seller-ops.service.spec.ts --runInBand`
  - Passed: 8/8 tests.
- `cd backend && npx tsc -p tsconfig.json --noEmit --pretty false`
  - Passed.
- Seller source scan for freight amount identifiers in Task 8 files returned no matches.

### Known Limitations
- The workbench displays `unitSnapshot` and `addressSnapshot` when the seller API provides them. The current seller pickup mapper may only provide `merchantName`/`unitId`, so the UI falls back to those values.
- Batch actions rely on the backend Task 5 state machine and permissions. Read-only users can view the page, while write actions are disabled when `orders:write` is missing.
