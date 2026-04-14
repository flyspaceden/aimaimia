# L7 — 统一售后（退/换货）链路 💰 A 档深审

> 审计日期：2026-04-11 | 审计范围：统一售后系统（AfterSaleRequest）全链路
> 权威规则：`docs/features/refund.md`（v1.0，23 条规则）
> 结论预览：架构已成型，状态机覆盖完备，但 **退款通道未接通**、**订单状态/库存/法币账本未落地**、**App 入口存在规则窗口硬编码与字段名不匹配 Bug**。核心"能退"链路差一根"真正划钱"的最后一英里。

---

## 🔑 三个必答问题

### Q1. `AfterSaleRequest` 模型是否已在 `schema.prisma`？

**✅ 已存在。** 位置 `backend/prisma/schema.prisma:2137-2185`（`@@map("after_sale_request")`）。
- 枚举 `AfterSaleType`（`NO_REASON_RETURN` / `QUALITY_RETURN` / `QUALITY_EXCHANGE`）位于 `schema.prisma:405-409`。
- 枚举 `AfterSaleStatus`（14 个状态，完整覆盖 refund.md 规则 16 状态机）位于 `schema.prisma:411-426`。
- 枚举 `ReturnPolicy`（`RETURNABLE` / `NON_RETURNABLE` / `INHERIT`）位于 `schema.prisma:428-432`。
- 字段覆盖：`afterSaleType` / `reasonType` / `reason` / `photos` / `status` / `isPostReplacement` / `arbitrationSource` / `requiresReturn` / 退货物流三件套 / 卖家拒收物流三件套 / `refundAmount` / `refundId` / `reviewerId` / `approvedAt` / `sellerReceivedAt` / 换货物流完整字段 / `createdAt` / `updatedAt`。
- 索引：`orderId`、`(userId, status)`、`(status, createdAt)` 三个索引已建。

**字段完整性：与 refund.md 对齐良好。** 没发现缺字段。

### Q2. `backend/src/modules/after-sale/` 目录是否存在？几个文件？完整度？

**✅ 存在，9 个文件 1886 行。** 结构：

```
backend/src/modules/after-sale/
├── after-sale.controller.ts        114 行   买家端 HTTP 控制器（10 个端点）
├── after-sale.service.ts           640 行   买家端业务逻辑（8 个 public 方法）
├── after-sale.module.ts             14 行   Nest 模块注册
├── after-sale.constants.ts          61 行   配置键/默认值/状态集合
├── after-sale.utils.ts             207 行   纯函数（退货政策解析、退款金额、窗口判定、配置读取）
├── after-sale-reward.service.ts    192 行   售后成功 → 奖励归平台（voidRewardsForOrder）
├── after-sale-timeout.service.ts   590 行   4 个 Cron 超时处理（每小时）
└── dto/
    ├── create-after-sale.dto.ts     53 行   申请 DTO
    └── return-shipping.dto.ts       15 行   物流回填 DTO
```

**扩展：卖家端与管理端独立成模块**
- `backend/src/modules/seller/after-sale/` — 3 文件 1508 行（卖家审核/拒收/发换货/触发退款/面单生成与打印）
- `backend/src/modules/admin/after-sale/` — 3 文件 620 行（管理员仲裁）

**完整度评估：架构完整，逻辑骨架齐全，但退款通道是 mock（见 💰 账本完整性段）。**

### Q3. 旧 `ReplacementRequest` 是否还被使用？迁移进度如何？

**✅ 已完全移除。** 旧目录 `backend/src/modules/replacement/` 和 `backend/src/modules/refund/` 均不存在。Schema 中：
- 无 `model ReplacementRequest`（已删除）
- `model Refund`（schema.prisma:1502-1523）**标注 `@deprecated`** 但保留用于历史数据查询；旧的 `RefundStatusHistory` / `RefundItem` 子模型仍保留。
- `VirtualCallBinding.replacement` 关系字段现在指向新的 `AfterSaleRequest`（schema.prisma:2389），关系名 `ReplacementVirtualCallBindings`（命名保留但语义已迁移）。

