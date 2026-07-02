# Coupon Claim Notification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add buyer-facing reminders when the coupon center has new claimable platform coupons.

**Architecture:** Backend owns claimable coupon eligibility and seen state. App reads a small alert summary for the badge and calls a read endpoint when the buyer enters the coupon-center tab. Message center uses the existing notification-message pipeline.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React Native Expo, TanStack Query, node:test, Jest.

---

## Files

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260702053000_coupon_claimable_seen_state/migration.sql`
- Modify: `backend/src/modules/coupon/coupon.service.ts`
- Modify: `backend/src/modules/coupon/coupon.controller.ts`
- Modify: `backend/src/modules/notification/notification.registry.ts`
- Modify: `backend/src/modules/coupon/coupon-campaign-rules.spec.ts`
- Modify: `src/repos/CouponRepo.ts`
- Modify: `src/types/domain/Coupon.ts`
- Modify: `app/me/coupons.tsx`
- Modify: `scripts/__tests__/coupon-campaign-rules.test.mjs`
- Update docs: `docs/features/redpocket.md`, `docs/architecture/frontend.md`, `plan.md`

## Task 1: Backend Claimable Alert State

- [x] Add a `CouponClaimableSeenState` Prisma model keyed by `userId`.
- [x] Add a migration creating the table and unique user constraint.
- [x] Add `getClaimableAlert(userId)` in `CouponService`.
- [x] Add `markClaimableAlertRead(userId)` in `CouponService`.
- [x] Add controller routes `GET /coupons/claimable-alert` and `POST /coupons/claimable-alert/read`.
- [x] Add Jest tests proving count > 0 before read and count = 0 after read.

## Task 2: Message Center Notification

- [x] Add `coupon.claimableAvailable` to `NotificationRegistry`.
- [x] In `getClaimableAlert`, emit one idempotent notification when new campaign IDs exist.
- [x] Use routeKey `COUPONS`.
- [x] Add a test proving the claimable notification routes to the coupon center tab.

## Task 3: App Badge UX

- [x] Add `CouponRepo.getClaimableAlert()`.
- [x] Add `CouponRepo.markClaimableAlertRead()`.
- [x] Extend coupon domain types with `ClaimableCouponAlertDto`.
- [x] In `app/me/coupons.tsx`, fetch alert summary when logged in.
- [x] Render a small numeric badge on the “领券中心” main tab.
- [x] When switching to the center tab, call read endpoint, invalidate alert summary, and keep loading unobtrusive.
- [x] Add static regression test coverage in `scripts/__tests__/coupon-campaign-rules.test.mjs`.

## Task 4: Docs and Verification

- [x] Update `docs/features/redpocket.md`.
- [x] Update `docs/architecture/frontend.md`.
- [x] Update `plan.md`.
- [x] Run:
  - `node --test scripts/__tests__/coupon-campaign-rules.test.mjs`
  - `cd backend && npm test -- coupon-campaign-rules.spec.ts notification.registry.spec.ts --runInBand`
  - `cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/aimaimai_validate' npx prisma validate`
  - `cd admin && npm run build`
  - `cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/aimaimai_validate' npm run build`
  - `npx tsc --noEmit`
  - `git diff --check`
