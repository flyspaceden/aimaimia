# tofix5.md — 平台红包（优惠券）系统问题清单与修复计划

> 基于 `redpocket.md` 设计文档的全面代码审查，涵盖后端逻辑、前后端对齐、并发安全、管理端功能。
> 审查日期：2026-03-05

---

## 问题总览

| 优先级 | 数量 | 说明 |
|--------|------|------|
| **P0 阻断** | 2 | 核心流程完全无法走通 |
| **P1 严重** | 10 | 功能缺失或数据错误 |
| **P2 中等** | 7 | 边界条件或一致性问题 |
| **P3 低** | 5 | 技术债务、命名规范 |

---

## 本轮修复进展（2026-03-05）

### 已完成

- ✅ P0-1：`CreateOrderDto` 支持 `couponInstanceIds`，`preview` 已纳入优惠券折扣并校验叠加规则
- ✅ P0-2：买家端 `CouponRepo` 路由修正为 `/coupons/available`、`/coupons/my`
- ✅ P1-1：Checkout 多商户折扣按容量分摊（奖励+优惠券）
- ✅ P1-2：新增 `reconcileReservedCoupons` 定时补偿任务（确认/释放）
- ✅ P1-3：`allowedFields` 补齐 `triggerType/distributionMode/discountType`
- ✅ P1-4：`seed.ts` 新增 `coupon:read` / `coupon:manage`
- ✅ P1-5：新增全局端点 `/admin/coupons/instances`、`/admin/coupons/usage`
- ✅ P1-6 + P2-7：统计字段与百分比展示对齐（`avgUsageRate/usageRate` 兼容）
- ✅ P1-7：CHECK_IN 统一使用 `triggerConfig.requiredDays`
- ✅ P1-8：锁定 CAS 增加 `expiresAt > now` 条件
- ✅ P1-9：`CheckoutSession.couponPerAmounts` 持久化逐张抵扣金额
- ✅ P1-10：`CheckoutSession.rewardId @map("redPackId")` 完成语义重命名
- ✅ P2-1：前端叠加规则与后端 `__default__` 分组一致
- ✅ P2-2：购物车补齐 `categoryId/companyId`（后端返回 + 前端类型）
- ✅ P2-3：`revokeInstance` 改为 `updateMany` CAS 保护
- ✅ P2-6：新增 `app/me/coupons.tsx`、`app/coupon-center.tsx`，并在「我的」页增加入口
- ✅ P3-1：`checkout-redpack.tsx` 已重命名为 `checkout-coupon.tsx`
- ✅ P3-2：补充迁移 `backend/prisma/migrations/20260305030000_sync_coupon_and_checkout_schema/migration.sql`
- ✅ P3-5：`BonusRepo.getNormalRewards` 路由改为 `/bonus/normal-rewards`

### 未完成（依赖业务模块）

- ⚠️ P2-5（降级）：已补齐统一事件入口；`SHARE` 已在推荐码分享接线，`REVIEW` 待真实评价模块调用

---

## 二次复核新增与纠正（2026-03-05）

### 对上轮反馈的核验结论

| 编号 | 结论 | 说明 |
|------|------|------|
| N1 `Order.totalCouponDiscount` 永远 NULL | ❌ 不成立 | 创建订单时已赋值 `totalCouponDiscount: groupCouponDiscount > 0 ? groupCouponDiscount : null` |
| N2 DTO 枚举字段仅 `@IsString()` | ✅ 成立 | `create/update/status` DTO 都缺少 `@IsEnum` / `@IsIn` |
| N3 `reconcileReservedCoupons` 5 分钟窗口 | ✅ 可优化 | 当前 5 分钟可用，但建议提升到 10 分钟降低边界竞态 |
| N4 `releaseCoupons` 部分释放无 warn | ✅ 成立（优化项） | 目前仅 `log` 释放数量，建议 `count < total` 增加 `warn` |
| N5 分摊浮点尾差 | ✅ 成立（低优先级） | 极端多商户+零头场景可能有 ±0.01~0.02 累积误差 |
| `allowedFields` 缺 `startAt/endAt` | ❌ 不成立 | `updateCampaign` 已在循环外单独处理 `startAt/endAt` |

### 本轮新增待修复问题

