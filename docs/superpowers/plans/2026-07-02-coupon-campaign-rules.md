# Coupon Campaign Rules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coupon campaigns match the actual supported red-packet workflows: clearer trigger names, constrained trigger/distribution combinations, optional end time for evergreen campaigns, and admin manual issuing to specified buyers or all buyers.

**Architecture:** Keep persisted enum values stable and change the admin-facing labels/rules around them. Add backend validation and nullable-end-date query semantics so UI restrictions are not the only protection. Extend the existing manual issue endpoint with an explicit target mode instead of sending huge user ID lists from the browser.

**Tech Stack:** NestJS + Prisma + Jest for backend; Vite React + Ant Design + script-based regression tests for admin.

---

## Chunk 1: Backend Coupon Campaign Rules

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/coupon/dto/create-campaign.dto.ts`
- Modify: `backend/src/modules/coupon/dto/update-campaign.dto.ts`
- Modify: `backend/src/modules/coupon/dto/manual-issue.dto.ts`
- Modify: `backend/src/modules/coupon/coupon.service.ts`
- Modify: `backend/src/modules/coupon/coupon-engine.service.ts`
- Test: `backend/src/modules/coupon/coupon-campaign-rules.spec.ts`

- [ ] Write failing tests for nullable `endAt`, valid trigger/distribution combinations, required trigger config, and manual issuing to all buyer users.
- [ ] Run Jest and confirm the new tests fail for the expected missing behavior.
- [ ] Update schema/DTO/service logic to allow `endAt = null` only for evergreen trigger types and to reject unsupported combinations.
- [ ] Extend manual issue DTO/service to support `targetMode: SPECIFIC_USERS | ALL_USERS`, resolving buyer numbers for specific users and selecting active buyer users for all users.
- [ ] Update coupon engine and public claim queries so `endAt = null` means no activity end time.
- [ ] Run the coupon Jest tests and Prisma validation.

## Chunk 2: Admin Coupon UI

**Files:**
- Modify: `admin/src/api/coupon.ts`
- Modify: `admin/src/pages/coupons/campaign-form.tsx`
- Modify: `admin/src/pages/coupons/campaigns.tsx`
- Test: `scripts/__tests__/coupon-campaign-rules.test.mjs`

- [ ] Write failing script tests for visible labels, hidden unsupported trigger types, dynamic required fields, optional end time policy, and manual issue modal affordances.
- [ ] Run the script tests and confirm they fail for the current UI.
- [ ] Update admin labels so `WIN_BACK` displays as `久未下单唤醒`.
- [ ] Restrict selectable trigger/distribution combinations and show trigger-specific fields only where needed.
- [ ] Add an unlimited end-time toggle only for evergreen types and display `长期有效`/`不限结束时间` consistently.
- [ ] Add manual issue action and modal with `指定用户` and `全部用户` modes.
- [ ] Run admin build and script tests.

## Chunk 3: Documentation And Verification

**Files:**
- Modify: `docs/features/redpocket.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

- [ ] Update the red-packet feature doc with supported trigger types, required fields, and manual issue behavior.
- [ ] Update admin frontend documentation and sprint plan status for the coupon campaign settings cleanup.
- [ ] Run `git diff --check`, targeted backend tests, admin build, and root script tests.
- [ ] Commit the scoped changes on `codex/coupon-campaign-rules`.
