# 爱买买 — 安全与并发一致性问题追踪

> 本文档记录所有时序安全、并发竞态、数据一致性相关问题及修复计划。
> 每次代码变更时必须对照检查，发现新问题需追加到本文档。

---

## 2026-05-10 售后链路收口安全检查

- **状态**: ✅ 已收口，待真机/沙箱联调验证
- **售后退款幂等**: 退款单号统一使用 `AS-${afterSaleId}`，创建与状态推进在 Serializable 事务内执行，seller/admin/timeout 均走统一 `AfterSaleRefundService`。
- **买家退货运费支付幂等**: 支付单号使用 `AS_SHIP_PAY_${afterSaleId}`，支付回调与主动查询复用同一校验路径，防止重复支付写回。
- **买家退货运费退款幂等**: 已支付退货运费在面单未揽收且售后关闭时使用 `AS_SHIP_REFUND_${afterSaleId}` 原路退回，先 CAS 置 `REFUNDING`，再写回 `REFUNDED/FAILED`。
- **退货面单幂等**: 买家退货面单使用 `AS_RETURN_${afterSaleId}`，重复生成返回既有面单，不重复向顺丰下单。
- **拒收回寄面单幂等**: 卖家拒收回寄面单使用 `AS_REJECT_RETURN_${afterSaleId}`，拒收回寄与仲裁路径分离，避免重复回寄。
- **退款双向一致性巡检**: 每日扫描 `Refund.afterSaleId` 与 `AfterSaleRequest.refundId` 的错链/孤儿/重复关系，发现异常写管理端告警，人工处理前不静默修正资金状态。

## 问题严重程度说明

| 级别 | 含义 | 要求 |
|------|------|------|
| 🔴 CRITICAL | 可直接导致资金损失或安全漏洞 | 上线前必须修复 |
| 🟠 HIGH | 可能导致数据不一致或用户体验严重受损 | 尽快修复 |
| 🟡 MEDIUM | 边界情况下的一致性风险 | 计划修复 |

---

## 🔴 CRITICAL 问题（6 个）

### S01: createFromCart 事务隔离级别不足
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts` — `createFromCart` 方法
- **问题**: 订单创建事务（含库存扣减、奖励核销、订单写入）使用默认 `READ COMMITTED` 隔离级别，而 `payOrder`、`batchPayOrders`、`cancelOrder` 均已使用 `Serializable`。这是整个系统最高频的关键操作，却用了最弱的隔离级别。
- **后果**: 奖励双重使用（S02）、库存超卖（S03）的根因。
- **修复内容**:
  1. `$transaction` 加上 `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }`
  2. 添加序列化冲突重试逻辑（当前实现为最多 3 次尝试，指数退避 200ms/400ms）

### S02: 奖励（RewardLedger）可被并发双重使用
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts:429-466`
- **问题**: 两个并发订单请求使用同一 `rewardId`，在 READ COMMITTED 下两个事务都能读到 `status: 'AVAILABLE'`，CAS updateMany 都返回 `count=1`，同一奖励被两个订单各扣一次。
- **后果**: 平台直接亏钱——用户用一个 ¥50 奖励下两个订单，各减 ¥50。
- **修复内容**:
  1. 依赖 S01 修复（Serializable 隔离级别）
  2. 过期检查移入 `updateMany` 的 `where` 条件：`createdAt: { gte: thirtyDaysAgo }`
  3. 增加 `refId: null` 条件确保未被其他订单使用
  4. CAS 失败时给出精确错误提示（已被使用/已过期）

