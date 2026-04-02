# 发票申请功能 — 需求、预期结果与实现计划

> **文档状态**：Phase 1-4 全部完成 ✅（代码审查已通过，CRITICAL/HIGH 问题已修复）
> **创建日期**：2026-03-12
> **权威范围**：发票功能的需求定义、技术方案、实施步骤

---

## 一、需求概述

### 1.1 背景

平台用户（买家）在完成订单后，可能需要申请电子发票用于报销或记账。当前数据库 Schema 已预定义 `InvoiceProfile`（发票抬头模板）和 `Invoice`（发票记录）两个模型，但代码层（后端 Service/Controller、前端页面/Repo）完全空白，需要从零实现完整功能。

### 1.2 核心需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| R1 | 买家可管理多个发票抬头（个人/企业），支持增删改查 | P0 |
| R2 | 买家可对已收货订单申请开票，选择已有抬头或新建 | P0 |
| R3 | 管理员可查看待开票列表，执行开票（录入发票号+PDF）或标记失败 | P0 |
| R4 | 买家可查看发票列表、下载已开具的电子发票 PDF | P0 |
| R5 | 买家可取消处于「已申请」状态的发票请求 | P1 |
| R6 | 卖家在订单详情中可看到发票状态（只读） | P2 |
| R7 | 管理端发票统计（各状态数量汇总） | P2 |

### 1.3 业务规则

1. **申请条件**：仅订单状态为 `RECEIVED`（已确认收货）时可申请发票
2. **一单一票**：每个订单最多申请一张发票（Schema 已约束 `orderId @unique`）
3. **抬头快照**：申请时将选中的 InvoiceProfile 完整快照到 Invoice.profileSnapshot，后续修改抬头不影响已申请发票
4. **企业发票必填税号**：type=COMPANY 时 taxNo 为必填
5. **状态流转**：
   ```
   REQUESTED（已申请）
     ├── → ISSUED（已开票）     管理员操作，需录入 invoiceNo + pdfUrl
     ├── → FAILED（开票失败）   管理员操作，需填写失败原因
     └── → CANCELED（已取消）   买家操作，仅 REQUESTED 状态可取消
   ```
6. **隐私隔离**：卖家不可访问买家发票详细信息（税号、开户行等）

---

## 二、现有 Schema 基础

以下模型已在 `backend/prisma/schema.prisma` 中定义，**无需修改 Schema**：

### InvoiceProfile（发票抬头模板）

```prisma
model InvoiceProfile {
  id        String      @id @default(cuid())
  userId    String
  user      User        @relation(fields: [userId], references: [id])
  type      InvoiceType // PERSONAL | COMPANY
  title     String      // 发票抬头（个人姓名或企业名称）
  taxNo     String?     // 企业税号（企业发票必填）
  email     String?     // 接收邮箱
  phone     String?     // 联系电话
  bankInfo  Json?       // 开户行信息（企业专用）
  address   String?     // 注册地址（企业专用）
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  @@index([userId])
}
```

### Invoice（发票记录）

```prisma
model Invoice {
  id              String        @id @default(cuid())
  orderId         String        @unique
  order           Order         @relation(fields: [orderId], references: [id])
  profileSnapshot Json          // 申请时的抬头快照
  status          InvoiceStatus @default(REQUESTED)
  invoiceNo       String?       // 发票号码（开票后填入）
  pdfUrl          String?       // 电子发票 PDF 地址
  issuedAt        DateTime?     // 开票时间
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@index([status])
}
```

### 枚举

```prisma
enum InvoiceType   { PERSONAL  COMPANY }
enum InvoiceStatus { REQUESTED  ISSUED  FAILED  CANCELED }
```

### Order 关联

Order 模型已有 `invoice Invoice?` 字段，1:1 可选关联。

---

## 三、最终实现的预期结果

### 3.1 买家 App

#### 发票抬头管理页（`app/invoices/profiles.tsx`）
- 列表展示用户所有发票抬头，区分个人/企业标签
- 支持新建、编辑、删除抬头
- 企业抬头显示企业名称 + 税号，个人抬头显示姓名
- 空态引导用户创建第一个抬头

