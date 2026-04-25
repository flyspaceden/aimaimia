# 爱买买 - 卖家系统设计与实施计划

> 版本：1.0 | 创建时间：2026-02-20
> 状态：待实施

---

## 1. 系统概述

### 1.1 定位

爱买买采用**多商户入驻模式**，每家企业（Company）拥有独立的卖家后台，自主管理商品、处理订单、发货和查看销售数据。平台管理员负责入驻审核、商品审核和争议仲裁。

### 1.2 三端关系

```
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  买家 App    │   │  卖家 Web 后台    │   │  管理员 Web 后台  │
│  React Native│   │  Vite + React +   │   │  Vite + React +   │
│  (app/)      │   │  Ant Design       │   │  Ant Design       │
│              │   │  (seller/)        │   │  (admin/)         │
└──────┬───────┘   └──────┬───────────┘   └──────┬───────────┘
       │                  │                      │
       │ /api/v1/*        │ /api/v1/seller/*     │ /api/v1/admin/*
       ▼                  ▼                      ▼
┌──────────────────────────────────────────────────────────────┐
│                 NestJS 后端（同一个服务）                       │
│  ├── 买家端 API   /api/v1/*          ✅ 已有                  │
│  ├── 管理端 API   /api/v1/admin/*    ✅ 已有                  │
│  └── 卖家端 API   /api/v1/seller/*   🆕 新增                  │
└──────────────────┬───────────────────────────────────────────┘
                   │ Prisma ORM
                   ▼
┌──────────────────────────────────────────────────────────────┐
│              PostgreSQL（60+ 表，39+ enum）                    │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 职责边界

| 角色 | 能做什么 | 不能做什么 |
|------|---------|-----------|
| **卖家** | 管理自己公司的商品（创建/编辑/上下架）、查看自己公司订单、发货、处理售后、查看销售报表、维护公司资料 | 看不到其他公司数据，不能自行通过商品审核，不能修改平台配置 |
| **管理员** | 审核入驻申请、审核商品、处理买卖争议仲裁、全局数据报表、平台配置 | 不替卖家管理日常运营（商品上架/发货等） |
| **买家** | 浏览商品、下单、支付、评价、申请售后 | — |

---

## 2. 数据模型设计

### 2.1 新增模型

#### CompanyStaff（企业员工关联表）

```prisma
// --- 卖家域枚举 ---
enum CompanyStaffRole {
  OWNER       // 企业主（创始人，不可移除）
  MANAGER     // 经理（可管理商品+订单+员工）
  OPERATOR    // 运营（只能管理商品+订单，不能管员工）
}

enum CompanyStaffStatus {
  ACTIVE      // 正常
  DISABLED    // 已禁用
}

