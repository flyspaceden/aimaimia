# L14 平台红包（优惠券）链路审查

**审查档位**：💰 A 档深审
**审查日期**：2026-04-11
**审查范围**：平台红包（Coupon）独立体系，与分润奖励（Reward）完全隔离
**权威来源**：`docs/features/redpocket.md`、`docs/features/refund.md`
**审查员结论**：实现质量较高，核心数据模型/状态机/三态事务/CAS 锁基本完整；发现 1 个 Critical 账本缺口、3 个 High、5 个 Medium、3 个 Low。

---

## 一、模块总览

| 项目 | 路径 | 状态 |
|------|------|------|
| Schema 模型 | `backend/prisma/schema.prisma:508-551, 2195-2325` | 完整 |
| 后端 Service | `backend/src/modules/coupon/coupon.service.ts` (1541 行) | 完整 |
| 后端自动发放引擎 | `backend/src/modules/coupon/coupon-engine.service.ts` (601 行) | 完整 |
| 买家端控制器 | `backend/src/modules/coupon/coupon.controller.ts` | 完整 |
| 管理端控制器 | `backend/src/modules/admin/coupon/admin-coupon.controller.ts` | 完整 |
| 结算集成 | `backend/src/modules/order/checkout.service.ts:449-675, 1320-1452` | 完整 |
| 过期/补偿 | `backend/src/modules/order/checkout-expire.service.ts:80-195` | 完整 |
| 支付失败回滚 | `backend/src/modules/payment/payment.service.ts:316-322` | 完整 |
| 买家 App 路由 | `app/me/coupons.tsx`、`app/checkout-coupon.tsx` | 完整 |
| 前端 Repo | `src/repos/CouponRepo.ts` | 完整（含 Mock） |
| 管理端页面 | `admin/src/pages/coupons/` (campaigns/instances/usage/stats/form) | 完整 |
| 分润标识清理 | `RedPack`/`RED_PACKET` 全部替换为 `Reward`/`VIP_REWARD`/`NORMAL_REWARD` | 已完成 |

---

## 二、13 个关键验证点覆盖

### ✅ 1. 数据模型（`schema.prisma`）
- `CouponCampaign`（活动）/ `CouponInstance`（实例）/ `CouponUsageRecord`（流水）/ `CouponTriggerEvent`（触发去重日志）齐全。
- **注意**：任务描述中的 `CouponTriggerCondition` 并不存在。实际是 `CouponTriggerEvent`（`schema.prisma:2313`），用于 REVIEW/SHARE 事件去重（`@@unique([userId, triggerType, eventKey])`）。触发条件配置是 Campaign 上的 `triggerConfig Json?` 字段，非独立模型。
- `CouponInstance` 冗余快照 `discountType/discountValue/maxDiscountAmount/minOrderAmount`（避免活动修改后影响已发放红包），与 redpocket.md §3.2 一致。
- 索引：`[userId,status]` + `[status,expiresAt]` + `[expiresAt]` 覆盖查询路径。
- `@@unique([campaignId, userId, issuedAt])` 防并发重复发放。

### ✅ 2. 领取流程（自动发放 + 手动领取）
- **用户领取**：`coupon.service.ts:194 claimCoupon()` → `_claimCouponTx()` — Serializable + CAS（`where.issuedCount = campaign.issuedCount`）+ `maxPerUser` 校验 + `issuedCount/totalQuota` 配额校验 + P2034 重试 + P2002 冲突映射。
- **自动发放（AUTO）**：`coupon-engine.service.ts:59 handleTrigger()` → `issueWithRetry()` → `issueSingle()`（Serializable + CAS）；被 `auth/order/review` 等模块在业务事件后调用。
- **手动发放**：`coupon.service.ts:1118 manualIssue()` Serializable + 批量 createMany + CAS 递增 issuedCount；跳过已达 maxPerUser 用户。
- **SHARE/REVIEW 事件去重**：`coupon.service.ts:121/146` 通过 `CouponTriggerEvent` 唯一键写入并触发。