**⚠️ 新旧并存残留**（见 M 级问题 M1）：
- `backend/src/modules/seller/refunds/seller-refunds.module.ts` 仍在 `seller.module.ts:11,31` 注册
- `backend/src/modules/admin/refunds/admin-refunds.module.ts` 仍在 `admin.module.ts:19,48` 注册
- `admin-refunds.service.ts:354` 仍在调用 `rollbackForOrder` 的遗留逻辑，直接操作旧 `Refund` 表 + 直接 `UPDATE Order → REFUNDED`。新统一售后链路反而没有这块 Order 状态更新（!）。

**迁移结论：数据模型 100% 迁移，业务代码 ~80% 迁移 —— 旧 Refund 控制器仍在挂载，且旧代码是目前唯一真正把 Order 改成 REFUNDED 的路径。这是一个严重的"新链路未收口"问题。**

---

## 📋 refund.md 23 条规则逐条核对

图例：✅ 完成 / 🟡 部分 / ⬜ 未实现 / 🔴 错误实现
T1=最小可用（能申请+能退款+支付宝接通+分润回滚），T2=规则 100% 落地。

| # | 规则 | 状态 | 证据 file:line | 阻 T1 | 阻 T2 |
|---|------|-----|----|------|------|
| 1 | 退货窗口起算点（DELIVERED → 168h）| ✅ | `after-sale.utils.ts:137-171` `isWithinReturnWindow` 以 `deliveredAt` 优先、fallback `receivedAt`，精确到毫秒；shipment 侧 `shipment.service.ts:188,413` 写入 `deliveredAt` 并计算 `returnWindowExpiresAt`（:235,446） | — | — |
| 2 | 不可退商品两级判定（Category→Product, INHERIT）| ✅ | `after-sale.utils.ts:23-61` `resolveReturnPolicy` 实现 Product → Category 递归（防死循环 10 层）；兜底 `RETURNABLE` | — | — |
| 3 | 不可退商品质量问题仍可退 | ✅ | `after-sale.utils.ts:162-170` `returnPolicy === 'NON_RETURNABLE'` 且非无理由 → 走生鲜 24h 窗口 | — | — |
| 4 | 审核模式（卖家审核 + 平台仲裁）| ✅ | 卖家：`seller-after-sale.service.ts:377 approve`/`:457 reject`；平台仲裁：`admin-after-sale.service.ts:270 arbitrate` 支持 `PENDING_ARBITRATION/REQUESTED/UNDER_REVIEW` 源状态；升级：`after-sale.service.ts:477 escalate` | — | — |
| 5 | 价格阈值决定是否寄回 | ✅ | `after-sale.utils.ts:114-124` `requiresReturnShipping`：无理由强制寄回，质量问题按 `itemAmount > threshold` 判定；配置键 `RETURN_NO_SHIP_THRESHOLD` 默认 50（`constants.ts:31`） | — | — |
| 6 | 退款只退商品价格不退运费（整单质量问题例外）| ✅ | `after-sale.utils.ts:77-103` `calculateRefundAmount`：整单且非 `NO_REASON_RETURN` 才加回 `shippingFee`；`after-sale.service.ts:204-220` 判定 `isFullRefund`（所有非奖品项都有 REFUNDED 状态售后） | — | — |
| 7 | 平台红包按比例分摊 | ✅ | `after-sale.utils.ts:89-92` `couponShare = orderTotalCouponDiscount * (itemAmount / orderGoodsAmount)`；`order.totalCouponDiscount` 字段已存在（`schema.prisma:1338`）。红包不退回逻辑 = 不需要额外代码（CouponInstance 保持 USED）✓ | — | — |
| 8 | 七天无理由退货规则（RETURNABLE + 7 天内 + 强制寄回 + 买家自付运费 + 拍照）| 🟡 | 时窗+强制寄回已做；买家运费承担为业务语义默认不需要代码；**缺失**：不校验"商品完好"（依赖买家自述+照片）；**VIP_PACKAGE 订单**已拒绝（`service.ts:98`），**奖品 isPrize** 已拒绝（`service.ts:109`）；App 侧在 `availableTypes` 中将 `NO_REASON_RETURN` 按 `returnWindowExpiresAt` 正确过滤（`app/.../after-sale/[id].tsx:89-94`）✓ | — | — |
| 9 | 质量问题退货运费平台承担 | 🟡 | 业务语义由"到付"承载，App 文案 `shippingInfo = "运费到付（平台承担）"`（`[id].tsx:137`）；**但没有真正的到付记账/退款运费字段**，平台实际如何买单未实现，属 T2 | — | 是 |
| 10 | 生鲜商品特殊规则（24 小时）| ✅ | `after-sale.utils.ts:162-166` 使用 `FRESH_RETURN_HOURS`；默认值 24（`constants.ts:30`）；`AFTER_SALE_CONFIG_KEYS.FRESH_RETURN_HOURS` 可后台覆盖 | — | — |
| 11 | 非生鲜商品质量问题申报时限（可配置 ≤7 天）| 🟡 | 配置键 `NORMAL_RETURN_DAYS` 默认 7（`constants.ts:29`）生效；**缺失**：没有"≤7 天"校验 guard，管理员若配成 30 天不会报错 | — | 是 |
| 12 | 统一售后入口（三种类型 + 动态展示）| 🟡 | 后端 3 个类型枚举完整；App 侧 `availableTypes`（`[id].tsx:83-102`）**仅过滤 NO_REASON_RETURN**，`QUALITY_RETURN`/`QUALITY_EXCHANGE` 无条件展示，不走 utils.isWithinReturnWindow、不看 returnPolicy，也不看质量问题时限。后端会二次校验所以不会误退，但 UX 体验不符合规则 12 "如果所有选项都不可用→显示已超过期限" | — | 是 |
| 13 | 部分退货支持 | ✅ | 设计上 `orderItemId` 粒度（DTO 必填 `orderItemId`），每次一个 item，支持并行多单；整单退判定见规则 6 | — | — |
| 14 | 退货/换货后奖励归平台 | ✅ | `after-sale-reward.service.ts:31-191 voidRewardsForOrder`：扫描订单所有 `RewardLedger(ORDER, orderId, FREEZE, [RETURN_FROZEN/FROZEN])` + `RELEASE(AVAILABLE)` 防御路径；CAS → VOIDED + VOID；按 accountType 扣减 balance/frozen；创建平台收入镜像 Ledger；Serializable + P2034 重试。触发点：`seller-after-sale.service.ts:1146`（退款成功）+ `after-sale.service.ts:449`（换货 confirmReceive）+ `after-sale-timeout.service.ts:481`（买家确认超时）+ `admin-after-sale.service.ts:482`（仲裁退款）| — | — |
| 15 | 分润奖励两层冻结机制（RETURN_FROZEN）| ✅ | 枚举 `RETURN_FROZEN` 已加（`bonus/engine/constants.ts:42`）；分配时根据 `selfPurchaseCount` 判定（`vip-upstream.service.ts:111-113` / `normal-upstream.service.ts:113-115`）；`RETURN_FROZEN` 期间**不计入** `RewardAccount.frozen`（对用户隐藏）；`freeze-expire.service.ts:105 handleReturnFreezeExpire` 每 10 分钟扫描 `returnWindowExpiresAt < NOW() AND no active AfterSale → FROZEN + increment frozen`；`bonus.service.ts:556` 钱包查询过滤 `RETURN_FROZEN` | — | — |
| 16 | 完整状态机（14 状态）| ✅ | 枚举完整（schema.prisma:411-426），CAS 转换点：申请/取消/物流/收货/升级/关闭/审批/驳回/拒收/发货/退款/仲裁。所有关键转换用 `updateMany` + `where status` CAS 守卫 + Serializable + P2034 重试 | — | — |
| 17 | 卖家验收不通过（SELLER_REJECTED_RETURN + 举证照片 + 回寄单号）| ✅ | `seller-after-sale.service.ts:601 rejectReturn` 要求 `reason/photos/returnWaybillNo` 三件套；源状态 `RECEIVED_BY_SELLER`；买家可接受关闭（`acceptClose`）或升级仲裁（`escalate`）| — | — |
| 18 | 超时自动处理（4 个 Cron）| ✅ | `after-sale-timeout.service.ts:36 @Cron EVERY_HOUR` 驱动 4 个 handler：卖家审核超时→APPROVED（:52）、买家寄回超时→CANCELED（:182）、卖家签收超时→RECEIVED_BY_SELLER（:266）、买家确认超时→COMPLETED（:386）。全部 Serializable + CAS + P2034 重试；配置键全部可后台覆盖；批大小 100 | — | — |
| 19 | 买家撤销规则（REQUESTED/UNDER_REVIEW → CANCELED）| ✅ | `after-sale.service.ts:307 cancel` 检查源状态 + CAS；APPROVED 后拒绝取消 | — | — |
| 20 | 订单状态与售后的关系（部分退货维持 RECEIVED，全退转 REFUNDED）| 🔴 | **严重缺口**：整个 after-sale 模块下没有任何 `order.update / order.updateMany`（Grep 证实）。即使所有商品全退完成，`Order.status` 永远停在 `RECEIVED`，`OrderStatus.REFUNDED` 状态值根本无人写入。唯一写 `REFUNDED` 的是**遗留** `admin-refunds.service.ts:329`。新链路完全没收口。 | **是** | 是 |
| 21 | 多售后并行规则（同单不同 item 可并行，同 item 同时只能一条 active）| ✅ | `after-sale.service.ts:114-123` 用 `ACTIVE_STATUSES` 集合（`constants.ts:39`，9 个进行中状态）`findFirst` 检查 + 拒绝；`isPostReplacement` 例外由 `:164-177` 特判 | — | — |
| 22 | 换货后再退货限制（跳过卖家审核直接仲裁）| ✅ | `after-sale.service.ts:164-177` 查找已 COMPLETED 的 `QUALITY_EXCHANGE`；存在则只允许 `QUALITY_RETURN`；设置 `isPostReplacement=true` 且初始状态直接 `PENDING_ARBITRATION`（`:237-255`）。卖家列表过滤 `isPostReplacement=false`（`seller-after-sale.service.ts:108`） | — | — |
| 23 | 换货按阈值决定是否寄回 | ✅ | `requiresReturnShipping` 统一处理（`utils.ts:114-124`），换货与退货逻辑一致。`ship()` 支持两源 `APPROVED`（不寄回路径）和 `RECEIVED_BY_SELLER`（寄回路径）：`seller-after-sale.service.ts:691` | — | — |

