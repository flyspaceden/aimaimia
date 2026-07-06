# Admin Announcements And Outreach Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build management-backend announcement publishing first, then invitation-based proactive one-to-one customer service.

**Execution status (2026-07-06):** Chunk 1 and Chunk 2 implemented. Verification passed for Prisma validate/generate, focused backend Jest tests, static contract tests, admin production build, backend production build, and root App TypeScript check.

**Architecture:** Reuse `InboxMessage` as the buyer-visible delivery surface and add `Announcement` only as the admin publish record. Proactive customer-service outreach extends the existing `CsSession/CsMessage` flow with `ADMIN_OUTREACH`, and sends an inbox invitation so buyers enter the chat deliberately.

**Tech Stack:** NestJS + Prisma + PostgreSQL, React 19 + Ant Design 5 admin, Expo React Native App inbox and customer-service pages, Jest and node test scripts.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-07-06-admin-announcement-and-outreach-design.md`
- Customer-service docs: `docs/features/智能客服.md`
- Admin frontend docs: `docs/architecture/admin-frontend.md`
- App frontend docs: `docs/architecture/frontend.md`
- Project plan: `plan.md`

## Scope Check

This spec covers two related but independently shippable chunks:

1. Admin announcements / targeted inbox messages.
2. Invitation-based proactive one-to-one customer service.

The chunks share `InboxMessage` and buyer identity lookup, but each can be implemented, tested, and released independently. Do not start Chunk 2 until Chunk 1 is merged and verified.

## File Structure

### Backend Announcement Files

- Modify: `backend/prisma/schema.prisma`
  - Add `Announcement`.
  - Extend `CsSessionSource` with `ADMIN_OUTREACH`.
- Create: `backend/prisma/migrations/<timestamp>_admin_announcements_and_cs_outreach/migration.sql`
  - Add `Announcement` table and enum value.
- Modify: `backend/prisma/seed.ts`
  - Seed `announcements:read`, `announcements:create`, and `cs:outreach`.
- Modify: `backend/prisma/production-bootstrap.ts`
  - Add the same production bootstrap permissions.
- Create: `backend/src/modules/admin/announcements/admin-announcements.module.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.controller.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.service.ts`
- Create: `backend/src/modules/admin/announcements/dto/admin-announcement.dto.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.service.spec.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.controller.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
  - Import `AdminAnnouncementsModule`.
- Modify: `backend/src/modules/inbox/inbox.service.ts`
  - Add transaction-friendly `sendWithTx` helper and optional batch helper if needed.

### Backend Customer-Service Outreach Files

- Create: `backend/src/modules/customer-service/dto/cs-outreach.dto.ts`
- Create: `backend/src/modules/customer-service/cs-outreach.service.ts`
- Create: `backend/src/modules/customer-service/cs-outreach.service.spec.ts`
- Modify: `backend/src/modules/customer-service/cs-admin.controller.ts`
  - Add `POST /admin/cs/outreach`.
- Modify: `backend/src/modules/customer-service/cs.module.ts`
  - Import `InboxModule`, provide `CsOutreachService`.
- Modify: `backend/src/modules/customer-service/cs.service.ts`
  - Only add small reusable helpers if `CsOutreachService` cannot stay self-contained.

### Admin Frontend Files

- Modify: `admin/src/constants/permissions.ts`
  - Add announcement and outreach permission constants.
- Create: `admin/src/api/announcements.ts`
- Modify: `admin/src/api/cs.ts`
  - Add `createCsOutreach`.
- Modify: `admin/src/App.tsx`
  - Add lazy route for `announcements`.
- Modify: `admin/src/layouts/AdminLayout.tsx`
  - Add "消息公告" menu item.
- Create: `admin/src/pages/announcements/index.tsx`
- Modify: `admin/src/pages/users/detail.tsx`
  - Add "联系买家" action.
- Modify: `admin/src/pages/cs/workstation.tsx`
  - Support selecting `?sessionId=...` after outreach creation.

### Buyer App Files

- Modify: `src/types/domain/Inbox.ts`
  - Add `platform_announcement`, `platform_notice`, `cs_outreach_invite`.