### S03: 库存超卖 — 无数据库层约束
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/prisma/migrations/20260224_security_constraints/migration.sql`
- **问题**: 库存扣减用了 CAS（`stock >= quantity` 才扣），但 READ COMMITTED 下并发事务可读到相同旧值导致超扣。且数据库层没有 `CHECK (stock >= 0)` 约束作为最后防线。
- **后果**: 库存变为负数，用户下单成功但实际无货。
- **修复内容**:
  1. 依赖 S01 修复（Serializable 隔离级别）
  2. 添加数据库 CHECK 约束：`chk_product_sku_stock_non_negative CHECK (stock >= 0)`

### S04: 支付回调 Webhook 无 IP 白名单
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/payment/payment.controller.ts` + `backend/src/common/guards/webhook-ip.guard.ts`
- **问题**: `/payments/callback` 是 `@Public()` 端点，没有 IP 白名单限制。
- **后果**: 攻击者可伪造支付成功回调 → 0 元购。
- **修复内容**:
  1. 新建 `WebhookIpGuard`，支持 IP 精确匹配和 CIDR 匹配
  2. 生产环境未配置 `WEBHOOK_IP_WHITELIST` 时 fail-closed（拒绝所有请求）
  3. 签名验证已是 fail-closed（生产环境无 secret 返回 false）
  4. 环境变量：`WEBHOOK_IP_WHITELIST`（逗号分隔的 IP/CIDR 列表）

### S05: VIP 三叉树并发插入位置冲突
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/bonus/bonus.service.ts` + `backend/prisma/schema.prisma`
- **问题**: 新节点 `position` 使用内存中的 `parentNode.childrenCount`（旧值），两个并发插入会创建同一 position 的两个子节点。
- **后果**: VIP 树结构损坏，影响所有下游奖金分配。
- **修复内容**:
  1. `purchaseVip` 事务升级为 Serializable 隔离级别
  2. 改为先原子 increment `childrenCount`，再用 `updatedParent.childrenCount - 1` 作为 position
  3. 添加 `@@unique([parentId, position])` 唯一约束 + migration SQL

### S06: 订单自动取消与支付回调竞争
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/payment/payment.service.ts`
- **问题**: 订单自动取消定时器和支付回调之间存在竞争窗口。自动取消后支付回调到达，用户钱被扣但订单已取消。
- **后果**: 用户付了钱但订单被取消，需要手动退款。
- **修复内容**:
  1. 自动取消已有 Serializable + 支付状态检查（已实现）
  2. 支付回调侧：发现订单已 CANCELED 时自动创建退款申请（`Refund` 记录）
  3. 记录 `OrderStatusHistory` 标记自动退款

---

## 🟠 HIGH 问题（9 个）

### S07: OTP 验证码可被并发重复使用
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/auth/auth.service.ts` — `verifyCode` 方法
- **问题**: 验证码验证（`findFirst` 查未使用记录）和标记已使用（`update usedAt`）不在原子操作中。
- **修复内容**: 改用 CAS 模式 `updateMany({ where: { id, usedAt: null }, data: { usedAt: now } })`，检查 `count === 1` 才放行。
- **补充（2026-02-25）**: 卖家端验证码消费逻辑已对齐为 CAS；管理员端当前无 OTP 登录流程。

### S08: 奖金分配失败后无补偿机制
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/bonus-compensation.service.ts`（新建）
- **问题**: 确认收货后奖金分配是 fire-and-forget，3 次重试都失败后只写日志，用户永远拿不到奖金。
- **修复内容**:
  1. 新建 `BonusCompensationService`，每 30 分钟扫描死信记录
  2. 自动重新尝试分润分配
  3. 检查订单状态和已有分润记录，避免重复分配
  4. 注册到 `OrderModule`

### S09: 退款后奖金未回滚
- **状态**: ✅ 已修复（确认已存在）
- **文件**: `backend/src/modules/seller/refunds/seller-refunds.service.ts:232` + `backend/src/modules/admin/refunds/admin-refunds.service.ts:234`
- **问题**: 当订单已确认收货（奖金已分配），退款后已发放的奖金没有被回收。
- **确认**: 卖家端和管理端退款审批都已调用 `bonusAllocation.rollbackForOrder(order.id)`，回滚逻辑完整。