// --- 企业员工关联表 ---
model CompanyStaff {
  id          String             @id @default(cuid())
  userId      String
  companyId   String
  role        CompanyStaffRole   @default(OPERATOR)
  status      CompanyStaffStatus @default(ACTIVE)
  invitedBy   String?            // 邀请人（OWNER/MANAGER 的 userId）
  joinedAt    DateTime           @default(now())
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  user        User               @relation(fields: [userId], references: [id])
  company     Company            @relation(fields: [companyId], references: [id])

  @@unique([userId, companyId])  // 同一用户在同一企业只有一个角色
  @@index([companyId])
  @@index([userId])
}
```

#### SellerSession（卖家会话管理）

```prisma
model SellerSession {
  id                String   @id @default(cuid())
  staffId           String   // CompanyStaff.id
  accessTokenHash   String
  refreshTokenHash  String
  status            SessionStatus @default(ACTIVE)
  expiresAt         DateTime
  createdAt         DateTime @default(now())

  staff             CompanyStaff @relation(fields: [staffId], references: [id])

  @@index([staffId])
}
```

### 2.2 现有模型改动

#### User 模型 — 添加关系

```prisma
model User {
  // ... 现有字段不变 ...

  // 🆕 新增关系
  companyStaffs  CompanyStaff[]   // 一个用户可以是多家企业的员工
}
```

#### Company 模型 — 添加关系

```prisma
model Company {
  // ... 现有字段不变 ...

  // 🆕 新增关系
  staff          CompanyStaff[]   // 企业员工列表
}
```

### 2.3 不需要改动的模型

| 模型 | 原因 |
|------|------|
| Product | 已有 `companyId` 外键，卖家按 companyId 过滤即可 |
| Order / OrderItem | 通过 `product.companyId` 关联，卖家查询时 JOIN |
| Shipment | 已有完整字段（carrierCode/trackingNo），卖家直接使用 |
| Payment | 卖家只读，不操作支付 |
| Refund | 已有字段，卖家审批用现有状态流转 |

---

## 3. 后端 API 设计

### 3.1 认证模块

遵循管理端隔离认证模式：独立 JWT Secret + 独立 Passport Strategy + 独立 Guard。

```
环境变量：SELLER_JWT_SECRET（与 JWT_SECRET、ADMIN_JWT_SECRET 独立）
策略名称：seller-jwt
Guard：SellerAuthGuard
装饰器：@CurrentSeller() — 注入 { userId, companyId, staffId, role }
```

**JWT Payload 结构：**
```typescript
interface SellerJwtPayload {
  sub: string;          // CompanyStaff.id
  userId: string;       // User.id
  companyId: string;    // Company.id
  role: CompanyStaffRole;
  type: 'seller';
}
```

**登录流程：**
1. 卖家用手机号 + 验证码登录（复用 SMS 验证逻辑）
2. 验证成功后查询 `CompanyStaff`（userId + status=ACTIVE）
3. 如果用户关联多家企业，返回企业列表让卖家选择
4. 选择企业后签发 seller JWT（含 companyId）

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/seller/auth/sms/code` | POST | 发送验证码 | 无 |
| `/seller/auth/login` | POST | 手机号 + 验证码登录 | 无 |
| `/seller/auth/select-company` | POST | 多企业用户选择企业 | 临时 Token |
| `/seller/auth/refresh` | POST | 刷新 Token | Refresh Token |
| `/seller/auth/logout` | POST | 登出 | Seller JWT |
| `/seller/auth/me` | GET | 当前卖家信息 | Seller JWT |

### 3.2 商品管理模块

卖家只能操作 `companyId = 自己企业` 的商品。新建商品默认 `auditStatus = PENDING`，需管理员审核通过后买家可见。

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/products` | GET | 我的商品列表（分页、状态筛选） | OWNER / MANAGER / OPERATOR |
| `/seller/products/:id` | GET | 商品详情 | OWNER / MANAGER / OPERATOR |
| `/seller/products` | POST | 创建商品（含 SKU、媒体）| OWNER / MANAGER |
| `/seller/products/draft` | POST | 创建草稿（仅标题必填，上限 5 份/商户）| OWNER / MANAGER |
| `/seller/products/:id/draft` | PUT | 更新草稿 | OWNER / MANAGER |
| `/seller/products/:id/submit` | POST | 草稿提交审核（DRAFT → INACTIVE+PENDING，跑全量校验）| OWNER / MANAGER |
| `/seller/products/:id` | PUT | 编辑商品（非草稿） | OWNER / MANAGER |
| `/seller/products/:id/status` | POST | 上架/下架（已审核通过的非草稿商品） | OWNER / MANAGER |
| `/seller/products/:id/media` | POST | 上传商品图片/视频 | OWNER / MANAGER / OPERATOR |
| `/seller/products/:id/skus` | PUT | 管理 SKU（规格/库存/价格） | OWNER / MANAGER |

**商品状态流转：**
```
卖家保存草稿 → DRAFT（可反复保存，30 秒 debounce 自动存）
    ↓ 卖家点"提交审核"（后端重跑 CreateProductDto 校验）
INACTIVE + auditStatus=PENDING（进入管理员审核队列）
    ↓
管理员审核通过 → auditStatus=APPROVED
    ↓
卖家上架 → ACTIVE（买家可见）
卖家下架 → INACTIVE（买家不可见）
    ↓