| 编号 | 严重性 | 问题 | 文件 |
|------|--------|------|------|
| N7 | **HIGH** | 奖励+优惠券并用时，`couponPerAmounts` 仍按“总商品金额”预留，支付建单按“奖励后剩余额度”分摊，可能导致 `CouponUsageRecord.discountAmount` 总和大于订单真实优惠券抵扣 | `backend/src/modules/order/checkout.service.ts` |
| N8 | **HIGH** | 新增 migration 是“整库差异拼盘”（含 `AuthProvider`、`RewardAccountType`、`ProductSKU.cost` 等历史项），在已有环境执行 `migrate deploy` 存在冲突/漂移风险 | `backend/prisma/migrations/20260305030000_sync_coupon_and_checkout_schema/migration.sql` |
| N9 | **MEDIUM** | `UpdateCampaignStatusDto.status` 仍仅 `@IsString()`，缺枚举值校验 | `backend/src/modules/coupon/dto/update-campaign.dto.ts` |
| N10 | **LOW** | `manualIssue` 前端 API 类型定义为 `{ issuedCount }`，后端实际返回 `{ issued, skipped, skippedUsers }`，存在契约不一致 | `admin/src/api/coupon.ts` / `backend/src/modules/coupon/coupon.service.ts` |

### 建议优先级（二次复核）

1. **先修 N7 + N8**（数据正确性 + 生产迁移安全）
2. 再修 **N2 + N9 + N4 + N3**
3. 最后处理 **N5 + N10**

---

## 三次修复进展（2026-03-05）

### 已完成

- ✅ N2/N9：`Create/Update/Status DTO` 枚举字段改为 `@IsEnum(...)` 严格校验
- ✅ N3：`reconcileReservedCoupons` 补偿窗口由 5 分钟提升到 10 分钟
- ✅ N4：`releaseCoupons` 在部分释放时新增 `warn` 日志
- ✅ N5：折扣分摊算法改为“分”为单位计算，降低浮点尾差风险
- ✅ N7：创建 `CheckoutSession` 时按“奖励后剩余额度”裁剪 `couponPerAmounts`，避免使用记录失真
- ✅ N8：迁移脚本重写为“仅 Coupon 相关 + 幂等 SQL”，移除整库拼盘风险
- ✅ N10：Admin `manualIssue` 前后端返回类型对齐（`issued/skipped/skippedUsers`）
- ✅ N8 补充验证：已在空 schema 与“重放末次迁移”场景执行 `prisma migrate deploy`，均通过

---

## 四次修复进展（2026-03-05）

### 已完成

- ✅ P2-5（后端）：新增 `POST /coupons/events/share`、`POST /coupons/events/review` 触发入口
- ✅ P2-5（防重）：新增 `CouponTriggerEvent` 事件日志表，按 `userId + triggerType + eventKey` 去重
- ✅ P2-5（分享接线）：`app/(tabs)/me.tsx` 与 `app/me/referral.tsx` 分享成功后上报 SHARE 事件
- ✅ 迁移验证：`20260305070000_add_coupon_trigger_event_log` 在空 schema 与重放末次迁移场景均通过

### 仍待业务模块接入

- ⚠️ REVIEW 当前通过 `/coupons/events/review` 提供标准入口，待后续真实“商品评价提交”模块调用

---

## 五次修复进展（2026-03-05）

### 已完成

- ✅ 补偿任务纳入 `PAID` 状态扫描，避免极端脏数据下 RESERVED 无法自动释放/确认
- ✅ 补偿确认增加二次裁剪，确保逐张红包金额总和不超过 `totalCouponDiscount`
- ✅ 新增复合索引：`CheckoutSession(status, createdAt)`、`CouponInstance(status, expiresAt)`
- ✅ 新增迁移 `20260305080000_add_checkout_coupon_compound_indexes` 并完成重放验证
- ✅ 奖励页去除 VIP 来源文案硬编码：新增 `sourceType` 字段并改为按稳定枚举判断
- ✅ 生日红包任务固定业务时区 `Asia/Shanghai`，并按业务时区提取月/日

### 仍待业务模块接入

- ⚠️ REVIEW 触发仍待真实“商品评价提交”流程调用 `/coupons/events/review`

---

