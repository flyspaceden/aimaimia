# 爱买买后端技术文档

> 版本：v3.0（CheckoutSession 流程重构 + 全系统审查修复）
> 最后更新：2026-03-01

---

## 1. 概述

爱买买后端基于 **NestJS + Prisma + PostgreSQL** 构建，为买家 React Native App 和管理后台 Web Dashboard 提供统一 RESTful API。

**已实现：**
- **买家端 21 个模块**：Auth / Product / Company / User / Order（含 CheckoutSession）/ Payment / Shipment / Address / Cart / Booking / Group / Follow / Task / CheckIn / Inbox / Trace / AI / Bonus / Upload / Lottery / **Coupon**
- **管理端 12 个模块**：Auth / Users / App-Users / Roles / Audit / Stats / Products / Orders / Companies / Bonus / Trace / Config / **Coupon**
- **卖家端 7 个模块**：Auth / Products / Orders / Refunds / Shipments / Company / Analytics
- **Prisma Schema**：70 个模型 + 43 个枚举（新增 CouponCampaign / CouponInstance / CouponUsageRecord + CouponTriggerType / CouponDistributionMode / CouponDiscountType / CouponStatus / CouponInstanceStatus）
- **平台红包引擎**：CouponEngineService 事件驱动 + 定时任务（生日/复购激励/过期清理），与分润奖励系统完全独立
- **分润引擎**：完整的奖励分配系统（普通广播 + VIP 三叉树上溯 + 平台分润）
- **种子数据**：6 个用户 + 4 家企业 + 6 个商品 + 4 笔订单 + VIP 三叉树 + 分润流水 + 管理员 RBAC

### 核心设计理念

- **前后端契约对齐**：所有响应严格遵循 `Result<T>` —— 成功 `{ ok: true, data }` / 失败 `{ ok: false, error: AppError }`
- **双端认证隔离**：买家端（JWT_SECRET + jwt strategy）与管理端（ADMIN_JWT_SECRET + admin-jwt strategy）完全独立
- **金额使用 Float/元**：与前端一致
- **账本化资金管理**：所有余额变动通过 RewardLedger 流水记录，不直接修改余额
- **可配置商业规则**：分润比例、VIP 参数等通过 RuleConfig 后台可调，修改时自动生成 RuleVersion 快照

---

## 2. 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | NestJS | ^11.0 |
| ORM | Prisma | ^6.0 |
| 数据库 | PostgreSQL | 16 |
| 认证 | @nestjs/passport + passport-jwt | ^11.0 / ^4.0 |
| Token | @nestjs/jwt | ^11.0 |
| 校验 | class-validator + class-transformer | ^0.14 / ^0.5 |
| 密码 | bcrypt | ^5.1 |
| 定时任务 | @nestjs/schedule | ^5.0 |
| 速率限制 | @nestjs/throttler | ^6.5 |
| 缓存/队列（预留） | ioredis | ^5.4 |
| 运行时 | Node.js + TypeScript | ^22 / ^5.7 |

---

## 3. 目录结构

