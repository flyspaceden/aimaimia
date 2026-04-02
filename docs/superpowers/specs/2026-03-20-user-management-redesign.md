# 用户管理页面优化设计方案

## 概述

将现有用户管理页面从简单列表升级为信息丰富、交互完善的用户管理中心。核心改动：新增统计概览、修正数据展示、详情从 Drawer 改为独立页面、增加关联数据导航。

## 当前问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | "等级"列用了 `user.profile.level`（成长等级名称如"新芽会员"），但 valueEnum 写的 NORMAL/VIP，数据与筛选不匹配 | 筛选无效，显示混乱 |
| 2 | 后端 `findAll` 不接受 `level` 参数，前端发了也被忽略 | 等级筛选形同虚设 |
| 3 | 详情 Drawer 只显示 6 个字段，后端返回的 `points`/`gender`/`birthday`/`city`/`memberTier`/`addressCount`/`followCount`/`authIdentitiesMasked` 全部丢弃 | 信息浪费 |
| 4 | 无统计概览卡片 | 缺乏全局视角 |
| 5 | 操作只有"详情"和"封禁"，无关联数据跳转 | 操作效率低 |
| 6 | 无注册时间范围筛选 | 无法按时间段查看新用户 |

---

## 设计方案

### 一、页面结构总览

```
┌─────────────────────────────────────────────────────────┐
│  统计卡片区（4 卡片）                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 总用户数  │  │ VIP 用户 │  │ 今日注册  │  │ 已封禁   │    │
│  │  12,456  │  │   328   │  │    23    │  │    5    │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
├─────────────────────────────────────────────────────────┤
│  搜索栏                                                  │
│  [用户/手机号] [会员类型 ▼] [状态 ▼] [注册时间 📅━━━📅]     │
│                                     [重置] [查询] [展开]  │
├─────────────────────────────────────────────────────────┤
│  用户管理                                     [导出]      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 用户          手机号       会员    订单  状态  注册时间 │  │
│  │ 🟡 [头像] 郑雅琪  138****2026  VIP    5   正常  03-19 │ ← VIP 行左侧金色竖线
│  │    [头像] 张明    138****5003  普通   0   正常  03-12 │  │
│  │ 🔴 [头像] 李某    138****5001  普通   2   封禁  03-10 │ ← 封禁行红色竖线
│  └────────────────────────────────────────────────────┘  │
│  [< 1 2 3 ... 20 >]                    共 245 条         │
└─────────────────────────────────────────────────────────┘
```

### 二、统计卡片区

位于表格上方，一行 4 个 `Card` + `Statistic`，与 Dashboard 页面风格一致。

| 卡片 | 数据来源 | 图标 | 颜色 |
|------|---------|------|------|
| 总用户数 | `GET /admin/stats/dashboard` → `totalUsers` | `TeamOutlined` | `#1E40AF`（品牌蓝） |
| VIP 用户 | `GET /admin/stats/bonus` → `vipCount` | `CrownOutlined` | `#D97706`（金色） |
| 今日注册 | 新增 API 或从用户列表首次查询中计算 | `UserAddOutlined` | `#059669`（绿色） |
| 已封禁 | 新增 API 或 `count({ where: { status: 'BANNED' } })` | `StopOutlined` | `#DC2626`（红色） |

**实现策略**：新增后端 `GET /admin/app-users/stats` 接口，一次返回全部 4 个指标，30 秒缓存。避免调用多个现有接口。

```typescript
// 后端新增
// GET /admin/app-users/stats
{
  totalUsers: number;
  vipUsers: number;
  todayRegistered: number;
  bannedUsers: number;
}
```

### 三、表格列重新设计

#### 列定义

