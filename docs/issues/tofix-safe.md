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

## 2026-07-10 客服实时会话安全与一致性检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| CS01 | Socket 只验 JWT 签名，注销会话、禁用账号或撤销权限后仍可保持客服连接 | 🟠 HIGH | 新增 `CsSocketAuthService`，握手成功前校验账号与有效登录会话；加入/发送/会话变更前再次查库。管理员角色和 `cs:read/cs:manage` 不信任 JWT 旧值；撤销管理权限时立即退回已占会话，只读管理员不进入可分配坐席池 | ✅ 已修复 |
| CS02 | 关闭、转接、定时清理并发时可能重复释放席位，或把已关闭会话重新改回处理中 | 🟠 HIGH | 工单+转排队、坐席名额+会话归属、手动接入+容量、释放/断线+后续副作用均事务化；关闭与清理使用行锁/来源状态 CAS；AI 回复在行锁内校验后落库；重复关闭幂等返回 | ✅ 已修复 |
| CS03 | 同一管理员开多个标签页时，一个标签页断开会把另一个标签页仍在处理的会话退回排队 | 🟠 HIGH | 单进程内按管理员跟踪全部 Socket ID，仅最后一个连接断开并超过 30 秒宽限期后执行离线回收 | ✅ 已修复 |
| CS04 | 多进程部署时管理员连接计数和 30 秒断线定时器仍是进程内状态 | 🟡 MEDIUM | 当前生产为单 PM2 进程，现状安全；扩容到 PM2 cluster/多实例前必须把管理员连接计数和断线租约迁移到 Redis/数据库。Socket.IO Redis Adapter 只同步房间事件，不能替代共享 presence/租约 | ✅ 当前部署边界已确认 |

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

## 2026-07-28 全平台订单队列奖励资金安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|---|---|---|---|---|
| QR01 | 并发确认收货导致位置顺序重复、超发或平台重复扣减 | 🔴 CRITICAL | 队列分配与现有树/平台分割在同一 Serializable 事务；全平台 advisory xact lock 固定顺序；序列化冲突最多 3 次；位置 sequence 唯一、订单状态和全部幂等键唯一 | ✅ 已检查 |
| QR02 | 浮点误差导致红包总额大于利润预算 | 🔴 HIGH | 计算器统一使用整数分；名义预算取 `min(利润×比例, 平台利润份额)`；实际发放额才从平台分成扣除；分币尾差使用可重放轮换，测试断言资金守恒 | ✅ 已检查 |
| QR03 | 同一大单拆成多个位置后突破订单支付金额上限 | 🔴 HIGH | 所有位置以 `orderStateId` 共享物理订单上限；分配器校验同一封顶组剩余额度一致；账户、订单累计和分配流水同事务更新 | ✅ 已检查 |
| QR04 | 只按来源订单退款，遗漏该订单历史位置收到的红包 | 🔴 HIGH | 售后成功按 `sourceOrderId OR beneficiaryPositionOrderId` 双向查询；内部待结算/可用记录、队列账户、订单累计、位置状态和平台回收同一 Serializable 事务 CAS 更新 | ✅ 已检查 |
| QR05 | 内部待结算记录被提前放入用户钱包 | 🔴 HIGH | 确认收货仅写内部 distribution 和订单封顶占用，不创建 RewardAccount/RewardLedger；专用释放同时校验来源与受益订单均已收货、两个售后窗口都结束且没有进行中/成功售后，缺失窗口 fail-closed，通过后才原子创建 AVAILABLE 钱包流水 | ✅ 已检查 |
| QR06 | 到账通知/响铃重复或单页截断导致漏响 | 🟠 MEDIUM | 每笔实际到账在释放事务内使用 distribution 幂等键写统一持久化通知 outbox；App 用 `createdAt + id` 复合游标分页追赶全部新队列消息，同一消息成功播放后才推进游标 | ✅ 已检查 |
| QR07 | 新队列记录误让旧树补偿任务认为分润已完成 | 🟠 MEDIUM | 补偿任务判断已有收货分润时显式排除 `GLOBAL_QUEUE`；队列重复执行自身幂等，不会阻断普通/VIP树补偿 | ✅ 已检查 |
| QR08 | 配置比例把平台利润扣成负数，或管理员保存前看不到队列叠加后的真实利润影响 | 🔴 HIGH | 单项允许 1%–100%；配置快照最终态校验队列比例不得超过普通与 VIP 平台比例；利润安全预览把启用的队列比例纳入所有买家/推荐人组合。平均分配模式会用已保存值补齐未挂载的正态随机字段，避免候选预检永久停在 saved；预检未完成、失败或不安全时禁用保存并显示原因；后端 Serializable 校验继续作为不可绕过的最终闸门 | ✅ 已检查 |
| QR09 | 队列积压时一次新位置奖励并推进全部历史位置 | 🔴 CRITICAL | 历史位置查询按全局 `sequence ASC, id ASC` 固定排序并强制 `take=N-1`；同一物理订单位置仍互不奖励、互不推进，窗口完成后才按 FIFO 取下一批；回归测试覆盖 `N=3` 时只推进最前 2 位 | ✅ 已修复 |
| QR10 | 拆单单元过小导致单订单生成海量位置、事务和通知失控 | 🔴 HIGH | 新增 `QUEUE_MAX_POSITIONS_PER_ORDER`，默认 100、后台限制 1–500；位置数、预算切分和订单规则快照使用同一上限，避免只限制展示而未限制资金计算 | ✅ 已修复 |
| QR11 | 连续部分退款或可用余额不足时重复计算平台回流、阻断售后 | 🔴 CRITICAL | 分配记录保存实际回收额、平台累计回流额和累计剩余利润比例；后续退款只记目标差额且以 refundId 幂等。钱包余额不足、已提现或提现处理中均不阻断退款；能回收多少记多少，剩余进入可审计追偿 | ✅ 已修复 |
| QR12 | 提现处理中退款后，付款失败退回用户造成追偿资金再次可提 | 🔴 CRITICAL | 追偿记录关联处理中 withdrawal；付款失败时先用冻结款偿还队列追偿，只把剩余金额恢复余额；付款成功保留欠款。后续提现先从队列可用额中预留所有 `RETURN_FROZEN` 未偿债务 | ✅ 已修复 |
| QR13 | 注销时先清空钱包再作废队列奖励，导致资产无去向或误撤来源奖励 | 🔴 HIGH | 注销事务先按“受益人维度”作废该用户收到的队列奖励，不撤销其历史订单发给其他用户的奖励；再将剩余账户余额全额归平台并清零，使用 Serializable 和幂等流水 | ✅ 已修复 |
| QR14 | 释放任务固定扫描第一页，失败或未到期记录长期饿死后续记录 | 🔴 HIGH | 释放器采用稳定 `updatedAt + id` 游标多批次扫描；延后和失败记录会 touch 到队尾，单轮有明确时间预算，失败不阻塞后续记录，重复运行仍由状态 CAS 和唯一幂等键保护 | ✅ 已修复 |
| QR15 | 只看天数售后窗口，生鲜小时窗口更长时提前到账 | 🔴 HIGH | 手动确认、自动确认和两条物流签收路径统一取 `RETURN_WINDOW_DAYS`、`NORMAL_RETURN_DAYS`、`FRESH_RETURN_HOURS` 的最长毫秒值生成保护截止时间；配置校验拒绝无效窗口 | ✅ 已修复 |
| QR16 | 状态页/到账铃声分页不稳定，软删除消息重新响或失败 outbox 永久丢失 | 🟠 MEDIUM | 状态页按位置 `sequence + id` 稳定游标，App 无限分页；铃声按 `createdAt + id` 追赶且排除 `deletedAt`；通知调度器会重驱到期 FAILED outbox，每笔成功播放后才推进本地游标 | ✅ 已修复 |
| QR17 | 未偿队列追偿只在提现校验扣除，钱包仍显示为可提现 | 🔴 HIGH | 提取整数分追偿汇总函数；钱包、队列状态接口和提现分账统一扣除 `GLOBAL_QUEUE_VOID` 未偿额，避免用户看到或再次申请实际上已被预留的余额 | ✅ 已修复 |
| QR18 | 首次铃声游标使用设备时间，设备时钟偏快会永久漏报 | 🟠 MEDIUM | 新增服务端铃声基线接口；首次启用读取服务端最后一条已持久化消息或 epoch，App 不再以设备当前时间建游标 | ✅ 已修复 |
| QR19 | 老 FAILED 通知长期占满批次，或保留配额后批次容量闲置 | 🟠 MEDIUM | 新通知/崩溃恢复记录优先，FAILED 最多预留 10% 配额；主队列不足时再用其余 FAILED 候选补满批次，单条批次不会让毒消息饿死新通知 | ✅ 已修复 |
| QR20 | 利润规则快照损坏时仍以零资金推进队列，挤出正常位置 | 🔴 HIGH | 只有“缺少成本”允许可信零资金入队；买家路径、七分比例或直推快照不完整以及金额守恒异常全部 fail-closed，不建位置也不推进队列 | ✅ 已修复 |
| QR21 | 队列改造顺带给旧普通/VIP树生成新追偿债务，但旧钱包/提现不识别 | 🔴 HIGH | 旧树恢复原有严格回收语义；队列按账户类型和 scheme 独立查询、作废与追偿，禁止新规则改变普通树、VIP树和直推奖励的资金行为 | ✅ 已修复 |
| QR22 | 绕过管理页面可在没有生效时间时直接开启队列，或手工数据突破追偿上限 | 🔴 HIGH | 快照保存与运行时读取均要求启用状态必须有合法生效时间；迁移增加 `recoveredAmount ≤ amount`、`platformReturnedAmount ≤ recoveredAmount` 数据库 CHECK | ✅ 已修复 |
| QR23 | `N=100` 且单单 500 位置的极端组合导致 Serializable 事务耗时过长 | 🟠 MEDIUM | 代码设置单笔位置硬上限和 30 秒资金/售后事务超时，默认保持关闭；合并不等于启用，Staging 必须以后台允许的极端参数完成数据库负载测试后才能灰度 | ⏳ 待 Staging 压测 |
| QR24 | 平均分配模式隐藏正态参数后，预检虽通过但最终保存把隐藏字段作为空值提交 | 🟠 MEDIUM | `validateFields` 后使用与候选预检相同的补值函数，以当前已保存参数补齐未挂载字段；只提交完整、已验证的 10 参数快照，后端 Serializable 利润安全校验保持不变 | ✅ 已修复 |

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