```
backend/
├── prisma/
│   ├── schema.prisma                    # 数据库模型（67 模型 + 41 枚举）
│   ├── seed.ts                          # 种子数据（完整演示数据）
│   └── migrations/                      # Prisma 迁移历史
├── src/
│   ├── main.ts                          # 启动入口（CORS + 全局管道）
│   ├── app.module.ts                    # 根模块（全局 Guard + 所有模块注册）
│   ├── config/
│   │   └── config.module.ts             # @nestjs/config 环境变量
│   ├── prisma/
│   │   ├── prisma.module.ts             # 全局 PrismaModule
│   │   └── prisma.service.ts            # PrismaClient 封装
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts      # @Public() 跳过 JWT 验证
│   │   │   └── current-user.decorator.ts # @CurrentUser() 取当前用户
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts        # 全局买家端 JWT 守卫
│   │   ├── interceptors/
│   │   │   └── result-wrapper.interceptor.ts  # { ok: true, data } 包装
│   │   └── filters/
│   │       └── app-exception.filter.ts  # { ok: false, error } 映射
│   └── modules/
│       ├── auth/                        # 买家认证（8 端点）
│       ├── user/                        # 用户资料（2 端点）
│       ├── product/                     # 商品（2 端点）
│       ├── company/                     # 企业（2 端点 + events 2 端点）
│       ├── order/                       # 订单（12 端点 + CheckoutService + 定时任务 2 个）
│       │   ├── checkout.service.ts      # F1: CheckoutSession 流程
│       │   ├── checkout.dto.ts          # F1: 结算参数 DTO
│       ├── payment/                     # 支付查询（2 端点）
│       ├── shipment/                    # 物流查询 + 回调 stub（2 端点）
│       ├── address/                     # 地址 CRUD（5 端点）
│       ├── cart/                        # 购物车（3 端点）
│       ├── booking/                     # 预约（8 端点）
│       ├── group/                       # 考察团（6 端点）
│       ├── follow/                      # 关注（3 端点）
│       ├── task/                        # 任务（2 端点）
│       ├── check-in/                    # 签到（3 端点）
│       ├── inbox/                       # 消息（4 端点）
│       ├── trace/                       # 溯源（2 端点）
│       ├── ai/                          # AI（3 端点，keyword stub）
│       ├── bonus/                       # 会员奖励
│       │   ├── bonus.service.ts         # 会员/钱包/VIP/提现 业务
│       │   ├── bonus.controller.ts      # 9 个买家端点
│       │   └── engine/                  # 分润引擎
│       │       ├── bonus-allocation.service.ts    # 分配入口 + 退款回滚
│       │       ├── reward-calculator.service.ts   # 奖励池计算
│       │       ├── normal-broadcast.service.ts    # 普通广播（滑动窗口）
│       │       ├── vip-upstream.service.ts        # VIP 三叉树上溯
│       │       ├── platform-split.service.ts      # 平台/基金/积分分润
│       │       └── bonus-config.service.ts        # 配置读取 + 缓存
│       ├── upload/                      # 文件上传 stub
│       └── admin/                       # 管理后台（完整独立认证体系）
│           ├── admin.module.ts          # 父模块（导入 12 个子模块）
│           ├── common/
│           │   ├── strategies/admin-jwt.strategy.ts
│           │   ├── guards/admin-auth.guard.ts
│           │   ├── guards/permission.guard.ts
│           │   ├── decorators/require-permission.ts
│           │   ├── decorators/current-admin.ts
│           │   ├── decorators/audit-action.ts
│           │   └── interceptors/audit-log.interceptor.ts
│           ├── auth/                    # 管理员登录/登出/刷新
│           ├── users/                   # 管理员 CRUD + 角色分配
│           ├── app-users/               # App 买家用户管理
│           ├── roles/                   # 角色 CRUD + 权限矩阵
│           ├── audit/                   # 审计日志查询 + 回滚
│           ├── stats/                   # Dashboard 统计
│           ├── products/                # 商品管理
│           ├── orders/                  # 订单管理（发货/退款/取消）
│           ├── companies/               # 企业审核
│           ├── bonus/                   # 会员/提现审核
│           ├── trace/                   # 溯源批次 CRUD
│           └── config/                  # 系统配置编辑 + 版本历史
│       └── seller/                      # 卖家后台（独立认证体系）
│           ├── seller.module.ts         # 父模块（导入 7 个子模块）
│           ├── common/
│           │   ├── strategies/seller-jwt.strategy.ts
│           │   ├── guards/seller-auth.guard.ts
│           │   ├── guards/seller-role.guard.ts
│           │   └── decorators/current-seller.decorator.ts
│           ├── auth/                    # 卖家登录/登出/刷新/选择企业
│           ├── products/                # 商品 CRUD + SKU + 媒体
│           ├── orders/                  # 订单查询 + 发货 + 批量发货
│           ├── refunds/                 # 售后处理
│           ├── shipments/               # 物流查询
│           ├── company/                 # 企业资料 + 员工管理
│           └── analytics/               # 数据看板
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env
```