卖家重新编辑 → auditStatus=PENDING（需重新审核；不回退到 DRAFT）
```

**DRAFT 状态隔离约束：**
- 卖家默认商品列表排除 DRAFT（仅"草稿"tab 显式请求）
- 管理端审核列表排除 DRAFT（草稿不进审核队列）
- 买家查询天然排除（已有 `status='ACTIVE'` 过滤）
- 每商户草稿上限 5 份，超过返回 409；保存最低门槛：标题必填
- 管理端商品列表默认排除 DRAFT；`/admin/products/stats` 的 groupBy 仍按 status 分组（DRAFT 单独出现在统计里，便于运营观察草稿活跃度）

**创建商品 DTO：**
```typescript
class CreateProductDto {
  title: string;           // 商品标题
  subtitle?: string;       // 副标题
  description?: string;    // 详情描述
  basePrice: number;       // 基准价（元）
  categoryId: string;      // 分类 ID
  origin?: string;         // 产地
  tags?: string[];         // 标签

  skus: CreateSkuDto[];    // SKU 列表（至少1个）
  mediaUrls?: string[];    // 已上传的媒体 URL
}

class CreateSkuDto {
  specName: string;        // 规格名（如 "5斤装"）
  price: number;           // SKU 价格
  cost?: number;           // 成本价（用于利润分配）
  stock: number;           // 库存
  weight?: number;         // 重量(kg)
}
```

### 3.3 订单管理模块

卖家只能查看包含自家商品的订单。通过 `OrderItem → Product.companyId` 关联。

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/orders` | GET | 我的订单列表（分页、状态筛选） | OWNER / MANAGER / OPERATOR |
| `/seller/orders/:id` | GET | 订单详情 | OWNER / MANAGER / OPERATOR |
| `/seller/orders/:id/ship` | POST | 发货（填写快递信息） | OWNER / MANAGER / OPERATOR |
| `/seller/orders/batch-ship` | POST | 批量发货 | OWNER / MANAGER |
| `/seller/orders/:id/memo` | PUT | 添加卖家备注 | OWNER / MANAGER / OPERATOR |

**发货 DTO：**
```typescript
class SellerShipDto {
  carrierCode: string;     // 快递公司编码（如 SF / YTO / ZTO）
  carrierName: string;     // 快递公司名称
  trackingNo: string;      // 快递单号
}
```

**订单查询逻辑：**
```sql
-- 卖家只能看到包含自家商品的订单
SELECT o.* FROM "Order" o
JOIN "OrderItem" oi ON oi."orderId" = o.id
JOIN "Product" p ON p.id = oi."productId"
WHERE p."companyId" = :sellerCompanyId
```

### 3.4 售后处理模块

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/refunds` | GET | 退款申请列表 | OWNER / MANAGER / OPERATOR |
| `/seller/refunds/:id` | GET | 退款详情 | OWNER / MANAGER / OPERATOR |
| `/seller/refunds/:id/approve` | POST | 同意退款 | OWNER / MANAGER |
| `/seller/refunds/:id/reject` | POST | 拒绝退款（附理由） | OWNER / MANAGER |

**售后流程：**
```
买家申请退款 → refundStatus=PENDING
    ↓
卖家同意 → refundStatus=APPROVED → 系统退款
卖家拒绝 → refundStatus=REJECTED → 买家可申诉
    ↓
买家申诉 → 管理员仲裁
```

### 3.5 数据看板模块

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/analytics/overview` | GET | 概览数据（今日/本月/总计） | OWNER / MANAGER |
| `/seller/analytics/sales` | GET | 销售趋势（按天/周/月） | OWNER / MANAGER |
| `/seller/analytics/products` | GET | 商品排行（销量/销售额） | OWNER / MANAGER |
| `/seller/analytics/orders` | GET | 订单统计（状态分布） | OWNER / MANAGER |

**概览数据结构：**
```typescript
interface SellerOverview {
  today: {
    orderCount: number;
    revenue: number;
    pendingShipCount: number;    // 待发货
    pendingRefundCount: number;  // 待处理售后
  };
  month: {
    orderCount: number;
    revenue: number;
    refundRate: number;          // 退款率
  };
  total: {
    productCount: number;
    totalRevenue: number;
  };
}
```