## 2026-08-02 微信小程序登录与账号合并安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMA01 | 小程序 `code`、`session_key`、AppSecret 或 OpenID 泄露到客户端/日志，或生产误开 Mock 形成认证绕过 | 🔴 CRITICAL | `code2Session` 只在服务端调用；返回结构主动丢弃 `session_key`；生产检测到 `WECHAT_MINIAPP_MOCK=true` 直接 fail-closed，示例配置默认 false；错误日志不记录 URL、code、AppSecret、OpenID 或 session_key；单测覆盖客户端响应、ticket 存储和生产 Mock 拒绝 | ✅ 已修复 |
| WMA02 | `miniLoginTicket` 被重放、跨用途使用或长期有效 | 🔴 HIGH | ticket 使用 256-bit 随机值，Redis 键只保存其哈希，payload 固定绑定 `WECHAT_MINIAPP_BIND_PHONE` 用途和 5 分钟绝对过期时间；最终绑定通过原子 `GETDEL` 单次消费，生产 Redis 不可用时 fail-closed | ✅ 已检查 |
| WMA03 | 客户端指定 `User.id` 或仅提交未验证手机号劫持既有账号 | 🔴 CRITICAL | DTO 不接收 `userId` 且全局 ValidationPipe 拒绝额外字段；合并目标只由服务端 `appId+openid`、UnionID 和 `SmsPurpose.BIND` 已验证手机号推导；手机号 OTP 使用 bcrypt 校验与 `usedAt` CAS 消费 | ✅ 已检查 |
| WMA04 | 并发登录/绑定把同一微信或手机号归到多个账号 | 🔴 HIGH | App、H5、小程序登录和小程序手机号绑定共用 `auth:wechat-identity:*` 锁命名空间；绑定事务查询全部精确身份、UnionID 候选和手机号候选，发现不同 User 立即 fail-closed；PHONE/WECHAT 双身份写入使用 Serializable，P2002/P2034 退避重试 | ✅ 已修复 |
| WMA05 | 小程序 OpenID 与 App OpenID 混用导致误登录 | 🔴 HIGH | 小程序身份只按非空 `WECHAT_MINIAPP_APP_ID + openid` 精确查询和创建；只有 UnionID 可跨应用合并，不在小程序路径兼容 `appId=null` 的旧身份 | ✅ 已检查 |
| WMA06 | 微信 `code2Session` 长连接、重定向或非 2xx 响应占用登录资源 | 🟠 HIGH | 固定官方 HTTPS URL；8 秒 AbortController 超时；禁止重定向；非 2xx、网络/解析异常统一按上游不可用 fail-closed，且不创建 ticket/身份；回归覆盖非 2xx | ✅ 已修复 |
| WMA07 | UnionID 自动补建身份与账号注销竞争，给已注销用户重新写入 verified 身份 | 🔴 HIGH | 命中身份后在 Serializable 事务内重新读取 `status + deletionExecutedAt`，活动状态复核与小程序身份补建原子执行；并发注销产生事务冲突或直接拒绝，签发 Session 前仍二次检查 | ✅ 已修复 |
| WMA08 | OTP 消费后 ticket 过期/事务失败导致用户必须重走登录与短信流程 | 🟡 MEDIUM | 当前采用 fail-closed：统一身份锁内二次检查 ticket，OTP CAS 后立即 GETDEL 消费 ticket；不会造成账户接管或重复绑定，但极窄失败窗口会影响体验。后续如真实联调频繁出现，再引入绑定 operationId 状态机和幂等重试 | ⏳ 联调观察 |
| WMA09 | 小程序自动登录携带事务外旧 exact 候选补建 UnionID，锁丢失后可把同一 UnionID 回填到两个用户 | 🔴 HIGH | `findWechatMiniappIdentity(profile, tx)` 在每次 Serializable retry 内重新查询精确 `appId+openid` 与全部 `unionId`/legacy meta 候选；候选裁决、活动状态复核、锁 owner 复核和身份回填在同一事务内，任意候选归属突变或失锁均 fail-closed；回归覆盖事务内 exact A + union B 与裁决后失锁不写库 | ✅ 已修复 |
| WMA10 | 登录/绑定失败时异常过滤器记录微信 code、短信 OTP、密码、refresh token、ticket 或带查询串的 URL | 🔴 HIGH | `/auth/**` 异常日志 fail-closed：请求 body/query/params 整体隐藏且 path 去除查询串；通用 sanitizer 先把 camelCase/PascalCase 归一化，再拦截 token/ticket/OTP/captcha/password 等字段；回归覆盖 `accessToken`、`miniLoginTicket` 等绕过形式 | ✅ 已修复 |
| WMA11 | 客户端伪造行政区划文字与代码组合，以便宜地区代码计算运费但展示另一省地址 | 🔴 HIGH | 地址簿新增/更新及已付款订单发货前收货信息修正都强制六位行政区划码；服务端按 GB/T 2260 省级前缀解析并校验与地址文字省份一致。当前运费规则按省级前缀匹配；小程序和 App 均通过标准省市区选择器提交，历史无代码地址在编辑时要求重新选择 | ✅ 已修复 |
| WMA12 | 登录 `returnUrl` 接受外部 URL、协议相对地址或回到认证页，造成跳转劫持/循环 | 🟠 MEDIUM | 小程序只接受单斜杠开头、无协议/反斜杠/换行的内部路径，并拒绝登录、找回密码和法律页自身；非法目标回退上一页或“我的”Tab，回归覆盖双编码和外部地址 | ✅ 已修复 |
| WMA13 | 买家 App 展示修改密码但后端端点缺失；若直接补简单写入，可能与注销竞态复活身份或让被盗会话继续存活 | 🔴 HIGH | 新增登录态买家改密端点，强制旧密码校验和新密码复杂度；账号 ACTIVE 复核、PHONE 身份读取、密码写入、除当前设备外 Session 撤销及 LoginEvent 审计放在同一 Serializable 事务；小程序只提交旧/新密码，不接收用户或身份 ID | ✅ 已修复 |

## 2026-08-02 微信小程序支付身份与跨端重付安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMP01 | 小程序支付从同一用户的任意微信身份取 OpenID，导致多身份账号代付串线 | 🔴 CRITICAL | `Session` 新增 nullable `authIdentityId`；小程序登录/手机号合并签发时保存精确 `WECHAT + miniAppId + openId` 身份，refresh 原样继承；`JwtStrategy` 只暴露当前 token 精确 Session 的身份，旧 token 不推断；小程序 checkout/VIP/resume 再查当前 ACTIVE Session 及其 verified 身份，禁止按 userId 任意选择 | ✅ 已修复 |
| WMP02 | APP 与小程序共用商户号时，仅验商户号会接受错误 AppID 或交易类型通知 | 🔴 CRITICAL | 支付通知按 `CheckoutSession.paymentScene` 精确校验：`APP = WECHAT_PAY_APP_ID + APP`，`MINI_PROGRAM = WECHAT_MINIAPP_APP_ID + JSAPI`；非 CheckoutSession 的售后/配送/历史支付固定为 APP；不匹配返回 401 且不验金额、不建单 | ✅ 已修复 |
| WMP03 | 主动查单返回错误应用下的同名商户单号并触发建单/关单 | 🔴 CRITICAL | `queryOrder()` 的 FOUND 结果强制包含 `appid + trade_type`；普通结算 active-query、取消、过期 cron 均按 paymentScene 校验，售后运费与配送固定校验 APP；身份不一致一律 fail-closed | ✅ 已修复 |
| WMP04 | 微信查单把“明确不存在”和“网络/协议未知”都映射为 null，既可能永久占用，也可能误释放 | 🔴 HIGH | 查询结果改为 `FOUND / DEFINITIVE_NOT_FOUND / UNKNOWN`；仅微信明确 `ORDER_NOT_EXIST` 允许不关单直接走本地 CAS 释放，SDK 异常、未知错误、字段无效继续阻断取消/过期 | ✅ 已修复 |
| WMP05 | VIP 同幂等键重试使用当前套餐价格或新商户单号，造成同键不同金额/重复支付 | 🔴 HIGH | 仅允许复用 ACTIVE、未过期且 paymentScene 相同的原 Session；支付参数完全取原 `merchantOrderNo / expectedTotal / bizMeta.giftTitle` 快照；终态、过期或跨场景复用返回冲突 | ✅ 已修复 |
| WMP06 | App 与小程序切换支付时，并发取消已把会话置 EXPIRED/FAILED，却被当成异常继续阻断 | 🟠 MEDIUM | 切换闸门捕获取消竞态后重读会话；COMPLETED/PAID 返回订单，EXPIRED/FAILED 幂等返回 `recheckoutRequired=true`；UNKNOWN 查询/关单错误仍不吞掉 | ✅ 已修复 |
| WMP07 | 生产误开 SMS/微信 Mock，或 10 秒微信统一身份锁在外部调用中途过期 | 🔴 CRITICAL | `.env.example` 默认关闭 `SMS_MOCK/WECHAT_MOCK`；生产所有短信校验/发码与 App/小程序微信 Mock 均 fail-closed；owner 校验的 Lua `PEXPIRE` 续租返回 `false/null` 会把租约置为 lost，不只记心跳日志；App/H5/小程序在身份创建或归属写入前、签发 token 前主动复核 owner，无法确认即 fail-closed；回归覆盖 `false/null` 期间不创建用户 | ✅ 已修复 |
| WMP08 | App/H5 登录或旧 App `bindWechat` 只检查一个 OpenID/UnionID，遗漏跨端归属冲突 | 🔴 HIGH | App/H5 登录与旧绑定共用 `auth:wechat-identity:*` 锁；App/H5 首次身份查找、用户活动状态复核、身份补写/用户创建全部纳入 Serializable 有限重试；精确 `appId+openId`（含 legacy null appId）与全部 unionId/legacy meta 候选统一裁决，任意不同 User 立即 fail-closed；回归覆盖 exact A + union B 冲突 | ✅ 已修复 |
| WMP09 | 新建 VIP 结算在事务内直接把已过本地时间的旧会话改为 EXPIRED，旧支付页仍可扣款却无法建单 | 🔴 CRITICAL | 创建新 VIP 会话前逐个通过 `cancelSession()` 进入同一 payment-operation owner 锁，主动查单/关单；已支付则主动建单，只有渠道明确未支付且关闭成功才 CAS 释放预留；删除 VIP 创建事务内直接清理分支 | ✅ 已修复 |
| WMP10 | 支付宝服务未注入或暂时不可用时，cancel/expire 跳过渠道确认并释放本地会话 | 🔴 CRITICAL | 存在 `merchantOrderNo + ALIPAY` 时必须显式确认 AlipayService available；不可用时用户取消返回可重试错误，过期 Cron 跳过本轮，两者都不进入本地 EXPIRED 事务 | ✅ 已修复 |
| WMP11 | 微信/支付宝渠道支付窗口晚于 CheckoutSession，本地过期后仍可扣款 | 🟠 HIGH | 微信 APP/JSAPI 下单传入 `session.expiresAt` 作为 `time_expire`；支付宝 App 下单传入同一截止时间的 `time_expire`（Asia/Shanghai，向下截断到分）；provider request fingerprint 同步包含过期快照 | ✅ 已修复 |

