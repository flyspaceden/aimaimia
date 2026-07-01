# 配送一次付款多次提货与货拉拉接入设计方案

> 状态：设计已确认，待实施计划
> 创建时间：2026-06-30
> 适用范围：买家 App / 配送管理后台 / 配送中心 / 后端 / 配送数据库 / 货拉拉企业版 API / 运费对账
>
> **For agentic workers:** 本文档是配送系统“一次付款，多次提货”功能的权威设计来源。该功能只扩展现有 `delivery` 独立业务线，不并入普通商城订单、普通运费、普通售后或普通分润体系。实现时必须保持配送数据库、配送账号、配送权限、配送成本记录独立。

## 1. 背景与目标

现有配送系统已经在 `staging` 上形成独立业务线：买家 App 内有 `/delivery` 模块，后端有 `backend/prisma-delivery/schema.prisma` 和 `backend/src/modules/delivery/**`，并有独立的 `delivery-admin` 管理后台和 `delivery-seller` 配送中心。

当前履约模型偏“一次付款，一次整体发货”：支付成功后创建 `DeliveryOrder`、`DeliverySubOrder`、`DeliveryOrderItem`，配送中心对整个子订单执行一次 `POST /delivery-seller/orders/:subOrderId/ship`，后端生成一条 `DeliveryShipment` 并接顺丰面单。

新需求是“一次付款，多次提货”：

- 用户第一次下单时一次性支付商品金额和预计多次提货运费。
- 用户在购买时选择预计分几次提货。
- 后续每次提货由平台通过货拉拉企业版账户/月结叫车。
- 后续每次货拉拉实际费用不再向用户单独收款，计入平台承运成本。
- App、配送管理后台、配送中心都要有对应改动。

目标是在不破坏现有一次支付建单链路的前提下，增加“提货批次”作为订单和承运商订单之间的新履约层。

## 2. 总体原则

### 2.1 一次支付原则

买家只在配送结算页支付一次，支付金额为：

```text
应付总额 = 商品金额 + 预收提货运费
```

预收提货运费来自用户选择的提货次数和系统计价结果。支付成功后，商品库存一次性锁定或扣减，订单生成后用户通过提货批次逐步核销可提货数量。

### 2.2 批次履约原则

新增 `DeliveryPickupBatch` 作为履约批次。每个批次表示一次真实提货/叫车/交货动作。一个配送订单可以有多个批次，一个批次可以包含多个订单项的部分数量。

现有配送订单会按商家拆成 `DeliverySubOrder`。因此批次的实际履约边界必须是单个 `DeliverySubOrder` 和单个 `merchantId`，不能把不同商家的货默认合并到同一辆货拉拉车。买家 App 和管理后台可以按 `DeliveryOrder` 汇总展示，但创建、叫车、备货、交货和成本归集必须落到子单批次。

订单不再用单一 `SHIPPED` 表达全部履约，而要同时展示：

- 订单支付状态。
- 总体提货进度。
- 每个商品的已提数量和剩余可提数量。
- 每个批次的货拉拉状态。

### 2.3 平台成本原则

货拉拉实际费用由平台企业账户或月结承担。配送管理后台记录：

- 用户预收运费。
- 每批预计运费。
- 每批货拉拉实际成本。
- 订单层运费差额。

第一版不自动向用户补收或退款。差额只进入平台成本和毛利对账。

### 2.4 权限隔离原则

配送管理后台可以看到预收运费、货拉拉实际成本和差额。

配送中心只看到履约所需信息：批次商品、数量、收货/提货信息、司机、车辆、到达状态和交货记录。配送中心不得看到平台预收运费、货拉拉实际成本、平台差额、平台毛利或最终加价规则。

## 3. 货拉拉官方能力

优先接入货拉拉企业版 API，不优先接个人版或零担版。

官方开放平台入口：