### 3.6 企业资料模块

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/company` | GET | 企业信息 | OWNER / MANAGER / OPERATOR |
| `/seller/company` | PUT | 更新企业信息 | OWNER / MANAGER |
| `/seller/company/documents` | GET | 资质文件列表 | OWNER / MANAGER |
| `/seller/company/documents` | POST | 上传资质文件 | OWNER |
| `/seller/company/staff` | GET | 员工列表 | OWNER / MANAGER |
| `/seller/company/staff` | POST | 邀请员工 | OWNER / MANAGER |
| `/seller/company/staff/:id` | PUT | 修改员工角色/状态 | OWNER |
| `/seller/company/staff/:id` | DELETE | 移除员工 | OWNER |

### 3.7 物流管理模块

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/seller/shipments` | GET | 物流列表 | OWNER / MANAGER / OPERATOR |
| `/seller/shipments/:id` | GET | 物流详情（含轨迹） | OWNER / MANAGER / OPERATOR |
| `/seller/shipments/:id/tracking` | GET | 实时查询物流轨迹 | OWNER / MANAGER / OPERATOR |

---

## 4. 后端模块结构

```
backend/src/modules/seller/
├── seller.module.ts              # 卖家模块入口
├── auth/
│   ├── seller-auth.module.ts
│   ├── seller-auth.controller.ts  # 登录/登出/刷新
│   ├── seller-auth.service.ts     # 认证逻辑
│   ├── seller-jwt.strategy.ts     # Passport JWT 策略
│   ├── seller-auth.guard.ts       # Guard
│   └── seller-auth.dto.ts         # 登录 DTO
├── products/
│   ├── seller-products.module.ts
│   ├── seller-products.controller.ts
│   ├── seller-products.service.ts
│   └── seller-products.dto.ts
├── orders/
│   ├── seller-orders.module.ts
│   ├── seller-orders.controller.ts
│   ├── seller-orders.service.ts
│   └── seller-orders.dto.ts
├── refunds/
│   ├── seller-refunds.module.ts
│   ├── seller-refunds.controller.ts
│   ├── seller-refunds.service.ts
│   └── seller-refunds.dto.ts
├── analytics/
│   ├── seller-analytics.module.ts
│   ├── seller-analytics.controller.ts
│   └── seller-analytics.service.ts
├── company/
│   ├── seller-company.module.ts
│   ├── seller-company.controller.ts
│   ├── seller-company.service.ts
│   └── seller-company.dto.ts
├── shipments/
│   ├── seller-shipments.module.ts
│   ├── seller-shipments.controller.ts
│   └── seller-shipments.service.ts
└── common/
    ├── decorators/
    │   └── current-seller.decorator.ts  # @CurrentSeller()
    └── guards/
        └── seller-role.guard.ts         # 角色权限检查
```

---

## 5. 卖家前端设计

### 5.1 技术栈

复用管理后台技术栈，独立项目：

```
seller/                           # 卖家前端（独立 Vite 项目）
├── src/
│   ├── pages/                    # 页面
│   ├── components/               # 共享组件
│   ├── api/                      # API 客户端（axios + seller JWT）
│   ├── store/                    # Zustand 状态
│   ├── hooks/                    # React Hooks
│   ├── types/                    # TypeScript 类型
│   └── layouts/                  # 布局（ProLayout）
├── package.json
├── vite.config.ts
└── tsconfig.json
```

**技术选型：**
- Vite + React 18 + TypeScript
- Ant Design 5 + @ant-design/pro-components（ProLayout / ProTable / ProForm）
- @tanstack/react-query
- @ant-design/charts（数据图表）
- Zustand（认证状态管理）
- react-router-dom v6

### 5.2 页面清单

