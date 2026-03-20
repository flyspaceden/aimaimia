# 农脉 - 开发计划

> 项目状态：阶段一 ✅ / 阶段二 ✅ / 阶段三 ✅ / 阶段四 ✅ / 阶段五 买家 App UI ✅ / 阶段六 卖家系统 ✅ / 性能优化 ✅ / UI 增强 ✅ / 阶段七 普通用户分润奖励系统改造 ✅ / 全系统审查修复（9 轮）✅ / 阶段八 平台红包系统 ✅ / **当前：阶段九 第三方服务** / 阶段十 部署

## 系统架构

```
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│  React Native   │  │  卖家 Web 后台    │  │   管理后台 Web Dashboard   │
│  买家 App       │  │  Vite + React +   │  │  React + Vite + Ant Design │
│  (Expo) ✅      │  │  Ant Design       │  │  (admin/) ✅                │
│                 │  │  (seller/) 🆕     │  │                            │
└───────┬─────────┘  └───────┬──────────┘  └───────┬──────────────────┘
        │ HTTP               │ HTTP                 │ HTTP
        │ /api/v1/...        │ /api/v1/seller/...   │ /api/v1/admin/...
        ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────┐
│                 NestJS 后端（同一个服务）                       │
│  ├── 买家端 API（20 个模块） ✅                                │
│  ├── 管理端 API（11 个模块）✅                                  │
│  └── 卖家端 API（7 个模块）🆕                                  │
└───────────────────────┬──────────────────────────────────────┘
                        │ Prisma ORM
                        ▼
┌──────────────────────────────────────────────────────────────┐
│              PostgreSQL（60+ 表，39+ enum） ✅                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 阶段一：端到端联调 ✅

> **目标**：让买家 App 连上真实后端和数据库，跑通完整流程

### 1.1 环境搭建 ✅

| 步骤 | 操作 | 说明 |
|------|------|------|
| 安装 PostgreSQL | 下载 [Postgres.app](https://postgresapp.com/downloads.html)，拖入 Applications，点 Initialize | macOS 无需 Homebrew |
| 配置命令行 | `sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin \| sudo tee /etc/paths.d/postgresapp` | 可选，方便终端使用 psql |
| 创建数据库 | `CREATE USER nongmai WITH PASSWORD 'nongmai123'; CREATE DATABASE nongmai OWNER nongmai;` | 用 psql 执行 |
| 确认 .env | `DATABASE_URL="postgresql://nongmai:nongmai123@localhost:5432/nongmai"` | `backend/.env` |

### 1.2 后端启动 ✅

```bash
cd backend
npm install                    # 安装依赖
npx prisma generate           # 生成 Prisma Client
npx prisma migrate dev        # 应用迁移，创建 60+ 表
npx prisma db seed            # 填充种子数据
npm run start:dev             # 启动后端 → localhost:3000
```

### 1.3 API 烟雾测试 ✅

| 模块 | 端点 | 需认证 | 预期结果 | 状态 |
|------|------|--------|----------|------|
| Product | `GET /api/v1/products` | 否 | 6 个商品 | ✅ |
| Company | `GET /api/v1/companies` | 否 | 4 家企业 | ✅ |
| Auth | `POST /api/v1/auth/sms/code` | 否 | 验证码（Mock） | ✅ |
| Auth | `POST /api/v1/auth/login` (channel=phone, mode=code) | 否 | JWT Token | ✅ |
| User | `GET /api/v1/me` | 是 | 用户资料 | ✅ |
| Order | `GET /api/v1/orders` | 是 | 订单列表 | ✅ |
| Address | `GET /api/v1/addresses` | 是 | 地址列表 | ✅ |
| Cart | `GET /api/v1/cart` | 是 | 购物车 | ✅ |
| Trace | `GET /api/v1/trace/product/:id` | 否 | 溯源数据 | ✅ |
| Bonus | `GET /api/v1/bonus/member` | 是 | 会员信息 | ✅ |

### 1.4 前端联调 ✅

```bash
# 项目根目录 .env
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
```

逐页面验证（API 层已通过，前端 Repo → 后端 Controller 数据结构对齐）：

| 页面 | 验证点 | API 对齐 | 说明 |
|------|--------|----------|------|
| 首页 | 商品推荐从 API 加载 | ✅ | ProductRepo → GET /products（分页+nextPage） |
| 展览馆 | 企业列表显示 | ✅ | CompanyRepo → GET /companies（Company 类型完全一致） |
| 商品详情 | 详情 + SKU 信息 | ✅ | ProductRepo → GET /products/:id（含 images/skus/tags） |
| 登录流程 | 短信验证码 → 登录 → Token 存储 | ✅ | AuthRepo → POST /auth/sms/code + /auth/login（AuthSession 完全一致） |
| 我的 | 登录后资料正确 | ✅ | UserRepo/TaskRepo/CheckInRepo/InboxRepo/FollowRepo/OrderRepo 全部对齐 |
| 购物车 | 添加商品 → 服务端同步 | ✅ | CartRepo → GET/POST/PATCH/DELETE /cart（本地 Zustand + 可选服务端同步） |
| 结算 | 地址选择 → 提交订单 → 奖励抵扣 → 银行卡支付 | ✅ | AddressRepo + OrderRepo + BonusRepo → 支持奖励选择抵扣 + 银行卡/信用卡支付方式 |
| 订单 | 列表 + 详情正确 | ✅ | OrderRepo → GET /orders（含状态映射 pendingPay↔PENDING_PAYMENT） |
| 地址管理 | 增删改查 + 设默认 | ✅ | AddressRepo → 已修复字段映射（receiverName/province/city/district） |
| 钱包/VIP | 会员信息 + 余额 + VIP/普通分账户 + 冻结倒计时 | ✅ | BonusRepo → member/wallet/vip-tree/withdraw/normal-redpacks 全部对齐，奖励钱包双子账户卡片 + 奖励列表 Tab 切换 + 冻结奖励解锁条件与过期倒计时 |

备注：
- 16 个 Repo 已支持真实 API（USE_MOCK=false）
- 3 个 Repo 仅 Mock（AiAssistantRepo/AiFeatureRepo/RecommendRepo — AI 功能待接入）
- 首页不直接调用 API（纯 UI + AI 语音交互入口）
- 购物车采用前端 Zustand 维护，结算时提交后端

### 1.6 全面验证 ✅

二次验证（2026-02-15）：
- ✅ 后端 TypeScript 编译零错误
- ✅ 前端 TypeScript 编译零错误
- ✅ 23 个 API 端点全部通过（5 公开 + 2 认证 + 16 认证端点）
- ✅ 8 个写操作验证（地址 CRUD / 签到 / 关注切换 / 任务完成 / 订单创建+取消）
- ✅ 16 个 Repo 路径与字段全量对齐检查通过
- ✅ Explore Agent 独立审计确认零阻塞性问题

### 1.5 联调修复

已修复问题：
- ✅ **JWT Strategy bug**: `validate()` 返回 `{ userId }` 但 controller 用 `@CurrentUser('sub')` → 改为 `{ sub }`
- ✅ **异常过滤器无日志**: 非 HTTP 异常（Prisma 等）被静默吞掉 → 添加 `console.error`
- ✅ **plan.md 路径错误**: `/auth/sms/send` → `/auth/sms/code`，`/auth/sms/verify` → `/auth/login`，`/users/profile` → `/me`
- ✅ **OrderRepo 缺方法**: 补充 `confirmReceive` 和 `cancelOrder`
- ✅ **Prisma CREATEDB 权限**: nongmai 用户需要 CREATEDB 权限（shadow database）
- ✅ **前端 .env 创建**: 创建根目录 `.env` 关闭 Mock 模式
- ✅ **Address 字段映射**: `recipientName` → `receiverName`，`regionCode/regionText` → `province/city/district`
- ✅ **Address 返回值修复**: `setDefault()` 返回完整 Address，`remove()` 返回 void
- ✅ **Order addressId 传递**: checkout.tsx + OrderRepo.createFromCart 传递 addressId 到后端

### 1.7 全系统审计修复 ✅

> 2026-02-17 完成，详见 `tofix.md`

**批次一（数据层）**：种子数据 8 项修复 + CHECK(stock>=0) 约束 + 10 个缺失索引
**批次二（订单系统）**：并发超卖 CHECK 保护、支付幂等（事务内状态检查+P2002）、退款/取消库存恢复、物流回调 stub、未付款自动过期
**批次三（分润系统）**：退款回滚 selfPurchaseCount + NormalQueueMember 失效、提现 RewardLedger 全链路、空桶 rewardPool 归平台、unlockedLevel 更新、配置缓存失效
**批次四（安全）**：Booking review/invite 认证、Group 写操作管理员守卫、封禁用户 JWT 拦截、买家登出端点、签到重置环境检查
**Schema 变更**：RewardLedger.allocationId 改为可选（支持提现流水无 allocation）
- ✅ **User avatarFrame 兼容**: 后端 updateProfile 同时接受 avatarFrame 对象和 avatarFrameId 字符串
- ✅ **Trace OrderTrace 格式**: 后端返回 `batches[]` 数组（原先返回单个 `batch`）
- ✅ **Trace mapBatch 补全**: 补充 `productId/stage/status/verifiedAt` 字段对齐前端 TraceBatch 类型

### 1.8 二次全系统审计修复 ✅

> 2026-02-18 完成，详见 `tofix2.md`

**批次一（安全加固）**：RBAC 权限缓存失效时间、管理端密码 bcrypt 成本因子、AdminSession 索引优化
**批次二（关键 Bug）**：退款回滚 selfPurchaseCount 边界、提现金额与 balance 校验、VIP 购买幂等检查、审计日志 diff 字段修复
**批次三（性能优化）**：N+1 查询优化、分页守卫、缓存策略
**批次四（管理后台前端）**：ProTable 分页联动、权限组件完善、审计日志详情弹窗
**批次五（买家 App）**：401 Token 刷新重试、类型安全修复、expo-secure-store 令牌存储
**批次六（代码质量）**：AdminSession 软过期、退款回滚审计日志、confirmReceive/applyAfterSale 事务内并发防护、PLATFORM_USER_ID 常量提取、productSnapshot 补 companyId
**批次七（可视化新功能）**：VIP 分润树可视化页面 + 普通奖励滑动窗口可视化页面（后端 6 个 API + 前端 2 个完整页面 + 3 个组件）

### 1.9 三次全系统审计修复 ✅

> 2026-02-22 完成，详见 `tofix3.md`（73 项：阻断 16 + 重要 32 + 建议 25）

**批次一（16 项阻断级）**：前端 Mock 保护、后端 SMS/WeChat/Email Mock 环境变量控制、卖家端 API 基础设施（axios 拦截器/companyId 注入/token 刷新/错误处理）、前端 Auth 登录注册对齐后端 AuthIdentity 模型、seller 前后端路由修复、admin 权限守卫修复
**批次二（32 项重要级）**：买家 App 18 项（购物车空态/结算地址校验/订单详情完善/搜索防抖/AI 聊天多轮/钱包格式化/VIP 队列展示/设置页登录态/溯源时间轴/展览馆加载态）+ 卖家端 6 项（仪表盘数据联动/商品表单验证/订单状态流转/售后超时/企业员工 CRUD）+ 管理端 5 项（Dashboard 统计/商品审核/VIP 树搜索/配置版本/审计日志）+ 后端 3 项（订单事务隔离/提现并发/Prisma 连接池）
**批次三（25 项建议级）**：订单列表 replace 导航、登出跳首页、购物车快捷添加、热门搜索词、SKU 库存展示、聊天滚动优化、语音录音提示、卖家冻结企业标识、订单状态补全、下架商品重新提交、Token 过期检查、权限常量提取、提现用户名回退、配置金额验证、企业资质预览、VIP 树深度可调、面包屑导航、超级管理员常量、地图预览提示、订单幂等键、CORS 生产警告、金额精度统一

---

## 阶段二：管理后台（Web Dashboard）✅

> **目标**：构建企业级管理后台，独立管理员体系 + 可配置 RBAC 权限 + 完整审计日志与回滚

### 2.0 技术栈（已确认）

| 层 | 选型 | 说明 |
|---|------|------|
| 构建工具 | **Vite** | 快速开发 + 静态部署，管理后台无需 SSR |
| 框架 | **React 18 + TypeScript** | 与买家 App 统一语言栈 |
| 路由 | **react-router-dom v6** | SPA 路由 |
| UI 组件 | **Ant Design 5** | 中文管理后台事实标准，原生中文国际化 |
| 高级组件 | **@ant-design/pro-components** | ProTable / ProForm / ProLayout — 管理后台开箱即用 |
| 数据获取 | **@tanstack/react-query** | 与买家 App 一致的缓存/刷新模式 |
| 图表 | **@ant-design/charts** | Dashboard 统计图表 |
| 状态管理 | **Zustand** | Auth 状态管理 |
| 部署 | 静态文件（Nginx / 阿里云 OSS / Vercel） | 待定 |

选型理由：
- **React + Vite > Next.js**：管理后台是内部工具，不需要 SSR/SEO，Vite 更轻量
- **Ant Design > shadcn/ui**：ProTable/ProForm/ProLayout 直接覆盖管理后台 80% 的 UI 需求，无需从零搭建

### 2.1 数据库设计（7 个新模型 + 2 个新枚举）

修改文件：`backend/prisma/schema.prisma`

**新增枚举：**
- `AdminUserStatus`: ACTIVE, DISABLED
- `AuditAction`: CREATE, UPDATE, DELETE, STATUS_CHANGE, LOGIN, LOGOUT, APPROVE, REJECT, REFUND, SHIP, CONFIG_CHANGE, ROLLBACK

**新增模型：**

| 模型 | 用途 | 关键字段 |
|------|------|----------|
| **AdminUser** | 管理员账号 | username, passwordHash, status, loginFailCount, lockedUntil, lastLoginAt/Ip, createdByAdminId |
| **AdminRole** | 可配置角色 | name, description, isSystem（系统角色不可删除） |
| **AdminPermission** | 权限定义 | code（如 `orders:read`）, module, action, description |
| **AdminUserRole** | 用户-角色关联 | adminUserId, roleId（联合唯一） |
| **AdminRolePermission** | 角色-权限关联 | roleId, permissionId（联合唯一） |
| **AdminAuditLog** | 审计日志 | adminUserId, action, module, targetType, targetId, summary, before(Json), after(Json), diff(Json), ip, isReversible, rolledBackAt/By/LogId |
| **AdminSession** | 管理员会话 | adminUserId, refreshTokenHash, ip, userAgent, expiresAt |

**设计决策 — 权限用独立表 + 关联表，不用 JSON 数组：**
- 可查询（哪些角色有 `orders:ship` 权限）
- FK 约束防止无效权限
- 增删权限时 diff 清晰，方便审计回滚

**审计日志索引策略：**
- `(adminUserId, createdAt)` — 查"我的操作"
- `(module, createdAt)` — 查"所有订单操作"
- `(targetType, targetId, createdAt)` — 查"这个订单的修改历史"
- `(createdAt)` — 时间范围查询 + 归档清理

**修改已有模型：**
- `RuleVersion.createdByAdminId` → 添加 FK 关联到 AdminUser
- `WithdrawRequest.reviewerAdminId` → 添加 FK 关联到 AdminUser

### 2.2 后端架构

#### 认证隔离（管理端与买家端完全独立）

| | 买家端 | 管理端 |
|---|---|---|
| JWT Secret | `JWT_SECRET` | `ADMIN_JWT_SECRET`（独立） |
| Token 有效期 | 7d | 8h |
| Passport Strategy | `jwt` | `admin-jwt` |
| Guard | 全局 `JwtAuthGuard` | 控制器级 `AdminAuthGuard` |
| Payload | `{ sub: userId }` | `{ sub: adminUserId, type: 'admin', roles: string[] }` |

**共存方式：** Admin 控制器用 `@Public()` 绕过全局买家 Guard，再显式 `@UseGuards(AdminAuthGuard, PermissionGuard)`。两套 JWT 密钥完全隔离，互相无法伪造。

#### 后端模块结构

```
backend/src/modules/admin/
├── admin.module.ts                    # 父模块，导入所有子模块
├── common/
│   ├── strategies/admin-jwt.strategy.ts    # 独立 Passport 策略
│   ├── guards/admin-auth.guard.ts          # Admin JWT 守卫
│   ├── guards/permission.guard.ts          # 权限检查守卫
│   ├── decorators/require-permission.ts    # @RequirePermission('orders:read')
│   ├── decorators/current-admin.ts         # @CurrentAdmin()
│   ├── decorators/audit-action.ts          # @AuditAction({ ... })
│   └── interceptors/audit-log.interceptor.ts  # 自动审计拦截器
├── auth/          # 登录/登出/刷新/验证码/个人信息
├── users/         # 管理员 CRUD / 分配角色 / 重置密码
├── roles/         # 角色 CRUD / 权限分配
├── audit/         # 审计日志查询 / 回滚执行
├── stats/         # Dashboard 统计数据
├── products/      # 商品管理（列表/编辑/上下架）
├── orders/        # 订单管理（列表/详情/发货/退款）
├── companies/     # 企业管理（列表/审核）
├── bonus/         # 会员管理 / 提现审核
├── trace/         # 溯源批次 CRUD
└── config/        # 系统配置编辑 + 版本记录
```

#### 权限守卫工作流

```
请求 → @Public() 跳过全局买家 Guard
     → AdminAuthGuard 验证 admin JWT
     → PermissionGuard 检查 @RequirePermission
       → 超级管理员直接放行
       → 其他角色：查 DB 获取权限集合，比对所需权限
     → Controller 处理业务
     → AuditLogInterceptor 自动记录审计日志（before/after 快照）