### S10: Token 刷新竞态条件
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/auth/auth.service.ts` — `refresh` 方法
- **问题**: 两个设备同时用同一 refreshToken 调用刷新，都通过验证并生成新 token。
- **修复内容**: 改用 `updateMany` CAS 原子撤销，`count === 0` 则拒绝，确保同一 refreshToken 只能刷新一次。
- **补充（2026-02-25）**: 卖家端与管理员端 refresh 逻辑已对齐为 CAS 语义（基于 `expiresAt` 原子失效）。

### S11: 前端购物车与服务端不同步
- **状态**: ✅ 已修复（2026-02-25 完成补齐）
- **文件**: `app/checkout.tsx`
- **问题**: 购物车是纯前端 Zustand 状态，商家下架商品/改价后购物车不会更新。用户到结算时才发现不一致。
- **修复内容**:
  1. 结算页已有 `previewOrder` 调用获取服务端最新价格
  2. 新增价格变更检测：比对 preview 返回的 `unitPrice` 与购物车的 `price`，差异时 toast 提示「部分商品价格已变更，请确认最新金额」
  3. 下架商品由 previewOrder 后端抛出 400 错误（后端侧已具备）
- **补齐（2026-02-25）**: `app/checkout.tsx` 已新增 `previewOrder` 失败时的显式 toast 提示（并做去重，避免重复弹出）。
- **补齐（2026-05-07）**: 商品/SKU 下架级联问题按 `docs/issues/app-tofix4.md` 修正：购物车项返回 `unavailableReason`，普通下架商品仍在结算 preview 硬拦截；下架奖品先识别为奖品后软排除到 `excludedItems[]`，并允许用户删除/清空时退出 stuck 状态。外审补强：软排除奖品写入 `CheckoutSession.bizMeta.excludedPrizeItems`，支付成功时一并删除 cartItem 并将对应 LotteryRecord 转 `EXPIRED`；孤立 prizeRecordId 视为不可用奖品。

### S12: 前端价格预览与实际下单不一致
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `app/checkout.tsx` + `src/repos/OrderRepo.ts` + `backend/src/modules/order/dto/create-order.dto.ts` + `backend/src/modules/order/order.service.ts`
- **问题**: `previewOrder` 展示的价格和 `createFromCart` 实际创建的价格之间没有锁定机制。商家在用户查看结算页时改价，用户看到 ¥100 但实际被收 ¥120。
- **修复内容**:
  1. `CreateOrderDto` 新增 `expectedTotal` 字段
  2. 前端提交订单时传入 `preview.summary.totalPayable` 作为 `expectedTotal`
  3. 后端 `createFromCart` 事务内先计算所有子订单实际合计，与 `expectedTotal` 比对
  4. 差异超过 ¥0.01 时拒绝下单，返回「价格已变更」错误提示新金额

### S22: 红包锁定与 CheckoutSession 创建非原子（v1.1 待重构）
- **状态**: ⏸️ **v1.0 决策延后**（2026-05-28 识别 + cron 缓解）
- **文件**: `backend/src/modules/order/checkout.service.ts:604-617` + `backend/src/modules/coupon/coupon.service.ts` (validateAndReserveCoupons)
- **问题**: 红包预留与订单 CheckoutSession 创建跨两个独立 Serializable 事务执行：
  1. 第一个事务（line 604）调 `couponService.validateAndReserveCoupons()` 把 `CouponInstance.status` CAS 改为 `RESERVED`
  2. 中间执行业务逻辑（计算订单金额等）
  3. 第二个事务（line 649）`prisma.$transaction()` 创建 CheckoutSession
  4. 第二个事务失败 → catch（line 792）释放红包；进程崩溃 → **僵尸 RESERVED 记录**
- **设计意图**：红包预留应该与订单链路原子绑定，违反则有 race window 暴露在 ACID 之外
- **v1.0 缓解措施**：2026-05-28 在 `coupon.service.ts` 加 `cronRecoverStuckReservations`（每 5 min 扫 `status=RESERVED AND updatedAt < now-10min`，按关联 Order 状态自动 confirm/release），把僵尸记录恢复时间从"永久卡死"压到"最多 15 分钟内自动恢复"。
- **剩余风险**（cron 缓解后还有的）：
  1. 中间 race window 期间，并发用户看到 RESERVED 红包不可领（**几百毫秒级，UX 影响微乎其微**）
  2. 架构上违反"红包预留必须在订单链路内"原则（**代码 smell，非业务 bug**）
- **v1.1 重构方案**: 把 `validateAndReserveCoupons` 改成接受 `tx` 参数，或在 `checkout.service.ts` inline coupon CAS 直接写进 session 事务。**触及资金核心路径，重构有回归风险，先在 v1.1 集中处理。**
- **决策记录**: 2026-05-28 用户明确选择 v1.0 跳过重构（cron 已缓解 + 改动风险大于收益）

### S21: 顺丰沙箱旧路由事件污染当前订单状态
- **状态**: ✅ 已修复（2026-05-08）
- **文件**: `backend/src/modules/shipment/shipment.service.ts` + `backend/src/modules/shipment/sf-express.service.ts`
- **问题**: 顺丰沙箱「全流程调测」会把早于当前面单生成时间的历史路由样例一并推送或查询返回；其中包含已签收/已放门口等终态文案时，当前订单可能被错误推进到 `DELIVERED`，并开始退货窗口倒计时。
- **修复内容**:
  1. `handleCallback()` / `queryTracking()` 按 `Shipment.shippedAt ?? Shipment.createdAt - 1h` 过滤旧路由事件，全旧事件批次直接跳过状态更新和轨迹写入；选 `shippedAt` 优先是因为它是真正的"发货时刻"，与"发货前的事件不可信"的语义对齐
  2. 丢弃旧事件后不再信任原始 `DELIVERED/EXCEPTION` 终态，避免旧终态污染当前状态机
  3. OrderState 仅作为调度补充事件，保持 `SHIPPED`，不推进为运输中或已送达；常见 SF 黑话文案规范化（调度失败/等待 → 等待调度、调度成功/收派员信息 → 已派单 等）
  4. 状态更新仍在 Serializable 事务内执行，Order `SHIPPED → DELIVERED` 保持 CAS 来源状态限制
  5. **窗口期保护**（审计 HIGH）：`Shipment.status='INIT' && shippedAt=null` 时（卖家已生成面单但未点确认发货），SF 推真实路由仅写轨迹不推进 Shipment/Order，防止抢跑 `seller-orders.service.ts:321` 的 CAS where status=INIT 卡死卖家发货

---

## 🟡 MEDIUM 问题（9 个）

### S13: Serializable 事务无重试逻辑
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts`
- **问题**: 使用 Serializable 隔离级别但没有序列化冲突重试。
- **修复内容**:
  1. `createFromCart` 添加指数退避重试（当前实现为最多 3 次尝试）
  2. `payOrder` 序列化冲突转为友好错误提示

