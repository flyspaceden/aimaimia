# 售后链路收口设计方案

> 日期：2026-05-09
> 范围：退款、退货、换货、退货顺丰面单、退款补偿、三端售后展示与操作
> 结论：在现有 `after-sale` 主干上收口，不推倒重建。

## 1. 背景

现有代码已经完成统一售后系统的大部分主干：

- 买家端 `backend/src/modules/after-sale` 已有申请、取消、填写退货物流、确认换货、申诉、接受关闭。
- 卖家端 `backend/src/modules/seller/after-sale` 已有审核、驳回、确认收到退货、拒收退货、换货发货、换货顺丰面单生成/打印/取消。
- 管理端 `backend/src/modules/admin/after-sale` 已有售后列表、统计、仲裁。
- 退款已有 `Refund`、`RefundStatusHistory`、`PaymentService.initiateRefund()`、自动补偿和管理端订单退款重试。
- 分类/商品已有 `ReturnPolicy = RETURNABLE / NON_RETURNABLE / INHERIT`，管理后台分类页已提供配置入口。

这次不是重建售后系统，而是补齐完整闭环：

- 正式支持七天无理由换货。
- 把售后退款从 seller/admin/timeout/payment 的分散逻辑收口。
- 把买家退回商家的物流从手填快递升级为平台生成顺丰退货面单。
- 修复仲裁、换货确认、卖家验收后发货等状态接线问题。
- 补齐退款历史、售后状态历史、三端展示和运维入口。

## 2. 现有代码基线

### 2.1 后端可复用部分

保留以下现有结构和代码思路：

- `AfterSaleRequest` 继续作为售后主表。
- `Order.afterSaleRequests` / `OrderItem.afterSaleRequests` 关系继续使用。
- 本期继续保持“一张售后单对应一个 `OrderItem`”，不做多商品合并售后。
- 现有 `AfterSaleStatus` 名称保留，不重命名、不重排状态。
- 现有 `Serializable + CAS updateMany()` 状态迁移方式保留。
- `AfterSaleRewardService.voidRewardsForOrder()` 和 `checkAndMarkOrderRefunded()` 保留并由新退款服务统一调用。
- `SellerShippingService.createCarrierWaybill()` 继续作为顺丰面单创建能力的基础。
- `PaymentService.initiateRefund()` 继续作为原路退款通道。
- `Refund` 继续作为退款真相表，`AfterSaleRequest.status` 不承载退款失败细节。

### 2.2 当前必须修复的缺口

- `AfterSaleType` 只有 `NO_REASON_RETURN / QUALITY_RETURN / QUALITY_EXCHANGE`，没有 `NO_REASON_EXCHANGE`。
- 买家 App 仍有旧 `ReplacementRepo` 和旧 `/orders/:id/replacement/confirm` 调用；后端该接口已经返回 `GoneException`。
- 买家申请售后页在前端自行推断可选售后类型，没有以后端分类/商品策略为准。
- 买家售后详情仍让用户手填快递公司和单号。
- `OrderService.mapOrder()` 只暴露 `afterSaleStatus`，没有暴露 `afterSaleId`，导致“查看售后/确认换货收货”无法直达售后单。
- 卖家前端 `RECEIVED_BY_SELLER` 的“验收通过”错误调用 `approveAfterSale()`。
- 卖家前端只在 `APPROVED` 展示换货发货入口，但后端支持 `APPROVED / RECEIVED_BY_SELLER`。
- 卖家前端生成换货面单时传空 `carrierCode`。
- 买家申诉时 `arbitrationSource` 被写成“买家申请”，管理端无法判断申诉前是否为 `SELLER_REJECTED_RETURN`。
- seller/admin/timeout 都各自创建售后退款，`merchantRefundNo` 使用 `Date.now()`，不利于幂等。
- `PaymentService.retryStaleAutoRefunds()` 可更新 `Refund`，但售后单闭环依赖另一个 `AfterSaleTimeoutService.retryStaleRefundingRequests()` 补状态。
- 售后状态没有独立历史表；退款有 `RefundStatusHistory`，售后自身没有统一时间线。
- `AfterSaleRewardService.checkAndMarkOrderRefunded()` 存在重复 `select` 代码瑕疵，实施时应修复。

## 3. 设计目标

1. 在现有 `after-sale` 模块上收口，不重建主模型。
2. 正式支持四类售后：无理由退货、无理由换货、质量退货、质量换货。
3. 分类/商品配置是售后资格判断的真相源；App 不自行猜测。
4. 买家退回商家的物流由平台生成顺丰退货面单，不再手填单号。
5. 售后退款使用稳定幂等键，所有状态变更写入退款历史。
6. 退款失败由 `Refund.status = FAILED` 表示，售后单保持 `REFUNDING`，管理端负责重试。
7. 三端前端保留现有页面，只改类型、API、按钮矩阵和展示。
8. 所有金额、退款、面单、状态迁移继续使用 Serializable 事务和 CAS。

## 4. 非目标

本期不做以下事项：