- Modify: `src/mocks/inbox.ts`
  - Add mock announcement / outreach records.
- Modify: `app/inbox/index.tsx`
  - Add icons and route whitelist targets.
- Modify: `src/repos/CsRepo.ts`
  - Add optional `getSessionMessagesById` alias only if clarity is needed; existing `getMessages` can be reused.
- Modify: `app/cs/index.tsx`
  - Add `sessionId` entry mode.

### Static Test Files

- Create: `scripts/__tests__/admin-announcements-page.test.mjs`
- Create: `scripts/__tests__/inbox-announcement-types.test.mjs`
- Create: `scripts/__tests__/cs-outreach-entry.test.mjs`

---

## Chunk 1: Admin Announcements And Inbox Delivery

### Task 1: Schema And Permissions

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_admin_announcements_and_cs_outreach/migration.sql`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/production-bootstrap.ts`
- Modify: `admin/src/constants/permissions.ts`

- [ ] **Step 1: Update Prisma schema**

Add the `Announcement` model near `InboxMessage` or the admin/support domain:

```prisma
model Announcement {
  id             String   @id @default(cuid())
  title          String
  content        String
  category       String   @default("system")
  type           String   @default("platform_announcement")
  priority       String   @default("NORMAL")
  target         Json?
  audienceType   String
  audienceFilter Json?
  status         String   @default("SENDING")
  recipientCount Int      @default(0)
  successCount   Int      @default(0)
  failedCount    Int      @default(0)
  createdBy      String
  sentAt         DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, sentAt])
  @@index([createdBy, sentAt])
}
```

Extend `CsSessionSource`:

```prisma
enum CsSessionSource {
  MY_PAGE
  ORDER_DETAIL
  AFTERSALE_DETAIL
  ADMIN_OUTREACH
}
```

- [ ] **Step 2: Create migration**

Run:

```bash
cd backend
npx prisma migrate dev --name admin_announcements_and_cs_outreach
```

Expected: migration file created and Prisma client regenerated.

- [ ] **Step 3: Validate schema**

Run:

```bash
cd backend
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Add backend permissions to seed files**

Add permission entries in both `backend/prisma/seed.ts` and `backend/prisma/production-bootstrap.ts`:

```ts
{ code: 'announcements:read', module: 'announcements', action: 'read', description: '查看消息公告' },
{ code: 'announcements:create', module: 'announcements', action: 'create', description: '发布消息公告' },
{ code: 'cs:outreach', module: 'cs', action: 'outreach', description: '主动联系买家' },
```

Add these to manager-role permissions unless the existing role policy says only super admin can publish.

- [ ] **Step 5: Add frontend permission constants**

In `admin/src/constants/permissions.ts` add:

```ts
ANNOUNCEMENTS_READ: 'announcements:read',
ANNOUNCEMENTS_CREATE: 'announcements:create',
CS_OUTREACH: 'cs:outreach',
```

- [ ] **Step 6: Run focused validation**

Run:

```bash
cd backend
npx prisma validate
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/prisma/seed.ts backend/prisma/production-bootstrap.ts admin/src/constants/permissions.ts
git commit -m "feat(admin): add announcement and outreach schema"
```

### Task 2: Announcement DTOs And Service Tests

**Files:**
- Create: `backend/src/modules/admin/announcements/dto/admin-announcement.dto.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.service.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create `backend/src/modules/admin/announcements/admin-announcements.service.spec.ts` with tests for:

```ts
describe('AdminAnnouncementsService', () => {
  it('previews VIP audience count for ACTIVE buyers only', async () => {});
  it('rejects invalid buyerNo values before publishing', async () => {});
  it('creates announcement and inbox messages for buyerNo list', async () => {});
  it('marks partial failure when a createMany batch fails', async () => {});
  it('rejects non-whitelisted app target routes', async () => {});
});
```

Mock `PrismaService` methods:

```ts
const prisma = {
  user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  announcement: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  inboxMessage: { createMany: jest.fn() },
};
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
cd backend
npx jest src/modules/admin/announcements/admin-announcements.service.spec.ts --runInBand
```