- `https://open.huolala.cn/`
- 企业版计价：`https://open.huolala.cn/#/doc/api?menu=9&type=2&id=48`
- 企业版下单：`https://open.huolala.cn/#/doc/api?menu=9&type=2&id=8`
- 企业版订单详情：`https://open.huolala.cn/#/doc/api?menu=9&type=2&id=9`
- 企业版外部单号查询：`https://open.huolala.cn/#/doc/api?menu=9&type=2&id=47`
- 企业版取消订单：`https://open.huolala.cn/#/doc/api?menu=9&type=2&id=11`

第一版使用的接口能力：

| 场景 | 货拉拉 api_method | 用途 |
|---|---|---|
| 城市/车型 | `e-city-list` / `e-city-info` | 后台配置和计价前置数据 |
| 地址检索 | `e-poi-search` | 管理后台创建批次叫车时辅助选址 |
| 计价 | `e-price-calculate` | 结算页预估批次运费、后台批次叫车前复算 |
| 下单 | `e-order-request` | 管理后台为某个提货批次创建货拉拉订单 |
| 查单 | `e-order-detail` / `e-order-detail-by-outside-id` | 同步司机、车辆、状态、实际费用 |
| 取消 | `e-order-cancel` | 批次未装货前取消货拉拉订单 |
| 司机位置 | `e-order-driver-location` | 后台和配送中心展示司机位置 |
| 事件位置 | `e-order-driver-event-location` | 同步装货、卸货、完成等履约节点 |

货拉拉要求计价和下单参数严格一致，尤其是城市、车型、城市版本、地址、用车时间、附加服务、总价和 `price_calculate_id`。因此系统必须保存计价快照，并在下单时校验快照有效性；过期后必须重新计价。

## 4. 用户流程

### 4.1 App 下单

用户在配送购物车和结算页选择商品后，结算页新增“提货安排”区块：

```text
提货方式：分批提货
预计提货次数：1 / 2 / 3 / 自定义
每批计划：系统按数量平均拆分，用户可调整每批数量
```

结算页展示：

- 商品金额。
- 预计提货运费总额。
- 每批预计运费。
- 总应付金额。
- 运费说明：后续叫车由平台安排，用户无需再次支付；实际承运成本由平台承担并记录。

第一版限制：

- 如果一个配送订单包含多个商家，系统按商家子单拆分提货批次；买家选择的提货次数是每个商家子单的最大计划批次数，不代表跨商家合车。
- 同一订单的每个商品总提货数量必须等于购买数量。
- 每批数量必须大于 0。
- 批次数量上限由后台配置，默认最多 5 批。
- 第一版不允许用户付款后自行新增提货次数；需要改计划时由配送管理后台处理。

### 4.2 App 订单详情

配送订单详情新增“提货进度”：

- 总提货进度：例如 `已提 30 / 总 100`。
- 每个商品：购买数量、已提数量、剩余数量。
- 每个批次：计划数量、状态、货拉拉订单号、司机/车辆信息、预计到达、完成时间。

用户可查看批次状态，但不在 App 中直接发起货拉拉叫车。第一版由平台管理后台安排叫车。

### 4.3 配送管理后台

管理后台是平台控制中心，负责：

- 配置运费规则和货拉拉参数。
- 查看订单完整履约记录。
- 为提货批次叫车。
- 同步货拉拉订单状态。
- 处理异常。
- 做预收运费和实际成本对账。

### 4.4 配送中心

配送中心负责：

- 查看自己相关子订单的提货批次。
- 按批次备货。
- 查看司机、车辆和到达状态。
- 交货给司机后标记本批已交货。
- 导出每批履约清单。
- 反馈异常给管理后台。

配送中心不发起平台月结叫车，不查看平台成本和差额。

## 5. 数据模型

在 `backend/prisma-delivery/schema.prisma` 中新增或扩展以下模型。字段名可以在实施计划中根据现有命名进一步调整，但语义必须保持一致。

### 5.1 订单和订单项扩展