- 不做多商品合并售后。
- 不做同商品不同 SKU 换货和差价支付/退款。
- 不自动从商家结算款扣除质量问题退货运费；本期只记录责任和成本，预留扣款接口。
- 不重做买家 App、卖家后台、管理后台页面结构。
- 不新增独立退款状态机替代 `Refund`。
- 不接入微信退款；继续沿用现有支付宝退款通道。

## 5. 业务规则

### 5.1 售后类型

本期 `AfterSaleType` 扩展为四类：

| 类型 | 说明 | 是否退款 | 是否换货 |
| --- | --- | --- | --- |
| `NO_REASON_RETURN` | 无理由退货退款 | 是 | 否 |
| `NO_REASON_EXCHANGE` | 无理由同 SKU 换货 | 否 | 是 |
| `QUALITY_RETURN` | 质量问题退货退款 | 是 | 否 |
| `QUALITY_EXCHANGE` | 质量问题换货 | 否 | 是 |

### 5.2 分类/商品策略

售后资格由商品最终 `returnPolicy` 决定：

- 商品自身 `returnPolicy != INHERIT` 时优先使用商品策略。
- 商品为 `INHERIT` 时沿分类树向上查找。
- 所有上级均为 `INHERIT` 时兜底 `RETURNABLE`。

当前管理端分类配置仍沿用：

- `RETURNABLE`：支持无理由退/换；窗口使用 `RETURN_WINDOW_DAYS`。
- `NON_RETURNABLE`：不支持无理由退/换，只支持质量售后；窗口使用 `FRESH_RETURN_HOURS` 或对应质量售后小时配置。
- `INHERIT`：继承上级分类。

“生鲜 24 小时”和“普通商品 7 天”是默认配置，不写死在 App。

默认配置项必须显式落到后端 `ConfigKey`：

- `RETURN_WINDOW_DAYS`：普通可退商品无理由退/换窗口，默认 7 天。
- `FRESH_RETURN_HOURS`：生鲜/不支持无理由商品质量售后窗口，默认 24 小时。
- `NORMAL_RETURN_DAYS`：普通商品质量售后窗口，默认 7 天。
- `RETURN_NO_SHIP_THRESHOLD`：质量退/换、无理由换货免寄回金额阈值。
- `BUYER_SHIP_TIMEOUT_DAYS`：买家寄回超时天数，作用于待支付运费、待生成面单和待揽收场景。

### 5.3 寄回规则

| 类型 | 是否必须寄回 | 运费承担 |
| --- | --- | --- |
| `NO_REASON_RETURN` | 一律寄回 | 买家承担 |
| `NO_REASON_EXCHANGE` | 走 `RETURN_NO_SHIP_THRESHOLD`，低金额免寄回 | 买家承担 |
| `QUALITY_RETURN` | 走 `RETURN_NO_SHIP_THRESHOLD`，低金额免寄回 | 商家承担，本期只记录责任和成本 |
| `QUALITY_EXCHANGE` | 走 `RETURN_NO_SHIP_THRESHOLD`，低金额免寄回 | 商家承担，本期只记录责任和成本 |

无理由退货的退货运费：

- 优先从退款金额扣除。
- 如果预计可退金额不足以扣退货运费，则买家先支付退货运费，支付成功后生成顺丰退货面单。
- 退款金额最低为 0，不允许出现负数。

无理由换货的退货运费：

- 低金额免寄回时不生成退货面单。
- 高金额需要寄回时，因为没有退款可扣，买家必须先支付退货运费，支付成功后生成顺丰退货面单。

买家先支付退货运费的支付通道：

- 不复用普通订单 `CheckoutSession` 建单回调，避免支付成功后误创建订单。
- 新增专用 `AfterSaleShippingPayment` 记录，复用现有支付宝收款能力，但回调只更新运费支付状态并触发/解锁退货面单生成。
- 支付金额来自 `AfterSaleReturnShippingService.estimateReturnShippingFee(afterSaleId)` 的顺丰预估价；创建支付单时落库，买家按该预估价支付。
- 实际顺丰月结成本与预估差额本期只做后台记录，不对买家二次补收或自动退款。
- 无理由退货能从退款中足额扣除时不创建运费支付单，只在退款计算中记录 `returnShippingFeeDeducted = true`。

质量退/换的退货运费：

- 高金额需要寄回时由商家承担。
- 本期记录 `returnShippingPayer = SELLER`、运费金额、顺丰单据，不自动扣商家待结算款。
- 买家不需要先垫付，也不会收到一笔独立“运费退款”；平台生成顺丰退货面单，顺丰月结由平台先承担，成本归集到商家责任记录。
- 新 App 不再支持“买家自行寄回后报销运费”的主流程；如历史手填物流单进入人工处理，后台只记录，不做自动打款。
- 后续商家结算系统稳定后再接扣款流水。

### 5.4 换货规则

- `NO_REASON_EXCHANGE` 本期只允许同商品同 SKU 换货。
- 可在模型上预留 `targetSkuId` / `targetQuantity`，本期强制 `targetSkuId = 原 skuId`。
- 库存不足时允许负库存，并通知卖家补货，符合项目“超卖容忍”决策。
- 换货后二次售后继续沿用现有规则：只允许质量退货，并自动进入平台仲裁。

