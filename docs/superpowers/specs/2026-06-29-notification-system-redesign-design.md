# 三端统一通知系统重写设计方案

## 背景

爱买买早期只有买家 App 的消息中心，后端通过 `InboxService.send()` 直接写 `InboxMessage`。当时业务事件较少，这种做法可以覆盖 VIP 开通、红包到账等简单提醒。

现在系统已经增加了顺丰履约、售后闭环、发票、微信支付、消费积分双轨、数字资产、团购、智能客服、买家公开编号、收货信息纠错等功能。消息仍停留在早期结构，导致三类问题：

1. 买家需要感知的重要异步变化没有提醒，只能主动进页面查。
2. 卖家和管理端缺少独立通知中心，部分卖家任务被写进买家 App 的个人 Inbox。
3. 后端消息类型、分类、跳转路由没有统一契约，前端只能用兜底图标和路径前缀猜测。

## 当前代码问题

### 数据模型过薄

`InboxMessage` 只有 `userId/category/type/title/content/unread/target`，缺少受众、业务实体、幂等键、优先级、已读时间、过期时间、发送通道和结构化元数据。

### 发送入口过散

业务模块直接调用 `InboxService.send()`，传入自由字符串。当前后端实际已经发送 `order`、`risk` 等 App 类型定义不认识的分类，也发送了 `delivered`、`shipped`、`withdraw_paid`、`logistics_exception` 等前端 `InboxType` 未声明的类型。

### 事务边界不清

部分通知在 Serializable 事务中直接写全局 Prisma，部分通知用 `setImmediate` 从事务里绕出。业务回滚、重试或重复回调时，可能出现消息误发或重复发送。

### 三端受众混淆

卖家新订单、超卖补货、订单取消等任务现在发送到企业 OWNER 对应的买家用户 Inbox。卖家后台和管理后台没有统一通知入口，也没有独立未读角标。

### 路由契约脆弱

App 消息中心用路径前缀白名单校验跳转。`/me` 前缀会放过不存在的 `/me/bookings`、`/me/rewards`，历史 seed 数据里仍存在这些旧路径。

### 通知设置没有落地

App 的通知设置只是本地 UI state，没有后端偏好，也没有和站内信、Push、短信通道联动。

## 目标

第一阶段重写为统一通知系统，建立三端通用底座，先完整落地买家 App 站内信体验。

- 统一后端事件入口：业务模块只发标准通知事件，不直接写消息表。
- 统一事件契约：事件类型、受众、模板、动作路由、幂等键全部注册化。
- 事务安全：通过 Outbox 在业务事务提交后派发通知。
- 三端分流：买家、卖家、管理端分别有受众和消息入口。
- 买家优先：先修复买家消息中心类型、路由、未读角标、分页、已读状态。
- 兼容上线：保留旧 `InboxMessage` 一段时间，迁移旧数据，不一次性删除旧接口。

## 非目标

- 第一阶段不接真实 Push/SMS/企业微信，只把通道字段和偏好模型预留好。
- 第一阶段不做营销推送系统，不支持运营手工群发。
- 第一阶段不做复杂站外通知频控，只做站内信幂等和同事件去重。
- 第一阶段不改变订单、售后、发票、团购、数字资产的业务状态机。

## 产品原则

1. 用户刚刚主动完成的同步动作不发站内信，用页面状态或 Toast 即可。
2. 对方操作、系统异步变化、钱变动、异常失败、需要用户行动，必须发通知。
3. 买家消息只承载买家应知道或应处理的事；卖家任务进入卖家通知；管理风险进入管理通知。
4. 高价值消息必须可跳转到明确业务页；不可跳转消息只能用于纯信息，不应承担待办。
5. 文案要说明“发生了什么、是否需要处理、去哪里处理”，避免只有状态名。

## 架构设计

### 新增通知层

新增 `NotificationModule`，提供三个核心组件：

- `NotificationService`: 业务模块调用的唯一入口，负责写入 Outbox。
- `NotificationRegistry`: 事件注册表，定义事件类型、受众解析、模板、动作路由、默认优先级。
- `NotificationDispatcher`: 定时消费 Outbox，按注册表生成三端消息。

业务模块不再直接调用 `InboxService.send()`。短期兼容阶段保留 `InboxService`，但其内部改为读取新通知消息，或作为旧 API 的适配层。

### 数据模型

新增 `NotificationMessage`，作为三端统一消息表：