```

#### 审计拦截器工作流

```
1. 读取 @AuditAction 装饰器元数据
2. 请求前：查询目标实体当前状态 → before 快照
3. Controller 执行业务逻辑
4. 请求后：再次查询目标实体 → after 快照
5. 计算 diff（字段级变化对比）
6. 异步写入 AdminAuditLog（不阻塞响应）
```

#### 回滚机制

```
1. 管理员在审计日志中选择一条记录 → 点击"回滚"
2. 检查：isReversible=true 且未被回滚过
3. 取出 before 快照 → 覆盖写回数据库
4. 标记原日志：rolledBackAt + rolledBackBy
5. 创建新的审计日志（action=ROLLBACK），关联原日志
```

**不可回滚操作（isReversible=false）：**
- 退款审批（钱已打出）
- 推送/短信已发送
- 支付回调已处理
- 物流已发出

#### 权限矩阵（种子数据）

| 模块 | 操作 |
|------|------|
| dashboard | read |
| users | read, create, update, ban |
| products | read, create, update, delete, audit |
| orders | read, ship, refund, cancel |
| companies | read, update, audit |
| bonus | read, approve_withdraw, adjust |
| trace | read, create, update, delete |
| config | read, update |
| admin_users | read, create, update, delete |
| admin_roles | read, create, update, delete |
| audit | read, rollback |

**默认角色（种子数据）：**
- **超级管理员**（isSystem=true）：全部权限，绕过检查
- **经理**（isSystem=true）：大部分读写，无 admin_users/admin_roles 管理权限
- **员工**（isSystem=true）：大部分只读 + products:update（改文案/图片）

### 2.3 Web 前端

项目目录：`admin/`（与 `backend/` 同级）

**核心页面：**

| 页面 | 路由 | 优先级 |
|------|------|--------|
| 登录 | `/login` | P0 |
| Dashboard | `/` | P0 |
| 用户列表 | `/users` | P0 |
| 商品列表 + 编辑 | `/products`, `/products/:id/edit` | P0 |
| 订单列表 + 详情 | `/orders`, `/orders/:id` | P0 |
| 管理员账号 | `/admin/users` | P0 |
| 角色权限 | `/admin/roles` | P0 |
| 审计日志 | `/audit` | P0 |
| 企业列表 + 审核 | `/companies`, `/companies/:id` | P1 |
| 会员管理 | `/bonus/members` | P1 |
| 提现审核 | `/bonus/withdrawals` | P1 |
| 溯源管理 | `/trace` | P2 |
| 系统配置 | `/config` | P2 |

**关键组件：**
- `PermissionGate` — 按权限条件渲染 UI（按钮/菜单/操作列）
- `AuditDiffViewer` — before/after 对比视图
- `RollbackConfirm` — 回滚确认弹窗
- `CaptchaInput` — 登录验证码组件

### 2.4 实施步骤

| 步骤 | 内容 | 后端 | 前端 |
|------|------|------|------|
| **2.4.1** | **基础设施**：Schema 7 模型 + 迁移 + 种子数据 + Admin common + 前端项目骨架 | ✅ 已完成 | ✅ 已完成 |
| **2.4.2** | **Admin 认证**：登录/登出/刷新 + 前端登录页 + Auth Store + ProLayout | ✅ 已完成 | ✅ 已完成 |
| **2.4.3** | **管理员 + 角色管理**：Admin CRUD + Role CRUD + 权限矩阵 UI | ✅ 已完成 | ✅ 已完成 |
| **2.4.4** | **审计日志 + 回滚**：日志查询/详情/diff 视图/回滚执行 | ✅ 已完成 | ✅ 已完成 |
| **2.4.5** | **Dashboard 统计**：用户数/订单数/销售额/趋势图 | ✅ 已完成 | ✅ 已完成 |
| **2.4.6** | **商品管理**：列表/编辑/上下架 | ✅ 已完成 | ✅ 已完成 |
| **2.4.7** | **订单管理**：列表/详情/发货/退款 | ✅ 已完成 | ✅ 已完成 |
| **2.4.8** | **企业管理**：列表/审核 | ✅ 已完成 | ✅ 已完成 |
| **2.4.9** | **会员/奖励**：VIP 列表/提现审核 | ✅ 已完成 | ✅ 已完成 |
| **2.4.10** | **溯源管理**：批次 CRUD | ✅ 已完成 | ✅ 已完成 |
| **2.4.11** | **系统配置**：RuleConfig 编辑 + 版本历史 | ✅ 已完成 | ✅ 已完成 |

**后端完成情况（2026-02-16）：**
- ✅ Prisma Schema 新增 7 模型 + 2 枚举，迁移成功
- ✅ 种子数据：36 权限 + 3 系统角色 + 超级管理员账号（admin / admin123456）
- ✅ 12 个 Admin 子模块全部实现（auth/users/app-users/roles/audit/stats/products/orders/companies/bonus/trace/config）
- ✅ 基础设施：AdminJwtStrategy + AdminAuthGuard + PermissionGuard + AuditLogInterceptor + 3 装饰器
- ✅ TypeScript 编译零错误，后端启动所有路由正常注册
- ✅ `app.module.ts` 已导入 AdminModule，`.env` 已添加 ADMIN_JWT_SECRET

**前端完成情况（2026-02-16）：**
- ✅ 项目骨架：Vite + React 18 + TypeScript + Ant Design 5 + ProComponents + react-router-dom + react-query + Zustand
- ✅ 主题配置：#2E7D32 自然绿主色调，中文国际化
- ✅ API 层：12 个 API 模块对接 54 个后端端点，axios 拦截器自动附加 JWT
- ✅ 认证系统：Zustand Auth Store + 登录页 + 路由守卫 + 权限检查
- ✅ ProLayout 框架：深色侧边栏 + 权限过滤菜单 + 用户头像下拉
- ✅ 15 个业务页面全部实现（Dashboard/商品列表+编辑/订单列表+详情/企业列表+详情/用户/会员/提现/溯源/配置/审计/管理员/角色）
- ✅ 通用组件：PermissionGate / AuditDiffViewer / RollbackConfirm
- ✅ TypeScript 编译零错误，Vite 构建成功

**二次验证修复（2026-02-16）：**
- ✅ 新增后端 `admin/app-users` 模块：App 买家用户列表/详情/封禁解封（原 UserListPage 错误调用了管理员端点）
- ✅ 新增商品编辑页 `/products/:id/edit`：基本信息表单 + 状态信息 + 图片展示 + SKU 规格表
- ✅ 新增企业详情页 `/companies/:id`：企业信息 + 统计数据 + 资质文档列表 + 审核操作
- ✅ 商品列表新增「编辑」按钮跳转编辑页，企业列表新增「详情」按钮跳转详情页
- ✅ 用户管理菜单恢复到侧边栏导航

### 2.5 验证方案

每个步骤完成后执行：

1. **编译检查**：`npx tsc --noEmit`（后端 + 前端）
2. **Schema 验证**：`npx prisma validate` + `npx prisma migrate dev`
3. **API 测试**：curl 逐一验证新增端点
4. **权限测试**：用不同角色账号测试受限接口，验证 403 返回
5. **审计测试**：执行写操作后查 audit 日志是否正确记录 before/after
6. **回滚测试**：修改商品 → 在审计日志中回滚 → 验证数据恢复
7. **前端联调**：ProTable 加载数据、ProForm 提交、权限按钮显隐

### 2.6 关键文件清单

| 文件 | 用途 |
|------|------|
| `backend/prisma/schema.prisma` | 添加 7 个新模型 + 2 个枚举 |
| `backend/prisma/seed.ts` | 添加 Admin 种子数据（超级管理员账号 + 三个默认角色 + 权限矩阵） |
| `backend/src/app.module.ts` | 导入 AdminModule |
| `backend/src/common/decorators/public.decorator.ts` | Admin 控制器复用 @Public() |
| `backend/src/modules/admin/` | 管理后台全部后端代码 |
| `backend/.env` | 添加 ADMIN_JWT_SECRET 等配置 |
| `admin/` | 管理后台前端项目（新建） |

### 2.7 前置条件
- ✅ 阶段一完成（后端 + 数据库运行正常）
- ✅ Web 技术栈已确认（React + Vite + Ant Design）
- ✅ 三大核心需求已确认（独立用户体系 / 可配置 RBAC / 审计日志+回滚）

---

## 阶段三：分润奖励系统（商业核心）✅

> **目标**：实现完整的分润奖励商业逻辑 — 订单确认事件驱动奖励计算、分流路由、普通广播分配、VIP 三叉树上溯分配、解锁/冻结/释放/退款回滚、账本化全链路可审计

### 3.0 业务规则总览

#### 3.0.1 奖励池计算（统一公式）

每笔订单确认收货后触发：

```
profit = saleAmount - costAmount                    # 利润 = 销售额 - 成本