---

## 2026-06-04 账号注销（即时）分润资金安全（Task 5）

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| D01 | **分润上溯/直推给已注销用户入账** | 🔴 CRITICAL | 即时注销后用户节点保留在 VIP/普通树里（不剔除、不重排）。若不拦截，下游订单的分润上溯或历史下级购买 VIP 的直推奖励会写进已注销用户的 RewardAccount，事实上把"已清零归平台"的资产又发回去。已修：`vip-upstream` / `normal-upstream` / `normal-broadcast` 入账前调用 `resolveActiveRewardRecipient(tx, userId)`；`BonusService.grantVipReferralBonus()` 也在同一 Serializable 激活事务内读取推荐人 `User.status`/`deletionExecutedAt`。为 null 则走平台留存通道，绝不碰已注销用户账户。 | ✅ 已修 |
| D02 | 已注销份额/遗留流水导致利润或资产复活 | 🔴 HIGH | 跳过注销用户份额若丢失，则 100% 利润分配出现缺口；注销前已有 `AVAILABLE/FROZEN/RETURN_FROZEN` ledger 若继续保留，后续 cron/退款状态机可能把资产转回账号。已修：跳过份额全额进入 PLATFORM_PROFIT 留存账户并写可审计 ledger；注销事务内将该用户既有可逆 RewardLedger 统一置为 `VOIDED/VOID`，再清零 RewardAccount，防止 `freeze-expire`/退款回滚继续处理。单测覆盖守恒、直推归平台、旧 ledger 作废断言。 | ✅ 已修 |
| D03 | 遗留 NORMAL_BROADCAST 队列残留注销受益人 | 🟡 LOW | `NORMAL_BROADCAST` 仅对迁移日期（2026-02-28）前旧订单生效，新订单不再进入；但桶队列里仍可能残留已注销用户。已补强：广播循环内对每位受益人 `resolveActiveRewardRecipient`，注销者其单笔份额（含 remainder 仍按原规则归最后一位）路由到平台 `creditToPlatform(variant='DELETED_BENEFICIARY')`，`totalDistributed` 照计，守恒不变 | ✅ 已修 |
| D04 | 注销成功后 App 残留请求 403 不自动登出 | 🟡 LOW | 已修：`app/me/deletion.tsx` 在 execute 成功后立即调用 `logoutAndClearClientState()` 并 `router.replace('/(tabs)/home')`，不再等待用户点击成功页按钮；仍不在 `ApiClient` 做全局 403 登出，避免误伤正常权限 403。 | ✅ 已修 |
| D05 | 地址软删 `deletedAt` 过滤靠人工逐查询添加 | 🟡 LOW | 现状：`address.service.ts` 全部 17 处面向用户查询均已加 `deletedAt: null`（已审查确认无遗漏）。隐患：Prisma 无全局 soft-delete where 约束，未来新增地址查询易漏过滤导致读到已注销用户的已删地址。建议：PR 检查项/封装统一查询 helper | ⏳ 待办（防护） |

---

## 2026-07-03 VIP 直推佣金资金安全

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| VDR01 | VIP直推佣金提前释放或重复释放 | 🔴 HIGH | `VIP_DIRECT_REFERRAL` 在普通商品支付成功时立即进入推荐人钱包，但必须保持 `FROZEN` 到确认收货后售后期结束；确认收货本身不释放。`VIP_DIRECT_REFERRAL` 冻结流水必须排除在通用冻结过期Cron之外，只能由“收货 + 售后期结束 + 无有效/成功售后”的专用逻辑释放；取消、退款、退货或换货成功必须在 Serializable 事务内作废或扣回。 | ✅ 已修 |
| VDR02 | 直推佣金变成平台额外补贴 | 🟠 HIGH | `VIP_DIRECT_REFERRAL_PERCENT` 必须纳入VIP七分比例合计校验，七项总和必须等于100%；生产兼容默认50/30/0/10/2/2/6，运营推荐模板50/25/5/10/2/2/6，直推佣金从原利润比例中拆出，不额外增加平台支出。 | ✅ 已修 |
| VDR03 | 普通直推佣金重复入账或提前释放 | 🔴 HIGH | `NORMAL_DIRECT_REFERRAL` 从普通七分比例中拆出后，必须在普通商品支付成功时按直推关系单独冻结；没有有效邀请人时用 `NORMAL_DIRECT_REFERRAL_PLATFORM` 明确路由平台。普通树确认收货拆账不能再创建 `NORMAL_DIRECT_REFERRAL_HOLDING`，否则会和支付时直推流水重复；通用冻结过期 Cron 必须排除 `NORMAL_DIRECT_REFERRAL`，避免绕过售后期专用释放条件。 | ✅ 已修 |
| VDR04 | 统一推荐关系改造误删付费 VIP 礼包一次性推荐奖 | 🔴 HIGH | 2026-07-05 为避免“累计消费自动升级 VIP”发一次性推荐奖时，错误地从 `activateVipAfterPayment()` 删除了付费 `VIP_PACKAGE` 的授奖调用，而持续直推佣金又只处理 `NORMAL_GOODS`，形成资金断档。2026-07-10 已恢复：有效 VIP 推荐人按 `VipPurchase` 金额/比例快照在原 Serializable 激活事务内立即获得 `VIP_REFERRAL`；激活 CAS 负责主幂等，授奖函数再按 `refType=VIP_REFERRAL + refId=VipPurchase.id` 防御性查重；自动升级路径继续不发一次性奖。 | ✅ 已修 |

---