### S14: 支付无真正幂等键
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts` — `payOrder` 方法
- **问题**: `merchantOrderNo` 用随机 UUID 生成，不基于业务语义。
- **修复内容**:
  1. 改为 `hash(orderId + amount + channel)` 生成 merchantOrderNo
  2. 事务前先查已有 Payment，命中则直接返回（真正幂等）

### S15: 拆单幂等键不完整
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts`
- **问题**: 多商户拆单的幂等键用 `${key}:${companyId}` 拼接。如果重试时 companyGroups 因商品变动而改变，幂等键不匹配可能导致部分重复创建。
- **修复内容**:
  1. 幂等键改为 `${idempotencyKey}:${cartContentHash}:${idx}` 格式
  2. `cartContentHash` = `SHA-256(sorted(skuId:quantity))` 的前 16 位
  3. 子订单用序号 `idx` 而非 `companyId`，不受商户归属变动影响
  4. 查找关联子订单改用 `startsWith` 前缀匹配

### S16: 奖励过期检查顺序错误
- **状态**: ✅ 已修复（2026-02-24，随 S02 一起修复）
- **文件**: `backend/src/modules/order/order.service.ts`
- **问题**: 先将奖励状态改为 VOIDED，再检查是否过期。
- **修复内容**: 过期条件 `createdAt: { gte: thirtyDaysAgo }` 已加入 `updateMany` 的 `where` 子句。