- `recipientKind`: `BUYER_USER` / `SELLER_STAFF` / `ADMIN_USER`
- `recipientKey`: 统一收件人键，例如 `buyer:userId`、`seller:userId`、`admin:adminUserId`
- `audience`: `BUYER_APP` / `SELLER_CENTER` / `ADMIN_CENTER`
- `category`: 前端分组，例如 `order`、`after_sale`、`wallet`、`system`、`risk`
- `eventType`: 标准事件类型，例如 `order.shipped`
- `title` / `body`
- `severity`: `INFO` / `SUCCESS` / `WARNING` / `CRITICAL`
- `entityType` / `entityId`
- `action`: 结构化动作 `{ routeKey, params }`
- `metadata`: 展示和排查用的结构化扩展
- `readAt`: 为空表示未读
- `expiresAt`: 可选过期时间
- `idempotencyKey`: 每个收件人内唯一

新增 `NotificationOutbox`：

- `eventType`
- `aggregateType` / `aggregateId`
- `payload`
- `idempotencyKey`
- `status`: `PENDING` / `PROCESSING` / `SENT` / `FAILED`
- `attempts`
- `runAt`
- `lastError`

Outbox 使用唯一 `idempotencyKey` 防止支付回调、物流回调、Cron 重试导致重复消息。

### 路由契约

后端不再直接传任意 App path。通知动作使用 `routeKey`：

- 买家：`ORDER_DETAIL`、`ORDER_TRACK`、`AFTER_SALE_DETAIL`、`INVOICE_DETAIL`、`WALLET`、`COUPONS`、`DIGITAL_ASSETS`、`GROUP_BUY_DETAIL`、`CS_SESSION`
- 卖家：`SELLER_ORDER_DETAIL`、`SELLER_AFTER_SALE_DETAIL`、`SELLER_PRODUCT_DETAIL`
- 管理端：`ADMIN_AFTER_SALE_DETAIL`、`ADMIN_INVOICE_DETAIL`、`ADMIN_WITHDRAW_DETAIL`、`ADMIN_CS_WORKSTATION`

各前端维护本端 `routeKey -> route` 映射。未知 `routeKey` 不跳转，只显示“暂无可跳转页面”，同时记录前端日志。

## 三端消息分类

### 买家 App

- `order`: 订单、物流、收货信息纠错。
- `after_sale`: 售后审核、退货、换货、仲裁、退款。
- `wallet`: 消费积分、提现、红包、数字资产。
- `group_buy`: 团购资格、分享码、返利。
- `service`: 客服会话、工单状态。
- `system`: 账号、安全、协议和平台系统消息。

### 卖家中心

- `orders`: 新订单、待发货、取消、收货信息已修正。
- `after_sale`: 新售后、退货已寄回、待验收、换货待发、仲裁结果。
- `inventory`: 超卖、低库存、商品异常。
- `products`: 商品审核、上下架、草稿/资料问题。
- `risk`: 虚拟号、面单、企业资料、风控提醒。

### 管理后台

- `risk`: 资金、支付、提现、退款、物流异常。
- `ops`: 商户入驻、商品审核、履约异常。
- `finance`: 发票、提现、对账。
- `customer_service`: 客服排队、工单 SLA、差评评价。
- `system`: 配置、任务、后台运行状态。

## 事件矩阵

### 买家订单与物流

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `order.shipped` | 卖家发货成功或面单进入已发货状态 | 买家 | 订单详情 |
| `order.delivered` | 顺丰签收并订单进入 `DELIVERED` | 买家 | 物流页 |
| `order.autoReceived` | 系统自动确认收货 | 买家 | 订单详情 |
| `order.receiverInfoRequired` | 顺丰拒绝收件手机号/电话 | 买家 | 订单详情 |
| `order.cancelRefundProcessing` | 未发货取消退款已提交渠道 | 买家 | 订单详情 |
| `order.refundSucceeded` | 订单退款成功 | 买家 | 订单详情 |
| `logistics.exception` | 退签、退回、长时间卡单 | 买家；严重时管理端 | 物流页 |

### 买家售后

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `afterSale.requested` | 买家提交售后后通知卖家 | 卖家 | 售后详情 |
| `afterSale.approved` | 卖家或系统同意 | 买家 | 售后详情 |
| `afterSale.rejected` | 卖家驳回 | 买家 | 售后详情 |
| `afterSale.returnRequired` | 同意且需要买家寄回 | 买家 | 售后详情 |
| `afterSale.returnShipped` | 买家填写退货物流 | 卖家 | 售后详情 |
| `afterSale.receivedBySeller` | 卖家确认收货或系统自动收货 | 买家 | 售后详情 |
| `afterSale.sellerRejectedReturn` | 卖家验收退货不合格 | 买家 | 售后详情 |
| `afterSale.replacementShipped` | 卖家发出换货 | 买家 | 售后详情 |
| `afterSale.arbitrationRequested` | 买家申请平台仲裁 | 管理端；卖家 | 售后详情 |
| `afterSale.arbitrationResolved` | 管理端仲裁完成 | 买家；卖家 | 售后详情 |
| `afterSale.closedByTimeout` | 系统超时关闭 | 买家 | 售后详情 |
| `afterSale.refunded` | 售后退款到账 | 买家 | 售后详情 |