Expected: FAIL because service and DTO files do not exist.

- [ ] **Step 3: Implement DTOs**

Create `admin-announcement.dto.ts`:

```ts
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AnnouncementTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  route!: string;

  @IsOptional()
  params?: Record<string, string>;
}

export class AnnouncementAudienceDto {
  @IsIn(['ALL', 'VIP', 'NORMAL', 'FILTERED', 'BUYER_NO_LIST'])
  type!: 'ALL' | 'VIP' | 'NORMAL' | 'FILTERED' | 'BUYER_NO_LIST';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  buyerNos?: string[];

  @IsOptional()
  @IsIn(['ACTIVE'])
  userStatus?: 'ACTIVE';

  @IsOptional()
  @IsString()
  registeredFrom?: string;

  @IsOptional()
  @IsString()
  registeredTo?: string;
}

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsIn(['system', 'transaction', 'interaction'])
  category?: 'system' | 'transaction' | 'interaction';

  @IsOptional()
  @IsIn(['platform_announcement', 'platform_notice'])
  type?: 'platform_announcement' | 'platform_notice';

  @IsOptional()
  @IsIn(['NORMAL', 'IMPORTANT'])
  priority?: 'NORMAL' | 'IMPORTANT';

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementTargetDto)
  target?: AnnouncementTargetDto;

  @ValidateNested()
  @Type(() => AnnouncementAudienceDto)
  audience!: AnnouncementAudienceDto;
}
```

- [ ] **Step 4: Implement service**

Create `admin-announcements.service.ts` with:

```ts
const VALID_APP_ROUTE_PREFIXES = [
  '/(tabs)', '/me', '/orders', '/product', '/company', '/category',
  '/cs', '/ai', '/vip', '/group', '/invoices', '/user',
  '/about', '/account-security', '/cart', '/checkout',
  '/checkout-address', '/checkout-coupon', '/coupon-center',
  '/inbox', '/lottery', '/notification-settings', '/privacy',
  '/referral', '/search', '/settings', '/terms',
];
```

Implement methods:

```ts
async preview(dto: CreateAnnouncementDto) {
  const { recipients, invalidBuyerNos } = await this.resolveAudience(dto.audience);
  return {
    count: recipients.length,
    invalidBuyerNos,
  };
}

async create(dto: CreateAnnouncementDto, adminId: string) {
  this.assertValidTarget(dto.target);
  const recipients = await this.resolveAudience(dto.audience, { strictBuyerNos: true });
  if (recipients.length === 0) throw new BadRequestException('当前筛选范围没有可发送买家');
  // create Announcement with SENDING
  // createMany inbox messages in batches
  // update final status and counts
}

findAll(params) { /* orderBy sentAt desc, paginate */ }
findById(id) { /* findUniqueOrThrow */ }
```

Keep helpers private and focused:

- `resolveAudience`
- `resolveBuyerNoList`
- `buildUserWhere`
- `assertValidTarget`
- `chunk`
- `summarizeFilter`

- [ ] **Step 5: Run tests**

Run:

```bash
cd backend
npx jest src/modules/admin/announcements/admin-announcements.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/admin/announcements/dto/admin-announcement.dto.ts backend/src/modules/admin/announcements/admin-announcements.service.ts backend/src/modules/admin/announcements/admin-announcements.service.spec.ts
git commit -m "feat(admin): add announcement publishing service"
```

### Task 3: Announcement Controller And Module