## 2026-06-14 数字资产累计消费资金安全检查

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| DA01 | 累计消费重复入账或扣成负数 | 🔴 HIGH | 数字资产账户写入统一收口到 `DigitalAssetService`；所有 credit/debit/adjust/backfill 写入均在 Serializable 事务内完成；`DigitalAssetLedger.idempotencyKey` 唯一约束保证重复确认收货、重复退款通知和重复回填不会重复变更账户；扣回和负向调整会检查 `cumulativeSpendAmount - amount >= 0`。 | ✅ 已检查 |
| DA02 | 订单/退款主链路被数字资产失败阻断 | 🟠 MEDIUM | 确认收货、自动确认收货、售后退款成功和未发货取消退款成功后异步调用数字资产记账；记账失败不回滚订单/退款终态，避免衍生资产系统影响履约和资金退款主链路。退款已成功但数字资产扣回失败时写 `DigitalAssetRefundReversalFailure`，cron 每 10 分钟按 `refundId` 重试同一个幂等 `reverseRefund()`；成功标记 `RESOLVED`，连续失败超限标记 `FAILED` 转人工核查。 | ✅ 已检查 |
| DA03 | 后台人工调整滥用 | 🔴 HIGH | 调整接口要求 `digital_assets:adjust` 权限，并额外校验管理员角色名为“超级管理员”；所有调整写 `DigitalAssetLedger`，带 `adminUserId`、description 和 `AdminAuditLog`，禁止直接改账户值。 | ✅ 已检查 |
| DA04 | 未来股权/期权/工资规则被提前写入 | 🟠 MEDIUM | 第一版设置接口只允许资产/等级/兑换/股权期权模块占位配置，DTO/service 会拒绝 `conversionRate`、`equityRatio`、`salaryRate`、`optionRatio` 等实际兑换字段；买家端 V2 文案按用户类型展示：普通用户只显示累计消费金额并给出 VIP 激活引导，VIP 用户显示数字资产总额、种子资产、消费资产、累计消费金额、等级/种子规则/待用资产等分区。无论哪一类，都必须保留“不可暗示现金、股权、固定收益、可兑现或保本回报”的法务与安全警告。 | ✅ 已检查 |
| DA05 | 历史回填误写或重复回填 | 🟠 MEDIUM | 回填脚本默认 dry-run，必须显式传 `--execute` 才写库；执行时仍走 `DigitalAssetService` 幂等键，回填后再次运行会跳过已存在流水。 | ✅ 已检查 |
| DA06 | 整单/无明细部分退款重复扣回 | 🔴 HIGH | 审查发现无 `RefundItem` 明细的部分退款 fallback 分支会把同一 `refund.amount` 逐行复用，导致本应扣回 30 元时可能按多行扩大扣回。已修：fallback 分支维护 `remainingRequested`，每行扣回后同步递减，显式 0 元商品退款直接跳过；新增 `reverseRefund without item rows caps the whole refund amount once across allocations` 与 `explicit zero product amount does not debit the whole order` 回归测试。 | ✅ 已修 |
| DA07 | VIP 激活与数字资产发放脱节 | 🔴 HIGH | V2 要求 VIP 会员升级、自购种子资产、历史累计消费转消费资产、直邀种子资产在同一激活事务内完成，避免“已升 VIP 但资产没发/重复发”。已检查：`BonusService.activateVipMembership()` 先用 CAS 抢占 `VipPurchase.activationStatus`，再在同一个 Serializable 事务内调用 `grantVipActivationAssets()`；数字资产流水使用 `vip-purchase:*` / `user:*:historical-consumption-credit-grant` 幂等键，失败可重试且不会重复发放。 | ✅ 已检查 |
| DA08 | 后台直接改总额导致快照失真 | 🔴 HIGH | 管理端容易把“数字资产总额”误当可编辑字段。已检查：后端 DTO 只允许 `subjectType` 为 `SEED_ASSET` 或 `CREDIT_ASSET` 的带原因调整；前端也只暴露这两类 subject 的调整入口。总额始终由 `seedAssetBalance + creditAssetBalance` 汇总，所有人工改动都落 `DigitalAssetLedger` 和 `AdminAuditLog`，禁止直改总额。 | ✅ 已检查 |
| DA09 | 历史规则被新配置回溯污染 | 🟠 MEDIUM | V2 中消费资产倍率和 VIP 种子资产数值可配置，如果没有历史快照，旧流水会被新规则误解释。已检查：消费资产流水写 `ruleSnapshot`（倍率档位/分段/原始值），VIP 激活和直邀入账在 `meta` 中写入 `packageId`、`vipAmount`、`sourceUserId` 等上下文；文档和法务文案明确“后台改数通常只影响后续行为，历史以流水快照解释”。 | ✅ 已检查 |
| DA10 | 非 VIP 展示或持有资产余额 | 🟠 MEDIUM | 产品边界要求普通用户只有累计消费，没有数字资产余额。已检查：买家 `getSummary()` / `listBuyerLedgers()` 对非 VIP 仅返回 `cumulativeSpendAmount` 和 `CUMULATIVE_SPEND` 流水，种子资产/消费资产余额对外强制为 0；管理后台可看到账户底座，但普通用户详情按“未激活/0”解释，不把后台查询结果暴露成前台持有权益。 | ✅ 已检查 |
| DA11 | 法务文案暗示固定收益或可兑现 | 🟠 MEDIUM | 数字资产 V2 只定义记账与展示，不定义现金、股权或收益承诺。已检查：`termsOfService.ts`、`privacyPolicy.ts`、`memberServiceAgreement.ts` 明确数字资产不是现金/储值/证券，不可转让交易赠送倒卖；未来使用、折现、收益、股权/期权/工资转换均为待定规则，不承诺固定价值、固定回报或即时兑现。 | ✅ 已检查 |
| DA12 | VIP 历史回填漏补直邀种子资产 | 🟠 MEDIUM | 2026-06-17 首次生产回填只给 VIP 购买人补了自购种子资产和历史消费资产，没有把购买人的 `inviterUserId` 传入 `grantVipActivationAssets()`，导致像“王永志推荐新用户买 VIP”这类历史记录缺少推荐人的 `REFERRAL_VIP_PURCHASE` 流水。已修：回填脚本按购买人的直接推荐人识别待补项，校验推荐人仍为 ACTIVE VIP 后在 Serializable 事务内用 `vip-purchase:*:referral-seed` 幂等键补发；dry-run/execute 统计新增 `referralWouldCredit` / `referralCredited`，重复执行不会重复入账。 | ✅ 已修 |
| DA13 | 付款后冻结消费资产重复释放或误计总额 | 🔴 HIGH | 2026-06-21 新增付款冻结口径后，风险是支付成功重复回调重复冻结、确认收货重复释放、确认前退款与确认收货竞态导致冻结资产和正式消费资产同时存在，或把未履约冻结资产计入数字资产总额。已检查：冻结、释放、作废都在 `DigitalAssetService` 的 Serializable 事务内执行，分别使用 `order:{orderId}:credit-asset-frozen` / `order:{orderId}:credit-asset-release` / `refund:{refundId}:digital-asset-frozen-void:credit` 等业务幂等键；释放前按订单冻结流水扣除已释放/已作废部分，账户更新禁止冻结余额扣成负数；正式退款扣回只查询已释放流水，排除 `CONSUMPTION_PAID_FROZEN`；`totalAssetBalance` 仍只汇总 `seedAssetBalance + creditAssetBalance`，冻结资产单独展示。 | ✅ 已检查 |

## 2026-06-22 团购分享回馈资金安全检查

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| GB01 | 分享码名额超发 | 🔴 HIGH | 团购分享码最多按发起人本次团购锁定的档位快照接收直接推荐订单。已补前置校验：创建团购支付会话前统计 `CANDIDATE/VALID` 记录，名额已满则拒绝创建；支付回调建 `GroupBuyReferral` 时仍二次统计兜底。2026-06-23 补强：名额唯一约束改为仅约束 `CANDIDATE/VALID` 的 partial unique index，`INVALID/VOIDED` 不再占位；支付回调按最小可用序号分配，P2002 并发冲突会重新扫描空位，确实无位才写无效审计。相关写入走 Serializable 事务。 | ✅ 已检查 |
| GB02 | 发起次数绕过 | 🟠 HIGH | 每人每月最多发起次数不再硬编码，`GroupBuyCheckoutService` 从 `RuleConfig.GROUP_BUY_MAX_MONTHLY_LAUNCHES` 读取，默认 4；检查与支付会话创建在同一 Serializable 事务内完成。 | ✅ 已检查 |
| GB03 | 返还提前释放或异常作废后仍释放 | 🔴 HIGH | 团购付款成功同一 Serializable 事务内立即生成分享码；被推荐人付款后写 `PENDING_REBATE` 冻结流水，确认收货后才释放为可用。被推荐人先创建付款会话、发起人随后终止分享、被推荐人再付款时，支付回调会重新确认推荐实例仍为 `SHARING`，否则只写 `INVALID` 审计，不计入推荐名额。团购用户侧不支持退款/退货/换货，系统异常、风控或管理员作废路径仍通过幂等键和状态 CAS 防止已作废返还释放。 | ✅ 已检查 |
| GB04 | 团购购买被抵扣导致返还基数失真 | 🔴 HIGH | 团购 checkout 明确拒绝消费积分、平台红包、团购返还余额和旧 `rewardId`；返还金额按后台配置团购价快照计算，不按被抵扣后的实付金额计算。 | ✅ 已检查 |
| GB05 | 团购返还余额重复入账或抵扣 | 🔴 HIGH | 团购返还账户写入收口到 `GroupBuyRebateService` / `GroupBuyRebateDeductionService`；释放流水使用 `GROUP_BUY_REBATE:<referralId>` 幂等键，抵扣预占/确认/释放/退款走独立 ledger 和 groupId。 | ✅ 已检查 |
| GB06 | 后台展示形成多层关系或敏感导向 | 🟡 MEDIUM | App 和管理后台只展示本人直接推荐记录、团购记录和流水；不展示二级关系链、排行榜或团队图。文案扫描未发现团购新增文件包含合规禁用词。 | ✅ 已检查 |
| GB07 | 统一消费积分提现与旧团购提现串线 | 🔴 HIGH | `/bonus/withdraw` 可自动拆 Reward / GroupBuyRebate / IndustryFund，旧团购返还提现入口仍兼容。`WithdrawRequest.accountSnapshot.source` 标记 `UNIFIED_POINTS` 或 `GROUP_BUY_REBATE_LEGACY`，钱包提现历史、旧团购提现历史和 Idempotency-Key 冲突判断均按来源区分；扣款和失败恢复仍在 Serializable 事务内按各自 ledger 回滚。 | ✅ 已检查 |
| GB08 | ACTIVE 团购待支付会话绕过单团约束 | 🟠 HIGH | 审查发现用户已创建团购支付会话但尚未付款时，还没有 `GroupBuyInstance` 占位，可能再次创建新的团购 checkout。已修：`GroupBuyCheckoutService.createCheckout` 在 Serializable 事务内检查同用户 ACTIVE 且未过期的 `GROUP_BUY` CheckoutSession；同幂等键返回原会话，不同幂等键拒绝。 | ✅ 已修复 |
| GB09 | 推荐码容量竞态导致已付款订单回滚 | 🔴 CRITICAL | 审查发现被推荐人付款前推荐码仍可能被其他付款占满，原支付回调会在创建 `GroupBuyReferral` 前抛错并回滚已付款订单。已修：支付回调保留买家的团购订单、团购实例和本人分享码；推荐码失效/满额/档位异常时只跳过本次推荐返还并记录日志。 | ✅ 已修复 |
| GB10 | 非包邮团购运费少收 | 🔴 HIGH | 审查发现后台活动可配置“非包邮/按配置运费”，但真实团购 checkout 无论是否包邮都写 0 运费。已修：包邮活动仍为 0，非包邮团购按地址地区与 SKU 重量调用平台 `ShippingRuleService.calculateShippingDetail`，失败时降级为系统默认运费，并锁定到 checkout/order 快照。 | ✅ 已修复 |
| GB11 | 历史 `QUALIFICATION_PENDING` 团购实例无法分享 | 🟠 HIGH | 审查发现新订单付款即生成码已满足，但历史已付款待生成码实例缺少上线补偿脚本。已修：新增 `group-buy:backfill-instant-codes`，默认 dry-run，`--execute` 写入；在 Serializable 批次内为合格历史实例生成 ACTIVE 码并切到 `SHARING`，同时补缺失 `PENDING_REBATE` 并对已收货推荐调用现有释放逻辑，重复执行不覆盖现有码或重复记账。 | ✅ 已修复 |
| GB12 | 团购 App 支付参数被小程序复用 | 🔴 CRITICAL | 新增专用 `/group-buy/checkout/mini-program`：服务端强制 `WECHAT_PAY + MINI_PROGRAM`，从当前 JWT 精确 `Session.authIdentityId` 解析同 AppID OpenID；团购会话持久化 `paymentScene`，幂等复用同时校验 ACTIVE/过期/请求指纹/场景，禁止 APP 与 JSAPI 交叉复用；支付窗口同步锁定 `time_expire`。创建支付会话仍在 Serializable 事务中完成。 | ✅ 已修复 |

