# 团长一层直推经营激励 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把预包装海鲜团长激励从二级团队计酬改为只按直接客户实际成交结算的一层经营模式，并保留历史台账审计能力。

**Architecture:** 新规则从团长绑定开始只建立 `directCaptainUserId`，订单只生成一笔直接成交流水，月度结算只聚合直接归因订单。历史间接字段和 `INDIRECT_ORDER` 流水保留为只读审计与既有冻结账本收尾，不再参与新配置、新订单归因或新月结计算。

**Tech Stack:** Prisma + NestJS + Jest；React Native / Expo Router + Jest；React + Ant Design + TypeScript。

---

## File Map

### Backend

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710010000_captain_one_level_legacy_audit/migration.sql`
- Modify: `backend/src/modules/captain/captain.types.ts`
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Modify: `backend/src/modules/captain/captain-config.service.ts`
- Modify: `backend/src/modules/captain/captain-relation.service.ts`
- Modify: `backend/src/modules/captain/captain-attribution.service.ts`
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Modify: `backend/src/modules/captain/captain-buyer.service.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.ts`
- Modify: relevant captain and admin-captain Jest specifications.

### Buyer App

- Modify: `src/types/domain/Captain.ts`
- Modify: `src/repos/CaptainRepo.ts`
- Modify: `src/repos/__tests__/CaptainRepo.test.ts`
- Modify: `app/me/captain.tsx`

### Admin Frontend

- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/captain/common.tsx`
- Modify: `admin/src/pages/captain/settings.tsx`
- Modify: `admin/src/pages/captain/index.tsx`
- Modify: `admin/src/pages/captain/detail.tsx`
- Modify: `admin/src/pages/captain/orders.tsx`
- Modify: `admin/src/pages/captain/settlements.tsx`

### Documentation

- Create: `docs/superpowers/specs/2026-07-10-captain-one-level-direct-design.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

## Chunk 1: Rule Contract And Tests

### Task 0: Preserve audit data under explicit legacy names

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710010000_captain_one_level_legacy_audit/migration.sql`
- Test: `backend/src/modules/captain/captain-commission.service.spec.ts`

- [x] Rename historical second-level columns to `legacyIndirect*` and `INDIRECT_ORDER` to `LEGACY_INDIRECT_ORDER` without deleting records.
- [x] Keep the legacy ledger lifecycle available only for release, refund reversal, clawback and audit, and verify it with the commission service specification.
- [x] Run `npx prisma validate`, regenerate the Prisma client, and compile the backend.

### Task 1: Define the one-level configuration contract

**Files:**
- Modify: `backend/src/modules/captain/captain.types.ts`
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Test: `backend/src/modules/captain/captain-config.service.spec.ts`

- [x] Write failing tests for the 11% direct-only default, absence of configurable indirect rate, single-level constraint and 15.5% total cap.
- [x] Run `npx jest src/modules/captain/captain-config.service.spec.ts --runInBand` and confirm the new expectations fail against the old configuration.
- [x] Implement the v2 direct-only config contract, including a normalizer that safely converts persisted v1 config to direct rate `directRate + indirectRate`, direct GMV qualification and 100% performance bonus.
- [x] Re-run the focused spec and `DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate`.

### Task 2: Stop upstream relation traversal

**Files:**
- Modify: `backend/src/modules/captain/captain-relation.service.ts`
- Test: `backend/src/modules/captain/captain-relation.service.spec.ts`

- [x] Write a failing test where a buyer bound to captain B uses B's code for a new buyer; assert the new buyer has only B and no indirect captain.
- [x] Run the focused relation spec and observe the old upstream traversal failing the test.
- [x] Remove upstream lookup and indirect relation write; retain existing relation immutability and Serializable transaction behavior.
- [x] Re-run the focused relation spec.

## Chunk 2: Financial Attribution And Monthly Settlement

### Task 3: Create direct-only order attribution

**Files:**
- Modify: `backend/src/modules/captain/captain-attribution.service.ts`
- Test: `backend/src/modules/captain/captain-attribution.service.spec.ts`
- Test: `backend/src/modules/captain/captain-commission.service.spec.ts`