# VIP 六分结构（默认 50/30/10/2/2/6）：
platformPool    = profit × VIP_PLATFORM_PERCENT     # 平台利润（默认 50%）
rewardPool      = profit × VIP_REWARD_PERCENT       # 奖励池（默认 30%）
industryFund    = profit × VIP_INDUSTRY_PERCENT     # 产业基金（默认 10%）
charityFund     = profit × VIP_CHARITY_PERCENT      # 慈善基金（默认 2%）
techFund        = profit × VIP_TECH_PERCENT         # 科技基金（默认 2%）
reserveFund     = profit × VIP_RESERVE_PERCENT      # 备用金（默认 6%）

# 普通用户六分结构（默认 50/16/16/8/8/2）：
# 详见 plan-treeforuser.md
```

> 所有比例参数通过 RuleConfig 后台可配置，修改时生成 RuleVersion 快照。
> 必须落库：profit、rewardPool、ruleVersion、所有比例快照。
> 注：旧 `rebatePool` 两级分割已废弃，VIP 与普通用户均采用六分结构直接拆分利润。

#### 3.0.2 分流规则（路由判定）

```
订单确认收货
  ├── 买家是 VIP 且 订单金额 ≥ VIP_MIN_AMOUNT(默认¥100，可配置) 且 VIP 未出局
  │   └── → VIP 三叉树上溯分配
  └── 其他情况（非VIP / VIP但金额<100 / VIP已出局）
      └── → 普通广播队列分配
```

#### 3.0.3 普通会员奖励（滑动窗口 × 按桶独立）

**核心概念：基于订单的滑动窗口，每个桶独立运行**

1. 按订单金额分桶（`bucketKey`），桶区间后台可配置，默认：
   - `CNY_0_10`、`CNY_10_50`、`CNY_50_100`、`CNY_100_500`、`CNY_500_PLUS`
2. 每个桶维护独立的订单队列，按 `joinedAt` 时间排序
3. 用户消费后，该订单自动加入对应金额桶的队列
4. 当一笔新订单确认收货时：
   - 确定该订单所在的桶
   - 取该订单**前面**的 **X** 笔订单（X 默认 20，后台可配置）
   - 如果前面不足 X 笔订单，则按实际数量
   - 每笔订单对应的用户获得奖励 = `rewardPool / min(X, 前面订单数)`
5. **关键：以订单为粒度，非用户**
   - 同一用户可有多笔订单在同一桶中
   - 同一用户的多笔订单各自独立获得奖励
   - 滑动窗口：随新订单到来，最早的订单自然滑出窗口
6. 奖励直接进入 AVAILABLE 状态（因为订单已确认）

**示例（X=3，某桶中按时间顺序有订单 A→B→C→D→E）：**

| 确认订单 | 前面的订单 | 受益订单 | 每笔奖励金额 |
|---------|-----------|---------|-------------|
| A 确认 | 无 | 无 | ¥0（无前序订单） |
| B 确认 | A | A | B的rewardPool / 1 |
| C 确认 | A, B | A, B | C的rewardPool / 2 |
| D 确认 | A, B, C | A, B, C | D的rewardPool / 3 |
| E 确认 | B, C, D | B, C, D | E的rewardPool / 3（A已滑出窗口） |

> 若订单 A 和 C 属于同一用户张三，则 D 确认时张三获得 2 份奖励（A 和 C 各一份）

#### 3.0.4 VIP 399 三叉树奖励

**树的建立（上到下）：**
- 系统用户 A1–A10（10 个高管）为树根节点，每棵独立子树
- 三叉树：每个节点最多 3 个子节点（分叉数后台可配置，默认 3）
- VIP 购买（¥399）不算有效订单，仅用于成为 VIP 和加入树

**有推荐人的情况：**
1. VIP 用户 A 分享专属二维码（含 referralCode）
2. 新用户 B 扫码 → 绑定推荐关系（ReferralLink）
3. B 购买 VIP 礼包（¥399）→ **B 必须在 A 的子树中**
4. 放置规则：
   - 若 A 有空位（子节点 < 3）→ B 直接成为 A 的子节点
   - 若 A 已满 → 在 A 的子树内 BFS 滑落（找子节点最少的节点，平局按 BFS 顺序）

**无推荐人的情况：**
1. 用户自行购买 VIP → 作为系统用户的**直接子节点**
2. 按顺序检查 A1→A2→...→A10，找第一个有空位（子节点 < 3）的系统用户
3. 若 A1-A10 全满（每个都有 3 个直接子节点）→ 自动创建 A11 系统用户，新用户放在 A11 下
4. 无推荐人用户**只能**成为系统用户的直接子节点，不会被放到树的深层

**示例（三叉树）：**
```
Step 1-3: V1、V2、V3 无推荐人 → 分配到 A1 下
       A1
      /|\
    V1 V2 V3

Step 4: V4 被 V2 推荐 → V2 子树，V2 有空位 → V4 放在 V2 下
       A1
      /|\
    V1 V2 V3
       |
       V4

Step 5: V5 无推荐人 → A1 已满 → 放到 A2 下
    A1          A2
   /|\          |
 V1 V2 V3      V5
    |
    V4

Step 6: V6 被 V2 推荐 → V2 子树，V2 有空位 → V6 放在 V2 下
    A1          A2
   /|\          |
 V1 V2 V3      V5
   /\
  V4 V6

Step 7: V7 无推荐人 → A2 有空位 → V7 放在 A2 下
    A1          A2
   /|\         / \
 V1 V2 V3    V5  V7
   /\
  V4 V6
```

**奖励分配（下到上）：**
- VIP 用户 X 的**第 k 单有效消费**（金额 ≥ VIP_MIN_AMOUNT 且订单已确认）
- `rewardPool` → 发给 X 的**第 k 个祖先**（沿 parentId 向上数 k 层），如果没有k层，则奖励会相当于发给了平台
- **点对点，仅一层**：第 k 单只给第 k 个祖先

**解锁机制：**
- 祖先 A 必须 `selfPurchaseCount ≥ k` 才能解锁第 k 层奖励
- 未解锁：奖励创建为 FROZEN 状态（meta 中记录 `locked=true, requiredLevel=k`）
- 当 A 后续消费使 `selfPurchaseCount` 增加到 ≥ k → 自动扫描并释放所有 `目标=A, requiredLevel=k` 的冻结奖励

**出局机制：**
- 每个 VIP 最多从 15 层（后台可配置）下级收奖励
- 每层容量 = 该层的理论节点数（层 k 容量 = 分叉数^k，即 3, 9, 27, 81, ...）
- 当 15 层全部收满（每层的所有实际位置都发了奖励）→ 出局（`exitedAt` 设为当前时间）
- 出局后的消费走普通广播体系
- 实际中由于深层节点数指数增长（第15层理论上有 3^15 ≈ 1434 万个位置），出局几乎不会发生

**退款处理：**
- 7 天内退款：订单未确认，奖励从未发出，无需处理
- 7 天后退款（极端情况）：VipEligibleOrder 标记 `valid=false` → 对应 RewardLedger VOID → **仅作废该单奖励，不影响其他层级**

#### 3.0.5 触发时机

```
订单支付 → 开始 7 天倒计时
  ├── 7 天内用户退货/退款 → 订单取消，不产生奖励
  └── 7 天后自动确认 / 用户手动确认收货
      └── 触发奖励分配流程：
          1. 计算 profit，按六分结构拆分（VIP: 50/30/10/2/2/6）
          2. 判定分流：VIP 上溯 or 普通广播
          3. 创建 RewardAllocation（幂等键防重复）
          4. 创建 RewardLedger 流水条目
          5. 更新 RewardAccount 余额
          6. 平台分润：37% 平台利润 + 1% 基金 + 2% 积分
```

#### 3.0.6 可配置参数清单（RuleConfig）

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `VIP_PLATFORM_PERCENT` | 0.50 | VIP 平台利润占利润比例 |
| `VIP_REWARD_PERCENT` | 0.30 | VIP 奖励池占利润比例 |
| `VIP_INDUSTRY_PERCENT` | 0.10 | VIP 产业基金占利润比例 |
| `VIP_CHARITY_PERCENT` | 0.02 | VIP 慈善基金占利润比例 |
| `VIP_TECH_PERCENT` | 0.02 | VIP 科技基金占利润比例 |
| `VIP_RESERVE_PERCENT` | 0.06 | VIP 备用金占利润比例 |
| `NORMAL_BROADCAST_X` | 20 | 普通广播每次分配人数 |
| `VIP_MIN_AMOUNT` | 100.0 | VIP 有效消费最低金额（元） |
| `VIP_MAX_LAYERS` | 15 | VIP 最多收取层数 |
| `VIP_BRANCH_FACTOR` | 3 | 三叉树分叉数 |
| `VIP_PRICE` | 399.0 | VIP 礼包价格（元） |
| `BUCKET_RANGES` | `[0,10],[10,50],[50,100],[100,500],[500,+]` | 普通桶金额区间 |
| `AUTO_CONFIRM_DAYS` | 7 | 自动确认收货天数 |

#### 3.0.7 账本化体系

所有资金变动通过流水记录，不直接修改余额：

| 表 | 用途 | 关键字段 |
|----|------|----------|
| **RewardAccount** | 用户账户 | userId + type(RED_PACKET/POINTS/FUND_POOL/PLATFORM_PROFIT) → balance + frozen |
| **RewardAllocation** | 分配批次 | triggerType(ORDER_RECEIVED/REFUND) + ruleType(NORMAL_BROADCAST/VIP_UPSTREAM/PLATFORM_SPLIT) + idempotencyKey |
| **RewardLedger** | 流水明细 | entryType(FREEZE/RELEASE/WITHDRAW/VOID/ADJUST) + status(FROZEN/AVAILABLE/WITHDRAWN/VOIDED) + meta(快照) |

**幂等键格式**：`ALLOC:<triggerType>:<orderId>:<ruleType>:<ruleVersion>`

**meta 必含字段**：scheme(NORMAL/VIP)、sourceUserId（消费者）、calcSnapshot（profit/rewardPool/六分比例快照）、bucketKey（普通）、vipIndex + ancestorUserId + requiredLevel + locked（VIP）

---

### 3.1 已实现部分（阶段一/二中完成的骨架）

| 功能 | 位置 | 状态 |
|------|------|------|
| MemberProfile 自动创建 + 查询 | `bonus.service.ts` → `getMemberProfile` | ✅ |
| 推荐码绑定（ReferralLink） | `bonus.service.ts` → `useReferralCode` | ✅ |
| VIP 购买 + 三叉树 BFS 插入 | `bonus.service.ts` → `purchaseVip` + `assignVipTreeNode` | ✅ BFS 已修复（3.3.5/3.3.9） |
| VIP 推荐奖励（购买即发放） | `bonus.service.ts` → `grantVipReferralBonus`（被推荐人购 VIP 后推荐人获奖励，金额由 VIP_REFERRAL_BONUS 配置，默认 50 元） | ✅ |
| 钱包余额查询 | `bonus.service.ts` → `getWallet` | ✅ |
| 奖励流水查询（分页） | `bonus.service.ts` → `getWalletLedger` | ✅ |
| 提现申请（冻结余额） | `bonus.service.ts` → `requestWithdraw` | ✅ |
| 提现记录查询 | `bonus.service.ts` → `getWithdrawHistory` | ✅ |
| VIP 三叉树可视化（2层深） | `bonus.service.ts` → `getVipTree` | ✅ |
| 普通排队状态查询 | `bonus.service.ts` → `getQueueStatus` | ✅ |
| 管理后台：会员列表 | `admin-bonus.service.ts` → `findMembers` | ✅ |
| 管理后台：提现审核/拒绝 | `admin-bonus.service.ts` → `approveWithdraw/rejectWithdraw` | ✅ |
| 买家 App：钱包/VIP/三叉树/排队/提现 5 个页面 | `app/me/wallet|vip|bonus-tree|bonus-queue|withdraw.tsx` | ✅ |
| Prisma Schema：12 张分润表 + 11 个枚举 | `schema.prisma` I 域 | ✅ |

### 3.2 未实现部分（核心商业逻辑）

| 缺失功能 | 重要性 | 说明 |
|----------|--------|------|
| **订单确认触发奖励分配** | 🔴 核心 | 订单 RECEIVED 事件 → 调用分润引擎，当前无此链路 |
| **奖励池计算引擎** | 🔴 核心 | profit → 六分结构拆分（VIP: 50/30/10/2/2/6）的计算，当前无代码 |
| **分流路由** | 🔴 核心 | 判定走普通广播 vs VIP 上溯，当前无代码 |
| **普通广播分配** | 🔴 核心 | 取队列前 X 人、等额分配、创建 Ledger，当前无代码 |
| **VIP 上溯分配** | 🔴 核心 | 找第 k 祖先、点对点发奖励、创建 Ledger，当前无代码 |
| **VIP 解锁机制** | 🔴 核心 | selfPurchaseCount 增加时扫描释放冻结奖励，当前无代码 |
| **VIP 出局判定** | 🟡 重要 | 15 层全部收满后切换普通体系，当前无代码 |
| **平台/基金/积分分润** | 🟡 重要 | 37%/1%/2% 拆分写入平台 RewardAccount，当前无代码 |
| **普通桶管理** | 🟡 重要 | 用户消费后自动加入对应桶队列，当前无代码 |
| **VipEligibleOrder 记录** | 🟡 重要 | 每笔 VIP 有效消费记录 effectiveIndex，当前无代码 |
| **退款回滚** | 🟡 重要 | 7天后退款 → VOID 对应 Ledger，当前无代码 |
| **自动确认收货定时任务** | 🟡 重要 | 7 天后自动将 DELIVERED → RECEIVED，当前无定时任务 |
| **RuleConfig 种子数据** | 🟢 必要 | 分润参数的默认值未写入种子数据 |
| **提现拒绝后解冻** | 🟢 修复 | 管理员拒绝提现后，冻结金额应退回 balance，当前未实现 |
| **assignVipTreeNode BFS 逻辑修复** | 🔴 修复 | 当前全局 BFS 从树根查找空位，应改为：有推荐人→推荐人子树内 BFS；无推荐人→仅系统用户直接子节点 |
| **管理后台类型修复** | 🟢 修复 | BonusMember 类型用了 BRONZE/SILVER 等级（应为 NORMAL/VIP），WithdrawRequest 状态枚举不匹配 |
| **分润相关种子数据** | 🟢 必要 | 无 VIP 购买/奖励分配/提现等演示数据 |

---

### 3.3 实施计划

#### 步骤 3.3.1：RuleConfig 种子数据 + 配置服务

**后端：**
- 在 `seed.ts` 中写入 3.0.6 中所有默认配置到 RuleConfig 表
- 创建 `BonusConfigService`：从 RuleConfig 读取分润参数，缓存到内存，提供 `getConfig()` 方法
- 每次读取时附带当前 `ruleVersion`

**验证：** 种子数据后 RuleConfig 表有 12 条记录；管理后台 `/config` 页面可查看和修改

| 后端 | 前端 |
|------|------|
| 待实现 | 无（复用现有 config 页面） |

#### 步骤 3.3.2：自动确认收货定时任务

**后端：**
- 创建 `OrderAutoConfirmService`（或在现有 order 模块中添加）
- 使用 `@nestjs/schedule` 的 `@Cron` 或 `@Interval` 每小时扫描一次
- 查找 `status = DELIVERED` 且 `autoReceiveAt <= now()` 的订单
- 批量更新为 `status = RECEIVED`，记录 `receivedAt`
- 写入 OrderStatusHistory
- **触发奖励分配事件**（通过 EventEmitter 或直接调用 BonusAllocationService）

**依赖：** 需确认订单模块中 `autoReceiveAt` 字段在发货时是否被正确设置为 `shippedAt + 7天`

| 后端 | 前端 |
|------|------|
| 待实现 | 无 |

#### 步骤 3.3.3：分润奖励引擎（核心）

**后端新建** `backend/src/modules/bonus/engine/` 目录：

```
bonus/engine/
├── bonus-allocation.service.ts     # 分配入口：订单确认 → 路由 → 分配
├── reward-calculator.service.ts    # 奖励池计算：profit → pools
├── normal-broadcast.service.ts     # 普通广播：取前X人 + 等额分配
├── vip-upstream.service.ts         # VIP上溯：找第k祖先 + 解锁检查
├── platform-split.service.ts       # 平台分润：37% + 1% + 2%
└── bonus-config.service.ts         # 配置读取（步骤 3.3.1）
```

**`BonusAllocationService.allocateForOrder(orderId)` 主流程：**

```
1. 查询订单（含 orderItems → product.cost）
2. 读取当前 RuleConfig + ruleVersion
3. 计算 profit，按六分结构拆分（调用 RewardCalculator）
4. 幂等检查：idempotencyKey = ALLOC:ORDER_RECEIVED:<orderId>:*
5. 分流判定：
   a. 查买家 MemberProfile.tier
   b. 查买家 VipProgress.exitedAt
   c. 判断金额 >= VIP_MIN_AMOUNT
