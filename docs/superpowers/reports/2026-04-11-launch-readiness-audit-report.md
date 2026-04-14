# 爱买买 v1.0 上线链路审查报告

**状态**: 定稿 v1
**审查日期**: 2026-04-11
**审查范围**: 17 条链路 + 6 项横切关注点
**Spec**: docs/superpowers/specs/2026-04-11-launch-readiness-audit.md
**Plan**: docs/superpowers/plans/2026-04-11-launch-readiness-audit.md
**审查原则**: 只读审查 + 证据必须 file:line + 不做 v1.1+ 功能

---

## 📋 目录

- [0. Executive Summary](#0-executive-summary)
- [1. 审查范围与方法](#1-审查范围与方法)
- [2. 横切关注点审查结果](#2-横切关注点审查结果)
  - [2.1 X1 事务隔离 + CAS](#21-x1-事务隔离--cas)
  - [2.2 X2 幂等键](#22-x2-幂等键)
  - [2.3 X3 Webhook 安全](#23-x3-webhook-安全)
  - [2.4 X4 三系统权限隔离](#24-x4-三系统权限隔离)
  - [2.5 X5 Mock 开关 + 环境变量](#25-x5-mock-开关--环境变量)
  - [2.6 X6 性能红线](#26-x6-性能红线)
- [3. 钱流图与跨链路耦合](#3-钱流图与跨链路耦合)
- [4. 链路详细审查 L1-L17](#4-链路详细审查-l1-l17)
  - [4.1 Tier 1 💰 钱链路](#41-tier-1--钱链路a-档)
  - [4.2 Tier 2 💰 钱链路](#42-tier-2--钱链路a-档)
  - [4.3 Tier 1 标准链路](#43-tier-1-标准链路b-档)
  - [4.4 基建](#44-基建c-档)
- [5. 跨链路耦合矩阵](#5-跨链路耦合矩阵17x17-快查表)
- [6. 🔴 Tier 1 上线阻塞项汇总](#6--tier-1-上线阻塞项汇总)
- [7. 🟡 Tier 2 待补项汇总](#7--tier-2-待补项汇总)
- [8. 用户线下完成事项](#8-用户线下完成事项)
- [9. 待用户逐项确认的疑点清单](#9-待用户逐项确认的疑点清单)
- [10. 修复实施顺序建议](#10-修复实施顺序建议交接给-writing-plans)
- [11. 附录](#11-附录)

---

## 0. Executive Summary

### 整体健康度

| 状态 | 数量 | 链路 |
|---|---|---|
| 🟢 健康（无 T1 问题） | 3 | L2 商品+AI 搜索（仅有 UX 疑点）/ L14 平台红包 / L6 VIP 多档位 |
| 🟡 部分可用（存在 T1 但非致命） | 7 | L1 认证 / L8 顺丰迁移 / L9 客服 / L10 卖家上货 / L11 发票 / L12 管理后台 / L13 部署 |
| 🔴 有 T1 阻塞（钱/状态不闭环） | 6 | L3 购物车下单 / L4 支付宝 / L5 分润 / L7 售后 / L15 消息中心 / L16 地址 |
| ⬜ 未完成（需要新建 API） | 1 | L17 溯源（关联/事件 API 完全缺失） |

### Tier 1 上线阻塞项 TOP 10（按严重度）

| # | ID | 问题 | 链路 | 证据 | 预估工时 |
|---|---|---|---|---|---|
| 1 | C01 | 支付宝退款 API 未真实接入（`initiateRefund` 是 mock） | L4+L7 | `payment.service.ts:56-89` | 0.5-1d |
| 2 | C02 | Order 状态不闭环（退款成功订单仍停 RECEIVED） | L7 | after-sale 模块 grep `order.update` 零匹配 | 0.5d |
| 3 | C03 | `VIP_PLATFORM_SPLIT` 枚举缺失导致 VIP 订单分润直接崩溃 | L5 | `bonus-allocation.service.ts:616` vs `schema.prisma:336-342` | 0.25d |
| 4 | C04 | 地址字段名错位（`parseAddressSnapshot` 读错字段，面单收件人必空） | L8+L16 | `seller-shipping.service.ts:52-78` vs `checkout.service.ts:363` | 0.25d |
| 5 | C05 | 客服会话空闲超时 5 秒测试值未改回 2 小时 | L9 | `cs.service.ts:26` + `cs-cleanup.service.ts:23-34` (4 处) | 0.1d |
| 6 | C06 | `.env.example` 缺 5 个关键密钥（ADMIN_JWT_SECRET/SELLER_JWT_SECRET/PAYMENT_WEBHOOK_SECRET/LOGISTICS_WEBHOOK_SECRET/WEBHOOK_IP_WHITELIST） | X4+X5+L4 | `.env.example` grep 零匹配 | 0.25d |
| 7 | C07 | rollbackForOrder TOCTOU 并发导致 `frozen` 账户漂移 | L5 | `bonus-allocation.service.ts:265-338` | 0.5d |
| 8 | C08 | InboxService 29/30 事件未接（钱事件全部 0 接入，用户无感知） | L15 | grep `inboxService.send` 全项目 2 处（仅 VIP 激活） | 2-3d |
| 9 | C09 | OPERATOR 可创建/删除商品（seller-products 权限缺 `@SellerRoles`） | L10 | `seller-products.controller.ts:26-104` 零装饰器 | 0.1d |
| 10 | C10 | Dashboard 硬编码调用不存在的 `/admin/replacements` API → 管理端首页永久 404 | L12 | `admin/src/pages/dashboard/index.tsx:24,71` | 0.1d |

### 3-5 条关键风险提示

1. **钱的正向链路基本完整，反向（退款/回滚）链路几乎全断**：支付宝退款 mock、Order 状态不闭环、分润回滚 TOCTOU、售后补偿 cron 前缀错配、红包不归还与 refund.md 一致但需用户复核。一笔真实退款目前无法跑完整条链路。
2. **InboxService 业务接入率 3.3%**：30 个应发事件里 1 个已接，9 个钱相关事件全未接。用户支付成功/奖励到账/提现通过/退款到账/红包到账全无感知，是客服投诉的结构性源头。
3. **测试值混入生产代码**：客服 5 个硬编码超时常量（SESSION/AI/QUEUING/AGENT_IDLE + Cron 频率）会让"会话记忆"彻底不可用，用户第一次使用就会遇到。
4. **管理端有 1 个 Critical 断链 + 3 个 High 不一致**：`/admin/replacements` 整条 404、Dashboard 首屏触发、`dashboard:read` 前端缺失、新旧 Refund 双写隐患。
5. **顺丰直连有 2 个硬前置**（Company.address 结构化 + addressSnapshot 字段修复），这两个不做完无法真正发一单出去。

### 预估剩余总工时（最优/正常/悲观）

- **最优**: 15 人日（仅 T1 阻塞，最小可用，不含顺丰）
- **正常**: 25 人日（T1 阻塞 + 顺丰直连 + 部署全流程 + 回归测试）
- **悲观**: 40 人日（含 T1 + T2 补齐 + 用户线下流程延迟）

墙钟时间额外依赖：ICP 备案 20 工作日（最长关键路径）/ 顺丰审批 8-21 天 / 支付宝证书 3-5 天 / App Store 审核 1-3 天。

### 关键决策（用户已确认）

**brainstorming 阶段**（17 项）+ **三次 Checkpoint 用户审阅**已经形成的决策：

- **R12 超卖容忍**：故意设计，允许库存变为负数，卖家收到补货通知但不退款。L3 draft 审查已确认 —— 补货通知 TODO（`checkout.service.ts:1264`）是 R12 设计的另一半，必须补齐。
- **L6 H1 撤销**：after-sale bizType 拦截安全（Prisma `findUnique+include` 不带 select 时默认返回所有 scalar），`as any` 只是类型整洁问题不是 bug。
- **L10 H2 描述长度降级**：商品描述 / 企业简介 `@MinLength(20)` 降级为非 T1，v1.0 保持现状，v1.1 按 AI 搜索召回质量决定。
- **L1 H1/H2 认证补齐确认**：卖家端必须加账号密码登录（与手机验证码并存）；管理端必须加图形验证码 + 手机号短信验证码登录（与账号密码并存）。均为 v1.0 T1 必做。
- **v1.0 支付渠道**：仅支付宝，微信保持 mock。
- **v1.0 物流渠道**：顺丰直连（从快递100迁移），保留 7 天灰度窗口与 `SHIPPING_PROVIDER` 开关回滚能力。
- **v1.0 AI 开关策略**：`AI_SEMANTIC_SLOTS_ENABLED=true`（低风险），`AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` + `AI_SEMANTIC_SCORING_ENABLED` 打包后延到 v1.1。
- **奖品商品定价**：管理员手动设价（`admin-products.service.ts` 需补 SKU 编辑入口才能支持）。
- **不做的事**：事件总线/CQRS 中枢、推送优先级系统、真实税务发票对接、OCR 图片审核均延后到 v1.1+。

---

## 1. 审查范围与方法

### 17 条链路清单

| ID | 名称 | Tier | 档级 | 💰 | 总体状态 |
|---|---|---|---|---|---|
| L1 | 三系统认证 | T1 | B | — | 🟡 |
| L2 | 商品浏览 + AI 搜索 | T1 | B | — | 🟢 |
| L3 | 购物车 + 下单 (CheckoutSession) | T1 | A | 💰 | 🔴 |
| L4 | 支付宝支付 | T1 | A | 💰 | 🔴 |
| L5 | 分润奖励 (Reward Allocation) | T1 | A | 💰 | 🔴 |
| L6 | VIP 多档位礼包 | T2 | A | 💰 | 🟢 |
| L7 | 统一售后 (退/换货) | T2 | A | 💰 | 🔴 |
| L8 | 顺丰直连迁移 | — | C | — | 🟡 |
| L9 | 智能客服 | T1 | B | — | 🟡 |
| L10 | 卖家上货 + 审核 | T2 | B | — | 🟡 |
| L11 | 发票申请 | T2 | A-简版 | 💰 | 🟡 |
| L12 | 管理后台全页面 | T1 | B | — | 🟡 |
| L13 | 部署上线 Checklist | — | C | — | 🟡 |
| L14 | 平台红包 (Coupon) | T1 | A | 💰 | 🟢 |
| L15 | 消息中心 (事件盘点) | T1 | B | — | 🔴 |
| L16 | 地址管理 | T1 | B | — | 🔴 |
| L17 | 溯源管理 | T2 | B | — | ⬜ |

### 6 项横切关注点

- **X1** 事务隔离 + CAS（Serializable 分布、CAS 正确性、P2034 重试）
- **X2** 幂等键（格式一致性、唯一约束、P2002 兜底）
- **X3** Webhook 安全（签名验证、IP 白名单、Secret 管理）
- **X4** 三系统权限隔离（JWT 独立 secret、Strategy、Guard 组合）
- **X5** Mock 开关 + 环境变量（生产切换清单）
- **X6** 性能红线（N+1、缓存失效、金额精度、索引覆盖）

### 三档审查模板

- **A 档**（深审 / 钱链路）：L3、L4、L5、L6、L7、L11、L14
- **B 档**（标准 / 关键链路）：L1、L2、L9、L10、L12、L15、L16、L17
- **C 档**（基建 / 计划型）：L8、L13

### 状态图例

- 🟢 健康：无 T1 问题
- ✅ 通过验证
- 🟡 可改进 / 部分可用
- ⬜ 未实现（需要新建）
- 🔴 需修复 / T1 阻塞

### 证据要求

所有 CRITICAL / HIGH 问题必须附 `file:line` 引用。本报告 §6 的 Tier 1 阻塞项严格遵守此规则。

---

## 2. 横切关注点审查结果

### 2.1 X1 事务隔离 + CAS

**扫描结论**：✅ 基本合规。`$transaction` 调用分布在 53 个文件，大多数金额/库存/奖励/状态转换已显式标注 `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`。P2034 序列化冲突重试遍布 20+ 个服务，CAS 模式 `updateMany where:{id,status}` 在 payment/admin-refunds/admin-invoices/after-sale 等关键路径均已使用。

**关键事务一览（代表性 15 条）**：

| 位置 file:line | 隔离级别 | CAS | 类型 | 状态 |
|---|---|---|---|---|
| `checkout.service.ts:627` (checkout) | Serializable | N/A | 钱/奖励 | ✅ |
| `checkout.service.ts:923` (handlePaymentSuccess) | Serializable | 是 | 钱/库存 | ✅ |
| `checkout.service.ts:1417` (payment success) | Serializable | 是 | 钱 | ✅ |
| `payment.service.ts:129` (auto-refund cron) | Serializable | 是 | 钱 | ✅ |
| `payment.service.ts:291` (支付失败) | Serializable | 是 | 钱 | ✅ |
| `payment.service.ts:456` (callback) | Serializable | 是 | 钱 | ✅ |
| `bonus-allocation.service.ts:201` (分润入账) | Serializable | 是 | 钱 | ✅ |
| `bonus-allocation.service.ts:419` (rollback) | Serializable | 是 | 钱 | 🟡 缺 timeout + TOCTOU |
| `vip-upstream.service.ts:349` (VIP 上游分润) | Serializable | 是 | 钱 | ✅ |
| `freeze-expire.service.ts:215` (冻结释放) | Serializable | 是 | 钱 | ✅ |
| `after-sale.service.ts:289/334/388/459/509/556` | Serializable ×6 | 是 | 状态机 | ✅ |
| `after-sale-timeout.service.ts:151/242/354/474` | Serializable ×4 | 是 | 状态机 | ✅ |
| `coupon-engine.service.ts:458` (红包发放) | Serializable | 是 | 钱 | ✅ |
| `check-in.service.ts:69` (签到) | Serializable | N/A | 钱 | ✅ |
| `lottery.service.ts:259/434` | Serializable ×2 | 是 | 状态机 | ✅ |

**需要关注的 3 处**：

- 🟡 `customer-service/cs.service.ts:72` / `seller-company.service.ts:83,119` / `admin-companies.service.ts:298,347` 使用字符串字面量 `'Serializable'`，与项目其他位置 `Prisma.TransactionIsolationLevel.Serializable` 常量不一致。Prisma 可接受但建议统一。
- 🟡 `cart.service.ts:702` 事务为购物车合并，含价格重算但无 CAS。非资金流，风险低。
- 🔴 L5 `bonus-allocation.service.ts:265-268` 的 `findMany` 在事务外读取 allocations snapshot，导致 rollback 路径 TOCTOU（见 §4 L5 CRITICAL-01）。

### 2.2 X2 幂等键

**扫描结论**：✅ 资金/奖励/签到/红包路径的幂等设计完整。P2002/P2034 双层保险模式（先尝试，冲突则兜底）在 `bonus-allocation.service.ts`、`check-in.service.ts`、`coupon.service.ts`、`checkout.service.ts` 中结构一致。

| 场景 | 键字段 | DB 唯一约束 | 冲突处理 | 状态 |
|---|---|---|---|---|
| CheckoutSession 创建 | `@@unique([userId, idempotencyKey])` (`schema.prisma:1353`) | 复合 | `checkout.service.ts:645` P2002 | ✅ |
| Order 创建 | `idempotencyKey @unique` (`schema.prisma:1373`) | 单 | `cs:{sid}:{hash}:{idx}` | ✅ |
| RewardAllocation | `idempotencyKey @unique` (`schema.prisma:1843`) | 单 | `bonus-allocation.service.ts:210,422` P2002 | ✅ |
| CheckIn | `@@unique([userId, date])` | 复合 | `check-in.service.ts:86` P2002 | ✅ |
| Coupon 发放 | `@@unique([campaignId, userId, issuedAt])` | 复合 | `coupon.service.ts:213` + `coupon-engine.service.ts:419` | ✅ |
| BuyerAlias | `@@unique([userId, companyId])` | 复合 | `buyer-alias.service.ts:45` | ✅ |
| NormalTree 节点插入 | `@@unique([parentId, position])` | 复合 | S05 修复 increment-first | ✅ |
| Cart 合并 | `cartId + skuId` (非唯一索引) | 🟡 | 奖品项依赖 `prizeRecordId` 辨别 | 🟡 |
| Payment Webhook 回调 | `providerTxnId` + `merchantOrderNo` | 🟡 未确认 | CAS 状态转换 | 🟡 需核查 Payment 模型唯一约束 |
| Shipment Webhook 回调 | `trackingNo` + `events[]` | 🟡 未确认 | CAS 状态迁移 | 🟡 事件去重依赖业务校验 |

**需要核查**：`Payment.providerTxnId @unique` 是否存在 + `Shipment` 事件去重策略。

### 2.3 X3 Webhook 安全

**端点清单**：

| 端点 | 签名验证 | IP 白名单 | 状态 |
|---|---|---|---|
| `POST /payments/callback` | HMAC-SHA256 + `timingSafeEqual` (`payment.service.ts:169-216`) | ✅ `WebhookIpGuard` | ✅ |
| `POST /payments/alipay/notify` | 支付宝证书验签 (`alipay.service.ts:128`) | ❌ **缺 `WebhookIpGuard`** (`payment.controller.ts:52`) | 🟡 |
| `POST /shipments/callback` | HMAC-SHA256 | ✅ | ✅ |
| `POST /shipments/kuaidi100/callback` | Token + 签名 | ✅ | ✅ |

**WebhookIpGuard 实现质量**：`backend/src/common/guards/webhook-ip.guard.ts` 从 `req.ips[0]` 取真实 IP（依赖 `trust proxy`）、IPv4/IPv6 + CIDR 前缀匹配、生产环境强制校验（未配置 → ForbiddenException）、开发环境放行并 warn。质量高。

**签名验证质量**：`payment.service.ts:verifySignature` 使用 canonical 序列化（按 key 排序）+ `crypto.timingSafeEqual` + 生产强制配置。质量高。

**需要补救**：

1. 🟡 `payment.controller.ts:52` `handleAlipayNotify` 补 `@UseGuards(WebhookIpGuard)` 一致化。
2. 其余 3 个 webhook 已正确组合 `@Public() + @UseGuards(WebhookIpGuard) + 签名验证`。

### 2.4 X4 三系统权限隔离

**环境变量（`backend/.env.example`）**：

| Secret 变量 | .env.example | 代码引用 | 状态 |
|---|---|---|---|
| `JWT_SECRET` | ✅ line 3 | `auth` 模块 | ✅ |
| `ADMIN_JWT_SECRET` | ❌ 未声明 | `admin-auth.module.ts:15` `getOrThrow`、`cs.gateway.ts:72` | 🔴 |
| `SELLER_JWT_SECRET` | ❌ 未声明 | `seller-auth.module.ts:17` `getOrThrow`、`seller-shipping.service.ts:32` | 🔴 |

🔴 **关键缺口**：`.env.example` 缺 `ADMIN_JWT_SECRET` 和 `SELLER_JWT_SECRET`。生产部署时若遗漏，`getOrThrow` 会在 bootstrap 抛异常。

**JWT 隔离矩阵**（经代码验证）：

| Token\Target | 买家 API | 卖家 API | 管理 API |
|---|---|---|---|
| 买家 JWT | ✅ 200 | ❌ 401 | ❌ 401 |
| 卖家 JWT | ❌ 401 | ✅ 200 | ❌ 401 |
| 管理 JWT | ❌ 401 | ❌ 401 | ✅ 200 |

**Guard 栈一致性**：审计全部 20 个 admin 控制器 + 8 个 seller 控制器，**全部通过**。所有控制器类级先 `@Public()` 再加对应 Guard 栈。

**独立 Strategy + Secret**：

- `admin/common/strategies/admin-jwt.strategy.ts:24` `secretOrKey: getOrThrow('ADMIN_JWT_SECRET')`
- `seller/auth/seller-jwt.strategy.ts:26` `secretOrKey: getOrThrow('SELLER_JWT_SECRET')`

**注意事项**：

- 🟡 买家 `jwt.strategy.ts` 和 管理端 `admin-jwt.strategy.ts` 未校验 `payload.type`，seller 有（`seller-jwt.strategy.ts:32`）。三端不一致。建议作为纵深防御补齐。
- 🟡 三个 JWT secret 未做启动期互不相等断言，建议在 AppModule 启动时断言。
- 🟡 买家 `logout` 未 throttle（`auth.controller.ts:41`）。

### 2.5 X5 Mock 开关 + 环境变量

**Mock 开关扫描（9 项）**：

| 变量 | 默认 | 引用位置 | 生产期望 | 状态 |
|---|---|---|---|---|
| `SMS_MOCK` | `true` | `auth/auth.service.ts:44`、`seller/auth/seller-auth.service.ts:46` | **false** | 🔴 待切 |
| `WECHAT_MOCK` | `true` | `auth/auth.service.ts:195` | **true** (v1.0 保留) | ✅ |
| `UPLOAD_LOCAL` | `true` | `upload/upload.service.ts:125,191,214` | **false** | 🔴 待切 |
| `UPLOAD_LOCAL_PRIVATE` | `false` | 同上 | false | ✅ |
| `IMAGE_SCAN_ENABLED` | `false` | `image-content-scanner.service.ts:63` | false (v1.0 可保持) | 🟡 |
| `AI_SEMANTIC_SLOTS_ENABLED` | `false` | `ai/ai.service.ts:584` | **true** | 🔴 待切 |
| `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` | `false` | `product/semantic-fill.service.ts:46,180` | **false** (v1.1) | ✅ 延后 |
| `AI_SEMANTIC_SCORING_ENABLED` | `false` | `product/product.service.ts:179,740` | **false** (v1.1) | ✅ 延后 |
| `LOTTERY_ENABLED` | config 表 | DB-driven | true | ✅ |

**生产必配 Secrets（X4 联动）**：

| 变量 | .env.example 占位 | 状态 |
|---|---|---|
| `PAYMENT_WEBHOOK_SECRET` | ❌ | 🔴 |
| `LOGISTICS_WEBHOOK_SECRET` | ❌ | 🔴 |
| `WEBHOOK_IP_WHITELIST` | ❌ | 🔴 |
| `ADMIN_JWT_SECRET` | ❌ | 🔴 |
| `SELLER_JWT_SECRET` | ❌ | 🔴 |
| `KUAIDI100_*` | ✅ line 34-40 | 🟡 待迁移到 SF_* |
| `DASHSCOPE_API_KEY` | ✅ line 43 | 🟡 |
| `ALIPAY_*` | ✅ 注释 line 45-59 | 🟡 生产放开 |
| `EMAIL_SMTP_*` | ✅ line 22-24 | 🟡 |

**结论**：

🔴 `.env.example` 需补充至少 5 个关键环境变量。

🔴 3 个生产必关 mock（SMS / UPLOAD_LOCAL / AI_SEMANTIC_SLOTS_ENABLED）待切。

🟡 `SMS_MOCK=true` 在 `.env.example` 出现两次（line 5 + line 14），需清理。

### 2.6 X6 性能红线

**N+1 反模式（最严重 10 条）**：

| # | file:line | 模式 | 严重度 |
|---|---|---|---|
| 1 | `order/checkout.service.ts:327-338` | for 赠品 → lotteryRecord.findUnique | 🟡 MEDIUM |
| 2 | `order/order.service.ts:565-580` | 同上（预览模式） | 🟡 |
| 3 | `order/checkout-expire.service.ts:102-200` | for session → couponInstance.findMany | 🟡 |
| 4 | `customer-service/cs-cleanup.service.ts:60-62` | for session → update | 🟢 |
| 5 | `payment/payment.service.ts:110-161` | for refund → $transaction（架构需要） | 🟢 |
| 6 | `bonus/vip-activation-retry.service.ts:60-62` | for purchase → updateMany | 🟢 |
| 7 | `order/bonus-compensation.service.ts` | 循环处理失败订单分润 | 🟢 |
| 8 | `after-sale/after-sale.utils.ts:27-45` | product.findUnique 后 category.findUnique | 🟡 |
| 9 | `bonus/engine/bonus-allocation.service.ts:42,114,472,487` | 串行 4 次 findUnique | 🟡 |
| 10 | `after-sale/after-sale-timeout.service.ts:451` | tx.order.findUnique 嵌事务循环 | 🟢 |

**缓存失效漏洞**：

| 缓存实例 | 失效调用点 | 状态 |
|---|---|---|
| `company.service.ts` listCache | `invalidatePrefix('companies:')` | ✅ |
| `company.service.ts` discovery filters | 无 invalidate | 🟡 |
| `product.service.ts` categoriesCache/searchEntityCache/productKeywordSignalCache | 同时清除 | ✅ |
| `admin-stats.service.ts` dashboardCache | `clear()` | ✅ |
| `seller-analytics.service.ts` overviewCache | `invalidate` | ✅ |
| `admin-reconciliation.service.ts` reportCache | 无 invalidate | 🟡 |

**金额精度不一致（5 条）**：

- `order/order.service.ts:727,738,757,762,775` 混用 `Number` + `.toFixed(2)` + `Math.min`
- `order/checkout-expire.service.ts:136-149` 平摊算法需余数归一化
- `coupon/coupon.service.ts:1506` 单点封顶 OK
- `seller/products/seller-products.service.ts:129,156,431` 自动定价三处重复
- `order/checkout.service.ts:342,427` 与 order.service 风格一致但无统一 util

🟡 建议封装 `common/money.util.ts` 统一入口（v1.1）。

**缺失索引候选**：

| # | 表 | 缺失/风险 | 严重度 |
|---|---|---|---|
| 1 | `RewardAllocation` | 按 `triggerType+createdAt` 可能缺索引 | 🟡 |
| 2 | `AfterSaleRequest` | companyId 过滤依赖 order JOIN | 🟡 |

**结论**：

- N+1：热路径 2 处小规模（可接受），Cron 架构性决策（接受）
- 缓存：2 处 invalidate 缺失，非资金路径，TTL 自然过期
- 金额精度：建议 v1.1 重构集中化
- 索引：1 处待确认

---

## 3. 钱流图与跨链路耦合

### 3.1 路径 1: 支付成功 → 订单确认 → 分润发放（正向）

```
[买家 App] cart → checkout
  ↓
[L3] POST /orders/checkout
  → CheckoutService.checkout()
    - Serializable 事务: RewardLedger RESERVED + CouponInstance RESERVED + CheckoutSession.create(ACTIVE)
  ← sessionId + paymentParams
  ↓
[L4] initiateAlipayPayment(sessionId)
  → alipayService.createAppPayOrder()
    - 真实 SDK 调用
  ← orderStr
  ↓
[前端] 唤起支付宝
  ↓
[L4] 支付宝异步回调 POST /payments/alipay/notify
  → alipayService.verifyNotify(body)  ✅ 证书验签
  → paymentService.handlePaymentCallback(SUCCESS)
    ↓
    → checkoutService.handlePaymentSuccess()   【L3】
      - Serializable 事务:
        * CheckoutSession ACTIVE → PAID → COMPLETED
        * Order.create(PAID) × N 商户
        * OrderItem/OrderStatusHistory nested
        * Reward RESERVED → VOIDED
        * InventoryLedger RESERVE
        * ProductSKU.stock decrement  (R12 容忍)
        * LotteryRecord WON/IN_CART → CONSUMED
        * CartItem 按 cartItemId 精确删除
      - 事务外:
        * couponService.confirmCouponUsage()   【L14】 CAS RESERVED→USED
        * activateVipAfterPayment()   【L6】 仅 VIP_PACKAGE
        * inboxService.send(vip_activated)   【L15】 ← 仅 VIP 激活 1 处接入
  ↓
[买家确认收货 或 自动确认 Cron]
  → order.service.ts:877 / order-auto-confirm.service.ts:121
    ↓
    → bonusAllocationService.allocateForOrder(orderId)   【L5】
      - 🔴 bizType=VIP_PACKAGE 入口守卫（跳过）
      - determineRouting(): NORMAL_TREE / VIP_UPSTREAM / VIP_EXITED / ZERO_PROFIT
      - RewardCalculator 六分计算
      - Serializable 事务: RewardAllocation + RewardLedger × 6
      - 🔴 VIP_PLATFORM_SPLIT 枚举缺失 (CRITICAL-02)
  ← Reward 到账 ← ❌ 无 inbox 通知（L15 漏接）
```

**断点位置**：
- 🔴 L15 发货/签收/自动确认/奖励到账通知全部未接
- 🔴 L5 `VIP_PLATFORM_SPLIT` 枚举缺失会导致事务回滚
- 🟡 L3→L14 `confirmCouponUsage` 失败无补偿队列
- 🟡 L3→L6 VIP 激活失败无补偿队列

### 3.2 路径 2: 退款 → 全量回滚（反向）

```
[买家 App] 申请售后   【L7】
  ↓
POST /after-sale/apply
  → AfterSaleService.apply()
    - Serializable 事务: AfterSaleRequest.create(REQUESTED)
  ↓
[卖家审批 / 平台仲裁 / 超时 Cron]
  → approve / arbitrate / timeout handler
    - Serializable 事务: AfterSaleRequest status 转换
  ↓
[退款触发] seller-after-sale.service.ts:1128 / admin-after-sale.service.ts:464 / after-sale-timeout.service.ts:563
  → paymentService.initiateRefund(orderId, amount, merchantRefundNo)
    ↓
    🔴 CRITICAL-01: 是占位实现
       payment.service.ts:56-89 直接返回假 providerRefundId
       AlipayService.refund() 孤儿代码未被调用
    ❌ 真金白银没划回买家账户
  ↓
[事务外] setImmediate(async () => { ... catch log only })
  → voidRewardsForOrder()   【L5】
    - Serializable 事务: RewardLedger → VOIDED + Reward Account 扣减
    - 🔴 TOCTOU 并发期 frozen 账户漂移 (CRITICAL-01)
  → 🔴 Order.status 从未更新为 REFUNDED (C02)
  → ❌ CouponInstance 保持 USED（L14 确认符合 refund.md §156）
  → ❌ 库存不回填 (L7 H2)
  → ❌ 无 inbox 通知 (L15 #18)
  → ❌ 补偿 Cron 前缀错配（只扫 AUTO-*，售后用 AS-*）(L7 C3)
```

**断点位置**：
- 🔴 **完全断**：L4 真实退款、L7 Order 状态、L7 库存回填、L7 补偿 Cron 前缀、L15 退款通知
- 🟡 **部分断**：L5 TOCTOU 漂移、L5 WITHDRAWN 追缴只 warn、L5 unlockedLevel/exitedAt 不可逆

### 3.3 路径 3: VIP 购买 → 激活 → 分润豁免

```
[买家 App] VIP 档位选择   【L6】
  ↓
POST /orders/vip-checkout
  → checkoutVipPackage()
    - 事务外预检 + 价格校验
    - Serializable 事务 (checkout.service.ts:830):
      * 重查 MemberProfile.tier 防重复开通
      * 清理过期 VIP 会话 + 释放库存
      * 活跃 VIP 会话互斥
      * CheckoutSession.create(VIP_PACKAGE)
      * 逐项 CAS 严格扣库存
  ← sessionId
  ↓
[L4 支付流程 同路径 1]
  ↓
[L3 handlePaymentSuccess]
  → 命中 sessionBizType === 'VIP_PACKAGE'
    → bonusService.activateVipAfterPayment()   【L6】
      - Phase-1 (Serializable): VipPurchase upsert PENDING
      - Phase-2 (Serializable): CAS 激活 + MemberProfile.tier=VIP + VipTreeNode 插入 (S05 BFS)
      - 事务内发 grantVipReferralBonus (邀请人奖励)   【L5】
      - 3 次重试 + Cron 补偿（15 分钟 stale lease）
  → inboxService.send(vip_activated)  ✅ 唯一已接
  ↓
[买家确认收货]
  → bonusAllocationService.allocateForOrder()   【L5】
    - bizType=VIP_PACKAGE ✅ 入口守卫跳过（bonus-allocation.service.ts:63-67）
    - 不参与分润，不创建 VipEligibleOrder
```

**豁免守卫**：L5 `bonus-allocation.service.ts:63-67` 一处显式守卫，语义清晰 ✅

### 3.4 关键交界服务盘点

| 交界服务 | 文件位置 | 当前状态 |
|---|---|---|
| `CheckoutService.checkout` | `checkout.service.ts:627` | ✅ 正向健壮 |
| `CheckoutService.checkoutVipPackage` | `checkout.service.ts:684-954` | ✅ 完整 |
| `PaymentService.handlePaymentSuccess` | `payment.service.ts:250-270` + `checkout.service.ts:1417` | ✅ 完整（新流程） |
| `BonusAllocationService.allocateForOrder` | `bonus-allocation.service.ts:201` | 🔴 VIP_PLATFORM_SPLIT 缺失 |
| `BonusAllocationService.rollbackForOrder` | `bonus-allocation.service.ts:419` | 🔴 TOCTOU + 仅旧链路调用 |
| `AfterSaleRewardService.voidRewardsForOrder` | `after-sale-reward.service.ts:31-191` | ✅ 正确（但触发点软调用） |
| `ShipmentService.handleCallback` | `shipment.service.ts:48-90` | ✅ HMAC 验签 |
| `InboxService.send` | `inbox.service.ts:63` | 🔴 全项目仅 1 处调用 |

### 3.5 事件 → 监听者矩阵（L15 全量）

| # | 事件 | 发射位置 | 接入 |
|---|---|---|---|
| 1 | 订单支付成功 | `payment.service.ts:257` / `checkout.handlePaymentSuccess` | ❌ |
| 2 | 订单已发货 | `seller-orders.service.ts:ship` | ❌ |
| 3 | 物流签收 | `shipment.service.ts` callback | ❌ |
| 4 | 订单自动确认 | `order-auto-confirm.service.ts` | ❌ |
| 5 | 分润奖励到账（VIP） | `bonus.service.ts:activateVipAfterPayment` | ❌ 🔴 |
| 6 | 分润奖励到账（普通） | `normal-upstream.service.ts` | ❌ 🔴 |
| 7 | 奖励解冻 | `freeze-expire.service.ts:handleFreezeExpire` | ❌ 🔴 |
| 8 | 奖励过期失效 | `freeze-expire.service.ts:expireSingleLedger` | ❌ 🔴 |
| 9 | 提现申请成功 | `bonus.service.ts:requestWithdraw` | ❌ |
| 10 | 提现审核通过 | `admin-bonus.service.ts:approveWithdraw` | ❌ 🔴 |
| 11 | 提现审核拒绝 | `admin-bonus.service.ts:rejectWithdraw` | ❌ 🔴 |
| 12 | VIP 激活成功 | `checkout.service.ts:1515-1526` | ✅ 唯一 |
| 13 | VIP 邀请人奖励 | `bonus.service.ts:grantVipReferralBonus` | ❌ 🔴 |
| 14 | 售后申请已提交 | `after-sale.service.ts:apply` | ❌ |
| 15 | 售后审核通过 | `after-sale.service.ts approve` | ❌ |
| 16 | 售后审核驳回 | `after-sale.service.ts reject` | ❌ |
| 17 | 售后平台仲裁 | `admin-after-sale.service.ts` / timeout | ❌ |
| 18 | 退款到账 | `after-sale-reward.service.ts` | ❌ 🔴 |
| 19 | 换货运单创建 | `seller-after-sale.service.ts ship` | ❌ |
| 20 | 买家确认换货收货 | `after-sale.service.ts:confirmReceive` | ❌ |
| 21 | 商品审核通过 | `admin-products.service.ts:223 audit` | ❌ |
| 22 | 商品审核驳回 | `admin-products.service.ts:223 audit` | ❌ |
| 23 | 入驻申请通过 | `admin-merchant-applications.service.ts:87` | ❌ (走 SMS) |
| 24 | 入驻申请驳回 | `admin-merchant-applications.service.ts:207` | ❌ (走 SMS) |
| 25 | 卖家邀请员工 | `seller-company.service.ts:224 inviteStaff` | ❌ |
| 26 | 新客服消息（离线兜底） | `cs.service.ts` / `cs.gateway.ts` | ❌ |
| 27 | 红包到账 | `coupon-engine.service.ts:issueSingle` | ❌ 🔴 |
| 28 | 红包即将过期 | `coupon-engine.service.ts` Cron | ❌ |
| 29 | R12 超卖补货 | `checkout.service.ts:1264 TODO` | ❌ 🔴 |
| 30 | 发票开具完成 | invoice 模块 | ❌ |

**统计**：30 个应发事件，已接 **1 个**（3.3%）。钱事件（🔴 标记 9 项）**0 接入**。

### 3.6 六个高风险耦合点

1. **支付回调 → 多扇出写操作的事务边界**（L4→L3/L5/L6/L14）
   - 当前：主扇出在单一 Serializable 事务内，辅助操作（coupon confirm、VIP 激活、inbox 发送）事务外 setImmediate
   - 风险：辅助操作失败无补偿队列，仅 log.error
   - 状态：🟡 设计合理但缺失补偿

2. **退款原子回滚**（L7→L3/L4/L5/L14）
   - 当前：initiateRefund(mock) + Order.status 不闭环 + voidRewardsForOrder setImmediate + CouponInstance 不归还
   - 风险：退款是假、状态是假、库存不回填、收到退款无感知
   - 状态：🔴 完全断

3. **分润事务 + VIP 激活事务**（L5↔L6）
   - 当前：VIP 激活走 Phase-1/Phase-2 双阶段 Serializable + Cron 补偿；分润入口守卫 `bizType === 'VIP_PACKAGE' → return`
   - 风险：Phase-2 失败 + Cron 漏捕会导致订单已建但 VIP 未开
   - 状态：🟡 设计完整，监控缺失

4. **CheckoutSession 同一代码走普通单+VIP 单**（L3↔L6）
   - 当前：`bizType` 字段区分，`checkoutVipPackage` 是独立入口，`handlePaymentSuccess` 内按 `sessionBizType` 分支激活 VIP
   - 风险：两条路径并存，需确认 activeVipSession 互斥是否覆盖所有并发场景
   - 状态：✅ 实现完整

5. **顺丰回调 → 订单自动确认 → 分润发放**（L8→L3→L5）
   - 当前：shipment → 自动确认 Cron → allocateForOrder；事件去重依赖状态 CAS（非事件哈希唯一）
   - 风险：重复推送同事件会再次触发下游，需确认 `handleKuaidi100Callback` 去重
   - 状态：🟡 需核查

6. **平台红包抵扣 → 退款时按比例归还**（L14↔L7）
   - 当前：refund.md §156 明确"红包不退回"，L14 实现与 refund.md 一致（保持 USED），L7 退款金额已按比例扣除 couponShare
   - 风险：审查任务写的是"按比例归还"与 refund.md 冲突
   - 状态：🔴 **需用户澄清疑点（见 §9 Q1）** — 当前代码已与 refund.md 一致

---

## 4. 链路详细审查（L1-L17）

### 4.1 Tier 1 💰 钱链路（A 档）

#### L3 购物车 + 下单（CheckoutSession）— 🔴 T1 阻塞

📍 **范围**：购物车加购/合并、CheckoutSession 创建与支付回调建单、OrderRepo、CartStore、Prisma schema。

✅ **健康点**：
- Serializable 事务覆盖所有金额/库存/状态转换（checkout.service.ts:627/830/992/1417）
- 双层幂等（CheckoutSession `@@unique([userId, idempotencyKey])` + Order `idempotencyKey @unique`）
- 多商户拆单逻辑 idempotencyKey 设计良好 (`cs:{sid}:{hash}:{idx}`)
- 回滚对称性完整（RewardLedger/CouponInstance/VIP 库存/LotteryRecord 所有创建路径都有对称释放）
- P2034 重试 + 异步 cancelCheckoutSession/checkout-expire Cron 兜底

🔴 **CRITICAL 问题**：无（R12 已确认为故意设计）

🟡 **HIGH 问题**：
1. **R12 超卖通知缺失** — `checkout.service.ts:1261-1264` 仅 `logger.warn`，TODO 注释未实现卖家补货通知。是 R12 设计的另一半，必须补齐才能算"可靠发货"（同 L10 H4 / L15 #29）
2. **confirmCouponUsage 失败无补偿队列** — `checkout.service.ts:1423-1451` 失败仅 log.error
3. **activateVipAfterPayment 失败无补偿队列** — `checkout.service.ts:1507-1512` 同上
4. **多商户运费分摊 ±0.01 元尾差** — `checkout.service.ts:1124-1129` `parseFloat(toFixed(2))` 无尾差补偿

🔗 **耦合**：L4（支付回调）/ L5（分润触发）/ L6（VIP 激活）/ L14（红包）/ L7（售后状态回滚）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md`

#### L4 支付宝支付 — 🔴 T1 阻塞

📍 **范围**：`payment/*` + schema Payment/Refund + .env.example ALIPAY_*。

✅ **健康点**：
- AlipaySdk 真实 import `alipay.service.ts:3`（非 mock）
- SDK 证书/公钥双路径初始化 (`alipay.service.ts:14-81`)
- `createAppPayOrder` 真实调用 `sdk.sdkExecute('alipay.trade.app.pay')` (`:92-122`)
- `verifyNotify` 证书验签 `sdk.checkNotifySignV2(postData)` (`:128-140`)
- `handlePaymentSuccess` Serializable + 3 次 P2034 重试 + 扇出 9 张表
- CAS 幂等（SUCCESS 分支 `where status IN [INIT, PENDING]`，count=0 返回 null）

🔴 **CRITICAL 问题**：
1. **🚨-01 `PaymentService.initiateRefund` 是占位 mock** — `payment.service.ts:56-89` 直接返回 `{success:true, providerRefundId:'REFUND-'+Date.now()}`。`AlipayService.refund()` 在 `:145-174` 已真实实现但**未被 PaymentService 注入**。下游 6 个调用方（admin/seller/timeout/auto-refund/payment 内部）全部假退款。违反消法"原路退回"义务。
2. **🚨-02 `.env.example` 缺 `PAYMENT_WEBHOOK_SECRET` / `WEBHOOK_IP_WHITELIST`** — 生产未配置会 403 阻断所有回调
3. **🚨-03 `handleAlipayNotify` 缺 `WebhookIpGuard`** — `payment.controller.ts:52-98` 只有 `@Public()`，无 IP 白名单

🟡 **HIGH 问题**：
1. **H-01** `AlipayService` 证书加载失败静默降级 null (`alipay.service.ts:66-68` catch 只 log 不 throw)，生产环境证书配错会"假装启动成功"
2. **H-02** `queryOrder` 定义但无任何业务代码调用（`alipay.service.ts:179-203` 孤岛）
3. **H-03** `Refund` 模型标 `@deprecated` 但仍在用（`schema.prisma:1501` vs 代码现状矛盾）

🔗 **耦合**：L3（handlePaymentSuccess）/ L5（分润触发）/ L7（所有退款链路）/ L14（红包 release）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md`

#### L5 分润奖励（Reward Allocation）— 🔴 T1 阻塞

📍 **范围**：`bonus/engine/*` + `bonus.service.ts` + schema Reward/Vip/Normal 相关模型。

✅ **健康点**：
- 正向路径（allocate + unlock + freeze-expire）设计完备
- 事务保护到位（Serializable + P2034 + idempotencyKey `@unique`）
- 账本一致性良好（Ledger + Account 成对）
- 六分结构 VIP 50/30/10/2/2/6 与 Normal 50/16/16/8/8/2 默认值校验
- `bizType === 'VIP_PACKAGE'` 入口守卫 (`bonus-allocation.service.ts:63-67`)
- `findKthAncestor` 使用递归 CTE (`vip-upstream.ts:195-210`)
- 双 Cron 冻结过期处理 (`freeze-expire.ts handleFreezeExpire` 每小时 + `handleReturnFreezeExpire` 每 10 分钟)
- 平台收入 `reserveFund = profit - Σ前5池` 末位补差法

🔴 **CRITICAL 问题**：
1. **CRITICAL-01 rollbackForOrder TOCTOU** — `bonus-allocation.service.ts:265-338`。`findMany` 在 `$transaction` 外读取 allocations snapshot，并发 freeze-expire Cron 与 rollback 间 `frozen` 账户可漂移（RETURN_FROZEN → FROZEN 转换的时间窗）。证据：stale snapshot 看到 RETURN_FROZEN，实际已 FROZEN，聚合阶段跳过 frozen 扣减 → account.frozen 虚增永久无法释放。
2. **CRITICAL-02 `VIP_PLATFORM_SPLIT` 枚举缺失** — `bonus-allocation.service.ts:616` 代码使用 `ruleType: 'VIP_PLATFORM_SPLIT'`，但 `schema.prisma:336-342` `AllocationRuleType` 枚举只有 `NORMAL_BROADCAST / NORMAL_TREE / VIP_UPSTREAM / PLATFORM_SPLIT / ZERO_PROFIT`。首个真实 VIP 订单走到 `executeVipPlatformSplit` 会 enum violation → 事务回滚 → VIP 分润完全崩溃。

🟡 **HIGH 问题**（ASYM/HIGH）：
1. **ASYM-01** rollback 未回退 `VipProgress.unlockedLevel` (`vip-upstream.ts:274-278`)，展示字段失真
2. **ASYM-02** rollback 未检查 `VipProgress.exitedAt`，最后一单退款后祖先被永久路由到 VIP_EXITED（资金错归平台）
3. **HIGH-01** rollback 事务缺 `timeout` 参数（默认 5s 易超时）— `bonus-allocation.ts:419`
4. **HIGH-02** WITHDRAWN ledger 退款时仅 `logger.warn`，无追缴任务（`bonus-allocation.ts:303-307`）
5. **HIGH-03** rollback 硬编码 `ruleType:'NORMAL_BROADCAST'` 作为回滚标识（`:284`），BI 统计失真
6. **HIGH-04** `unlockFrozenRewards(tx, userId, ...)` 命名参数与调用点语义冲突（vip-upstream.ts:161）

🔗 **耦合**：L3（订单确认触发 allocate）/ L4（退款触发 rollback）/ L6（VIP 豁免 + 激活事务）/ L7（voidRewardsForOrder 为另一套实现，双链路）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md`

#### L14 平台红包（Coupon）— 🟢 健康

📍 **范围**：平台红包独立体系（与 Reward 完全隔离）。Schema、Service、engine、结算集成、过期 Cron、管理端 CRUD。

✅ **健康点**：
- Phase A0 重命名彻底（全量 grep `RED_PACKET/NORMAL_RED_PACKET/RedPack` 零命中）
- Serializable 事务一致性：claim/reserve/confirm/manualIssue/autoIssue 全部 Serializable + CAS 乐观锁 + P2034 重试
- 快照解耦：CouponInstance 冗余快照 `discountType/discountValue/maxDiscountAmount/minOrderAmount`
- 触发事件去重：`CouponTriggerEvent @@unique([userId, triggerType, eventKey])`
- 补偿路径完整：`checkout-expire.service.ts` 扫 PAID/COMPLETED/FAILED/EXPIRED 中仍 RESERVED 的会话
- 所有 `releaseCoupons` 调用点对称（checkout/payment fail/expire 全覆盖）
- Critical 11 段管理端更新禁止改 ACTIVE 状态敏感字段 + totalQuota 只增不减

🔴 **CRITICAL 问题**：
1. **C1 审查任务与 refund.md 语义冲突** — 任务写"退款按比例归还红包"，`refund.md:156-159` 写"红包不退回"。代码实现与 refund.md 一致（保持 USED，不归还）。**需用户澄清**（见 §9 Q1），不要自行猜测修改代码。

🟡 **HIGH 问题**：
1. **H1** `validateAndReserveCoupons` 对重复 ID 无幂等防御 (`coupon.service.ts:423-443`)，错误信息误导
2. **H2** `claimCoupon` 把 P2002 误译为"已领取过" (`:211-216`)，应映射为 ConflictException 让前端重试
3. **H3** `validateAndReserveCoupons` userId 依赖调用者正确传入（应改为 `@CurrentUser` 强制注入）

🔗 **耦合**：L3（结算锁定/支付成功确认/过期释放）/ L7（退款按比例扣除 couponShare）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md`

### 4.2 Tier 2 💰 钱链路（A 档）

#### L6 VIP 多档位礼包 — 🟢 健康

📍 **范围**：VipPackage 档位、赠品方案、支付激活、三叉树落位、推荐奖励。

✅ **健康点**：
- 多档位模型设计清晰：VipPackage ↔ VipGiftOption 一对多，`referralBonusRate` 下沉到档位层
- 幂等性多层保护：DTO idempotencyKey → CheckoutSession 活跃互斥 → VipPurchase.userId unique → 激活状态机 CAS → P2002 fallback
- VipActivationStatus 5 态 + Phase-1/Phase-2 双阶段事务 + 15 分钟超时定义 + Cron 重试
- Serializable 覆盖所有写操作（checkoutVipPackage/handlePaymentSuccess/cancelSession/activateVipAfterPayment）
- L5 守卫入口干净：`bonus-allocation.service.ts:63-67` `bizType === 'VIP_PACKAGE' → return`
- 退款拦截明确：`after-sale.service.ts:98-100` 直接 BadRequest
- 发货复用普通链路，seller-orders 原生支持 bizType 过滤
- 前端 `app/vip/gifts.tsx` 983 行完整档位切换 UI + 金色装饰

🔴 **CRITICAL 问题**：无（H1 `as any` 疑点已撤销，Prisma findUnique+include 默认返回 scalar）

🟡 **HIGH 问题**：
1. **H2** 旧 `purchaseVip()` 方法残留 (`bonus.service.ts:132-215`)。Controller 已 deprecated 抛 GoneException，但 Service 方法仍存在，参数 `amount=0 packageId=undefined referralBonusRate=0`，若被内部误调用会创建无效 VipPurchase。**建议删除或改为直接 throw**。

🟡 **MEDIUM**：
1. M1 inboxService 软依赖静默丢失
2. M3 BFS 子树全满降级到系统节点，与"邀请关系"直觉不符，需确认
3. M4 `giftSkuId` 字段废弃但仍保留

🔗 **耦合**：L3（checkoutVipPackage）/ L4（支付回调）/ L5（豁免 + VIP referralBonus）/ L7（不可退拦截）/ L15（vip_activated 唯一已接）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md`

#### L7 统一售后（退/换货）— 🔴 T1 阻塞

📍 **范围**：AfterSaleRequest 全链路。权威规则 `docs/features/refund.md` 23 条。

✅ **健康点**：
- 数据模型完整：AfterSaleRequest + 14 状态枚举 + 3 类型枚举 + 3 退货政策枚举（`schema.prisma:405-432, 2137-2185`）
- refund.md 23 条规则：**15 ✅ / 6 🟡 / 1 🔴 / 1 ⬜**
- 状态机健壮：CAS + Serializable + P2034 重试三件套齐全
- 4 个超时 Cron 驱动 4 个 handler（卖家审核/买家寄回/卖家签收/买家确认）
- `voidRewardsForOrder` 实现完整：扫 `RewardLedger(ORDER, orderId, FREEZE, [RETURN_FROZEN/FROZEN])` + 防御 `AVAILABLE` → VOIDED
- RETURN_FROZEN 两层冻结机制 + 10 分钟扫描转 FROZEN
- 换货后再退货限制：跳过卖家审核直接仲裁 (`after-sale.service.ts:164-177`)
- 多售后并行规则：ACTIVE_STATUSES 集合守护同 item 不可重复
- 生鲜 24h / 七天无理由 / 价格阈值决定寄回 / VIP_PACKAGE 拒绝 / 奖品拒绝 全部正确

🔴 **CRITICAL 问题**：
1. **C1 支付宝退款通道完全没接通** — 同 L4 🚨-01。用户"申请售后 → 卖家批准 → 已退款"只改数据库，钱没划回
2. **C2 Order 状态机完全未闭环** — after-sale 全模块 grep `order.update` 零匹配。全退完成没人把 Order.status → REFUNDED（rule 20）。唯一写 REFUNDED 的是遗留 `admin-refunds.service.ts:329`，两套逻辑冲突
3. **C3 售后退款无补偿重试** — `payment.service.ts:91-161 retryStaleAutoRefunds` 只扫 `merchantRefundNo startsWith 'AUTO-'`，售后用 `AS-` 前缀（`seller-after-sale.service.ts:1100` / `after-sale-timeout.service.ts:525` / `admin-after-sale.service.ts:434`）→ 失败永远停 REFUNDING
4. **C4 App 退货物流字段名与后端 DTO 不匹配** — App `{carrierName, waybillNo}` (`src/repos/AfterSaleRepo.ts:35-38`) vs 后端 `{returnCarrierName, returnWaybillNo}` (`return-shipping.dto.ts:8,14`) → 买家寄回流程 400 不可用
5. **C5 setImmediate 吞异常 + 无持久化队列** — 退款/归平台/确认收货都用 `setImmediate(async()=>{... catch log only})`，进程重启丢消息

🟡 **HIGH**（T2 阻塞）：
1. **H1** rule 20 部分退货无订单标识（同 C2）
2. **H2** 规则 14 库存不回填（after-sale 目录 grep stock.increment 零匹配）
3. **H3** App 侧售后类型展示无动态过滤（`app/orders/after-sale/[id].tsx:83-102`）
4. **H4** 规则 12 质量问题时限未在后台可视化
5. **H5** 规则 11 NORMAL_RETURN_DAYS ≤7 未做 guard
6. **H6** 规则 9 质量退货运费"平台承担"仅停留在文案
7. **H7** 旧 Refund 链路未下线 → 双写混乱 (`seller.module.ts:11` / `admin.module.ts:19` 仍注册 SellerRefundsModule/AdminRefundsModule)
8. **H8** 奖励归平台异步触发可能丢失（setImmediate → 可能 AfterSale REFUNDED 但 Ledger 仍 RETURN_FROZEN → freeze-expire 转 FROZEN → 用户领钱套利）

🔗 **耦合**：L3（回滚库存）/ L4（initiateRefund + Refund 模型）/ L5（voidRewardsForOrder 双链路）/ L6（VIP 拦截）/ L14（红包 couponShare）/ L15（状态通知 0 接入）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md`

#### L11 发票申请 — 🟡 T2 可带可不带

📍 **范围**：Invoice / InvoiceProfile，买家 App 发票页（5 页齐全）+ 管理后台（2 页齐全）+ 卖家只读展示。

✅ **健康点**：
- Schema 完整（`schema.prisma:1610-1641`），含 `failReason` 字段
- InvoiceProfile DTO 校验严格：taxNo 正则 `/^[A-Z0-9]{15,20}$/`、phone `/^1\d{10}$/`、email IsEmail
- 管理端状态机 **标杆实现**：`admin-invoices.service.ts:174-243` issueInvoice/failInvoice 使用 Serializable + updateMany CAS + MAX_RETRIES=3 P2034
- `@AuditLog()` 装饰器挂载齐全
- 种子权限 `invoices:read / invoices:issue` 就位

🔴 **HIGH 问题（T1 阻塞真实业务，但可整体下线作为 v1.1）**：
1. **H1** 买家 App 订单详情缺少申请发票入口 — `app/orders/[id].tsx` grep `invoice/发票` 零匹配
2. **H2** 买家 App 个人中心缺少"我的发票"入口
3. **H3** 买家订单详情 API 未返回 invoiceStatus（`OrdersService.findById` 未 include invoice）

🟡 **MEDIUM**：
1. M1 `cancelInvoice` 无 Serializable/CAS (`invoice.service.ts:151`)
2. M2 keyword 搜索缺发票抬头（profileSnapshot JSON path）
3. M3 部分退款后应开票金额未扣减
4. M4 findAll 缺 user.phone select

**发布建议**：若来不及，**可将 L11 从 v1.0 完全下线**（UI 入口全部隐藏），作为 v1.1 功能。对核心交易链路无影响。

🔗 **耦合**：L3（订单状态 RECEIVED 才能申请）/ L4（订单金额）/ L12（管理端审核）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md`

### 4.3 Tier 1 标准链路（B 档）

#### L1 三系统认证 — 🟡 T1 部分阻塞

📍 **范围**：买家 / 卖家 / 管理三端认证链路（后端 + 前端 + Schema）。

✅ **健康点**：
- 三端隔离结构正确：独立 JWT secret / Strategy / Guard / Session 表
- 会话撤销 + refresh CAS + 账号锁定（5 次失败 30 分钟）+ RBAC 实时校验均已到位
- 23 个验证点通过（bcrypt cost 10 / SellerJwtStrategy 校验 payload.type / SellerAuthGuard Company.status 校验 / 管理端 PermissionGuard 实时查库 / @CurrentSeller 装饰器 / 多企业选择 tempToken 5 分钟倒计时）
- 所有 seller/admin 控制器类级 `@Public() + @UseGuards(...)` 全部通过（13 seller + 25 admin 文件审计）

🔴 **HIGH（用户 2026-04-11 已确认为 T1 必做）**：
1. **H1 卖家端补账号密码登录** — `seller-auth.dto.ts:10` 只有 `{phone, code}`。用户决策：v1.0 必须补齐账号密码登录分支（与手机验证码并存）
   - 新增 `SellerPasswordLoginDto` + `loginByPassword` 方法 + `POST /seller/auth/login-by-password` + 前端 Tab
   - CompanyStaff schema 需核对是否已有 `passwordHash` 字段（种子 `seed.ts:2468` 位置可疑，见 L5 审查）
2. **H2 管理端补图形验证码 + 手机号短信验证码登录** — `admin-login.dto.ts:3-12` 只有 `{username, password}`。用户决策：
   - (a) 图形验证码（防暴力/撞库/短信轰炸）
   - (b) 手机号 + SMS 验证码登录（与密码登录并存）

🟡 **MEDIUM**：
1. 买家 JWT strategy 未校验 `payload.type`（seller 有），建议纵深防御
2. `.env.example` 缺 `ADMIN_JWT_SECRET` / `SELLER_JWT_SECRET`（同 X4/X5）
3. 买家 logout 未限流
4. 启动期未断言三 JWT secret 互不相等

🔗 **耦合**：所有模块依赖认证 Guard

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L01-auth.md`

#### L2 商品 + AI 搜索 — 🟢 健康（带 UX 疑点）

📍 **范围**：`product/*` + `ai/*` + 买家 App 商品详情/搜索/发现/AI 助手。

✅ **健康点**：
- 商品浏览链路完整：list/detail/categories 全部对接真实 API
- Qwen 通过 DashScope OpenAI 兼容接口真实调用（6 处 fetch 点，非 mock）
- 意图识别 + classify prompt 工程质量高（统一 prompt 31 示例覆盖同音字/打开 X 白名单/爆款热销 → recommend）
- Fallback 完整：所有 Qwen 调用都有 timeout + catch + 硬编码兜底文案
- 前后端契约对齐：ProductRepo.list 参数全部透传
- 语音识别 `asr.service.ts:76` 真实接入阿里云 gummy-chat-v1 WebSocket

🔴 **P1（用户感知质量）**：
1. **P1-01 商品 AI 品质评分是前端伪造** — `app/product/[id].tsx:35-51 getAiScore()` 基于 `productId.charCodeAt` 哈希生成 85-98 伪随机分，从 4 条写死文案取一条。UI 标签写"AI 品质评分"。作者自己已注释"真实场景应从后端获取"
2. **P1-02 企业 AI 信赖分硬编码 96** — `app/product/[id].tsx:460` 写死 `<Text>96</Text>`
3. **P1-03 搜索 AI 摘要本地拼字符串** — `app/search.tsx:440-472` `useMemo` 拼 "为您找到 N 款相关商品..."

**用户决策**：v1.0 选择方案 B（改标签为"示例评分"去掉 AI 字样），v1.1 再接真后端

🟡 **P2 代码健壮性**：
1. **P2-01** `parseChatResponse` 未处理 Qwen 数组包裹 JSON (`ai.service.ts:3668`)，bb29234 已证实 Qwen 会偶发返回 `[{...}]`。10 行代码修复，建议 v1.0 就补
2. **P2-02** 首页快捷指令 vs 后端 shortcuts 不同步（前端 4 条 vs 后端 6 条）
3. **P2-03** 语义升级 Plus 管道已下线（`ai.service.ts:3134-3156` 注释"按操作链路预算直接使用 Flash 结果"），与 `docs/ai/ai.md` 设计不一致

**AI 开关激活策略**（用户已确认）：
- `AI_SEMANTIC_SLOTS_ENABLED=true`（低风险，纯 prompt 变化）
- `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` + `AI_SEMANTIC_SCORING_ENABLED` 打包后延到 v1.1

🔗 **耦合**：L10（商品 schema）/ L9（智能客服同源 Qwen 调用模式）/ L15（无耦合）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md`

#### L9 智能客服 — 🟡 T1 部分阻塞（5 个硬编码常量）

📍 **范围**：`customer-service/*` 20+ 文件 + `app/cs/index.tsx` + `admin/src/pages/cs/*` 6 页面。

✅ **健康点**：
- 并发安全教科书级：createSession Serializable + 重试、transferToAgent CAS updateMany、agentAcceptSession `FOR UPDATE SKIP LOCKED` 原子选择坐席
- D2 路由完成后再次校验 session.status 防幽灵 AI 消息
- D4/D9 前端对账：本地 `sending/failed` 三态 + `(createdAt, id)` 复合排序 + polling/POST 去重
- Prompt 注入防护：历史对话独立 role、context ID JSON.stringify 转义、system prompt 安全规则
- 订单/售后上下文注入完整（`cs.service.ts:453-626 buildAiContext`）
- 20+ spec 测试套件 172/172 通过

🔴 **BLOCK（上线前必改）**：
1. **BLOCK-1 SESSION_IDLE_TIMEOUT 硬编码 5 秒** — `cs.service.ts:26` 注释标明是测试值。用户发完消息 5 秒没再输入再进客服就会被认为超时会话关闭。生产应为 2 小时
2. **BLOCK-2 清理服务 4 个测试常量 + Cron 频率** — `cs-cleanup.service.ts:23-34`
   - `AI_IDLE_TIMEOUT_MS = 10 * 1000` (生产 2 * 60 * 60 * 1000)
   - `QUEUING_TIMEOUT_MS = 30 * 1000` (生产 30 * 60 * 1000)
   - `AGENT_IDLE_TIMEOUT_MS = 60 * 1000` (生产 60 * 60 * 1000)
   - `@Cron(EVERY_30_SECONDS)` → `EVERY_10_MINUTES`

修复只需改 5 行代码 + 删 1 个 TODO 注释。

🟡 **HIGH**：
1. **H-1** Gateway `handleSend` 废 call (`cs.gateway.ts:146 getActiveSession(... '', undefined)` 永远返回 null)
2. **H-2** `consecutiveFailures` Map 内存泄漏（Cron 清理未走 closeSession 路径）
3. **H-3** `BANK_CARD_REGEX` 会误吃订单号/物流单号（`cs-masking.service.ts:26` 13-19 位连续数字）
4. **H-4** Socket 消息到 session 房间无权限清理
5. **H-5** `cs.controller.ts:90` 类似废 call

🟡 **MEDIUM**（6 项）：M-2 买家 App 未接 Socket.IO 客户端（仅 HTTP 5s 轮询）/ M-5 工单 category 全 'OTHER'（无 intent→category 映射）等

🔗 **耦合**：L3（订单 context）/ L7（售后 context）/ L15（新客服消息离线兜底未接）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md`

#### L10 卖家上货 + 商品审核 — 🟡 T1 阻塞（权限漏洞）

📍 **范围**：`seller/products/` + `admin/products/` + `upload/` + `product/` + 卖家/管理端商品页。

✅ **健康点**：
- OSS 真实接通（非 mock）：`upload.service.ts:7, 45-58, 155-168` 真实 ali-oss SDK + 证书 + 私有 URL + 路径遍历防护
- Sharp 转码 WebP + EXIF 去除 + Magic number 校验 + jsQR 二维码检测
- 审核闭环：`AuditProductDto` + `AuditLogInterceptor` + 前端 Modal + 状态回调
- Serializable 事务覆盖 updateSkus（自动定价 + 软删 INACTIVE SKU）
- 自动定价 TOCTOU 防护：`sysConfig.markupRate` 事务内读取
- 卖家端 companyId 强制过滤：所有 seller-products 方法首参 companyId 来自 `@CurrentSeller('companyId')`

🔴 **HIGH（v1.0 前必修）**：
1. **H1 OPERATOR 可创建/删除商品** — `seller-products.controller.ts:26-104` 每个端点只有 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`，**完全没有 `@SellerRoles('OWNER', 'MANAGER')`**。`seller-role.guard.ts:32-34` 规则"无角色要求则放行"。对比 `seller-company.controller.ts` 企业/员工端点全都有，唯独商品端点漏掉
2. **H3 审核通过后不自动上架** — `admin-products.service.ts:223-231 audit()` 只更新 auditStatus 不动 status。与需求"审核通过自动上架"不符，需用户确认决策
3. **H4 超卖补货通知未实现** — `checkout.service.ts:1264` 仍是 TODO（同 L3 R12 / L15 #29）

~~H2 描述 ≥20 字~~ → 🟡 **降级为非 T1**（2026-04-11 用户决策）

🟡 **MEDIUM**：
1. M2 REJECTED 编辑不回 PENDING（`seller-products.service.ts:264-285`，只处理 APPROVED）→ 死锁
2. M3 图片上传无"上传中"保护
3. M4 admin update 商品缺少 SKU 编辑 → **奖品商品手动定价强依赖**，若 v1.0 要上奖品系统此项必做

🔗 **耦合**：L3（超卖通知）/ L12（管理端审核 Tab）/ L15（商品审核通知 0 接入）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md`

#### L12 管理后台全页面 — 🟡 T1 阻塞（1 Critical + 3 High）

📍 **范围**：`admin/src/pages/` 53 个页面 × `backend/src/modules/admin/` 29 个控制器。

✅ **健康点**：
- 26 个 API client 与 29 个 admin controller 对齐度高
- 审计日志 `@AuditLog` 覆盖主要写操作（products / orders / companies / merchant-applications 全覆盖）
- 三系统独立 JWT secret + Strategy + Guard（同 L1/X4）
- CS 管理端 6 页面全部联通
- PermissionGate 组件按权限控制 UI 显隐

🔴 **CRITICAL**：
1. **C1 `/admin/replacements` 整条链路 404** — 前端 `admin/src/pages/replacements/` + `api/replacements.ts` + `App.tsx:109` + `AdminLayout.tsx:74` + `dashboard/index.tsx:24,71` 全部引用，但**后端完全不存在** `admin/replacements` 控制器（已迁到 `/admin/after-sale`）
   - **最严重**：Dashboard 首屏硬编码调用 `getReplacements({status:'REQUESTED'})`，所有管理员打开首页都 404 + 60 秒 refetch
   - 修复：Dashboard 删 replacement 条目 / 菜单删 / App.tsx 删路由 / 删页面目录 / 删 PERMISSIONS.REPLACEMENTS_* / 更新 audit getTargetUrl

🟡 **HIGH**：
1. **H1** 前端 `PERMISSIONS` 缺 `dashboard:read` — 后端 `/admin/stats/*` 三端点都挂 `@RequirePermission('dashboard:read')`，非超管打开首页 403
2. **H2** 新旧售后系统并存 — `/admin/refunds` + `PERMISSIONS.ORDERS_REFUND` 仍挂载，但规则说"旧"；与 `/admin/after-sale` 新链路并存 → 双写隐患
3. **H3** 入驻申请缺顶层菜单 — `admin-merchant-applications` controller 存在且被 `companies` 页 Tab 调用，但顶层菜单无独立入口或 Badge

🟡 **MEDIUM**：
1. **M1** VipPackage CRUD 权限码不一致（后端用 `config:*`，前端用 `VIP_GIFT_*`）→ 管理员看到按钮但点击 403
2. **M2** `PERMISSIONS.PRODUCTS_CREATE / PRODUCTS_DELETE` 是死代码
3. **M3** 审计日志 `getTargetUrl` 映射过时（replacement/refund/coupon_campaign 跳转错）
4. **M4** 发现页筛选走 RuleConfig 而非独立数据模型

🔗 **耦合**：L7（新旧 after-sale）/ L5（bonus 配置）/ L14（coupon CRUD）/ L11（invoice 管理）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md`

#### L15 消息中心（事件盘点）— 🔴 T1 阻塞

📍 **范围**：`inbox/` 3 文件 + InboxMessage schema + `app/inbox/index.tsx` + 全项目调用点 grep。

✅ **健康点**：
- InboxService 骨架就绪（send/list/markRead/markAllRead/getUnreadCount 5 方法）
- InboxMessage schema + /inbox 路由可用
- 买家 App 消息中心三 Tab UI（互动/交易/系统）已实现

🔴 **CRITICAL**：
1. **全项目只有 1 处业务代码调用 `InboxService.send()`** — `checkout.service.ts:1516` VIP 激活通知。即便这一处也是软依赖：`inboxService: any = null` + `moduleRef.get(..., {strict:false})` 动态注入 + catch warn 不阻塞
2. **30 个应发事件，29 个漏接（96.7% 缺口）**，钱相关 9 项 0 接入：
   - #5/6 分润奖励到账 / #7 奖励解冻 / #8 奖励过期 / #10 提现审核通过 / #11 提现审核拒绝 / #13 VIP 邀请人奖励 / #18 退款到账 / #27 红包到账
3. **前后端 InboxType 枚举脱节** — 前端封闭 8 种社交类型，后端唯一已用 `vip_activated` 不在前端枚举中，后端一旦补齐前端 TS 类型报错

🟡 **HIGH（交易体验）**：
- #1/2/3/4 订单支付/发货/签收/自动确认
- #14-20 售后全链路（申请/审核/仲裁/换货/确认收货）
- #26 离线客服消息兜底
- #29 R12 超卖补货（代码已 TODO）

🟡 **MEDIUM**：
- S1 `send()` 无幂等键（cron 重试会产生重复消息）
- S2 inboxService 软依赖风险（L06 M1 同源）
- S3 无 TTL / 清理 cron
- C2 category 字符串无 enum 校验

**推送通道现状**：

| 通道 | 状态 |
|---|---|
| 站内消息 | ⚠️ 骨架可用仅 1 处接入 |
| Expo Push / 推送 SDK | ❌ 未接入（UserDevice.pushToken 字段存在但无服务） |
| SMS | ⚠️ 仅验证码和入驻审核 |
| Socket.IO 实时 | ✅ 仅客服（离线无 inbox fallback） |
| 邮件 / 微信服务号 | ❌ 未接入 |

🔗 **耦合**：**所有写操作链路均缺 inbox 通知**（L3/L4/L5/L6/L7/L10/L12/L14）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md`

#### L16 地址管理 — 🔴 T1 阻塞

📍 **范围**：用户收货地址 CRUD / 默认地址 / 结算页选择 / Order.addressSnapshot / 卖家发货地址。

✅ **健康点**：
- Address CRUD 基本完整，userId 归属校验
- addressSnapshot 入订单时 AES 加密 (`checkout.service.ts:355-374`)
- 订单读回解密 + `maskAddressSnapshot` 脱敏 (`order.service.ts:1114-1122`)
- 结算页地址选择 + 自动选中默认地址
- 无地址空态处理完整

🔴 **P0（阻塞 L8 顺丰迁移）**：
1. **P0 addressSnapshot 字段名错位** — `seller-shipping.service.ts:52-78 parseAddressSnapshot` 读 `addr.name/phone/province/city/district`，与 `checkout.service.ts:363/778` 实际写入的 `{recipientName, phone, regionCode, regionText, detail}` **完全不匹配**。结果面单收件人必空 + 只有 detail 作为收件地址。单测 `seller-shipping.service.spec.ts:33-40` 使用虚构旧字段未覆盖真实 shape
2. **P1 卖家发货地址模型不结构化** — `Company.address Json?` 只存 `{lng, lat, text}` 单字符串（`schema.prisma:905`）。顺丰丰桥 `EXP_RECE_CREATE_ORDER` 要求省/市/区/详细地址结构化字段

🟡 **P1/P2**：
1. `address.service.ts:39-99` create/update 设默认未事务，并发可产生 0 或 2 个默认
2. `count()` + 后续 `create()` 非原子
3. `remove` 兜底选默认非事务
4. App 端表单无行政区划选择器，`regionCode` 永远为空
5. `src/types/domain/Address.ts` 缺 `regionCode` / `location` 字段

🔗 **耦合**：L3（结算快照）/ L8（顺丰直连硬前置 PC-1/PC-2）/ L7（售后寄回地址）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L16-address.md`

#### L17 溯源管理 — ⬜ 未完成（基建骨架可用）

📍 **范围**：溯源批次管理三端联通 + 商品/订单关联。

✅ **健康点**：
- Schema 模型完整（`schema.prisma:1218-1264`）：TraceBatch + TraceEvent + ProductTraceLink + OrderItemTraceLink
- 管理端/卖家端批次 CRUD 三端一致，companyId 强制绑定
- 审计日志 `SellerAudit` + `@RequirePermission('trace:*')` 齐全

🔴 **HIGH（核心缺口）**：
1. **H1 缺失 `ProductTraceLink` CRUD API** — seller/admin 都没有商品绑定批次的 API（全仓 `productTraceLink.create` 零命中）
2. **H2 缺失 `TraceEvent` CRUD API** — seller/admin/public 都没有 `POST trace/events`
3. **H3 前端 `TraceBatch` 类型含 `productId/stage/status/ownershipClaim.verifiedAt`，Schema 无对应字段** — `src/types/domain/Trace.ts:10-26` 会渲染空洞
4. **H4 买家 App 溯源页走 AI mock 未对接 TraceRepo** — `app/ai/trace.tsx` 调 `AiFeatureRepo.getTraceOverview`，真实 `TraceRepo.getProductTrace` 未被消费

🟡 **MEDIUM**：
1. M1 `getOrderTrace` 未按 orderItemId 合并 batches
2. M2 `OrderItemTraceLink` 无任何写入点（订单/发货流程）
3. M3 `TraceRepo.ts` mock 使用不存在的 event 类型（`SEED/PLANT/HARVEST` 应为 `FARMING/...`）

**E2E 结论**：端到端链路在"关联商品"这一步就断了。当前只有"批次 CRUD + meta"这一半功能可用。属于 T2 补齐项。

🔗 **耦合**：L10（商品关联）/ L3（订单发货时 OrderItemTraceLink 写入）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L17-trace.md`

### 4.4 基建（C 档）

#### L8 顺丰丰桥直连迁移 — 🟡 规划完整待执行

📍 **范围**：移除 Kuaidi100Service/Kuaidi100WaybillService，新建 SfExpressService，切换卖家发货 / 物流查询 / 回调全链路。零数据迁移（Shipment.carrierCode 已是 SF）。

**前置条件（硬阻断）**：
- **PC-1** 卖家 Company 发货地址结构化（L16 P1 问题）
- **PC-2** 修复 addressSnapshot 字段名错位（L16 P0 问题）

**22 步实施清单**：
- 阶段 0：前置修复 0.75 天（S0.1 字段名 + S0.2 结构化 schema）
- 阶段 1：用户线下申请 墙钟 6-14 天（S1.1 月结账号 + S1.2 丰桥认证 + API 审批）
- 阶段 2：SfExpressService 开发 3.5 天（S2.1-S2.8：骨架/签名/createOrder/printWaybill/cancelOrder/queryRoute/parsePushCallback/测试）
- 阶段 3：改造上游 1.85 天（S3.1-S3.5：SellerShippingService/ShipmentService/Module/env/测试）
- 阶段 4：沙箱联调 1.5 天（S4.1-S4.6：部署/发单/查询/推送/取消/云打印审核）
- 阶段 5：生产切换 + 清理 0.55 天（S5.1-S5.4：生产凭证/smoke test/删文件/文档）

**工时合计**：≈ 8.15 天 AI 工时 + 2 天用户工时 + 墙钟 10-16 天（含外部审批）

**回滚方案**：保留 `SHIPPING_PROVIDER=sf|kuaidi100` 环境变量开关，生产稳定运行满 7 天后删文件。

**风险矩阵**：R1 沙箱审核 / R2 推送签名格式 / R3 地址不结构化 / R4 隐性引用 / R5 checkWord 泄露 / R6 opCode 新编码 / R7 历史订单字段 / R8 商户地址未补齐。

🔗 **耦合**：L16（硬前置）/ L10（卖家设置页）/ L7（换货面单）/ L17（监控埋点）

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md`

#### L13 v1.0 部署上线 Checklist — 🟡 计划完整待执行

📍 **范围**：阶梯上线（管理后台 → 卖家后台 → 种子商户上货 → App 对外），首批 500 用户。

**11 步实施清单**：

1. **云服务器采购**（用户 1h）— 阿里云 ECS 华东杭州 4 核 8G 100GB SSD 5Mbps Ubuntu 22.04
2. **环境安装**（AI 2h）— Node 20 LTS / PG 15 / Redis 7 / Nginx 1.24 / Certbot / PM2
3. **域名 DNS**（用户 30min）— 6 个子域 A 记录 + CAA 记录
4. **SSL 证书**（AI 30min）— certbot --nginx 6 个子域
5. **部署后端 NestJS**（AI 3h）— 生产 .env + 支付宝证书 + prisma migrate deploy + db seed + PM2
6. **部署管理后台**（AI 1h）— vite build + rsync + Nginx + 改超管密码
7. **部署卖家后台**（AI 1h）— 同上 + 种子商户入驻
8. **部署官网 / App 落地页**（AI 2h）— 商户入驻表单 + Universal Link `.well-known` + 推荐码落地页
9. **App 客户端发布**（AI 8h + 审核等待）— EAS build iOS/Android + TestFlight + 国内商店 + App 备案号
10. **基础监控**（AI 2h）— PM2 monit + health cron + 磁盘告警 + PG 慢查询 + 云监控站点监控
11. **数据备份**（AI 2h）— pg_dump 每日 + Redis RDB + ossutil 上传 OSS + 30/90 天生命周期 + 恢复演练

**生产 .env 必配变量**：详见 `L13-deployment.md` 第 462-556 行 15 组配置（基础/DB/Redis/3 套 JWT/Webhook/支付宝/顺丰/OSS/SMS/SMTP/AI/微信）。

**Mock 开关切换清单**（7 项）：
- `SMS_MOCK=false` / `UPLOAD_LOCAL=false` / `UPLOAD_LOCAL_PRIVATE=false`
- `WECHAT_MOCK=true`（v1.0 保留）
- `AI_SEMANTIC_SLOTS_ENABLED=true` / `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=false` / `AI_SEMANTIC_SCORING_ENABLED=false`（用户决策）

**完成判定**：全部步骤勾选 + 生产 smoke test（后端健康 / 三端登录 / 种子商户上货 / 官网表单 / TestFlight 核心流程 / 监控告警触发 / 备份恢复演练）+ 首批 500 用户接入后 48h 无 P0 事件。

🔗 **耦合**：依赖 L01-L12 + L14-L17 所有修复合并 + L8 顺丰直连联调完成

📂 完整细节：`docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md`

---

## 5. 跨链路耦合矩阵（17×17 快查表）

图例：**钱** = 金额流动 / **状态** = 状态机依赖 / 🟢 健康 / 🟡 需关注 / 🔴 断裂

|    | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | L11 | L12 | L13 | L14 | L15 | L16 | L17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **L1** | — | | | | | | | | Guard/🟢 | Guard/🟢 | | Guard+RBAC/🟡 | 密钥/🔴 | | | | |
| **L2** | | — | 商品详情/🟢 | | | | | | Qwen 同源/🟢 | schema/🟢 | | | | | | | |
| **L3** | | | — | 钱/🟢 | 订单确认触发/🔴 | bizType/🟢 | 回滚库存/🔴 | | 订单 ctx/🟢 | 超卖通知/🔴 | 金额/🟡 | | | 红包锁定/🟢 | 事件/🔴 | 快照/🔴 | 发货 link/⬜ |
| **L4** | | | 回调/🟢 | — | 触发/🟡 | 支付/🟢 | **退款 mock**/🔴 | | | | 金额/🟡 | | 证书/🟡 | release/🟢 | 事件/🔴 | | |
| **L5** | | | rollback/🟡 | rollback/🔴 | — | VIP 豁免/🟢 | voidRewards 双链路/🔴 | | | | | 配置 CRUD/🟢 | | | 事件/🔴 | | |
| **L6** | | | vipCheckout/🟢 | 支付/🟢 | 豁免+referral/🟢 | — | 拦截/🟢 | | | | | VipPackage CRUD/🟡 M1 | | | vip_activated/✅ | | |
| **L7** | | | 库存回填/🔴 | **退款 mock**/🔴 | voidRewards/🔴 | 拦截/🟢 | — | 换货面单/🟡 | 售后 ctx/🟢 | 退货库存/🔴 | | 新旧双写/🟡 | | 按比例扣除/🟢 | 全链路事件/🔴 | 寄回地址/🟡 | |
| **L8** | | | | | | | 换货面单/🟡 | — | | 卖家设置页/🟡 | | | KUAIDI100→SF env/🟡 | | | **硬前置 PC-1/PC-2**/🔴 | 监控/🟡 |
| **L9** | Guard/🟢 | Qwen/🟢 | 订单 ctx/🟢 | | | | 售后 ctx/🟢 | | — | | | cs-admin/🟢 | | | 离线兜底/🔴 | | |
| **L10** | Guard/🟢 | schema/🟢 | 超卖通知/🔴 | | | | | 卖家设置/🟡 | | — | | 审核 Tab/🟡 | | | 审核通知/🔴 | | 溯源关联/⬜ |
| **L11** | | | invoice 入口/🔴 | 金额/🟡 | | | | | | | — | 管理端 CRUD/🟢 | | | 开票通知/❌ | | |
| **L12** | RBAC/🟡 H1 | | | | 配置 CRUD/🟢 | VipPackage/🟡 M1 | 新旧双写/🟡 | | cs-admin/🟢 | 审核/🟡 | 管理端/🟢 | — | | coupon CRUD/🟢 | | | trace CRUD/🟢 |
| **L13** | 密钥/🔴 | | | 证书/🟡 | | | | env 迁移/🟡 | | | | | — | | | | |
| **L14** | | | 锁定+确认/🟢 | 释放/🟢 | | | couponShare 扣除/🟢 | | | | | 管理 CRUD/🟢 | | — | 红包到账/🔴 | | |
| **L15** | | | 所有事件/🔴 | 事件/🔴 | 事件/🔴 | vip_activated/✅ | 全链路/🔴 | | 离线/🔴 | 审核/🔴 | | | | 到账/🔴 | — | | |
| **L16** | | | 快照/🔴 | | | | 寄回/🟡 | **硬前置**/🔴 | | | | | | | | — | |
| **L17** | | | OrderItem link/⬜ | | | | | 监控/🟡 | | 商品关联/⬜ | | trace CRUD/🟢 | | | | | — |

**非空单元格数量**：约 48 个
**关键断裂点**：L3↔L4↔L5↔L7 退款反向链路 / L15 几乎所有业务事件 / L16↔L8 顺丰前置 / L12 Dashboard 404

---

## 6. 🔴 Tier 1 上线阻塞项汇总

按批次分组，checkbox 格式。

### 第一批：钱链路（Tier 1 💰）

- [ ] **C01** — L4+L7：支付宝退款 API 未真实接入
  - 证据：`backend/src/modules/payment/payment.service.ts:56-89` initiateRefund 是 TODO 占位
  - 修复：PaymentService 注入 AlipayService（PaymentModule 同模块无循环依赖），按 `payment.channel` 分发到 `alipayService.refund()`，`providerRefundId` 回写真实支付宝流水号
  - 影响：阻塞整条退款链路，违反消法"原路退回"义务
  - 预估工时：0.5-1 天
  - 归属：第一批

- [ ] **C02** — L7：Order 状态不闭环（全退后仍停 RECEIVED）
  - 证据：after-sale 模块 grep `order.update` 零匹配；唯一写 REFUNDED 的是遗留 `admin-refunds.service.ts:329`
  - 修复：在 `triggerRefund` 成功回调 / `voidRewardsForOrder` 中加"检查所有非奖品项是否都 REFUNDED → Order.status = REFUNDED"。必须与 voidRewards 同事务
  - 预估工时：0.5 天
  - 归属：第一批

- [ ] **C03** — L5：`VIP_PLATFORM_SPLIT` 枚举缺失导致 VIP 分润崩溃
  - 证据：`backend/src/modules/bonus/engine/bonus-allocation.service.ts:616` 使用 `ruleType:'VIP_PLATFORM_SPLIT'` vs `backend/prisma/schema.prisma:336-342` 枚举只有 5 个值
  - 修复：`AllocationRuleType` 枚举补齐 `VIP_PLATFORM_SPLIT`（可能还缺 `NORMAL_TREE_PLATFORM`，一并核查）+ prisma migrate + seed 校验
  - 预估工时：0.25 天
  - 归属：第一批

- [ ] **C04** — L7：售后退款补偿 Cron 前缀错配
  - 证据：`backend/src/modules/payment/payment.service.ts:91-161` 只扫 `startsWith:'AUTO-'`，售后用 `AS-`/`AS-TIMEOUT-` 前缀（`seller-after-sale.service.ts:1100` / `after-sale-timeout.service.ts:525` / `admin-after-sale.service.ts:434`）
  - 修复：补偿 Cron 改为 `startsWith:'AS-'` OR `'AUTO-'`，或建立统一前缀白名单
  - 预估工时：0.1 天
  - 归属：第一批

- [ ] **C05** — L7+L16+L8：App 退货物流字段名与后端 DTO 不匹配
  - 证据：App `src/repos/AfterSaleRepo.ts:35-38` `{carrierName, waybillNo}` vs 后端 `backend/src/modules/after-sale/dto/return-shipping.dto.ts:8,14` `{returnCarrierName, returnWaybillNo}`
  - 修复：统一字段名（建议改 App 侧 DTO 字段 + 页面 `app/orders/after-sale-detail/[id].tsx:162`）
  - 预估工时：0.25 天
  - 归属:第一批

- [ ] **C06** — L7：退款/归平台 setImmediate 吞异常 + 无持久化队列
  - 证据：`seller-after-sale.service.ts:1126-1160`、`admin-after-sale.service.ts:462-496`、`after-sale-timeout.service.ts:561-589`、`after-sale.service.ts:448-456`
  - 修复：至少加一个 Cron 扫 REFUNDING > 10min 的 AfterSaleRequest 重试一次
  - 预估工时：0.5 天
  - 归属：第一批

- [ ] **C07** — L5：rollbackForOrder TOCTOU 并发漂移
  - 证据：`backend/src/modules/bonus/engine/bonus-allocation.service.ts:265-268` findMany 在 $transaction 外读取 allocations snapshot
  - 修复：将 findMany 挪到 `$transaction` 内部，或事务内重新读取 ledger 状态再聚合
  - 预估工时：0.5 天
  - 归属：第一批

- [ ] **C08** — L5：rollback 事务缺少 timeout + 未回退 VIP exitedAt
  - 证据：`bonus-allocation.service.ts:419` 缺 `timeout`；`vip-upstream.ts checkExit` 写 exitedAt 无反向
  - 修复：rollback 事务显式 `timeout:30000, maxWait:5000`；rollback 中对称检查 `VipProgress.exitedAt` 并回退
  - 预估工时：0.5 天
  - 归属：第一批

- [ ] **C09** — L5：WITHDRAWN ledger 退款仅 warn 无追缴任务
  - 证据：`bonus-allocation.ts:303-307` 仅 `this.logger.warn`
  - 修复：补写持久化追缴任务表 + AdminAuditLog + alert
  - 预估工时：0.5 天
  - 归属：第一批

- [ ] **C10** — L3+L10+L15：R12 超卖卖家补货通知缺失
  - 证据：`backend/src/modules/order/checkout.service.ts:1261-1264` 仅 `logger.warn` + `// TODO: 发送卖家补货通知`
  - 修复：接通 InboxService.send + 可选 SMS，告诉卖家"你超卖了 N 件 SKU=X"
  - 预估工时：0.25 天
  - 归属：第一批（与 C12 InboxService 一起）

- [ ] **C11** — L4：alipayService 构造注入 + 证书加载失败在 production 环境 throw
  - 证据：`alipay.service.ts:66-68` catch 只 log 不 throw
  - 修复：production 环境下证书加载失败直接抛出让容器 crash
  - 预估工时：0.1 天
  - 归属：第一批

- [ ] **C12** — L15：InboxService 钱相关 9 个事件接入
  - 证据：全项目 grep `inboxService.send` 仅 1 处（`checkout.service.ts:1516`）
  - 修复：#5/6/7/8/10/11/13/18/27 全部补接（分润到账/解冻/过期/提现通过/拒绝/VIP 邀请/退款到账/红包到账）
  - 同时：前后端 InboxType 枚举同步（扩展 `src/types/domain/Inbox.ts` + iconMap）
  - 预估工时：2-3 天
  - 归属：第一批

- [ ] **C13** — L15：InboxService 改硬依赖
  - 证据：`order/order.module.ts:79-81` 软注入逻辑 + `checkout.service.ts:54` `inboxService:any=null`
  - 修复：constructor DI 或启动时断言存在
  - 预估工时：0.25 天
  - 归属：第一批

- [ ] **C14** — L14：审查任务与 refund.md 语义冲突澄清（不改代码）
  - 证据：审查任务"退款按比例归还红包" vs `docs/features/refund.md:156-159` "红包不退回"
  - 修复：**不要改代码**，向用户澄清究竟按哪个语义走（见 §9 Q1）。当前代码符合 refund.md
  - 预估工时：用户决策 0 天
  - 归属：第一批（决策入口）

### 第二批：非钱链路 T1 修复

- [ ] **C15** — L12：`/admin/replacements` 整条链路 404（Dashboard 首屏失败）
  - 证据：`admin/src/pages/dashboard/index.tsx:24,71` + `admin/src/pages/replacements/` + `admin/src/api/replacements.ts` 引用不存在的后端
  - 修复：删 Dashboard replacement 条目 / 删菜单 / 删 App.tsx 路由 / 删页面目录 / 删 PERMISSIONS.REPLACEMENTS_* / 更新 audit getTargetUrl / 考虑数据迁移
  - 预估工时：0.5 天
  - 归属：第二批

- [ ] **C16** — L12：前端 `PERMISSIONS` 缺 `dashboard:read`
  - 证据：`admin/src/constants/permissions.ts` vs `admin-stats.controller.ts:15,21,27`
  - 修复：补 `DASHBOARD_READ='dashboard:read'` + 菜单 permission 字段
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C17** — L1：卖家端补账号密码登录（用户 2026-04-11 决策）
  - 证据：`seller-auth.dto.ts:10` 只有 `{phone, code}`
  - 修复：SellerPasswordLoginDto + loginByPassword 方法 + `POST /seller/auth/login-by-password` + 前端 Tab；核对 CompanyStaff.passwordHash 字段（seed.ts:2468 位置可疑）
  - 预估工时：1 天
  - 归属：第二批

- [ ] **C18** — L1：管理端补图形验证码 + 手机号短信验证码登录（用户 2026-04-11 决策）
  - 证据：`admin-login.dto.ts:3-12` 只有 `{username, password}`
  - 修复：(a) 接入 `captcha.service.ts` + DTO 加 captchaId/captchaCode；(b) `loginByPhoneCode` 方法复用 SmsOtp + AdminUser 加 phone 字段；前端 captcha 组件 + SMS Tab
  - 预估工时：1 天
  - 归属：第二批

- [ ] **C19** — L10：OPERATOR 可创建/删除商品（权限漏洞）
  - 证据：`seller-products.controller.ts:26-104` 零 @SellerRoles 装饰器；`seller-role.guard.ts:32-34` 默认放行
  - 修复：所有写操作端点加 `@SellerRoles('OWNER', 'MANAGER')`；`findAll` / `findById` 读操作放行 OPERATOR
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C20** — L10：审核通过后不自动上架
  - 证据：`admin-products.service.ts:223-231 audit()` 只改 auditStatus
  - 修复：方案 A 审核通过时同时 `status: 'ACTIVE'`；方案 B 保留当前行为但向卖家发通知
  - 预估工时：0.25 天
  - 归属：第二批

- [ ] **C21** — L10：管理端商品缺少 SKU 编辑入口（奖品商品手动定价强依赖）
  - 证据：`admin-products.service.ts:123 update()` 不含 SKU 操作
  - 修复：补 `PUT /admin/products/:id/skus` 路由 + 服务 + 管理前端表单
  - 预估工时：0.5 天
  - 归属：第二批

- [ ] **C22** — L9：客服 5 个硬编码超时常量改回生产值
  - 证据：`cs.service.ts:26` + `cs-cleanup.service.ts:23-34`
  - 修复：SESSION_IDLE=2h / AI_IDLE=2h / QUEUING=30m / AGENT_IDLE=60m / Cron EVERY_10_MINUTES
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C23** — L2：`parseChatResponse` 补数组包裹解包
  - 证据：`ai.service.ts:3668` bb29234 commit 已证实 Qwen 会偶发返回 `[{...}]`
  - 修复：`const parsed = Array.isArray(raw) ? raw[0] : raw;` 10 行代码
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C24** — L16：addressSnapshot 字段名错位修复（同时是 L8 硬前置）
  - 证据：`seller-shipping.service.ts:52-78 parseAddressSnapshot` 读 `addr.name/province/city/district` vs `checkout.service.ts:363` 写 `{recipientName, regionText, detail}`
  - 修复：`parseAddressSnapshot` 改为读 `recipientName` + `regionText+detail`，返回结构化 `{name, phone, province, city, district, detail}`；补真实单测
  - 预估工时：0.25 天
  - 归属：第二批（L8 前置）

- [ ] **C25** — L16+L8：Company.address 结构化 Schema 改造
  - 证据：`schema.prisma:905` Company.address Json? 只 `{lng, lat, text}`
  - 修复：扩展为 `{province, city, district, detail, lng?, lat?, text?}`；卖家后台"企业信息"页拆分省市区（Cascader）；管理后台商户审核页同步；数据迁移脚本对现有 Company best-effort 结构化
  - 预估工时：0.5 天
  - 归属：第二批（L8 前置）

- [ ] **C26** — L1：`.env.example` 补齐 5 个关键密钥
  - 证据：`.env.example` grep `ADMIN_JWT_SECRET/SELLER_JWT_SECRET/PAYMENT_WEBHOOK_SECRET/LOGISTICS_WEBHOOK_SECRET/WEBHOOK_IP_WHITELIST` 全部零匹配
  - 修复：补齐 5 项占位 + 部署文档标红必填
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C27** — L4+X3：`handleAlipayNotify` 补 `WebhookIpGuard`
  - 证据：`payment.controller.ts:52-98` 只有 `@Public()`
  - 修复：加 `@UseGuards(WebhookIpGuard)` + 配置支付宝公网 IP 段到 `WEBHOOK_IP_WHITELIST`
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C28** — L15：前后端 InboxType 枚举同步
  - 证据：前端 `src/types/domain/Inbox.ts:12` 封闭 8 种社交类型 vs 后端唯一使用 `vip_activated` 不在枚举中
  - 修复：扩展前端联合类型 + `app/inbox/index.tsx:17-26 iconMap` 添加图标映射
  - 预估工时：0.25 天
  - 归属：第二批（与 C12 同组）

- [ ] **C29** — L6：删除 legacy `purchaseVip()` 方法
  - 证据：`bonus.service.ts:132-215` Controller 已 deprecated 但 Service 方法仍存在
  - 修复：删除或改为直接 throw
  - 预估工时：0.1 天
  - 归属：第二批

- [ ] **C30** — L12：新旧 Refund 链路下线策略
  - 证据：`seller.module.ts:11` + `admin.module.ts:19` 仍注册 SellerRefundsModule/AdminRefundsModule；`admin-refunds.service.ts:329` 仍写 Order.status
  - 修复：对 `/refunds` 设置只读模式；或整体合并到 `/after-sale`；清理权限常量
  - 预估工时：0.5 天
  - 归属：第二批

### 第三批：顺丰直连迁移（L8 22 步）

- [ ] **C31** — 阶段 0：前置修复（S0.1 addressSnapshot + S0.2 Company.address 结构化）【见 C24/C25】
- [ ] **C32** — 阶段 1：用户线下申请（S1.1 月结账号 + S1.2 丰桥企业认证 + API 审批 + 云打印面单权限）
- [ ] **C33** — 阶段 2：SfExpressService 开发（S2.1-S2.7 骨架/签名/createOrder/printWaybill/cancelOrder/queryRoute/parsePushCallback + S2.8 ≥12 条单测）
- [ ] **C34** — 阶段 3：改造上游（S3.1 SellerShippingService + S3.2 ShipmentService/Controller + S3.3 Module + S3.4 env/doc + S3.5 测试对齐）
- [ ] **C35** — 阶段 4：沙箱联调（S4.1-S4.6 部署/发单/查询/推送/取消/云打印审核）
- [ ] **C36** — 阶段 5：生产切换 + 清理（S5.1 凭证 + S5.2 smoke test + S5.3 删快递100文件 + S5.4 文档更新）

预估工时：≈ 8.15 天 AI + 2 天用户 + 墙钟 10-16 天

### 第四批：部署上线准备（L13 11 步）

- [ ] **C37** — 步骤 1：云服务器采购（用户）
- [ ] **C38** — 步骤 2：环境安装（Node/PG/Redis/Nginx/Certbot/PM2）
- [ ] **C39** — 步骤 3：域名 DNS 配置（依赖 ICP 备案通过）
- [ ] **C40** — 步骤 4：SSL 证书签发
- [ ] **C41** — 步骤 5：部署后端 NestJS（生产 .env + 支付宝证书 + migrate + seed + PM2）
- [ ] **C42** — 步骤 6：部署管理后台
- [ ] **C43** — 步骤 7：部署卖家后台（种子商户入驻）
- [ ] **C44** — 步骤 8：部署官网 + App 落地页（Universal Link `.well-known`）
- [ ] **C45** — 步骤 9：App 客户端发布（EAS build + TestFlight + App Store + 国内商店）
- [ ] **C46** — 步骤 10：基础监控（PM2/health cron/慢查询/告警）
- [ ] **C47** — 步骤 11：数据备份（pg_dump + RDB + OSS + 恢复演练）

预估工时：AI ≈ 12h + 用户线下流程（ICP 20 工作日关键路径）

### 第五批：阶梯上线 + 回归测试

- [ ] **C48** — Smoke test 后端基础（health + PM2 + logs）
- [ ] **C49** — Smoke test 管理端（登录 + 改密 + Company 创建 + 发现页 + RewardLedger）
- [ ] **C50** — Smoke test 卖家端（种子商户登录 + 商品发布 + 审核）
- [ ] **C51** — Smoke test 官网（首页 + 入驻表单 + 推荐码落地页）
- [ ] **C52** — Smoke test App TestFlight（登录 + 加购 + 支付 + 抽奖 + VIP + 客服 + 退款）
- [ ] **C53** — Smoke test 监控告警 + 备份恢复
- [ ] **C54** — 阶梯灰度：500 种子用户接入 + 48h 无 P0 事件监控

---

## 7. 🟡 Tier 2 待补项汇总（v1.0 可带可不带）

### L7 refund.md 23 条未完整实现

- [ ] **T01** — L7 H2 规则 14 库存回填（after-sale 目录 grep stock.increment 零匹配，奖品需跳过）
- [ ] **T02** — L7 H3 App 侧售后类型展示无动态过滤（`app/orders/after-sale/[id].tsx:83-102`）
- [ ] **T03** — L7 H4 规则 12 质量问题时限后台可视化（`admin/src/pages/config/` 无对应 UI）
- [ ] **T04** — L7 H5 规则 11 NORMAL_RETURN_DAYS ≤7 guard
- [ ] **T05** — L7 H6 规则 9 质量退货运费"平台承担"实际记账
- [ ] **T06** — L7 H8 奖励归平台补偿任务（防止 setImmediate 丢失 → 套利）

### L11 发票前端订单入口

- [ ] **T07** — L11 H1 订单详情页增加"申请发票/查看发票"区块（`app/orders/[id].tsx`）
- [ ] **T08** — L11 H2 个人中心"我的发票"入口
- [ ] **T09** — L11 H3 买家订单详情 API 补 invoiceStatus

### L02 语义开关激活（v1.1）

- [ ] **T10** — 运行 `SemanticFillService.batchFill` 给现有商品填语义字段
- [ ] **T11** — 打开 `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=true`
- [ ] **T12** — 打开 `AI_SEMANTIC_SCORING_ENABLED=true`
- [ ] **T13** — P1-01/02/03 下线伪造 AI 分数或接真后端

### L15 非钱事件补接（v1.0 强烈建议）

- [ ] **T14** — #1/2/3/4 订单支付/发货/签收/自动确认
- [ ] **T15** — #14-20 售后全链路通知
- [ ] **T16** — #26 离线客服消息兜底
- [ ] **T17** — L15 S1 `send()` 幂等键（cron 补偿场景必须）
- [ ] **T18** — L15 S3 InboxMessage 清理 cron（180 天 TTL）

### L17 溯源 T2 补齐

- [ ] **T19** — H1 ProductTraceLink CRUD API
- [ ] **T20** — H2 TraceEvent CRUD API
- [ ] **T21** — H3 前端 TraceBatch 类型对齐
- [ ] **T22** — H4 买家 App 溯源页切换到真实 TraceRepo
- [ ] **T23** — M1 getOrderTrace 合并 batches
- [ ] **T24** — M2 OrderItemTraceLink 发货时写入

### L10 溯源/描述/上传保护

- [ ] **T25** — L10 M1 溯源批次选择器（与 L17 联动）
- [ ] **T26** — L10 M2 REJECTED 编辑死锁（一行代码修复 `needReAudit = APPROVED || REJECTED`）
- [ ] **T27** — L10 M3 图片上传中保护
- [ ] **T28** — L10 H2（降级）商品描述 + 企业简介 @MinLength(20)

### L5/L6 业务监控与死代码清理

- [ ] **T29** — L5 ASYM-01 rollback 回退 VipProgress.unlockedLevel
- [ ] **T30** — L5 HIGH-03 rollback ruleType 增加 `REFUND_ROLLBACK`
- [ ] **T31** — L5 HIGH-04 unlockFrozenRewards 参数重命名
- [ ] **T32** — L6 M3 BFS 子树全满降级语义确认
- [ ] **T33** — L6 M4 `giftSkuId` 字段 schema 清理

### L12 管理后台一致性

- [ ] **T34** — L12 M1 VipPackage 权限码统一（`config:*` ↔ `vip_gift:*`）
- [ ] **T35** — L12 M2 删除 PRODUCTS_CREATE/DELETE 死权限常量
- [ ] **T36** — L12 M3 审计日志 getTargetUrl 映射更新
- [ ] **T37** — L12 H3 入驻申请顶层菜单入口 + Badge

### L14 平台红包

- [ ] **T38** — L14 H1 validateAndReserveCoupons 重复 ID 幂等防御
- [ ] **T39** — L14 H2 claimCoupon P2002 映射为 ConflictException（文案优化）
- [ ] **T40** — L14 M3 coupon 分摊到多商户总和 invariant 校验

### L16 地址管理

- [ ] **T41** — L16 P1 Address CRUD 设默认地址事务化
- [ ] **T42** — L16 P2 App 端行政区划 Picker（regionCode 永远空问题）

### L9 客服

- [ ] **T43** — L9 H1/H2/H3/H4/H5 死代码与内存泄漏清理
- [ ] **T44** — L9 M2 买家 App 加 Socket.IO 客户端
- [ ] **T45** — L9 M5 工单 category 从 intent 映射（避免全 OTHER）

### 横切关注点

- [ ] **T46** — X1 统一 `'Serializable'` 字符串字面量为 `Prisma.TransactionIsolationLevel.Serializable` 常量（5 处）
- [ ] **T47** — X2 核查 `Payment.providerTxnId` + Shipment 事件去重策略
- [ ] **T48** — X6 封装 `common/money.util.ts` 消除 Number/toFixed 混用（v1.1）

---

## 8. 用户线下完成事项

| 事项 | 负责 | 周期 | 交付物 | 成本 |
|---|---|---|---|---|
| **云服务器采购** | 用户 | 1 天 | 阿里云 ECS 华东杭州 4核8G 100GB | 350-500 元/月 |
| **域名购买** | 用户 | 1 天 | `爱买买.com` + 拼音备用域名 `aimaimai.com` | 100-200 元/年 |
| **ICP 备案** ⚠️ 最长关键路径 | 用户 | **20 工作日** | 备案号 | 免费 |
| **SSL 证书** | AI 执行 | 1 小时 | Let's Encrypt 证书 | 免费 |
| **阿里云 OSS Bucket** | 用户 | 已完成，核对 | 私有 Bucket + 签名 URL + 防盗链白名单 | 按量计费 |
| **阿里云 SMS 签名 + 模板** | 用户 | 1-3 天 | "爱买买"签名 + 3 个模板（注册/订单/商户审核） | 按量计费 |
| **阿里云 RAM 子账号 + AccessKey** | 用户 | 1 天 | OSS/SMS 最小权限 AK/SK | 免费 |
| **支付宝商户号 + 应用** | 用户 | 3-5 天 | APPID + RSA2 证书四件套（app-private/appCert/alipayCert/alipayRoot） | 对公银行账户 |
| **支付宝能力开通** | 用户 | 1-2 天 | 手机网站支付 + 当面付 + 回调地址配置 | — |
| **顺丰月结账号** | 用户 | 3-7 天 | 12 位月结号 + 销售/技术对接人 | 5k-20k 元保证金（可退） |
| **丰桥企业认证** | 用户 | 1-3 天 | 企业认证通过 | 免费 |
| **丰桥应用创建 + API 审批** | 用户 | 1-3 天 | clientCode/checkWord/沙箱 URL（5 个 API 审批通过） | 免费 |
| **顺丰云打印面单审核** | 用户 + 顺丰 | 1-3 天 | 审核通过 → 可切生产 | 免费 |
| **顺丰生产环境开通** | 用户 | 1-2 天 | 生产 URL | 免费 |
| **Apple Developer Program** | 用户 | 1-3 天 | 开发者账号 + 证书 | $99/年 |
| **Google Play**（国际版可选） | 用户 | 1-3 天 | 账号 | $25 一次性 |
| **华为开发者联盟** | 用户 | 2-5 天 | 账号（企业认证） | ~600 元/年 |
| **小米/OPPO/vivo/应用宝** | 用户 | 2-5 天/家 | 账号 | 免费（需企业资质） |
| **App 备案**（2023 新规） | 用户 | 3-7 天 | 工信部 App 备案号 | 免费 |
| **运营公司营业执照 + 对公账户** | 用户 | 已具备 | 用于备案/应用商店/支付宝/顺丰 | — |

**墙钟时间关键路径**：ICP 备案 20 工作日 > 顺丰申请 8-21 天 > 支付宝证书 3-5 天 > App 审核 1-3 天。建议并行启动所有线下流程，代码修复同步进行。

---

## 9. 待用户逐项确认的疑点清单

### 🔴 必须立即回答（影响审查正确性）

| # | 疑点 | 选项 A | 选项 B | 选项 C | 来源 draft |
|---|---|---|---|---|---|
| Q1 | L14 C1：红包退款是否按比例归还？`refund.md:156` 写不退回，审查任务写按比例归还 | 保持不退回（现状与 refund.md 一致，不改代码） | 按比例归还（需新增部分归还 API + 拆分实例 + 续期处理） | 全额归还 | L14 |
| Q2 | L10 H3：审核通过后是否自动上架？ | `audit()` 同步 `status:ACTIVE` 自动上架 | 保留当前行为（卖家手动上架） + 补通知 | — | L10 |
| Q3 | L5 MEDIUM-04：`OrderItem.unitPrice` 是否已扣减订单级优惠？分润利润计算的基础是否正确？ | 已扣减（安全） | 未扣减（profit 虚高需修复） | 未知，需跨模块验证 | L5 |

### 🟡 影响实施计划（希望本周回答）

| # | 疑点 | 选项 A | 选项 B | 选项 C | 来源 draft |
|---|---|---|---|---|---|
| Q4 | L2 P1-01/02/03：商品 AI 品质评分 / 企业 AI 信赖分 / 搜索 AI 摘要如何处理？ | 下线 UI 等真后端（最保守） | 保留 UI 改标签去掉"AI"字样 | 后端补真实 API | L2 |
| Q5 | L3 疑点 1：`confirmCouponUsage` / `activateVipAfterPayment` 失败是否需要补偿队列？ | 不加（3 次重试够了） | 引入失败任务表 + Cron 补偿 | 只接入告警，保留手动修复 | L3 |
| Q6 | L3 疑点 2：多商户运费分摊 ±0.01 元尾差如何处理？ | 接受（可忽略） | 改用 `allocateDiscountByCapacities` 整数分法 | 尾差强制计入 idx=0（主商户） | L3 |
| Q7 | L6 M3：VIP 推荐人子树全满时是否降级到系统节点？ | 接受降级（现状） | 抛"系统容量已满"让用户稍后再试 | 自动创建 A11+ 新根节点 | L6 |
| Q8 | L11：发票功能是否整体下线作为 v1.1？ | 保留但补订单入口 + 个人中心入口 + invoiceStatus（HIGH 3 项） | 整体下线 UI 入口，后端保留 | — | L11 |
| Q9 | L9 BLOCK-2：生产超时值确认 | 2h/30m/60m（文档默认） | 其他值 | — | L9 |
| Q10 | L2：Qwen 宕机时降级策略 v1.0 是否需要熔断器？ | v1.0 不需要（当前 fallback 可接受） | v1.0 需要接入熔断 | v1.0 先加监控 | L2 |

### 🟢 可延后

| # | 疑点 | 选项 A | 选项 B | 选项 C | 来源 draft |
|---|---|---|---|---|---|
| Q11 | L1：AuthIdentity 是否补 EMAIL provider？ | v1.1 再补 | v1.0 就补 | 不补 | L1 |
| Q12 | L1 L5：种子 `seed.ts:2468` CompanyStaff.passwordHash 字段位置可疑，是否需要核查？ | 核查并修复 | 忽略 | — | L1 |
| Q13 | L4 M-03：支付宝 notify_url 中文域名 Punycode 处理 | 生产强制要求 ALIPAY_NOTIFY_URL 配置 | 代码层自动转换 | — | L4 |
| Q14 | L4：微信支付 v1.0 是否上线？ | 不上（保持 mock） | 上 | — | L4 |
| Q15 | L7：`Refund` 模型 `@deprecated` 注释是否过时？ | 取消 deprecated 标注 | 真正迁移到新链路 | — | L7 |
| Q16 | L3 疑点 3：`@map("redPackId")` 列名遗留是否计划迁移？ | 保留兼容老数据 | migration 改名 rewardId | — | L3 |
| Q17 | L3 疑点 4：SKU fallback 逻辑是否计划废弃？ | 保留兼容老客户端 | 强制要求前端传真 skuId | — | L3 |

---

## 10. 修复实施顺序建议（交接给 writing-plans）

**⚠️ 按批次顺序（用户决策），不按时间窗口。**

### 第一批：钱链路修复（约 14 项 CRITICAL，并行 + 串行混合）

**内容**：C01-C14（钱链路 + InboxService 钱事件）
- **串行依赖**：C01 必须先做（阻塞 C02/C04/C06/C09）
- **并行可做**：C03（枚举）/ C07-C09（rollback 修复）/ C10（超卖）/ C11（证书）/ C13（硬依赖）
- **决策入口**：C14 等待用户 Q1 回答

**完成判定**：
- 支付宝真实退款到账测试通过（内部小额）
- Order 状态机闭环（全退触发 REFUNDED）
- VIP 订单分润全链路不崩溃
- rollback 并发场景无 frozen 漂移
- 钱相关 9 项 inbox 事件接入完成
- 前后端 InboxType 枚举同步

**风险提示**：C01 需谨慎，`PaymentModule` 注入 `AlipayService` 需测试无循环依赖；C12 的 29 个调用点散布多模块，需避免破坏现有事务边界

### 第二批：非钱链路 T1 修复（约 16 项，大量并行）

**内容**：C15-C30（管理端断链 + 认证补齐 + 权限漏洞 + 描述修复 + 客服常量）

**并行策略**：
- **前端独立**（并行）：C15（L12 replacements 清理）+ C18 前端部分 + C24 App 字段名
- **后端独立**（并行）：C17（L1 seller 密码）+ C18 后端部分 + C19（L10 权限）+ C20/C21（审核/SKU 编辑）+ C22（客服常量）+ C23（parseChatResponse）+ C26（env.example）+ C27（WebhookIpGuard）+ C28（InboxType 同步）+ C29（legacy 清理）+ C30（旧 Refund 下线）
- **L8 前置**（串行，必须在第三批前完成）：C24 + C25

**完成判定**：
- 管理后台无首页 404
- 非超管可登录首页
- OPERATOR 无法创建商品
- 客服会话记忆可用
- 生产 env 密钥齐全
- L8 硬前置完成

**风险提示**：C25 Schema 改造需数据迁移脚本，建议对无法解析的地址打"未结构化"标记强制卖家补齐

### 第三批：顺丰直连迁移（L8 22 步）

**内容**：C31-C36（5 阶段串行）

**并行策略**：
- **AI 开发并行**（阶段 2/3 不依赖用户凭证）：SfExpressService 全部方法 + 单测 + 上游改造 + 测试对齐
- **用户线下并行**（阶段 1 墙钟 6-14 天）：月结账号 + 丰桥认证 + API 审批

**完成判定**：
- 沙箱 smoke test 全通过（发单/查询/推送/取消/云打印审核）
- 生产灰度 3-5 单真实订单 OK
- 稳定运行 7 天无 incident
- 快递100 文件删除 + `grep Kuaidi100` 零匹配

**风险提示**：R6 opCode 新编码未覆盖需 SF_STATE_MAP fallback；保留 `SHIPPING_PROVIDER` 灰度回滚开关；快递100账号保留至少 7 天备用

### 第四批：部署上线准备（L13 11 步）

**内容**：C37-C47

**并行策略**：
- **用户线下**（墙钟关键路径）：ICP 20 工作日（最早启动）+ 支付宝证书 3-5 天 + 应用商店账号
- **AI 执行**（可在环境/代码就位后立即做）：C38 环境安装 + C40 SSL + C41-C44 三端部署 + C46 监控 + C47 备份

**完成判定**：L13 §完成判定所有清单 + 生产 smoke test（后端 health / 三端登录 / 种子上货 / 官网表单 / TestFlight 核心流程 / 监控告警触发 / 备份恢复演练）

**风险提示**：ICP 备案不可并行缩短；App 上架需"App 备案号"必须已下发

### 第五批：阶梯上线 + 回归测试

**内容**：C48-C54

**并行策略**：按阶梯上线顺序（管理后台 → 卖家后台 → 种子商户 → App），每一级 smoke test 通过后才放下一级

**完成判定**：首批 500 种子用户接入 + 48 小时无 P0 事件 + 监控告警响应时间 < 5 分钟

### 第六批：Tier 2 补齐（可选）

**内容**：T01-T48（§7 所有待补项）

**并行策略**：完全按模块独立并行
- 第六批 A（售后 T2）：T01-T06
- 第六批 B（发票入口）：T07-T09
- 第六批 C（消息中心非钱事件）：T14-T18
- 第六批 D（AI 开关激活）：T10-T13
- 第六批 E（溯源 T2）：T19-T24
- 第六批 F（其他模块 T2）：T25-T48

**完成判定**：按模块独立验收

---

## 11. 附录

### 11.1 状态统计矩阵

| 维度 | 总数 | 🟢 健康 | 🟡 部分/降级 | 🔴 阻塞 | ⬜ 未完成 |
|---|---|---|---|---|---|
| 链路（17） | 17 | 3 | 7 | 6 | 1 |
| 横切关注点（6） | 6 | 2 (X1/X2) | 3 (X3/X5/X6) | 1 (X4) | 0 |
| **CRITICAL 问题** | — | — | — | **14 (C01-C14)** | — |
| **第一批阻塞** | — | — | — | 14 | — |
| **第二批阻塞** | — | — | — | 16 (C15-C30) | — |
| **第三批（L8）** | — | — | — | 6 (C31-C36) | — |
| **第四批（部署）** | — | — | — | 11 (C37-C47) | — |
| **第五批（上线）** | — | — | — | 7 (C48-C54) | — |
| **Tier 2 待补（T1-T48）** | 48 | — | 48 | — | — |

### 11.2 审查使用的 agent 任务数

**18 个独立审查任务**：
- 1 个横切扫描（X1-X6 `00-cross-cutting`）
- 17 个链路独立审查（L1-L17）

每个任务由独立 agent 执行，严格只读，结果写入 `docs/superpowers/reports/2026-04-11-drafts/` 下对应 draft 文件。本报告由主 agent 整合。

### 11.3 未覆盖范围声明

- **v1.1+ 功能不覆盖**：微信支付接入、OCR 图片审核、真实税务系统对接、Expo Push/推送 SDK、事件总线/CQRS 中枢、熔断器、多 key 池等
- **UI 视觉/UX 不覆盖**：本次审查不做视觉设计 / 交互流程 / 无障碍检查（用户需另行调用 `/ui-ux-pro-max`）
- **性能压测不覆盖**：仅 X6 静态扫描 N+1/索引/缓存，未做真实 benchmark 压测
- **安全渗透不覆盖**：仅 X3/X4 静态扫描 Webhook 签名和 JWT 隔离，未做真实渗透测试
- **第三方 SDK 内部行为不覆盖**：ali-oss / alipay-sdk / DashScope SDK / 阿里云 SMS SDK 假设可靠
- **Schema 脏数据不覆盖**：`findKthAncestor` CTE、NormalTree position、VipProgress 漂移等假设数据清洁，未做脏数据容错审查
- **数据库负载测试不覆盖**：Serializable 高并发下的 P2034 重试率、连接池饱和度未测

### 11.4 所有 draft 文件索引

| ID | 路径 |
|---|---|
| X1-X6 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md` |
| L1 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L01-auth.md` |
| L2 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md` |
| L3 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md` |
| L4 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md` |
| L5 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md` |
| L6 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md` |
| L7 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md` |
| L8 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md` |
| L9 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md` |
| L10 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md` |
| L11 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md` |
| L12 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md` |
| L13 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md` |
| L14 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md` |
| L15 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md` |
| L16 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L16-address.md` |
| L17 | `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts/L17-trace.md` |

### 11.5 关键决策追溯

**brainstorming 阶段 17 项决策**（摘要）：

1. **v1.0 支付渠道**：仅支付宝，微信保持 mock
2. **v1.0 物流渠道**：顺丰丰桥直连，保留快递100灰度回滚
3. **v1.0 AI 开关**：AI_SEMANTIC_SLOTS_ENABLED=true，其他 2 个延后
4. **v1.0 发票生成**：管理员人工录入 invoiceNo + pdfUrl，不接税务系统
5. **v1.0 OSS**：真实接入，UPLOAD_LOCAL=false
6. **v1.0 SMS**：真实接入，SMS_MOCK=false
7. **v1.0 微信登录**：WECHAT_MOCK=true（v1.0 保留）
8. **VIP 多档位**：三档位 399/899/1599 + referralBonusRate 下沉到档位层 + 赠品一对多 4 种封面模式
9. **分润利润公式统一六分**：VIP/Normal 各自配比，但结构一致
10. **超卖容忍 R12**：故意设计，允许 stock < 0，卖家收到补货通知
11. **订单状态无 PENDING_PAYMENT**：付款后才创建订单（CheckoutSession → Order）
12. **红包不退回**（refund.md §156）：退款时 CouponInstance 保持 USED
13. **奖品不可退**：wonCount 永不回退
14. **平台公司**：命名"爱买买app"，isPlatform=true，用户搜索排除奖励商品
15. **三系统认证独立**：买家/卖家/管理独立 JWT secret + Strategy + Guard
16. **卖家自动定价**：cost × markupRate（默认 1.3），奖品商品例外（admin 手动）
17. **推荐码深度链接**：Cookie+指纹双层匹配 + Universal Link

**三次 Checkpoint 用户答复**（2026-04-11）：

- **Checkpoint 1**（L3 R12 超卖）：确认为故意设计，line 1264 补货通知 TODO 单独列为 T1 待补项
- **Checkpoint 2**（L6 H1 bizType 拦截）：经复核撤销。`Prisma findUnique + include` 不带 `select` 时自动返回所有 scalar，`bizType` 是 scalar enum 字段会被返回，`as any` 只是类型整洁问题不是 bug
- **Checkpoint 3**（L10 H2 描述长度）：降级为非 T1。v1.0 保持现状，v1.1 按 AI 搜索召回质量决定
- **Checkpoint 补充**（L1 H1/H2 认证补齐）：卖家加账号密码登录（与手机验证码并存）+ 管理端加图形验证码 + 手机号短信验证码登录（与密码登录并存）。均为 v1.0 T1 必做

---

**报告结束。**