| 页面 | 路由 | 组件 | 说明 |
|------|------|------|------|
| **登录** | `/login` | LoginPage | 手机号 + 验证码登录 |
| **选择企业** | `/select-company` | SelectCompanyPage | 多企业用户选择 |
| **工作台** | `/` | DashboardPage | 今日概览 + 待办事项 + 快捷入口 |
| **商品列表** | `/products` | ProductListPage | ProTable 列表 + 筛选 + 批量操作 |
| **商品编辑** | `/products/:id/edit` | ProductEditPage | ProForm 表单 + SKU 管理 + 图片上传 |
| **商品创建** | `/products/create` | ProductCreatePage | 同编辑页，空表单 |
| **订单列表** | `/orders` | OrderListPage | ProTable + 状态 Tab + 批量发货 |
| **订单详情** | `/orders/:id` | OrderDetailPage | 订单信息 + 物流 + 操作按钮 |
| **售后列表** | `/refunds` | RefundListPage | 退款申请列表 + 处理 |
| **数据报表** | `/analytics` | AnalyticsPage | 图表：销售趋势 + 商品排行 + 订单分布 |
| **企业设置** | `/company` | CompanySettingsPage | 企业资料 + 资质管理 |
| **员工管理** | `/company/staff` | StaffManagementPage | 邀请/移除/角色管理 |

### 5.3 页面线框图

#### 工作台（Dashboard）

```
┌──────────────────────────────────────────────┐
│  🌾 爱买买卖家中心          [企业名] [头像] ▼  │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │今日单│ │今日额│ │待发货│ │待售后│        │
│  │  12  │ │¥3,680│ │  5   │ │  2   │        │
│  └──────┘ └──────┘ └──────┘ └──────┘        │
│                                              │
│  ── 待处理 ──────────────────────────────    │
│  ┌──────────────────────────────────────┐    │
│  │ 📦 订单 #ORD2026... 待发货  [去发货] │    │
│  │ 📦 订单 #ORD2026... 待发货  [去发货] │    │
│  │ ↩️ 退款 #REF2026... 待处理  [去处理] │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ── 本月销售趋势 ───────────────────────     │
│  ┌──────────────────────────────────────┐    │
│  │     📈 折线图（日销售额）              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

#### 商品编辑页

```
┌──────────────────────────────────────────────┐
│  ← 返回商品列表    编辑商品                   │
├──────────────────────────────────────────────┤
│                                              │
│  基本信息                                    │
│  ┌──────────────────────────────────────┐    │
│  │ 商品标题    [有机五常大米 2026新米... ] │    │
│  │ 副标题      [东北黑土地直发...       ] │    │
│  │ 分类        [粮油 ▼                  ] │    │
│  │ 产地        [黑龙江五常              ] │    │
│  │ 描述        [多行文本框...           ] │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  商品图片（最多9张）                          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐               │
│  │ 📷 │ │ 📷 │ │ 📷 │ │ +  │               │
│  └────┘ └────┘ └────┘ └────┘               │
│                                              │
│  SKU 规格                                    │
│  ┌──────────────────────────────────────┐    │
│  │ 规格名 │ 价格  │ 成本  │ 库存 │ 操作 │    │
│  │ 5斤装  │ 49.9  │ 25.0  │ 200  │ [删] │    │
│  │ 10斤装 │ 89.9  │ 45.0  │ 150  │ [删] │    │
│  │        [+ 添加规格]                   │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  标签：[有机] [新米] [东北] [+ 添加]         │
│                                              │
│  ┌──────────┐  ┌──────────┐                 │
│  │  保存草稿  │  │ 提交审核  │                │
│  └──────────┘  └──────────┘                 │
└──────────────────────────────────────────────┘
```

#### 订单详情页

```
┌──────────────────────────────────────────────┐
│  ← 返回订单列表    订单详情                   │
├──────────────────────────────────────────────┤
│                                              │
│  订单状态：待发货                    [发货]   │
│  订单号：ORD20260220...                      │
│  下单时间：2026-02-20 14:30                  │
│                                              │
│  ── 收货信息 ────────────────────────────    │
│  张三 138****1234                            │
│  浙江省杭州市西湖区xxx路xxx号                  │
│                                              │
│  ── 商品清单 ────────────────────────────    │
│  ┌──────────────────────────────────────┐    │
│  │ [📷] 有机五常大米 5斤装  ×2   ¥99.80 │    │
│  │ [📷] 土蜂蜜 500g         ×1   ¥68.00 │    │
│  └──────────────────────────────────────┘    │
│  商品合计：¥167.80   运费：¥0   实付：¥167.80│
│                                              │
│  ── 发货信息 ────────────────────────────    │
│  快递公司  [顺丰速运 ▼]                      │
│  快递单号  [                        ]        │
│                     [确认发货]                │
│                                              │
│  ── 卖家备注 ────────────────────────────    │
│  [添加备注...]                               │
└──────────────────────────────────────────────┘
```

---

## 6. 关键业务流程

### 6.1 企业入驻流程

```
1. 用户（已注册买家）→ 提交入驻申请（企业名/资质/联系方式）
   → 创建 Company(status=PENDING) + CompanyStaff(role=OWNER)