## 6. 状态机

保留现有 `AfterSaleStatus`，不新增失败态。

### 6.1 退货退款

需要寄回：

```text
REQUESTED -> UNDER_REVIEW -> APPROVED
-> RETURN_SHIPPING -> RECEIVED_BY_SELLER
-> REFUNDING -> REFUNDED
```

免寄回：

```text
REQUESTED -> UNDER_REVIEW -> APPROVED
-> REFUNDING -> REFUNDED
```

### 6.2 换货

需要寄回：

```text
REQUESTED -> UNDER_REVIEW -> APPROVED
-> RETURN_SHIPPING -> RECEIVED_BY_SELLER
-> REPLACEMENT_SHIPPED -> COMPLETED
```

免寄回：

```text
REQUESTED -> UNDER_REVIEW -> APPROVED
-> REPLACEMENT_SHIPPED -> COMPLETED
```

### 6.3 驳回和仲裁

```text
REQUESTED / UNDER_REVIEW -> REJECTED
REJECTED -> PENDING_ARBITRATION -> APPROVED / REJECTED
```

```text
RECEIVED_BY_SELLER -> SELLER_REJECTED_RETURN
SELLER_REJECTED_RETURN -> PENDING_ARBITRATION -> REFUNDING / RECEIVED_BY_SELLER / REJECTED
```

`SELLER_REJECTED_RETURN` 仲裁通过时：

- 退货退款类型：货已在卖家手中，走 `PENDING_ARBITRATION -> REFUNDING -> REFUNDED`，不要求买家再次寄回。
- 换货类型：货已在卖家手中，走 `PENDING_ARBITRATION -> RECEIVED_BY_SELLER -> REPLACEMENT_SHIPPED -> COMPLETED`，让卖家直接发换货。
- 仲裁不通过：走 `PENDING_ARBITRATION -> REJECTED`，再由卖家回寄原商品给买家。

申诉时必须保存申诉前状态，例如 `arbitrationSourceStatus = SELLER_REJECTED_RETURN`，不能再只写“买家申请”。

## 7. 数据模型设计

### 7.1 Prisma 枚举

`AfterSaleType` 新增：

```prisma
NO_REASON_EXCHANGE // 七天无理由同 SKU 换货
```

### 7.2 AfterSaleRequest 字段扩展

保留现有字段，并补充以下字段。字段名以本节为准；如实施时发现与 Prisma 迁移限制冲突，必须在实施计划里显式说明替代字段名。

```prisma
// 仲裁来源
arbitrationSourceStatus AfterSaleStatus?

// 换货目标
targetSkuId      String?
targetQuantity   Int?

// 买家退回商家的顺丰面单
returnCarrierCode     String?
returnCarrierName     String?
returnWaybillNo       String?
returnWaybillUrl      String?
returnSfOrderId       String?
returnLabelUrl        String?
returnShippingFee     Float?
returnShippingPayer   ReturnShippingPayer?
returnShippingPaidAt  DateTime?
returnShippingFeeDeducted Boolean @default(false)

// 卖家拒收后回寄买家
sellerReturnCarrierCode String?
sellerReturnCarrierName String?
sellerReturnWaybillNo   String?
sellerReturnWaybillUrl  String?
sellerReturnSfOrderId   String?
```

新增 `ReturnShippingPayer` 枚举：

```prisma
enum ReturnShippingPayer {
  BUYER
  SELLER
  PLATFORM
}
```

`PLATFORM` 作为预留值，当前业务优先使用 `BUYER / SELLER`。

### 7.3 AfterSaleStatusHistory

新增操作者类型枚举，避免售后历史和审计日志 actor 类型继续分裂：

```prisma
enum AfterSaleOperatorType {
  BUYER
  SELLER_STAFF
  ADMIN
  SYSTEM
}
```

新增售后状态历史表：

```prisma
model AfterSaleStatusHistory {
  id          String   @id @default(cuid())
  afterSaleId String
  afterSale   AfterSaleRequest @relation(fields: [afterSaleId], references: [id], onDelete: Cascade)
  fromStatus  AfterSaleStatus?
  toStatus    AfterSaleStatus
  reason      String?
  operatorType AfterSaleOperatorType?
  operatorId   String?
  meta        Json?
  createdAt   DateTime @default(now())

  @@index([afterSaleId, createdAt])
  @@map("after_sale_status_history")
}
```

所有状态变更都写历史。`OrderStatusHistory` 可继续保留用于订单侧事件，但不再替代售后时间线。

### 7.4 Refund 表使用方式

`Refund` 继续作为退款真相表。

售后退款约束：