6. 路由到 NormalBroadcast 或 VipUpstream
7. 调用 PlatformSplit 处理平台/基金/积分
8. 全部在一个 Prisma 事务中执行
```

**`RewardCalculatorService.calculate(order, config)` 返回：**

```typescript
{
  profit: number;
  rewardPool: number;       // VIP 默认 30%
  platformPool: number;     // VIP 默认 50%
  industryFund: number;     // VIP 默认 10%
  charityFund: number;      // VIP 默认 2%
  techFund: number;         // VIP 默认 2%
  reserveFund: number;      // VIP 默认 6%
  ruleVersion: string;
  configSnapshot: Record<string, any>;
}
```

> 注意：Product 表中有 `basePrice`（售价）和 `cost`（成本），金额单位为 Float/元

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.4：普通广播分配（滑动窗口模型）

**`NormalBroadcastService.distribute(orderId, rewardPool, config, ruleVersion)` 流程：**

```
1. 确定 bucketKey：根据订单金额匹配 BUCKET_RANGES
2. 查找桶：NormalBucket where bucketKey
3. 买家订单加入队列（如尚未加入）：
   a. 创建 NormalQueueMember（joinedAt=now, orderId, bucketId）
4. 滑动窗口取前序订单：
   a. 查找当前订单在队列中的位置
   b. 取该订单**前面**的 X 笔订单：
      NormalQueueMember where bucketId AND joinedAt < 当前订单joinedAt
      orderBy joinedAt DESC, take X
   c. 若前面不足 X 笔订单 → 按实际数量
5. 分配奖励：
   a. 受益订单数 = min(X, 前面的订单数)
   b. 每笔奖励 = rewardPool / 受益订单数
   c. 为每笔受益订单创建：
      - RewardAllocation（ruleType=NORMAL_BROADCAST）
      - RewardLedger（entryType=RELEASE, status=AVAILABLE, meta 含 bucketKey/sourceOrderId/calcSnapshot）
      - 更新对应用户的 RewardAccount(RED_PACKET).balance += 奖励金额
   d. 注意：同一用户可能有多笔订单在窗口中，每笔订单各自获得奖励
6. 若前面没有任何订单 → 该笔 rewardPool 无受益人（归入平台收益或保留）
```

> **关键区别**：这是基于订单的滑动窗口，不是消耗型队列。订单不会被"消费"后移除，而是随时间自然滑出窗口。

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.5：VIP 三叉树上溯分配 + 修复 assignVipTreeNode

**⚠️ 现有 `assignVipTreeNode` Bug 需修复：**

当前代码（`bonus.service.ts:302`）的问题：
1. **有推荐人时**：仅取推荐人的 `rootId`，然后从**树根全局 BFS**（`where: { rootId, childrenCount: { lt: 3 } }`）。**错误**：应在推荐人子树内 BFS，确保新节点在推荐人子树中
2. **无推荐人时**：默认 `rootId = 'A1'`，全局 BFS 可能放到树的深层。**错误**：应仅作为系统用户（A1-A10）的直接子节点，A1 满了去 A2，全满则创建 A11

**修复后的 `assignVipTreeNode` 逻辑：**

```
有推荐人：
  1. 找到推荐人的 VipTreeNode
  2. 若推荐人 childrenCount < 3 → 新节点直接成为推荐人的子节点
  3. 若推荐人已满 → 在推荐人子树内 BFS 滑落：
     a. 从推荐人节点开始，逐层遍历其所有后代
     b. 在每一层中找 childrenCount 最少的节点
     c. 插入为该节点的子节点

无推荐人：
  1. 遍历系统用户节点 A1→A2→...→A10
  2. 找第一个 childrenCount < 3 的系统用户
  3. 新节点成为该系统用户的直接子节点
  4. 若 A1-A10 全满 → 创建 A11 系统用户节点 → 新节点放在 A11 下
```

**`VipUpstreamService.distribute(orderId, userId, rewardPool, config, ruleVersion)` 流程：**

```
1. 记录有效消费（仅 ≥ VIP_MIN_AMOUNT 的订单才算）：
   a. 查询 VipEligibleOrder 中 userId 且 valid=true 的数量 → effectiveIndex = count + 1
   b. 创建 VipEligibleOrder（effectiveIndex=k, qualifies=true, amount=订单金额）
2. VipProgress.selfPurchaseCount += 1（selfPurchaseCount 仅计 VIP 有效订单 ≥¥100）
3. 找第 k 个祖先：
   a. 从买家的 VipTreeNode 出发，沿 parentId 向上数 k 层
   b. 若 k > 树深度（没有第 k 个祖先）→ rewardPool 归平台（相当于发给了平台）
   c. 若 k > VIP_MAX_LAYERS(15) → 本单降级普通广播，不走 VIP
4. 检查祖先解锁状态：
   a. 查祖先的 VipProgress.selfPurchaseCount
   b. 若 selfPurchaseCount >= k → 奖励 AVAILABLE
   c. 若 selfPurchaseCount < k → 奖励 FROZEN（meta.locked=true, meta.requiredLevel=k）
5. 创建 RewardAllocation + RewardLedger + 更新 RewardAccount
6. 出局检查在分配后异步执行（见步骤 3.3.7）
7. 解锁检查（因为买家自己的 selfPurchaseCount 也增加了）：
   a. 买家作为祖先，可能有下级的冻结奖励等待释放
   b. 调用 unlockFrozenRewards(userId, newSelfPurchaseCount)
```

**`unlockFrozenRewards(ancestorUserId, newLevel)` 流程：**

```
1. 查询 RewardLedger where userId=ancestorUserId AND status=FROZEN AND meta.requiredLevel=newLevel
2. 批量更新：status → AVAILABLE, entryType → RELEASE
3. 更新 RewardAccount：balance += 释放金额, frozen -= 释放金额
```

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.6：平台分润

**`PlatformSplitService.split(profit, config, ruleVersion, orderId)` 流程：**

```
1. 按六分结构计算（VIP 默认 50/30/10/2/2/6）：
   platformAmount  = profit × VIP_PLATFORM_PERCENT    # 平台利润
   rewardAmount    = profit × VIP_REWARD_PERCENT       # 奖励池（用于上溯分配）
   industryAmount  = profit × VIP_INDUSTRY_PERCENT     # 产业基金
   charityAmount   = profit × VIP_CHARITY_PERCENT      # 慈善基金
   techAmount      = profit × VIP_TECH_PERCENT         # 科技基金
   reserveAmount   = profit × VIP_RESERVE_PERCENT      # 备用金
2. 创建 RewardAllocation（ruleType=PLATFORM_SPLIT）
3. 更新平台 RewardAccount：
   - type=PLATFORM_PROFIT  → balance += platformAmount
   - type=INDUSTRY_FUND    → balance += industryAmount
   - type=CHARITY_FUND     → balance += charityAmount
   - type=TECH_FUND        → balance += techAmount
   - type=RESERVE_FUND     → balance += reserveAmount
4. 创建 RewardLedger 流水记录
```

> 平台账户的 userId 使用特殊值 `PLATFORM`（或在种子数据中创建一个平台 User）

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.7：出局判定

**在每次奖励分配给 VIP 祖先后检查：**

```
1. 查询该祖先在每一层（1~VIP_MAX_LAYERS）已收到的奖励数量：
   SELECT meta->>'vipIndex' as layer, COUNT(*) as received
   FROM RewardLedger
   WHERE userId=ancestorUserId AND status IN (AVAILABLE, FROZEN) AND meta->>'scheme'='VIP'
   GROUP BY layer
2. 对每一层 k（1~15）：
   - 该层理论容量 = BRANCH_FACTOR^k（第1层=3，第2层=9，第3层=27...）
   - 但实际容量 = 该祖先在树中第 k 层的实际子孙数量（更精确）
   - 若 received >= 实际容量 → 该层已满
3. 若所有 15 层都已满 → 标记 VipProgress.exitedAt = now()
```

> 注意：出局判定可以异步执行（不在主事务中），避免影响奖励分配性能

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.8：退款回滚

**在订单退款时触发（仅处理已确认订单的极端情况）：**

```
1. 查询 RewardAllocation where orderId
2. 查询关联的 RewardLedger 条目
3. 对每条 Ledger：
   a. status → VOIDED, entryType → VOID
   b. 更新 RewardAccount：
      - 若原 status=AVAILABLE → balance -= amount
      - 若原 status=FROZEN → frozen -= amount
4. 若是 VIP 有效消费：
   a. VipEligibleOrder 标记 valid=false, invalidReason='REFUND'
   b. 注意：不重算后续 effectiveIndex，仅作废当单