| 列名 | 字段 | 宽度 | 搜索 | 说明 |
|------|------|------|------|------|
| 用户 | `nickname` + `avatarUrl` | 200 | 是（关键词） | Avatar + 昵称，昵称下方小字显示用户 ID |
| 手机号 | `phone` | 140 | 是 | 脱敏显示 138****5003 |
| 会员 | `memberTier` | 90 | 是（下拉） | VIP → 金色 Tag，普通 → 灰色 Tag |
| 订单数 | `orderCount` | 80 | 否 | 数字，可点击跳转该用户订单 |
| 状态 | `status` | 80 | 是（下拉） | ACTIVE 绿色 / BANNED 红色 |
| 注册时间 | `createdAt` | 160 | 是（日期范围） | YYYY-MM-DD HH:mm |
| 操作 | - | 120 | 否 | 详情 / 封禁(解封) |

#### 关键变化

**1. 移除"等级"列，改为"会员"列**
- 后端 `findAll` 需要 include `memberProfile` 来获取 `tier`
- 前端 `valueEnum` 改为 `{ VIP: 'VIP', NORMAL: '普通' }`
- 后端新增 `tier` 查询参数支持

**2. 用户列增加 ID 副文本**
```tsx
render: (_, r) => (
  <Space>
    <Avatar src={r.avatarUrl} icon={<UserOutlined />} />
    <div>
      <div>{r.nickname || r.phone || '-'}</div>
      <div style={{ fontSize: 12, color: '#999' }}>{r.id.slice(0, 8)}</div>
    </div>
  </Space>
)
```

**3. VIP 行视觉区分**
- VIP 行左侧加 3px 金色边线（通过 `onRow` + `style` 实现）
- 封禁行左侧加 3px 红色边线
```tsx
onRow={(record) => ({
  style: {
    borderLeft: record.memberTier === 'VIP'
      ? '3px solid #D97706'
      : record.status === 'BANNED'
        ? '3px solid #DC2626'
        : '3px solid transparent',
  },
})}
```

**4. 订单数可点击**
```tsx
render: (_, r) => (
  <Button type="link" size="small"
    onClick={() => navigate(`/orders?userId=${r.id}`)}>
    {r.orderCount}
  </Button>
)
```

**5. 注册时间范围筛选**
```tsx
{
  title: '注册时间',
  dataIndex: 'createdAt',
  valueType: 'dateRange',
  search: { transform: (v) => ({ startDate: v[0], endDate: v[1] }) },
}
```

**6. 封禁操作增加原因输入**
- 从 `Popconfirm` 改为 `Modal.confirm` + `Input.TextArea`
- 封禁原因存入审计日志的 `summary` 字段

### 四、详情页（独立路由页面）

从 Drawer 改为独立页面 `/users/:id`，参考现有 `bonus/members/:userId` 的页面模式。

#### 页面结构