- 同一个 `afterSaleId` 只能有一条有效售后退款。
- `merchantRefundNo = AS-${afterSaleId}`。
- 新增 `Refund.afterSaleId String? @unique`，并与 `AfterSaleRequest` 建立关系。
- `AfterSaleRequest.refundId` 继续保留，用于现有查询兼容；新逻辑以 `Refund.afterSaleId` 和 `AfterSaleRequest.refundId` 双向一致为校验条件。
- 需要在 `Refund.reason` 中记录售后来源。
- 迁移时按历史 `AfterSaleRequest.refundId` 回填 `Refund.afterSaleId`；发现一对多或孤儿退款时写入迁移报告并阻断上线，不静默选择一条。
- 新增售后退款一致性巡检任务，定期扫描 `AfterSaleRequest.refundId != Refund.id`、`Refund.afterSaleId != AfterSaleRequest.id`、同一售后多退款等异常，并在管理端暴露告警。

### 7.5 AfterSaleShippingPayment

新增售后退货运费支付记录，专门承载“买家先付退货运费”场景：

```prisma
enum AfterSaleShippingPaymentStatus {
  UNPAID
  PENDING
  PAID
  FAILED
  REFUNDING
  REFUNDED
  CLOSED
}

model AfterSaleShippingPayment {
  id                 String   @id @default(cuid())
  afterSaleId        String   @unique
  afterSale          AfterSaleRequest @relation(fields: [afterSaleId], references: [id], onDelete: Cascade)
  amount             Float
  status             AfterSaleShippingPaymentStatus
  merchantPaymentNo  String   @unique
  providerPaymentNo  String?
  provider           String   @default("ALIPAY")
  paidAt             DateTime?
  refundedAt         DateTime?
  failureReason      String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([status, createdAt])
  @@map("after_sale_shipping_payments")
}
```

约束：

- `merchantPaymentNo = AS_SHIP_PAY_${afterSaleId}`。
- 一张售后单最多一条有效运费支付记录。
- 支付成功只解锁或触发退货面单生成，不创建订单、不进入订单支付回调建单流程。
- 如面单未揽收并成功取消，需要把已付运费退回买家，退款来源是这条运费支付记录。

## 8. 后端服务设计

### 8.1 AfterSaleEligibility

新增买家端 eligibility API：

```text
GET /after-sale/orders/:orderId/eligibility
```

返回每个可售后 `OrderItem` 的资格：

```ts
type AfterSaleEligibilityItem = {
  orderItemId: string;
  skuId: string;
  productTitle: string;
  quantity: number;
  itemAmount: number;
  returnPolicy: 'RETURNABLE' | 'NON_RETURNABLE';
  options: Array<{
    afterSaleType: 'NO_REASON_RETURN' | 'NO_REASON_EXCHANGE' | 'QUALITY_RETURN' | 'QUALITY_EXCHANGE';
    enabled: boolean;
    disabledReason?: string;
    deadlineAt?: string;
    requiresReturn: boolean;
    returnShippingPayer?: 'BUYER' | 'SELLER';
    estimatedRefundAmount?: number;
    estimatedReturnShippingFee?: number;
    requiresBuyerShippingPayment?: boolean;
    returnShippingPaymentStatus?: 'NOT_REQUIRED' | 'UNPAID' | 'PAID' | 'REFUNDING' | 'REFUNDED' | 'FAILED' | 'CLOSED';
  }>;
};
```

App 只展示 `enabled = true` 的选项。后端 `apply()` 仍重复校验，不能只信 eligibility。

### 8.2 AfterSaleService

保留现有买家端服务，改造点：

- `CreateAfterSaleDto.afterSaleType` 接受 `NO_REASON_EXCHANGE`。
- `reasonType` 只对质量售后必填；无理由退/换不强制。
- `photos` 本期沿用现有 DTO 约束：四类售后都必须上传 1-10 张照片。无理由售后照片用于证明商品状态和包装情况，后续如要放宽必须另起设计。
- `isWithinReturnWindow()` 支持 `NO_REASON_EXCHANGE`。
- `requiresReturnShipping()` 支持四类售后规则。
- `calculateRefundAmount()` 支持退货运费扣减；换货类型退款金额为 `null`。
- 申请时写 `targetSkuId/targetQuantity`。
- 申诉时保存 `arbitrationSourceStatus = request.status`。
- `fillReturnShipping()` 不再作为买家手填主入口；保留兼容，但新 App 使用退货面单接口。

### 8.3 AfterSaleShippingPaymentService

新增服务，负责买家退货运费支付：

- `estimateReturnShippingFee(afterSaleId)`：按顺丰退货方向、重量和地址预估运费。
- `createOrGetPayment(afterSaleId)`：按 `AS_SHIP_PAY_${afterSaleId}` 幂等创建支付单。
- `handlePaymentSuccess(paymentId)`：更新 `AfterSaleShippingPayment.status = PAID` 和 `AfterSaleRequest.returnShippingPaidAt`。
- `refundShippingPayment(afterSaleId, reason)`：面单未揽收且售后关闭时退还买家已付退货运费。

支付成功后的动作：

- 如果售后仍处于 `APPROVED` 且需要寄回，允许买家调用退货面单接口。
- 如配置为“支付成功后自动生成面单”，也必须通过 `AS_RETURN_${afterSaleId}` 幂等键创建，不能重复生成。
- 支付回调不得调用普通订单 `CheckoutSession` 的建单逻辑。