5. 创建新的 RewardAllocation（triggerType=REFUND, idempotencyKey 含 refundId）
```

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | 无 |

#### 步骤 3.3.9：修复已有代码

**后端修复：**
- 提现拒绝后解冻：`admin-bonus.service.ts` → `rejectWithdraw` 需要将冻结金额退回 balance
- 提现审批后扣减：`approveWithdraw` 需要将 frozen 减少（实际打款为占位实现）

**管理后台前端修复：**
- `admin/src/types/index.ts`：`BonusMember.tier` 改为 `NORMAL | VIP`，移除 `totalPoints/availablePoints`，添加正确字段
- `admin/src/types/index.ts`：`WithdrawRequest.status` 改为 `REQUESTED | APPROVED | REJECTED | PAID | FAILED`
- `admin/src/pages/bonus/members.tsx`：修复等级筛选 valueEnum 和列定义
- `admin/src/pages/bonus/withdrawals.tsx`：修复状态枚举映射

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | ✅ 已完成 |

**已修复项目：**
- ✅ 提现拒绝后解冻：`admin-bonus.service.ts` → `rejectWithdraw` 事务中解冻 frozen → balance
- ✅ 提现审批后扣减：`approveWithdraw` 事务中扣减 frozen
- ✅ `admin/src/types/index.ts`：`BonusMember.tier` 改为 `NORMAL | VIP`，字段与 Prisma Schema 对齐
- ✅ `admin/src/types/index.ts`：`WithdrawRequest.status` 改为 `REQUESTED | APPROVED | REJECTED | PAID | FAILED`
- ✅ `admin/src/pages/bonus/members.tsx`：修复等级筛选、列定义、用户昵称显示
- ✅ `admin/src/pages/bonus/withdrawals.tsx`：修复状态枚举映射（PENDING → REQUESTED）

**额外发现并修复的问题：**
- ✅ `platform-split.service.ts` PLATFORM_USER_ID 外键违反 → 种子数据添加 PLATFORM 系统用户
- ✅ `bonus.service.ts` BFS 满子树回退破坏三叉树 → bfsInSubtree 返回 null 降级系统节点
- ✅ `normal-broadcast.service.ts` 四舍五入精度丢失 → 余额分给最后一位受益人
- ✅ `bonus-allocation.service.ts` 幂等检查并发风险 → catch P2002 唯一约束错误做优雅跳过

#### 步骤 3.3.10：种子数据 + 管理后台增强

**种子数据：**
- 为演示用户创建 MemberProfile（NORMAL → 可选升级为 VIP）
- 创建 1-2 个 VIP 演示用户 + 三叉树节点
- 创建几条 RewardLedger 演示流水
- 创建 1-2 条 WithdrawRequest 演示数据

**管理后台增强：**
- ✅ 会员详情页：查看用户的三叉树位置、钱包余额、收支流水、提现记录（`admin/src/pages/bonus/member-detail.tsx`）
- ✅ 分润参数配置页：已在 `admin/src/pages/config/index.tsx` 完整实现（4 组参数、比例校验、桶区间检测、版本历史、回滚）
- ✅ 奖励统计 Dashboard：累计分配/提现、VIP 数、待审核提现、7 天趋势图、会员 VIP 占比（`admin/src/pages/dashboard/index.tsx`）

| 后端 | 前端 |
|------|------|
| ✅ 已完成 | ✅ 管理后台增强已完成 |

**已完成：**
- ✅ VIP 三叉树根节点 A1-A3 种子数据
- ✅ u-001（VIP，referralCode=LQHE2025）+ 三叉树节点 + VipProgress(selfPurchaseCount=3)
- ✅ u-002（普通会员）
- ✅ u-006（VIP，由 u-001 邀请）+ 三叉树节点 + VipProgress
- ✅ 推荐关系 u-001 → u-006
- ✅ 奖励账户（u-001: balance=68.50/frozen=62.30 含提现冻结，u-002: balance=15.20）
- ✅ 平台账户（PLATFORM_PROFIT/FUND_POOL/POINTS）
- ✅ 演示 RewardAllocation + 3条 RewardLedger 流水
- ✅ 2 条演示 WithdrawRequest（REQUESTED / APPROVED）
- ✅ 种子 upsert 全部添加 update 字段，支持幂等重跑

**额外修复（订单集成）：**
- ✅ `order-auto-confirm.service.ts`：事务内校验状态，防止与手动确认并发
- ✅ `order.service.ts:applyAfterSale`：添加状态白名单，防止未付款订单申请售后

---

### 3.4 关键数据表一览（已存在于 Prisma Schema）

| 模型 | 用途 | 状态 |
|------|------|------|
| MemberProfile | 会员主表（tier, referralCode, inviterUserId, vipNodeId） | ✅ 已有 |
| VipPurchase | VIP 购买记录（¥399） | ✅ 已有 |
| ReferralLink | 推荐关系（inviter → invitee） | ✅ 已有 |
| VipTreeNode | 三叉树节点（rootId, parentId, level, position） | ✅ 已有 |
| VipProgress | VIP 进度（selfPurchaseCount, unlockedLevel, exitedAt） | ✅ 已有 |
| VipEligibleOrder | 第 k 单有效消费（effectiveIndex, qualifies, valid） | ✅ 已有 |
| RewardAccount | 奖励账户（userId + type → balance + frozen） | ✅ 已有 |
| RewardAllocation | 分配批次（idempotencyKey 唯一，强审计） | ✅ 已有 |
| RewardLedger | 流水明细（entryType, status, meta 快照） | ✅ 已有 |
| NormalBucket | 普通奖励桶 | ✅ 已有 |
| NormalQueueMember | 桶内排队成员 | ✅ 已有 |
| WithdrawRequest | 提现申请 | ✅ 已有 |
| RuleConfig | 配置参数 | ✅ 已有 |
| RuleVersion | 配置版本快照 | ✅ 已有 |

> 无需新建数据表，Schema 已完整覆盖。

### 3.5 订单模块集成点

奖励分配需要与订单模块集成：

```
Order 模块                              Bonus 模块
───────────                             ───────────
confirmReceive(orderId)         →       BonusAllocationService.allocateForOrder(orderId)
autoConfirmCron()               →       BonusAllocationService.allocateForOrder(orderId)
processRefund(orderId)          →       BonusAllocationService.rollbackForOrder(orderId)
```

**Product 表依赖**：需要 `Product.cost` 字段来计算利润（`profit = saleAmount - cost`）

### 3.6 验证方案

| 场景 | 验证步骤 | 预期结果 |
|------|---------|----------|
| 普通用户下单确认 | 创建订单 → 等 7 天（或手动确认）→ 查 RewardAllocation | 创建 NORMAL_BROADCAST 类型分配 |
| 普通广播分配 | 桶内有 20+ 人 → 订单确认 → 查前 20 人的 RewardLedger | 每人收到等额奖励，status=AVAILABLE |
| VIP 用户大额消费 | VIP 用户下 ¥200 订单 → 确认 → 查 k 祖先的 RewardLedger | 祖先收到奖励（AVAILABLE 或 FROZEN） |
| VIP 解锁 | 祖先消费后 selfPurchaseCount 增加 → 查冻结奖励 | 对应层级冻结奖励变为 AVAILABLE |
| VIP 小额降级 | VIP 用户下 ¥50 订单 → 确认 | 走普通广播，非 VIP 上溯 |
| 退款回滚 | 已确认订单退款 → 查 RewardLedger | 对应条目 status=VOIDED |
| 幂等性 | 同一订单重复触发 allocateForOrder | 第二次跳过（idempotencyKey 冲突） |
| 平台分润 | 订单确认 → 查平台 RewardAccount | PLATFORM_PROFIT/FUND_POOL/POINTS 余额增加 |
| 提现拒绝解冻 | 管理员拒绝提现 → 查用户 RewardAccount | frozen 减少，balance 增加 |
| 配置变更 | 修改 NORMAL_BROADCAST_X → 下一笔订单 | 按新 X 值分配，RuleVersion 快照记录 |

### 3.7 运行时全量测试（2026-02-17）

干净数据库 `db push --force-reset` + 种子入库 + NestJS 启动后，43 项 API 运行时测试全部通过：

| 分类 | 测试项 | 数量 | 结果 |
|------|--------|------|------|
| 种子数据 | VIP 等级/推荐码/钱包余额/冻结金额/三叉树/订单/状态计数 | 10 | ✅ 全通过 |
| 订单全流程 | 创建/支付/状态拦截(已支付不能取消)/取消/确认收货 | 5 | ✅ 全通过 |
| 普通广播分润 | 桶首笔无受益人(正确)/后续订单触发分配/流水记录生成 | 5 | ✅ 全通过 |
| VIP 上溯分润 | u-006 下单 128 元 → u-001 作为上级收到分润/流水记录 | 5 | ✅ 全通过 |
| 售后退款+回滚 | 申请售后成功/分润金额被正确扣回 | 2 | ✅ 全通过 |
| 管理后台 | 登录/会员列表/提现列表/提现审批/frozen 正确(>=0) | 5 | ✅ 全通过 |
| 订单详情 | 详情加载/addressSnapshot 字段 | 2 | ✅ 全通过 |
| 其他模块 | 商品/企业/签到/消息/任务/地址/购物车/预约/关注 | 9 | ✅ 全通过 |
| **总计** | | **43** | **✅ 0 失败** |

**测试过程中发现并修复的 bug：**
1. 种子 `MemberProfile.upsert` 使用 `update: {}` → 重跑时已有数据不会更新（u-001 保持 NORMAL）→ 改为包含完整 update 字段
2. 提现冻结金额不一致 → 种子创建 50 元提现但未冻结对应金额 → frozen 改为 62.30（12.30 VIP + 50 提现）
3. 种子 `RewardAccount.upsert` 同样需要 update 字段确保幂等重跑

---

## 阶段四：管理后台前端联调测试 ✅

> **目标**：启动管理后台前端 Vite 开发服务器，逐页面对接后端 API，验证数据加载、表单提交、权限控制、审计日志等功能，修复联调中发现的问题

### 4.0 前置条件

- ✅ 后端 NestJS 运行中（localhost:3000）
- ✅ PostgreSQL 数据库已种子填充
- ✅ 管理后台前端代码编译零错误（Vite 构建通过）
- ✅ 超级管理员账号：`admin` / `admin123456`

### 4.1 环境启动

| 步骤 | 操作 | 状态 |
|------|------|------|
| 启动后端 | `cd backend && npm run start:dev` → localhost:3000 | ✅ |
| 启动管理后台 | `cd admin && npm run dev` → localhost:5179 | ✅ |
| 确认 API 代理/CORS | Vite proxy `/api` → localhost:3000，跨域正常 | ✅ |

### 4.2 逐页面联调测试

#### 4.2.1 认证系统（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 登录页渲染 | 页面正常加载，表单可输入 | ✅ |
| 登录功能 | admin/admin123456 登录成功，JWT 存储到 Zustand | ✅ |
| 路由守卫 | 未登录访问 `/` 自动跳转 `/login` | ✅ |
| 登录后跳转 | 登录成功后跳转 Dashboard | ✅ |
| 登出功能 | 点击退出 → 清除 Token → 回到登录页 | ✅ |

#### 4.2.2 Dashboard（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 统计卡片 | 用户数/订单数/销售额/企业数正确加载 | ✅ |
| 趋势图 | 图表渲染无报错 | ✅ |
| 数据准确性 | 数据与种子数据匹配 | ✅ |

#### 4.2.3 商品管理（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 商品列表 | ProTable 加载 6 个种子商品 | ✅ |
| 搜索/筛选 | 按名称搜索、按状态筛选 | ✅ |
| 商品编辑 | 进入编辑页，表单回填正确 | ✅ |
| 上下架 | 修改商品状态，API 调用成功 | ✅ |

#### 4.2.4 订单管理（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 订单列表 | ProTable 加载种子订单 | ✅ |
| 状态筛选 | 按订单状态筛选 | ✅ |
| 订单详情 | 点击查看详情，商品/地址/物流信息正确 | ✅ |
| 发货操作 | 填写快递单号，发货成功 | ✅ |
| 退款操作 | 退款审批，状态变更正确 | ✅ |

#### 4.2.5 用户管理（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| App 用户列表 | 加载买家用户列表 | ✅ |
| 用户详情 | 查看用户资料 | ✅ |
| 封禁/解封 | 操作成功，审计日志记录 | ✅ |

#### 4.2.6 管理员账号 + 角色权限（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 管理员列表 | 加载管理员账号 | ✅ |
| 创建管理员 | 新建账号 + 分配角色 | ✅ |
| 角色列表 | 加载 3 个系统角色 | ✅ |
| 权限矩阵 | 角色权限勾选界面正确 | ✅ |
| 权限控制 | 用非超管账号登录，验证 PermissionGate 按钮显隐 | ✅ |

#### 4.2.7 审计日志（P0）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 日志列表 | ProTable 加载审计日志 | ✅ |
| Diff 视图 | AuditDiffViewer 展示 before/after 对比 | ✅ |
| 回滚功能 | 选择可回滚日志 → 回滚 → 数据恢复 | ✅ |

#### 4.2.8 企业管理（P1）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 企业列表 | 加载 4 家种子企业 | ✅ |
| 企业详情 | 企业信息 + 资质文档 | ✅ |
| 审核操作 | 审核通过/拒绝 | ✅ |

#### 4.2.9 会员/提现管理（P1）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 会员列表 | 加载会员，等级显示 NORMAL/VIP | ✅ |
| 提现列表 | 加载提现申请 | ✅ |
| 提现审批 | 审批通过 → frozen 正确扣减 | ✅ |
| 提现拒绝 | 拒绝 → frozen 退回 balance | ✅ |

#### 4.2.10 溯源管理（P2）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 批次列表 | 加载溯源批次 | ✅ |
| 创建批次 | 表单提交成功 | ✅ |
| 编辑/删除 | CRUD 操作正常 | ✅ |

#### 4.2.11 系统配置（P2）

| 测试项 | 验证点 | 状态 |
|--------|--------|------|
| 配置列表 | 加载 RuleConfig 记录（含分润参数） | ✅ |
| 修改配置 | 编辑配置值 → 保存 → RuleVersion 生成 | ✅ |

### 4.3 联调修复记录

> 2026-02-17 联调测试，12 个 API 端点通过 Vite proxy 全部验证通过

**Bug #1：订单/审计 DTO 分页参数被拒绝**
- 现象：`GET /api/v1/admin/orders` 和 `/admin/audit` 返回 400 `property page should not exist`
- 原因：全局 `ValidationPipe` 配置了 `forbidNonWhitelisted: true`，Orders/Audit DTO 未声明 `page`/`pageSize` 字段
- 修复：`admin-order.dto.ts` 和 `audit-query.dto.ts` 添加 `@IsOptional() @IsNumberString() page/pageSize`
- 备注：Products 等模块使用 `@Query('page') page` 单独提取参数故不受影响

**Bug #2：Dashboard 统计卡片全部显示 0**
- 现象：前端 Dashboard 四张卡片数值均为 0
- 原因：后端返回 `{ overview: { userCount, orderCount, ... } }` 嵌套结构，前端按 `stats.totalUsers` 平铺访问
- 修复：`admin-stats.service.ts` → `getDashboard()` 返回平铺结构 `{ totalUsers, totalOrders, totalRevenue, totalProducts, ... }`

**Bug #3：销售趋势图不渲染**
- 现象：趋势图表区域空白
- 原因：后端返回字段名 `{ orders, sales }`，前端图表配置 `yField: 'amount'`
- 修复：`admin-stats.service.ts` → `getSalesTrend()` 字段名改为 `{ count, amount }`

**Bug #4：订单列表缺少 orderNo 和用户手机号**
- 现象：订单列表 orderNo 列和 user.phone 列为空
- 原因：后端 findAll 未映射 `orderNo` 字段，未关联 `authIdentities` 获取手机号
- 修复：`admin-orders.service.ts` → `findAll()` 添加 `orderNo: o.id` 映射，include `authIdentities` where `provider: 'PHONE'` 获取手机号

**Bug #5：订单详情缺少地址/支付金额/商品名称**
- 现象：订单详情页 address/paymentAmount/productTitle 字段为 null
- 原因：后端 findById 直接返回原始数据，未做前端类型适配
- 修复：`admin-orders.service.ts` → `findById()` 添加 `paymentAmount = totalAmount - discountAmount`、`address = addressSnapshot`、items 映射 `productTitle`/`skuName`/`productId`

**Bug #6：企业列表联系人信息为空**
- 现象：企业列表 contactName/contactPhone 列为空
- 原因：Company 模型将联系人存储为 `contact` JSON 字段，无独立的 contactName/contactPhone 列
- 修复：`admin-companies.service.ts` → findAll/findById 从 `contact` JSON 中提取 `name`/`phone`

**Bug #7：种子数据缺少订单地址快照和企业联系人**
- 现象：订单 addressSnapshot 为 null，企业 contact 为 null
- 修复：`seed.ts` 添加 `defaultAddressSnapshot`（收货地址）到所有 4 笔订单，添加 `companyContacts` map 到所有 4 家企业

**Bug #8：TypeScript 编译错误 — channel vs provider**
- 现象：9 个 TS 编译错误 `channel does not exist on AuthIdentityWhereInput`
- 原因：AuthIdentity 模型使用 `provider` 枚举（PHONE/EMAIL/WECHAT），代码中误用 `channel`
- 修复：所有 `where: { channel: 'PHONE' }` 改为 `where: { provider: 'PHONE' }`

### 4.4 验证标准

- [x] 所有 P0 页面数据正常加载（登录/Dashboard/商品/订单/用户/管理员/角色/审计 ✅）
- [x] 所有 P1 页面数据正常加载（企业/会员/提现 ✅）
- [x] 所有 P2 页面数据正常加载（溯源/系统配置 ✅）
- [x] 所有写操作（CRUD/审批/发货/退款）API 调用成功
- [x] 权限控制：PermissionGuard + PermissionGate 按权限控制
- [x] 审计日志：写操作后自动记录，diff 视图正确
- [x] 回滚：审计日志回滚功能可用
- [x] 12 个 E2E API 端点通过 Vite proxy 全部验证通过
- [x] 8 项后端 bug 修复（详见 4.3）

---

## 阶段五：买家 App UI 重建 ✅

> **目标**：按 `frontend.md` 设计稿将买家 App 重建为 AI-native 风格

详见下方「买家 App UI 重建」章节（Batch 1-7 全部完成）。

### 阶段五补充：生产就绪补全（2026-02-20）✅

全面审计后补全的 3 项关键功能：

| 项目 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 退出登录按钮 | `app/settings.tsx` + `src/repos/AuthRepo.ts` | 设置页底部退出按钮，确认弹窗 → 后端 session 撤销 → 本地清理 | ✅ |
| 支付回调 Webhook | `backend/src/modules/payment/payment.controller.ts` + `payment.service.ts` | `POST /api/v1/payments/callback` 公开端点，幂等处理，事务更新 Payment + Order 状态 | ✅ |
| 文件上传模块 | `backend/src/modules/upload/` (controller + service + module) | 单文件/批量上传（最多9张）+ 删除，类型白名单 + 10MB 限制，本地存储（OSS 预留） | ✅ |

---

## 阶段六：卖家系统构建 ✅

> **目标**：构建多商户入驻的卖家 Web 后台，让企业自主管理商品/订单/发货/售后
>
> 详细设计文档：`sales.md`

### 6.1 数据模型 + 后端认证 ✅

| 步骤 | 内容 | 状态 |
|------|------|------|
| Schema 新增 CompanyStaff + SellerSession 模型 | `prisma/schema.prisma` | ✅ |
| 种子数据：4 个企业主 OWNER | `seed.ts` | ✅ |
| 卖家 JWT 策略 + Guard | `seller-jwt.strategy.ts` + `seller-auth.guard.ts` | ✅ |
| 卖家登录/登出/刷新/选择企业 API | `seller-auth.controller.ts` | ✅ |
| @CurrentSeller() 装饰器 + SellerRoleGuard | `current-seller.decorator.ts` + `seller-role.guard.ts` | ✅ |
| SellerModule 注册到 AppModule | `app.module.ts` | ✅ |
| prisma validate + tsc --noEmit 零错误 | 验证通过 | ✅ |

### 6.2 核心业务 API ✅

| 步骤 | 内容 | 状态 |
|------|------|------|
| 商品管理 CRUD（创建/编辑/上下架/SKU/媒体） | `seller-products.*` | ✅ |
| 订单查询 + 发货 + 批量发货 | `seller-orders.*` | ✅ |
| 售后处理（同意/拒绝退款） | `seller-refunds.*` | ✅ |
| 物流查询 | `seller-shipments.*` | ✅ |
| 企业资料管理 + 员工管理（邀请/修改/移除） | `seller-company.*` | ✅ |

### 6.3 数据看板 API ✅

| 步骤 | 内容 | 状态 |
|------|------|------|
| 概览统计（今日/本月/总计） | `seller-analytics.*` | ✅ |
| 销售趋势 + 商品排行 + 订单统计 | `seller-analytics.*` | ✅ |

### 6.4 卖家前端（seller/）

| 步骤 | 内容 | 状态 |
|------|------|------|
| 项目初始化（Vite + React + Ant Design + ProLayout） | `seller/` | ✅ |
| 登录页 + 选择企业页 | `seller/src/pages/login/` | ✅ |
| 工作台（概览+待办+趋势图） | `seller/src/pages/dashboard/` | ✅ |
| 商品管理（列表+编辑/创建+SKU管理+图片上传） | `seller/src/pages/products/` | ✅ |
| 订单管理（列表+详情+发货） | `seller/src/pages/orders/` | ✅ |
| 售后处理页 | `seller/src/pages/refunds/` | ✅ |
| 数据报表页 | `seller/src/pages/analytics/` | ✅ |
| 企业设置 + 员工管理页 | `seller/src/pages/company/` | ✅ |
| 溯源管理页（CRUD + meta 属性编辑） | `seller/src/pages/trace/` | ✅ |

### 6.4.1 AI 搜索增强 ✅

> 为 AI 语音助手提供更丰富的文本数据，让买家更容易找到商品和企业

| 改动 | 说明 | 状态 |
|------|------|------|
| 商品描述必填（≥20字）+ AI 提示语 | 后端 DTO + 前端表单 | ✅ |
| 商品分类选择器（TreeSelect） | 新增 categories API 调用 + 前端组件 | ✅ |
| 商品产地必填 | 后端 DTO + 前端表单 | ✅ |
| AI 搜索关键词输入 | 后端 `aiKeywords` 字段 + 前端逗号分隔输入 | ✅ |
| 商品属性编辑器 | 后端 `attributes` JSON + 前端动态键值对 | ✅ |
| 商品图片上传 | Dragger 组件 + `/api/v1/upload` 集成 | ✅ |
| 企业简介必填（≥20字）+ AI 提示语 | 前端表单验证 | ✅ |
| 企业经营地址 | 后端 `address` JSON + 前端文本输入 | ✅ |
| 企业亮点编辑 | 后端 `CompanyProfile.highlights` upsert + 前端键值编辑器 | ✅ |
| 溯源管理（卖家端） | 后端 `SellerTraceModule` CRUD + 前端溯源页面 | ✅ |

### 6.5 管理端联动改造 ✅

| 步骤 | 内容 | 状态 |
|------|------|------|
| 商品审核队列适配（卖家提交 → 管理员审核） | Tab 切换+Badge+增强审核 Modal | ✅ |
| 企业入驻绑定 OWNER | 后端 API + 前端员工列表+绑定 | ✅ |
| 售后仲裁功能 | 后端仲裁 API + 前端退款管理页 | ✅ |

### 6.6 端到端验证 ✅

| 检查项 | 结果 |
|--------|------|
| `npx prisma validate` — Schema 完整性 | ✅ 通过 |
| `npx tsc --noEmit` — 后端编译 | ✅ 零错误 |
| `npx tsc -b` — 卖家前端编译 | ✅ 零错误 |
| `npx tsc -b` — 管理前端编译 | ✅ 零错误（修复 12 处预存 lint 问题） |
| 卖家端权限隔离 — SellerAuthGuard + companyId 过滤 | ✅ 全部 8 个服务通过 |
| 管理端权限隔离 — AdminAuthGuard + PermissionGuard | ✅ 全部 13 个控制器通过 |

---

## 性能优化 ✅

> **目标**：为核心服务添加缓存层，优化高频查询，消除 N+1 和循环查询反模式

### 缓存基础设施

| 组件 | 文件 | 说明 |
|------|------|------|
| TtlCache 通用类 | `backend/src/common/ttl-cache.ts` | 基于 Map 的泛型内存 TTL 缓存，支持 get/set/invalidate/invalidatePrefix/clear |

> 注：`ioredis` 已安装为生产依赖，待多实例部署时升级为 Redis 缓存。当前单实例部署下内存缓存已满足需求。

### 服务级缓存

| 服务 | 缓存 Key | TTL | 失效触发 | 状态 |
|------|----------|-----|----------|------|
| AdminStatsService | `dashboard` | 30s | — | ✅ |
| SellerAnalyticsService | `overview:${companyId}` | 30s | 订单/商品变更时调用 `invalidateOverviewCache()` | ✅ |
| ProductService | `categories:all` | 5min | `invalidateCategoriesCache()` | ✅ |
| CompanyService | `companies:all` | 3min | `invalidateListCache()` | ✅ |
| BonusConfigService | 单对象属性缓存 | 60s | 管理端修改配置时 `invalidateCache()` | ✅ |

### SQL 查询优化

| 优化点 | 文件 | 改动 | 效果 |
|--------|------|------|------|
| Admin 销售趋势 | `admin-stats.service.ts` | 7 天 for 循环 → `GROUP BY DATE()` 单条 SQL | 14 查询→2（86%↓） |
| Admin 分润统计 | `admin-stats.service.ts` | 7 天 for 循环 → `GROUP BY DATE()` 单条 SQL | 7 查询→1（85%↓） |
| 卖家销售趋势 | `seller-analytics.service.ts` | 已有 raw SQL，补充缓存层 | 30s 内重复请求零查询 |
| 卖家商品排行 | `seller-analytics.service.ts` | JOIN + GROUP BY 聚合 | 单查询完成排行计算 |
| 卖家订单状态分布 | `seller-analytics.service.ts` | `GROUP BY status` 单查询 | ✅ |

### 事务与并发优化

| 优化点 | 说明 | 状态 |
|--------|------|------|
| CAS 库存扣减 | `updateMany(where: { stock >= qty })` 原子操作防超卖 | ✅ |
| 订单幂等键 | `idempotencyKey` 唯一约束防重复下单 | ✅ |
| 支付 Serializable 隔离 | 支付事务使用最高隔离级别防竞态 | ✅ |
| 批量支付 PaymentGroup | 多订单合并为单个支付组，单事务处理 | ✅ |

---

## UI 增强 ✅

> **目标**：补齐买家 App 和管理后台的三项体验增强功能

### H02 — 退款商品选择 ✅

| 改动 | 文件 | 状态 |
|------|------|------|
| 复选框逐项选择退款商品 | `app/orders/after-sale/[id].tsx` | ✅ |
| 数量步进器（1 ~ 原始购买数量） | 同上 | ✅ |
| 预估退款金额实时计算 | 同上 | ✅ |
| 不选择 = 全额退款 | 同上 | ✅ |
| `OrderRepo.applyAfterSale` 支持 `items` 参数 | `src/repos/OrderRepo.ts` | ✅ |

### N09 — 结算页商户拆单展示 ✅

| 改动 | 文件 | 状态 |
|------|------|------|
| 预结算接口 `OrderRepo.previewOrder` | `src/repos/OrderRepo.ts` | ✅ |
| 按商户分组卡片（商户图标 + 名称 + 商品列表） | `app/checkout.tsx` | ✅ |
| 每组小计（商品金额 / 运费 / 优惠） | 同上 | ✅ |
| 无 preview 数据时降级扁平展示 | 同上 | ✅ |

### N16 — 合并支付 ✅

| 改动 | 文件 | 状态 |
|------|------|------|
| `OrderRepo.batchPayOrders` 批量支付 | `src/repos/OrderRepo.ts` | ✅ |
| 拆单后一次支付覆盖所有子订单 | `app/checkout.tsx` | ✅ |

### 管理端 VIP 分析仪表盘 ✅

| 改动 | 文件 | 状态 |
|------|------|------|
| 奖励统计 KPI（累计分配/提现/VIP 数/待审核） | `admin/src/pages/dashboard/index.tsx` | ✅ |
| 奖励分配趋势柱状图（近 7 天） | 同上 | ✅ |
| VIP 会员占比仪表盘 | 同上 | ✅ |
| 后端 `/admin/stats/bonus` 接口 | `backend/src/modules/admin/stats/admin-stats.service.ts` | ✅ |

---

## 阶段七：普通用户分润奖励系统改造 ✅

> **目标**：改造普通用户奖励系统为树结构分配，新增抽奖、自动定价、运费规则、换货流程
> **详细计划**：见 [`plan-treeforuser.md`](./plan-treeforuser.md) — 完整的九大改动项、数据模型、后端模块、前端变更、安全控制

### 7.1 实施阶段

| Phase | 内容 | 优先级 | 状态 |
|-------|------|--------|------|
| A | **数据模型与基础设施** — Prisma Schema 变更（7 新模型 + 枚举 + 字段）、迁移、种子数据、RuleConfig 初始化、BonusConfigService 扩展 | 最高 | ✅ |
| B | **普通用户树引擎** — normal-upstream.service.ts、利润六分、路由决策、轮询平衡插入、冻结过期 Cron、VIP冻结过期改造 | 高 | ✅ |
| C | **抽奖系统** — 抽奖后端模块 + 管理后台奖池管理 + 奖励商品管理 + 买家App转盘 + 购物车奖品逻辑 | 高 | ✅ |
| D | **定价与运费改造** — 自动定价（cost×1.3）+ 卖家SKU表单改造 + ShippingRule运费规则 + 订单运费重写 | 中 | ✅ |
| E | **换货流程** — ReplacementRequest 替代 Refund，买家/卖家/管理端三端换货审核，移除退款UI | 中 | ✅ |
| F | **管理后台配置整合** — 普通系统参数配置、VIP系统参数独立、普通树查看器、菜单权限 | 低 | ✅ |
| G | **前端集成与优化** — 买家App普通树可视化、奖励钱包区分、冻结倒计时、联调测试、文档更新 | 低 | ✅ |

### 7.2 九大改动项概览

| # | 改动 | 影响范围 | 对应 Phase |
|---|------|----------|------------|
| 1 | 首页抽奖转盘（每日一次，低价买/满赠两类奖品）✅ 含转盘动画升级 | 买家App、管理后台、后端 | C |
| 2 | 普通用户分润树（取消滑动窗口，改多叉树，自动入树） | 后端核心 | A+B |
| 3 | 奖励分配机制（第k次消费→k层祖辈，冻结30天过期） | 后端核心 | B |
| 4 | 利润六分（50/16/16/8/8/2） | 后端 | B |
| 5 | 自动定价（卖家设成本，售价=成本×130%） | 卖家后台、后端 | D |
| 6 | VIP排除（VIP用户在普通树不领奖励） | 后端 | B |
| 7 | 运费三维度（金额×地区×重量） | 管理后台、后端 | D |
| 8 | 取消退款改换货 | 全端 | E |
| 9 | 普通/VIP完全独立（参数隔离） | 管理后台、后端 | A+F |

### 7.3 关键技术决策

| 决策 | 结论 |
|------|------|
| 普通树结构 | 单棵树、单个平台根节点（Level 0），轮询平衡插入 |
| 分配机制 | 与VIP一致：第k次消费→k层祖辈，maxLayers=15，到根停止（两个独立停止条件） |
| VIP利润公式 | 与普通用户统一为六分结构，VIP默认50/30/10/2/2/6（平台/奖励/产业基金/慈善/科技/备用金） |
| 冻结过期 | VIP系统**新增**冻结过期（VIP_FREEZE_DAYS），与普通系统独立配置 |
| 根节点奖励 | 直接归平台（不走冻结流程） |

> **注意**：每完成一个 Phase，需同步更新相关文档（data-system.md / backend.md / frontend.md / sales.md / tofix-safe.md / security-audit.md）

---

## 全系统审查修复（9 轮，60+ 项） ✅

> **目标**：对买家 App、卖家后台、管理后台、后端进行全面代码审查，修复所有 High/Critical 问题
> **完成时间**：2026-02-28

### 审查范围与成果

| 轮次 | 范围 | 修复项数 | 关键修复 |
|------|------|----------|----------|
| 第 1-3 轮 | 后端核心模块 | ~20 | Schema 安全约束、并发事务隔离、种子数据完整性 |
| 第 4-5 轮 | 买家 App 前端 | ~12 | TypeScript 类型对齐、Repository 层方法签名、Store 状态同步 |
| 第 6-7 轮 | 卖家后台 + 管理后台 | ~15 | ProTable 列定义、权限标识一致、API 路径匹配 |
| 第 8 轮 | 跨系统一致性 | ~8 | 枚举值三端对齐、DTO 字段匹配、文档同步 |
| 第 9 轮 | 安全与性能 | ~10 | Serializable 隔离级别、CAS 模式、P2034 重试、PaginationInterceptor |

### 关键技术改进

| 改进 | 说明 |
|------|------|
| CheckoutSession 流程 | 付款后才创建订单：引入 CheckoutSession 替代旧 createFromCart，支付回调原子建单 |
| 3 个废弃端点返回 410 Gone | `POST /orders`（createFromCart）、`POST /orders/:id/pay`（payOrder）、`POST /orders/batch-pay`（batchPayOrders） |
| WebhookIpGuard | 支付/物流回调端点的 IP 白名单安全守卫 |
| PaginationInterceptor | 全局 pageSize 上限钳制（防止恶意大分页请求） |
| Serializable 事务隔离 | 所有金额/库存/奖励/奖金/支付操作强制使用最高隔离级别 |
| CAS + P2034 重试 | 乐观并发控制 + Prisma 序列化冲突自动重试（最多 3 次，指数退避） |
| onDelete: Restrict | 关键外键添加删除保护（User→Order、Order→Payment、Order→Refund 等） |
| 5 个新 FK 索引 | ProductMedia.productId、InventoryLedger.skuId、OrderItemTraceLink.orderItemId、ShipmentTrackingEvent.shipmentId、RewardLedger.allocationId |

---

## 当前阶段：平台红包系统（阶段八）

> **目标**：构建平台红包（优惠券）体系 + 分润奖励概念重命名
> **状态**：进行中
> **详细计划**：见 [`redpocket.md`](./redpocket.md)

---

## 阶段八：平台红包系统

> **目标**：构建独立于分润奖励系统的平台红包（优惠券）体系，支持多种发放机制和结算抵扣
> **详细计划**：见 [`redpocket.md`](./redpocket.md) — 完整需求、数据模型、API 设计、管理后台页面、买家 App 改造、实施步骤

### 8.1 核心改造

| 改造项 | 说明 | 影响范围 |
|--------|------|----------|
| 概念分离 | 分润奖励（树分配收益）只能提现，平台红包（优惠券）可结算抵扣 | 全端 |
| 分润奖励重命名 | 所有 UI 中"红包"改为"奖励"/"分润奖励" | 买家 App + 管理后台 |
| 平台红包数据模型 | 新建 CouponCampaign / CouponInstance / CouponUsageRecord 模型 | 后端 Schema |
| 管理后台红包管理 | 活动创建/编辑/上下架、发放记录、使用记录、数据统计 | 管理后台 |
| 结算流程改造 | 结算抵扣从分润奖励切换为平台红包，支持多张叠加 | 买家 App + 后端 |
| 买家 App 红包页 | 现有"红包"入口改为展示平台红包（可用/已用/已过期） | 买家 App |

### 8.2 实施阶段

| Phase | 内容 | 优先级 | 状态 |
|-------|------|--------|------|
| A0 | **分润奖励代码重命名** — `RedPack`/`RED_PACKET` → `Reward`/`VIP_REWARD`/`NORMAL_REWARD`，Prisma 枚举迁移 + 全端代码 + 文档 | 最高 | ✅ |
| A | 数据模型设计 — Prisma Schema 新增 3 模型 + 枚举 + 迁移 | 最高 | ✅ |
| B | 后端红包模块 — CouponService + CouponController + AdminCouponController | 高 | ✅ |
| C | 管理后台页面 — 活动管理 + 发放记录 + 使用记录 + 数据统计 | 高 | ✅ |
| D | 结算流程改造 — CheckoutSession 支持多张红包抵扣 + 移除分润奖励抵扣 | 高 | ✅ |
| E | 买家 App UI — 红包列表页 + 结算选择 + 分润奖励页面重命名 | 中 | ✅ |
| F | 自动发放引擎 — 触发条件系统 + 定时任务 + 事件监听 | 中 | ✅ |
| G | 联调测试与文档更新 — G1 全流程联调 ✅ G2 并发安全测试 ✅ | 低 | ✅ |

---

## 阶段九：第三方服务接入

> **目标**：接入真实的支付/物流/语音/地图/云服务
> **详细指南**：见 [`apikey.md`](./apikey.md) — 每个服务的注册网址、操作步骤、环境变量、代码替换位置

### 9.1 已就绪的集成点

| 集成点 | 文件 | 说明 | 状态 |
|--------|------|------|------|
| 支付回调 Webhook | `payment.service.ts` | 幂等处理 + 事务更新 + HMAC 签名验证 | ✅ 就绪 |
| 物流回调 Webhook | `shipment.service.ts` | 状态更新 + 轨迹记录 | ✅ 就绪 |
| 文件上传模块 | `upload.service.ts` | `UPLOAD_LOCAL` 开关，已有 OSS 注释模板 | ✅ 就绪 |
| SMS Mock 开关 | `auth.service.ts` | `SMS_MOCK` 开关，`console.log` 打印验证码 | ✅ 就绪 |
| 微信登录 Mock | `auth.service.ts` | `WECHAT_MOCK` 开关，假 openId 生成 | ✅ 就绪 |

### 9.2 接入计划（按优先级分批）

**第一批：核心功能（P0）— 阿里云 SMS + OSS**

| 服务 | 提供商 | 注册网址 | 需获取 | 代码替换位置 | 状态 |
|------|--------|----------|--------|-------------|------|
| 短信 | 阿里云 SMS | https://www.aliyun.com/product/sms/ | AccessKey + 签名 + 模板 | `auth.service.ts` → `SMS_MOCK=false` | ⬜ |
| 云存储 | 阿里云 OSS | https://oss.console.aliyun.com/ | AccessKey + Bucket | `upload.service.ts` → `UPLOAD_LOCAL=false` | ⬜ |

> 两个服务共用同一个阿里云账号和 AccessKey

**第二批：支付流程（P1）— 微信支付 + 支付宝**

| 服务 | 提供商 | 注册网址 | 需获取 | 代码替换位置 | 状态 |
|------|--------|----------|--------|-------------|------|
| 微信支付 | WeChat Pay v3 | https://pay.weixin.qq.com/ | 商户号 + APIv3 Key + 证书 | `payment.service.ts` | ⬜ |
| 支付宝 | Alipay | https://open.alipay.com | AppId + RSA 密钥对 | `payment.service.ts` | ⬜ |

**第三批：体验增强（P2）— 物流 + 地图 + 微信登录**

| 服务 | 提供商 | 注册网址 | 需获取 | 代码替换位置 | 状态 |
|------|--------|----------|--------|-------------|------|
| 物流查询 | 快递100 | https://api.kuaidi100.com/ | customer + key | `shipment.service.ts` | ⬜ |
| 地图 | 高德 Web API | https://lbs.amap.com/ | API Key | `address.service.ts` | ⬜ |
| 微信登录 | 微信开放平台 | https://open.weixin.qq.com | AppID + AppSecret | `auth.service.ts` → `WECHAT_MOCK=false` | ⬜ |

**第四批：AI 增强（P3）— 语音 + 推送**

| 服务 | 提供商 | 注册网址 | 需获取 | 代码替换位置 | 状态 |
|------|--------|----------|--------|-------------|------|
| 语音识别 | 讯飞 STT | https://www.xfyun.cn/ | APPID + APIKey + APISecret | `ai.service.ts` | ⬜ |
| 推送通知 | Expo Push | https://docs.expo.dev/push-notifications/ | 无需 Key（内置免费） | 新建 `notification/` 模块 | ⬜ |

### 9.3 需安装的 SDK

```bash
cd backend
npm install wechatpay-node-v3 alipay-sdk ali-oss @alicloud/dysmsapi20170525 @alicloud/openapi-client
```

---

## VIP 礼包购买系统（实施中）

> 详见 `buy-vip.md`。将"抽象的 VIP 升级"改造为"选赠品 + 结账 + 支付开通"购买流程。

### Phase 1：业务类型与赠品配置 ✅

| 改动 | 状态 |
|------|------|
| Prisma Schema: `CheckoutBizType` / `OrderBizType` 枚举 | ✅ |
| Prisma Schema: `CheckoutSession.bizType` / `bizMeta` | ✅ |
| Prisma Schema: `Order.bizType` / `bizMeta` | ✅ |
| Prisma Schema: `VipGiftOption` 模型 | ✅ |
| Prisma Schema: `VipPurchase` 扩展（giftOptionId/激活状态机/userId唯一） | ✅ |
| Prisma Schema: `VipGiftOptionStatus` / `VipActivationStatus` 枚举 | ✅ |
| 数据库迁移 SQL | ✅ |
| 后端：管理端 VIP 赠品方案 CRUD (`admin/vip/gift-options`) | ✅ |
| 后端：前台 VIP 赠品方案查询 (`bonus/vip/gift-options`) | ✅ |
| 后端：奖励商品 SKU 选择器 + SKU 引用查询 | ✅ |
| 后端：权限种子数据 (vip_gift:read/create/update) | ✅ |
| 管理后台：`购买VIP赠品` 页面 + 路由 + 菜单 | ✅ |
| 买家 App：VipGiftOption 类型 + BonusRepo 方法 | ✅ |
| 买家 App：CheckoutStore 持久化 VipPackageSelection | ✅ |
| 买家 App：Order 类型新增 bizType | ✅ |

### Phase 2：VIP 赠品选择页（前端） ✅

| 内容 | 状态 |
|------|------|
| `app/vip/_layout.tsx` — Stack 布局 | ✅ |
| `app/vip/gifts.tsx` — VIP 专属空间页面（深色+金色主题） | ✅ |
| 金色粒子动画（25 颗，react-native-reanimated UI 线程） | ✅ |
| 横向卡片轮播（FlatList snap + scale/opacity 插值） | ✅ |
| 底部固定栏（BlurView 毛玻璃 + 金色渐变按钮） | ✅ |
| VIP 权益图标行 + 推荐人提示栏 | ✅ |
| 页面状态：加载中/已是VIP/无赠品/正常展示/售罄遮罩 | ✅ |
| 导航入口：`me.tsx` VIP 按钮 → `/vip/gifts` | ✅ |
| TypeScript 编译通过 | ✅ |

### Phase 3：结账流程 + 支付开通 VIP ✅

| 项 | 状态 |
|---|---|
| VipCheckoutDto（class-validator 校验） | ✅ |
| CheckoutService.checkoutVipPackage()（Serializable 事务创建会话） | ✅ |
| POST /orders/vip-checkout 控制器端点 | ✅ |
| OrderModule BonusService 懒注入 | ✅ |
| BonusService.activateVipAfterPayment()（幂等 Serializable 事务） | ✅ |
| handlePaymentSuccess VIP 激活（3 次重试 + bizMeta 校验） | ✅ |
| OrderRepo.createVipCheckoutSession() 前端接口 | ✅ |
| checkout.tsx VIP 模式渲染（信息栏/商品卡/价格/底部栏） | ✅ |
| 前端 VIP 选择参数校验（giftOptionId/giftSkuId/price） | ✅ |
| 前端 TypeScript 编译通过 | ✅ |
| 后端 TypeScript 编译通过 | ✅ |

### Phase 4：分润入口豁免 ✅

| 项 | 状态 |
|---|---|
| `allocateForOrder()` 入口添加 `bizType === VIP_PACKAGE` 守卫 | ✅ |
| 所有 4 个调用入口均走 `allocateForOrder()`（confirmReceive / autoConfirm / compensation / replacement） | ✅ 已验证 |
| 不创建 VipEligibleOrder / NormalEligibleOrder | ✅ |
| 不递增 selfPurchaseCount | ✅ |
| 后端 TypeScript 编译通过 | ✅ |

### Phase 5：不可退款 + 订单展示 ✅

| 项 | 状态 |
|---|---|
| 后端 replacement.service `apply()` 拒绝 VIP_PACKAGE 售后 | ✅ |
| 后端 `mapOrder()` 返回 `bizType` 字段 | ✅ |
| 买家 App 订单详情隐藏"申请售后"按钮（VIP_PACKAGE） | ✅ |
| 买家 App 售后表单页前端拦截 VIP_PACKAGE | ✅ |
| 买家 App 订单详情 VIP 礼包标签 + 金色装饰条 | ✅ |
| 买家 App 订单列表 VIP 礼包 Tag | ✅ |
| 管理后台订单列表 VIP 列 + 隐藏操作按钮 | ✅ |
| 管理后台订单详情 VIP Alert 横幅 | ✅ |
| 卖家后台订单列表 VIP Tag 列 | ✅ |
| 卖家后台订单详情 VIP Alert 横幅 | ✅ |
| 四端 TypeScript 编译通过 | ✅ |

### Phase 6：通知、审计与补偿 ✅

| 项 | 状态 |
|---|---|
| InboxService.send() 通用站内消息发送方法 | ✅ |
| InboxModule 导出 InboxService | ✅ |
| OrderModule 注入 InboxService 到 CheckoutService | ✅ |
| VIP 开通成功站内通知（含赠品名称 + 订单跳转） | ✅ |
| 管理端审计日志（VIP 赠品方案 CREATE/UPDATE/STATUS_CHANGE） | ✅ 已有 |
| VipActivationStatus 状态机（PENDING/ACTIVATING/SUCCESS/FAILED/RETRYING） | ✅ 已有 |
| 赠品已发货通知 | 📝 归入通用订单发货通知系统，非 VIP 专属 |
| 后端 TypeScript 编译通过 | ✅ |

### Phase 7：推荐人机制 + H5 落地页 🔲

- 设备指纹匹配 + Deep Link
- H5 落地页（待确认核心卖点）

---

## 待办 Backlog

| 优先级 | 任务 | 说明 | 涉及范围 |
|--------|------|------|----------|
| P2 | 商品多分类支持 | 当前商品只能归属一个分类（`Product.categoryId` 一对多），改为多对多关系，允许卖家为商品选择多个分类 | Schema 迁移（新建 `ProductCategory` 关联表）+ 后端 CRUD + 卖家前端 TreeSelect 改 `multiple` + 管理后台/买家端分类筛选适配 |

---

## 待规划：H5 落地页（App推广+邀请引流）

> 状态：待设计。核心定位待确认（App整体介绍页，非VIP专属页）。

### 定位

- 新用户接触农脉的第一个页面（主要通过微信分享触达）
- 介绍整个App价值，不仅仅是VIP
- 携带 `referralCode` 参数时显示推荐人信息
- 引导下载App + 传递邀请码（剪贴板自动复制 + 手动输入兜底）

### 待确认事项

1. 农脉对外的核心卖点定位（产地直发？AI推荐？消费奖励？）
2. 入口场景：仅VIP邀请，还是通用推广页（商品分享、活动推广等）
3. 是否需要展示真实商品/价格（影响是否纯静态）
4. 技术方案：纯静态HTML vs Vite+React轻量Web项目

### 微信生态适配

- 微信内置浏览器会拦截直接跳应用商店，需引导"用浏览器打开"
- 分享卡片需要配置微信 JS-SDK（标题+描述+缩略图）

---

## 阶段十：生产部署（远期）

- 服务器选型（阿里云 ECS / AWS）
- 域名 + HTTPS（买家 API / 卖家后台 / 管理后台 / H5落地页 四个域名）
- CI/CD 流水线
- 监控告警
- 数据备份策略

---

## 附录：已完成的开发阶段

详见 `phase1-9-全栈开发记录-Schema重建与模块实现.md`（原 plan.md）

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | Schema 全量重建（60 模型 + 39 enum） | ✅ |
| 2 | Auth + User + Company 模块重建 | ✅ |
| 3 | Product + Address + Cart 模块 | ✅ |
| 4 | Order + Payment + Shipment 模块 | ✅ |
| 5 | 社交与互动模块适配 | ✅ |
| 6 | Trace 溯源模块 | ✅ |
| 7 | AI 模块 | ✅ |
| 8 | Bonus 会员奖励模块 | ✅ |
| 9 | 前端全面对接 + 新页面 | ✅ |

---

## 阶段五详情：买家 App UI 重建（按 frontend.md 设计稿）✅

依据 `frontend.md` 设计规范，分批次重建买家 App 页面为 AI-native 风格。全部完成。

| Batch | 内容 | 状态 |
|-------|------|------|
| 1 | 首页 home.tsx 重建（AI 光球交互、快捷指令、最近对话） | ✅ |
| 2A | AI 组件 + 我的页 + Tab 栏 + ProductCard 增强 | ✅ |
| 2B | Theme 基础设施重写（colors 双模式、typography fontFamily、animation.ts、ThemeProvider 双模式） | ✅ |
| 2C | AI 微交互组件（AiDivider + AiCardGlow） | ✅ |
| 2D | AppHeader 毛玻璃重写 + Screen 渐变背景（expo-blur） | ✅ |
| 2E | AiFloatingCompanion 全局浮动伴侣（路由感知上下文菜单） | ✅ |
| 2F | 发现页 museum.tsx 全面重写（AI 推荐 + 商品瀑布流 + 企业横滑） | ✅ |
| 3 | 购物链路增强（商品详情 AI 品质评分/溯源/企业信赖分 + 购物车毛玻璃 + 结算页渐变地址卡 + 搜索 AI 摘要） | ✅ |
| 4 | Phase 4 AI 功能页视觉增强（聊天/助手/推荐/金融/溯源 5 页全面升级 + 3 个新组件） | ✅ |
| 5 | Phase 5 个人中心视觉增强（14 页：钱包/VIP/三叉树/排队/提现/订单列表/订单详情/物流/售后/任务/设置/资料/地址/关注） | ✅ |
| 6 | Phase 5B 剩余页面视觉增强（10 页：分类/企业详情/拼团/消息中心/结算地址/用户主页/装扮/推荐/关于/隐私） | ✅ |
| 7 | Phase 6 全局打磨（入场动画补全5页 + 300ms标准化 + Stack/Tab过渡 + ProductCard React.memo + FlatList优化 + expo-image缓存 + 无障碍标签/hitSlop/role） | ✅ |
| 8 | 功能补全（银行卡支付+奖励抵扣+AI语音意图导航+分类芯片跳转+AuthModal登录注册重写） | ✅ |
| 9 | 前后端全面对齐（12 项修复：注册字段/支付方式/奖励端点/订单分页/购物车嵌套/状态枚举/AI端点/物流查询等） | ✅ |
| 10 | 抽奖页转盘动画升级（SpinWheel SVG转盘 + WheelPointer指针摆动 + Confetti庆祝粒子 + 5阶段状态机 + 减速着陆 + AppBottomSheet + AiTypingEffect揭奖） | ✅ |
| 11 | 卖家端/管理后台全量补全（S6-S10 卖家5项 + A11-A16 管理6项：markupRate API / statusMap清理 / isPrize标识 / 换货计数 / normal-config页 / 全局配置补齐 / 奖励商品编辑页 / 商品选择器 / 菜单清理） | ✅ |

### Batch 2A 完成详情（2026-02-19）

| 步骤 | 文件 | 操作 |
|------|------|------|
| 1. AiBadge 组件 | `src/components/ui/AiBadge.tsx` | 新建 — 5 变体 AI 标签，渐变边框 + shimmer 动效 |
| 1. AiBadge 导出 | `src/components/ui/index.ts` | 编辑 — 添加 barrel export |
| 2. AiOrb 组件 | `src/components/effects/AiOrb.tsx` | 新建 — 3 尺寸 5 状态复用光球组件 |
| 2. effects 导出 | `src/components/effects/index.ts` | 新建 — barrel export |
| 2. 首页重构 | `app/(tabs)/home.tsx` | 编辑 — 用 AiOrb 替换内联光球代码 |
| 3. ProductCard | `src/components/cards/ProductCard.tsx` | 编辑 — 新增 aiRecommend/aiReason/monthlySales |
| 4. Tab 栏 | `app/(tabs)/_layout.tsx` | 编辑 — AiOrb mini 图标 + 光点指示器 |
| 5. 我的页 | `app/(tabs)/me.tsx` | 重写 — 渐变用户卡 + 钱包VIP双卡 + 工具网格 + AI 助手区 |
