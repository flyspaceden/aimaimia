# L04 — 支付宝支付链路深审（💰 A档）

**审查日期**: 2026-04-11
**审查范围**: `backend/src/modules/payment/*` + `schema.prisma` Payment/Refund + `.env.example` ALIPAY_*
**审查员**: Explore agent (read-only)

---

## 🚨 阻塞项（v1.0 上线前必须修复）

### 🚨-01 【CRITICAL】`PaymentService.initiateRefund` 是占位实现，真实退款未接入
**位置**: `backend/src/modules/payment/payment.service.ts:56-89`
**证据**:
```ts
// payment.service.ts:76-88
// TODO: 接入真实支付退款 API
// 微信支付: 调用 v3/refund/domestic/refunds 接口
// 支付宝: 调用 alipay.trade.refund 接口
const mockProviderRefundId = `REFUND-${Date.now()}`;
this.logger.log(`[占位] 渠道退款模拟成功: ...`);
return {
  success: true,
  providerRefundId: mockProviderRefundId,
  message: '退款请求已提交（占位实现）',
};
```
**矛盾**: `alipay.service.ts:145-174` 已经实现了真实的 `refund()`（调用 `alipay.trade.refund`，解析 code=10000，返回 fundChange），但 `PaymentService` **没有注入 `AlipayService`**（`PaymentService` 构造函数里只有 prisma/config/checkoutService/couponService，`payment.service.ts:19-24`），也没有在 `initiateRefund` 中分发到 `alipayService.refund()`。

**影响面**（grep `initiateRefund` 调用方）:
- `backend/src/modules/admin/after-sale/admin-after-sale.service.ts:464` — 管理员审批退款
- `backend/src/modules/after-sale/after-sale-timeout.service.ts:563` — 超时自动退款
- `backend/src/modules/seller/after-sale/seller-after-sale.service.ts:1128` — 卖家同意退款
- `backend/src/modules/admin/refunds/admin-refunds.service.ts:346` — 管理员退款
- `backend/src/modules/payment/payment.service.ts:483` — 取消后支付成功自动退款
- `backend/src/modules/payment/payment.service.ts:134` — 自动退款 Cron 补偿

**后果**: 用户申请退款，系统只会返回一个 `REFUND-{timestamp}` 假 ID 并把 `Refund.status` 置为 `REFUNDED`，**资金实际仍停留在商户账户**。这是 v1.0 资金安全层面的最大阻塞项，直接违反消法"原路退回"义务。

**修复建议**:
1. `PaymentModule` 已同时导出 PaymentService+AlipayService，需要在 `PaymentService` 构造函数中注入 `AlipayService`（Payment/Alipay 同模块无循环依赖风险）
2. `initiateRefund` 中按 `payment.channel` 分发：
   ```ts
   if (payment.channel === 'ALIPAY') {
     const r = await this.alipayService.refund({
       merchantOrderNo: payment.merchantOrderNo,
       refundAmount: amount,
       merchantRefundNo: merchantRefundNo!,
       refundReason: '...',
     });
     return { success: r.success, providerRefundId: r.fundChange === 'Y' ? merchantRefundNo : undefined, message: r.message };
   }
   ```
3. `providerRefundId` 应回写真实支付宝流水号（支付宝退款无独立 refund_no，可用 `out_request_no` 作为 providerRefundId 或使用 `alipay.trade.fastpay.refund.query` 查询 refundSettlementId）
4. 微信支付分支保持 throw NotImplemented（仅支付宝上线）