## P0 — 阻断性问题

### P0-1: Preview 端点无法接收优惠券参数 → expectedTotal 校验必败

**状态**: 待修复
**文件**:
- `backend/src/modules/order/dto/create-order.dto.ts` — 缺少 `couponInstanceIds` 字段
- `backend/src/modules/order/order.controller.ts:53` — preview 使用 `CreateOrderDto`
- `backend/src/main.ts:60-89` — `forbidNonWhitelisted: true` 拒绝未知字段

**现象**: 前端在 preview 阶段传入 `couponInstanceIds` 会直接 400 报错（ValidationPipe 拦截未知字段）。即使绕过也无法计算优惠券折扣，导致 `expectedTotal` 不含优惠券金额，checkout 时触发 ¥0.01 容差校验失败。

**影响**: 选了优惠券的订单完全无法结算。

**修复方案**:
1. 给 `CreateOrderDto` 添加 `couponInstanceIds` 可选字段（与 `CheckoutDto` 一致）
2. `OrderService.previewOrder` 调用 `CouponService.getCheckoutEligible` 或 `calculateDiscount` 将优惠券折扣纳入 preview 返回值
3. 前端 `expectedTotal` 包含优惠券折扣后传给 checkout

---

### P0-2: 买家端 CouponRepo API 路径不匹配后端路由

**状态**: 待修复（当前用 mock 数据未暴露，切真实 API 后必现 404）
**文件**:
- `src/repos/CouponRepo.ts` — 注释第 5 行写 `/coupons/campaigns/available`，第 7 行写 `/coupons/mine`
- `backend/src/modules/coupon/coupon.controller.ts:19` — 实际路由 `GET /coupons/available`
- `backend/src/modules/coupon/coupon.controller.ts:25` — 实际路由 `GET /coupons/my`

**路径对照**:

| CouponRepo 调用路径 | 后端实际路径 | 状态 |
|---------------------|-------------|------|
| `/coupons/campaigns/available` | `/coupons/available` | 不匹配 |
| `/coupons/mine` | `/coupons/my` | 不匹配 |
| `/coupons/claim/:id` | `/coupons/claim/:campaignId` | 匹配 |
| `/coupons/checkout-eligible` | `/coupons/checkout-eligible` | 匹配 |

**修复方案**: CouponRepo 中将路径改为与后端一致。

---

## P1 — 严重问题

### P1-1: 多商户订单优惠券折扣全部分配给主订单

**状态**: 待修复
**文件**: `backend/src/modules/order/checkout.service.ts:505-507`

**代码**:
```ts
const expectedTotal = companyGroups.reduce((total, group, idx) => {
  const groupDiscount = idx === 0 ? totalDiscounts : 0;
  return total + Math.max(0, group.goodsAmount - groupDiscount + ...);
}, 0);
```

**现象**: 跨商户下单时，所有优惠券折扣（+ 奖励折扣）只分配给第一个商户的订单。其他商户订单不享受任何折扣。

**影响**: 利润分配失真，第一个商户承担了本不属于它的折扣。

**修复方案**: 按商户订单金额比例分摊折扣（或按优惠券适用范围精确分配到对应商户）。

---

### P1-2: RESERVED 优惠券无补偿机制 — 确认失败后永久锁定

**状态**: 待修复
**文件**: `backend/src/modules/order/checkout.service.ts:957-972`

**代码**:
```ts
} catch (couponErr: any) {
  // 红包确认失败不影响订单创建（已 RESERVED，后续可补偿）
  this.logger.error(`红包确认使用失败（需人工处理）：${couponErr.message}`);
}
```

**现象**: `confirmCouponUsage` 在事务外执行，失败后仅打 log，无重试队列、无定时补偿任务。RESERVED 状态的优惠券永远不会变为 USED 或 AVAILABLE。

**影响**: 用户优惠券被锁定无法再使用，也没有记录到使用记录中。

**修复方案**:
1. 添加 Redis 队列重试机制（失败后入队，最多重试 3 次，带指数退避）
2. 添加定时补偿扫描任务：查找 RESERVED 超过 N 分钟的实例，检查关联 session/order 状态决定确认或释放
3. checkout-expire 已有释放逻辑可复用

---

