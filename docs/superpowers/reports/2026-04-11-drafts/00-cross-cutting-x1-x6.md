# 00 - Cross-Cutting Scan: X1-X6

- **审查时间**: 2026-04-11
- **审查范围**: backend/src 全量（只读扫描）
- **审查维度**: X1 事务/CAS · X2 幂等键 · X3 Webhook 安全 · X4 三系统权限 · X5 Mock/环境变量 · X6 性能红线
- **Agent**: cross-cutting scanner (readonly)
- **输入**: Grep/Read 结果（未运行 prisma/tsc/npm）
- **说明**: 状态图例 ✅ 通过 / 🟡 可改进 / 🔴 需修复

---

## X1. 事务隔离 + CAS

### 扫描结果概要
- `$transaction` 调用分布在 **53 个文件**（含 spec 文件）
- 大多数金额/库存/奖励/状态转换事务已显式标注 `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`
- `P2034` 序列化冲突重试遍布 **20+ 个服务**，配合 `MAX_RETRIES` 常量
- CAS 模式 `updateMany where: { id, status: '...' }` 在 admin/refunds、admin/orders、admin/invoices、payment 等关键路径均已使用

### 关键事务一览（15 条代表性）

| 位置 file:line | 隔离级别 | CAS | 钱/库存/奖励操作 | 状态 | 备注 |
|---|---|---|---|---|---|
| `backend/src/modules/order/checkout.service.ts:627` | Serializable | N/A（新建 Session） | 是（锁红包/VIP折扣/总价计算） | ✅ | P2034 重试 + P2002 幂等键兜底 |
| `backend/src/modules/order/checkout.service.ts:923` | Serializable | 是 | 是（CheckoutSession→Order 原子建单） | ✅ | H8 修复，P2034 重试 |
| `backend/src/modules/payment/payment.service.ts:129` | Serializable | 是（Refund CAS） | 是（自动退款补偿） | ✅ | `updateMany where status='FAILED'` |
| `backend/src/modules/payment/payment.service.ts:291` | Serializable | 是 | 是（支付失败分支） | ✅ | H7+M17 修复，P2034 重试 |
| `backend/src/modules/payment/payment.service.ts:456` | Serializable | 是 | 是（handlePaymentSuccess） | ✅ | L3 修复，攻击回调竞态保护 |
| `backend/src/modules/bonus/engine/bonus-allocation.service.ts:201` | Serializable | 是 | 是（分润入账） | ✅ | P2034/P2002 双路径兜底，idempotencyKey 唯一 |
| `backend/src/modules/bonus/engine/bonus-allocation.service.ts:419` | Serializable | 是 | 是（退款回滚） | ✅ | P2034/P2002 均有处理 |
| `backend/src/modules/bonus/engine/vip-upstream.service.ts:349` | Serializable | 是 | 是（VIP 上游分润） | ✅ | P2034 重试 |
| `backend/src/modules/bonus/engine/freeze-expire.service.ts:215` | Serializable | 是（Ledger CAS） | 是（冻结释放） | ✅ | H4 修复 |
| `backend/src/modules/after-sale/after-sale.service.ts:289/334/388/459/509/556` | Serializable ×6 | 是 | 是（售后状态机 6 步） | ✅ | 每步 P2034 重试 |
| `backend/src/modules/after-sale/after-sale-timeout.service.ts:151/242/354/474` | Serializable ×4 | 是 | 是（自动同意/超时退款） | ✅ | 4 个 Cron 路径均 Serializable |
| `backend/src/modules/order/order.service.ts:858/1013/1210` | Serializable ×3 | 是 | 是（确认收货/退款/取消） | ✅ | P2034 重试 |
| `backend/src/modules/coupon/coupon-engine.service.ts:458` | Serializable | 是 | 是（红包发放） | ✅ | `coupon-engine.service.ts:326` P2034 重试 |
| `backend/src/modules/check-in/check-in.service.ts:69` | Serializable | N/A | 是（签到奖励） | ✅ | H10 修复，P2002 幂等 |
| `backend/src/modules/lottery/lottery.service.ts:259/434` | Serializable ×2 | 是 | 是（抽奖概率消耗） | ✅ | PublicDraw 事务 |
| `backend/src/modules/seller/virtual-call/virtual-call.service.ts:177/299` | Serializable | N/A | 否（号码绑定） | ✅ | 非资金但涉状态转换 |