**汇总：23 条 → 15 ✅ / 6 🟡 / 1 🔴 / 1 ⬜**

---

## 💰 账本完整性检查（退款主路径）

用户要求：**退款必须退回原支付方式（支付宝订单 → Alipay API），不允许余额退回。**

### 完整链路应是：
```
Alipay.refund(out_request_no) ✓ 渠道划款
→ Payment 状态 REFUNDED/PARTIAL_REFUND
→ RefundRecord 状态 REFUNDED + providerRefundId
→ Order.status RECEIVED → REFUNDED（全退时）
→ RewardLedger (RETURN_FROZEN|FROZEN) → VOIDED + RewardAccount 扣减 + 平台收入镜像
→ 库存回填（退货物理回库）
→ CouponInstance 保持 USED（✓ 规则 7）
→ 站内消息 / 推送
```

### 实际链路（grep 证据）：

| 环节 | 状态 | 证据 | 差距 |
|---|----|-----|-----|
| 1. **Alipay 渠道退款** | 🔴 **通道未接通** | `payment.service.ts:56-89 initiateRefund` 是**纯 mock**：直接 `return { success:true, providerRefundId: 'REFUND-'+Date.now() }`，注释 `// TODO: 接入真实支付退款 API`。grep 证实**没有任何生产代码调用 `alipayService.refund()`**（该方法在 `alipay.service.ts:145` 实现存在但是孤儿代码） | **阻 T1** |
| 2. **Payment 状态更新** | 🔴 未实现 | `initiateRefund` 只查 `payment.findFirst({orderId,status:PAID})` 但不 `update` 它。退款成功后 Payment 表仍为 PAID | 阻 T1 |
| 3. **Refund 记录状态** | ✅ | `seller-after-sale.service.ts:1138-1144`：退款成功后 CAS `Refund → REFUNDED + providerRefundId` | — |
| 4. **Order 状态 → REFUNDED** | 🔴 **完全缺失** | 整个 after-sale + seller-after-sale + admin-after-sale + after-sale-timeout 四个服务全 grep 无 `order.update` 调用。全退完成后订单状态**永远停 RECEIVED** | **阻 T1** |
| 5. **RewardLedger 作废** | ✅ | `after-sale-reward.service.ts:32 voidRewardsForOrder` 完整实现；触发点齐全（4 处） | — |
| 6. **RewardAccount 扣减** | ✅ | `after-sale-reward.service.ts:115-135` 按 originalStatus 分支：AVAILABLE 扣 balance / FROZEN 扣 frozen / RETURN_FROZEN 跳过（未计入不扣）| — |
| 7. **库存回填** | ⬜ **完全未实现** | grep `stock.*increment\|stockQuantity.*increment\|restock` 在 after-sale 目录**零匹配**。退货物流走完卖家签收后库存**从不回填**。VIP/奖品商品如果退货会直接丢失库存数据 | 阻 T2（T1 可接受） |
| 8. **平台红包退回** | ✅（**按设计就不退**）| 规则 7 明确"红包不退回"，所以不需要代码 | — |
| 9. **站内消息/推送** | ⬜ 未实现 | 售后状态变更无 `messageService.send` / `notification` 调用（grep 证实）| 阻 T2 |
| 10. **分润回滚 rollbackForOrder** | 🟡 **链路错位** | `bonus-allocation.service.ts:259` 有完整实现，但**唯一调用点是** `admin-refunds.service.ts:354`（旧链路）。新 `after-sale-reward.service.ts` 用的是 `voidRewardsForOrder`（另一套等价实现）。两套逻辑共存容易失同步 | T2 |