2. 管理员审核 → Company.status = ACTIVE / SUSPENDED

3. 企业主登录卖家后台 → 开始运营
```

注：v1.0 暂不实现自助入驻申请页面，由管理员后台手动创建企业并绑定 OWNER。

### 6.2 商品上架流程

```
卖家创建商品
    │ POST /seller/products
    │ → Product(status=INACTIVE, auditStatus=PENDING)
    ▼
管理员审核
    │ POST /admin/products/:id/audit
    │ → auditStatus = APPROVED / REJECTED
    ▼
卖家上架
    │ POST /seller/products/:id/status {status: 'ACTIVE'}
    │ → status = ACTIVE（买家 App 可见）
    ▼
卖家下架（随时）
    │ POST /seller/products/:id/status {status: 'INACTIVE'}
    │ → 买家 App 不可见
    ▼
卖家编辑已上架商品
    │ PUT /seller/products/:id
    │ → auditStatus 重置为 PENDING（需重新审核）
    │ → 编辑期间商品仍可见（显示旧版本）
```

### 6.3 订单发货流程

```
买家下单
    │ POST /api/v1/orders
    │ → Order(status=PENDING_PAYMENT)
    ▼
买家支付
    │ → Order(status=PAID)
    │ → 卖家后台「待发货」+1
    ▼
卖家发货
    │ POST /seller/orders/:id/ship
    │ body: { carrierCode, carrierName, trackingNo }
    │ → 创建 Shipment
    │ → Order(status=SHIPPED)
    │ → 设置 autoReceiveAt（7天后自动确认收货）
    ▼
物流更新（webhook 回调 / 主动查询）
    │ → ShipmentTrackingEvent 记录轨迹
    │ → Shipment(status=DELIVERED)
    │ → Order(status=DELIVERED)
    ▼
买家确认收货 / 自动确认
    │ → Order(status=RECEIVED)
    │ → 触发分润奖励引擎
```

### 6.4 售后处理流程

```
买家申请退款
    │ POST /api/v1/orders/:id/after-sale
    │ → Refund(status=PENDING)
    │ → 卖家后台「待售后」+1
    ▼
卖家处理
    ├── 同意 → POST /seller/refunds/:id/approve
    │         → Refund(status=APPROVED) → 系统退款 → 库存恢复
    │
    └── 拒绝 → POST /seller/refunds/:id/reject
              → Refund(status=REJECTED)
              → 买家可向平台申诉
                  ▼
              管理员仲裁
              → 强制退款 或 驳回申诉