### 8.4 AfterSaleReturnShippingService

新增服务，负责买家退回商家的顺丰面单：

- 创建退货面单。
- 取消退货面单。
- 记录退货运费责任、预估/实际费用。
- 记录买家运费支付状态。
- 更新 `AfterSaleRequest` 到 `RETURN_SHIPPING`。
- 处理远端成功、本地失败时的面单回滚。

内部复用 `SellerShippingService.createCarrierWaybill()` 的地址解析和顺丰能力，但退货方向是：

- 发件人：买家收货地址。
- 收件人：商家公司售后/发货地址。

为了避免污染卖家普通发货逻辑，退货面单应使用独立幂等 key：

```text
AS_RETURN_${afterSaleId}
```

并使用独立 advisory lock namespace：

```text
after-sale-return-waybill
```

### 8.5 AfterSaleRefundService

新增服务，统一售后退款：

- `createOrGetRefund(afterSaleId)`：按 `AS-${afterSaleId}` 幂等创建退款。
- `startRefund(afterSaleId, operator)`：把售后单推进到 `REFUNDING` 并触发支付通道。
- `handleRefundSuccess(refundId, providerRefundId)`：更新 `Refund` 和 `AfterSaleRequest`，写历史，执行副作用。
- `handleRefundFailure(refundId, reason)`：`Refund.status = FAILED`，售后单保持 `REFUNDING`。
- `retryRefund(refundId, operator)`：管理端手动重试，复用现有 `refund-retry` 锁和 30 秒节流。

退款成功副作用只在这里执行一次：

- `AfterSaleRequest.status = REFUNDED`
- `Refund.status = REFUNDED`
- `RefundStatusHistory` 写成功历史
- `AfterSaleStatusHistory` 写成功历史
- `AfterSaleRewardService.voidRewardsForOrder(orderId)`
- `AfterSaleRewardService.checkAndMarkOrderRefunded(orderId)`
- 站内信通知买家

`PaymentService.retryStaleAutoRefunds()` 对 `AS-` 退款成功时，必须调用或委托 `AfterSaleRefundService` 完成售后闭环，不能只改 `Refund`。

买家端退款失败展示规则：

- `Refund.status = FAILED` 且首次失败未超过 24 小时时，App 仍展示“退款处理中”。
- `Refund.status = FAILED` 且首次失败已超过 24 小时，或自动重试次数达到上限时，App 展示“退款已转人工处理”。
- 管理端始终展示真实失败原因和重试记录。
- 买家端不直接展示支付通道技术失败是有意设计，必须由退款 SLA、管理端告警和人工处理兜底。

### 8.6 SellerAfterSaleService

保留现有服务，改造点：

- `isExchangeType = QUALITY_EXCHANGE || NO_REASON_EXCHANGE`。
- `isReturnType = NO_REASON_RETURN || QUALITY_RETURN`。
- `approve()` 对免寄回退货调用 `AfterSaleRefundService.startRefund()`。
- `confirmReceiveReturn()` 对退货类型调用 `AfterSaleRefundService.startRefund()`。
- `ship()` 和 `generateWaybill()` 支持 `NO_REASON_EXCHANGE`。
- `RECEIVED_BY_SELLER` 换货可以生成换货面单和发货。
- `rejectReturn()` 不再强制手填回寄单号；改为记录拒收原因/照片后，由回寄面单接口生成回寄单。

### 8.7 AdminAfterSaleService

改造点：

- `ARBITRABLE_STATUSES` 扩展为包含 `REJECTED` 和 `SELLER_REJECTED_RETURN`，允许管理员主动介入这两个状态。
- 仲裁通过时按 `arbitrationSourceStatus` 判断是否货已在卖家手中。
- 触发退款统一调用 `AfterSaleRefundService`。
- 详情接口返回退款单、退款历史、售后状态历史、退货面单、运费责任和成本。
- 售后页提供退款重试接口，复用订单退款重试能力，但从售后详情进入。

### 8.8 Timeout 和补偿任务

`AfterSaleTimeoutService` 保留，但退款创建和成功闭环委托 `AfterSaleRefundService`。

补偿规则：

- 卖家审核超时：沿用自动同意。
- 买家寄回超时：
  - 未生成退货面单，或需要买家先付运费但未支付：超过 `BUYER_SHIP_TIMEOUT_DAYS` 后关闭售后。
  - 已生成退货面单但顺丰未揽收：面单生成后 24 小时和 72 小时提醒买家；超过 `BUYER_SHIP_TIMEOUT_DAYS` 后尝试取消顺丰面单。
  - 面单取消成功：关闭售后；若买家已支付无理由退货运费，同步把 `AfterSaleShippingPayment` 进入退款流程。
  - 面单取消失败或顺丰轨迹显示已揽收：保持 `RETURN_SHIPPING` 并转人工处理，不能自动关闭。
- 卖家签收超时：保留自动签收。
- 买家确认换货超时：保留自动完成。
- 退款卡住：由 `AfterSaleRefundService` 或 Payment cron 委托统一闭环，不再双系统各改一半。