### ✅ 3. 红包展示三态（可用/已用/已过期）
- 买家端：`app/me/coupons.tsx:28-33` 四 Tab（全部/可用/已使用/已失效）。
- 后端：`coupon.service.ts:89 getMyCoupons()` 按 status 过滤。
- 状态枚举完整（`AVAILABLE/RESERVED/USED/EXPIRED/REVOKED`）。

### ✅ 4. 结算抵扣：多张红包叠加数学
- `coupon.service.ts:405 validateAndReserveCoupons()` — 在 Serializable 事务内逐张校验归属/状态/过期/门槛/品类，调用 `validateStackRules()` 校验 `stackGroup`（不可叠加则拒绝），逐张计算 `calculateDiscount()`（FIXED 直取，PERCENT 按比例 + maxDiscountAmount 封顶），累加时做 `totalDiscount + discount > orderAmount` 截断保护。
- **数学正确性**：PERCENT 以 `orderAmount` 为基数，每张独立计算，然后依序消耗剩余额度 — 这意味着 *先选的红包* 享受完整折扣，*后选的红包* 若已达订单上限则归零。前端 `app/checkout-coupon.tsx:322` 有同步的 UI 限制。

### ✅ 5. Serializable 事务 + 锁定
- 领取（`_claimCouponTx`）、锁定（`validateAndReserveCoupons`）、确认（`confirmCouponUsage`）、手动发放（`manualIssue`）、自动发放（`issueSingle`）**全部**使用 `Prisma.TransactionIsolationLevel.Serializable`。
- CAS 锁定：`updateMany({where:{id:{in:ids},status:'AVAILABLE',expiresAt:{gt:now}},data:{status:'RESERVED'}})` — 检查 `updateResult.count === couponInstanceIds.length`，不一致即 `ConflictException`。
- CAS 配额：`updateMany({where:{id,issuedCount:oldValue},data:{issuedCount:{increment:1}}})` — 乐观锁防超发。

### ✅ 6. CouponUsageRecord 流水
- `coupon.service.ts:537 confirmCouponUsage()` 在支付成功回调（checkout.service.ts:1422）后，Serializable 事务内：CAS `RESERVED → USED` + 写入 `CouponInstance.usedAt/usedOrderId/usedAmount` + 创建 `CouponUsageRecord`。
- 每张红包一条流水，`orderId` 指向"主订单"（多商户拆单时取 `createdOrderIds[0]`）。

### ✅ 7. 过期失效 Cron
- `coupon-engine.service.ts:253 expireCoupons()` `@Cron('0 * * * *')` — 每小时整点扫 `status=AVAILABLE && expiresAt < now` → 批量 `EXPIRED`。
- `endCampaigns()` `@Cron('30 * * * *')` — 每小时第 30 分扫 `status=ACTIVE && endAt < now` → 批量 `ENDED`。
- 生日 `@Cron('0 0 * * *')` + 复购 `@Cron('0 1 * * *')` 触发对应 campaign。

### ⚠️ 8. L7 退款场景下的红包归还（refund.md 规则 7）
**结论**：任务描述与 `refund.md` 存在语义冲突。**当前实现符合 refund.md 权威要求**：

- `docs/features/refund.md:156-159` 明确："**红包不退回** — 退货后已使用的红包不退回给用户；红包的 CouponInstance 状态保持 USED，不恢复为 AVAILABLE。"
- `docs/features/refund.md:140-154` 规则 7 的"按比例分摊"指的是 **买家的退款金额按比例扣除该商品分摊的红包优惠** — 即 buyer 无法通过部分退货拿回完整红包面值。
- `after-sale.utils.ts:77 calculateRefundAmount()` 实现：`refundAmount = itemAmount - couponShare`，其中 `couponShare = totalCouponDiscount × (itemAmount / orderGoodsAmount)`。**符合规则 7**。
- 全局搜索确认：**没有任何代码**重置 `CouponInstance.usedAt`/`status=USED→AVAILABLE`/`usedOrderId=null`。这是*预期行为*，非 bug。
- 对称性检查：每次 `USED` 均无对称 `归还`；每次 `EXPIRED` 在退款时不归还（永久失效）— 二者均符合 refund.md 的"红包不退回"设计。