### 结论

**基本合规**：项目对金额/库存/状态机转换的 Serializable 要求有清晰共识（`docs/issues/tofix-safe.md` 规则 #6 贯彻）。三处仅需关注：

- 🟡 `customer-service/cs.service.ts:72` 使用字符串字面量 `'Serializable'`，虽然 Prisma 可以接受但与项目其他位置使用 `Prisma.TransactionIsolationLevel.Serializable` 的风格不一致；`seller/company/seller-company.service.ts:83,119` 和 `admin/companies/admin-companies.service.ts:298,347` 同样使用字符串字面量。建议统一。
- 🟡 `cart/cart.service.ts:702` 事务为购物车合并，含价格重算但未看到 CAS；允许因为购物车项不是资金流，风险低。
- ✅ `checkout.service.ts:1417` / `checkout-expire.service.ts:256` / `order-auto-confirm.service.ts:101` / `auth/auth.service.ts:532` / `seller/auth/seller-auth.service.ts:465` 均正确使用枚举常量。

---

## X2. 幂等键

### 扫描结果

| 场景 | 键字段 / 格式 | DB 唯一约束 | 冲突处理 | 状态 |
|---|---|---|---|---|
| CheckoutSession 创建 | `idempotencyKey String?` `@@unique([userId, idempotencyKey])` (`schema.prisma:1342/1353`) | 唯一复合 | `checkout.service.ts:645` 捕获 P2002 → 返回已有 Session | ✅ |
| Order 创建 | `idempotencyKey String? @unique` (`schema.prisma:1373`) | 单字段 | 用于建单幂等 | ✅ |
| RewardAllocation 分润入账 | `idempotencyKey String @unique` (`schema.prisma:1843`) | 单字段，必填 | `bonus-allocation.service.ts:210,422` 捕获 P2002/`meta.target=idempotencyKey` → 视为幂等 | ✅ |
| CheckIn 签到 | `@@unique([userId, date])` (`schema.prisma:2022`) | 复合 | `check-in.service.ts:86` 捕获 P2002 | ✅ |
| Coupon 发放 | `@@unique([campaignId, userId, issuedAt])` (`schema.prisma:2285`) | 复合 | `coupon.service.ts:213` + `coupon-engine.service.ts:419` 显式构造 P2002 | ✅ |
| BuyerAlias 买家编号 | `@@unique([userId, companyId])` (`schema.prisma:2379`) | 复合 | `buyer-alias.service.ts:45` 捕获 P2002 → 取现有 | ✅ |
| Cart 合并 | `cartId + skuId` (`schema.prisma:1309` 为普通索引非唯一) | 非唯一 | `cart.service.ts:219,509` 捕获 P2002 重试 upsert | 🟡 奖品项允许与普通项同 SKU，已从 `@@unique` 改为 `@@index`；合并逻辑依赖 `prizeRecordId` 辨别 |
| NormalTree 节点插入 | `@@unique([parentId, position])` (`schema.prisma:2043`) | 复合 | 防并发插入同位置 | ✅ |
| AdminCategory 创建 | 名称唯一 | — | `admin-categories.service.ts:60,108` 捕获 P2002 | ✅ |
| **Payment Webhook 回调** | `providerTxnId` + `merchantOrderNo` | 见下 | `payment.service.ts` 通过 CAS 状态转换实现幂等 | 🟡 未见 `Payment.providerTxnId @unique`，需核查 schema 中 `Payment` 模型的唯一约束是否存在 |
| **Shipment Webhook 回调** | `trackingNo` + `events[]` | — | `shipment.service.ts` 用 CAS 状态迁移 | 🟡 事件去重依赖业务校验，未见事件哈希唯一键 |

### 结论

**资金/奖励/签到/红包路径的幂等设计完整**。P2002/P2034 的"双层保险"模式（先尝试，冲突则兜底）在 `bonus-allocation.service.ts`、`check-in.service.ts`、`coupon.service.ts`、`checkout.service.ts` 中结构一致，值得称赞。