---

## 4. 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | ✅ |
| `JWT_SECRET` | 买家端 JWT 签名密钥 | ✅ |
| `ADMIN_JWT_SECRET` | 管理端 JWT 签名密钥 | ✅ |
| `SELLER_JWT_SECRET` | 卖家端 JWT 签名密钥 | ✅ |
| `JWT_EXPIRES_IN` | 买家端 Access Token 有效期 | 默认 `15m` |
| `SMS_MOCK` | 模拟短信（`true` 验证码打印到 console） | 默认 `true` |
| `PORT` | 服务端口 | 默认 `3000` |
| `CORS_ORIGINS` | 允许的跨域来源（逗号分隔） | 默认 localhost |
| `REDIS_URL` | Redis 连接字符串（预留） | 可选 |

---

## 5. 启动与部署

### 开发启动

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run start:dev
# → 🌾 爱买买后端已启动: http://localhost:3000/api/v1
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run start:dev` | 开发模式（watch） |
| `npm run build` | 编译 TypeScript |
| `npm run start:prod` | 生产模式 |
| `npx prisma studio` | 可视化数据库管理 |
| `npx prisma migrate dev` | 创建迁移 |
| `npx prisma db seed` | 填充种子数据 |
| `npx prisma validate` | 验证 Schema |

---

## 6. 全局中间件

| 层 | 文件 | 说明 |
|---|------|------|
| ResultWrapperInterceptor | `common/interceptors/result-wrapper.interceptor.ts` | 成功响应包装为 `{ ok: true, data }` |
| AppExceptionFilter | `common/filters/app-exception.filter.ts` | 异常映射为 `{ ok: false, error: AppError }` |
| JwtAuthGuard | `common/guards/jwt-auth.guard.ts` | 全局买家端 JWT 守卫，`@Public()` 豁免 |
| ValidationPipe | `main.ts` | DTO 校验 + `whitelist: true` + `forbidNonWhitelisted: true` |
| ThrottlerGuard | `app.module.ts` | 全局速率限制（默认 60 请求/分钟） |
| PaginationInterceptor | `common/interceptors/pagination.interceptor.ts` | 全局 pageSize 上限钳制（防止恶意大分页请求） |
| WebhookIpGuard | `common/guards/webhook-ip.guard.ts` | 支付/物流回调端点的 IP 白名单安全守卫 |

**异常映射规则：**

| HTTP 状态码 | AppErrorCode | displayMessage |
|-------------|-------------|----------------|
| 400 | `INVALID` | 取 message 内容 |
| 401 | `FORBIDDEN` | "请先登录" |
| 403 | `FORBIDDEN` | "暂无权限" |
| 404 | `NOT_FOUND` | "未找到相关内容" |
| 500+ | `UNKNOWN` | "服务器开小差了" |

---

## 7. 认证系统

### 7.1 三端认证架构

| | 买家端 | 管理端 | 卖家端 |
|---|---|---|---|
| JWT Secret | `JWT_SECRET` | `ADMIN_JWT_SECRET` | `SELLER_JWT_SECRET` |
| Token 有效期 | 15m | 8h | 8h |
| Strategy | `jwt` | `admin-jwt` | `seller-jwt` |
| Guard | 全局 `JwtAuthGuard` | 控制器级 `AdminAuthGuard` | 控制器级 `SellerAuthGuard` |
| Payload | `{ sub: userId }` | `{ sub: adminUserId, type: 'admin', roles[] }` | `{ sub: userId, companyId, staffId, role }` |
| Session 存储 | `Session` 表 | `AdminSession` 表 | `SellerSession` 表 |

**共存方式：** Admin/Seller 控制器用 `@Public()` 绕过全局买家 Guard，再显式使用各自的 Guard。三套 JWT 密钥完全隔离。卖家端额外使用 `@CurrentSeller()` 装饰器注入 `{ userId, companyId, staffId, role }`，所有数据查询强制 `companyId` 过滤确保多商户数据隔离。

### 7.2 买家认证端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/auth/sms/code` | POST | 发送短信验证码（Mock 打印到 console） |
| `/auth/email/code` | POST | 发送邮箱验证码 |
| `/auth/login` | POST | 登录（phone/email × code/password） |
| `/auth/register` | POST | 注册（强制验证码验证） |
| `/auth/refresh` | POST | 刷新 Token |
| `/auth/logout` | POST | 登出（吊销 Session） |
| `/auth/oauth/wechat` | POST | 微信登录（占位） |
| `/auth/oauth/apple` | POST | Apple 登录（占位） |