> **需与用户确认**：审查任务中写的"红包按比例归还——重点！"与 refund.md §156 的"红包不退回"是矛盾的。若业务意图已变更（真要按比例归还 CouponInstance），需要同时补齐：①部分退款时计算"本张红包可归还面值"、②新增 `CouponInstanceStatus.PARTIALLY_USED` 或拆分实例、③更新 `CouponUsageRecord` 记录冲销、④重置 `usedAt/usedOrderId/usedAmount`。当前代码一样都没做，但这与 refund.md 一致。

### ✅ 9. 概念隔离（Reward vs Coupon）
- 全量扫描 `backend/src` 对 `RED_PACKET / NORMAL_RED_PACKET / VIP_REDPACK / NORMAL_REDPACK / RedPack` 的引用：**零命中**。Phase A0 重命名已完成。
- `coupon/` 目录中没有 `refund`/`withdraw`/`提现` 相关代码，Coupon 不可提现得到保证。
- `bonus/` 模块（Reward 体系）中搜索 `couponInstance`：**零命中**，Reward 不涉及抵扣 CouponInstance。
- 所有 coupon 服务头部注释均强调独立性（`coupon.service.ts:17`、`coupon-engine.service.ts:40`、`CouponRepo.ts:10`）。

### ✅ 10. 自动发放引擎（事件 → 发放）
- `handleTrigger()` 实现了 12 种 TriggerType 中 **8 种**（REGISTER/FIRST_ORDER/BIRTHDAY/CHECK_IN/INVITE/REVIEW/SHARE/CUMULATIVE_SPEND/WIN_BACK）。HOLIDAY/FLASH/MANUAL 由管理员或 cron 驱动。
- `checkTriggerConfig()` 对 CHECK_IN/CUMULATIVE_SPEND 做应用层校验；其他类型默认通过。
- `processWinBackCampaign()` 用 raw SQL 分页找沉默用户（`BATCH_SIZE=200`）。

### ✅ 11. 管理端红包活动 CRUD
- `admin-coupon.controller.ts` 10 个端点全部 `@RequirePermission('coupon:read'|'coupon:manage')` + `@AuditLog`。
- `createCampaign` 校验结束时间 > 开始时间、PERCENT 折扣值范围 (0,100]。
- `updateCampaign` 在 ACTIVE 状态限制敏感字段修改（discountType/discountValue/maxDiscountAmount/minOrderAmount/triggerType/distributionMode），`totalQuota` 只允许增加不能低于 `issuedCount`。
- `updateCampaignStatus` 实现状态机：DRAFT→ACTIVE、ACTIVE↔PAUSED、→ENDED（终态）。

### ✅ 12. 发放/使用记录查询
- `/admin/coupons/campaigns/:id/instances` + `/admin/coupons/instances` + `/admin/coupons/campaigns/:id/usage` + `/admin/coupons/usage` 四端点完整，支持分页+筛选。
- `revokeInstance` 仅限 `AVAILABLE` 状态。

### ✅ 13. 数据统计 Dashboard
- `getStats()` 返回 KPI + 近 7 天每日发放/使用/抵扣趋势（`dailyMap` 补齐空日期）。
- `getCampaignStats(campaignId)` 返回单活动各状态分布 + 总抵扣 + 使用率 + 平均抵扣。
- 管理端 `admin/src/pages/coupons/stats.tsx` 存在。

---

## 三、💰 账本完整性检查

| 检查项 | 状态 | 证据 |
|------|------|------|
| 结算抵扣 = CheckoutSession 金额 - coupon 抵扣 | ✅ | `checkout.service.ts:582-586` `expectedTotal = totalGoodsForShipping - vipDiscountAmount - totalGroupDiscount + totalShippingFee`（totalGroupDiscount 含 coupon） |
| `CouponInstance.usedAt` 在支付成功后标记 | ✅ | `coupon.service.ts:555-566` CAS `RESERVED→USED` 并写 `usedAt=now, usedOrderId, usedAmount` |
| `Order.totalCouponDiscount` 按商户分摊 | ✅ | `checkout.service.ts:1168-1191` 按 `allocateDiscountByCapacities` 分摊后写入子订单 |
| 会话过期/取消 → 释放 | ✅ | `checkout-expire.service.ts:260`、`payment.service.ts:316` |
| **退款归还 `usedAt=null` + `status=AVAILABLE`** | ❌ | **不归还**（与 refund.md §156 一致，与任务描述不一致，需用户确认） |
| 金额总和校验 | ✅ | `validateAndReserveCoupons` 内 `totalDiscount + discount > orderAmount` 截断；`capCouponPerAmounts` 防御性裁剪逐张金额 |