#### 新建/编辑抬头页（`app/invoices/profiles/edit.tsx`）
- 切换个人/企业类型
- 个人：抬头名称（必填）、邮箱、手机号
- 企业：企业名称（必填）、税号（必填）、邮箱、手机号、开户行信息、注册地址
- 表单校验（税号格式、邮箱格式等）

#### 申请开票流程（从订单详情触发）
- 订单详情页（`app/orders/[id].tsx`）增加「申请发票」按钮（仅 RECEIVED 状态显示）
- 点击后进入申请页面/弹窗：选择已有抬头 或 新建抬头 → 确认提交
- 已申请的订单显示发票状态标签（已申请/已开票/失败/已取消）
- 已开票的订单可点击查看/下载 PDF

#### 我的发票列表页（`app/invoices/index.tsx`）
- 列表展示所有发票记录，按时间倒序
- 每条显示：订单编号（截断）、发票抬头、金额、状态标签
- 点击进入发票详情（含 PDF 下载按钮，仅 ISSUED 状态）
- REQUESTED 状态显示「取消申请」按钮
- 个人中心增加「我的发票」入口

### 3.2 管理后台

#### 发票管理列表页（`admin/src/pages/invoices/index.tsx`）
- ProTable 展示所有发票申请，支持筛选：
  - 状态筛选（全部/已申请/已开票/失败/已取消）
  - 日期范围
  - 关键字搜索（订单号、发票抬头）
- 列字段：发票ID、订单号、买家、抬头类型、抬头名称、金额、状态、申请时间、操作
- 页头统计卡片：待开票数、已开票数、失败数

#### 发票详情/操作页（`admin/src/pages/invoices/detail.tsx`）
- 展示完整发票信息：抬头快照、关联订单摘要、状态时间线
- REQUESTED 状态时显示两个操作按钮：
  - 「开票」→ 弹窗输入发票号码 + 上传/填入 PDF 地址 → 确认后状态变为 ISSUED
  - 「开票失败」→ 弹窗输入失败原因 → 确认后状态变为 FAILED

### 3.3 卖家后台

- 订单详情页（`seller/src/pages/orders/detail.tsx`）增加发票状态显示（只读）
- 仅显示：是否已申请发票 + 当前状态，**不展示**抬头详细信息（隐私保护）

### 3.4 后端 API

完整的 RESTful API 覆盖买家端和管理端所有操作（详见第四章接口列表）。

---

## 四、实现计划

### Phase 1：后端核心模块（后端）

**目标**：完成发票 Service + 买家端/管理端 Controller + DTO

#### 1.1 创建模块结构

```
backend/src/modules/invoice/
├── invoice.module.ts
├── invoice.service.ts
├── invoice.controller.ts          # 买家端
├── admin-invoice.controller.ts    # 管理端
└── dto/
    ├── create-invoice-profile.dto.ts
    ├── update-invoice-profile.dto.ts
    ├── request-invoice.dto.ts
    ├── issue-invoice.dto.ts
    └── fail-invoice.dto.ts
```

#### 1.2 DTO 定义

**CreateInvoiceProfileDto：**
- `type`: InvoiceType（必填）
- `title`: string（必填，2-100 字符）
- `taxNo`: string（企业必填，15-20 位统一社会信用代码）
- `email`: string（选填，邮箱格式）
- `phone`: string（选填，手机号格式）
- `bankInfo`: object（选填，`{bankName, accountNo}`）
- `address`: string（选填）

**UpdateInvoiceProfileDto：**
- 同 Create，所有字段可选（PartialType）

**RequestInvoiceDto：**
- `orderId`: string（必填）
- `profileId`: string（必填，已有抬头 ID）

**IssueInvoiceDto：**
- `invoiceNo`: string（必填，发票号码）
- `pdfUrl`: string（必填，PDF 地址）

**FailInvoiceDto：**
- `reason`: string（必填，失败原因）

#### 1.3 Service 方法