### P1-3: allowedFields 缺失核心字段 — 活动即使在 DRAFT 也无法编辑关键属性

**状态**: 待修复
**文件**: `backend/src/modules/coupon/coupon.service.ts:729-743`

**代码**:
```ts
const allowedFields = [
  'name', 'description', 'triggerConfig', 'discountValue',
  'maxDiscountAmount', 'minOrderAmount', 'applicableCategories',
  'applicableCompanyIds', 'stackable', 'stackGroup',
  'totalQuota', 'maxPerUser', 'validDays',
];
```

**缺失字段**: `discountType`, `triggerType`, `distributionMode`, `startAt`, `endAt`（注：`startAt`/`endAt` 在 L749 单独处理了，但前三个完全缺失）

**现象**: 管理员创建活动后无法修改折扣类型、触发类型和分发模式——即使活动仍在 DRAFT 状态。图片反馈指出这不只是 DRAFT 问题，而是所有状态都无法改。

**修复方案**: 将 `discountType`, `triggerType`, `distributionMode` 加入 `allowedFields`。可选：ACTIVE 状态下限制修改 `discountType`/`triggerType`（因为已发放的实例依赖这些字段）。

---

### P1-4: 管理端 coupon 权限未 seed — 所有优惠券管理端点 403

**状态**: 待修复
**文件**: `backend/prisma/seed.ts` — 无 `coupon:read`/`coupon:manage` 权限记录

**现象**: `AdminCouponController` 所有端点有 `@RequirePermission('coupon:read')` 或 `@RequirePermission('coupon:manage')` 保护，但 `AdminPermission` 表中无对应记录。非超级管理员角色永远 403。

**修复方案**: 在 seed.ts 中添加 coupon 权限记录：
```ts
{ code: 'coupon:read', name: '红包查看', module: 'coupon' },
{ code: 'coupon:manage', name: '红包管理', module: 'coupon' },
```

---

### P1-5: 管理端全局记录页面 404 — 后端无对应路由

**状态**: 待修复
**文件**:
- `admin/src/api/coupon.ts:195-200` — 前端调用 `GET /admin/coupons/instances` 和 `GET /admin/coupons/usage`
- `backend/src/modules/admin/coupon/admin-coupon.controller.ts:118-145` — 后端仅有按活动查询（`campaigns/:id/instances`、`campaigns/:id/usage`）

**现象**: 管理端"发放记录"和"使用记录"页面调用全局查询端点，但后端只实现了按活动维度的查询端点。页面加载即 404。

**注**: `redpocket.md` 设计文档内部存在冲突（API 节写按活动查，管理端页面节写全局查），需明确需求后决定方案。

**修复方案（建议）**: 在 `AdminCouponController` 新增两个全局查询端点：
```ts
@Get('instances')        // GET /admin/coupons/instances
@Get('usage')            // GET /admin/coupons/usage
```
对应 `CouponService` 新增全局查询方法（支持分页、状态/日期/活动筛选）。

---

### P1-6: 统计字段名不对齐 — 管理端统计页面数据异常

**状态**: 待修复
**文件**:
- `admin/src/api/coupon.ts:91` — 前端类型定义 `avgUsageRate: number`
- `admin/src/pages/coupons/stats.tsx:113` — 前端读取 `stats.avgUsageRate`
- `backend/src/modules/coupon/coupon.service.ts:1144` — 后端返回 `usageRate`（非 `avgUsageRate`）

**现象**: 前端读 `avgUsageRate` 得到 `undefined`，页面显示 NaN 或 0%。

**额外问题**: 前端 `CouponStats.dailyTrend` 只有 `date/issued/used`，后端还返回 `discountAmount` 但前端未使用（非阻断，但浪费数据）。前端还有 `campaignUsageRates` 和 `discountDistribution` 字段，需确认后端是否返回。

**修复方案**: 统一字段名。建议后端改为 `avgUsageRate`（因为是多活动的平均使用率），或前端改为 `usageRate`。同时对齐 `dailyTrend` 和其他子结构字段。

---

### P1-7: CHECK_IN 触发配置键名不匹配 — 签到红包永远发放