## 四、↩️ 对称性检查

| 行为 | 对称释放 | 状态 |
|------|----------|------|
| `AVAILABLE → RESERVED`（锁定） | `RESERVED → AVAILABLE`（releaseCoupons） | ✅ |
| `RESERVED → USED`（支付成功） | **无** `USED → AVAILABLE`（退款不归还） | ✅ 符合 refund.md |
| `AVAILABLE → EXPIRED`（cron） | 不需要 | ✅ |
| `AVAILABLE → REVOKED`（admin 撤回） | 不需要 | ✅ |
| 过期红包退款归还 | **不归还**（永久失效） | ✅ 符合设计 |

**不对称调用路径扫描**：
- `releaseCoupons` 调用点：`checkout.service.ts:656,672,997` + `checkout-expire.service.ts:183,262` + `payment.service.ts:318` — **所有**创建 RESERVED 状态的路径（成功/失败/过期/支付失败）都有对称释放。
- `confirmCouponUsage` 调用点：`checkout.service.ts:1426` + `checkout-expire.service.ts:169`（补偿路径，3 次重试）— 对称完整。

---

## 五、钱流时序图验证

```
领取/自动发放 → CouponInstance.AVAILABLE (issuedCount++)
              ↓
结算创建 Session → validateAndReserveCoupons (Serializable)
              → AVAILABLE → RESERVED (CAS)
              → Session.couponInstanceIds + totalCouponDiscount + couponPerAmounts
              ↓
  ├─ 支付成功 → confirmCouponUsage (Serializable)
  │           → RESERVED → USED (CAS)
  │           → usedAt / usedOrderId / usedAmount
  │           → CouponUsageRecord 写入
  │           → Order.totalCouponDiscount 按商户分摊
  │           ↓
  │     退货/换货 → after-sale 按比例扣除 couponShare 退款
  │                 → CouponInstance 保持 USED（符合 refund.md §156）
  │
  ├─ 支付失败 → payment.service:316 releaseCoupons → RESERVED → AVAILABLE
  └─ 会话过期 → checkout-expire:262 releaseCoupons → RESERVED → AVAILABLE
```

**钱流一致**（基于 refund.md 权威设计）。

---

## 六、问题清单

### 🔴 Critical（1）

#### C1. 审查任务与 refund.md 语义冲突 — 需业务确认
- **位置**：审查任务 vs `docs/features/refund.md:156-159`
- **现象**：任务写"**L7 退款场景下的红包按比例归还** — 重点！"，但 refund.md 权威文档明确"红包不退回，CouponInstance 保持 USED，不恢复为 AVAILABLE"。
- **代码实现**：与 refund.md 一致 — 没有任何路径重置 `CouponInstance.usedAt/status`。
- **影响**：若用户的业务真实意图是"按比例归还"，当前 Coupon/After-sale 模块均未实现，需要：
  1. 新增部分归还 API（计算本张红包可归还面值，或拆分实例）。
  2. 决定归还后 `status` 是否回 `AVAILABLE` 并续期 `expiresAt`（已过期如何处理？）。
  3. `CouponUsageRecord` 新增冲销流水，避免统计数据失真。
- **建议动作**：**必须先向用户确认** — 究竟是 refund.md 对、还是审查任务对，不要自行猜测修改。

### 🟠 High（3）