| 方法 | 说明 | 安全要点 |
|------|------|----------|
| `createProfile(userId, dto)` | 创建发票抬头，bankInfo 加密存储 | userId 绑定 |
| `updateProfile(userId, profileId, dto)` | 修改抬头，校验归属 | 所属校验 |
| `deleteProfile(userId, profileId)` | 删除抬头，校验归属 | 所属校验 |
| `getProfiles(userId)` | 获取用户所有抬头 | userId 过滤 |
| `requestInvoice(userId, dto)` | 申请开票：校验订单状态+归属、检查重复、快照抬头 | 订单归属+状态校验 |
| `cancelInvoice(userId, invoiceId)` | 取消申请：仅 REQUESTED 可取消 | 归属+状态校验 |
| `getUserInvoices(userId, pagination)` | 用户发票列表（分页） | userId 过滤 |
| `getInvoiceDetail(userId, invoiceId)` | 发票详情 | 归属校验 |
| `adminListInvoices(filters, pagination)` | 管理端发票列表（含筛选） | AdminAuthGuard |
| `adminGetDetail(invoiceId)` | 管理端发票详情 | AdminAuthGuard |
| `adminIssueInvoice(invoiceId, dto)` | 开票：更新 status/invoiceNo/pdfUrl/issuedAt | @AuditLog() |
| `adminFailInvoice(invoiceId, dto)` | 标记失败 | @AuditLog() |
| `adminGetStats()` | 各状态数量统计 | AdminAuthGuard |

#### 1.4 Controller 路由

**买家端 `InvoiceController`（需登录）：**

```
GET    /api/v1/invoices/profiles         → getProfiles()
POST   /api/v1/invoices/profiles         → createProfile()
PATCH  /api/v1/invoices/profiles/:id     → updateProfile()
DELETE /api/v1/invoices/profiles/:id     → deleteProfile()
POST   /api/v1/invoices                  → requestInvoice()
GET    /api/v1/invoices                  → getUserInvoices()
GET    /api/v1/invoices/:id              → getInvoiceDetail()
POST   /api/v1/invoices/:id/cancel       → cancelInvoice()
```

**管理端 `AdminInvoiceController`（@Public + AdminAuthGuard + PermissionGuard）：**

```
GET    /api/v1/admin/invoices            → adminListInvoices()
GET    /api/v1/admin/invoices/stats      → adminGetStats()
GET    /api/v1/admin/invoices/:id        → adminGetDetail()
POST   /api/v1/admin/invoices/:id/issue  → adminIssueInvoice()
POST   /api/v1/admin/invoices/:id/fail   → adminFailInvoice()
```

#### 1.5 安全要求

- `bankInfo` 使用 `encryptJsonValue()` 加密存储，读取时解密
- 所有买家端接口校验 `userId` 归属
- 管理端写操作使用 `@AuditLog()` 装饰器
- 管理端接口使用 `@UseGuards(AdminAuthGuard, PermissionGuard)`
- 需在种子数据中添加发票相关权限（`invoice:list`, `invoice:issue`, `invoice:fail`）

---

### Phase 2：买家 App 前端

**目标**：实现发票类型、Repo、页面和订单详情集成

#### 2.1 类型定义（`src/types/domain/Invoice.ts`）

```typescript
// InvoiceType, InvoiceStatus 枚举
// InvoiceProfile 接口（id, type, title, taxNo, email, phone, bankInfo, address）
// Invoice 接口（id, orderId, profileSnapshot, status, invoiceNo, pdfUrl, issuedAt, createdAt）
// CreateInvoiceProfileParams, RequestInvoiceParams 等请求参数类型
```

#### 2.2 Repository（`src/repos/InvoiceRepo.ts`）

遵循项目 Repository 模式，所有方法返回 `Result<T>`：
- `getProfiles()` / `createProfile()` / `updateProfile()` / `deleteProfile()`
- `requestInvoice()` / `cancelInvoice()`
- `getInvoices()` / `getInvoiceDetail()`

#### 2.3 页面实现