### 事务完整性：

❌ **全链路不在单一事务内。** 设计上分两段：
1. **事务内**（Serializable）：CAS 更新 AfterSaleRequest 状态 + 创建 Refund 记录 + 可选更新 afterSale 状态为 REFUNDING
2. **`setImmediate` 外**：调用 `paymentService.initiateRefund` → 成功后再开一个新事务更新 Refund.REFUNDED/afterSale.REFUNDED → 再触发 `voidRewardsForOrder`（自己开 Serializable 事务）

**风险点**：
- 若 `initiateRefund` 成功但进程崩溃在 `updateMany` 前 → Refund 表停在 REFUNDING，下次重启后 **无补偿任务重试**（`retryStaleAutoRefunds` 只认 `merchantRefundNo.startsWith('AUTO-')`，售后退款前缀是 `AS-`，不命中！）
- 若 `voidRewardsForOrder` 失败 → afterSale 已 REFUNDED，但奖励未归平台 → 套利窗口（setImmediate 吞异常只 log）
- 若 `order.status` **从不更新**（问题 4）→ 买家 App 订单列表看不到"已退款"状态 → 可能重复申请售后（被 `ACTIVE_STATUSES` 守护，但 UX 混乱）

---

## 🚨 Blocker 分级清单

### 🔴 CRITICAL — 阻塞 T1（必须修）