### S17: 奖金账户余额可能出现负数
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/prisma/migrations/20260224_security_constraints/migration.sql`
- **问题**: 退款回滚扣减奖金余额时没检查 `balance >= amount`，理论上可出现负余额。
- **修复内容**: 添加数据库 CHECK 约束 `chk_reward_account_balance_non_negative CHECK (balance >= 0)`

### S18: 奖金 Ledger 无状态机校验
- **状态**: ✅ 已修复（2026-02-25 补齐）
- **文件**: 多处 `rewardLedger.updateMany` 调用
- **问题**: 状态转换没有集中式合法性校验。
- **复核发现（2026-02-25）**:
  1. `backend/src/modules/bonus/engine/bonus-allocation.service.ts` 批量作废未限定来源状态
  2. `backend/src/modules/bonus/engine/vip-upstream.service.ts` 批量释放未限定 `FROZEN → AVAILABLE`
- **修复内容（2026-02-25）**:
  1. 为 `updateMany` 增加来源状态条件（`AVAILABLE/FROZEN → VOIDED`、`FROZEN/FREEZE → AVAILABLE/RELEASE`）
  2. 退款回滚中将 `WITHDRAWN` 流水保留为 `WITHDRAWN`，记录日志等待后续追缴流程处理（不再直接改写状态）
- **后续建议**: 抽象统一的 Ledger 状态机封装，避免散落更新。

### S19: 退款数量未在事务内二次校验
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts` — `applyAfterSale` 方法
- **问题**: 退款商品数量校验在事务外进行。两个并发退款可能各自通过校验，导致总退款数量超过购买数量。
- **修复内容**: 事务内查询 `RefundItem` 累计退款数量，校验 `alreadyRefunded + newQuantity <= purchasedQuantity`。

### S20: 运费硬编码
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `backend/src/modules/order/order.service.ts`
- **问题**: `>=99 免运费，否则 8 元` 写死在代码里，没走 ShippingTemplate 配置。
- **修复内容**:
  1. 新增 `calculateShippingFee(companyId, goodsAmount, tx?)` 私有方法
  2. 查询商户的 `ShippingTemplate`，从 `rules` JSON 提取 `freeThreshold` 和 `baseFee`
  3. 无模板或查询失败时 fallback 到默认值（满 99 免运费，基础运费 8 元）
  4. `previewOrder` 和 `createFromCart` 均调用该方法

### S21: 发票 Provider 预占期间管理端可覆盖状态
- **状态**: ✅ 已修复（2026-05-15）
- **文件**:
  - `backend/src/modules/admin/invoices/admin-invoices.service.ts`
  - `backend/src/modules/admin/invoices/admin-invoices.controller.ts`
  - `admin/src/pages/invoices/index.tsx`
  - `admin/src/pages/invoices/detail.tsx`
- **问题**: 自动/Mock 开票先 CAS 预占 `providerRequestId` 再事务外调用 Provider。预占成功后、Provider finalize 前，管理端“标记失败”或“人工开票”原本只校验 `status=REQUESTED`，可能覆盖飞行中的 Provider 调用，导致上游已开票但本地状态被改写。
- **修复内容**:
  1. `failInvoice()` 和手工开票 CAS 均增加 `providerRequestId: null`，预检时对开票中记录返回冲突。
  2. 新增 `resetProviderReservation()`，仅允许超过保护窗口的 `REQUESTED + providerRequestId` 记录被管理员审计重置。
  3. 管理端读权限只返回脱敏抬头和开票快照，完整电话、邮箱、银行账号、地址等仅对 `invoices:issue` / 超管返回。
  4. 管理后台将 `REQUESTED + providerRequestId` 显示为“开票中”，隐藏普通开票/失败操作，仅保留重置入口。
  5. 手工开票 `pdfUrl` 增加平台上传 / OSS URL 白名单校验，避免任意外部链接写入发票记录。

### S23: 退款补偿双调度同秒撞车（write conflict / deadlock）+ 永久失败退款无终态
- **状态**: ⏳ 未修复（2026-05-30 发现于 staging，按决策「先跑通微信联调、回头单独修」暂缓）
- **文件**:
  - `backend/src/modules/after-sale/after-sale-timeout.service.ts:784`（`retryStaleRefunds`，`@Cron('0 */10 * * * *')`）
  - `backend/src/modules/payment/payment.service.ts:939`（`retryStaleAutoRefunds`，`@Cron('0 */10 * * * *')`）
  - 撞点：`backend/src/modules/after-sale/after-sale-refund.service.ts:588`（`acquireProviderRetryLeaseInTx` 内 `tx.refund.updateMany` FAILED→REFUNDING）