**验证码：** 6 位随机数字，bcrypt 哈希存储，5 分钟有效期。SMS/邮件端点有 `@Throttle` 速率限制（1 次/分钟/IP）。

**自动注册：** 验证码登录时如用户不存在，自动创建账号并返回 Token。

### 7.3 管理端认证端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/admin/auth/login` | POST | 管理员登录（username + password） |
| `/admin/auth/logout` | POST | 管理员登出 |
| `/admin/auth/refresh` | POST | 刷新 Token |
| `/admin/auth/profile` | GET | 当前管理员信息 |

**安全机制：** 5 次密码错误锁定 30 分钟，登录记录审计日志。

---

## 8. 买家端 API（20 个模块）

### 8.1 商品（Product）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/products` | GET | 公开 | 分页列表（page/pageSize） |
| `/products/:id` | GET | 公开 | 详情（含 SKU/Media/Tag） |

### 8.2 企业（Company）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/companies` | GET | 公开 | 企业列表 |
| `/companies/:id` | GET | 公开 | 企业详情 |
| `/companies/:companyId/events` | GET | 公开 | 企业活动列表 |
| `/companies/:companyId/events/:id` | GET | 公开 | 活动详情 |

### 8.3 用户（User / Me）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/me` | GET | 需认证 | 当前用户资料 |
| `/me` | PATCH | 需认证 | 更新资料（name/avatar/location/interests/gender/birthday） |

### 8.4 地址（Address）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/addresses` | GET | 需认证 | 地址列表 |
| `/addresses` | POST | 需认证 | 新增地址 |
| `/addresses/:id` | PATCH | 需认证 | 更新地址 |
| `/addresses/:id` | DELETE | 需认证 | 删除地址 |
| `/addresses/:id/default` | PUT | 需认证 | 设为默认 |

### 8.5 购物车（Cart）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/cart` | GET | 需认证 | 获取购物车 |
| `/cart/items` | POST | 需认证 | 添加/更新购物车项 |
| `/cart/items/:skuId` | DELETE | 需认证 | 删除购物车项 |

### 8.6 订单（Order）+ CheckoutSession

**新结算流程（F1 重构）：**

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/orders/checkout` | POST | 需认证 | 创建 CheckoutSession（校验+计算+预留奖励+返回支付参数） |
| `/orders/checkout/:sessionId/cancel` | POST | 需认证 | 取消结算会话（释放预留奖励） |
| `/orders/checkout/:sessionId/status` | GET | 需认证 | 查询结算会话状态（前端轮询） |
| `/orders/preview` | POST | 需认证 | 预结算接口（按商户分组预览） |
| `/orders` | GET | 需认证 | 订单列表（状态筛选） |
| `/orders/status-counts` | GET | 需认证 | 状态汇总计数 |
| `/orders/latest-issue` | GET | 需认证 | 最新订单异常 |
| `/orders/:id` | GET | 需认证 | 订单详情 |
| `/orders/:id/receive` | POST | 需认证 | 确认收货 → 触发分润 |
| `/orders/:id/cancel` | POST | 需认证 | 取消订单 → 恢复库存 |
| `/orders/:id/after-sale` | POST | 需认证 | 申请售后 → 退款+分润回滚 |

**已废弃端点（返回 410 Gone）：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/orders` | POST | ~~createFromCart~~ → 使用 `POST /orders/checkout` 代替 |
| `/orders/:id/pay` | POST | ~~payOrder~~ → 新流程由支付回调自动建单 |
| `/orders/batch-pay` | POST | ~~batchPayOrders~~ → 统一走 CheckoutSession |