## 2026-08-02 微信小程序售后运费支付安全检查

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| WMAS01 | 退货运费小程序误用 App 或其他用户 OpenID | 🔴 CRITICAL | `AfterSaleShippingPayment` 新增服务端 `paymentScene` 快照；小程序专用端点强制 WECHAT_PAY，不接收客户端渠道/OpenID，仅从当前 JWT 精确 Session + AuthIdentity 取同 AppID 已验证 OpenID。创建/重用运费单继续使用 Serializable；已有未支付记录的端场景不一致时 fail-closed，不交叉复用渠道订单。 | ✅ 已修复 |
| WMAS02 | 主动查单/通知仅按 APP AppID 验证 | 🔴 CRITICAL | 售后运费主动查单与微信支付通知均先读取运费单 `paymentScene`，再同时校验 AppID 和 `trade_type` (`APP` / `JSAPI`)；金额仍以服务端运费单分值对比，场景或金额不匹配均不确认支付。 | ✅ 已修复 |
| WMAS03 | 首次预下单超时后重试产生重复交易，或本地关单后原交易晚到支付 | 🔴 CRITICAL | App/小程序共用 Redis owner 租约与持久化 `CREATING/READY/UNCERTAIN` fence，以原商户单号查单后才决定返回、同单重试或 fail-closed。用户取消只调用后端安全关单：查到成功则先收口支付，状态未知则拒绝本地关单，只有确定未下单或 Provider 终态关单成功才写 `CLOSED`。 | ✅ 已修复 |

## 2026-08-03 即时注销与小程序结算并发安全补强

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMD01 | 注销与地址、结算、团购、团长、售后运费写入竞态，导致注销后仍生成交易或资产 | 🔴 CRITICAL | 注销和相关用户写入共用 PostgreSQL 用户维度 advisory transaction lock；统一锁序为“用户 advisory lock → `User FOR UPDATE` → 业务行”，业务写前必须复核 `ACTIVE + deletionExecutedAt IS NULL`。多用户团长绑定按去重后的用户 ID 排序取锁，避免反向锁序。 | ✅ 已修复 |
| WMD02 | 售后运费待支付漏阻断注销，或历史未支付记录永久阻断注销 | 🔴 CRITICAL | `UNPAID/PENDING` 运费单纳入注销 blocker；用户可经安全查单/关单端点将确定未支付交易收口为 `CLOSED`后再注销。未知态不释放 blocker，防止注销后晚到支付。 | ✅ 已修复 |
| WMD03 | 注销漏清团购返还、团长佣金、小程序场景/订阅状态，或历史回调让资产复活 | 🔴 CRITICAL | 注销事务将团购可用/预占余额和团长可用/冻结余额转平台并写可审计流水；终止未完成团购/团长关系和未完成月结，清理小程序场景、订阅与可丢弃 outbox。所有后续发放/恢复路径再校验用户 ACTIVE，注销账户不再入账。 | ✅ 已修复 |
| WMD04 | 普通/VIP/团购首次 Provider 预下单无持久化防重，幂等复用路径又可绕过 ACTIVE 检查 | 🔴 CRITICAL | 结算统一使用 Redis owner 租约 + `CheckoutSession.bizMeta.paymentParamState` 持久化 fence；每次 fence claim（包括 READY 幂等返回和团购复用）先走用户活性屏障。超时/未知只查原商户单号，不换号重建。 | ✅ 已修复 |
| WMD05 | `BUY_NOW` 与购物车同 SKU 奖品/普通行串线，或拆成多行绕过库存/限购 | 🔴 CRITICAL | 客户端明确传 `checkoutSource=CART|BUY_NOW`并纳入请求指纹。`BUY_NOW` 仅允许一行、禁止 `cartItemId`、不查购物车也不做同 SKU 奖品 fallback；最终 SKU 重复行默认拒绝，只允许每行精确绑定不同合法奖品购物车行的特例。 | ✅ 已修复 |
| WMD06 | 注销预览漏披露将作废的数字资产、团购返还和团长佣金 | 🟠 HIGH | App/小程序预览与确认页同步展示数字资产种子/消费资产、团购可用/预占返还、团长可用/冻结佣金，与服务端清理口径一致。 | ✅ 已修复 |
| WMD07 | 生产环境账号注销短信 Mock 默认开启，验证码可被日志泄露或绕过 | 🔴 CRITICAL | `SMS_MOCK` 默认改为关闭；生产检测到 Mock 配置时在生成、存储或打印验证码前 fail-closed，返回 `ACCOUNT_DELETION_SMS_MISCONFIGURED`。仅非生产开发 Mock 允许输出测试码。 | ✅ 已修复 |

## 2026-07-08 预包装海鲜团长经营资金安全检查

| 编号 | 风险 | 级别 | 说明 | 状态 |
|------|------|------|------|------|
| CAP01 | 团长配置关闭仍可绑定关系 | 🟠 HIGH | 审查发现 `CAPTAIN_SEAFOOD_CONFIG.enabled=false` 时，订单归因会跳过，但买家仍可通过 `/c/{code}` 绑定团长关系，可能在默认关闭或回滚期间沉淀新关系。已修：`CaptainBuyerService.bindByCode()` 后端读取配置并在关闭时拒绝绑定；App `/c/[code]` 同步展示“团长经营暂未开放”。 | ✅ 已修复 |
| CAP02 | 已到账佣金多次退款冲回可能超过原佣金 | 🔴 HIGH | 审查发现 `AVAILABLE` 佣金遇到多笔部分退款时，原佣金流水金额不会像 `FROZEN` 流水一样递减，若不累计历史 `VOID` 流水，后续退款可能按同一原金额再次冲回并超过原佣金。已修：`CaptainCommissionService.voidForRefund()` 按 `meta.originalLedgerId` 汇总历史 VOID 金额，按剩余可冲回金额封顶；新增回归测试覆盖。 | ✅ 已修复 |
| CAP03 | 月度结算标记已支付未同步账户余额 | 🔴 HIGH | 审查发现 `markPaid()` 只把结算流水状态改为 `WITHDRAWN`，没有把 `CaptainAccount.balance` 转入 `withdrawn`，会造成可用余额虚高并带来重复支付风险。已修：标记支付在 Serializable 事务内按账户汇总本结算 AVAILABLE 流水，校验余额后扣减 `balance`、递增 `withdrawn`，再置流水为 `WITHDRAWN`；新增回归测试覆盖。 | ✅ 已修复 |
| CAP04 | 团队池结算总额与实际出账流水不一致 | 🔴 HIGH | 原二级团队池存在 40%/60% 多人出账，易造成结算金额与流水不一致。已在一层直推改造中移除成员分配：1% 改为直接团长独享的经营绩效奖，结算金额与单一团长流水一一对应。 | ✅ 已修复 |
| CAP07 | 二级团长关系被继续用于新订单或月结 | 🔴 CRITICAL | 原关系、订单归因和月结会按间接团长/下级销售额计佣。已修：绑定不再上溯；新订单只建 `DIRECT_ORDER`；月结只聚合直接客户；历史字段改名为 `legacyIndirect*`、历史账本枚举改名为 `LEGACY_INDIRECT_ORDER`，仅保留冻结账本收尾与审计查询。相关写入仍使用 Serializable、唯一幂等键和余额对账。 | ✅ 已修复 |
| CAP08 | 生效时间与有效新增客户配置未按实际规则执行 | 🔴 HIGH | 审查发现 `effectiveFrom` 只被保存，支付前订单仍会归因；同时在当月没有有效订单时，新绑定关系会被错误计为有效客户。已修：归因按订单实际支付时间与 ISO 生效时间裁决；月度有效/新增客户必须同时命中正向直接净 GMV，不再由纯绑定关系计数。 | ✅ 已修复 |
| CAP09 | 同设备/同地址阈值是无执行路径的伪风控参数 | 🟠 HIGH | 审查发现配置页、默认配置和校验接受两个阈值，但订单归因、月结和风控没有任何读取路径，容易造成“已防刷”的误判。已修：从活跃配置契约和后台页面移除；读取或保存旧 V2 配置时自动清理，保留已实际执行的月退款率和暂停结算控制。 | ✅ 已修复 |
| CAP05 | 已审核结算可被批量生成或重算打回草稿 | 🔴 HIGH | 审查发现 `createDraftSettlements()` 会无条件 upsert 并把已审核结算重置为 `DRAFT`，而已审核时已经生成 `AVAILABLE` 月度流水，后续重算可能造成流水与结算金额脱节。已修：批量生成跳过 `APPROVED/PAID` 结算；后台重算只允许草稿、待审核、已驳回，已审核/已支付直接拒绝；管理后台按钮同步禁用。 | ✅ 已修复 |
| CAP06 | 结算可用流水缺失仍能标记已支付 | 🔴 HIGH | 审查发现若数据库出现已审核结算但对应 `AVAILABLE` 月度流水缺失或金额不一致，`markPaid()` 仍会把结算置为 `PAID`，造成后台显示已付但账户未正确出账。已修：标记支付前校验本结算可用流水合计必须等于 `CaptainMonthlySettlement.totalAmount`，不一致则拒绝支付状态转换；新增回归测试覆盖。 | ✅ 已修复 |
| CAP10 | VIP/普通/团长叠加配置突破单品利润底线 | 🔴 CRITICAL | 新增 `ProfitSafetyService`：将 VIP/普通七分、直推、团长最高利润比例、标准履约/风险/目标净利与所有在售 SKU 成本放在同一候选快照中验证。所有相关 RuleConfig、商品成本/售价、上下架和审计回滚写入共用 Serializable + PostgreSQL advisory lock，任一场景不安全时整笔拒绝。 | ✅ 已修复 |
| CAP11 | V3 退款漏冲或跨快照重复冲回 | 🔴 CRITICAL | 退款按订单项累计比例冲回 VIP/普通奖励、平台/产业/慈善/科技/备用金全利润桶、团长逐单/月奖和 funding 镜像台账。每个来源绑定自己的利润快照，连续退款使用未退款原始基线一次缩放，未追回金额保留为 clawback，不当作已回收。 | ✅ 已修复 |
| CAP12 | 利润对账与团长月结互相永久阻断 | 🟠 HIGH | 对账使用不可变 revision 和显式补差草稿；非 `PAID` 月结允许对账审批后重开为待审、重算订单利润与月奖流水。未解决对账/待审补差在后端和管理页双重阻断月结审核/支付，已支付月结保持不可改。 | ✅ 已修复 |
| CAP13 | 团长配置审计不可回滚与 seed 覆盖生产配置 | 🟠 HIGH | 审计装饰器支持固定 `targetIdValue`，团长设置明确捕获 `CAPTAIN_SEAFOOD_CONFIG` 前后快照并经利润安全锁回滚；`prisma:seed` 对已存在团长配置只读不覆盖，避免绕过版本与安全校验。 | ✅ 已修复 |
| CAP14 | 连续利润修订重新纳入已作废 Reward 来源 | 🔴 CRITICAL | 审查发现同一订单第二次利润纠错时，上一版已 `VOIDED` 的 Reward 流水仍会进入 canonical 分组，可能错误扣可用余额、生成追偿并让最新活动来源小于目标。已修：source-basis 查询、组件来源查询和 Reward 组件构建入口三处排除 `VOIDED`；连续两次审批回归同时覆盖冻结来源与“已提现 + 可用补发差额”，验证旧来源保持作废、活动来源总额等于最新目标、第二次只产生正确净差且不误追偿。 | ✅ 已修复 |
| CAP15 | 草稿自产预留释放流水误判月结过期 | 🔴 HIGH | 审查发现月结草稿创建时会写入 `CAPTAIN_MONTHLY_RELEASE`，而审核时的来源指纹又把该派生流水纳入比较，造成正常草稿被错误拦截为“数据已变化”。已修：指纹排除仅由草稿自身派生的 release 流水，保留冻结和退款补差流水；嵌套流水和订单行同时排序，避免数据库返回顺序导致误判。 | ✅ 已修复 |
| CAP16 | 团长月度展示与后台订单筛选按 UTC 跨月 | 🟠 HIGH | 买家团长中心和管理后台默认月份原来按 UTC，上海 00:00-07:59 会读到上月；后台订单月份按归因创建时间而非实际支付时间。已修：统一使用 Asia/Shanghai 自然月，订单筛选按 `order.paidAt` 归属，并校验月份数值范围。 | ✅ 已修复 |
| CAP17 | 最低计佣商品实付被错误按利润 C 判断 | 🟠 HIGH | 配置字段和说明约定按团长范围内“优惠后净商品实付”设置门槛，但 V3 实现错误以利润 C 比较，导致实付足够但毛利较低的订单被漏记团长佣金。已修：门槛比较统一使用 `eligibleGoodsAmount`，逐单金额仍只按利润 C 计算；新增正反门槛回归测试。 | ✅ 已修复 |
| CAP18 | 团长服务注入异常时支付/收货链路静默漏记 | 🔴 HIGH | `OrderModule` 已显式导入团长模块，但归因或佣金释放服务意外缺失时原来只记录 warning 并继续启动，会造成新订单不归因或冻结佣金永不释放。已修：两项服务作为团长资金链路必备依赖，缺失立即终止启动。 | ✅ 已修复 |