`DeliveryOrder` 新增：

- `pickupMode`：默认 `SINGLE`，新功能为 `MULTI_BATCH`。
- `plannedPickupCount`：用户下单时选择的提货次数。
- `pickupStatus`：订单提货状态。
- `prepaidShippingFeeCents`：用户首付中预收的提货运费。
- `actualCarrierCostCents`：已同步的实际承运成本汇总。
- `shippingCostDiffCents`：预收运费减实际成本。

`DeliveryOrderItem` 新增：

- `pickedQuantity`：已完成提货数量。
- `reservedPickupQuantity`：已被未完成批次占用的数量。

### 5.2 新增枚举

`DeliveryPickupStatus`：

- `NOT_STARTED`
- `PARTIAL_PICKED`
- `ALL_PICKED`
- `CANCELED`

`DeliveryPickupBatchStatus`：

- `PLANNED`
- `READY_TO_CALL`
- `CALLING_CARRIER`
- `WAITING_DRIVER`
- `DRIVER_ASSIGNED`
- `ARRIVED`
- `LOADED`
- `DELIVERING`
- `COMPLETED`
- `CANCELED`
- `EXCEPTION`

`DeliveryCarrierProvider`：

- `SF`
- `HUOLALA`
- `MANUAL`

`DeliveryCarrierPaymentMode`：

- `PLATFORM_MONTHLY`
- `PLATFORM_WALLET`
- `MANUAL_OFFLINE`

### 5.3 提货批次

`DeliveryPickupBatch`：

- `id`：批次编号，例如 `PSTH0000000000001`。
- `orderId`
- `subOrderId`
- `merchantId`
- `batchNo`：订单内第几批。
- `status`
- `provider`：第一版为 `HUOLALA`。
- `plannedPickupAt`
- `readyAt`
- `calledAt`
- `loadedAt`
- `completedAt`
- `canceledAt`
- `receiverSnapshot`
- `senderSnapshot`
- `cargoSnapshot`
- `estimatedShippingFeeCents`
- `actualCarrierCostCents`
- `shippingCostDiffCents`
- `createdByAdminId`
- `lastOperatorType`
- `lastOperatorId`
- `remark`
- `createdAt`
- `updatedAt`

### 5.4 批次商品

`DeliveryPickupBatchItem`：

- `id`
- `batchId`
- `orderItemId`
- `skuId`
- `productSnapshot`
- `quantity`
- `pickedQuantity`
- `createdAt`

约束：

- 同一个订单项所有未取消批次的 `quantity` 之和不得超过 `DeliveryOrderItem.quantity`。
- 批次完成后增加订单项 `pickedQuantity`。
- 批次取消后释放 `reservedPickupQuantity`。

所有数量占用、释放和完成核销必须在 `Serializable` 事务内完成。

### 5.5 货拉拉订单记录

`DeliveryCarrierOrder`：

- `id`
- `batchId`
- `provider`：`HUOLALA`
- `outsideOrderId`：平台传给货拉拉的外部订单号。
- `carrierOrderNo`：货拉拉订单号。
- `priceCalculateId`
- `cityId`
- `vehicleId`
- `payType`：月结或企业账户。
- `status`
- `driverSnapshot`
- `vehicleSnapshot`
- `estimatePayload`
- `orderPayload`
- `detailPayload`
- `cancelPayload`
- `estimatedFeeCents`
- `actualFeeCents`
- `lastSyncedAt`
- `createdAt`
- `updatedAt`

`outsideOrderId` 必须全局唯一，建议使用批次编号，便于用 `e-order-detail-by-outside-id` 查询。

### 5.6 成本流水

`DeliveryShippingCostLedger`：

- `id`
- `orderId`
- `subOrderId`
- `batchId`
- `provider`
- `type`：`PREPAID_BY_USER` / `CARRIER_ESTIMATE` / `CARRIER_ACTUAL` / `MANUAL_ADJUSTMENT`
- `amountCents`
- `source`
- `sourceRefId`
- `payloadSnapshot`
- `createdByType`
- `createdById`
- `createdAt`