需要核查项：
- 🟡 `Payment` 模型是否有 `providerTxnId @unique` — 本扫描未读取该模型的完整定义，建议验证。
- 🟡 `Shipment` 事件幂等：依赖状态 CAS 而非事件哈希，理论上快递100重复推送同事件会再次触发下游，需确认 `handleKuaidi100Callback` 的去重策略。

---

## X3. Webhook 安全

### 端点清单

| 端点 | 文件:行 | 签名验证 | IP 白名单 | Secret 配置 | 状态 |
|---|---|---|---|---|---|
| `POST /payments/callback` | `payment.controller.ts:31-45` | HMAC-SHA256 + `timingSafeEqual`（`payment.service.ts:169-216`） | `WebhookIpGuard` | `PAYMENT_WEBHOOK_SECRET` | ✅ |
| `POST /payments/alipay/notify` | `payment.controller.ts:52-98` | 支付宝证书验签（`alipay.service.ts:128 verifyNotify`） | **❌ 未加 `WebhookIpGuard`** | 证书路径 | 🟡 |
| `POST /shipments/callback` | `shipment.controller.ts:54-71` | HMAC-SHA256（`shipment.service.ts:48-90`） | `WebhookIpGuard` | `LOGISTICS_WEBHOOK_SECRET` | ✅ |
| `POST /shipments/kuaidi100/callback` | `shipment.controller.ts:79-118` | Token + 签名（`kuaidi100.service.ts`） | `WebhookIpGuard` | `KUAIDI100_CALLBACK_TOKEN` | ✅ |

### WebhookIpGuard 实现质量

`backend/src/common/guards/webhook-ip.guard.ts` 支持：
- 从 `req.ips[0]` 取真实 IP（依赖 `app.set('trust proxy', ...)`，避免 X-Forwarded-For 伪造）
- IPv4 + IPv6（含 `::ffff:` 归一化）
- CIDR 前缀匹配（IPv4 /0-32，IPv6 /0-128）
- **生产环境强制校验**：`NODE_ENV=production && WEBHOOK_IP_WHITELIST 未配置 → ForbiddenException`
- 开发环境未配置时放行并打 warning

### 签名验证质量

`payment.service.ts:verifySignature`：
- canonical 序列化（按 key 排序）
- `crypto.timingSafeEqual` 防时序攻击
- 生产环境 `PAYMENT_WEBHOOK_SECRET` 必配，否则拒绝
- 开发环境无 secret 时放行并打 warning

### 结论

| 项 | 评估 |
|---|---|
| 签名验证 | ✅ 已用 HMAC-SHA256 + `timingSafeEqual`，支付宝用官方证书验签 |
| IP 白名单 | 🟡 **`POST /payments/alipay/notify` 未加 `WebhookIpGuard`** — 单独依赖证书验签，而支付宝有官方 IP 段文档，建议补上 |
| Secret 管理 | ✅ 生产必配，默认值兜底到开发模式 warning |

**需要补救**：
1. 🟡 `payment.controller.ts:52` `handleAlipayNotify` 建议补 `@UseGuards(WebhookIpGuard)` 一致化。
2. ✅ 其余 3 个 webhook 已正确组合 `@Public() + @UseGuards(WebhookIpGuard) + 签名验证`。

---

## X4. 三系统权限隔离

### 环境变量（`backend/.env.example`）

| Secret 变量 | 是否在 .env.example 声明 | 代码引用 |
|---|---|---|
| `JWT_SECRET` | ✅ line 3 | `auth` 模块 |
| `ADMIN_JWT_SECRET` | ❌ **未在 .env.example 出现** | `admin/auth/admin-auth.module.ts:15` `getOrThrow`，`cs.gateway.ts:72` 使用 |
| `SELLER_JWT_SECRET` | ❌ **未在 .env.example 出现** | `seller/auth/seller-auth.module.ts:17` `getOrThrow`，`seller/after-sale/seller-after-sale.service.ts:39`、`seller/shipping/seller-shipping.service.ts:32` 作为 HMAC secret 使用 |

🔴 **关键缺口**：`.env.example` 只有 `JWT_SECRET`，**缺少 `ADMIN_JWT_SECRET` 和 `SELLER_JWT_SECRET`**。生产部署时若遗漏环境变量，`getOrThrow` 会在 bootstrap 阶段直接抛异常导致服务无法启动（定义为安全降级，但不符合 launch-readiness 要求）。