### 🚨-02 【CRITICAL】`.env.example` 缺失 `PAYMENT_WEBHOOK_SECRET` 和 `WEBHOOK_IP_WHITELIST`
**位置**: `backend/.env.example`
**证据**: 在 .env.example 中 grep `PAYMENT_WEBHOOK_SECRET` / `WEBHOOK_IP_WHITELIST` 均**无任何结果**。
**影响**:
- `payment.service.ts:174-183`：生产环境（NODE_ENV=production）若未配置 `PAYMENT_WEBHOOK_SECRET`，`/payments/callback` 会**全部拒绝**（返回 401）——虽然支付宝回调 `/payments/alipay/notify` 走 `skipSignatureVerification=true` 不受影响，但通用回调入口彻底失效，后续接入第三方聚合支付会被阻塞。
- `webhook-ip.guard.ts:41-44`：生产环境未配置 `WEBHOOK_IP_WHITELIST` 会直接 403——包括 `/payments/alipay/notify`，**支付宝回调入口会被整体阻断**。
**修复**: 把这两个变量登记到 `.env.example`（注释掉），并在部署手册中标红；`WEBHOOK_IP_WHITELIST` 必须包含支付宝公网 IP 段。

### 🚨-03 【HIGH】`PaymentController.handleAlipayNotify` 无 `WebhookIpGuard` 保护
**位置**: `backend/src/modules/payment/payment.controller.ts:52-98`
**证据**: `/payments/callback`（第 32 行）显式 `@UseGuards(WebhookIpGuard)`，但 `/payments/alipay/notify`（第 53 行）只有 `@Public()`，**没有 IP 白名单**。
**后果**: 攻击者可直接 POST 伪造参数到 `/payments/alipay/notify`；虽有证书验签（`verifyNotify`），但 DoS/爆破签名构造仍可行。
**修复**: 给 `handleAlipayNotify` 加上 `@UseGuards(WebhookIpGuard)`，并把支付宝公网 IP 段写进 `WEBHOOK_IP_WHITELIST`。

---

## 📍 真实 SDK 接入状态（非 mock 验证）

| 能力 | 状态 | 位置 | 备注 |
|---|---|---|---|
| `AlipaySdk` 真实 import | ✅ | `alipay.service.ts:3` `from 'alipay-sdk'` | 非 mock |
| SDK 初始化（证书模式 + 公钥模式双路径） | ✅ | `alipay.service.ts:14-69` | 证书模式读 `ALIPAY_APP_CERT_PATH`/`ALIPAY_PUBLIC_CERT_PATH`/`ALIPAY_ROOT_CERT_PATH` 真实文件，公钥模式读 `ALIPAY_PUBLIC_KEY` 字符串 |
| 私钥加载（inline 或文件） | ✅ | `alipay.service.ts:71-81` | 二选一，缺失抛错 |
| `createAppPayOrder` 真实调用 | ✅ | `alipay.service.ts:92-122` | `sdk.sdkExecute('alipay.trade.app.pay', ...)` 返回真实 orderStr；超时 30m，带 notify_url |
| `verifyNotify` 真实验签 | ✅ | `alipay.service.ts:128-140` | `sdk.checkNotifySignV2(postData)` — SDK 内部用证书模式或公钥模式验签 |
| `refund` 真实调用 | ✅ (定义层) | `alipay.service.ts:145-174` | `sdk.exec('alipay.trade.refund', ...)` 真实；但**未被 PaymentService 调用**（见 🚨-01） |
| `queryOrder` 真实调用 | ✅ | `alipay.service.ts:179-203` | `sdk.exec('alipay.trade.query', ...)` — 但没有业务代码调用此方法（孤岛 API） |
| `handlePaymentCallback` SUCCESS 扇出 | ✅ | `payment.service.ts:250-270`（新流程经 `checkoutService.handlePaymentSuccess`）+ `345-467`（旧 Payment 流程） | 完整 |

**SDK 初始化缺陷**: 证书模式分支 `alipay.service.ts:40-52` 用 `fs.readFileSync` 同步读文件；若证书文件缺失，catch 块只 log error 后 sdk 仍为 null，**导致启动后 isAvailable=false，所有后续调用抛"支付宝 SDK 未初始化"**。建议 production 环境将证书加载失败升级为 `throw`，让容器起不来，避免上线后"看起来好着呢实际付不了款"。

---

## 🔗 关键调用链