#### H1. `validateAndReserveCoupons` 对重复 ID 无幂等防御
- **位置**：`coupon.service.ts:423-443`
- **现象**：`findMany({where:{id:{in:couponInstanceIds}}})` 对重复 ID 返回去重的结果，而 `couponInstanceIds.length` 含重复，触发 `NotFoundException`，错误信息会把"已存在但重复传"的红包也列进 missing，对用户误导。
- **建议**：入口去重（`Array.from(new Set(couponInstanceIds))`）后再校验；或在 length 不一致时先计算 `missing = ids - foundIds`，`duplicates = ids - unique`，分别抛不同错误。
- **现状补充**：`order.service.ts:670` 有去重校验，但 `checkout.service.ts` 主路径似乎未去重后再调用 service，需验证。

#### H2. `claimCoupon` 把 P2002 误译为"已领取过"
- **位置**：`coupon.service.ts:211-216`
- **现象**：P2002 可能来自 `@@unique([campaignId, userId, issuedAt])`，极短时间内并发领取（同一 `issuedAt` 精确到毫秒）时被命中，但业务上其实允许 `maxPerUser > 1` 的多次领取。此时用"您已领取过该活动红包"文案具有误导性，用户可能还未达上限。
- **影响**：UI 误导 + 指标污染。
- **建议**：P2002 应映射为 `ConflictException('领取冲突，请重试')`，由前端自动重试，而不是报"已领取过"。

#### H3. `CheckoutSession.couponInstanceIds` 归属校验依赖内部传入
- **位置**：`checkout.service.ts:456-480` → `validateAndReserveCoupons`
- **现象**：`validateAndReserveCoupons` 内部有 `inst.userId !== userId` 校验（`coupon.service.ts:448`），但 `userId` 来自 `checkout.service.ts` 的当前用户上下文，依赖 checkout controller 正确注入。Coupon DTO 层（`checkout.dto.ts:76 couponInstanceIds`）本身无 ownership 校验。
- **影响**：当前依赖链路是安全的，但若 checkout.service 被其他入口调用并传错 userId，Coupon 可能被越权锁定。
- **建议**：在 `validateAndReserveCoupons` 方法签名文档中强调"调用者必须保证 userId 为当前登录用户"，或把 userId 改成从 `CurrentUser` 强制注入而非参数。

### 🟡 Medium（5）

#### M1. `getCheckoutEligible` 不过滤 `RESERVED` 状态
- **位置**：`coupon.service.ts:337-390`
- **现象**：查询 `status: 'AVAILABLE'`，但未显式排除 `RESERVED`。正常情况 `RESERVED` 不等于 `AVAILABLE`，所以不会错查，**实际是正确的**。问题是若用户在 Session 超时后重新进入结算页，原本被锁的红包可能刚被 `releaseCoupons` 释放，UX 上会"消失再出现"，需要前端刷新策略文档化。
- **建议**：文档化"结算页建议进入时 `invalidateQueries(['checkout-eligible-coupons'])`"。

#### M2. PERCENT 折扣的抵扣累加顺序敏感
- **位置**：`coupon.service.ts:489-500`
- **现象**：多张 PERCENT 红包按 `instances` 数组顺序依次算折扣，`totalDiscount + discount > orderAmount` 时截断后续。结果依赖传入顺序 — 两种顺序选择同样的红包组合可能得到不同总抵扣（尤其当两张 PERCENT 红包独立都能吃满订单的极端场景）。
- **建议**：按 `estimatedDiscount` 降序排序后再累加，或者设计层面禁止两张 PERCENT 叠加。目前 `stackable=false + stackGroup='PERCENT_MAIN'` 已可强制单选（`mockCheckoutEligible` 样例有体现），但需 Campaign 创建时规范化，避免运营误配。

#### M3. 订单级 coupon 分摊到多商户时未校验总和
- **位置**：`checkout.service.ts:1149-1191`
- **现象**：`allocateDiscountByCapacities` 做按剩余能力的分摊，但没有在外层 `assert(sum(groupCouponDiscount) === sessionCouponDiscount ± 0.01)`。极端场景（reward 分摊先吃满 capacity）可能导致 coupon 分摊总和 < session 总额，差额被静默丢失。
- **建议**：在 session→订单落盘前加 invariant 校验，失败抛异常回滚。