### 发票

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `invoice.requested` | 买家提交开票申请 | 管理端 | 发票详情 |
| `invoice.issued` | 管理端或自动开票成功 | 买家 | 发票详情 |
| `invoice.failed` | 开票失败或自动重试耗尽 | 买家；管理端 | 发票详情 |

### 钱包、红包、数字资产

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `reward.credited` | 奖励入账冻结 | 买家 | 钱包 |
| `reward.unfrozen` | 奖励解冻可用 | 买家 | 钱包 |
| `reward.expired` | 奖励过期 | 买家 | 钱包 |
| `withdraw.processing` | 提现进入渠道处理 | 买家 | 钱包 |
| `withdraw.paid` | 提现到账 | 买家 | 钱包 |
| `withdraw.failed` | 提现失败退回 | 买家；严重时管理端 | 钱包 |
| `coupon.granted` | 红包到账 | 买家 | 红包 |
| `coupon.expiring` | 红包即将过期 | 买家 | 红包 |
| `coupon.expired` | 红包过期 | 买家 | 红包 |
| `digitalAsset.frozen` | 支付后消费资产冻结 | 买家 | 数字资产 |
| `digitalAsset.released` | 确认收货后资产释放 | 买家 | 数字资产 |
| `digitalAsset.reversed` | 退款/退货扣回 | 买家 | 数字资产 |
| `digitalAsset.adjusted` | 管理端后台调整 | 买家；管理端审计 | 数字资产 |

### 团购

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `groupBuy.codeActivated` | 团购订单具备分享资格并生成分享码 | 买家 | 团购详情 |
| `groupBuy.referralPaid` | 有人通过分享码购买，返利进入待确认 | 发起人 | 团购详情 |
| `groupBuy.rebateReleased` | 被推荐订单确认收货，返利释放 | 发起人 | 钱包 |
| `groupBuy.completed` | 分享层级完成 | 发起人 | 团购详情 |
| `groupBuy.expired` | 活动结束或资格失效 | 发起人 | 团购详情 |

### 客服

| 事件 | 触发时机 | 收件人 | 动作 |
| --- | --- | --- | --- |
| `cs.agentReplyOffline` | 坐席回复时买家不在会话页 | 买家 | 客服会话 |
| `cs.sessionAssigned` | 排队会话被坐席接入 | 买家 | 客服会话 |
| `cs.ticketCreated` | AI 转人工形成工单 | 管理端客服 | 工作台 |
| `cs.queueSlaBreached` | 排队超时 | 管理端客服 | 工作台 |

## 兼容与迁移

1. 新增 `NotificationMessage` 和 `NotificationOutbox`，不立即删除 `InboxMessage`。
2. `/inbox` 买家接口先改为读取 `NotificationMessage` 中 `audience=BUYER_APP` 的消息。
3. 编写一次性迁移脚本，将旧 `InboxMessage` 转入 `NotificationMessage`。无法识别的旧类型统一映射为 `system.legacyInfo`，无效路由去掉动作。
4. 完成迁移后保留旧表一个版本周期，账号注销和游客清理同步删除新旧两张消息表。
5. 后续版本删除业务模块对 `InboxService.send()` 的调用，禁止新增直写。

## 错误处理

- Outbox 派发失败时记录 `lastError`，指数退避重试，超过最大次数后标记 `FAILED`。
- 模板缺失、收件人解析失败、路由键未知都不阻塞主业务，只记录结构化错误并进入管理端风险通知。
- 同一 `recipientKey + idempotencyKey` 已存在时视为成功，返回既有消息。
- 消息读取接口分页返回，默认 20 条，最大 50 条。

## 安全与隐私

- 买家消息不得包含未脱敏手机号、身份证、银行卡、详细地址。
- 卖家消息继续遵守买家公开编号和隐私边界，不展示内部 `User.id`。
- 管理端风险消息可包含排查所需实体 ID，但不直接展示敏感明文。
- 路由参数只能包含业务 ID，不把完整用户隐私放入 `action.params`。
- 涉及资金、库存、订单状态、售后状态的业务改动仍按现有 Serializable 规则执行；通知只在事务内写 Outbox，不直接写最终消息。

## 验收标准

- 后端所有新通知通过 `NotificationService.emit()` 或等价 Outbox 入口发送。
- 买家 App 消息中心可以正确展示订单、售后、钱包、团购、客服、系统分类。
- 买家已读单条/全部已读后，“我的”页消息角标立即同步刷新。
- 后端重复支付回调、物流回调、Cron 重试不会生成重复消息。
- 卖家通知不再进入买家 App Inbox。
- 管理端和卖家端具备可查询未读数和标记已读的后端接口。
- 旧 seed 消息不会跳转到不存在页面。
- 关键事件矩阵中的 P0/P1 事件有单元测试或集成测试覆盖。
