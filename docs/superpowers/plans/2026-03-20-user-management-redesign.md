# User Management Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the admin user management page from a basic list with sparse drawer detail to a full-featured user management center with stats overview, correct membership tier display, rich detail page with tabs, and enhanced ban workflow.

**Architecture:** Backend-first approach — extend the existing `AdminAppUsersService` with stats endpoint, tier/date filtering, and reason field on ban DTO. Then rewrite the frontend list page with stat cards + corrected columns, and create a new detail page at `/users/:id` with 4 tabs (info, orders, rewards, coupons) reusing existing APIs.

**Tech Stack:** NestJS + Prisma (backend), React 19 + Ant Design 5 + ProComponents + TypeScript + React Query (frontend)

**Spec:** `docs/superpowers/specs/2026-03-20-user-management-redesign.md`

---

## File Structure

### Backend (modify)
- `backend/src/modules/admin/app-users/admin-app-users.service.ts` — Add `getStats()`, extend `findAll()` with `tier`/`startDate`/`endDate` params, add `memberTier` to list response
- `backend/src/modules/admin/app-users/admin-app-users.controller.ts` — Add `GET stats` endpoint, extend `findAll()` query params, pass `reason` to audit summary
- `backend/src/modules/admin/app-users/dto/toggle-ban.dto.ts` — Add optional `reason` field
- `backend/src/modules/admin/orders/dto/admin-order.dto.ts` — Add optional `userId` query param
- `backend/src/modules/admin/orders/admin-orders.service.ts` — Add `userId` filter to `findAll()`

### Frontend (modify)
- `admin/src/api/app-users.ts` — Add `getAppUserStats()`, extend query params with `tier`/`startDate`/`endDate`/`reason`
- `admin/src/types/index.ts` — Add `memberTier` to `AppUser`, add `AppUserStats` and `AppUserDetail` types, add `userId` to `OrderQueryParams`
- `admin/src/pages/users/index.tsx` — Full rewrite: stat cards, corrected columns, row highlighting, ban modal with reason
- `admin/src/App.tsx` — Add lazy route for `users/:id`

### Frontend (create)
- `admin/src/pages/users/detail.tsx` — New detail page with profile card + 4 tabs

### Design notes
- Spec's `GET /admin/app-users/:id/coupons` endpoint is intentionally skipped — the existing `getInstances({ userId })` from the coupon API already provides this functionality
- Export button (spec Section 1) is deferred to a future iteration

---

### Task 1: Backend — Add stats endpoint and extend list query

**Files:**
- Modify: `backend/src/modules/admin/app-users/admin-app-users.service.ts`
- Modify: `backend/src/modules/admin/app-users/admin-app-users.controller.ts`

- [ ] **Step 1: Add `getStats()` method to service**

In `admin-app-users.service.ts`, add after the `findAll` method (before `findById`):

```typescript
/** 用户统计概览 */
async getStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [totalUsers, vipUsers, todayRegistered, bannedUsers] = await Promise.all([
    this.prisma.user.count(),
    this.prisma.memberProfile.count({ where: { tier: 'VIP' } }),
    this.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
    this.prisma.user.count({ where: { status: 'BANNED' } }),
  ]);

  return { totalUsers, vipUsers, todayRegistered, bannedUsers };
}
```

- [ ] **Step 2: Extend `findAll()` with tier, date range, and memberTier response**

In `admin-app-users.service.ts`, update the `findAll` method signature and body:

Change the method signature from:
```typescript
async findAll(page = 1, pageSize = 20, status?: string, keyword?: string)
```
to:
```typescript
async findAll(page = 1, pageSize = 20, status?: string, keyword?: string, tier?: string, startDate?: string, endDate?: string)
```

After the existing `if (keyword)` block, add these filter clauses:
```typescript
// 会员类型筛选
if (tier) {
  where.memberProfile = { tier };
}

// 注册时间范围
if (startDate || endDate) {
  where.createdAt = {};
  if (startDate) where.createdAt.gte = new Date(startDate);
  if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59');
}
```