该表用于配送管理后台运费中心和对账，不展示给配送中心。

### 5.7 操作日志

复用或扩展 `DeliveryAuditLog`，记录：

- 创建提货计划。
- 创建/调整/取消批次。
- 发起货拉拉叫车。
- 同步货拉拉状态。
- 人工标记异常。
- 配送中心备货和交货。

## 6. 后端服务设计

新增 `backend/src/modules/delivery/pickup/**`：

- `DeliveryPickupService`
- `DeliveryPickupController`：买家 App 只读批次和计划。
- `DeliveryAdminPickupController`：管理后台创建批次、叫车、同步、异常处理。
- `DeliverySellerPickupController`：配送中心备货、交货、异常反馈。

新增 `backend/src/modules/delivery/carriers/**`：

- `DeliveryCarrierAdapter`
- `HuolalaCarrierService`
- `ManualCarrierService`
- 现有顺丰路径后续可接成 `SfCarrierService`，但第一版不强制迁移顺丰。

`HuolalaCarrierService` 职责：

- 生成签名。
- 调用计价。
- 调用下单。
- 查询订单详情。
- 查询司机位置。
- 取消订单。
- 将货拉拉状态映射为 `DeliveryPickupBatchStatus`。

关键事务：

- 创建或调整提货计划：`Serializable`。
- 批次数量占用和释放：`Serializable`。
- 货拉拉下单成功后写入本地订单号和状态：`Serializable`。
- 批次完成核销：`Serializable`。

## 7. API 设计

### 7.1 App API

`POST /delivery/checkout/estimate-pickups`

用于结算页预估多批提货运费。

请求包含：

- `cartItemIds`
- `addressId`
- `plannedPickupCount`
- `pickupPlanItems`

返回：

- 商品金额。
- 每批预计运费。
- 按商家子单拆分后的批次预估。
- 预收运费总额。
- 总应付金额。
- 计价来源。

`POST /delivery/checkout`

扩展现有 checkout payload，增加：

- `pickupMode`
- `plannedPickupCount`
- `pickupPlanSnapshot`
- `prepaidShippingFeeCents`

`GET /delivery/orders/:id`

扩展返回：

- `pickupStatus`
- `plannedPickupCount`
- `prepaidShippingFee`
- `items[].pickedQuantity`
- `items[].remainingQuantity`
- `pickupBatches[]`

### 7.2 管理后台 API

`GET /delivery-admin/freight/dashboard`

返回预收运费、实际成本、差额、异常批次数。

`GET /delivery-admin/freight/batches`

按订单、单位、商家、状态、货拉拉状态、时间筛选批次。

`POST /delivery-admin/pickup-batches/:id/call-huolala`

管理后台发起货拉拉叫车。

`POST /delivery-admin/pickup-batches/:id/sync-carrier`

主动同步货拉拉状态。

`POST /delivery-admin/pickup-batches/:id/cancel-carrier`

取消未装货前的货拉拉订单。

`POST /delivery-admin/pickup-batches/:id/manual-adjust-cost`

人工调整成本流水，必须写审计。

`GET /delivery-admin/orders/:id`

扩展为完整订单履约详情。

### 7.3 配送中心 API

`GET /delivery-seller/pickup-batches`

查询本商家的提货批次。

`GET /delivery-seller/pickup-batches/:id`

查询批次详情。

`POST /delivery-seller/pickup-batches/:id/mark-ready`

标记已备货。

`POST /delivery-seller/pickup-batches/:id/mark-loaded`

标记已交给司机。

`POST /delivery-seller/pickup-batches/:id/report-exception`

反馈异常给管理后台。

配送中心 API 返回值不得包含：

- `prepaidShippingFeeCents`
- `actualCarrierCostCents`
- `shippingCostDiffCents`
- `estimatedShippingFeeCents`
- 平台最终售价或平台毛利字段。