```

---

## 7. 实施计划

### 阶段 6.1：数据模型 + 后端认证（基础）

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 1 | 新增 CompanyStaff / SellerSession 模型 + 枚举 | `prisma/schema.prisma` |
| 2 | 迁移数据库 | `npx prisma migrate dev` |
| 3 | 种子数据：为现有 Company 创建 OWNER | `prisma/seed.ts` |
| 4 | 创建 seller 模块骨架 | `backend/src/modules/seller/` |
| 5 | 实现 seller-jwt 策略 + Guard | `seller-jwt.strategy.ts` + `seller-auth.guard.ts` |
| 6 | 实现卖家登录/登出/刷新 | `seller-auth.controller.ts` + `seller-auth.service.ts` |
| 7 | 实现 @CurrentSeller() 装饰器 | `current-seller.decorator.ts` |

### 阶段 6.2：核心业务 API

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 8 | 商品管理 CRUD | `seller-products.controller/service/dto.ts` |
| 9 | 订单查询 + 发货 | `seller-orders.controller/service/dto.ts` |
| 10 | 售后处理 | `seller-refunds.controller/service/dto.ts` |
| 11 | 物流查询 | `seller-shipments.controller/service.ts` |
| 12 | 企业资料管理 | `seller-company.controller/service/dto.ts` |
| 13 | 员工管理（邀请/移除/角色） | `seller-company.controller/service.ts` |

### 阶段 6.3：数据看板 API

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 14 | 概览统计 API | `seller-analytics.service.ts` |
| 15 | 销售趋势 API | `seller-analytics.service.ts` |
| 16 | 商品排行 API | `seller-analytics.service.ts` |

### 阶段 6.4：卖家前端

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 17 | 初始化项目（Vite + React + Ant Design + ProLayout） | `seller/` |
| 18 | API 客户端 + 认证状态管理 | `seller/src/api/` + `seller/src/store/` |
| 19 | 登录页 + 选择企业页 | `seller/src/pages/login/` |
| 20 | 工作台页 | `seller/src/pages/dashboard/` |
| 21 | 商品管理页（列表 + 编辑/创建） | `seller/src/pages/products/` |
| 22 | 订单管理页（列表 + 详情 + 发货） | `seller/src/pages/orders/` |
| 23 | 售后处理页 | `seller/src/pages/refunds/` |
| 24 | 数据报表页 | `seller/src/pages/analytics/` |
| 25 | 企业设置 + 员工管理页 | `seller/src/pages/company/` |

### 阶段 6.5：管理端联动改造

| 步骤 | 内容 | 说明 |
|------|------|------|
| 26 | 管理端商品审核流程适配 | 卖家提交的商品进入审核队列 |
| 27 | 管理端企业入驻绑定 OWNER | 创建企业时同时绑定企业主用户 |
| 28 | 管理端售后仲裁功能 | 买家申诉后管理员介入 |

### 阶段 6.6：验证

| 验证项 | 说明 |
|--------|------|
| `npx prisma validate` | Schema 合法 |
| `npx tsc --noEmit` (backend) | 后端编译零错误 |
| `npx tsc --noEmit` (seller) | 前端编译零错误 |
| 端到端流程 | 卖家登录 → 创建商品 → 管理员审核 → 卖家上架 → 买家下单 → 卖家发货 |
| 权限隔离 | 卖家 A 看不到卖家 B 的商品/订单 |
| 角色权限 | OPERATOR 不能管理员工，MANAGER 不能移除 OWNER |

---

## 8. 安全考量

| 安全项 | 措施 |
|--------|------|
| **数据隔离** | 所有查询强制 `WHERE companyId = currentSeller.companyId`，Service 层统一校验 |
| **认证隔离** | 独立 `SELLER_JWT_SECRET`，seller JWT 不能访问 admin/buyer 端点 |
| **角色权限** | `SellerRoleGuard` 在 Controller 层校验 `CompanyStaffRole` |
| **操作审计** | 关键写操作记录日志（商品创建/编辑、发货、售后处理） |
| **频率限制** | 复用 ThrottlerModule，卖家端独立限流配置 |
| **文件上传** | 复用已有 UploadModule（类型白名单 + 大小限制） |

---

## 9. 与现有功能的集成点

| 现有功能 | 集成方式 |
|---------|---------|
| **分润奖励引擎** | 不改动 — 卖家发货 → 买家确认收货 → 自动触发分润，与卖家无关 |
| **文件上传** | 卖家商品图片复用 `UploadModule` |
| **订单生命周期** | 卖家发货复用 admin 的 `ship()` 逻辑，加 companyId 权限过滤 |
| **物流 Webhook** | 已有 `POST /shipments/callback` 公开端点，不需要改动 |
| **支付流程** | 卖家不参与支付，只关注「已付款」后的订单 |
| **买家 App** | 无改动 — 买家看到的商品/订单/物流接口不变 |