**Files:**
- Create: `backend/src/modules/admin/announcements/admin-announcements.module.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.controller.ts`
- Create: `backend/src/modules/admin/announcements/admin-announcements.controller.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write controller tests**

Create controller tests for:

```ts
it('requires announcements:read for list and detail routes', () => {});
it('requires announcements:create for preview and publish routes', () => {});
it('passes CurrentAdmin sub to service.create', async () => {});
```

- [ ] **Step 2: Run controller tests and verify failure**

Run:

```bash
cd backend
npx jest src/modules/admin/announcements/admin-announcements.controller.spec.ts --runInBand
```

Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement controller**

Use the same guard pattern as other admin controllers:

```ts
@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private service: AdminAnnouncementsService) {}

  @Get()
  @RequirePermission('announcements:read')
  findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.findAll({ page: page ? +page : 1, pageSize: pageSize ? +pageSize : 20 });
  }

  @Get(':id')
  @RequirePermission('announcements:read')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post('preview')
  @RequirePermission('announcements:create')
  preview(@Body() dto: CreateAnnouncementDto) {
    return this.service.preview(dto);
  }

  @Post()
  @RequirePermission('announcements:create')
  @AuditLog({ action: 'CREATE', module: 'announcements', targetType: 'Announcement' })
  create(@Body() dto: CreateAnnouncementDto, @CurrentAdmin('sub') adminId: string) {
    return this.service.create(dto, adminId);
  }
}
```

- [ ] **Step 4: Implement module and import it**

`admin-announcements.module.ts`:

```ts
@Module({
  controllers: [AdminAnnouncementsController],
  providers: [AdminAnnouncementsService],
})
export class AdminAnnouncementsModule {}
```

Import it in `backend/src/modules/admin/admin.module.ts`.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd backend
npx jest src/modules/admin/announcements --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/admin/announcements backend/src/modules/admin/admin.module.ts
git commit -m "feat(admin): expose announcement publishing api"
```

### Task 4: Admin Frontend Announcement Page

**Files:**
- Create: `admin/src/api/announcements.ts`
- Create: `admin/src/pages/announcements/index.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Create: `scripts/__tests__/admin-announcements-page.test.mjs`

- [ ] **Step 1: Write static page test**

Create `scripts/__tests__/admin-announcements-page.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin announcements page is routed and reachable from customer service menu', () => {
  const app = readFileSync('admin/src/App.tsx', 'utf8');
  const layout = readFileSync('admin/src/layouts/AdminLayout.tsx', 'utf8');
  const api = readFileSync('admin/src/api/announcements.ts', 'utf8');

  assert.match(app, /AnnouncementsPage/);
  assert.match(app, /path="announcements"/);
  assert.match(layout, /消息公告/);
  assert.match(layout, /ANNOUNCEMENTS_READ/);
  assert.match(api, /previewAnnouncement/);
  assert.match(api, /createAnnouncement/);
});
```

- [ ] **Step 2: Run static test and verify failure**

Run:

```bash
node --test scripts/__tests__/admin-announcements-page.test.mjs
```

Expected: FAIL because files/routes do not exist.

- [ ] **Step 3: Create admin API wrapper**

`admin/src/api/announcements.ts`:

```ts
import client from './client';

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  category: string;
  type: string;
  priority: string;
  audienceType: string;
  audienceFilter: Record<string, unknown> | null;
  status: string;
  recipientCount: number;
  successCount: number;
  failedCount: number;
  createdBy: string;
  sentAt: string;
}

export interface CreateAnnouncementPayload {
  title: string;
  content: string;
  category?: 'system' | 'transaction' | 'interaction';
  type?: 'platform_announcement' | 'platform_notice';
  priority?: 'NORMAL' | 'IMPORTANT';
  target?: { route: string; params?: Record<string, string> };
  audience: {
    type: 'ALL' | 'VIP' | 'NORMAL' | 'FILTERED' | 'BUYER_NO_LIST';
    buyerNos?: string[];
    userStatus?: 'ACTIVE';
    registeredFrom?: string;
    registeredTo?: string;
  };
}

export const getAnnouncements = (params?: { page?: number; pageSize?: number }) =>
  client.get<{ items: AnnouncementRecord[]; total: number }>('/admin/announcements', { params });

export const previewAnnouncement = (data: CreateAnnouncementPayload) =>
  client.post<{ count: number; invalidBuyerNos?: string[] }>('/admin/announcements/preview', data);

export const createAnnouncement = (data: CreateAnnouncementPayload) =>
  client.post<AnnouncementRecord>('/admin/announcements', data);