- **问题**:
  1. **双调度同秒撞车**：两个退款补偿 cron 都是 `0 */10 * * * *`（每 10 分钟同一秒触发），且都扫同一批 `status ∈ {FAILED, REFUNDING}` 的退款。同一笔退款被两者同时领取时，Serializable 隔离下 Postgres 判一方 `Transaction failed due to a write conflict or a deadlock`，该轮该方回滚。数据安全 ✅（不会重复退款），但报 ERROR 刷日志。
  2. **永久失败退款无终态/无重试上限**：staging 上 `afterSaleId=cmp05l40b002et7sh6hwts53a` 的退款因底层支付宝交易不存在（`ACQ.TRADE_NOT_EXIST`）永远退不成功，一直停在 FAILED，于是两个 cron 每 10 分钟反复重试 + 反复撞车，日志无限刷。
- **影响**: 数据无损（Serializable 阻止了重复退款），但：① 日志被 deadlock + 退款失败刷屏，掩盖真问题；② 永久失败的退款无 max-retry / 终态，补偿任务永不收敛；③ 双调度对同批退款冗余加锁，徒增锁竞争。
- **建议修复（方向，待确认）**:
  1. **单一所有权**：退款重试只归一个 cron（建议留 `PaymentService.retryStaleAutoRefunds`），`AfterSaleTimeoutService` 不再直接重试退款；或两者错峰（不同秒/分）。
  2. **序列化失败视为可重试信号**：`acquireProviderRetryLeaseInTx` 捕获 write-conflict/deadlock 时按「本轮跳过、下轮再来」处理（warn 而非 error），参考 S13。
  3. **失败上限 + 终态**：自动退款补偿加最大重试次数 / 指数退避，超限翻 FAILED 终态并告警转人工，避免 `ACQ.TRADE_NOT_EXIST` 这类永不成功的单子无限刷。
  4. **清 staging 脏数据**：把 `cmp05l40b002et7sh6hwts53a` 那笔退款手动置终态，立刻止血日志（治标）。
- **关联**: S13（Serializable 事务无重试逻辑）、S19（退款数量未在事务内二次校验）

---

### S24. 售后 REFUNDING 手动重试可能重新发起渠道退款（2026-06-01 新增，已修复）
- **级别**: 🟠 HIGH
- **状态**: ✅ 已修复
- **范围**: 售后退款重试 / 管理后台售后列表 / 微信退款 pending 闭环
- **发现**: 管理后台允许 `Refund.status=REFUNDING` 的售后退款点击“重试”。旧逻辑在 `AfterSaleRefundService.retryRefund()` 中先调用 `PaymentService.reconcileWechatRefundBeforeRetry()`，但当该方法返回 `false`（例如非微信渠道或无法进入微信查单路径）时会继续调用 `initiateRefund()`。如果渠道退款实际仍在 pending，只是本次查单未闭环，存在重复发起渠道退款的资金风险。
- **修复**:
  1. `REFUNDING` 退款重试路径改为**只查单、不重发**：调用 `reconcileWechatRefundBeforeRetry()` 后立即返回，不再落到 `initiateRefund()`。
  2. 微信 pending 售后退款新增 15s / 45s / 90s 短延迟查单，缩短“渠道已成功但业务仍显示退款中”的窗口；查单仍复用既有金额校验和 `handleRefundSuccess()` 闭环。
  3. 管理后台把 `REFUNDING` 操作文案从“重试”改为“查单”，确认弹窗明确“不重新发起退款”；`FAILED` 才保留“重试”语义。
  4. 新增单测锁定：`REFUNDING` reconcile 未处理时不得调用 `initiateRefund()`；pending 后短延迟查单不得重复发起退款。
- **验证**: `npm test -- after-sale-refund.service.spec.ts --runInBand` 通过；`npx prisma validate` 通过；后端 build 通过。

---

## 修复统计