## 8. App 改造

涉及页面：

- `app/delivery/checkout.tsx`
- `app/delivery/orders/index.tsx`
- `app/delivery/orders/[id].tsx`
- `src/repos/delivery/DeliveryOrderRepo.ts`

结算页：

- 新增提货次数选择。
- 展示每批计划。
- 展示预计提货运费和总应付。
- 用户提交前必须确认每个商品总计划数量等于购买数量。

订单列表：

- 状态文案增加 `部分提货中`、`已全部提货`。

订单详情：

- 商品清单展示已提和剩余。
- 新增批次时间线。
- 每批展示货拉拉状态、司机、车牌、预计到达和完成时间。

## 9. 配送管理后台改造

涉及页面：

- `delivery-admin/src/pages/delivery-admin/orders.tsx`
- `delivery-admin/src/pages/delivery-admin/order-detail.tsx`
- `delivery-admin/src/pages/delivery-admin/shipping-records.tsx`
- 新增 `delivery-admin/src/pages/delivery-admin/freight-center.tsx`
- 新增 `delivery-admin/src/pages/delivery-admin/pickup-batches.tsx`

运费中心：

- 顶部指标：预收运费、实际货拉拉成本、差额、异常批次数。
- 列表：订单号、批次号、单位、商家、提货状态、预计运费、实际成本、差额、货拉拉订单号、司机、车辆、更新时间。
- 筛选：时间、状态、城市、商家、单位、差额正负、异常类型。
- 操作：同步、取消、人工调整成本、查看详情。

订单详情：

- 支付拆分：商品金额、预收运费、总支付。
- 提货计划：计划批次数，每批商品和数量。
- 批次履约记录：状态、货拉拉订单、司机、车辆、操作日志。
- 成本记录：预收、预计、实际、调整、差额。
- 异常记录：失败、取消、超时、费用异常。

## 10. 配送中心改造

涉及页面：

- `delivery-seller/src/pages/orders/index.tsx`
- `delivery-seller/src/pages/orders/detail.tsx`
- 新增 `delivery-seller/src/pages/pickup-batches/index.tsx`
- 新增或扩展 `delivery-seller/src/api/orders.ts`

订单详情：

- 从单个发货按钮改为批次列表。
- 每批展示本批商品、数量、买家单位、收货信息。
- 展示司机、车牌、手机号/虚拟号、预计到达、货拉拉状态。
- 支持“已备货”和“已交货”操作。
- 支持导出本批履约清单。

配送中心不可见字段：

- 用户预收运费。
- 货拉拉实际成本。
- 平台差额。
- 平台定价规则。
- 平台毛利。

## 11. 状态机

订单提货状态：

```text
NOT_STARTED -> PARTIAL_PICKED -> ALL_PICKED
NOT_STARTED -> CANCELED
PARTIAL_PICKED -> CANCELED
```

批次状态：

```text
PLANNED
  -> READY_TO_CALL
  -> CALLING_CARRIER
  -> WAITING_DRIVER
  -> DRIVER_ASSIGNED
  -> ARRIVED
  -> LOADED
  -> DELIVERING
  -> COMPLETED
```

异常分支：

```text
CALLING_CARRIER / WAITING_DRIVER / DRIVER_ASSIGNED / ARRIVED -> CANCELED
任意未完成状态 -> EXCEPTION
EXCEPTION -> READY_TO_CALL / CANCELED
```

批次 `COMPLETED` 后不可再调整数量。若需要更正，只能由管理后台创建人工调整记录，并写入审计日志。

## 12. 运费与成本规则

### 12.1 预收运费

预收运费在结算时确定，写入 checkout 和 order 快照。

计价优先级：

1. 调用货拉拉企业版计价接口。
2. 货拉拉计价失败时使用平台兜底规则。
3. 平台兜底规则缺失时不允许提交多次提货订单。