**状态**: 待修复
**文件**:
- `admin/src/pages/coupons/campaign-form.tsx:112` — 管理端写入 `triggerConfig.checkInDays`
- `backend/src/modules/coupon/coupon-engine.service.ts:469` — 引擎读取 `triggerConfig.requiredDays`

**代码对比**:
```ts
// 管理端写入
triggerConfig.checkInDays = values.triggerConfig_checkInDays;

// 引擎读取
const requiredDays = triggerConfig?.requiredDays;
```

**现象**: 引擎读 `requiredDays` 始终为 `undefined`，`checkTriggerConfig` 返回 `true`（L474: 无配置要求则默认通过），导致签到红包不论签到天数都会发放。

**修复方案**: 统一键名为 `requiredDays`（修改管理端表单），同时更新 `CUMULATIVE_SPEND` 和 `WIN_BACK` 的键名一致性检查。

---

### P1-8: 过期竞态 — validateAndReserveCoupons 的 CAS 未校验过期时间

**状态**: 待修复
**文件**:
- `backend/src/modules/coupon/coupon.service.ts:388` — 过期校验（读阶段）
- `backend/src/modules/coupon/coupon.service.ts:433-436` — CAS 更新（写阶段）

**代码**:
```ts
// L388: 读阶段校验过期
if (inst.expiresAt <= now) { throw ... }

// L433: CAS 写阶段只检查 status，不检查 expiresAt
const updateResult = await tx.couponInstance.updateMany({
  where: {
    id: { in: couponInstanceIds },
    status: 'AVAILABLE', // 缺少 expiresAt: { gt: now }
  },
  data: { status: 'RESERVED' },
});
```

**现象**: 读阶段（L388）和 CAS 写阶段（L433）之间存在时间窗口。如果优惠券在这期间过期，CAS 仍会成功锁定已过期的券（因为 status 仍为 AVAILABLE）。

**修复方案**: CAS 条件添加 `expiresAt: { gt: now }`：
```ts
where: {
  id: { in: couponInstanceIds },
  status: 'AVAILABLE',
  expiresAt: { gt: now },
}
```

---

### P1-9: 折扣记账丢失 — perCouponAmounts 未持久化，支付确认时重算为均分

**状态**: 待修复
**文件**:
- `backend/src/modules/order/checkout.service.ts:374` — 结算阶段 `couponReservation.perCouponAmounts` 正确计算了每张券的折扣
- `backend/src/modules/order/checkout.service.ts:534` — 仅存储 `couponInstanceIds` 和 `totalCouponDiscount` 到 session
- `backend/src/modules/order/checkout.service.ts:931-941` — 支付确认时用 `total / count` 均分重算

**现象**: `validateAndReserveCoupons` 根据每张券的折扣类型（FIXED/PERCENT）精确计算了 `perCouponAmounts`（L413-430），但 CheckoutSession 只存储了 `totalCouponDiscount`（L535），丢弃了逐张金额。支付确认时（L932）改用简单均分 `sessionCouponDiscount / length`，导致：
- FIXED ¥10 券和 PERCENT 20% 券（实际抵 ¥18）被均分为各 ¥14，使用记录金额失真
- 精度问题是附带后果，根因是逐张金额未持久化

**修复方案**:
1. CheckoutSession schema 新增 `couponPerAmounts Json?` 字段，存储 `perCouponAmounts` 数组
2. 支付确认时从 session 读取精确的逐张金额，不再重算

---

### P1-10: Phase D1 未完成 — CheckoutSession 旧字段 redPackId 仍承载分润奖励

**状态**: 待修复
**文件**:
- `backend/src/modules/order/checkout.dto.ts:50` — `rewardId` 字段（Reward 系统，设计如此）
- `backend/src/modules/order/checkout.service.ts:528` — `redPackId: reservedRewardId`（旧字段名存储新数据）
- `backend/prisma/schema.prisma:1132` — CheckoutSession.redPackId 字段

**现象**: 虽然分润奖励和平台红包是两套独立系统（设计正确），但 CheckoutSession 的 `redPackId` 字段实际存储的是 `reservedRewardId`（分润奖励 ID）。字段名与存储内容严重不符，不是纯粹的命名债务——它与 `couponInstanceIds`（真正的红包系统）在同一个 session 中共存，容易导致新开发者误将红包 ID 存入 `redPackId`。