**CheckoutSession 流程说明：**
- `CheckoutService.checkout()` 创建结算会话：校验库存+地址 → 计算金额（含运费/奖励抵扣）→ 预留奖励 → 返回支付参数
- 支付回调（`POST /payments/callback`）触发原子建单：在同一个 Serializable 事务中验证回调 → 更新 CheckoutSession 为 PAID → 创建 Order/OrderItem/Payment → 扣减库存
- 会话 30 分钟后自动过期，过期会话中的预留奖励自动释放

**定时任务：**
- `OrderExpireService`（@deprecated）：仅处理旧流程历史 PENDING_PAYMENT 订单
- `OrderAutoConfirmService`：每小时扫描已发货超 7 天的订单自动确认收货

### 8.7 支付（Payment）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/payments/order/:orderId` | GET | 需认证 | 查询订单支付记录 |
| `/payments/:id` | GET | 需认证 | 支付详情 |

### 8.8 物流（Shipment）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/shipments/order/:orderId` | GET | 需认证 | 查询订单物流 |
| `/shipments/callback` | POST | 公开 | 物流回调 stub |

### 8.9 溯源（Trace）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/trace/product/:productId` | GET | 公开 | 商品溯源链 |
| `/trace/order/:orderId` | GET | 需认证 | 订单溯源 |

### 8.10 AI

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/ai/sessions` | POST | 需认证 | 创建 AI 会话 |
| `/ai/sessions/:id/utterances` | POST | 需认证 | 发送文本/语音 |
| `/ai/sessions/:id/history` | GET | 需认证 | 会话历史 |

> 当前为 keyword stub 实现，等接入讯飞 NLU SDK。

### 8.11 会员奖励（Bonus）

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/bonus/member` | GET | 需认证 | 会员信息 |
| `/bonus/purchase-vip` | POST | 需认证 | 购买 VIP（¥399），若有推荐人则自动发放 VIP 推荐奖励 |
| `/bonus/referral` | POST | 需认证 | 使用推荐码 |
| `/bonus/wallet` | GET | 需认证 | 钱包余额 |
| `/bonus/wallet/ledger` | GET | 需认证 | 奖励流水（分页） |
| `/bonus/wallet/withdraw` | POST | 需认证 | 提现申请 |
| `/bonus/wallet/withdrawals` | GET | 需认证 | 提现记录 |
| `/bonus/vip-tree` | GET | 需认证 | 三叉树可视化 |
| `/bonus/queue-status` | GET | 需认证 | 普通队列状态 |

### 8.12 其他模块

| 模块 | 端点数 | 说明 |
|------|--------|------|
| Booking | 8 | 预约管理（创建/审核/邀请/确认） |
| Group | 6 | 考察团（列表/详情/创建/加入） |
| Follow | 3 | 关注/取消关注 + 作者资料 |
| Task | 2 | 任务列表 + 完成任务 |
| CheckIn | 3 | 签到状态 + 执行签到 + 重置（测试） |
| Inbox | 4 | 消息列表 + 未读数 + 已读 |

---

## 9. 管理端 API（11 个模块）

### 9.1 权限守卫工作流