| 级别 | 总数 | 已修复 | 未修复 |
|------|------|--------|--------|
| 🔴 CRITICAL | 6 | 6 | 0 |
| 🟠 HIGH | 9 | 8 | 1 ⏸️ |
| 🟡 MEDIUM | 9 | 8 | 1 ⏳ |
| **合计** | **24** | **22** | **2** |

⏸️ S22（红包锁定 atomicity）v1.0 决策延后到 v1.1，cron 已缓解实际影响，详见对应条目。
⏳ S23（退款补偿双调度撞车 + 永久失败退款无终态）2026-05-30 发现于 staging，按「先跑通微信联调、回头单独修」决策暂缓；数据无损（Serializable 阻止重复退款），主要是日志刷屏 + 永久失败退款不收敛。

原 22 个安全问题中 21 个已修复、S22 延后至 v1.1；2026-05-30 新增 S23 待修；2026-06-01 新增 S24 并已修复（详见条目）。

---

## 安全检查清单

> **每次代码变更时，对照以下清单检查是否引入新的安全问题：**

### 并发安全
- [ ] 涉及金额计算的事务是否使用 Serializable 隔离级别？
- [ ] CAS 操作（updateMany + count 检查）是否在事务内？
- [ ] 是否有 TOCTOU（Time-of-Check to Time-of-Use）漏洞？
- [ ] 关键资源（库存、余额、奖励）是否有数据库层约束（CHECK / UNIQUE）？

### 幂等性
- [ ] 接口重复调用是否安全（返回已有结果而非重复执行）？
- [ ] 幂等键是否基于业务语义而非随机值？

### 状态机
- [ ] 状态转换是否受限于合法路径？（不能从任意状态跳到任意状态）
- [ ] 并发状态变更是否用 CAS 保护？（where 条件含来源状态）

### 前后端一致性
- [ ] 前端展示的金额/库存是否在提交前与后端重新校验？
- [ ] 前端传入的价格/数量是否被后端忽略并重新计算？

### 认证安全
- [ ] Token/OTP 的消费操作是否原子性？
- [ ] 买家端 / 卖家端 / 管理端是否都做到一致的 Token 刷新与 OTP CAS 语义？
- [ ] 公开端点（@Public）是否有额外的安全防护（IP 白名单、签名验证）？

---

## 普通用户系统改造 — 新增安全检查项

> 以下为 plan-treeforuser.md Phase A-G 引入的新安全风险点，需在各 Phase 实施时逐项检查。

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| N01 | 普通树并发插入 | 🔴 HIGH | 轮询平衡插入时多用户争抢同一位置，需 Serializable + @@unique([parentId, position]) + P2034 重试 | ⬜ Phase B |
| N02 | 冻结奖励双重释放 | 🔴 HIGH | 消费解锁与 Cron 过期并发时可能重复操作余额，需 CAS + Serializable | ⬜ Phase B |
| N03 | 冻结奖励过期与释放竞态 | 🟡 MEDIUM | Cron 过期和用户消费解锁同时发生，需确保只有一个操作成功 | ⬜ Phase B |
| N04 | 抽奖防刷 | 🟡 MEDIUM | 时区处理（统一 UTC+8）、@@unique([userId, drawDate]) + IP 限制 | ⬜ Phase C |
| N05 | 奖品超发 | 🔴 HIGH | dailyLimit/totalLimit 原子检查，wonCount 并发递增需 CAS 保护 | ⬜ Phase C |
| N06 | 换货申请重复提交 | 🟡 LOW | 同一订单/商品项的换货申请幂等校验 | ⬜ Phase E |
| N07 | 自动定价绕过 | 🟡 MEDIUM | 后端强制校验 price = cost × markupRate，拒绝前端传入的 price | ⬜ Phase D |

---