```
┌──────────────────────────────────────────────────┐
│  ← 返回用户列表              用户详情               │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─ 用户信息卡 ────────────────────────────────┐  │
│  │  [大头像]                                   │  │
│  │  张明                                       │  │
│  │  [VIP 金色标签]  [正常 绿色标签]              │  │
│  │                                             │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐  │  │
│  │  │ 订单数  │ │ 地址数  │ │ 关注数  │ │ 积分 │  │  │
│  │  │   12   │ │   3    │ │   28   │ │ 560  │  │  │
│  │  └────────┘ └────────┘ └────────┘ └──────┘  │  │
│  └─────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ Tabs ──────────────────────────────────────┐  │
│  │ [基本信息] [订单记录] [奖励账户] [优惠券]      │  │
│  ├─────────────────────────────────────────────┤  │
│  │                                             │  │
│  │  (Tab 内容区)                                │  │
│  │                                             │  │
│  └─────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ 操作区 ───────────────────────────────────┐   │
│  │  [封禁用户]（红色危险按钮）                   │   │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### Tab 1：基本信息

使用 `Descriptions` 组件，两列布局：

| 字段 | 来源 | 说明 |
|------|------|------|
| 用户 ID | `id` | 完整 ID + 复制按钮 |
| 手机号 | `phone` | 未脱敏（详情接口返回完整手机号） |
| 昵称 | `nickname` | - |
| 性别 | `gender` | 男/女/未设置 |
| 生日 | `birthday` | YYYY-MM-DD 或 未设置 |
| 所在城市 | `city` | - |
| 会员类型 | `memberTier` | VIP 金色 Tag / 普通灰色 Tag |
| 积分 | `points` | - |
| 成长值 | `growthPoints` | - |
| 注册时间 | `createdAt` | YYYY-MM-DD HH:mm:ss |
| 最后更新 | `updatedAt` | YYYY-MM-DD HH:mm:ss |
| 登录方式 | `authIdentitiesMasked` | 列出所有绑定的认证方式（手机/微信等） |

#### Tab 2：订单记录

内嵌 ProTable，复用 `/admin/orders` 的 API，自动带上 `userId` 过滤：

| 列 | 说明 |
|----|------|
| 订单号 | 可点击跳转订单详情 |
| 商品摘要 | 首个商品名 + 数量 |
| 金额 | ¥ 格式 |
| 状态 | 彩色 Tag |
| 下单时间 | - |

#### Tab 3：奖励账户

如果用户有 `MemberProfile`（已加入奖励体系），显示：
- 统计卡片：可用余额 / 冻结金额 / 累计收入
- 最近奖励流水表格（复用 bonus API）
- "查看完整奖励详情" 按钮 → 跳转 `/bonus/members/:userId`

如果用户未加入奖励体系，显示 `Empty` 提示。

#### Tab 4：优惠券

显示该用户持有的优惠券列表：
- 优惠券名称、面额、状态（可用/已使用/已过期）、领取时间、使用时间

需要后端新增 API：`GET /admin/app-users/:id/coupons`

---

### 五、后端 API 改动

#### 5.1 修改 `GET /admin/app-users` — 列表接口

```typescript
// 新增参数
@Query('tier') tier?: string,        // 会员类型筛选
@Query('startDate') startDate?: string,  // 注册时间范围
@Query('endDate') endDate?: string,

// Service 修改
async findAll(page, pageSize, status?, keyword?, tier?, startDate?, endDate?) {
  const where: any = {};
  if (status) where.status = status;
  if (keyword) { /* 现有逻辑 */ }

  // 新增：会员类型筛选
  if (tier) {
    where.memberProfile = { tier };
  }

  // 新增：注册时间范围
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59');
  }

  // 查询时 include memberProfile
  const items = await this.prisma.user.findMany({
    where,
    include: {
      profile: { select: { nickname: true, avatarUrl: true } },
      memberProfile: { select: { tier: true } },  // 新增
      authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
      _count: { select: { orders: true } },
    },
  });

  // 返回新增 memberTier 字段
  return {
    items: items.map(user => ({
      ...existingFields,
      memberTier: user.memberProfile?.tier || 'NORMAL',  // 新增
    })),
  };
}
```

#### 5.2 新增 `GET /admin/app-users/stats` — 统计接口

```typescript
@Get('stats')
@RequirePermission('users:read')
async getStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [total, vip, today, banned] = await Promise.all([
    this.prisma.user.count(),
    this.prisma.memberProfile.count({ where: { tier: 'VIP' } }),
    this.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
    this.prisma.user.count({ where: { status: 'BANNED' } }),
  ]);

  return { totalUsers: total, vipUsers: vip, todayRegistered: today, bannedUsers: banned };
}
```

**注意**：此路由必须放在 `:id` 路由之前，避免被参数路由抢先匹配（与现有 `guest-cleanup` 路由同样处理）。

#### 5.3 新增 `GET /admin/app-users/:id/coupons` — 用户优惠券

```typescript
@Get(':id/coupons')
@RequirePermission('users:read')
async getUserCoupons(@Param('id') id: string, @Query('page') page?, @Query('pageSize') pageSize?) {
  return this.appUsersService.findUserCoupons(id, page, pageSize);
}
```

#### 5.4 修改 `POST /admin/app-users/:id/toggle-ban` — 封禁增加原因

```typescript
// DTO 增加可选 reason 字段
export class ToggleBanDto {
  @IsIn(['ACTIVE', 'BANNED'])
  status: 'ACTIVE' | 'BANNED';