#### C1. 支付宝退款通道完全没有接通
**位置**：`backend/src/modules/payment/payment.service.ts:56-89`
**现象**：`initiateRefund` 是 mock，直接返回 success 的假 providerRefundId。`alipay.service.ts:145 refund()` 实现存在但从未被调用。
**影响**：买家"申请售后→卖家批准→看到已退款"全链路只改数据库状态，**真金白银一分钱没划回买家账户**。
**修复**：按 payment.channel 路由：
```ts
if (payment.channel === 'ALIPAY') {
  const result = await this.alipayService.refund({
    merchantOrderNo: payment.merchantOrderNo,
    refundAmount: amount,
    merchantRefundNo,
    refundReason,
  });
  // 更新 Payment + RefundRecord
}
```

#### C2. Order 状态机完全未闭环
**位置**：`backend/src/modules/after-sale/**` + `seller-after-sale.service.ts` + `admin-after-sale.service.ts`（grep 零匹配）
**现象**：
- 全退完成没人把 Order.status → REFUNDED（规则 20）
- 部分退货未在 Order 上打"部分退款"标识（但规则 20 允许）
**影响**：买家订单列表永远显示 RECEIVED；admin-refunds 旧链路反而会改（`admin-refunds.service.ts:329`），两套逻辑冲突。
**修复**：在 `triggerRefund` 成功回调 / `voidRewardsForOrder` 中加"检查所有非奖品项是否都 REFUNDED → Order.status = REFUNDED"。**必须与 `voidRewardsForOrder` 同事务**避免中间态。

#### C3. 售后退款无补偿重试
**位置**：`payment.service.ts:91-161 retryStaleAutoRefunds`
**现象**：补偿 Cron 只扫 `merchantRefundNo: { startsWith: 'AUTO-' }`，但售后退款编号前缀是 `AS-`（`seller-after-sale.service.ts:1100`）、`AS-TIMEOUT-`（`after-sale-timeout.service.ts:525`）、`AS-` 仲裁（`admin-after-sale.service.ts:434`）。
**影响**：退款失败的售后单永远停在 REFUNDING，不会重试。
**修复**：补偿 Cron 改为扫 `startsWith: 'AS-'` 或建立统一前缀白名单。