**修复方案**: Schema 将 `redPackId` 重命名为 `rewardId`（带 `@map("redPackId")` 保持数据库列名兼容），同步更新 checkout.service.ts 和 checkout-expire.service.ts 中的引用。

---

## P2 — 中等问题

### P2-1: 前后端 stacking 规则不一致 — 前端允许的组合后端可能拒绝

**状态**: 待修复
**文件**:
- `backend/src/modules/coupon/coupon.service.ts:1291` — `stackGroup ?? '__default__'`（null 归入默认组）
- `app/checkout-redpack.tsx:282` — `if (!coupon.stackable && coupon.stackGroup)`（null stackGroup 跳过检查）

**现象**: 后端将 `stackGroup = null` 的不可叠加券归入 `__default__` 组互斥；前端对 `stackGroup = null` 的不可叠加券不做互斥校验。用户在前端选中的组合到 checkout 时被后端拒绝。

**修复方案**: 前端也对 null stackGroup 做 `'__default__'` 归组处理，保持两端逻辑一致。

---

### P2-2: CartItem 类型缺少 categoryId/companyId — TS 编译失败

**状态**: 待修复
**文件**:
- `src/store/useCartStore.ts:13-36` — CartItem 类型无 `categoryId`/`companyId`
- `app/checkout.tsx:71` — `item.categoryId` 访问不存在的属性
- `app/checkout.tsx:76` — `item.companyId` 访问不存在的属性

**现象**: TypeScript 编译报错，`categoryId`/`companyId` 在 CartItem 类型上不存在。这两个字段用于传给红包选择页筛选可用红包。

**修复方案**: 在 CartItem 类型中添加 `categoryId?: string` 和 `companyId?: string`，确保后端购物车接口返回商品的分类和商户信息，前端同步获取。

---

### P2-3: revokeInstance 无 CAS 保护 — 并发撤回风险

**状态**: 待修复
**文件**: `backend/src/modules/coupon/coupon.service.ts:1035-1056`

**代码**:
```ts
// 先查询状态
if (instance.status !== 'AVAILABLE') { throw ... }
// 直接更新，无 where 条件保护
await this.prisma.couponInstance.update({
  where: { id: instanceId },
  data: { status: 'REVOKED' },
});
```

**现象**: 查询和更新之间存在时间窗口，并发请求可能将 RESERVED/USED 状态的实例错误撤回。

**修复方案**: 使用 `updateMany` + `where: { id, status: 'AVAILABLE' }` 做 CAS 检查，或包裹在 Serializable 事务中。

---

### P2-4: 优惠券折扣按张均分精度丢失

**状态**: 待修复（被 P1-9 涵盖，P1-9 修复后此问题自动解决）
**文件**: `backend/src/modules/order/checkout.service.ts:932-941`

**现象**: 3 张券分 ¥10 → 每张 ¥3.33 → 总计 ¥9.99，丢失 ¥0.01。此问题是 P1-9（perCouponAmounts 未持久化）的附带后果。

**修复方案**: 随 P1-9 一起修复。如仍需均分场景，用尾差补偿法。

---

### P2-5: 自动发放缺触发接入 — INVITE/REVIEW/SHARE 未接线

**状态**: 部分完成（SHARE 已接线，REVIEW 提供标准入口待业务模块调用）
**文件**:
- `backend/src/modules/coupon/coupon.controller.ts` — 新增 `/coupons/events/share`、`/coupons/events/review`
- `backend/src/modules/coupon/coupon.service.ts` — 新增触发事件去重写入 + REVIEW/SHARE 触发逻辑
- `backend/prisma/schema.prisma` — 新增 `CouponTriggerEvent` 去重日志模型
- `app/(tabs)/me.tsx`、`app/me/referral.tsx` — 推荐码分享成功后上报 SHARE 事件

**现状**:
- INVITE：已在推荐关系绑定流程触发
- SHARE：已在前端分享动作接线，后端按 `userId + triggerType + eventKey` 去重触发
- REVIEW：后端已提供标准触发入口并校验订单归属/状态（`RECEIVED`），待“真实评价提交”模块调用

**剩余动作**:
- 在后续评价模块（如 `ReviewService.createReview`）落地后，调用 `/coupons/events/review` 完成最终接线