- [x] Write failing tests asserting one eligible paid order creates one `DIRECT_ORDER` ledger at 11% and never creates `INDIRECT_ORDER`, even when a legacy indirect relation exists.
- [x] Run the focused attribution spec and confirm it fails because the old service creates a second ledger.
- [x] Remove indirect captain lookup, indirect ledger construction and indirect metadata from new attribution writes. Keep commission lifecycle support for existing historical `INDIRECT_ORDER` ledgers.
- [x] Re-run attribution and commission specs; verify idempotency, frozen balance and refund clawback tests remain green.

### Task 4: Calculate monthly rewards from direct customers only

**Files:**
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Test: `backend/src/modules/captain/captain-monthly-settlement.service.spec.ts`

- [x] Write failing tests proving an upstream captain receives no GMV or settlement amount from an indirect order, and the 1% performance amount is paid only to the qualifying direct captain.
- [x] Run the focused monthly settlement spec and confirm the current team query/distribution fails the new behavior.
- [x] Replace dual-level metric aggregation with direct-only aggregation; remove lower-captain pool allocation; create only the source captain's monthly ledger entries; retain Serializable retry and settlement state guards.
- [x] Re-run monthly settlement tests, including CAP04/CAP05/CAP06 protections for totals, state transitions and payment reconciliation.

### Task 5: Restrict administrative queries to direct operations

**Files:**
- Modify: `backend/src/modules/captain/captain-buyer.service.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.ts`
- Test: `backend/src/modules/captain/captain-buyer.service.spec.ts`
- Test: `backend/src/modules/admin/captain/admin-captain.service.spec.ts`

- [x] Write failing tests proving buyer/profile team data and admin team/order filters only expose direct relationships under the active program.
- [x] Implement direct-only selects and filters, while retaining ledger search for historical indirect audit records.
- [x] Run buyer and admin-captain focused specs.

## Chunk 3: Buyer And Admin Experience

### Task 6: Remove operational second-level configuration and labels

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/captain/settings.tsx`
- Modify: `admin/src/pages/captain/common.tsx`
- Modify: `admin/src/pages/captain/orders.tsx`
- Modify: `admin/src/pages/captain/index.tsx`
- Modify: `admin/src/pages/captain/detail.tsx`
- Modify: `admin/src/pages/captain/settlements.tsx`

- [x] Change the settings form to one direct commission input and a direct-operation performance bonus input; remove two-level rate and team-pool-weight inputs.
- [x] Rename operational GMV and reward labels to “直接客户有效 GMV” and “经营绩效奖”; write new performance awards as `PERFORMANCE_BONUS`, while rendering legacy `LEGACY_INDIRECT_ORDER` and `TEAM_POOL` only as historical audit rows.
- [x] Update shared admin types to the direct-only contract and remove active indirect fields from current API display models.
- [x] Run `npm run build` in `admin`.

### Task 7: Update the captain center

**Files:**
- Modify: `src/types/domain/Captain.ts`
- Modify: `src/repos/CaptainRepo.ts`
- Modify: `src/repos/__tests__/CaptainRepo.test.ts`
- Modify: `app/me/captain.tsx`

- [x] Write failing repository/type expectations for direct-only profile metrics and current order attribution.
- [x] Update the repo/types and captain center labels to show direct customer sales and direct operation awards; preserve historical ledger display with an explicit legacy label.
- [x] Run `npx jest src/repos/__tests__/CaptainRepo.test.ts --runInBand` and `npx tsc -b --noEmit --pretty false`.

## Chunk 4: Documentation, Security Review And Release Evidence

### Task 8: Document and verify the completed model

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [x] Record the one-level relationship/commission boundary, direct-only dashboards and legacy audit treatment.
- [x] Complete the monetary-change checklist: Serializable writes, unique order attribution keys, account balance reconciliation, legacy ledger lifecycle and no cross-system Reward/Coupon/VIP writes.
- [x] Run focused backend suites, App repository tests, Prisma validation, backend TypeScript build and admin production build.
- [x] Run `git diff --check`, inspect all remaining `indirect` references to ensure they are legacy lifecycle/audit only, and commit the verified change set.