#### C4. App 填写退货物流字段名与后端 DTO 不一致
**位置**：
- App: `src/repos/AfterSaleRepo.ts:35-38` DTO `{carrierName, waybillNo}`
- App 页面: `app/orders/after-sale-detail/[id].tsx:162` 传 `{carrierName, waybillNo}`
- 后端: `backend/src/modules/after-sale/dto/return-shipping.dto.ts:8,14` 必填 `{returnCarrierName, returnWaybillNo}`
**影响**：买家填完退货单号提交后 **400 Bad Request**（`returnCarrierName 必须为字符串`），整个"需寄回"分支的核心动作不可用。
**修复**：三选一
- 改 App DTO 和页面的字段名
- 后端 DTO 改成 `carrierName`/`waybillNo`（对 data-system 冲击小）
- DTO 加 alias

#### C5. `setImmediate` 吞异常 + 无持久化队列
**位置**：`seller-after-sale.service.ts:1126-1160`、`admin-after-sale.service.ts:462-496`、`after-sale-timeout.service.ts:561-589`、`after-sale.service.ts:448-456`
**现象**：退款/归平台/确认收货都用 `setImmediate(async () => { ... catch log only })`。进程重启丢消息。
**影响**：crash → 订单处于"已审批未退款"僵局；无法通过重启恢复。
**修复**：起码加一个 Cron 扫 `REFUNDING` 超过 N 分钟的 AfterSaleRequest 重试一次。更好的方案是换成 BullMQ。

---

### 🟡 HIGH — 阻塞 T2（规则完整落地）

#### H1. 规则 20：部分退货无订单标识、全退无 REFUNDED 状态
同 C2。T1 只要全退能转 REFUNDED 即可；T2 需要前端在订单详情页显示"部分退款 X 元"标签。

#### H2. 规则 14：库存不回填
**位置**：`after-sale/**` grep 零匹配。
**现象**：退货完成库存**从不** increment 回去。SKU 库存永远减少一份。
**影响**：卖家库存统计失真；超卖容忍策略下虽不影响买家，但影响报表。
**修复**：在 `voidRewardsForOrder` 所在事务里加 `sku.stockQuantity increment orderItem.quantity`。注意：**奖品商品/VIP 礼包的库存回填要跳过**（奖品 wonCount 永不回退的既定规则）。

#### H3. 规则 12：App 侧售后类型展示无动态过滤
**位置**：`app/orders/after-sale/[id].tsx:83-102 availableTypes`
**现象**：`QUALITY_RETURN` 和 `QUALITY_EXCHANGE` 无条件展示，不查 returnPolicy 不查时间窗口。
**影响**：不可退商品/已过期订单仍能看到选项，提交后被后端拒绝 → UX 劣化；也违反 refund.md "如果所有选项都不可用→显示已超过期限"。
**修复**：
- 订单详情 API 返回每个 item 的 `returnPolicyResolved` 字段（预解析）
- 新增 `/after-sale/eligibility?orderId&orderItemId` 返回可用类型清单
- App 根据此清单渲染

#### H4. 规则 12：质量问题时限未在后台可视化
`NORMAL_RETURN_DAYS` 配置键存在，但管理后台 `admin/src/pages/config/` 无这组配置的 UI。管理员无法调整（只能直接改 `RuleConfig` 表）。

#### H5. 规则 11：`NORMAL_RETURN_DAYS ≤ 7` 未做 guard
若管理员在 RuleConfig 存 30，`getConfigValue` 会直接返回 30，退货窗口被撑大，与七天保护期不对齐。
**修复**：`getConfigValue` 对 `NORMAL_RETURN_DAYS` 做 `Math.min(val, 7)` 或在 RuleConfig 写入前校验。

#### H6. 规则 9：质量问题退货运费"平台承担"仅停留在文案
- App 文案：`[id].tsx:137` 写"运费到付（平台承担）"
- 后端：无 `platformShippingSubsidy` 字段、无记账、无对账。真正生产环境平台如何承担需与财务对齐。
- 属 T2 范畴（业务+财务双重依赖）。