### 下单调起支付（买家 App → 后端 → 支付宝）
```
FE cart/checkout
  → CheckoutService.createCheckoutSession() [创建 ACTIVE session]
  → CheckoutService.initiateAlipayPayment(sessionId)  [未审核，推断]
    → alipayService.createAppPayOrder({ merchantOrderNo, totalAmount, subject })
    → 返回 orderStr 给 FE
  → FE 唤起支付宝 APP 支付
```

### 支付成功回调链
```
支付宝异步通知 POST /payments/alipay/notify
  → [⚠️无 WebhookIpGuard] PaymentController.handleAlipayNotify (:53)
  → alipayService.verifyNotify(body) [证书验签]
    ├─ 验签失败 → res.send('failure')
    └─ 验签成功
        → 转换 trade_status (TRADE_SUCCESS/FINISHED → SUCCESS)
        → paymentService.handlePaymentCallback({ ..., skipSignatureVerification:true })
            ├─ 分支A: CheckoutSession 存在
            │    → checkoutService.handlePaymentSuccess(merchantOrderNo, ...)
            │      [Serializable 事务 + 3次 P2034 重试]
            │      ├─ CAS: CheckoutSession ACTIVE → PAID
            │      ├─ 分商户创建 Order(status=PAID) + items + 运费分摊
            │      ├─ Reward RESERVED → VOIDED
            │      ├─ InventoryLedger decrement（超卖容忍）
            │      ├─ LotteryRecord WON/IN_CART → CONSUMED
            │      ├─ 购物车按 cartItemId 精确删除
            │      └─ Session → COMPLETED
            │    → couponService.confirmCouponUsage(...)  [事务外，自带 Serializable，3次重试]
            │
            └─ 分支B: 旧 Payment 流程（兼容）
                 [Serializable 事务 + 3次 P2034 重试]
                 ├─ CAS: Payment INIT/PENDING → PAID
                 ├─ CAS: Order PENDING_PAYMENT → PAID
                 ├─ S06 分支: Order.status=CANCELED → 创建 Refund(REFUNDING) + AutoRefund
                 └─ 事务外调用 this.initiateRefund() [⚠️ 占位实现]
  → res.send('success')
```

### 退款链（后续工单）
```
用户/管理员/超时 → initiateRefund(orderId, amount, merchantRefundNo)
  ⚠️ 当前实现：直接返回 { success:true, providerRefundId:"REFUND-{Date.now()}" }
  ❌ 应：分渠道调用 alipayService.refund(...) 或微信退款 API
```

---

## 💰 账本/扇出表

`handlePaymentCallback` SUCCESS 分支（新流程 via `checkoutService.handlePaymentSuccess`）的写入目标：

| 表 | 操作 | 隔离级别 |
|---|---|---|
| `CheckoutSession` | CAS ACTIVE→PAID、最终 →COMPLETED | Serializable |
| `Order` | create (status=PAID) × N 商户 | Serializable |
| `OrderItem` | nested create | Serializable |
| `OrderStatusHistory` | create | Serializable |
| `RewardLedger` | refType=ORDER 关联主单 + RESERVED→VOIDED | Serializable |
| `InventoryLedger` | create / updateMany (CHECKOUT_SESSION→ORDER) | Serializable |
| `ProductSKU.stock` | decrement | Serializable |
| `LotteryRecord` | WON/IN_CART→CONSUMED | Serializable |
| `CartItem` | 按 cartItemId 精确删除 | Serializable |
| `CouponInstance` | RESERVED→USED | 事务外（CouponService 自持 Serializable） |

旧 Payment 流程额外写：`Payment.status`、`Order.status/paidAt`、`OrderStatusHistory`、可选 `Refund`/`RefundStatusHistory`（S06 自动退款）。

---

## 🔒 并发与事务