In the `findMany` include block, add `memberProfile` selection:
```typescript
memberProfile: {
  select: { tier: true },
},
```

In the items map, add `memberTier` and remove `level`/`growthPoints`:
```typescript
memberTier: user.memberProfile?.tier || 'NORMAL',
```

- [ ] **Step 3: Add stats endpoint and extend findAll params in controller**

In `admin-app-users.controller.ts`, add the stats endpoint BEFORE the `guest-cleanup` routes (between the `findAll` method and the comment about concrete path routes):

```typescript
@Get('stats')
@RequirePermission('users:read')
getStats() {
  return this.appUsersService.getStats();
}
```

Update the existing `findAll` method to accept new query params:
```typescript
findAll(
  @Query('page') page?: string,
  @Query('pageSize') pageSize?: string,
  @Query('status') status?: string,
  @Query('keyword') keyword?: string,
  @Query('tier') tier?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
) {
  return this.appUsersService.findAll(
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20,
    status,
    keyword,
    tier,
    startDate,
    endDate,
  );
}
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/admin/app-users/admin-app-users.service.ts backend/src/modules/admin/app-users/admin-app-users.controller.ts
git commit -m "feat(admin): add user stats endpoint and extend list with tier/date filters"
```

---

### Task 2: Backend — Add reason to ban DTO, controller, and orders userId filter

**Files:**
- Modify: `backend/src/modules/admin/app-users/dto/toggle-ban.dto.ts`
- Modify: `backend/src/modules/admin/app-users/admin-app-users.controller.ts`
- Modify: `backend/src/modules/admin/orders/dto/admin-order.dto.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`

- [ ] **Step 1: Add optional reason field to DTO**

Add `IsOptional` and `IsString` imports and the `reason` property:

```typescript
import { IsIn, IsOptional, IsString } from 'class-validator';

/** H16: 用户封禁/解封 DTO（替换 @Body('status')） */
export class ToggleBanDto {
  @IsIn(['ACTIVE', 'BANNED'])
  status: 'ACTIVE' | 'BANNED';

  @IsOptional()
  @IsString()
  reason?: string;
}
```

- [ ] **Step 2: Update controller to include reason in audit summary**

In `admin-app-users.controller.ts`, update the `toggleBan` method's `@AuditLog` decorator to include a `summaryBuilder` that appends the reason:

Replace the existing `@AuditLog` on `toggleBan` with:
```typescript
@AuditLog({
  action: 'STATUS_CHANGE',
  module: 'users',
  targetType: 'User',
  targetIdParam: 'params.id',
  isReversible: true,
  summaryBuilder: (req) => {
    const status = req.body?.status;
    const reason = req.body?.reason;
    const label = status === 'BANNED' ? '封禁用户' : '解封用户';
    return reason ? `${label}：${reason}` : label;
  },
})
```

Note: If the `AuditActionMeta` type does not support `summaryBuilder`, use the simpler approach — the `buildSummary` method in the interceptor already generates a generic summary. The reason will still be captured in the `after` snapshot of the request body via the interceptor's diff mechanism.

- [ ] **Step 3: Add userId filter to admin orders**

In `backend/src/modules/admin/orders/dto/admin-order.dto.ts`, add after the `keyword` field:
```typescript
@IsOptional()
@IsString()
userId?: string;
```

In `backend/src/modules/admin/orders/admin-orders.service.ts`, add after the existing `if (query.keyword)` block:
```typescript
if (query.userId) {
  where.userId = query.userId;
}
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/admin/app-users/dto/toggle-ban.dto.ts backend/src/modules/admin/app-users/admin-app-users.controller.ts backend/src/modules/admin/orders/dto/admin-order.dto.ts backend/src/modules/admin/orders/admin-orders.service.ts
git commit -m "feat(admin): add ban reason to DTO and userId filter to orders"
```