#### H7. 旧 Refund 链路未下线 → 双写混乱
- `seller.module.ts:11 SellerRefundsModule` + `admin.module.ts:19 AdminRefundsModule` 仍注册
- 旧 `admin-refunds.service.ts:329` 仍写 `Order.status = REFUNDED`
- 新 `after-sale` 链路反而不写
- 若两个链路同时对同一订单操作 → Refund 重复创建、状态冲突
**修复**：
1. 确认管理后台前端是否还引用 `/admin/refunds` 路由
2. 明确下线旧模块，或改成只读模式
3. 新链路补写 Order.status

#### H8. 奖励归平台异步触发可能丢失
`voidRewardsForOrder` 通过 `setImmediate(... .catch(log))` 触发。若退款成功但归平台失败：
- AfterSaleRequest → REFUNDED
- Refund → REFUNDED
- Alipay 划款成功
- **RewardLedger 仍 RETURN_FROZEN**
- `freeze-expire.service.ts` 下一次扫描发现订单无 active AfterSale（此时售后已 REFUNDED ∉ ACTIVE_STATUSES）→ 转 FROZEN → 用户领钱 = 套利
**修复**：归平台必须与退款成功放在同事务，或引入补偿任务（扫 AfterSale=REFUNDED 但订单的 RewardLedger 仍 RETURN_FROZEN 的差异集）。

---

### 🟢 MEDIUM

#### M1. `AlipayService.refund` 孤儿代码
`alipay.service.ts:145` 实现完整但无调用方。建议要么接通（C1），要么加 `@deprecated` 避免误读。

#### M2. `RETURN_FROZEN → FROZEN` 扫描与售后判定有时序窗口
`freeze-expire.service.ts:139-145` 查"无 active 售后"时用 `findMany` 非锁读。若此时买家刚提交售后（事务未提交），扫描任务放行 → RETURN_FROZEN 转 FROZEN → 用户能看到奖励 → 随后售后成功又要扣 FROZEN → 用户感知"奖励突然消失"。
**缓解**：售后申请走 Serializable，扫描任务也加 Serializable + 再次校验。

#### M3. `QUALITY_EXCHANGE` 场景下 `afterSale.refundAmount` 未赋值但 `requiresReturn` 已计算
`after-sale.service.ts:192-231` 退款金额仅在退货类型计算；换货时 refundAmount=null。卖家/管理员前端若显示"预计退款 null"会出 UI bug。

#### M4. `isPostReplacement` 二次售后仲裁无流程时限
`isPostReplacement=true` 的申请直接进 `PENDING_ARBITRATION`，但超时 Cron 不扫这个状态 → 平台若不及时处理，订单永远悬挂。

#### M5. `cancel` 未检查 `requiresReturn=true + 退货已寄出` 场景
`cancel` 只拦截 `REQUESTED/UNDER_REVIEW`，所以 RETURN_SHIPPING 之后不能撤销（符合规则 19）。但 `APPROVED` 状态下，若买家未寄出退货即想撤销，只能靠超时 Cron 自动 CANCELED（7 天）。规则 19 允许审批前撤销，审批后不允许 —— 实现比规则更严格，属小偏差，可接受。

#### M6. `admin-after-sale` 场景 2 中 `arbitrationSource` 语义复用
`admin-after-sale.service.ts:306`：`data.arbitrationSource: currentStatus` 覆盖了此前买家升级时写入的 `"买家申请"` 标识。建议改为只写"首次来源"，不覆盖。

---

### 🟢 LOW

- **L1**：`after-sale.controller.ts:36-51 getReturnPolicy` 返回硬编码文案，应读取 `RuleConfig` 的 `RETURN_POLICY_TEXT`。
- **L2**：`after-sale-timeout.service.ts` 的 4 个 Cron 在同一个 `EVERY_HOUR` 触发点顺序执行，若第一个卡住后面都延迟。拆成 4 个 Cron 更健壮。
- **L3**：`after-sale.service.ts:241-271 apply` 未写 AuditLog（装饰器或手工记录），买家申请行为无审计追溯。
- **L4**：App 侧 `after-sale-detail/[id].tsx` 无"查看卖家验收拒绝理由和照片"的完整 UI（需确认是否已实现，grep 有 `sellerRejectReason` 字段但需 UI 审计）。
- **L5**：`admin/src/pages/refunds/index.tsx` 仍存在（436 行），应确认是否还链接旧 Refund API，删除或合并到 `admin/after-sale/index.tsx`。