| 页面 | 路径 | 核心组件 |
|------|------|----------|
| 我的发票列表 | `app/invoices/index.tsx` | `<Screen>` + FlatList + 三态（Skeleton/Empty/Error） |
| 发票抬头管理 | `app/invoices/profiles.tsx` | `<Screen>` + FlatList + 删除确认 |
| 新建/编辑抬头 | `app/invoices/profiles/edit.tsx` | `<Screen>` + react-hook-form + zod 校验 |

#### 2.4 集成改动

- **订单详情页** `app/orders/[id].tsx`：
  - 增加发票区块：未申请时显示「申请发票」按钮（仅 RECEIVED），已申请显示状态
  - ISSUED 状态显示「查看发票」按钮（跳转详情/打开 PDF）
- **个人中心**：增加「我的发票」入口跳转 `app/invoices/`

---

### Phase 3：管理后台前端

**目标**：实现管理端发票列表、详情和操作页面

#### 3.1 API 客户端（`admin/src/api/invoices.ts`）

- `getInvoices(params)` / `getInvoiceDetail(id)` / `getInvoiceStats()`
- `issueInvoice(id, data)` / `failInvoice(id, data)`

#### 3.2 页面实现

| 页面 | 路径 | 核心组件 |
|------|------|----------|
| 发票列表 | `admin/src/pages/invoices/index.tsx` | ProTable + 状态筛选 + 统计卡片 |
| 发票详情 | `admin/src/pages/invoices/detail.tsx` | 抬头信息 + 订单摘要 + 开票/失败操作弹窗 |

#### 3.3 集成改动

- 侧边栏菜单增加「发票管理」入口
- 路由配置增加 `/invoices` 和 `/invoices/:id`
- 权限种子数据增加发票相关权限

---

### Phase 4：卖家后台 + 收尾

**目标**：卖家端只读展示 + 文档更新 + 代码审查

#### 4.1 卖家端改动

- 卖家订单详情页（`seller/src/pages/orders/detail.tsx`）增加一行发票状态显示
- 后端卖家订单详情接口返回中附带 `invoiceStatus`（仅状态字段，不含抬头详情）

#### 4.2 种子数据

- 在 `backend/prisma/seed.ts` 中为管理员角色添加发票权限

#### 4.3 文档更新

- 更新 `CLAUDE.md` 相关文档列表（添加 invoice.md）
- 更新 `plan.md` 进度追踪
- 更新 `data-system.md`（如有字段变动）

#### 4.4 代码审查

- 后端：DTO 校验完整性、权限守卫、审计日志、加密存储
- 前端：类型与后端一致、三态实现、设计令牌使用
- 跨系统：枚举一致性、API 路径匹配

---

## 五、执行顺序与依赖关系

```
Phase 1（后端）
  ├── 1.1 模块骨架 + DTO
  ├── 1.2 Service 实现
  ├── 1.3 买家端 Controller
  ├── 1.4 管理端 Controller
  └── 1.5 种子数据（权限）
        ↓
Phase 2（买家 App）          Phase 3（管理后台）
  ├── 2.1 类型定义              ├── 3.1 API 客户端
  ├── 2.2 Repository            ├── 3.2 列表页
  ├── 2.3 页面实现              └── 3.3 详情/操作页
  └── 2.4 订单详情集成
        ↓                           ↓
              Phase 4（卖家端 + 收尾）
                ├── 4.1 卖家端只读展示
                ├── 4.2 种子数据
                ├── 4.3 文档更新
                └── 4.4 代码审查
```

Phase 2 和 Phase 3 可并行执行（无文件冲突）。

---

## 六、不做的事情（Scope 排除）

| 排除项 | 原因 |
|--------|------|
| 对接真实税务系统/开票接口 | 当前阶段为占位实现，与支付等模块保持一致 |
| 自动开票（无需管理员操作） | 初期手动审核更安全，后续可扩展 |
| 纸质发票邮寄 | 仅支持电子发票 |
| 发票红冲/重开 | 复杂度高，V2 再考虑 |
| 批量开票 | V2 功能 |
| 发票邮件推送 | 短信/邮件服务为占位实现，暂不集成 |