---

### P2-6: E6/E7 仍缺 — "我的红包"页读 Bonus 体系，领取入口未落地

**状态**: 待修复
**文件**:
- `app/me/rewards.tsx:218` — 调用 `BonusRepo.getAvailableRewards()`（Reward 体系，非 Coupon）
- `app/me/rewards.tsx:224` — 调用 `BonusRepo.getNormalRewards()`（同上）
- `src/repos/CouponRepo.ts:168` — `getAvailableCampaigns` 方法已实现但无页面调用

**现象**: 按 `redpocket.md` 设计，E6 应新建"我的红包"页面调用 `CouponRepo.getMyCoupons` 展示用户持有的优惠券；E7 应新建"领取红包"页面/入口调用 `CouponRepo.getAvailableCampaigns`。当前 `rewards.tsx` 只展示分润奖励（Bonus 体系），优惠券系统在买家端无独立入口。

**修复方案**: 新建 `app/me/coupons.tsx`（我的优惠券）和 `app/coupon-center.tsx`（红包领取中心），分别调用 CouponRepo 对应方法。

---

### P2-7: 统计页 usageRate 双重乘百 — 显示值膨胀 100 倍

**状态**: 待修复
**文件**:
- `backend/src/modules/coupon/coupon.service.ts:1144` — `usageRate: Math.round(usageRate * 10000) / 100`（返回百分比，如 85.00）
- `admin/src/pages/coupons/stats.tsx:113` — `Math.round(stats.avgUsageRate * 100)`（又乘 100）

**现象**: 后端返回 `usageRate = 85.00`（已是百分比），前端再 `* 100` → 显示 8500%。这是 P1-6 字段名不匹配之外的另一个独立问题——即使统一字段名，数值语义也不对齐。

**修复方案**: 明确约定：后端返回 0~1 之间的小数（如 0.85），前端负责乘 100 显示百分比。或者后端返回百分比，前端直接显示。需统一一端。

---

## P3 — 技术债务

### P3-1: Phase A0 重命名未彻底

**状态**: 待清理
**文件**:
- `backend/prisma/schema.prisma:1132` — CheckoutSession 仍有 `redPackId`
- `backend/prisma/schema.prisma:1136` — CheckoutSession 仍有 `discountAmount`
- `backend/src/modules/order/checkout.service.ts:528` — 仍使用 `redPackId`
- `backend/src/modules/order/checkout-expire.service.ts:35` — select 包含 `redPackId`
- `app/checkout-redpack.tsx` — 文件名仍为 redpack（实际功能是优惠券选择）

**影响**: 不影响运行时功能，但增加维护混乱度。

**修复方案**: 全量搜索 `redPack`/`red_pack` 相关标识符，统一为 `reward`（分润奖励场景）或移除（已废弃场景）。文件名 `checkout-redpack.tsx` 改为 `checkout-coupon.tsx`。

---

### P3-2: Migration 文件包含旧枚举/默认值 — 正式环境迁移会漂移

**状态**: 待处理
**文件**:
- `backend/prisma/migrations/20260228041229_init/migration.sql` — 初始迁移
- `backend/prisma/migrations/20260228100000_add_withdraw_request_account_type/migration.sql` — 增量迁移

**现象**: 开发环境通过 `prisma db push` 手动同步了 schema（包括新增的 5 个 coupon 枚举 + 3 个模型），但 migration 文件未包含这些变更。正式环境执行 `prisma migrate deploy` 时不会创建 coupon 相关表和枚举。

**修复方案**: 生成正式 migration 文件：`npx prisma migrate dev --name add_coupon_system`，确保所有 coupon 相关 DDL 被正确记录。

---

### P3-3: CouponRepo 仍使用完整 Mock 数据

**状态**: 待替换
**文件**: `src/repos/CouponRepo.ts:26-149` — 大量 mock 数据

**影响**: 买家端红包功能完全依赖 mock，切换真实 API 后需要修正路径（见 P0-2）并移除 mock 逻辑。

**修复方案**: 配合 P0-2 修复路径后，确保 `USE_MOCK === false` 时走真实 API。Mock 数据可保留作为开发回退。

---

### P3-4: Admin 前端 TS 未使用变量 — 构建警告