```
请求 → @Public() 跳过全局买家 Guard
     → AdminAuthGuard 验证 admin JWT
     → PermissionGuard 检查 @RequirePermission('module:action')
       → 超级管理员直接放行
       → 其他：查 DB 权限集合比对
     → Controller 处理
     → AuditLogInterceptor 记录审计（before/after 快照 + diff）
```

### 9.2 权限矩阵

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

**默认角色：** 超级管理员（全权限）、经理（大部分读写）、员工（只读 + 商品编辑）

### 9.3 管理端端点概览

| 模块 | 关键端点 | 说明 |
|------|----------|------|
| Stats | `GET /admin/stats/dashboard` | Dashboard 统计 |
| | `GET /admin/stats/sales-trend` | 销售趋势 |
| Products | `GET/PATCH /admin/products` | 商品列表/编辑/上下架/审核 |
| Orders | `GET /admin/orders` | 订单列表/详情/发货/退款/取消 |
| Companies | `GET/PATCH /admin/companies` | 企业列表/详情/审核 |
| App Users | `GET /admin/app-users` | 买家用户列表/详情/封禁解封 |
| Bonus | `GET /admin/bonus/members` | 会员列表/提现审核/拒绝 |
| Trace | `CRUD /admin/trace` | 溯源批次管理 |
| Config | `GET/PATCH /admin/config` | 系统配置编辑 + 版本历史 |
| Admin Users | `CRUD /admin/users` | 管理员 CRUD + 角色分配 |
| Roles | `CRUD /admin/roles` | 角色 CRUD + 权限分配 |
| Audit | `GET /admin/audit` | 审计日志查询 + 回滚 |

### 9.4 审计日志与回滚

- 写操作自动记录 before/after 快照 + 字段级 diff
- 回滚机制：取 before 快照覆盖写回，标记 rolledBackAt/By
- 不可回滚操作：退款审批、已发物流、已发推送

---

## 10. 分润引擎

### 10.1 触发流程

```
订单确认收货 → BonusAllocationService.allocateForOrder(orderId)
  ├── RewardCalculator: profit → 六分结构拆分（VIP: 50/30/10/2/2/6 平台/奖励/产业基金/慈善/科技/备用金）
  ├── 分流路由: VIP(金额≥100 + 未出局) → VipUpstream, 其他 → NormalBroadcast
  ├── PlatformSplit: 按六分结构分配（奖励池用于上溯/广播，其余归平台各账户）
  └── 全部在 Prisma 事务中执行，幂等键防重复
```

### 10.2 普通广播（滑动窗口）

- 按订单金额分桶（5 个区间），每桶独立队列
- 新订单确认时取前 X 笔（默认 20）订单的用户，等额分配 rewardPool
- 基于订单粒度（同一用户多笔订单各自独立获利）

### 10.3 VIP 三叉树上溯

- A1-A10 十个系统根节点，有推荐人→推荐人子树内 BFS，无推荐人→系统用户直接子节点
- 第 k 单有效消费 → 奖励发给第 k 个祖先
- 祖先 selfPurchaseCount ≥ k 解锁，否则冻结
- 15 层出局上限（实际几乎不触发）

### 10.4 可配置参数（RuleConfig）

| 键 | 默认值 | 说明 |
|----|--------|------|
| VIP_PLATFORM_PERCENT | 0.50 | VIP 平台利润占利润比例 |
| VIP_REWARD_PERCENT | 0.30 | VIP 奖励池占利润比例 |
| VIP_INDUSTRY_PERCENT | 0.10 | VIP 产业基金占利润比例 |
| VIP_CHARITY_PERCENT | 0.02 | VIP 慈善基金占利润比例 |
| VIP_TECH_PERCENT | 0.02 | VIP 科技基金占利润比例 |
| VIP_RESERVE_PERCENT | 0.06 | VIP 备用金占利润比例 |
| NORMAL_BROADCAST_X | 20 | 普通广播分配人数 |
| VIP_MIN_AMOUNT | 100.0 | VIP 有效消费最低金额 |
| VIP_MAX_LAYERS | 15 | VIP 收取层数上限 |
| VIP_BRANCH_FACTOR | 3 | 三叉树分叉数 |
| VIP_PRICE | 399.0 | VIP 礼包价格 |
| VIP_REFERRAL_BONUS | 50.0 | VIP 推荐奖励金额（被推荐人购 VIP 后推荐人获得） |
| AUTO_CONFIRM_DAYS | 7 | 自动确认收货天数 |