## 9. API 设计

### 9.1 买家端

新增：

```text
GET  /after-sale/orders/:orderId/eligibility
POST /after-sale/:id/return-waybill
POST /after-sale/:id/return-shipping-payment
GET  /after-sale/:id/timeline
```

语义：

- `POST /after-sale/:id/return-shipping-payment`：仅用于无理由退货退款不足扣运费、无理由换货高金额需寄回这两类买家先付运费场景；创建/返回 `AfterSaleShippingPayment` 支付参数。
- `POST /after-sale/:id/return-waybill`：生成买家退回商家的顺丰面单。若需要买家先付运费但未支付，返回待支付错误；若商家承担或退款可扣除，直接幂等生成。

保留：

```text
POST /after-sale/orders/:orderId
GET  /after-sale
GET  /after-sale/:id
POST /after-sale/:id/cancel
POST /after-sale/:id/confirm
POST /after-sale/:id/escalate
POST /after-sale/:id/accept-close
```

兼容保留但不作为新 App 主路径：

```text
POST /after-sale/:id/return-shipping
```

### 9.2 卖家端

保留现有 API：

```text
GET    /seller/after-sale
GET    /seller/after-sale/stats
GET    /seller/after-sale/:id
POST   /seller/after-sale/:id/review
POST   /seller/after-sale/:id/approve
POST   /seller/after-sale/:id/reject
POST   /seller/after-sale/:id/receive
POST   /seller/after-sale/:id/reject-return
POST   /seller/after-sale/:id/ship
POST   /seller/after-sale/:id/waybill
DELETE /seller/after-sale/:id/waybill
```

新增或扩展：

```text
POST /seller/after-sale/:id/seller-return-waybill
GET  /seller/after-sale/:id/timeline
```

`POST /seller/after-sale/:id/waybill` 继续用于换货发出面单；买家退回商家的退货面单不走这个接口。

`POST /seller/after-sale/:id/seller-return-waybill` 用于卖家拒收退货后把原商品回寄给买家：

- 仅允许 `SELLER_REJECTED_RETURN` 状态调用。
- 使用 `AS_REJECT_RETURN_${afterSaleId}` 幂等键和同名业务锁。
- 发件人为卖家售后地址，收件人为买家收货地址。
- 成功后写入 `sellerReturnCarrierCode / sellerReturnCarrierName / sellerReturnWaybillNo / sellerReturnWaybillUrl / sellerReturnSfOrderId`。
- 该接口不是换货发货接口，不能写 `replacementWaybillNo`。

### 9.3 管理端

保留：

```text
GET  /admin/after-sale
GET  /admin/after-sale/stats
GET  /admin/after-sale/:id
POST /admin/after-sale/:id/arbitrate
```

新增：

```text
POST /admin/after-sale/:id/refunds/:refundId/retry
GET  /admin/after-sale/:id/timeline
```

## 10. 三端前端设计

### 10.1 买家 App

保留现有页面：

- `app/orders/[id].tsx`
- `app/orders/after-sale/[id].tsx`
- `app/orders/after-sale/index.tsx`
- `app/orders/after-sale-detail/[id].tsx`

改造点：

- `src/types/domain/Order.ts` 新增 `NO_REASON_EXCHANGE` 和完整售后摘要字段。
- `src/constants/statuses.ts` 新增 `NO_REASON_EXCHANGE` 文案。
- `src/repos/AfterSaleRepo.ts` 新增 eligibility、退货面单、运费支付相关方法。
- `OrderRepo.confirmReplacement()` 不再用于真实后端；订单详情改用 `AfterSaleRepo.confirmReceive(afterSaleId)`。
- `OrderService.mapOrder()` 返回 `afterSaleSummary`：

```ts
type OrderAfterSaleSummary = {
  id: string;
  status: AfterSaleDetailStatus;
  type: AfterSaleType;
  requiresReturn: boolean;
  refundAmount?: number | null;
  requiresBuyerShippingPayment?: boolean;
  returnShippingPaymentStatus?: 'NOT_REQUIRED' | 'UNPAID' | 'PAID' | 'REFUNDING' | 'REFUNDED' | 'FAILED' | 'CLOSED';
};
```

- “查看售后”跳转 `/orders/after-sale-detail/[id]`，不再只跳售后列表。
- 申请售后页调用 eligibility，不再前端硬推售后类型。
- 售后详情页删除手填快递作为主流程，展示：
  - 待平台生成退货面单
  - 待支付退货运费
  - 顺丰退货面单已生成
  - 已寄回，等待卖家验收
  - 退款处理中/退款失败客服介入/退款完成
  - 换货已发出，展示 `replacementWaybillNo`
- 商品详情和结账协议文案改为“以商品详情/分类配置为准”。

### 10.2 卖家后台

保留现有页面：

- `seller/src/pages/after-sale/index.tsx`
- `seller/src/pages/after-sale/detail.tsx`
- `seller/src/api/after-sale.ts`

改造点：

