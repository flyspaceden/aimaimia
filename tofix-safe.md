# 爱买买 — 安全与并发一致性问题追踪

> 本文档记录所有时序安全、并发竞态、数据一致性相关问题及修复计划。
> 每次代码变更时必须对照检查，发现新问题需追加到本文档。

---

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

## 🟠 HIGH 问题（6 个）

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

### S12: 前端价格预览与实际下单不一致
- **状态**: ✅ 已修复（2026-02-24）
- **文件**: `app/checkout.tsx` + `src/repos/OrderRepo.ts` + `backend/src/modules/order/dto/create-order.dto.ts` + `backend/src/modules/order/order.service.ts`
- **问题**: `previewOrder` 展示的价格和 `createFromCart` 实际创建的价格之间没有锁定机制。商家在用户查看结算页时改价，用户看到 ¥100 但实际被收 ¥120。
- **修复内容**:
  1. `CreateOrderDto` 新增 `expectedTotal` 字段
  2. 前端提交订单时传入 `preview.summary.totalPayable` 作为 `expectedTotal`
  3. 后端 `createFromCart` 事务内先计算所有子订单实际合计，与 `expectedTotal` 比对
  4. 差异超过 ¥0.01 时拒绝下单，返回「价格已变更」错误提示新金额

---

## 🟡 MEDIUM 问题（8 个）

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

---

## 修复统计

| 级别 | 总数 | 已修复 | 未修复 |
|------|------|--------|--------|
| 🔴 CRITICAL | 6 | 6 | 0 |
| 🟠 HIGH | 6 | 6 | 0 |
| 🟡 MEDIUM | 8 | 8 | 0 |
| **合计** | **20** | **20** | **0** |

全部 20 个安全问题已修复完成（2026-02-25 复核后更新）。

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
