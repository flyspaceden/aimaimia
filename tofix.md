# 爱买买 - 问题清单与修复计划

> 创建时间：2026-02-16
> 来源：全系统审计（用户/分润/订单/企业/数据库/其他模块）
> 状态：**批次 1-5 全部修复完成** (2026-02-17)
>
> ### 修复摘要
> - **批次一（数据层）**：种子数据 8 项修复 + CHECK 约束 + 10 个索引 ✅
> - **批次二（订单系统）**：并发超卖保护、支付幂等、库存恢复、物流回调、自动过期 ✅
> - **批次三（分润系统）**：退款回滚 selfPurchaseCount + 队列失效、提现流水、空桶归平台、unlockedLevel、缓存失效 ✅
> - **批次四（安全）**：Booking 认证、Group 管理员守卫、封禁用户拦截、买家登出、签到重置环境检查 ✅
> - **P1-8（admin app-users 权限）**：审查后确认代码已有 @RequirePermission，无需修改 ✅
> - **批次五（代码质量）**：Trace 虚假字段清理、Follow N+1 批量查询优化、SMS/邮件速率限制、密码注册强制验证码、User gender/birthday 支持 ✅

---

## 目录

- [P0 必须修复（数据正确性/安全）](#p0-必须修复)
- [P1 建议修复（功能完整性）](#p1-建议修复)
- [P2 改进项（体验/性能）](#p2-改进项)
- [P3 已知限制（暂不修复）](#p3-已知限制)
- [种子数据问题](#种子数据问题)
- [修复计划](#修复计划)

---

## P0 必须修复

> 影响数据正确性、资金安全、系统安全，必须在联调前修复

### P0-1 并发超卖（订单系统）

**文件：** `backend/src/modules/order/order.service.ts:148-215`

**问题：** 库存检查（`item.quantity > sku.stock`）在事务外读取，事务内才扣减。两个并发请求都能通过检查，导致 `stock` 扣成负数。PostgreSQL 无 `CHECK(stock >= 0)` 约束。

**影响：** 超卖，库存为负数

**修复方案：**
- 方案 A（推荐）：给 `ProductSKU` 添加数据库级 CHECK 约束 `CHECK (stock >= 0)`，在事务内直接 `decrement`，catch 约束错误转为 `BadRequestException('库存不足')`
- 方案 B：在事务内用 `$queryRaw('SELECT ... FOR UPDATE')` 悲观锁

### P0-2 管理员取消订单不恢复库存

**文件：** `backend/src/modules/admin/orders/admin-orders.service.ts:170-194`

**问题：** 买家 `cancelOrder` 正确恢复库存 + 写 InventoryLedger，但 admin `cancel` 只更新状态，未恢复库存。

**影响：** Admin 取消订单后库存永久减少

**修复方案：** 复制买家 `cancelOrder` 中的库存恢复逻辑到 admin `cancel`（fetch items → increment stock → create RELEASE ledger）

### P0-3 退款回滚遗漏（分润系统）

**文件：** `backend/src/modules/bonus/engine/bonus-allocation.service.ts:rollbackForOrder`

**问题 A：** 退款时不回滚 `VipProgress.selfPurchaseCount`。VIP 用户退款后计数虚高，下一笔订单的 `effectiveIndex` 错误，奖励路由到错误祖先。

**问题 B：** 退款时不停用 `NormalQueueMember`（不设 `active=false`）。退款订单仍留在广播队列，后续订单仍会给退款用户发奖励。

**影响：** 分润金额分配错误

**修复方案：**
- 在 `rollbackForOrder` 中添加：
  ```
  1. 如果是 VIP 有效订单：VipProgress.selfPurchaseCount -= 1
  2. NormalQueueMember where orderId → update active=false
  ```

### P0-4 提现无流水记录（分润系统）

**文件：**
- `backend/src/modules/bonus/bonus.service.ts:requestWithdraw`
- `backend/src/modules/admin/bonus/admin-bonus.service.ts:approveWithdraw`

**问题：** 提现申请（balance → frozen）和审批（frozen 扣减）都没有创建 `RewardLedger` 记录。`RewardEntryType.WITHDRAW` 和 `RewardLedgerStatus.WITHDRAWN` 是死代码。

**影响：** 用户钱包流水页看不到提现记录，审计链断裂

**修复方案：**
- `requestWithdraw`：创建 RewardLedger（entryType=WITHDRAW, status=FROZEN, amount=提现金额）
- `approveWithdraw`：更新该 Ledger（status=WITHDRAWN）
- `rejectWithdraw`：更新该 Ledger（status=VOIDED）+ 退回 balance

### P0-5 预约审批接口无认证（Booking）

**文件：** `backend/src/modules/booking/booking.controller.ts`

**问题：**
- `POST /bookings/:id/review`（审批预约）**无任何认证守卫**
- `POST /bookings/:id/invite`（邀请加入团组）**无任何认证守卫**
- 任何未登录用户都能调用这两个接口

**影响：** 严重安全漏洞

**修复方案：** 这两个接口应移到 admin 模块或添加 `@UseGuards(AdminAuthGuard)` / 至少加上全局 JWT 守卫（去掉 `@Public()`）

### P0-6 种子数据不一致（多处）

**详见 [种子数据问题](#种子数据问题) 章节**

最关键：
- `sys-a1.childrenCount=2` 但只有 1 个子节点 → BFS 跳过空位
- o-002(PAID) 无 Payment 记录、o-003(SHIPPED) 无 Shipment 记录
- RewardLedger 用 `createMany` 非幂等 → 重跑创建重复流水

### P0-7 重复支付返回 500（订单系统）

**文件：** `backend/src/modules/order/order.service.ts:payOrder`

**问题：** 两个并发支付请求都能通过 `status !== 'PENDING_PAYMENT'` 检查，第二个触发 `Payment.merchantOrderNo` 唯一约束冲突 → Prisma P2002 → 返回 500

**影响：** 用户体验差，可能导致前端异常

**修复方案：** catch P2002 错误，转为 `BadRequestException('订单支付中，请勿重复提交')`

---

## P1 建议修复

> 影响功能完整性，建议在联调阶段修复

### P1-1 买家端无登出接口

**文件：** `backend/src/modules/auth/auth.controller.ts`

**问题：** 无 `POST /auth/logout` 端点。Admin 端有登出，买家端没有。Session 无法主动作废。

**修复方案：** 添加 `POST /auth/logout`，将当前 Session 标记为 REVOKED

### P1-2 DELIVERED 状态不可达

**文件：** 全局（无物流回调接口）

**问题：** `OrderStatus.DELIVERED` 在 Schema 和代码中被引用（自动确认、状态映射），但没有任何 API 能将订单从 SHIPPED 转为 DELIVERED。正常应由快递回调触发。

**修复方案：** 在 shipment 模块添加 `POST /shipment/callback` 存根接口（接收物流状态推送 → 更新 Shipment.status → 更新 Order.status → 创建 ShipmentTrackingEvent）

### P1-3 退款不恢复库存（PAID 状态）

**文件：** `order.service.ts:applyAfterSale` + `admin-orders.service.ts:refund`

**问题：** PAID→REFUNDED 时商品从未发出，但库存未恢复。库存永久被占用。

**修复方案：** 退款时如果原状态为 `PAID`（未发货），则恢复库存 + 写 InventoryLedger

### P1-4 未付款订单无自动过期

**问题：** PENDING_PAYMENT 订单永久占用库存，无超时取消机制。

**修复方案：** 参考 `order-auto-confirm.service.ts`，添加定时任务：每 5 分钟扫描 `status=PENDING_PAYMENT AND createdAt < now - 30min`，自动取消 + 恢复库存

### P1-5 空桶 rewardPool 静默丢失

**文件：** `backend/src/modules/bonus/engine/normal-broadcast.service.ts:58-61`

**问题：** 桶里第一笔订单无前序订单，rewardPool 既没给用户也没归入平台账户，直接消失。

**修复方案：** 当 `beneficiaries.length === 0` 时，将 rewardPool 加入平台 `PLATFORM_PROFIT` 账户

### P1-6 VipProgress.unlockedLevel 从未更新

**文件：** 所有 bonus/engine 服务

**问题：** Schema 有 `unlockedLevel` 字段，API 返回给前端，但引擎从未更新它。永远停留在种子初始值。

**修复方案：** 在 `vip-upstream.service.ts` 的 `unlockFrozenRewards` 中，同步更新 `VipProgress.unlockedLevel = newSelfPurchaseCount`

### P1-7 管理端改配置不清分润缓存

**文件：** `backend/src/modules/admin/config/admin-config.service.ts`

**问题：** Admin 修改 RuleConfig 后不调用 `BonusConfigService.invalidateCache()`，60 秒内仍用旧配置。

**修复方案：** 在 `AdminConfigService.update()` 末尾调用 `bonusConfigService.invalidateCache()`（需注入 BonusConfigService）

### P1-8 Admin app-users 端点缺权限装饰器

**文件：** `backend/src/modules/admin/app-users/admin-app-users.controller.ts`

**问题：** 所有端点缺 `@RequirePermission('users:read')` / `@RequirePermission('users:ban')`。任何 admin 角色都可访问。

**修复方案：** 给列表/详情加 `@RequirePermission('users:read')`，给封禁加 `@RequirePermission('users:ban')`

### P1-9 Group 端点权限缺失

**文件：** `backend/src/modules/group/` 相关控制器

**问题：** `POST /groups`（创建团组）和 `PATCH /groups/:id/status`（修改状态）任何买家都能调用，应限制为管理员。

**修复方案：** 将写操作移到 admin 模块，或在控制器上添加管理员守卫

### P1-10 封禁用户仍可访问 API

**文件：** `backend/src/modules/user/user.service.ts`

**问题：** `GET /me` 和所有需认证接口不检查 `user.status`。状态为 BANNED 的用户持有效 JWT 仍可正常使用。

**修复方案：** 在 `JwtStrategy.validate()` 或全局 Guard 中查 `user.status`，如果 BANNED 抛出 `ForbiddenException`

### P1-11 退款状态映射错误

**文件：** `backend/src/modules/order/order.service.ts:mapOrderDetail`

**问题：** `RefundStatus.REJECTED` 和 `FAILED` 都 fallback 为 `'applying'`，前端显示为"申请中"但实际已被拒绝。

**修复方案：** 添加 `REJECTED → 'rejected'` 和 `FAILED → 'failed'` 映射

---

## P2 改进项

> 体验和性能优化，可在后续迭代中修复

### P2-1 Trace 模块字段不存在

**文件：** `backend/src/modules/trace/trace.service.ts`

**问题：** `mapBatch()` 引用 `batch.productId`、`batch.stage`、`batch.status`、`ownershipClaim.verifiedAt`，这些字段在 Schema 中不存在。代码用 `||` fallback 不报错，但返回假数据（`null`/`'unknown'`/`'active'`）。

**修复方案：** 移除不存在的字段引用，从 `ProductTraceLink` 获取 `productId`，移除虚假的 `stage`/`status`

### P2-2 数据库缺索引

**影响性能的缺失索引（按优先级）：**

| 模型 | 缺失索引字段 |
|------|-------------|
| Payment | `orderId` |
| Refund | `orderId` |
| OrderStatusHistory | `orderId` |
| InboxMessage | `userId` |
| Booking | `userId`, `companyId` |
| Follow | `followedId` |
| CompanyActivity | `companyId` |
| CompanyDocument | `companyId` |
| LoginEvent | `userId` |
| OrderItemTraceLink | `orderItemId` |

**修复方案：** 在 schema.prisma 对应模型上添加 `@@index([fieldName])`

### P2-3 日期字段用 String 存储

**问题：**
- `Booking.date` — `String` 类型存 "2025-03-12"
- `Group.deadline` — `String` 类型存 "2025-03-10"
- `CheckIn.date` — `String` 类型存 "YYYY-MM-DD"

**修复方案：** 改为 `DateTime @db.Date`（需迁移数据）。**风险较大，建议在稳定版本后处理**

### P2-4 Schema 缺失 @relation 的裸字符串字段

| 字段 | 问题 |
|------|------|
| `Refund.paymentId` | 有字段无 @relation，无法 join |
| `OrderItem.companyId` | 注释为"冗余加速"，无 @relation |
| `MemberProfile.vipNodeId` | 应关联 VipTreeNode |
| `MemberProfile.inviterUserId` | 应关联 User |
| `Booking.activityId` | 应关联 CompanyActivity |
| `AdminAuditLog.rollbackOfLogId` | 自引用无 @relation |

**修复方案：** 添加 @relation 或明确注释为"非 FK 冗余字段"。部分添加 @relation 需要处理级联行为，需谨慎评估。

### P2-5 OrderStatusHistory 状态字段为 String

**问题：** `fromStatus` 和 `toStatus` 是 `String`，不是 `OrderStatus` 枚举，可存入非法值。

**修复方案：** 改为 `OrderStatus` 枚举类型（需迁移）

### P2-6 Follow N+1 查询

**文件：** `backend/src/modules/follow/follow.service.ts`

**问题：** `listFollowing()` 对每个 follow 串行调用 `buildAuthorProfile()`，每个调用内又有多次 DB 查询。

**修复方案：** 批量查询 + `Promise.all` 并行化

### P2-7 CheckIn reset 测试接口暴露

**文件：** `backend/src/modules/check-in/check-in.controller.ts`

**问题：** `POST /check-in/reset` 清除所有签到记录，是测试用途，暴露在生产路由。

**修复方案：** 添加环境判断 `if (process.env.NODE_ENV !== 'production')` 或移除

### P2-8 SMS/邮件验证码无速率限制

**文件：** `backend/src/modules/auth/auth.service.ts`

**问题：** `POST /auth/sms/code` 和 `/email/code` 无限流，可被恶意刷码。

**修复方案：** 使用 `@nestjs/throttler` 限制每个 IP / 每个手机号的请求频率

### P2-9 密码注册跳过手机验证

**文件：** `backend/src/modules/auth/auth.service.ts`

**问题：** `mode=password` 注册不验证 OTP，可冒领手机号。

**修复方案：** 注册时无论 mode 都要求先验证手机号（先发验证码，注册时携带）

### P2-10 User 无 gender/birthday 更新支持

**文件：** `backend/src/modules/user/dto/update-profile.dto.ts`

**修复方案：** 在 DTO 和 Service 中添加 `gender` 和 `birthday` 字段支持

---

## P3 已知限制（暂不修复）

> 设计决策或阶段性限制，记录但不在当前阶段修复

| 编号 | 内容 | 原因 |
|------|------|------|
| P3-1 | AI 模块全为 keyword stub | 等阶段五接入讯飞 |
| P3-2 | 支付为模拟实现 | 等阶段五接入微信/支付宝 |
| P3-3 | 提现实际打款为占位 | 等阶段五接入支付渠道 |
| P3-4 | WithdrawStatus.PAID/FAILED 不可达 | 依赖真实支付回调 |
| P3-5 | AllocationTriggerType.ORDER_PAID 死枚举 | 设计预留 |
| P3-6 | User 删除被 FK 阻止（无软删除字段） | 业务上用 status=BANNED 代替删除 |
| P3-7 | VipTreeNode 只种子 A1-A3 而非 A1-A10 | 演示够用，生产初始化脚本需补全 |
| P3-8 | 推荐码碰撞无重试（概率极低） | 32^8 ≈ 1T 组合 |
| P3-9 | `checkExit` 出局检查 O(n) 查询 | 实际几乎不触发（3^15 ≈ 1434 万） |
| P3-10 | 邮件 OTP 借用 SmsOtp.phone 字段 | 功能正确，语义不佳 |
| P3-11 | Admin 无创建/删除企业端点 | 企业入驻流程待设计 |
| P3-12 | Admin 无 SKU/Media 管理端点 | 商品编辑只改基本信息 |
| P3-13 | Admin 无 TraceEvent 管理端点 | 溯源事件批量导入待设计 |
| P3-14 | 买家无 CompanyDocument 查看接口 | 需求不明确 |
| P3-15 | Inbox 无分页、无删除 | 消息量小，暂不影响 |
| P3-16 | 无 ShipmentTrackingEvent 写入接口 | 依赖物流回调 |
| P3-17 | Category 未种子 | 暂无分类需求 |
| P3-18 | OwnershipClaim 无创建者记录 | 溯源模块待完善 |

---

## 种子数据问题

### SD-1 `sys-a1.childrenCount` 错误（🔴 必修）

**文件：** `backend/prisma/seed.ts` ~line 1040

**问题：** `childrenCount: i === 1 ? 2 : 0` 设置 A1 有 2 个子节点，但实际只创建了 1 个（`vip-node-u001`）。u-006 是 u-001 的子节点，不是 A1 的直接子节点。

**影响：** BFS 插入认为 A1 已有 2 子节点，新无推荐人 VIP 用户会跳过 A1 的一个空位。

**修复：** `childrenCount` 改为 `i === 1 ? 1 : 0`

### SD-2 o-002(PAID) 无 Payment 记录（🔴 必修）

**文件：** `backend/prisma/seed.ts`

**问题：** 订单 o-002 状态为 PAID 但无对应 Payment 记录。订单详情 API 返回 `paymentMethod: undefined`。

**修复：** 为 o-002 添加 Payment 种子数据（channel=WECHAT_PAY, status=PAID, paidAt）

### SD-3 o-003(SHIPPED) 无 Shipment 记录（🔴 必修）

**文件：** `backend/prisma/seed.ts`

**问题：** 订单 o-003 状态为 SHIPPED 但无 Shipment 记录。详情 API 返回 `trackingNo: null`。

**修复：** 为 o-003 添加 Shipment 种子数据（carrier, trackingNo, status=IN_TRANSIT, autoReceiveAt）

### SD-4 RewardLedger createMany 非幂等（🔴 必修）

**文件：** `backend/prisma/seed.ts`

**问题：** RewardLedger 用 `createMany({ skipDuplicates: true })`，但 RewardLedger 无 `@@unique` 约束，`skipDuplicates` 不生效。重跑种子会创建重复流水。

**修复：** 改为先 `deleteMany` 再 `createMany`，或给每条 Ledger 指定确定性 ID 然后用 upsert

### SD-5 u-002 余额与提现不一致（🟡 建议修）

**问题：** u-002 balance=15.20 但有一笔 10 元 APPROVED 提现。按业务流程：申请时 balance 15.20→5.20、frozen 0→10.00；审批时 frozen 10→0。余额应为 5.20。

**修复：** u-002 balance 改为 5.20

### SD-6 o-001 totalAmount 与商品合计不一致（🟢 低优先级）

**问题：** o-001 totalAmount=79.6，但 sku-p-001×2=39.6 + sku-p-002×2=25.0 = 64.6

**修复：** 调整 totalAmount 和 goodsAmount 为 64.6，或调整商品数量使合计匹配

### SD-7 o-003 productSnapshot 与实际商品不一致（🟢 低优先级）

**问题：** o-003 snapshot title='有机蓝莓一箱' 但 p-003 title='低温冷链蓝莓'；unitPrice=56.8 但 sku-p-003 price=58

**修复：** 统一 snapshot 与实际商品数据

### SD-8 Address/Cart 无种子数据（🟡 建议修）

**问题：** 演示用户无地址和购物车，首次打开这些页面是空白。

**修复：** 为 u-001 添加 1-2 条地址 + 1 个购物车（含 2 个商品）

---

## 修复计划

### 批次一：数据层修复（种子 + Schema 约束）

**目标：** 确保数据库数据正确、种子幂等可靠

| 序号 | 任务 | 涉及文件 | 对应问题 |
|------|------|----------|----------|
| 1.1 | 修复 sys-a1.childrenCount 为 1 | `seed.ts` | SD-1 |
| 1.2 | 为 o-002 添加 Payment 种子 | `seed.ts` | SD-2 |
| 1.3 | 为 o-003 添加 Shipment 种子 | `seed.ts` | SD-3 |
| 1.4 | 修复 RewardLedger 种子幂等性 | `seed.ts` | SD-4 |
| 1.5 | 修复 u-002 余额为 5.20 | `seed.ts` | SD-5 |
| 1.6 | 修复 o-001 totalAmount 为 64.6 | `seed.ts` | SD-6 |
| 1.7 | 修复 o-003 productSnapshot | `seed.ts` | SD-7 |
| 1.8 | 为 u-001 添加地址+购物车种子 | `seed.ts` | SD-8 |
| 1.9 | 添加 `ProductSKU` CHECK(stock >= 0) 约束 | `schema.prisma` 或 migration | P0-1 |
| 1.10 | 添加缺失的数据库索引（Payment.orderId 等） | `schema.prisma` | P2-2 |

**验证：** `npx prisma db push --force-reset && npx prisma db seed`（种子跑两遍确认幂等）

### 批次二：订单系统修复

**目标：** 修复订单全链路的数据完整性问题

| 序号 | 任务 | 涉及文件 | 对应问题 |
|------|------|----------|----------|
| 2.1 | 并发超卖 — catch stock CHECK 约束错误 | `order.service.ts` | P0-1 |
| 2.2 | Admin 取消恢复库存 | `admin-orders.service.ts` | P0-2 |
| 2.3 | 重复支付 catch P2002 | `order.service.ts` | P0-7 |
| 2.4 | PAID 退款恢复库存 | `order.service.ts` + `admin-orders.service.ts` | P1-3 |
| 2.5 | 退款状态映射修复 | `order.service.ts` | P1-11 |
| 2.6 | 物流回调 stub 接口 | `shipment.controller.ts` + `shipment.service.ts` | P1-2 |
| 2.7 | 未付款订单自动过期定时任务 | 新建 `order-expire.service.ts` | P1-4 |

**验证：** 重跑阶段三的 43 项 API 测试 + 新增并发测试

### 批次三：分润系统修复

**目标：** 修复分润计算和账本完整性

| 序号 | 任务 | 涉及文件 | 对应问题 |
|------|------|----------|----------|
| 3.1 | 退款回滚 selfPurchaseCount | `bonus-allocation.service.ts` | P0-3A |
| 3.2 | 退款停用 NormalQueueMember | `bonus-allocation.service.ts` | P0-3B |
| 3.3 | 提现创建 RewardLedger 记录 | `bonus.service.ts` + `admin-bonus.service.ts` | P0-4 |
| 3.4 | 空桶 rewardPool 归平台 | `normal-broadcast.service.ts` | P1-5 |
| 3.5 | 更新 VipProgress.unlockedLevel | `vip-upstream.service.ts` | P1-6 |
| 3.6 | Admin 改配置清缓存 | `admin-config.service.ts` | P1-7 |

**验证：** 干净数据库重跑分润全链路测试（创建→支付→确认→分润→退款→回滚）

### 批次四：安全修复

**目标：** 修复认证和权限漏洞

| 序号 | 任务 | 涉及文件 | 对应问题 |
|------|------|----------|----------|
| 4.1 | Booking review/invite 加守卫 | `booking.controller.ts` | P0-5 |
| 4.2 | Admin app-users 加权限装饰器 | `admin-app-users.controller.ts` | P1-8 |
| 4.3 | Group 写操作加权限控制 | `group.controller.ts` | P1-9 |
| 4.4 | 封禁用户拦截 | `jwt.strategy.ts` 或全局 Guard | P1-10 |
| 4.5 | 买家端登出接口 | `auth.controller.ts` + `auth.service.ts` | P1-1 |
| 4.6 | check-in/reset 加环境判断 | `check-in.controller.ts` | P2-7 |

**验证：** 用封禁用户 JWT 测试被拒、用无权限 admin 测试 403、Booking 无 token 测试 401

### 批次五：代码质量改进 ✅

**目标：** 提升代码质量，非阻塞

| 序号 | 任务 | 对应问题 | 状态 |
|------|------|----------|------|
| 5.1 | Trace mapBatch 移除不存在字段（productId/stage/status/verifiedAt） | P2-1 | ✅ |
| 5.2 | Follow 查询并行化（3N→3 次批量查询） | P2-6 | ✅ |
| 5.3 | SMS/邮件速率限制（@nestjs/throttler，1 req/min/IP） | P2-8 | ✅ |
| 5.4 | 密码注册强制手机/邮箱验证码 | P2-9 | ✅ |
| 5.5 | User 补 gender/birthday DTO + Service + 返回 | P2-10 | ✅ |

---

## 修复顺序总结

```
批次一（数据层）→ 批次二（订单）→ 批次三（分润）→ 批次四（安全）→ 批次五（可选）
     ↓                ↓                ↓                ↓
  种子+Schema      全链路修复       分润完整性        权限安全
  约 10 项          约 7 项          约 6 项          约 6 项
```

**预计修改文件清单：**

| 文件 | 修改内容 |
|------|----------|
| `backend/prisma/seed.ts` | SD-1 ~ SD-8（种子数据修复） |
| `backend/prisma/schema.prisma` | CHECK 约束 + 索引 |
| `backend/src/modules/order/order.service.ts` | P0-1, P0-7, P1-3, P1-11 |
| `backend/src/modules/admin/orders/admin-orders.service.ts` | P0-2, P1-3 |
| `backend/src/modules/bonus/engine/bonus-allocation.service.ts` | P0-3 |
| `backend/src/modules/bonus/bonus.service.ts` | P0-4 |
| `backend/src/modules/admin/bonus/admin-bonus.service.ts` | P0-4 |
| `backend/src/modules/bonus/engine/normal-broadcast.service.ts` | P1-5 |
| `backend/src/modules/bonus/engine/vip-upstream.service.ts` | P1-6 |
| `backend/src/modules/admin/config/admin-config.service.ts` | P1-7 |
| `backend/src/modules/booking/booking.controller.ts` | P0-5 |
| `backend/src/modules/admin/app-users/admin-app-users.controller.ts` | P1-8 |
| `backend/src/modules/group/` 控制器 | P1-9 |
| `backend/src/modules/auth/auth.controller.ts` + `auth.service.ts` | P1-1 |
| `backend/src/modules/auth/jwt.strategy.ts` 或全局 Guard | P1-10 |
| `backend/src/modules/shipment/` | P1-2 |
| 新建 `order-expire.service.ts` | P1-4 |
| `backend/src/modules/check-in/check-in.controller.ts` | P2-7 |
| `backend/src/modules/trace/trace.service.ts` | P2-1 |