- 类型和标签支持 `NO_REASON_EXCHANGE`。
- `isExchange` 判断扩展为 `QUALITY_EXCHANGE || NO_REASON_EXCHANGE`。
- `RECEIVED_BY_SELLER`：
  - 退货退款类型：展示“已验收，退款处理中/待退款”。
  - 换货类型：展示“生成换货面单/打印面单/确认发货”。
  - 不再调用 `approveAfterSale()`。
- 换货面单生成提供 carrier 选择，默认顺丰，不能传空字符串。
- `APPROVED / RECEIVED_BY_SELLER` 都允许换货发货。
- 退货物流展示平台生成的顺丰退货单、运费责任和成本。
- 拒收退货 Modal 保留拒收原因/照片，回寄单号改为生成顺丰回寄面单或等待后端返回。

### 10.3 管理后台

保留现有售后仲裁页和分类管理页：

- `admin/src/pages/after-sale/index.tsx`
- `admin/src/pages/categories/index.tsx`

改造点：

- 售后类型支持 `NO_REASON_EXCHANGE`。
- 售后仲裁弹窗可升级为 Drawer，但不强制新页面。
- 详情展示：
  - 原始仲裁来源状态
  - 退货面单
  - 换货面单
  - 退货运费责任和成本
  - 退款单
  - 退款历史
  - 售后状态历史
- 售后页增加退款重试入口，只允许 `Refund.status in (FAILED, REFUNDING)`。
- 分类管理继续使用 `RETURNABLE / NON_RETURNABLE / INHERIT`，本期不重做为复杂策略编辑器。

## 11. 错误处理

买家端：

- 不暴露技术错误。
- 展示业务状态：待支付退货运费、面单生成中、等待寄回、卖家验收中、退款处理中、平台处理中。
- 退款失败 24 小时内仍显示“退款处理中”；超过 24 小时或重试耗尽后显示“退款已转人工处理”，真实失败原因只在管理端展示。

卖家端：

- 明确区分待审核、待买家寄回、待验收、待发换货、退款中、已完成。
- 生成面单失败显示可重试原因。
- 验收不通过必须有原因和照片。

管理端：

- 展示真实失败原因。
- 可见退款失败、面单失败、最后一次重试历史。
- 提供手动重试入口和 30 秒节流提示。

## 12. 并发与安全

所有涉及以下内容的写操作必须使用 Serializable：

- 退款创建和重试。
- 退货面单生成和取消。
- 换货面单生成和取消。
- 售后状态迁移。
- 分润作废和订单全退检查。

幂等规则：

- 售后退款：`AS-${afterSaleId}`。
- 买家退货运费支付：`AS_SHIP_PAY_${afterSaleId}`。
- 买家退货面单：`AS_RETURN_${afterSaleId}`。
- 换货发出面单：沿用 `AS_${afterSaleId}`。
- 卖家拒收回寄面单：`AS_REJECT_RETURN_${afterSaleId}`。

锁规则：

- 买家退货运费支付使用 `after-sale-shipping-payment`。
- 退款重试沿用 `refund-retry`。
- 买家退货面单使用 `after-sale-return-waybill`。
- 换货发出面单继续使用现有 `seller-waybill-after-sale`。
- 卖家拒收回寄面单使用 `seller-return-waybill-after-sale`。

隐私规则：

- 买家端和卖家端继续展示脱敏手机号/地址/单号。
- 管理端可查看完整地址用于仲裁和面单排查。
- 面单打印继续使用签名 URL 和水印审计。

## 13. 测试范围

后端单测：

- `NO_REASON_EXCHANGE` eligibility。
- `isWithinReturnWindow()` 支持四类售后和分类策略。
- `requiresReturnShipping()` 四类售后规则。
- 无理由退货运费扣减：够扣、不够扣转待支付。
- 无理由换货低金额免寄回。
- 无理由换货高金额需要买家先付运费。
- 买家退货运费支付成功后只解锁/生成退货面单，不创建订单。
- 买家退货运费支付后面单未揽收关闭售后时，能退还已付运费。
- 质量退/换高金额商家承担运费，只记录成本不扣结算。
- `SELLER_REJECTED_RETURN -> PENDING_ARBITRATION -> REFUNDING / RECEIVED_BY_SELLER` 正确进入退款/换货发货路径。
- `SELLER_REJECTED_RETURN -> PENDING_ARBITRATION -> RECEIVED_BY_SELLER` 的换货路径不会要求买家二次寄回。
- `RECEIVED_BY_SELLER` 换货发货路径。
- `AfterSaleRefundService` 幂等创建退款和写 `RefundStatusHistory`。
- `Refund.afterSaleId` 与 `AfterSaleRequest.refundId` 双向一致性巡检能发现错链、孤儿和重复退款。
- `PaymentService` 的 AS 退款补偿委托售后闭环。
- `AfterSaleRewardService.checkAndMarkOrderRefunded()` 修复重复 `select` 后仍能标记全退订单。

并发测试：