```

- [ ] **Step 4: Create admin page**

Use Ant Design `Table`, `Modal`, `Form`, `Input`, `Select`, `DatePicker.RangePicker`, `App.useApp()`, and React Query.

Key behaviors:

1. Default audience is `ALL`.
2. `BUYER_NO_LIST` shows multiline `buyerNosText`.
3. `FILTERED` shows date range.
4. "预览人数" calls `previewAnnouncement`.
5. "发布" requires successful preview for `ALL` / `VIP` / `NORMAL`.
6. Large recipient count uses `Modal.confirm`.

Keep helper functions in the same file:

```ts
const parseBuyerNos = (value?: string) =>
  (value || '').split(/[\n,，\s]+/).map((item) => item.trim()).filter(Boolean);
```

- [ ] **Step 5: Wire route and menu**

In `admin/src/App.tsx`:

```ts
const AnnouncementsPage = lazy(() => import('@/pages/announcements/index'));
...
<Route path="announcements" element={<AnnouncementsPage />} />
```

In `AdminLayout.tsx`, under "客服中心":

```ts
{ path: '/announcements', name: '消息公告', permission: PERMISSIONS.ANNOUNCEMENTS_READ },
```

- [ ] **Step 6: Run static test**

Run:

```bash
node --test scripts/__tests__/admin-announcements-page.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run admin build**

Run:

```bash
cd admin
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add admin/src/api/announcements.ts admin/src/pages/announcements/index.tsx admin/src/App.tsx admin/src/layouts/AdminLayout.tsx scripts/__tests__/admin-announcements-page.test.mjs
git commit -m "feat(admin): add announcement publishing page"
```

### Task 5: Buyer App Inbox Announcement Types

**Files:**
- Modify: `src/types/domain/Inbox.ts`
- Modify: `src/mocks/inbox.ts`
- Modify: `app/inbox/index.tsx`
- Create: `scripts/__tests__/inbox-announcement-types.test.mjs`

- [ ] **Step 1: Write static test**

Create `scripts/__tests__/inbox-announcement-types.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('buyer inbox supports announcement and outreach message types', () => {
  const types = readFileSync('src/types/domain/Inbox.ts', 'utf8');
  const page = readFileSync('app/inbox/index.tsx', 'utf8');
  const mocks = readFileSync('src/mocks/inbox.ts', 'utf8');

  for (const token of ['platform_announcement', 'platform_notice', 'cs_outreach_invite']) {
    assert.match(types, new RegExp(token));
    assert.match(page, new RegExp(token));
  }
  assert.match(mocks, /platform_announcement/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test scripts/__tests__/inbox-announcement-types.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add inbox types**

In `src/types/domain/Inbox.ts`, append:

```ts
  | 'platform_announcement'
  | 'platform_notice'
  | 'cs_outreach_invite';
```

- [ ] **Step 4: Add inbox icons**

In `app/inbox/index.tsx`, extend `iconMap`:

```ts
platform_announcement: { name: 'bullhorn-outline', tone: 'accent' },
platform_notice: { name: 'bell-outline', tone: 'neutral' },
cs_outreach_invite: { name: 'headset', tone: 'brand' },
```

The existing route whitelist already includes `/cs`, `/coupon-center`, `/inbox`, and other likely targets. Add only missing routes required by the announcement page target selector.

- [ ] **Step 5: Add mock messages**

In `src/mocks/inbox.ts`, add one platform announcement mock with `category: 'system'`.

- [ ] **Step 6: Run static test**

Run:

```bash
node --test scripts/__tests__/inbox-announcement-types.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run app test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/domain/Inbox.ts src/mocks/inbox.ts app/inbox/index.tsx scripts/__tests__/inbox-announcement-types.test.mjs
git commit -m "feat(app): support announcement inbox messages"
```

### Task 6: Chunk 1 Documentation And Verification

**Files:**
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Update admin frontend docs**

Add a short "消息公告" entry under the admin customer-service or operations section:

```md
### 消息公告