| 检查项 | 状态 | 证据 |
|---|---|---|
| `handlePaymentSuccess` Serializable | ✅ | `checkout.service.ts:1417` |
| 新流程 P2034 重试 | ✅ | maxRetries=3（checkout.service.ts:1056） |
| 旧 Payment 流程 Serializable | ✅ | `payment.service.ts:455-456` |
| 旧流程 P2034 重试 | ✅ | 3 次，随机退避 100-300ms（`:460-465`） |
| 支付失败分支 Serializable | ✅ | `payment.service.ts:291`（新流程）+ 3 次 P2034 重试 |
| 旧 Payment 失败分支 | ❌ | `:573-582` 用的是普通 updateMany，**没有事务包裹，没有 Serializable**。影响小（只改 Payment.status），但不对称 |
| `updateAutoRefundRecord` Serializable | ✅ | `:632` |
| `retryStaleAutoRefunds` Cron CAS | ✅ | `:113-129`（FAILED→REFUNDING 原子） |
| CAS 幂等（SUCCESS 分支） | ✅ | `updateMany where: status IN [INIT,PENDING]`，count=0 返回 null，回调再次到达时幂等返回 |
| `CheckoutSession.merchantOrderNo` 唯一 | ✅ (推断) | `checkout.service.ts:1063` 用 `findUnique({ where: { merchantOrderNo } })` 说明有 @unique |
| `Payment.merchantOrderNo` 唯一 | ✅ | `schema.prisma:1459` `@unique` |
| `Refund.merchantRefundNo` 唯一 | ✅ | `schema.prisma:1510` `@unique` |
| 自动退款 idempotencyKey 格式 | ✅ | `AUTO-{merchantOrderNo}` (`:401`)，配合 `Refund.merchantRefundNo @unique` 防重复创建，用 `findUnique` 先查后创建（但两步非原子，轻微 TOCTOU，实际由事务包裹 + unique 兜底） |
| Order `idempotencyKey` 设计 | ✅ | `cs:{sessionId}:{cartContentHash}:{idx}` (`checkout.service.ts:1175`) |

---

## ↩️ 状态机对称性

**Payment**: `INIT → PENDING → PAID → REFUNDED / PART_REFUNDED` 或 `INIT → FAILED / CLOSED`
- CAS 转换都用 `status IN [INIT, PENDING]` 防重
- ❌ **没有 INIT→CLOSED 的超时过期机制审计到**（未查到 Cron 关闭未支付 Payment）。新流程走 CheckoutSession 过期（`cancelCheckoutSession` checkout.service.ts:967），所以旧 Payment 流程基本废弃后无所谓

**Refund**: `REQUESTED → APPROVED / REJECTED → REFUNDING → REFUNDED / FAILED`
- 自动退款跳过 REQUESTED/APPROVED，直接从 REFUNDING 起步（`:411`）
- 补偿 Cron 支持 FAILED→REFUNDING→REFUNDED（`:112-150`）
- ⚠️ `Refund` 模型标注 `@deprecated 废弃：退款流程，由 ReplacementRequest 换货流程替代`（schema.prisma:1501），但代码里仍在大量使用。文档标注与代码现状**不一致**，需要澄清：要么取消 deprecated 标注，要么真正迁移到换货流程（v1.0 阻塞）

**Order**: `PENDING_PAYMENT → PAID`，CAS 条件 `status='PENDING_PAYMENT'`；S06 分支检测到 `CANCELED` 时不回滚 Order，而是记录需自动退款

---

## ✅ 验证点

| # | 点 | 结论 |
|---|---|---|
| 1 | AlipaySdk 真实 import+调用 | ✅ 真实，非 mock |
| 2 | createAppPayOrder 完整性 | ✅ out_trade_no/total_amount/subject/product_code/timeout_express/notify_url 齐全 |
| 3 | verifyNotify 证书验签 | ✅ `checkNotifySignV2`，证书模式/公钥模式双路径 |
| 4 | /payments/callback WebhookIpGuard | ✅ 有 Guard；❌ **但 /payments/alipay/notify 没有**（🚨-03） |
| 5 | handlePaymentSuccess 事务边界 | ✅ Serializable + 3次 P2034 重试 + 扇出 9 张表 |
| 6 | idempotencyKey 设计 | ✅ Order 用 `cs:{sessionId}:{hash}:{idx}`；Payment.merchantOrderNo/Refund.merchantRefundNo 均 @unique；CAS 先于 create |
| 7 | Payment 状态机 CAS | ✅ INIT/PENDING→PAID 原子 |
| 8 | Payment↔Order 一致性 | ✅ 同事务内 CAS 双更新；S06 分支处理时间窗 |
| 9 | **支付宝退款真实接入** | ❌ **AlipayService.refund() 真实，但 PaymentService.initiateRefund() 是占位；下游全链路（admin/seller/timeout/auto-refund）都是假退款**（🚨-01） |
| 10 | Refund 模型 | ✅ 有独立模型 + RefundStatusHistory + RefundItem（行级）；但被标注 @deprecated |
| 11 | PAYMENT_WEBHOOK_SECRET 生产必需 | ✅ 代码层面已强制（NODE_ENV=production 必须）；❌ **.env.example 未登记**（🚨-02） |