---

## 2026-08-02 微信小程序商家转账提现安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMW01 | 客户端伪造 OpenID，把统一钱包提现到攻击者微信零钱 | 🔴 CRITICAL | 提现 DTO 不接收 OpenID；后端只接受当前 JWT 的 `sessionId + authIdentityId`，再查同一 ACTIVE、未过期 Session 关联的 verified `WECHAT + WECHAT_MINIAPP_APP_ID` 身份。申请前和 Serializable 扣款事务内各复核一次，跨端会话、旧 token、其他 AppID 或同用户另一微信身份一律拒绝。 | ✅ 已修复 |
| WMW02 | 发起超时后换单号重试造成重复出款，或误用旧批量转账接口 | 🔴 CRITICAL | 仅调用当前单笔接口 `POST /v3/fund-app/mch-transfer/transfer-bills`；`out_bill_no` 固定为 32 位以内字母数字且数据库唯一。发起请求遇到超时、非 200、未知错误码、非法或验签失败响应，只调用 `GET .../out-bill-no/{原单号}`，不生成新单号，也不调用旧批量转账接口。 | ✅ 已修复 |
| WMW03 | 伪造 Provider HTTP 响应或回调使本地误判到账/退款 | 🔴 CRITICAL | 所有微信 HTTP 响应和回调均使用配置的微信支付公钥验 `Wechatpay-*` RSA-SHA256 签名，强制公钥 ID、5 分钟时间窗；SIGNTEST 探测流量也走同一验签并自然失败。回调只从已验签 rawBody 解析，随后以 APIv3 Key 做 AES-256-GCM 解密且必须执行 `decipher.final()` 验证 auth tag。生产缺配置或格式错误 fail-closed。 | ✅ 已修复 |
| WMW04 | 回调密文缺少 AppID，错误商户/应用/用户/金额的同名订单串线 | 🔴 CRITICAL | 回调验签解密后必须按同一 `outBillNo` 主动查单；查询结果的 `mchId/appId/outBillNo/openid/amount/transferBillNo/state` 必须分别与 Provider 配置、本地加密身份快照、提现净额及回调完全一致，任一缺失或不匹配均不改变资金状态并要求微信重试。 | ✅ 已修复 |
| WMW05 | 小程序 `wx.requestMerchantTransfer` 返回 success 就错误标记到账 | 🔴 CRITICAL | `WAIT_USER_CONFIRM` 仅返回服务端签发的 `{mchId, appId, package}`，本地保持 PROCESSING；客户端调起结果不参与资金状态机。只有通过签名验证的微信 Provider 结果为 `SUCCESS` 才将冻结流水置为已提现；`FAIL/CANCELLED` 才 CAS 失败并退回一次，其余状态以及 unknown/404 均继续 PROCESSING。 | ✅ 已修复 |
| WMW06 | 重复申请、重复回调或 Cron 与回调竞态导致重复扣款/重复退回 | 🔴 CRITICAL | 沿用客户端幂等键唯一约束、统一钱包固定扣款顺序、税费快照及 Serializable 事务；终态收口复用 `status=PROCESSING` 的 CAS，只有首个失败收口事务能恢复冻结余额。Cron 按 WithdrawChannel 分流，微信只查原单号；默认 unknown/404 永不自动退款，唯一例外是“同一原单已验签的创建 4xx 拒绝”且“已验签的原单 404”同时成立，此时可证明微信未创建付款单，CAS 失败收口并退回冻结款。超时、5xx、验签失败或其他不确定响应始终保持 PROCESSING。 | ✅ 已修复 |
| WMW07 | Provider 创建调用已到达微信但本地进程中断，恢复任务直接重建或退款造成重复出款 | 🔴 CRITICAL | `CREATING` 持久化两分钟租约；超租约恢复者先用当前 `providerStatus` 做 CAS 抢占 `RECOVERY_CANCEL_CLAIMED`，再撤销原 `outBillNo`。ACCEPTED/PROCESSING 仅以同单号有限重试，达到阈值先撤销并告警，绝不换业务单号 | ✅ 已修复 |
| WMW08 | 微信终态回调处理失败或单条毒消息反复占队，导致回调丢失/后续提现无法收口 | 🔴 HIGH | 验签后的加密通知先按 `eventId` 幂等写入 inbox 并快速 204；消费者按 `nextAttemptAt` 指数退避，单事件 CAS 抢占，8 次失败转 DEAD 并通知管理员，查询按可执行时间排序避免队首饥饿 | ✅ 已修复 |
| WMW09 | 支付宝历史提现主动查单只看 SUCCESS，不核对原商户单号、金额和支付宝资金单号，可能串单收口 | 🔴 CRITICAL | Alipay 查询适配器同时返回 camel/snake case 的 `outBizNo/transAmount/orderId/fundOrderId`；人工与 Cron 收口必须核对原 `outBizNo`、金额和成功资金单号，未知标识只写脱敏日志且不改变资金状态 | ✅ 已修复 |
| WMW10 | 为让微信回调绕开限流而完全跳过 Throttler，攻击流量可耗尽验签/解密资源 | 🔴 HIGH | 微信商家转账回调保留独立 600 次/分钟的 IP 与用户桶，不复用普通业务低限额，也不设置 skip；只有验签、解密、持久化成功后才快速确认 | ✅ 已修复 |
| WMW11 | 小程序只在页面限制提现额度，用户可构造请求或并发提交，突破微信单笔/用户日/商户日限额，或冻结余额后才发现额度不足 | 🔴 CRITICAL | 后端对实际转账金额强制微信 ¥0.10–¥200 规则，并按当前税费逐分推导税前申请最低额（现行 20% 税为 ¥0.12）、固定上限 ¥200；微信通道不叠加 App/支付宝每天 3 笔限制，避免挡住微信金额日额。系统在同一 Serializable 事务、余额冻结之前，按中国自然日汇总 `WECHAT + PROCESSING/PAID` 的实际到账金额。用户级写入屏障先取得、全平台日额度再以固定 key advisory lock 串行裁决，拒绝时返回“请明日再提”；幂等重试只返回原申请，不随新规则重复扣款。 | ✅ 已修复 |
| WMW12 | 商户把“佣金报酬”(1005) 错配为未获批场景、伪造收款感知文案或缺少必填报备字段，转账发起后被微信拒绝并遗留冻结资金 | 🔴 HIGH | Provider 启用前校验 1005 仅有“岗位类型”“报酬说明”两条不同且非空的真实报备字段，收款感知只接受微信列举值；配置不完整/不合法时通道 fail-closed，先于任何钱包冻结拒绝。 | ✅ 已修复 |
| WMW13 | 用户关闭微信确认收款页后再次提交，可能重复冻结余额并创建另一笔商家转账；若直接复用旧 `package_info` 又不先查原单，则可能在终态订单上错误拉起确认 | 🔴 CRITICAL | 同一用户任一时刻只允许一笔 `WECHAT + PROCESSING` 提现，限制在 Serializable 创建事务内、冻结余额之前执行；历史页恢复入口只能操作当前用户、当前小程序会话的原提现，先主动查询同一 `out_bill_no`，只有原单仍为 `WAIT_USER_CONFIRM/TRANSFERING` 且保存了原 `package_info` 时才重新拉起，绝不再次调用创建转账；原单成功/失败/取消按幂等终态收口，未知结果保持处理中且禁止新申请。 | ✅ 已修复 |

---