**状态**: 待清理
**文件**:
- `admin/src/pages/coupons/campaign-form.tsx:1` — `import { useEffect }` 已导入但未使用
- `admin/src/pages/lottery/index.tsx` — 可能存在未使用变量（需 `tsc --noEmit` 验证）

**影响**: TS 严格模式下产生编译警告，CI 可能因 `noUnusedLocals` 配置失败。

**修复方案**: 移除未使用的 import/变量。

---

### P3-5: BonusRepo 普通奖励路径不对齐（A0 相关遗留）

**状态**: 待修复
**文件**:
- `src/repos/BonusRepo.ts:167` — 调用 `/bonus/wallet/normal-rewards`
- `backend/src/modules/bonus/bonus.controller.ts:102` — 实际路由 `@Get('normal-rewards')` → `/bonus/normal-rewards`

**现象**: 前端多了 `/wallet/` 路径段，真实 API 会 404。当前用 mock 未暴露。

**修复方案**: BonusRepo 路径改为 `/bonus/normal-rewards`。

---

## 修复执行顺序

### 第一批（阻断修复，优先级最高）
1. **P0-1** — CreateOrderDto 添加 couponInstanceIds + preview 计算优惠券折扣
2. **P0-2** — CouponRepo 路径修正
3. **P1-4** — seed 添加 coupon 权限
4. **P1-7** — CHECK_IN 配置键名统一

### 第二批（数据正确性与安全）
5. **P1-8** — CAS 补充 expiresAt 校验（防止锁定过期券）
6. **P1-9** — perCouponAmounts 持久化到 session（同时修复 P2-4 均分精度）
7. **P1-1** — 多商户折扣分摊
8. **P1-2** — RESERVED 补偿机制

### 第三批（功能完整性）
9. **P1-3** — allowedFields 补充缺失字段
10. **P1-5** — 管理端全局记录端点
11. **P1-6** + **P2-7** — 统计字段名对齐 + usageRate 语义统一
12. **P2-2** — CartItem 类型补充 categoryId/companyId

### 第四批（一致性与前端补齐）
13. **P1-10** — CheckoutSession redPackId → rewardId 重命名
14. **P2-1** — stacking 规则前后端一致
15. **P2-3** — revokeInstance CAS 保护
16. **P2-5** — INVITE/REVIEW/SHARE 触发接入（依赖对应模块）
17. **P2-6** — 买家端"我的红包"+"领取中心"页面

### 第五批（技术债务清理）
18. **P3-1** — Phase A0 重命名完成
19. **P3-2** — Migration 文件生成
20. **P3-3** — CouponRepo mock 清理
21. **P3-4** — Admin TS 未使用变量清理
22. **P3-5** — BonusRepo 路径修正

---

## 附：与 redpocket.md 各 Phase 完成度评估

| Phase | 设计内容 | 完成度 | 说明 |
|-------|---------|--------|------|
| A0 重命名 | 全局 redPack→reward 统一 | ~80% | Schema 枚举已改，但 CheckoutSession.redPackId 未改、checkout-redpack.tsx 未改名、BonusRepo 路径也有遗留 |
| B 数据模型 | 5 枚举 + 3 模型 | ~95% | Schema 完整，但缺 `couponPerAmounts` 持久化字段 |
| C 后端服务 | CouponService + CouponEngine | ~85% | allowedFields 缺失、revokeInstance 无 CAS、CHECK_IN 键名错、CAS 缺 expiresAt、INVITE/REVIEW/SHARE 未接线 |
| D 结算集成 | CheckoutService 红包锁定/确认/释放 | ~70% | preview 不支持优惠券、多商户分摊错误、perCouponAmounts 未持久化、补偿机制缺失 |
| E 买家端 | CouponRepo + 红包选择页 + 结算页 | ~65% | API 路径错、CartItem 缺字段、stacking 不一致、E6/E7 页面未建、rewards 页读 Bonus 体系 |
| F 管理端 | AdminCouponController + 4 页面 | ~75% | 权限未 seed、全局端点缺失、统计字段+数值双重错误、配置键名不匹配、TS 构建警告 |
| G 测试 | 集成测试 + 文档更新 | ~60% | 部分测试完成，migration 未生成，文档部分更新 |