---

## 🚧 已知问题（除 🚨 外）

### H-01 `AlipayService` 证书加载失败静默降级为 null
`alipay.service.ts:66-68` catch 只 log 不 throw，生产环境证书配置错会"假装启动成功"。修复：production 环境下抛出让容器 crash。

### H-02 `queryOrder` 孤岛 API
`alipay.service.ts:179-203` 定义了主动查询但无任何业务代码调用。建议：
- 在 CheckoutSession 过期前（接近 30min）主动 `queryOrder` 防止漏单
- 自动退款补偿 Cron 应先 `queryOrder` 确认支付宝侧真实状态再决定是否重试退款

### H-03 `Refund` 模型 `@deprecated` 但仍在用
schema.prisma:1501 注释与代码现状矛盾，v1.0 上线前必须澄清文档。

### M-01 旧 Payment 流程失败分支无事务
`payment.service.ts:572-582` 失败分支没有用 $transaction 包裹，与成功分支 Serializable 不对称。影响小但不一致。

### M-02 支付宝 `refund` 幂等性未显式处理
`alipay.service.ts:145-174` 通过 `out_request_no`（即 `merchantRefundNo`）天然幂等（支付宝同 out_request_no 重放会返回成功），但代码没有显式说明或单独处理"同 out_request_no 不同金额"场景（支付宝会返回错误码 `ACQ.TRADE_HAS_SUCCESS` 之类）。建议在 refund() 解析 subCode 做更细处理。

### M-03 `notify_url` 硬编码默认值带中文域名
`alipay.service.ts:104` `'https://api.爱买买.com/payments/alipay/notify'` — 未经 IDN/Punycode 编码直接作为 URL，支付宝开放平台通常要求 Punycode（`api.xn--...`）。需要在创建支付前做域名转换，或强制要求生产环境 `ALIPAY_NOTIFY_URL` 必须配置。

### M-04 `verifySignature` 开发环境跳过可能污染生产
`payment.service.ts:175-183` 检测 `NODE_ENV !== 'production'` 才跳过——若运维错配（比如灰度环境 NODE_ENV=staging），签名校验会被跳过。建议用白名单 `['development', 'test']` 而非黑名单。

### L-01 `rawNotifyPayload` 未脱敏存储
`payment.service.ts:365`/`580` 直接把支付宝完整 body 写进 `Payment.rawNotifyPayload` JSON。支付宝回调包含 buyer_logon_id（用户手机号/邮箱）等 PII，未经脱敏直接入库，违反隐私最小化原则。

---

## 🔗 耦合矩阵

| 依赖方 | 被依赖方 | 方式 | 风险 |
|---|---|---|---|
| PaymentController | AlipayService | 直接调用 verifyNotify | 低 |
| PaymentController | PaymentService | 通用 callback + alipay 转发 | 低 |
| PaymentService | CheckoutService | `@Optional` forwardRef | 低（optional 注入防循环） |
| PaymentService | CouponService | `@Optional` | 低 |
| PaymentService | **AlipayService** | ❌ **未注入** | **致命**（见 🚨-01） |
| checkout.service.ts | PaymentService | `initiateAlipayPayment` 推断有调用 | 未审计 |
| admin-after-sale / seller-after-sale / after-sale-timeout / admin-refunds | PaymentService.initiateRefund | 直接调用 | **全链路受 🚨-01 影响** |