## 2026-08-02 微信小程序平台能力与本地状态安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMPF01 | 一次性订阅授权被并发重复消费，或发送失败反向破坏订单/售后/提现状态 | 🔴 HIGH | consent 领取使用状态 CAS；业务通知只写 outbox，发送失败独立重试且不回滚内部状态；并发唯一冲突 `P2002` 与序列化冲突均按幂等成功/重试处理。授权语义明确为同模板最先发生的一次事件，不伪装成系统级永久授权。 | ✅ 已修复 |
| WMPF02 | 小程序码参数伪造、任意路由跳转、非 PNG 响应落盘或切换账号后展示旧码 | 🔴 HIGH | scene 只保存服务端随机 token，目标 path 在写库和调用微信前双重白名单校验；二进制响应要求 `image/png`、PNG 签名及 IEND；客户端保存前后都复核账号 revision/用户/generation，失效结果会删除。 | ✅ 已修复 |
| WMPF03 | 交易发货串用 App 交易、错误付款人或失败重试阻断卖家发货 | 🔴 CRITICAL | 只处理 `WECHAT_PAY + MINI_PROGRAM`，按 CheckoutSession 聚合同一支付的订单/包裹，使用支付 Provider 交易号与精确付款 OpenID；卖家/管理发货在原 Serializable 事务内只入 outbox，外部调用由租约 + CAS 异步执行，失败不回滚内部发货。 | ✅ 已修复 |
| WMPF04 | 任意第三方头像 URL 形成追踪/内容绕过，或账号切换后旧上传覆盖新账号 | 🟠 HIGH | 后端只接受 8 个精确预设值、当前合法历史头像或平台上传域名前缀；生产强制 HTTPS。客户端同时校验上传返回的协议、路径、MIME 和大小，上传/保存回调绑定当前账号 revision 与操作 generation。 | ✅ 已修复 |
| WMPF05 | 成长任务可仅凭公开任务 ID 自行领取，缺少真实行为凭证 | 🟡 MEDIUM | 对齐 App 当前隐藏入口，小程序不注册任务页面；共用后端 `TaskService.list()` 固定返回空列表，`complete()` 拒绝客户端自行声明完成。未来只有在服务端行为事件、幂等 `evidenceId` 和领取资格都确定后才能重新开放。 | ✅ 已安全关闭 |
| WMPF06 | 用户误以为一次订阅授权绑定当前具体订单/售后单 | 🟡 MEDIUM | 微信一次性模板授权当前没有业务对象绑定字段；小程序文案已明确“授权一次，提醒最先发生的一次对应事件”，售后页同时提示多个服务单场景。不对外声称精确绑定。若后续要求精确对象绑定，需要扩展 consent schema 和授权交互。 | ✅ 已披露边界 |
| WMPF07 | 管理端现有前端依赖包含 npm 安全公告 | 🟠 HIGH | `npm audit fix` 已在不跨主版本的范围内升级 lockfile，将生产依赖告警从 17 条降到 5 条，并升级 Axios、React Router 等可安全更新项；管理端生产构建通过。剩余为 Ant Design Pro 间接 `path-to-regexp` ReDoS 与 React Router RSC 模式公告：当前管理端是认证后的 Vite CSR、无 RSC/SSR 且路由模式为静态定义，实际暴露面低于公告通用评级。npm 只提供强制降级方案，本次不使用 `--force`；待上游发布兼容修复后独立升级回归。 | ⏳ 上游兼容修复待跟踪 |
| WMPF08 | 小程序 Taro 构建依赖包含 npm 安全公告 | 🟠 HIGH | `miniapp` 的 `npm audit --omit=dev` 当前报告 14 条上游公告（3 critical、1 high、10 moderate），高等级来源为 Taro 4.2.1 间接 `swiper`、Taro 自带开发服务器及 Vite 构建链。微信构建已确认把页面 Swiper 编译为原生 `<swiper>`，生产分包中不包含公告涉及的 Swiper JS；Vite/webpack-dev-server 仅用于本地构建且不得暴露公网。npm 给出的自动修复会降级 Taro 或升级到不兼容的构建主版本，Taro 4.2.1 又精确要求 webpack 5.91.0，因此禁止 `--force` 破坏锁定依赖；待 Taro 发布兼容版本后升级并重新跑全部小程序测试、双环境构建与生产产物检查。 | ⏳ 上游兼容修复待跟踪 |

## 2026-08-04 微信小程序全面审查安全补强

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|------|------|------|-----------|------|
| WMPA01 | 退出登录与 Token 刷新竞态使旧会话复活 | 🔴 HIGH | 小程序会话增加 logout generation；退出先同步清除凭据，刷新完成前后核对 generation，旧刷新结果不能重新写回；服务端撤销使用已旋转出的最后可信 refresh token。 | ✅ 已修复 |
| WMPA02 | 注销后仍可能通过红包、成长兑换或提现并发恢复资产 | 🔴 CRITICAL | 红包系统发放/领取、成长兑换和提现扣款统一接入用户 advisory transaction lock、事务内 ACTIVE 复核和必要的 Serializable/P2034 重试；注销先提交时后续写入 fail-closed。 | ✅ 已修复 |
| WMPA03 | 微信退款通知字段绑定不足或校验/收口分离导致串单与 TOCTOU | 🔴 CRITICAL | 售后、自动退款和退货运费退款统一验证商户退款单号、原支付单号、退款金额、原支付总额及已保存微信退款 ID；最终校验与状态更新在同一 Serializable 事务内，失败通知不触发库存、奖励或资金补偿。 | ✅ 已修复 |
| WMPA04 | 支付通知日志泄露完整 payload 或可关联业务标识 | 🔴 HIGH | 支付宝/微信通知日志移除完整请求对象，业务单号统一脱敏，不再记录不必要的原始金额和签名字段；增加负向泄露测试。 | ✅ 已修复 |
| WMPA05 | 钱包流水暴露内部来源流水 ID 和任意 meta | 🟡 MEDIUM | 服务端只公开 `orderNo/requiredLevel/expiresAt` 等白名单字段；移除顶层 `refId` 和 `sourceLedgerId`，App/小程序类型同步收紧。 | ✅ 已修复 |
| WMPA06 | `wechatpay-node-v3@2.2.1` 丢弃 APIv3 应答签名头，伪造的查单 `SUCCESS` 可能触发本地建单或资金状态转换 | 🔴 CRITICAL | 为 SDK 注入固定微信支付域名的安全传输层；请求显式携带微信支付公钥 ID，读取原始 body 后先校验 `Wechatpay-Serial/Timestamp/Nonce/Signature`、5 分钟时间窗与 RSA-SHA256，再允许 JSON 映射；SIGNTEST 也必须经过同一验签并失败；缺头、错误公钥、伪造签名、超时与重定向全部 fail-closed。 | ✅ 已修复 |
| WMPA07 | 微信关单 SDK 未初始化、商户单号非法或未知 200 响应被误当作远端未支付终态，导致本地过期/取消已支付单 | 🔴 CRITICAL | SDK 不可用和参数非法统一返回 non-terminal；只接受官方定义的签名 `204 No Content`，并兼容 `ORDER_NOT_EXIST/ORDER_CLOSED` 两种官方错误码写法；未知 2xx、网络和验签错误继续阻断本地释放。 | ✅ 已修复 |
| WMPA08 | 提现补偿固定取最早 20 条导致后续记录饿死，人工查单又可能与 Cron 并发访问同一转账 | 🔴 HIGH | 新增 `nextReconcileAt` 与复合索引，按到期时间 nulls-first 公平取数，采用 10/20/40/80/160/240 分钟退避；Cron 用状态+到期 CAS 抢占，人工查单用 `lastQueriedAt` 版本 CAS 抢占；微信 UNKNOWN/NOT_FOUND 达阈值只幂等告警，资金继续冻结。 | ✅ 已修复 |
| WMPA09 | 微信交易发货 outbox 发送旧包裹快照，或把 `10060002/10060003` 错当远端已成功 | 🔴 HIGH | 每次远端发送前重新读取支付会话、当前订单和包裹；退款/取消 fail-closed，快照变化通过 generation+lease CAS 重建，发送前再验 payload hash；`10060002/10060003` 转人工失败，仅 `10060023` 保留远端已完成语义。 | ✅ 已修复 |
| WMPA10 | 无 `sessionId` 的历史买家 JWT 可借同用户任意活跃会话继续访问，设备退出不能精确失效 | 🟠 MEDIUM | 现行 access token 已全部由登录/刷新写入 `sessionId` 且默认 15 分钟过期；买家 Strategy 不再按用户级会话降级放行，无 `sessionId` 直接 401，由 App/小程序现有 refresh 流程换取精确会话 Token。 | ✅ 已修复 |
| WMPA11 | SDK 解密 APIv3 回调未执行 GCM auth tag 校验，或支付回调地址/PEM/公钥 ID 配错后仍可创建预支付单 | 🔴 CRITICAL | 不再调用 SDK 的 `decipher_gcm`；本地以 `createDecipheriv`、AAD、auth tag 和 `decipher.final()` 完成认证解密，篡改 tag 的回归测试必须失败。支付启用前校验 APIv3 Key 长度、商户私钥/证书和微信支付公钥可解析为 RSA、公钥 ID 格式与显式 HTTPS 回调地址；生产环境出现部分或格式错误配置时拒绝启动，非生产关闭通道，且不再静默回落固定生产回调 URL。32 字节密钥是否与商户平台真实匹配仍由上线前真实小额回调联调验证。 | ✅ 已修复 |
| WMPA12 | 二次注册 `express.json()` 先消耗请求流，导致微信支付/退款回调缺少 rawBody、验签全部 401 | 🔴 CRITICAL | 请求体大小限制改为 Nest `app.useBodyParser()`，在保留 `rawBody: true` 的同时应用 limit；增加真实 HTTP JSON 请求回归测试，断言解析后 body 与用于 APIv3 RSA 验签的原始字节同时存在。 | ✅ 已修复 |
| WMPA13 | 微信真实 `NOTPAY/CLOSED` 查单应答会省略 `trade_type` 或 `amount`，后端误判无效导致会话无法关单或过期 | 🔴 CRITICAL | 主动查单始终校验签名、商户号、AppID 和商户订单号；`SUCCESS` 建单前仍必须校验金额、交易流水号与 `JSAPI/APP` 类型，`NOTPAY` 重试预下单前仍必须校验金额；只有已验签的非成功终态可在缺少 `trade_type/amount` 时按场景 AppID 关单释放，不得触发建单。 | ✅ 已修复 |

---