### JWT 隔离矩阵

| Token 类型\访问目标 | 买家 API (`/*`) | 卖家 API (`/seller/*`) | 管理 API (`/admin/*`) |
|---|---|---|---|
| 买家 JWT (`JWT_SECRET`) | ✅ 200 | ❌ 401（SellerAuthGuard 拒绝） | ❌ 401（AdminAuthGuard 拒绝） |
| 卖家 JWT (`SELLER_JWT_SECRET`) | ❌ 401（全局 JwtAuthGuard 拒绝，卖家 token 非买家 token） | ✅ 200 | ❌ 401 |
| 管理 JWT (`ADMIN_JWT_SECRET`) | ❌ 401 | ❌ 401 | ✅ 200 |

隔离机制（经代码验证）：
- **买家控制器**：全局 `JwtAuthGuard`（由 `APP_GUARD` 注册），自动拦截
- **卖家控制器**：类上 `@Public() + @UseGuards(SellerAuthGuard, SellerRoleGuard)`（`@Public()` 绕过全局买家 Guard，再显式用卖家 Guard）
- **管理控制器**：类上 `@Public() + @UseGuards(AdminAuthGuard, PermissionGuard)`

独立的 Strategy + Secret：
- `admin/common/strategies/admin-jwt.strategy.ts:24` `secretOrKey: getOrThrow('ADMIN_JWT_SECRET')`
- `seller/auth/seller-jwt.strategy.ts:26` `secretOrKey: getOrThrow('SELLER_JWT_SECRET')`

### Guard 栈一致性审查