  @IsOptional()
  @IsString()
  reason?: string;  // 封禁原因，记入审计日志
}
```

---

### 六、前端文件改动清单

| 文件 | 改动 |
|------|------|
| `admin/src/pages/users/index.tsx` | 重写：统计卡片 + 新列定义 + 移除 Drawer + 行样式 |
| `admin/src/pages/users/detail.tsx` | **新建**：用户详情独立页面（4 个 Tab） |
| `admin/src/api/app-users.ts` | 新增 `getAppUserStats`、`getAppUserCoupons`，修改 `getAppUsers` 参数 |
| `admin/src/types/index.ts` | `AppUser` 增加 `memberTier` 字段；新增 `AppUserStats` 类型 |
| `admin/src/App.tsx` | 新增路由 `users/:id` |
| `admin/src/layouts/AdminLayout.tsx` | 无需改动（侧栏菜单不变） |

### 七、路由配置

```tsx
// App.tsx 新增
<Route path="users/:id" element={<UserDetailPage />} />
```

侧栏菜单不需要额外入口，从列表页的"详情"按钮通过 `navigate(`/users/${id}`)` 跳转。

---

### 八、交互细节

#### 8.1 封禁确认弹窗

```
┌─────────────────────────────┐
│  确认封禁用户                 │
│                              │
│  用户：张明（138****5003）    │
│                              │
│  封禁原因：                   │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  │  （必填，至少 5 个字）    │ │
│  │                         │ │
│  └─────────────────────────┘ │
│                              │
│  ⚠️ 封禁后该用户将无法登录    │
│                              │
│         [取消]  [确认封禁]    │
└─────────────────────────────┘
```

- 封禁时原因必填（至少 5 字）
- 解封时原因选填
- 原因通过 `@AuditLog` 的 `summary` 字段记录

#### 8.2 行状态视觉标识

| 状态 | 样式 |
|------|------|
| VIP 用户 | 行左侧 3px `#D97706` 金色边线 |
| 已封禁 | 行左侧 3px `#DC2626` 红色边线 |
| 普通正常 | 行左侧 3px 透明边线（保持对齐） |

#### 8.3 空状态处理

- 统计卡片加载时：Skeleton 占位
- 表格首次加载：ProTable 内置 loading
- 详情页各 Tab 无数据时：`<Empty description="暂无数据" />`

---

### 九、数据流总结

```
列表页:
  统计卡片 ← GET /admin/app-users/stats（独立 useQuery，30s staleTime）
  表格数据 ← GET /admin/app-users?tier=&status=&keyword=&startDate=&endDate=

详情页:
  用户信息 ← GET /admin/app-users/:id（现有接口，已返回丰富数据）
  订单记录 ← GET /admin/orders?userId=xxx（复用现有接口）
  奖励账户 ← GET /admin/bonus/members/:userId（复用现有接口）
  优惠券   ← GET /admin/app-users/:id/coupons（新增接口）
```

---

### 十、实施优先级

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P0 | 修正"会员"列（后端 include memberProfile + 前端列定义） | 小 |
| P0 | 后端新增 `tier`/`startDate`/`endDate` 查询参数 | 小 |
| P1 | 统计卡片 + 后端 stats 接口 | 中 |
| P1 | 详情页独立化（基本信息 Tab） | 中 |
| P2 | 详情页订单/奖励 Tab（复用现有 API） | 中 |
| P2 | 封禁原因弹窗 + DTO 修改 | 小 |
| P2 | VIP 行金色标识 | 小 |
| P3 | 详情页优惠券 Tab（需新增后端 API） | 中 |