## 2026-08-03 配送批次顺丰履约安全与一致性检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|---|---|---|---|---|
| DSF01 | 企业中心重复点顺丰发货造成重复运单 | 🔴 HIGH | 按批次加 PostgreSQL advisory xact lock；`outsideOrderId` 使用批次 + attempt 稳定业务幂等号；`@@unique([batchId, attempt])` 和 `outsideOrderId @unique` 双重约束。已有生效运单时幂等返回，不再调顺丰。 | ✅ 已检查 |
| DSF02 | 顺丰下单成功但本地落库失败，形成远端孤儿单 | 🔴 HIGH | 本地落库失败会立即尝试撤销远端运单；撤销成功恢复为可重试，撤销不确定则进入 `MANUAL_INTERVENTION_REQUIRED` 并禁止自动重发。 | ✅ 已检查 |
| DSF03 | 进程在顺丰请求前后崩溃，批次永久卡在“下单中” | 🟠 MEDIUM | 创单预留 15 分钟后允许用原 `outsideOrderId` 恢复，不生成新的远端业务单号；前后端同步开放过期恢复操作。 | ✅ 已修复 |
| DSF04 | 顺丰回调与管理员主动同步并发，旧路由把已签收倒退为运输中 | 🔴 HIGH | 回调和同步共用同一批次 advisory lock；单运单和批次状态单调保护，`DELIVERED/COMPLETED` 不倒退；订单 `DELIVERED` 也不会被刷回 `SHIPPED`。 | ✅ 已修复 |
| DSF05 | 多运单批次在部分签收时提前增加已送达数量 | 🔴 HIGH | 只有全部 `DeliveryCarrierWaybill` 签收才将批次置为 `COMPLETED`；数量完成用批次明细 CAS，并在同一 `Serializable` 事务中增加 `pickedQuantity`、减少 `reservedPickupQuantity`；数据库 CHECK 防止超送。 | ✅ 已检查 |
| DSF06 | 顺丰面单被非所属商家下载，或多运单只打印第一张 | 🔴 HIGH | 企业端下载会校验 `DeliveryCarrierOrder -> batch.merchantId`所有权和 `orders:read`；数据库 URL 只用来缩小候选集，提取出的完整 `delivery/` key 必须与请求 key 精确相等，部分前缀不得当作归属证明；平台端使用受管理员 Guard 保护的按批次下载接口；云打印一次传入全部运单号，返回合并 PDF。 | ✅ 已修复 |
| DSF07 | 平台实际成本泄露给买家或企业配送中心 | 🔴 HIGH | 买家订单映射不查询/返回实际成本、差额和流水；企业端 `mapSellerBatchView` 在后端移除批次与承运单的所有报价/实际成本字段，并有回归断言。 | ✅ 已检查 |
| DSF08 | 前端隐藏按钮但接口或路由仍可越权操作 | 🔴 HIGH | 两个配送后台的路由与操作入口统一按权限守门；客服默认配置拆为 `delivery:customer-service:read/write` 专用 Controller，后端强制 scope 为 `CUSTOMER_SERVICE` 并拒绝写入非白名单 key，不能通过构造请求改其他平台配置。 | ✅ 已修复 |
| DSF09 | 登录恢复或刷新 token 后使用空/旧权限导致错菜单、错操作 | 🟠 HIGH | 配送管理后台和企业配送中心启动时先用 token 拉取权威账号资料；刷新 token 后同步内存和持久化 token。菜单、路由和按钮都以恢复后的最新权限过滤，避免只靠 localStorage 旧 profile 决策。 | ✅ 已修复 |
| DSF10 | 顺丰成本人工调整被记为手工承运商 | 🟠 HIGH | 审查发现人工调整顺丰月结成本时，流水 `provider` 原写为 `MANUAL`，会污染顺丰成本对账；同时 Schema 仍允许 `MANUAL_OFFLINE`。已将配送承运商枚举固定为 `SF`、付款方式固定为 `PLATFORM_MONTHLY`，人工调整只通过 `MANUAL_ADJUSTMENT` 流水类型表达，新增回归测试锁定。 | ✅ 已修复 |

---

## 2026-08-14 商城订单到店自提安全与一致性检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|---|---|---|---|---|
| PUF01 | 多商家结算伪造点位、归属或停用点，产生错误履约 | 🔴 HIGH | 后端按最终可结算 SKU 的权威 company 集合校验每商家恰好一个启用点；预览允许忽略已被剔除商家的 stale selection，最终会话只冻结服务端校验后的集合；结构化 `PICKUP_POINT_UNAVAILABLE/MISMATCH` 供客户端重载。 | ✅ 单元/契约通过 |
| PUF02 | 支付回调重读当前点位配置，点位支付后停用导致已扣款不建单 | 🔴 CRITICAL | 支付前校验并冻结 CheckoutSession 快照；支付成功只按冻结快照建单。之后停用只阻止新 checkout，既有订单进入受控履约/退款，不在支付回调抛错。 | ✅ 单元/契约通过 |
| PUF03 | 短码/token 明文落库、日志泄露或长期重放 | 🔴 HIGH | 安全随机源、HMAC digest、加密 credential blob、签名限时 QR；生产密钥缺失 fail-closed；常规响应/日志不含明文，买家读取事件也不保存凭证。 | ✅ 已检查 |
| PUF04 | 同一凭证并发核销两次，重复确认收货并重复分润/数字资产 | 🔴 CRITICAL | verify 使用 Serializable + 来源状态 CAS；输入严格 XOR，短码固定 8 位，二维码验签/过期/摘要比对；后续副作用用已有 claim/幂等键补偿。 | 🟡 mock 并发已测；真实 PostgreSQL 双连接竞态待验收 |
| PUF05 | 核销与 READY 后管理员取消竞态，出现既取货又退款 | 🔴 CRITICAL | 两条路径均事务内重读并 CAS；管理端仅允许 PREPARING/READY，并对整 CheckoutSession 逐单复核后一致取消、批量作废凭证。 | 🟡 状态单测通过；真实 PostgreSQL 竞态待验收 |
| PUF06 | 自提订单误进顺丰/微信物流/自动确认，或买家自行确认收货 | 🔴 HIGH | seller/admin 发货、面单、Shipment、微信物流 outbox、auto-confirm、地址编辑和 buyer receive 均显式拒绝 PICKUP；前端同步隐藏操作。 | ✅ 回归通过 |
| PUF07 | READY 异常取消只改订单，不回滚同次支付、退款或权益 | 🔴 CRITICAL | 管理端专用 `orders:refund` 入口要求原因/审计；整 session CAS 取消、批量作废凭证并复用现有退款、库存、红包、Reward、分润和数字资产回滚；首次及重复请求均逐单校验退款记录并返回状态。 | 🟡 单元通过；真实渠道部分 pending/cron 闭环待验收 |
| PUF08 | 自提人、点位联系人或审计原因泄露个人信息 | 🟠 HIGH | 自提人/点位电话加密，买家/卖家/管理员按最小权限脱敏；管理员点位启停审计保存脱敏 before/after/diff 和截断/脱敏原因。 | ✅ 已检查 |
| PUF09 | `PICKUP` 脏数据缺履约关联导致订单列表整页 500，或前端误显示为配送 | 🟠 MEDIUM | 三个后端 mapper 对单条异常返回 `fulfillmentIssueCode` 并告警；小程序/App/后台显示履约异常且禁止配送动作。 | ✅ 回归通过 |

## 2026-08-17 商品自动定价与配置变更安全检查

| 编号 | 风险 | 级别 | 修复/边界 | 状态 |
|---|---|---|---|---|
| APC01 | 修改加价率只改配置、不改 SKU，后台编辑预览与 App/结算真实售价分裂 | 🔴 HIGH | `MARKUP_RATE` 单项、批量和版本回滚统一先生成带数据指纹的影响预览；确认 token 未过期后，在利润安全 advisory lock + Serializable 事务内同时写配置、重算非平台非草稿 SKU，并同步 `Product.basePrice/cost`。 | ✅ staging 已验收 |
| APC02 | 审计日志单项回滚加价率绕过价格影响确认 | 🔴 HIGH | 禁止从通用审计日志回滚 `MARKUP_RATE`，必须进入平台设置版本历史，按目标版本加价率重新预览并同步商品价格。 | ✅ staging 已部署 |
| APC03 | 卖家创建读取 60 秒缓存或客户端 `basePrice`，管理端普通商品手填 `price`，平台员工又从卖家端覆盖奖励价 | 🔴 HIGH | 卖家创建与配置更新共用利润安全事务锁并直接读事务快照；普通商品 DTO 不再接受客户端 `basePrice/price`，管理端按成本自动计算并展示当前价/保存后价；平台公司所有卖家商品写入口 fail-closed，只能走独立奖励商品模块人工定价。 | ✅ staging 已部署 |
| APC04 | 删除最低价 SKU 前先汇总 `basePrice`，留下已停用规格的旧最低价 | 🟠 HIGH | SKU 更新先完成新增/更新与旧规格停用，再从剩余 ACTIVE SKU 汇总最低售价和最低成本。 | ✅ staging 已部署 |
| APC05 | 批量重算追溯覆盖历史订单或已创建付款会话 | 🔴 HIGH | 重算只修改商品与 SKU 当前价；`CheckoutSession.itemsSnapshot` 和 `OrderItem.unitPrice` 不变。旧会话在有效期内继续按锁价支付，新会话读取新价。管理端确认框明确披露。 | ✅ 边界已锁定 |
| APC06 | 一次性数据修复误触生产、预览与执行集合漂移或失败后留下半套价格 | 🔴 HIGH | `products:reprice` 默认 dry-run，逐 SKU 输出新旧价格、回滚 SQL 和 preview token；执行必须显式携带当前加价率与 dry-run token，在共享利润安全 lock 内重建同一集合并校验最终 SKU 经济数据，token 不一致即拒绝；MARKUP_RATE 缺失/非法一律 fail-closed。ACTIVE/INACTIVE SKU 一起重算，写后再次扫描必须为 0 不一致。 | ✅ staging 已执行并复验；生产未执行 |

> 2026-08-17 最终独立复核：Critical / High 均为 0；测试 PostgreSQL 已在 Serializable + advisory lock 下真实执行两条批量 SQL，并在同一会话强制 `ROLLBACK`，事务内不一致数为 0，数据库未保留变更。