- 同一 `afterSaleId` 并发调用 `AfterSaleRefundService.startRefund()` 只创建一条退款。
- 同一售后单并发生成退货运费支付单只返回同一条 `AfterSaleShippingPayment`。
- 支付回调和买家点击生成退货面单同时到达时，只生成一张 `AS_RETURN_${afterSaleId}` 面单。
- `SELLER_REJECTED_RETURN` 同时发生买家申诉和管理员介入时，状态只进入一次 `PENDING_ARBITRATION`，历史不重复。
- 退款自动补偿和管理员手动重试同时触发时，只有一个通道完成写回，`RefundStatusHistory` 不重复成功。
- 卖家确认签收和签收超时任务同时触发时，只产生一次 `RECEIVED_BY_SELLER` 迁移。

前端类型检查：

- 买家 App TypeScript。
- 卖家后台 TypeScript。
- 管理后台 TypeScript。

关键联调：

- 普通商品无理由退货。
- 普通商品无理由换货低金额免寄回。
- 普通商品无理由换货高金额买家支付退货运费。
- 不支持无理由商品质量退货。
- 质量换货需寄回。
- 卖家拒收后平台仲裁通过。
- 售后退款失败后管理端重试。

## 14. 实施拆分建议

### Phase 1：后端状态和退款收口

- 新增 `NO_REASON_EXCHANGE`。
- 修 `arbitrationSourceStatus`。
- 抽 `AfterSaleRefundService`。
- 让 seller/admin/timeout 统一调用新退款服务。
- 补 `AfterSaleStatusHistory`。
- 补 `Refund.afterSaleId` 双向关系、回填脚本和一致性巡检。
- 修 `AfterSaleRewardService.checkAndMarkOrderRefunded()`。

### Phase 2：退货顺丰面单

- 新增退货面单字段和 `ReturnShippingPayer`。
- 新增 `AfterSaleShippingPayment` 和专用支付回调处理。
- 新增 `AfterSaleReturnShippingService`。
- 买家退回商家面单生成。
- 无理由运费扣减/买家先付规则。
- 质量售后商家承担运费记录。

### Phase 3：三端前端接线

- App eligibility 和售后详情改造。
- App 订单详情直达售后单并修确认换货。
- 卖家端换货按钮矩阵修复。
- 管理端售后详情增强和退款重试入口。

### Phase 4：联调和文档同步

- 执行后端测试、三端 TypeScript。
- 真机/沙箱联调顺丰退货面单。
- 更新 `docs/features/refund.md`、`docs/issues/app-tofix3.md`、`docs/issues/tofix-safe.md`。
- 如涉及部署或密钥，按项目规则同步运维文档和密码本。

## 15. 兼容与迁移

数据库迁移：

- 新增枚举值 `NO_REASON_EXCHANGE`。
- 新增 `ReturnShippingPayer` 枚举。
- 新增 `AfterSaleOperatorType` 和 `AfterSaleShippingPaymentStatus` 枚举。
- 新增 `AfterSaleRequest` 扩展字段。
- 新增 `AfterSaleStatusHistory` 表。
- 新增 `Refund.afterSaleId` 唯一字段；同时保留 `AfterSaleRequest.refundId` 做现有查询兼容。
- 新增 `AfterSaleShippingPayment` 表。
- 回填脚本必须先按 `AfterSaleRequest.refundId` 建立 `Refund.afterSaleId`，再执行双向一致性检查。
- 一致性检查发现异常时必须输出售后单 id、退款单 id、异常类型，并阻断发布；不能在迁移中静默修正无法判断归属的数据。

兼容策略：

- 旧 `POST /orders/:id/after-sale` 暂时保留转发。
- 旧 `POST /orders/:id/replacement/confirm` 已停用，前端必须清理。
- `ReplacementRepo` 不再用于真实后端，可保留 mock 或后续删除。
- 旧手填退货物流接口可短期保留，但新 App 不使用。

## 16. 验收标准

- 四类售后类型在后端、买家 App、卖家后台、管理后台枚举一致。
- App 申请售后选项完全来自后端 eligibility。
- 买家高金额无理由换货必须先支付退货运费才能生成退货面单。
- 买家退货运费支付不走普通订单 CheckoutSession 建单链路。
- 已付退货运费但面单未揽收并关闭售后时，运费能原路退回。
- 质量退/换退货运费记录为商家责任，但不会自动扣商家结算款。
- 售后退款同一售后单不会重复创建退款单。
- `Refund.afterSaleId` 与 `AfterSaleRequest.refundId` 双向一致性巡检通过。
- 退款失败时 `Refund.status = FAILED`，售后单保持 `REFUNDING`，管理端能重试。
- 退款失败超过 24 小时或重试耗尽后，买家端显示“退款已转人工处理”。
- 卖家 `RECEIVED_BY_SELLER` 的换货单可以继续生成面单并发货。
- `SELLER_REJECTED_RETURN` 仲裁通过不会要求买家重复寄回。
- 已生成退货面单但未揽收超时，会按规则提醒、取消、退款或转人工，不留到实施时再决定。
- 订单详情可以直达售后详情并确认换货收货。
- 售后详情可展示退货面单、换货面单、退款单、退款历史和售后状态历史。