---

## 11. 数据库

### 11.1 Schema 概览

67 个模型分布在 9 个业务域：

| 域 | 模型数 | 核心模型 |
|---|--------|----------|
| A 认证用户 | 8 | User, UserProfile, AuthIdentity, Session, SmsOtp |
| B 平台配置 | 2 | RuleConfig, RuleVersion |
| C 管理后台 | 7 | AdminUser, AdminRole, AdminPermission, AdminAuditLog, AdminSession |
| D 企业 | 4 | Company, CompanyProfile, CompanyDocument, CompanyActivity |
| E 商品 | 7 | Product, ProductSKU, ProductMedia, ProductTag, Category, Tag, InventoryLedger |
| F 溯源 | 5 | TraceBatch, TraceEvent, OwnershipClaim, ProductTraceLink, OrderItemTraceLink |
| G 交易 | 10 | Order, OrderItem, Payment, Refund, Shipment, Address, Cart, CartItem, ... |
| H AI | 4 | AiSession, AiUtterance, AiIntentResult, AiActionExecution |
| I 会员奖励 | 12 | MemberProfile, VipTreeNode, VipProgress, RewardAccount, RewardLedger, ... |
| 社交 | 8 | Booking, Group, Follow, Task, CheckIn, InboxMessage, ... |

### 11.2 关键设计决策

| 决策 | 说明 |
|------|------|
| 金额 Float/元 | 与前端一致 |
| cuid() 主键 | 所有模型 |
| SPU/SKU 拆分 | Product 为 SPU，ProductSKU 为可售单元 |
| Payment 独立表 | 支持多次支付尝试 |
| 奖励账本化 | RewardAccount + RewardLedger 双表 |
| VIP 树 10 根 | A1-A10 系统用户 |
| CHECK(stock>=0) | ProductSKU 数据库级防超卖 |

### 11.3 核心关系图

```
User ──┬── UserProfile / AuthIdentity / Session
       ├── MemberProfile ── VipTreeNode ── VipProgress
       ├── RewardAccount ── RewardLedger
       ├── Address / Cart ── CartItem
       ├── Order ──┬── OrderItem ── ProductSKU
       │           ├── Payment / Refund / Shipment
       │           └── OrderStatusHistory
       └── Booking / Follow / CheckIn / InboxMessage / AiSession

Company ── Product(SPU) ── ProductSKU ── ProductMedia
                        └── ProductTraceLink ── TraceBatch ── TraceEvent
```

---

## 12. 种子数据

| 实体 | 数量 | 说明 |
|------|------|------|
| 用户 | 6 | u-001(VIP)、u-002~u-006（含 PLATFORM 系统用户） |
| 管理员 | 1 | admin / admin123456（超级管理员） |
| 角色 | 3 | 超级管理员、经理、员工 |
| 权限 | 36 | 覆盖 11 个模块 |
| 企业 | 4 | c-001~c-004（含联系人） |
| 商品 | 6 | p-001~p-006（含 SKU/Media/Tag） |
| 订单 | 4 | PENDING_PAYMENT / PAID / SHIPPED / RECEIVED |
| 地址 | 2 | u-001 的默认地址 |
| VIP 树 | A1-A3 系统节点 + u-001/u-006 VIP 节点 |
| 分润流水 | 3 条演示 RewardLedger |
| 提现 | 2 条（REQUESTED / APPROVED） |
| RuleConfig | 13 条分润参数 |