#### M4. `capCouponPerAmounts` 的防御性裁剪可能悄悄改写金额
- **位置**：`checkout.service.ts:1614-1646` + `checkout-expire.service.ts:279`
- **现象**：用 `Math.round((value + EPSILON) * 100)` 转分再截断，如果前序 `couponPerAmounts` 总和 > session 总额（因数据异常），直接按 FIFO 截断尾部。逻辑上安全，但当裁剪发生时虽有 warn 日志却没有告警/metric。
- **建议**：`this.logger.warn` 升级为 `this.logger.error` 或发送监控事件。

#### M5. `coupon-engine.service.ts` 的 CouponTriggerType 手写类型
- **位置**：`coupon-engine.service.ts:10-22`
- **现象**：注释说"当 Prisma Client 重新生成后可直接改为 import"，目前手写 union type。如果 schema 新增枚举值，这里容易漏改。
- **建议**：改为 `import type { CouponTriggerType } from '@prisma/client'`。

### 🔵 Low（3）

#### L1. `getStats.usageRate` 与 `avgUsageRate` 字段重复
- **位置**：`coupon.service.ts:1346-1347`
- **现象**：兼容旧字段两个同值字段并存。
- **建议**：下个版本删除 `usageRate`。

#### L2. `getInstances` 无 campaignId 过滤
- **位置**：`coupon.service.ts:997-1053`
- **现象**：仅支持 `status` + `userId` 过滤，不能按 `campaignId` 全局查询。
- **建议**：补上 `campaignId` 可选查询参数（`getCampaignInstances` 已有但仅限单活动路由）。

#### L3. 前端 mock 数据未覆盖 RESERVED / REVOKED 状态
- **位置**：`src/repos/CouponRepo.ts:64-107`
- **现象**：`mockMyCoupons` 仅有 AVAILABLE/USED，缺 EXPIRED/REVOKED/RESERVED 样例，前端三态 UI 在 USE_MOCK 下无法演示过期/失效。
- **建议**：补齐样例数据。

---

## 七、正面亮点

1. **Serializable 事务一致性**：所有涉及 `issuedCount`、`CouponInstance.status` 的写操作都在 Serializable 事务内 + CAS 乐观锁 + P2034 重试，防超发/防重复领取设计规范。
2. **快照解耦**：`CouponInstance` 冗余快照 `discountType/discountValue/maxDiscountAmount/minOrderAmount`，活动调整不会回溯影响已发放。
3. **触发事件去重**：`CouponTriggerEvent` 用 `@@unique([userId, triggerType, eventKey])` 去重 REVIEW/SHARE 触发，`eventKey` 设计合理（REVIEW 按 orderId，SHARE 按 day+scene+targetId）。
4. **补偿路径**：`checkout-expire.service.ts` 扫描 PAID/COMPLETED/FAILED/EXPIRED 中仍有 `RESERVED` 红包的会话，要么确认使用要么释放，3 次重试确认，RESERVED 不会泄漏。
5. **概念隔离严格执行**：所有 coupon 模块头部注释 + CouponRepo + 类型文件头部均强调独立性；后端全量搜索确认 Phase A0 重命名彻底。
6. **状态机完整**：DRAFT/ACTIVE/PAUSED/ENDED + AVAILABLE/RESERVED/USED/EXPIRED/REVOKED，合法转换均在 Service 层校验。
7. **管理端审计**：所有写操作均有 `@AuditLog` 装饰器 + 权限检查；`updateCampaign` 对 ACTIVE 状态敏感字段的锁定非常严谨。

---

## 八、给主 Agent 的建议动作

1. **立即动作**：向用户澄清 Critical C1（"退款按比例归还" vs "红包不退回"）— 不要改代码。
2. **修复 High**：H1（去重）、H2（P2002 文案）、H3（文档化 userId 传参约定）。
3. **Medium 可纳入下轮**：M1–M5 按优先级排期。
4. **Low 待定**：L1–L3 不阻塞。
5. **无需重构**：Schema、状态机、事务隔离、对称性、账本完整性均 **通过**。

**总体结论**：L14 平台红包系统实现质量高于本次审查的均值，核心风险点仅为业务语义确认（C1）和小范围幂等防御（H1–H2）。