---

## 🧪 E2E 清单（v1.0 必跑）

1. 【支付成功】买家下单 → `createAppPayOrder` → 真实支付宝 SDK 调起 → 回调 → Order=PAID、库存减、购物车清、红包 USED、Reward VOIDED
2. 【幂等回调】对同一 merchantOrderNo 连续 POST 两次支付宝通知 → 第二次返回 SUCCESS 但 CAS count=0，无重复扇出
3. 【订单取消+支付成功竞态】先 cancelCheckoutSession，后支付宝回调到达 → 触发 S06 自动退款路径 → **验证真实退款到账**（当前会失败 ❌）
4. 【验签失败】伪造 body 无签名 → `verifyNotify` 返回 false → 响应 `failure`
5. 【并发回调】同 merchantOrderNo 10 个 POST 并发 → 仅一个成功扇出，其余幂等（需要真实 Postgres 验 Serializable + P2034 重试）
6. 【用户申请退款】after-sale 流程 APPROVED → 点击退款 → **验证支付宝侧真实退款到账** ❌（当前阻塞）
7. 【WebhookIpGuard】非白名单 IP POST `/payments/callback` 和 `/payments/alipay/notify` → 均应 403（当前 alipay 分支不会 403 ⚠️）
8. 【证书模式启动】生产环境证书文件缺失 → 容器应启动失败（当前会降级 ⚠️）

---

## ❓ 疑点（需产品/运维确认）

1. 支付宝退款到账后的异步通知（`alipay.trade.refund` 为同步返回，不发异步 notify，需靠 `alipay.trade.fastpay.refund.query` 轮询确认）——当前代码**没有退款结果查询机制**。Cron 补偿仅基于 `Refund.status=FAILED/REFUNDING + updatedAt < 5min` 重试，不是查支付宝真实状态。
2. 微信支付渠道是否 v1.0 上线？若是，退款分支也要补；若否，`initiateRefund` 应显式拒绝 `channel=WECHAT_PAY`。
3. `Refund` 模型 `@deprecated` 注释是否过时？（schema.prisma:1501 vs 代码现状矛盾）
4. `queryOrder` 定义了却无人调用——是计划中的 v1.1 功能还是遗漏？
5. `notify_url` 中文域名 Punycode 处理方案？

---

## 🎯 v1.0 上线验收门槛

**必须全部满足才能上线支付宝**：

- [ ] 🚨-01：`PaymentService.initiateRefund` 真实对接 `alipayService.refund()`，`PaymentModule` 注入链补齐，6 个调用方全部验证真实退款到账
- [ ] 🚨-02：`.env.example` 登记 `PAYMENT_WEBHOOK_SECRET`、`WEBHOOK_IP_WHITELIST`，部署文档标红必填
- [ ] 🚨-03：`handleAlipayNotify` 加 `@UseGuards(WebhookIpGuard)` + 生产白名单配入支付宝公网 IP 段
- [ ] H-01：证书加载失败在 production 环境抛出，容器 crash
- [ ] H-03：澄清 `Refund.@deprecated` 注释，保持代码与文档一致
- [ ] E2E 1/3/6/7 必跑通
- [ ] 补充退款结果查询/对账 Cron（用 `alipay.trade.fastpay.refund.query`）

**可带病上线但需登记 Known Issue**：
- M-02/M-03/M-04/L-01/H-02（退款结果查询缺失，先用运营手动兜底）

---

**审查结论**: 支付宝**收款**链路已真实接入，事务/幂等/状态机设计完整（Serializable+CAS+P2034 重试），达到生产就绪。但**退款**链路是假的——`AlipayService.refund()` 已实现却被孤立，`PaymentService.initiateRefund()` 是 TODO 占位，整个 after-sale 生态（管理/卖家/超时/自动）全部建立在这个假退款之上。**v1.0 不修复 🚨-01 绝对不可上线**。