### 12.2 实际成本

实际成本来自货拉拉订单详情或账单同步。第一版可以先按货拉拉订单详情中的费用字段同步；后续可接货拉拉账单或财务流水。

### 12.3 差额处理

```text
差额 = 用户预收运费 - 实际货拉拉成本 + 人工调整
```

第一版差额只用于平台内部对账，不自动退款、不自动补收、不影响配送中心结算。

## 13. 安全与一致性

本功能涉及金额、库存、支付、状态转换和承运商下单，必须执行以下安全要求：

- 创建 checkout 和付款成功建单继续使用 `Serializable`。
- 批次数量占用、释放、完成核销必须使用 `Serializable`。
- 货拉拉下单必须幂等，`outsideOrderId` 使用批次编号。
- 货拉拉下单成功但本地落库失败时必须有补偿或异常记录。
- 管理后台人工调整成本必须写审计日志。
- 配送中心接口必须按 `merchantId` 隔离，只能操作本商家批次。
- 配送中心返回 DTO 必须过滤平台成本字段。
- 货拉拉密钥、access token、月结账户配置只存后端环境或受控配置，不进入前端。

## 14. 测试范围

后端：

- Prisma validate。
- 多批次数量不能超过订单项数量。
- 并发创建/调整批次不超量。
- 批次取消释放数量。
- 批次完成增加已提数量。
- 货拉拉下单幂等。
- 货拉拉同步状态映射。
- 管理后台能看到成本，配送中心看不到成本。

App：

- 结算页提货次数和计划数量校验。
- 订单详情展示剩余可提数量和批次状态。
- 大字体和小屏不遮挡金额、批次状态和按钮。

配送管理后台：

- 运费中心筛选、指标、差额展示。
- 订单详情完整履约记录。
- 异常批次处理。

配送中心：

- 批次列表。
- 已备货、已交货。
- 异常反馈。
- 成本字段不可见。

## 15. 发布与迁移

该功能只作用于新建配送订单。历史配送订单保持原有单次发货模型，不做批次回填。

上线顺序：

1. 数据库迁移和后端 DTO/服务。
2. 管理后台运费中心和批次管理。
3. 配送中心批次履约。
4. App 结算和订单详情。
5. 货拉拉沙箱或测试账户联调。
6. staging 真机与后台联调。
7. production 灰度开启多次提货入口。

配置开关：

- `DELIVERY_MULTI_PICKUP_ENABLED`
- `DELIVERY_HUOLALA_ENABLED`
- `DELIVERY_HUOLALA_BASE_URL`
- `DELIVERY_HUOLALA_APP_KEY`
- `DELIVERY_HUOLALA_APP_SECRET`
- `DELIVERY_HUOLALA_ACCESS_TOKEN`
- `DELIVERY_HUOLALA_PAY_TYPE`
- `DELIVERY_HUOLALA_MONTHLY_ACCOUNT_ID`
- `DELIVERY_MULTI_PICKUP_MAX_BATCHES`

## 16. 第一版不做

- 不做用户付款后自助增加提货次数。
- 不做预收运费和实际成本差额的自动退款或补收。
- 不做配送中心发起货拉拉叫车。
- 不做普通商城订单接入该提货模型。
- 不做普通用户售后退款和配送批次联动。
- 不做货拉拉账单自动开票。
- 不做多承运商自动比价。

## 17. 验收标准

- 用户可在 App 配送结算页选择提货次数并一次性付款。
- 支付成功后订单生成提货计划和批次。
- 管理后台可查看订单完整履约记录、预收运费、实际成本和差额。
- 管理后台可对某个批次发起货拉拉叫车并同步状态。
- 配送中心可按批次备货和交货，但看不到平台成本和差额。
- 订单详情能准确展示每个商品的已提数量和剩余可提数量。
- 并发操作不会导致批次数量超过购买数量。
- 货拉拉下单和同步失败时有异常记录，可人工处理。