---

### Task 3: Frontend — Update types and API client

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/app-users.ts`

- [ ] **Step 1: Update AppUser type and add new types**

In `admin/src/types/index.ts`, update the `AppUser` interface (around line 153) to replace `level`/`growthPoints` with `memberTier`:

```typescript
export interface AppUser {
  id: string;
  phone: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  memberTier: 'VIP' | 'NORMAL';
  status: AppUserStatus;
  orderCount: number;
  createdAt: string;
}
```

Add a new `AppUserStats` interface right after `AppUser`:

```typescript
export interface AppUserStats {
  totalUsers: number;
  vipUsers: number;
  todayRegistered: number;
  bannedUsers: number;
}

export interface AppUserDetail {
  id: string;
  phone: string | null;
  phoneMasked: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  level: string;
  growthPoints: number;
  points: number;
  gender: string | null;
  birthday: string | null;
  city: string | null;
  status: AppUserStatus;
  memberTier: 'VIP' | 'NORMAL' | null;
  orderCount: number;
  addressCount: number;
  followCount: number;
  authIdentitiesMasked: Array<{
    provider: string;
    identifierMasked: string;
    verified: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `userId` to `OrderQueryParams`**

In `admin/src/types/index.ts`, find the `OrderQueryParams` interface (around line 277) and add `userId`:
```typescript
export interface OrderQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  companyId?: string;
  paymentChannel?: string;
  userId?: string;  // 新增：按用户筛选订单
}
```

- [ ] **Step 3: Update API client**

Rewrite `admin/src/api/app-users.ts`:

```typescript
import client from './client';
import type { AppUser, AppUserDetail, AppUserStats, PaginatedData, PaginationParams } from '@/types';

interface AppUserQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  tier?: string;
  startDate?: string;
  endDate?: string;
}

/** App 用户列表（买家） */
export const getAppUsers = (params?: AppUserQueryParams): Promise<PaginatedData<AppUser>> =>
  client.get('/admin/app-users', { params });

/** App 用户统计概览 */
export const getAppUserStats = (): Promise<AppUserStats> =>
  client.get('/admin/app-users/stats');

/** App 用户详情 */
export const getAppUser = (id: string): Promise<AppUserDetail> =>
  client.get(`/admin/app-users/${id}`);

/** 封禁/解封 App 用户 */
export const toggleAppUserBan = (id: string, status: 'ACTIVE' | 'BANNED', reason?: string): Promise<void> =>
  client.post(`/admin/app-users/${id}/toggle-ban`, { status, reason });
```

- [ ] **Step 4: Commit**

```bash
git add admin/src/types/index.ts admin/src/api/app-users.ts
git commit -m "feat(admin): update AppUser types and API client for user management redesign"
```

---

### Task 4: Frontend — Rewrite user list page

**Files:**
- Modify: `admin/src/pages/users/index.tsx`

- [ ] **Step 1: Rewrite the user list page**

Replace the entire file content with the new implementation. Key changes:
- Add stat cards row at top using `useQuery` for `getAppUserStats()`
- Replace `level` column with `memberTier` column using correct valueEnum
- Add `dateRange` search for registration time
- Replace `Popconfirm` ban with `Modal` + `Input.TextArea` for reason
- Add `onRow` styling for VIP gold border and banned red border
- Navigate to `/users/${id}` instead of opening Drawer
- Remove all Drawer code
- Add user ID subtitle under nickname in user column
- Make order count clickable to navigate to orders filtered by user

```tsx
import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Avatar, Tag, message, Button, Space, Card, Row, Col, Statistic, Modal, Input, Skeleton } from 'antd';
import {
  UserOutlined,
  EyeOutlined,
  TeamOutlined,
  CrownOutlined,
  UserAddOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { getAppUsers, getAppUserStats, toggleAppUserBan } from '@/api/app-users';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import PermissionGate from '@/components/PermissionGate';
import type { AppUser } from '@/types';
import { userStatusMap as statusMap, memberTierColors } from '@/constants/statusMaps';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

// 统计卡片配置
const statCardConfig = [
  { key: 'totalUsers' as const, title: '总用户数', icon: <TeamOutlined />, color: '#1E40AF' },
  { key: 'vipUsers' as const, title: 'VIP 用户', icon: <CrownOutlined />, color: '#D97706' },
  { key: 'todayRegistered' as const, title: '今日注册', icon: <UserAddOutlined />, color: '#059669' },
  { key: 'bannedUsers' as const, title: '已封禁', icon: <StopOutlined />, color: '#DC2626' },
];

export default function UserListPage() {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 封禁弹窗状态
  const [banModal, setBanModal] = useState<{ open: boolean; record: AppUser | null; reason: string }>({
    open: false, record: null, reason: '',
  });

  // 统计数据
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'app-user-stats'],
    queryFn: getAppUserStats,
    staleTime: 30_000,
  });

  // 封禁/解封处理
  const handleToggleBan = async () => {
    const { record, reason } = banModal;
    if (!record) return;
    const newStatus = record.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    if (newStatus === 'BANNED' && reason.trim().length < 5) {
      message.warning('请输入至少 5 个字的封禁原因');
      return;
    }
    await toggleAppUserBan(record.id, newStatus, reason || undefined);
    message.success(newStatus === 'BANNED' ? '已封禁' : '已解封');
    setBanModal({ open: false, record: null, reason: '' });
    actionRef.current?.reload();
    queryClient.invalidateQueries({ queryKey: ['admin', 'app-user-stats'] });
  };

  const columns: ProColumns<AppUser>[] = [
    {
      title: '用户',
      dataIndex: 'nickname',
      width: 200,
      render: (_: unknown, r: AppUser) => (
        <Space>
          <Avatar src={r.avatarUrl} icon={<UserOutlined />} size="small" />
          <div>
            <div>{r.nickname || r.phone || '-'}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.id.slice(0, 8)}</div>
          </div>
        </Space>
      ),
    },
    { title: '手机号', dataIndex: 'phone', width: 140 },
    {
      title: '会员',
      dataIndex: 'memberTier',
      width: 90,
      valueType: 'select',
      valueEnum: {
        VIP: { text: 'VIP' },
        NORMAL: { text: '普通' },
      },
      render: (_: unknown, r: AppUser) => (
        <Tag color={memberTierColors[r.memberTier] || 'default'}>
          {r.memberTier === 'VIP' ? 'VIP' : '普通'}
        </Tag>
      ),
    },
    {
      title: '订单数',
      dataIndex: 'orderCount',
      width: 80,
      search: false,
      render: (_: unknown, r: AppUser) => (
        <Button type="link" size="small" onClick={() => navigate(`/orders?userId=${r.id}`)}>
          {r.orderCount}
        </Button>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      valueType: 'select',
      valueEnum: {
        ACTIVE: { text: '正常' },
        BANNED: { text: '已封禁' },
      },
      render: (_: unknown, r: AppUser) => {
        const s = statusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      search: {
        transform: (v: string[]) => ({ startDate: v[0], endDate: v[1] }),
      },
      render: (_: unknown, r: AppUser) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      search: false,
      render: (_: unknown, record: AppUser) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />}
            onClick={() => navigate(`/users/${record.id}`)}>
            详情
          </Button>
          <PermissionGate permission={PERMISSIONS.USERS_BAN}>
            {record.status !== 'DELETED' && (
              <Button type="link" size="small" danger={record.status === 'ACTIVE'}
                onClick={() => setBanModal({ open: true, record, reason: '' })}>
                {record.status === 'ACTIVE' ? '封禁' : '解封'}
              </Button>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {statCardConfig.map((card) => (
          <Col span={6} key={card.key}>
            <Card size="small">
              {statsLoading ? (
                <Skeleton paragraph={false} active />
              ) : (
                <Statistic
                  title={card.title}
                  value={stats?.[card.key] ?? 0}
                  prefix={<span style={{ color: card.color }}>{card.icon}</span>}
                />
              )}
            </Card>
          </Col>
        ))}
      </Row>

      {/* 用户表格 */}
      <ProTable<AppUser>
        headerTitle="用户管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 900 }}
        request={async (params) => {
          const { current, pageSize, status, nickname: keyword, memberTier: tier, startDate, endDate } = params;
          const res = await getAppUsers({ page: current, pageSize, status, keyword, tier, startDate, endDate });
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        onRow={(record) => ({
          style: {
            borderLeft: record.memberTier === 'VIP'
              ? '3px solid #D97706'
              : record.status === 'BANNED'
                ? '3px solid #DC2626'
                : '3px solid transparent',
          },
        })}
      />

      {/* 封禁/解封弹窗 */}
      <Modal
        title={banModal.record?.status === 'ACTIVE' ? '确认封禁用户' : '确认解封用户'}
        open={banModal.open}
        onCancel={() => setBanModal({ open: false, record: null, reason: '' })}
        onOk={handleToggleBan}
        okText={banModal.record?.status === 'ACTIVE' ? '确认封禁' : '确认解封'}
        okButtonProps={{
          danger: banModal.record?.status === 'ACTIVE',
        }}
      >
        {banModal.record && (
          <>
            <p>用户：{banModal.record.nickname || '-'}（{banModal.record.phone || '-'}）</p>
            {banModal.record.status === 'ACTIVE' && (
              <>
                <p style={{ marginBottom: 8 }}>封禁原因：</p>
                <Input.TextArea
                  rows={3}
                  placeholder="请输入封禁原因（至少 5 个字）"
                  value={banModal.reason}
                  onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
                <p style={{ marginTop: 8, color: '#faad14', fontSize: 13 }}>
                  封禁后该用户将无法登录和使用 App
                </p>
              </>
            )}
            {banModal.record.status === 'BANNED' && (
              <>
                <p style={{ marginBottom: 8 }}>解封备注（选填）：</p>
                <Input.TextArea
                  rows={2}
                  placeholder="选填"
                  value={banModal.reason}
                  onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to our changes)

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/users/index.tsx
git commit -m "feat(admin): rewrite user list page with stats cards, tier column, ban modal"
```

---

### Task 5: Frontend — Create user detail page and add route

**Files:**
- Create: `admin/src/pages/users/detail.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Create the user detail page**

Create `admin/src/pages/users/detail.tsx` with these sections:
- Breadcrumb + back button header
- Profile card: avatar, name, tier tag, status tag, 4 mini stats (orders, addresses, follows, points)
- Tabs component with 4 tabs: 基本信息, 订单记录, 奖励账户, 优惠券
- Tab 1 (基本信息): Descriptions component with all fields from `findById` response
- Tab 2 (订单记录): ProTable using `getOrders` API with `keyword` set to `userId`
- Tab 3 (奖励账户): Uses `getMemberDetail` API, shows wallet stats + recent ledger entries, link to full bonus detail page
- Tab 4 (优惠券): Uses `getInstances` from coupon API with `userId` filter
- Bottom action area: ban/unban button with same modal as list page

```tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Breadcrumb, Card, Row, Col, Statistic, Descriptions, Tabs, Tag, Avatar,
  Button, Space, Table, Spin, Result, Empty, Modal, Input, message, Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  ArrowLeftOutlined, UserOutlined, CrownOutlined,
  ShoppingCartOutlined, EnvironmentOutlined, HeartOutlined, StarOutlined,
  WalletOutlined, LockOutlined, RiseOutlined, CopyOutlined,
} from '@ant-design/icons';
import { getAppUser, toggleAppUserBan } from '@/api/app-users';
import { getOrders } from '@/api/orders';
import { getMemberDetail } from '@/api/bonus';
import { getInstances } from '@/api/coupon';
import type { AppUserDetail, Order, BonusMemberDetail } from '@/types';
import { userStatusMap as statusMap, memberTierColors, orderStatusMap, couponInstanceStatusMap } from '@/constants/statusMaps';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

// 认证方式映射
const providerMap: Record<string, string> = {
  PHONE: '手机号',
  WECHAT: '微信',
  APPLE: 'Apple',
  EMAIL: '邮箱',
};

// 性别映射
const genderMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
};

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 封禁弹窗
  const [banModal, setBanModal] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState('info');

  // 用户详情
  const { data: user, isLoading, error } = useQuery<AppUserDetail>({
    queryKey: ['admin', 'app-user', id],
    queryFn: () => getAppUser(id!),
    enabled: !!id,
  });

  // 奖励详情（仅在切换到奖励 Tab 时才加载）
  const { data: memberDetail, isLoading: memberLoading } = useQuery<BonusMemberDetail>({
    queryKey: ['admin', 'member-detail', id],
    queryFn: () => getMemberDetail(id!),
    enabled: !!id && activeTab === 'rewards',
  });

  // 封禁处理
  const handleToggleBan = async () => {
    if (!user) return;
    const newStatus = user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    if (newStatus === 'BANNED' && banModal.reason.trim().length < 5) {
      message.warning('请输入至少 5 个字的封禁原因');
      return;
    }
    await toggleAppUserBan(user.id, newStatus, banModal.reason || undefined);
    message.success(newStatus === 'BANNED' ? '已封禁' : '已解封');
    setBanModal({ open: false, reason: '' });
    queryClient.invalidateQueries({ queryKey: ['admin', 'app-user', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'app-user-stats'] });
  };

  if (isLoading) return <div style={{ padding: 24, textAlign: 'center' }}><Spin size="large" /></div>;
  if (error || !user) return <Result status="error" title="用户不存在" extra={<Button onClick={() => navigate('/users')}>返回列表</Button>} />;

  // ====== 订单列定义 ======
  const orderColumns: ProColumns<Order>[] = [
    {
      title: '订单号', dataIndex: 'orderNo', width: 180,
      render: (_: unknown, r: Order) => (
        <Button type="link" size="small" onClick={() => navigate(`/orders/${r.id}`)}>{r.orderNo}</Button>
      ),
    },
    {
      title: '商品', dataIndex: 'itemsSummary', width: 200, ellipsis: true,
      render: (_: unknown, r: Order) => r.itemsSummary || (r.items?.[0]?.productTitle ?? '-'),
    },
    {
      title: '金额', dataIndex: 'totalAmount', width: 100,
      render: (_: unknown, r: Order) => `¥${r.totalAmount.toFixed(2)}`,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (_: unknown, r: Order) => {
        const s = orderStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '下单时间', dataIndex: 'createdAt', width: 160,
      render: (_: unknown, r: Order) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

  // ====== Tab 内容 ======
  const tabItems = [
    {
      key: 'info',
      label: '基本信息',
      children: (
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="用户 ID">
            <Space>
              <Typography.Text copyable={{ text: user.id }}>{user.id}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="手机号">{user.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="昵称">{user.nickname || '-'}</Descriptions.Item>
          <Descriptions.Item label="会员类型">
            <Tag color={memberTierColors[user.memberTier || 'NORMAL'] || 'default'}>
              {user.memberTier === 'VIP' ? 'VIP' : '普通'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="性别">{user.gender ? (genderMap[user.gender] || user.gender) : '未设置'}</Descriptions.Item>
          <Descriptions.Item label="生日">{user.birthday ? dayjs(user.birthday).format('YYYY-MM-DD') : '未设置'}</Descriptions.Item>
          <Descriptions.Item label="所在城市">{user.city || '未设置'}</Descriptions.Item>
          <Descriptions.Item label="积分">{user.points}</Descriptions.Item>
          <Descriptions.Item label="成长值">{user.growthPoints}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusMap[user.status]?.color}>{statusMap[user.status]?.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">{dayjs(user.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="最后更新">{dayjs(user.updatedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="登录方式" span={2}>
            <Space>
              {user.authIdentitiesMasked?.map((auth, i) => (
                <Tag key={i}>{providerMap[auth.provider] || auth.provider}: {auth.identifierMasked}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'orders',
      label: '订单记录',
      children: (
        <ProTable<Order>
          columns={orderColumns}
          rowKey="id"
          search={false}
          options={false}
          request={async (params) => {
            const { current, pageSize } = params;
            const res = await getOrders({ page: current, pageSize, userId: id });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 10 }}
        />
      ),
    },
    {
      key: 'rewards',
      label: '奖励账户',
      children: memberLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : memberDetail?.wallet ? (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="可用余额" value={memberDetail.wallet.balance} prefix={<><WalletOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="冻结金额" value={memberDetail.wallet.frozen} prefix={<><LockOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="累计收入" value={memberDetail.wallet.totalEarned} prefix={<><RiseOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
          </Row>
          <Table
            dataSource={memberDetail.ledgers?.slice(0, 10)}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: '类型', dataIndex: 'entryType', width: 80, render: (v: string) => v === 'CREDIT' ? <Tag color="green">收入</Tag> : <Tag color="red">支出</Tag> },
              { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => `¥${v.toFixed(2)}` },
              { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag>{v}</Tag> },
              { title: '时间', dataIndex: 'createdAt', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
            ]}
          />
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button type="link" onClick={() => navigate(`/bonus/members/${id}`)}>查看完整奖励详情 →</Button>
          </div>
        </>
      ) : (
        <Empty description="该用户尚未加入奖励体系" />
      ),
    },
    {
      key: 'coupons',
      label: '优惠券',
      children: (
        <ProTable
          rowKey="id"
          search={false}
          options={false}
          request={async (params) => {
            const { current, pageSize } = params;
            const res = await getInstances({ page: current, pageSize, userId: id });
            return { data: res.items, total: res.total, success: true };
          }}
          columns={[
            { title: '优惠券', dataIndex: ['campaign', 'name'], width: 180, ellipsis: true,
              render: (_: unknown, r: any) => r.campaign?.name || '-' },
            { title: '面额', dataIndex: 'discountValue', width: 100,
              render: (_: unknown, r: any) => r.discountType === 'PERCENT' ? `${r.discountValue}%` : `¥${r.discountValue}` },
            { title: '状态', dataIndex: 'status', width: 80,
              render: (_: unknown, r: any) => {
                const s = couponInstanceStatusMap[r.status];
                return <Tag color={s?.color}>{s?.text}</Tag>;
              },
            },
            { title: '领取时间', dataIndex: 'createdAt', width: 160,
              render: (_: unknown, r: any) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') },
            { title: '使用时间', dataIndex: 'usedAt', width: 160,
              render: (_: unknown, r: any) => r.usedAt ? dayjs(r.usedAt).format('YYYY-MM-DD HH:mm') : '-' },
          ]}
          pagination={{ defaultPageSize: 10 }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 面包屑 */}
      <Breadcrumb style={{ marginBottom: 16 }} items={[
        { title: <a onClick={() => navigate('/users')}>用户管理</a> },
        { title: '用户详情' },
      ]} />

      {/* 用户信息卡 */}
      <Card style={{ marginBottom: 16 }}>
        <Row align="middle" gutter={24}>
          <Col>
            <Avatar src={user.avatarUrl} icon={<UserOutlined />} size={64} />
          </Col>
          <Col flex="auto">
            <Space size={8} align="center">
              <span style={{ fontSize: 20, fontWeight: 600 }}>{user.nickname || '-'}</span>
              <Tag color={memberTierColors[user.memberTier || 'NORMAL'] || 'default'}>
                {user.memberTier === 'VIP' ? 'VIP' : '普通'}
              </Tag>
              <Tag color={statusMap[user.status]?.color}>{statusMap[user.status]?.text}</Tag>
            </Space>
            <div style={{ color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>ID: {user.id}</div>
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={6}>
            <Statistic title="订单数" value={user.orderCount} prefix={<ShoppingCartOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="收货地址" value={user.addressCount} prefix={<EnvironmentOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="关注数" value={user.followCount} prefix={<HeartOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="积分" value={user.points} prefix={<StarOutlined />} />
          </Col>
        </Row>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
      </Card>

      {/* 操作区 */}
      <Card style={{ marginTop: 16 }}>
        <PermissionGate permission={PERMISSIONS.USERS_BAN}>
          {user.status !== 'DELETED' && (
            <Button
              danger={user.status === 'ACTIVE'}
              type={user.status === 'ACTIVE' ? 'primary' : 'default'}
              onClick={() => setBanModal({ open: true, reason: '' })}
            >
              {user.status === 'ACTIVE' ? '封禁用户' : '解封用户'}
            </Button>
          )}
        </PermissionGate>
      </Card>

      {/* 封禁/解封弹窗 */}
      <Modal
        title={user.status === 'ACTIVE' ? '确认封禁用户' : '确认解封用户'}
        open={banModal.open}
        onCancel={() => setBanModal({ open: false, reason: '' })}
        onOk={handleToggleBan}
        okText={user.status === 'ACTIVE' ? '确认封禁' : '确认解封'}
        okButtonProps={{ danger: user.status === 'ACTIVE' }}
      >
        <p>用户：{user.nickname || '-'}（{user.phoneMasked || '-'}）</p>
        {user.status === 'ACTIVE' ? (
          <>
            <p style={{ marginBottom: 8 }}>封禁原因：</p>
            <Input.TextArea
              rows={3}
              placeholder="请输入封禁原因（至少 5 个字）"
              value={banModal.reason}
              onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <p style={{ marginTop: 8, color: '#faad14', fontSize: 13 }}>封禁后该用户将无法登录和使用 App</p>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 8 }}>解封备注（选填）：</p>
            <Input.TextArea
              rows={2}
              placeholder="选填"
              value={banModal.reason}
              onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

In `admin/src/App.tsx`, add the lazy import for `UserDetailPage` near the other lazy imports (after the `UserListPage` line):
```typescript
const UserDetailPage = lazy(() => import('@/pages/users/detail'));
```

Add the route right after the existing `users` route (after line `<Route path="users" element={<UserListPage />} />`):
```tsx
<Route path="users/:id" element={<UserDetailPage />} />
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/users/detail.tsx admin/src/App.tsx
git commit -m "feat(admin): add user detail page with profile card and 4 tabs"
```

---

### Task 6: Backend — Remove level/growthPoints from list response (cleanup)

**Files:**
- Modify: `backend/src/modules/admin/app-users/admin-app-users.service.ts`

- [ ] **Step 1: Clean up findAll response**

In the `findAll` method's item mapping, remove `level` and `growthPoints` since they are no longer used by the frontend list. The profile select can also drop `level` and `growthPoints` fields since list only needs `nickname` and `avatarUrl`.

Update the profile select in findMany:
```typescript
profile: {
  select: {
    nickname: true,
    avatarUrl: true,
  },
},
```

Update the items map to remove `level` and `growthPoints`:
```typescript
items: items.map((user) => ({
  id: user.id,
  phone: maskPhone(user.authIdentities[0]?.identifier || null),
  nickname: user.profile?.nickname || null,
  avatarUrl: user.profile?.avatarUrl || null,
  memberTier: user.memberProfile?.tier || 'NORMAL',
  status: user.status,
  orderCount: user._count.orders,
  createdAt: user.createdAt,
})),
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/admin/app-users/admin-app-users.service.ts
git commit -m "refactor(admin): clean up user list response, remove unused level/growthPoints"
```