## 2026-05-25 账号身份绑定（方案 A）安全检查

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| B01 | **AuthIdentity 唯一约束在 NULL 上失效** | 🟠 HIGH | Schema `@@unique([provider, identifier, appId])` 在 `appId=null` 时 PostgreSQL `NULLS DISTINCT` 让两条 `(WECHAT, openId, NULL)` 不冲突，P2002 不触发。当前所有微信身份 `appId=null`，意味着登录注册/绑定的 schema 层防并发是**纸面约束**。本次 `bindPhone`/`bindWechat` 已用 Serializable 事务在应用层兜底，但根治需改 migration（候选：`@@unique([provider, identifier])` 移除 appId、或 partial index `WHERE appId IS NULL` 等价处理）。**注意：修这个 schema 会影响 `loginWithWeChat`、`register`、`loginByPhone` 的并发行为，需要整组回归** | ⬜ 单独开 PR |
| B02 | 绑定身份成功后不清 session | 🟡 LOW | 与卖家端 `changePhone` 不同：本次是**新增身份**而非修改现有身份，当前 session 应保持有效。已在代码注释中说明决策。无需修复，仅记录避免后续误改 | ✅ 设计内 |
| B03 | sendBindPhoneCode 不应泄露占用信息 | 🟠 HIGH | 发码端点若预检"目标号已被占"并拒绝，会成为攻击者枚举注册号的渠道。已修：sendBindPhoneCode 只检查当前账号是否已绑，占用判断推迟到 bindPhone（OTP 消费后） | ✅ 已修 |

---

## 2026-06-04 账号注销（即时）分润资金安全（Task 5）

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| D01 | **分润上溯给已注销祖辈入账** | 🔴 CRITICAL | 即时注销后用户节点保留在 VIP/普通树里（不剔除、不重排）。若不拦截，下游订单的分润上溯会把份额写进已注销用户的 RewardAccount，事实上把"已清零归平台"的资产又凭空发回去。已修：`vip-upstream` / `normal-upstream` 的 `distribute` 在确认祖先 `userId` 非空（非系统节点）后、入账前调用 `resolveActiveRewardRecipient(tx, ancestorUserId)`（事务内读 `User.status`/`deletionExecutedAt`），为 null 则走现有平台留存通道 `creditToPlatform(reason='DELETED_UPSTREAM_RECIPIENT')`，绝不碰已注销用户账户。读状态用事务 client `tx`，与分配同处 Serializable 快照，无 TOCTOU 缝隙 | ✅ 已修 |
| D02 | 已注销份额导致利润不守恒 | 🔴 HIGH | 跳过注销祖辈后份额若丢失，则 100% 利润分配出现缺口。已修：跳过的整笔 `rewardPool` 全额进 PLATFORM_PROFIT 留存账户（一条可审计 ledger，金额方向 +），返回 `no_ancestor`，总和仍 = 应分配利润。单测覆盖守恒断言 | ✅ 已修 |
| D03 | 遗留 NORMAL_BROADCAST 队列残留注销受益人 | 🟡 LOW | `NORMAL_BROADCAST` 仅对迁移日期（2026-02-28）前旧订单生效，新订单不再进入；但桶队列里仍可能残留已注销用户。已补强：广播循环内对每位受益人 `resolveActiveRewardRecipient`，注销者其单笔份额（含 remainder 仍按原规则归最后一位）路由到平台 `creditToPlatform(variant='DELETED_BENEFICIARY')`，`totalDistributed` 照计，守恒不变 | ✅ 已修 |
| D04 | 注销成功后 App 残留请求 403 不自动登出 | 🟡 LOW | execute 成功后端已 revoke session + `status=DELETED`；App 成功页到用户点"退出 App"之间若有 React Query 后台 refetch，会得到 403 当普通业务错误（不崩溃、无数据泄漏，账号已删）。**非安全问题、不阻塞发布**：当前靠"用户主动退出"设计保证。若要优化体验，**不可**在 `ApiClient` 加全局"403→登出"（会误伤合法权限 403 把正常用户踢登录），应只针对"账号已注销/不可用"特定错误码触发 `logoutAndClearClientState()` | ⏳ 待办（可选） |
| D05 | 地址软删 `deletedAt` 过滤靠人工逐查询添加 | 🟡 LOW | 现状：`address.service.ts` 全部 17 处面向用户查询均已加 `deletedAt: null`（已审查确认无遗漏）。隐患：Prisma 无全局 soft-delete where 约束，未来新增地址查询易漏过滤导致读到已注销用户的已删地址。建议：PR 检查项/封装统一查询 helper | ⏳ 待办（防护） |
