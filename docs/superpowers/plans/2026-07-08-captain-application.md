# 团长申请 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 App 侧申请成为团长入口和管理后台审核链路，审核通过后复用现有团长开通能力。

**Architecture:** 在现有 `captain` 模块内新增 `CaptainApplication` 模型、买家申请接口和管理端审核接口。App 侧新增申请状态页，管理后台新增申请列表/详情与通过/驳回操作；通过审核时调用现有 `CaptainRelationService.createCaptainProfile()`，不触碰 VIP 树、普通树、Reward 或 Coupon。

**Tech Stack:** Prisma + NestJS + Jest；React Native + Expo Router + React Query；管理后台 React + Ant Design ProTable。

---

## File Map

### Backend

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260708020000_add_captain_application/migration.sql`
- Create: `backend/src/modules/captain/dto/captain-application.dto.ts`
- Create: `backend/src/modules/captain/captain-application.service.ts`
- Create: `backend/src/modules/captain/captain-application.service.spec.ts`
- Modify: `backend/src/modules/captain/captain.controller.ts`
- Modify: `backend/src/modules/captain/captain.module.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.dto.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.controller.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.spec.ts`

### Admin Frontend

- Modify: `admin/src/constants/permissions.ts`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/captain.ts`
- Create: `admin/src/pages/captain/applications.tsx`

### Buyer App

- Modify: `src/types/domain/Captain.ts`
- Modify: `src/repos/CaptainRepo.ts`
- Modify: `src/repos/__tests__/CaptainRepo.test.ts`
- Modify: `app/(tabs)/me.tsx`
- Create: `app/me/captain-application.tsx`

### Docs

- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

---

## Chunk 1: Backend Application Core

### Task 1: Prisma Schema And Migration

- [x] **Step 1: Add failing schema expectations to plan checklist**

Expected model:

- `CaptainApplicationStatus`
- `CaptainApplication`
- `User.captainApplications`

- [x] **Step 2: Edit Prisma schema**

Add the enum and model from the design doc.

- [x] **Step 3: Add migration SQL**

Create `20260708020000_add_captain_application/migration.sql` with enum, table, foreign key and indexes.

- [x] **Step 4: Validate Prisma**

Run:

```bash
cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
```

Expected: PASS.

### Task 2: Buyer Application Service

- [x] **Step 1: Write failing tests**

Cover:

- user can submit when no pending application exists
- pending application blocks duplicate submit
- rejected application allows resubmit
- application captures system snapshot
- approved captain user returns `isCaptain=true` in status

Run:

```bash
cd backend && npx jest src/modules/captain/captain-application.service.spec.ts --runInBand
```

Expected: FAIL before implementation.

- [x] **Step 2: Implement DTO and service**

Implement `CaptainApplicationService`:

- `getMyApplication(userId)`
- `submit(userId, dto)`
- `listAdmin(query)`
- `getAdmin(id)`
- `approve(id, adminUserId, dto)`
- `reject(id, adminUserId, dto)`

All write operations use `Serializable`.

- [x] **Step 3: Wire buyer controller**

Routes:

- `GET /captain/applications/me`
- `POST /captain/applications`

- [x] **Step 4: Verify tests**

Run focused backend tests.

## Chunk 2: Admin Review API And UI

### Task 3: Admin API

- [x] **Step 1: Extend admin DTO/service/controller tests**

Cover list filters and approve/reject delegation.

- [x] **Step 2: Add admin routes**

Routes:

- `GET /admin/captain/applications`
- `GET /admin/captain/applications/:id`
- `POST /admin/captain/applications/:id/approve`
- `POST /admin/captain/applications/:id/reject`

- [x] **Step 3: Verify backend focused tests**

Run:

```bash
cd backend && npx jest src/modules/captain src/modules/admin/captain --runInBand
```

Expected: PASS.

### Task 4: Admin Page

- [x] **Step 1: Extend admin types and API client**

Add `CaptainApplication`, query and action methods.

- [x] **Step 2: Add route and menu**

Add `/captain/applications` under “团长经营”.

- [x] **Step 3: Implement page**

Use ProTable with drawer/modal detail. Actions:

- 通过：optional captain code/display name
- 驳回：required reason

- [x] **Step 4: Build admin**

Run:

```bash
cd admin && npm run build
```

Expected: PASS.

## Chunk 3: Buyer App Entry

### Task 5: Buyer Repo And Tests

- [x] **Step 1: Extend Captain types**

Add application DTO/result types.

- [x] **Step 2: Write failing repo tests**

Cover:

- `GET /captain/applications/me`
- `POST /captain/applications`

- [x] **Step 3: Implement repo methods**

Add:

- `CaptainRepo.getMyApplication()`
- `CaptainRepo.submitApplication()`

### Task 6: Buyer Application Page

- [x] **Step 1: Add route `app/me/captain-application.tsx`**

States:

- not logged in
- not applied
- pending
- rejected
- approved / already captain

- [x] **Step 2: Add My page entry**

For non-captain logged-in users show “申请团长”. For active captains show existing “团长经营”.

- [x] **Step 3: Verify App tests and TypeScript**

Run:

```bash
npx jest src/repos/__tests__/CaptainRepo.test.ts --runInBand
npx tsc -b --noEmit --pretty false
```

Expected: PASS.

## Chunk 4: Final Verification

### Task 7: Full Verification And Docs

- [x] **Step 1: Update docs**

Update:

- `docs/architecture/frontend.md`
- `docs/architecture/admin-frontend.md`
- `plan.md`

- [x] **Step 2: Run verification**

Run:

```bash
cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
cd backend && npx jest src/modules/captain src/modules/admin/captain --runInBand
cd backend && npm run build
cd admin && npm run build
npm test -- --runInBand
npx tsc -b --noEmit --pretty false
git diff --check
```

- [x] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add captain application workflow"
```
