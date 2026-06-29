# Order Receiver Info Correction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let buyers correct the current order's receiver phone/address when seller waybill generation fails before shipment.

**Architecture:** Reuse `InboxMessage` for buyer notification, add a buyer-owned order receiver-info update API guarded by order/shipment state, and surface the action in the App order detail. Keep the first version limited to `PAID` normal orders with no generated waybill.

**Tech Stack:** NestJS, Prisma, React Native Expo, TanStack Query, Jest.

---

## Chunk 1: Backend Behavior

### Task 1: Order Receiver Info API

**Files:**
- Create: `backend/src/modules/order/dto/update-order-receiver-info.dto.ts`
- Modify: `backend/src/modules/order/order.controller.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Test: `backend/src/modules/order/order-receiver-info.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- `PATCH /orders/:id/receiver-info` service path updates encrypted `addressSnapshot` for a buyer-owned `PAID` order with no `Shipment.waybillNo`.
- rejects invalid phone.
- rejects generated-waybill and non-PAID orders.

- [ ] **Step 2: Run backend tests and verify RED**

Run:

```bash
npx jest backend/src/modules/order/order-receiver-info.service.spec.ts --runInBand
```

- [ ] **Step 3: Implement minimal DTO/controller/service**

Add DTO validation, parse region text with existing helper, update address snapshot in Serializable transaction, and return mapped order detail.

- [ ] **Step 4: Verify GREEN**

Run the same Jest command plus related order mapping tests if touched.

### Task 2: Waybill Failure Notification

**Files:**
- Modify: `backend/src/modules/seller/shipping/seller-shipping.module.ts`
- Modify: `backend/src/modules/seller/shipping/seller-shipping.service.ts`
- Test: `backend/src/modules/seller/shipping/seller-shipping.service.spec.ts`

- [ ] **Step 1: Write failing test**

Simulate `SfExpressService.createOrder` throwing `BadRequestException('顺丰API错误：对方电话或手机不合法')`; assert the service clears the generation marker and calls `InboxService.send` for the order buyer with route `/orders/[id]`.

- [ ] **Step 2: Verify RED**

```bash
npx jest backend/src/modules/seller/shipping/seller-shipping.service.spec.ts --runInBand
```

- [ ] **Step 3: Implement detection and notification**

Inject `InboxService`; when the carrier error message is receiver-phone-like, load `order.userId` from the reserved context or order row and send a transaction message. Do not notify buyer for sender/company phone errors.

- [ ] **Step 4: Verify GREEN**

Run the seller shipping test.

## Chunk 2: Buyer App

### Task 3: Repository and Types

**Files:**
- Modify: `src/types/domain/Order.ts`
- Modify: `src/types/domain/Inbox.ts`
- Modify: `src/repos/OrderRepo.ts`

- [ ] Add `receiverInfoEditable` / `receiverInfoIssue` fields if returned by backend.
- [ ] Add `updateReceiverInfo(orderId, payload)` repo method.
- [ ] Add `order_receiver_info_required` inbox type.

### Task 4: Order Detail UI

**Files:**
- Create: `app/orders/receiver-info/[id].tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `app/me/addresses.tsx`

- [ ] Add a compact warning/action row under the address card when receiver info needs attention or is editable.
- [ ] Add the edit screen with recipient, phone, region picker, detail fields.
- [ ] Use mainland phone regex in both order receiver editor and address book.
- [ ] Refresh `['order', id]`, `['orders']`, and `['inbox']` after save.

## Chunk 3: Docs and Verification

### Task 5: Documentation and Checks

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [ ] Document the App order receiver-info correction entry.
- [ ] Mark the relevant plan progress or add a release note item.
- [ ] Run targeted backend tests.
- [ ] Run App TypeScript check if available.