---

## 🎯 T1 最小修复清单

1. **C1** 接通 AlipayService.refund（按 channel 路由 + Payment 状态更新）
2. **C2** 全退完成时更新 Order.status = REFUNDED（与 voidRewardsForOrder 同事务）
3. **C3** 补偿 Cron 加 `AS-` 前缀支持
4. **C4** 修复 App 退货物流字段名（`carrierName`→`returnCarrierName`，建议统一 snake/camel）
5. **C5** 至少加一个 Cron 扫 `REFUNDING > 10min` 的 AfterSale 进行重试

**预计工作量**：2-3 工作日（C1 半天、C2+C3+C4 半天、C5+联调 1-2 天）。

## 🎯 T2 完整落地清单

- H2 库存回填
- H3 App 动态过滤
- H4 管理后台配置 UI
- H5 NORMAL_RETURN_DAYS ≤7 guard
- H6 平台运费补贴记账
- H7 旧 Refund 链路下线
- H8 归平台补偿任务
- M2 时序窗口修复
- M1/M3/M4/M5/M6 完善细节

---

## 🔍 最终评估

| 维度 | 分数 | 说明 |
|---|----|-----|
| 数据模型完整度 | A | AfterSaleRequest + 枚举 + 索引齐全 |
| 规则覆盖度 | B+ | 23 条中 15 ✅ / 6 🟡 / 1 🔴 / 1 ⬜ |
| 状态机健壮性 | A- | CAS + Serializable + P2034 重试三件套齐全 |
| 并发安全 | A- | 关键转换都有 CAS；freeze-expire 存在时序窗口（M2）|
| 账本完整性 | **D** | **退款通道 mock、Order 状态不闭环、补偿任务前缀错配** |
| 前端一致性 | C | 买家 App 字段名 Bug（C4）、规则展示硬编码（H3） |
| 旧代码清理 | C- | 两个 Refund 模块仍挂载，存在双写冲突隐患（H7） |

**综合结论**：数据层与状态机已达到生产级质量，但"真正完成一笔退款"所需的最后三环（支付宝 API 接通 / Order 状态更新 / 补偿任务识别前缀）均缺失。App 侧 C4 字段名 Bug 会让买家寄回流程直接 400。**当前系统能申请售后、能审批、能走流程、但不能真退钱也不能更新订单状态。** 建议先解决 5 个 CRITICAL，发布到 T1 状态（能正常退款），再推 T2 全量落地。

---

## 📎 关键文件清单

**Schema**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/prisma/schema.prisma:405-432` — 枚举
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/prisma/schema.prisma:1502-1552` — 旧 Refund（@deprecated）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/prisma/schema.prisma:2137-2185` — AfterSaleRequest

**后端统一售后**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale.controller.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale.utils.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale.constants.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale-reward.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale-timeout.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/dto/create-after-sale.dto.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/dto/return-shipping.dto.ts`

**后端卖家售后**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/seller/after-sale/seller-after-sale.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`

**后端管理员仲裁**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/after-sale/admin-after-sale.controller.ts`

**分润/支付相关**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/engine/bonus-allocation.service.ts:259` — `rollbackForOrder`（旧链路用）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/engine/freeze-expire.service.ts:97` — `handleReturnFreezeExpire`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/payment/payment.service.ts:56` — `initiateRefund`（mock）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/payment/alipay.service.ts:145` — `refund`（孤儿方法）

**遗留 Refund 链路**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/refunds/admin-refunds.service.ts:354` — 旧链路 rollbackForOrder 唯一调用点

**前端**：
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/src/repos/AfterSaleRepo.ts` — 买家 App Repo（有 C4 字段名 Bug）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/after-sale/[id].tsx` — 申请页（H3 未动态过滤）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/after-sale/index.tsx` — 列表
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/after-sale-detail/[id].tsx` — 详情（C4 Bug 位置）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/seller/src/pages/after-sale/index.tsx` — 卖家列表
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/seller/src/pages/after-sale/detail.tsx` — 卖家详情
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/admin/src/pages/after-sale/index.tsx` — 管理员列表（含仲裁 Modal）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/admin/src/pages/refunds/index.tsx` — 旧 Refund 页（L5）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/seller/src/pages/refunds/index.tsx` — 旧 Refund 页（L5）