种子使用 `upsert`（含完整 `update` 字段），支持幂等重跑。

---

## 13. 前端对接

### 13.1 买家 App（React Native）

- **ApiClient**：`src/repos/http/ApiClient.ts`，fetch-based，12s 超时
- **Mock 切换**：`EXPO_PUBLIC_USE_MOCK=false` 走真实 API
- **22 个 Repo**：16 个已对接真实 API，3 个 AI Repo 为 Mock，3 个保留模式
- **Token 持久化**：Zustand + AsyncStorage

### 13.2 管理后台（React Web）

- **API Client**：`admin/src/api/client.ts`，axios-based
- **Vite Proxy**：`/api` → `localhost:3000`
- **12 个 API 模块**：对接 54 个后端端点
- **Auth Store**：Zustand + localStorage

---

## 14. 安全特性（v3.0 新增）

### 14.1 事务隔离与并发控制

| 特性 | 说明 |
|------|------|
| Serializable 隔离级别 | 所有涉及金额、库存、奖励、奖金、支付的操作强制使用 `isolationLevel: Serializable` |
| CAS（Compare-And-Swap）模式 | 库存扣减使用 `updateMany(where: { stock >= qty })` 原子操作防超卖 |
| P2034 重试 | Prisma 序列化冲突（P2034）自动重试，最多 3 次，指数退避（200ms/400ms/800ms） |
| 幂等键 | 订单创建、支付回调、分润分配全部使用唯一幂等键防止重复操作 |

### 14.2 Webhook 安全

| 特性 | 说明 |
|------|------|
| WebhookIpGuard | 支付回调和物流回调端点绑定 IP 白名单，生产环境配置支付渠道 IP |
| HMAC 签名验证 | 支付回调使用 HMAC 签名验证请求真实性 |
| 物流签名验证 | 物流回调 stub 预留签名验证接口（待接入快递100） |

### 14.3 数据完整性

| 特性 | 说明 |
|------|------|
| onDelete: Restrict | 关键外键添加删除保护（User→Order、Order→Payment、Order→Refund、User→MemberProfile、User→VipProgress、Order→RewardAllocation、User→CompanyStaff、Company→CompanyStaff） |
| FK 索引 | 新增 5 个外键索引提升查询性能（ProductMedia.productId、InventoryLedger.skuId、OrderItemTraceLink.orderItemId、ShipmentTrackingEvent.shipmentId、RewardLedger.allocationId） |
| PaginationInterceptor | 全局 pageSize 钳制（最大 100），防止恶意大分页请求导致 OOM |

### 14.4 新增 DTO 文件

| 文件 | 说明 |
|------|------|
| `order/checkout.dto.ts` | CheckoutSession 创建参数（items/addressId/redPackId/paymentChannel） |
| `bonus/dto/bonus-*.dto.ts` | 分润相关 DTO（普通树/VIP 树/抽奖/冻结过期） |
| `admin/*/dto/admin-*.dto.ts` | 管理端各模块查询/操作 DTO |
| `seller/*/dto/seller-*.dto.ts` | 卖家端企业/商品/订单 DTO |

---

## 15. 注意事项

1. **JWT_SECRET 必须设置**：无默认值，未设置时启动报错
2. **CORS 需配置**：生产环境通过 `CORS_ORIGINS` 限制域名
3. **SMS 为 Mock**：`SMS_MOCK=true` 时验证码打印到 console
4. **支付为模拟**：payOrder 直接标记 PAID，等接入微信/支付宝
5. **AI 为 Stub**：keyword 匹配，等接入讯飞 NLU
6. **密码可选**：验证码登录不要求设置密码
7. **Redis 预留**：ioredis 已安装但未接入
8. **data-system.md 为权威来源**：所有数据库设计以其为准

---

## 16. 已知问题

详见 `tofix.md`（批次 1-5 已全部修复）和 `tofix2.md`（第二轮审计，待修复）。
