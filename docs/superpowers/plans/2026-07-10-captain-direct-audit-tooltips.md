# 团长一层直推审查与配置说明 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复一层直推改造遗留的可复现逻辑漏洞，并将团长配置页收敛为可执行参数且为每项提供悬停说明。

**Architecture:** 订单归因以支付时间校验配置生效时间；月度有效客户只从当月有正向直接归因的客户集合计算。未接入执行链路的同设备/同地址阈值不再作为配置保存或展示，已有 V2 配置读取时自动清理。管理后台通过统一 `FieldLabel` 为每个可编辑字段显示问号图标及关联规则说明。

**Tech Stack:** Prisma + NestJS + Jest；React 19 + Ant Design 5 + TypeScript。

---

## Chunk 1: Direct-only audit repairs

### Task 1: Make configuration activation time enforceable

**Files:**
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Modify: `backend/src/modules/captain/captain-attribution.service.ts`
- Test: `backend/src/modules/captain/captain-config.service.spec.ts`
- Test: `backend/src/modules/captain/captain-attribution.service.spec.ts`

- [x] Write failing tests for rejecting invalid activation timestamps and for skipping an order paid before the configured activation time.
- [x] Validate a non-null `effectiveFrom` as an ISO timestamp and skip pre-effective paid orders before attribution creation.
- [x] Run the focused config and attribution specifications.

### Task 2: Keep effective-customer metrics strictly sales based

**Files:**
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Test: `backend/src/modules/captain/captain-monthly-settlement.service.spec.ts`

- [x] Write a failing test where a newly bound direct customer has no valid order and must not count as a new effective customer.
- [x] Remove the empty-set fallback so relation counts only use positive direct net-GMV buyers.
- [x] Run the monthly-settlement specification.

### Task 3: Remove no-op anti-fraud thresholds from the live contract

**Files:**
- Modify: `backend/src/modules/captain/captain.types.ts`
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Modify: `backend/src/modules/captain/captain-config.service.spec.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.ts`
- Test: `backend/src/modules/admin/captain/admin-captain.service.spec.ts`

- [x] Write a failing compatibility test for a persisted V2 config containing the retired device/address fields.
- [x] Normalize the persisted configuration to remove those unused fields before validation and saving.
- [x] Retain the executed refund-rate and settlement-hold controls.
- [x] Run configuration and admin-captain tests.

## Chunk 2: Administrator configuration experience

### Task 4: Simplify settings and add field-level help

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/captain/settings.tsx`
- Modify: `docs/architecture/admin-frontend.md`

- [x] Replace the free-text activation-time field with a date-time picker that persists ISO strings.
- [x] Remove read-only program-code and fixed-policy switches from the form; retain only parameters that affect runtime behavior.
- [x] Add a reusable question-mark tooltip label to every editable field. Each tooltip states the calculation/behavior and any related fields, including scope matching, tier accumulation, the incentive-cap formula, and refund-risk dependency.
- [x] Build the admin frontend.

## Chunk 3: Verification and documentation

### Task 5: Prove the direct-only boundary remains intact

**Files:**
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [x] Run captain and admin-focused Jest suites, backend TypeScript, Prisma validation, app TypeScript and admin production build.
- [x] Audit active source for indirect relation traversal, indirect order creation, and current team-pool ledger writes; only legacy lifecycle/audit references may remain.
- [x] Record the repaired controls and verification evidence, then commit the reviewed change set.