扫描全部 admin 控制器（20 个文件使用 `@UseGuards(AdminAuthGuard, PermissionGuard)`）和 seller 控制器（8 个文件使用 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`）。

**全部通过**。所有 admin/seller 控制器均在类级别先 `@Public()` 然后加对应 Guard 栈。

### 可疑点（最多 5 个）

| # | 位置 | 问题 | 严重度 |
|---|---|---|---|
| 1 | `.env.example` | 缺 `ADMIN_JWT_SECRET` 和 `SELLER_JWT_SECRET` 两项 | 🔴 HIGH（阻塞部署） |
| 2 | `.env.example:5` 与 `:14` | `SMS_MOCK=true` 重复声明（一次 line 5、一次 line 14） | 🟡 LOW（清理） |
| 3 | `payment.controller.ts:52` | Alipay 异步通知未加 `WebhookIpGuard` | 🟡 MEDIUM |
| 4 | `seller/shipping/seller-shipping.controller.ts:33` | 类上 `@Public()` 但 `printWaybill` (line 68) 方法没有 `@UseGuards`，依赖 query 签名鉴权 — **符合预期**，但请确认 `verifyPrintSignature` 使用 `timingSafeEqual` 且 `expires` TTL 足够短 | 🟡 MEDIUM（已在 `seller-shipping.service.ts:313-323` 用 HMAC+timingSafeEqual） |
| 5 | `cs.gateway.ts:72` | Socket.IO Gateway 同时解析 ADMIN_JWT_SECRET（管理端客服连接）与买家 token — 已确认使用不同 secret，隔离正确 | ✅ |

---

## X5. Mock 开关 + 环境变量

### 代码扫描出的所有 _MOCK / _LOCAL / _ENABLED 开关

| 变量 | 默认 | 代码引用 file:line | 生产期望 (v1.0) | 切换状态 |
|---|---|---|---|---|
| `SMS_MOCK` | `true` | `auth/auth.service.ts:44`、`seller/auth/seller-auth.service.ts:46` | **false** | 🔴 待切 |
| `WECHAT_MOCK` | `true` | `auth/auth.service.ts:195` | **true**（v1.0 保持 mock，v1.1 切） | ✅ 保持 |
| `UPLOAD_LOCAL` | `true` | `upload/upload.service.ts:125,191,214`、`main.ts:38` | **false** | 🔴 待切 |
| `UPLOAD_LOCAL_PRIVATE` | `false` | `upload/upload.service.ts:362`、`main.ts:38` | false（公共读） | ✅ |
| `IMAGE_SCAN_ENABLED` | `false` | `upload/image-content-scanner.service.ts:63` | false（v1.0 占位）或 true（如接入绿网） | 🟡 v1.0 可保持 false |
| `AI_SEMANTIC_SLOTS_ENABLED` | `false` | `ai/ai.service.ts:584` | **true** | 🔴 待切 |
| `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` | `false` | `product/semantic-fill.service.ts:46,180` | **true** | 🔴 待切 |
| `AI_SEMANTIC_SCORING_ENABLED` | `false` | `product/product.service.ts:179,740` | **true** | 🔴 待切 |
| `LOTTERY_ENABLED` | config 表 | `admin/lottery/admin-lottery.service.ts:509-514` | true | ✅ DB-driven |

### 生产必配的 Secrets（非 mock 开关但属同一检查组）

| 变量 | .env.example 是否有占位 | 生产期望 | 状态 |
|---|---|---|---|
| `PAYMENT_WEBHOOK_SECRET` | ❌ 未在 .env.example | 必须配 | 🔴 |
| `LOGISTICS_WEBHOOK_SECRET` | ❌ 未在 .env.example | 必须配 | 🔴 |
| `WEBHOOK_IP_WHITELIST` | ❌ 未在 .env.example | 必须配（否则 prod 拒绝回调） | 🔴 |
| `ADMIN_JWT_SECRET` | ❌ 未在 .env.example | 必须配（`getOrThrow`） | 🔴 |
| `SELLER_JWT_SECRET` | ❌ 未在 .env.example | 必须配（`getOrThrow`） | 🔴 |
| `KUAIDI100_*` | ✅ line 34-40 | 必须配 | 🟡 |
| `DASHSCOPE_API_KEY` | ✅ line 43 | 必须配 | 🟡 |
| `ALIPAY_*` | ✅ 注释模板 line 45-59 | 必须配（正式环境放开注释） | 🟡 |
| `EMAIL_SMTP_*` | ✅ line 22-24 | 必须配 | 🟡 |

### 结论

🔴 **critical**：`.env.example` 需要补充至少 5 个关键环境变量：`ADMIN_JWT_SECRET`、`SELLER_JWT_SECRET`、`PAYMENT_WEBHOOK_SECRET`、`LOGISTICS_WEBHOOK_SECRET`、`WEBHOOK_IP_WHITELIST`。

🔴 **待切换**：4 个生产必关 mock（SMS / UPLOAD_LOCAL / 3 个 AI 语义开关）。

🟡 **清理**：`SMS_MOCK=true` 在 `.env.example` 出现两次（line 5 + line 14），dotenv 后值覆盖前值但风格上应合并。

---

## X6. 性能红线

### N+1 反模式（最严重 10 条）

| # | file:line | 模式 | 影响 | 严重度 |
|---|---|---|---|---|
| 1 | `order/checkout.service.ts:327-338` | `for (const tpi of thresholdItems) { ... await lotteryRecord.findUnique(...) }` | 结账热路径，每个赠品一次额外查询 | 🟡 MEDIUM（单次结账赠品通常 ≤3） |
| 2 | `order/order.service.ts:565-580` | 同上（预览模式） | 预览接口频繁调用 | 🟡 MEDIUM |
| 3 | `order/checkout-expire.service.ts:102-200` | `for (const session of sessions)` 内部每次 `couponInstance.findMany` + `confirmCouponUsage` | Cron 任务，单次最多 200 条 | 🟡 MEDIUM（已 `take: 200` 限批） |
| 4 | `customer-service/cs-cleanup.service.ts:60-62` | `for (const session of allStale) { await csSession.update(...) }` | Cron 清理过期会话 | 🟢 LOW（业务量低） |
| 5 | `payment/payment.service.ts:110-161` | `for (const refund of candidates)` 内部含 `$transaction` + `initiateRefund` | Cron 任务，串行事务 | 🟢 LOW（设计上需串行） |
| 6 | `bonus/vip-activation-retry.service.ts:60-62` | `for (const purchase of failedPurchases) { await vipPurchase.updateMany(...) }` | Cron VIP 激活重试 | 🟢 LOW |
| 7 | `order/bonus-compensation.service.ts` | 循环处理失败订单分润 | Cron 每 30 分钟 | 🟢 LOW（已加 Redis 分布式锁） |
| 8 | `after-sale/after-sale.utils.ts:27-45` | `product.findUnique` 后再 `category.findUnique`（每次售后判断） | 售后请求路径 | 🟡 MEDIUM（可 `include: { category: true }` 单次 JOIN） |
| 9 | `bonus/engine/bonus-allocation.service.ts:42,114,472,487` | 顺序串行 4 次 `findUnique`（order / allocation / member / vipProgress） | 分润核心路径 | 🟡 MEDIUM（可 Promise.all 并行） |
| 10 | `after-sale/after-sale-timeout.service.ts:451` | `tx.order.findUnique` 嵌在事务循环内 | Cron 批量处理 | 🟢 LOW |

### 缓存失效漏洞（最多 5 条）

所有 7 个 `TtlCache` 实例的使用点已检查：

| 缓存实例 | 文件 | 失效调用点 | 状态 |
|---|---|---|---|
| `company/company.service.ts: listCache` | line 7 | line 116 `invalidatePrefix('companies:')` | ✅ |
| `company/company.service.ts:` discovery filters | line 84-110 | **❌ 未见针对 `discovery:filters` 的 invalidate** | 🟡 管理端修改筛选配置后不会立刻生效，依赖 3 分钟 TTL |
| `product/product.service.ts: categoriesCache` | line 49 | line 365 `invalidate + searchEntityCache.clear + productKeywordSignalCache.clear` | ✅ |
| `product/product.service.ts: searchEntityCache` | line 50 | 随 categoriesCache 一起清 | ✅ |
| `product/product.service.ts: productKeywordSignalCache` | line 51 | 随 categoriesCache 一起清 | ✅ |
| `admin/stats/admin-stats.service.ts: dashboardCache` | line 7 | line 87 `clear()` | ✅ |
| `seller/analytics/seller-analytics.service.ts: overviewCache` | line 8 | line 148-150 | ✅ |
| `admin/reconciliation/admin-reconciliation.service.ts: reportCache` | line 28 | **❌ 未见 `invalidate*` 调用** | 🟡 对账报表 5 分钟 TTL，若有强一致性要求可能存在短暂脏读 |

### 金额精度不一致点（最多 5 条）

`parseFloat` + `toFixed` + `Number` 混用：

| # | file:line | 片段 | 说明 |
|---|---|---|---|
| 1 | `order/order.service.ts:727,738,757,762,775` | 混用 `Number(...)`, `.toFixed(2)`, `Math.min` | 订单结算主路径，逻辑正确但多次 Number/toFixed 往返增加精度风险 |
| 2 | `order/checkout-expire.service.ts:136-149` | 每张红包金额按剩余平摊，用 `toFixed(2)` + `Number` 累加 | 平摊算法 OK 但累积舍入误差需余数归一化（代码已做兜底） |
| 3 | `coupon/coupon.service.ts:1506` | `Number(Math.min(discount, orderAmount).toFixed(2))` | 单点封顶，OK |
| 4 | `seller/products/seller-products.service.ts:129,156,431` | `+(sku.cost * markupRate).toFixed(2)` | 自动定价，三处重复片段建议抽函数 |
| 5 | `order/checkout.service.ts:342,427` | 同套 `toFixed(2) + Number` 模式 | 与 order.service 风格一致但无统一 money util |

🟡 **建议**：封装 `backend/src/common/money.util.ts` 提供 `roundMoney(n: number)`、`addMoney(...)`、`divMoney(...)` 等统一入口，替代 `Number(x.toFixed(2))` 分散写法。目前混用未见明确 bug，但缺乏集中化。

### 缺失索引候选（3-5 条）

基于 `bonus/engine/`、`after-sale/` 的查询 where 字段与 `schema.prisma` 索引对照：

| # | 表 | 缺失索引 | 查询来源 | 严重度 |
|---|---|---|---|---|
| 1 | `RewardLedger` | 已有 `[userId, status, createdAt]`、`[userId, status, entryType]`、`[allocationId]` | 冻结释放/列表查询 | ✅ 已覆盖 |
| 2 | `AfterSaleRequest` | 已有 `[orderId]`、`[userId, status]`、`[status, createdAt]` | seller 列表 / timeout cron | ✅ |
| 3 | `AfterSaleRequest` | **缺 `[companyId, status, createdAt]`** — 卖家端按 companyId 过滤 | `seller-after-sale.service.ts findAll(companyId, ...)` | 🟡 但 AfterSaleRequest 本身无 companyId 字段，需通过 order → company JOIN，当前依赖 order 表索引 |
| 4 | `RewardAllocation` | 仅 `[orderId]` | 按 `triggerType + createdAt` 查询的场景会扫表 | 🟡 admin/bonus 仪表盘查询可能受影响 |
| 5 | `CheckoutSession` | 已有 `[userId, status]`、`[status, createdAt]`、`[merchantOrderNo]`、`[expiresAt, status]` | cron 清理 | ✅ |
| 6 | `NormalTreeNode` | 已有 `[parentId, position] unique`、`[level, position]`、`[level, childrenCount]` | 插入/遍历 | ✅ |

### 结论

- **N+1**：热路径（checkout / order preview）有 2 个小规模 N+1，单次影响有限；Cron 任务的 for-loop 内事务是架构性决策（需串行），接受。
- **缓存**：2 处 `invalidate` 缺失（discovery filters、reconciliation report），均非资金路径，依赖 TTL 自然过期，接受但可改进。
- **金额精度**：缺少集中 money util，混用 `Number(x.toFixed(2))` 模式分散全栈，建议 v1.1 重构。
- **索引**：`RewardAllocation` 按 `triggerType+createdAt` 查询路径可能缺索引，建议确认。

---

## 总结

| 维度 | 总体状态 | 关键问题数 |
|---|---|---|
| X1 事务隔离 + CAS | ✅ 合规 | 0 🔴 / 3 🟡 |
| X2 幂等键 | ✅ 合规 | 0 🔴 / 2 🟡（需验证 Payment/Shipment 唯一约束） |
| X3 Webhook 安全 | 🟡 基本合规 | 0 🔴 / 1 🟡（alipay 通知缺 IP Guard） |
| X4 三系统权限隔离 | 🔴 有阻塞问题 | 1 🔴（.env.example 缺 JWT secrets）/ 1 🟡 |
| X5 Mock 开关 + 环境变量 | 🔴 需切换 | 4 🔴 待切（SMS/UPLOAD/3 个 AI 开关）+ 5 🔴 secrets 缺占位 |
| X6 性能红线 | 🟡 可接受 | 0 🔴 / ~8 🟡（分散优化点） |

### Top 5 发布前必处理项

1. 🔴 **`.env.example` 补齐环境变量**：`ADMIN_JWT_SECRET`、`SELLER_JWT_SECRET`、`PAYMENT_WEBHOOK_SECRET`、`LOGISTICS_WEBHOOK_SECRET`、`WEBHOOK_IP_WHITELIST`。
2. 🔴 **生产 env 切换**：`SMS_MOCK=false`、`UPLOAD_LOCAL=false`、`AI_SEMANTIC_SLOTS_ENABLED=true`、`AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=true`、`AI_SEMANTIC_SCORING_ENABLED=true`。
3. 🟡 **补 IP Guard**：`payment.controller.ts:52` `handleAlipayNotify` 加 `@UseGuards(WebhookIpGuard)` 并配置支付宝回调 IP 段。
4. 🟡 **核查幂等唯一约束**：确认 `schema.prisma` 中 `Payment.providerTxnId` 或等价字段有 `@unique`，以及 shipment 事件去重策略。
5. 🟡 **统一隔离级别写法**：将 `'Serializable'` 字符串字面量统一为 `Prisma.TransactionIsolationLevel.Serializable` 常量（5 处）。

### v1.1 建议

- 封装 `common/money.util.ts` 消除 Number/toFixed 混用。
- `RewardAllocation` 补 `[triggerType, createdAt]` 索引（如有仪表盘使用）。
- `company.service.ts` 的 `discovery:filters` 缓存增加 invalidate 调用。
- `admin-reconciliation.service.ts` 的 reportCache 增加管理端主动失效入口。
- `after-sale.utils.ts` 的 product+category 双次 findUnique 合并为单次 `include`。