管理后台提供消息公告页面，支持全量、VIP、普通、注册时间、ACTIVE 状态和指定 buyerNo 发布站内公告。买家端展示仍复用 App 消息中心。
```

- [ ] **Step 2: Update app frontend docs**

Add inbox message type notes:

```md
消息中心新增 `platform_announcement`、`platform_notice`、`cs_outreach_invite` 类型。第一版公告只在消息中心展示，不新增首页横幅。
```

- [ ] **Step 3: Update `plan.md`**

Add or check off the first-stage announcement task under the current launch plan. Keep wording narrow:

```md
- [ ] 管理后台消息公告：全量 / 分群 / 指定 buyerNo 发布站内公告，App 消息中心展示。
```

- [ ] **Step 4: Run final Chunk 1 verification**

Run:

```bash
cd backend && npx prisma validate
cd backend && npx jest src/modules/admin/announcements --runInBand
cd admin && npm run build
node --test scripts/__tests__/admin-announcements-page.test.mjs scripts/__tests__/inbox-announcement-types.test.mjs
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/admin-frontend.md docs/architecture/frontend.md plan.md
git commit -m "docs: document admin announcements"
```

---

## Chunk 2: Proactive One-To-One Customer Service

### Task 7: Outreach Backend Service

**Files:**
- Create: `backend/src/modules/customer-service/dto/cs-outreach.dto.ts`
- Create: `backend/src/modules/customer-service/cs-outreach.service.ts`
- Create: `backend/src/modules/customer-service/cs-outreach.service.spec.ts`
- Modify: `backend/src/modules/customer-service/cs.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `cs-outreach.service.spec.ts` with tests:

```ts
describe('CsOutreachService', () => {
  it('creates ADMIN_OUTREACH session, first agent message, and inbox invite in one Serializable transaction', async () => {});
  it('rejects missing or inactive buyer', async () => {});
  it('rejects when agent capacity is full', async () => {});
  it('masks sensitive content before writing cs message and inbox invite', async () => {});
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npx jest src/modules/customer-service/cs-outreach.service.spec.ts --runInBand
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Create DTO**

`backend/src/modules/customer-service/dto/cs-outreach.dto.ts`:

```ts
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCsOutreachDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  buyerNo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  initialMessage!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  inviteTitle?: string;
}
```

- [ ] **Step 4: Implement service**

Implement `CsOutreachService.create(adminId, dto)`:

1. Normalize and resolve `buyerNo`.
2. Load `User` and require `status='ACTIVE'`.
3. Mask `initialMessage` through `CsMaskingService`.
4. Inside a Serializable transaction:
   - Increment or create `CsAgentStatus` if below capacity.
   - Create `CsSession` with `source='ADMIN_OUTREACH'`, `status='AGENT_HANDLING'`, `agentId=adminId`.
   - Create first `CsMessage` with `senderType='AGENT'`.
   - Create `InboxMessage` with `type='cs_outreach_invite'`, `target.route='/cs'`, `target.params.sessionId=session.id`.
5. Return `{ sessionId, inboxMessageId }`.

Use a transactional client directly rather than `InboxService.send()` if `InboxService` does not yet accept a transaction client.

- [ ] **Step 5: Update module**

In `cs.module.ts`, import `InboxModule` only if the service uses `InboxService`; otherwise keep it self-contained with `PrismaService`.

Add `CsOutreachService` to providers.

- [ ] **Step 6: Run service tests**

Run:

```bash
cd backend
npx jest src/modules/customer-service/cs-outreach.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/customer-service/dto/cs-outreach.dto.ts backend/src/modules/customer-service/cs-outreach.service.ts backend/src/modules/customer-service/cs-outreach.service.spec.ts backend/src/modules/customer-service/cs.module.ts
git commit -m "feat(cs): add proactive outreach service"
```

### Task 8: Outreach Admin API

**Files:**
- Modify: `backend/src/modules/customer-service/cs-admin.controller.ts`
- Modify: `backend/src/modules/customer-service/cs-admin-crud.spec.ts` or create `backend/src/modules/customer-service/cs-outreach.controller.spec.ts`

- [ ] **Step 1: Write controller test**

Test that `POST /admin/cs/outreach`:

1. Requires `cs:outreach`.
2. Passes `CurrentAdmin('sub')` to `CsOutreachService.create`.

- [ ] **Step 2: Run controller test and verify failure**

Run:

```bash
cd backend
npx jest src/modules/customer-service/cs-outreach.controller.spec.ts --runInBand
```

Expected: FAIL.

- [ ] **Step 3: Add controller route**

Inject `CsOutreachService` into `CsAdminController` and add:

```ts
@Post('outreach')
@RequirePermission('cs:outreach')
@AuditLog({ action: 'CREATE', module: 'cs-outreach', targetType: 'CsSession' })
createOutreach(@Body() dto: CreateCsOutreachDto, @CurrentAdmin('sub') adminId: string) {
  return this.outreachService.create(adminId, dto);
}
```

- [ ] **Step 4: Run customer-service tests**

Run:

```bash
cd backend
npx jest --testPathPattern=customer-service --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/customer-service/cs-admin.controller.ts backend/src/modules/customer-service/cs-outreach.controller.spec.ts
git commit -m "feat(cs): expose proactive outreach api"
```

### Task 9: Admin Frontend Outreach Entry

**Files:**
- Modify: `admin/src/api/cs.ts`
- Modify: `admin/src/pages/users/detail.tsx`
- Modify: `admin/src/pages/cs/workstation.tsx`
- Create: `scripts/__tests__/admin-cs-outreach-entry.test.mjs`

- [ ] **Step 1: Write static test**

Create `scripts/__tests__/admin-cs-outreach-entry.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin user detail exposes proactive customer-service outreach', () => {
  const api = readFileSync('admin/src/api/cs.ts', 'utf8');
  const detail = readFileSync('admin/src/pages/users/detail.tsx', 'utf8');
  const workstation = readFileSync('admin/src/pages/cs/workstation.tsx', 'utf8');

  assert.match(api, /createCsOutreach/);
  assert.match(detail, /联系买家/);
  assert.match(detail, /createCsOutreach/);
  assert.match(workstation, /sessionId/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test scripts/__tests__/admin-cs-outreach-entry.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add API function**

In `admin/src/api/cs.ts`:

```ts
export const createCsOutreach = (data: {
  buyerNo: string;
  initialMessage: string;
  inviteTitle?: string;
}): Promise<{ sessionId: string; inboxMessageId: string }> =>
  client.post('/admin/cs/outreach', data);
```

- [ ] **Step 4: Add user detail action**

In `admin/src/pages/users/detail.tsx`:

1. Add "联系买家" button near existing status/admin actions.
2. Open modal with initial message and optional invitation title.
3. Submit `buyerNo: user.buyerNo`.
4. On success navigate to `/cs/workstation?sessionId=${sessionId}`.
5. Disable when user has no `buyerNo` or is not ACTIVE.

- [ ] **Step 5: Support workstation deep selection**

In `admin/src/pages/cs/workstation.tsx`:

1. Use `useSearchParams` from `react-router-dom`.
2. Read `sessionId`.
3. After sessions load, set `activeSessionId` if the session exists.
4. If not in the first list load, call `getCsSessionDetail(sessionId)` and seed local state.

- [ ] **Step 6: Run tests and build**

Run:

```bash
node --test scripts/__tests__/admin-cs-outreach-entry.test.mjs
cd admin && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add admin/src/api/cs.ts admin/src/pages/users/detail.tsx admin/src/pages/cs/workstation.tsx scripts/__tests__/admin-cs-outreach-entry.test.mjs
git commit -m "feat(admin): add proactive customer contact entry"
```

### Task 10: Buyer App SessionId Customer-Service Entry

**Files:**
- Modify: `app/cs/index.tsx`
- Modify: `src/repos/CsRepo.ts`
- Create: `scripts/__tests__/cs-outreach-entry.test.mjs`

- [ ] **Step 1: Write static test**

Create `scripts/__tests__/cs-outreach-entry.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('buyer customer service page supports sessionId entry from inbox outreach invite', () => {
  const page = readFileSync('app/cs/index.tsx', 'utf8');
  assert.match(page, /sessionId/);
  assert.match(page, /CsRepo\.getMessages/);
  assert.match(page, /createSession/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test scripts/__tests__/cs-outreach-entry.test.mjs
```

Expected: FAIL until `sessionId` handling exists.

- [ ] **Step 3: Update `/cs` params**

In `app/cs/index.tsx`, include `sessionId`:

```ts
const { source, sourceId, sessionId: routeSessionId } = useLocalSearchParams<{
  source?: string;
  sourceId?: string;
  sessionId?: string;
}>();
```

- [ ] **Step 4: Split initialization**

Update init effect:

```ts
if (routeSessionId) {
  setSessionId(routeSessionId);
  const messagesResult = await CsRepo.getMessages(routeSessionId);
  if (messagesResult.ok) setMessages(sortedMessages(messagesResult.data));
  else show({ message: messagesResult.error.displayMessage ?? '客服会话加载失败', type: 'error' });
  return;
}

const result = await CsRepo.createSession(source ?? 'MY_PAGE', sourceId);
```

Use a local helper:

```ts
const sortMessages = (items: CsMessage[]) =>
  [...items].sort((a, b) => {
    const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return dt !== 0 ? dt : a.id.localeCompare(b.id);
  });
```

- [ ] **Step 5: Preserve existing normal customer-service behavior**

Make sure:

1. `/cs?source=MY_PAGE` still creates or reuses a normal session.
2. `/cs?source=ORDER_DETAIL&sourceId=...` still injects order context.
3. `/cs?sessionId=...` never calls `createSession`.
4. Sending messages uses the loaded `sessionId` in all paths.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test scripts/__tests__/cs-outreach-entry.test.mjs scripts/__tests__/inbox-announcement-types.test.mjs
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/cs/index.tsx src/repos/CsRepo.ts scripts/__tests__/cs-outreach-entry.test.mjs
git commit -m "feat(app): open customer service by session invite"
```

### Task 11: Chunk 2 Documentation And Verification

**Files:**
- Modify: `docs/features/智能客服.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Update customer-service docs**

Add:

```md
### 主动联系买家

管理后台可创建 `ADMIN_OUTREACH` 会话，并通过消息中心发送 `cs_outreach_invite` 邀请买家进入。第一版不做强弹窗或第三方推送。
```

- [ ] **Step 2: Update admin and app docs**

Document:

1. 用户详情页“联系买家”入口。
2. 工作台支持 `?sessionId=` 选中会话。
3. App `/cs?sessionId=` 从站内信打开已有会话。

- [ ] **Step 3: Update `plan.md`**

Add or check:

```md
- [ ] 客服主动联系：管理后台发起 `ADMIN_OUTREACH` 会话，买家消息中心点击进入一对一客服。
```

- [ ] **Step 4: Run final verification**

Run:

```bash
cd backend && npx prisma validate
cd backend && npx jest src/modules/admin/announcements src/modules/customer-service --runInBand
cd admin && npm run build
node --test scripts/__tests__/admin-announcements-page.test.mjs scripts/__tests__/inbox-announcement-types.test.mjs scripts/__tests__/admin-cs-outreach-entry.test.mjs scripts/__tests__/cs-outreach-entry.test.mjs
npm test -- --runInBand
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/features/智能客服.md docs/architecture/admin-frontend.md docs/architecture/frontend.md plan.md
git commit -m "docs: document proactive customer service outreach"
```

---

## Final Release Checklist

- [ ] `backend/prisma/schema.prisma` validates.
- [ ] Backend tests pass for `admin/announcements`.
- [ ] Backend customer-service tests pass.
- [ ] Admin build passes.
- [ ] App node tests pass.
- [ ] App messages center shows `platform_announcement` and `cs_outreach_invite`.
- [ ] Admin announcement page can preview and publish to a small buyerNo list in staging.
- [ ] Admin user detail can create a proactive outreach session in staging.
- [ ] Buyer can click inbox invite and reply in `/cs?sessionId=...`.
- [ ] Admin workstation receives buyer reply and can release the session.
- [ ] `docs/features/智能客服.md`, `docs/architecture/admin-frontend.md`, `docs/architecture/frontend.md`, and `plan.md` are updated.
