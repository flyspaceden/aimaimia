# 数字资产累计消费设计方案

> 状态：设计已确认，待实施计划
> 创建时间：2026-06-14
> 适用范围：买家 App / 管理后台 / 后端 / Prisma Schema / 历史数据回填
>
> **For agentic workers:** 本文档是数字资产累计消费第一版的权威来源。第一版只沉淀“累计消费金额”基础数据和审计流水，不定义股权、期权、工资、资产价值、等级、兑换比例等后续规则。**注意：`docs/superpowers/specs/2026-06-17-digital-asset-v2-rules-design.md` 已补充并覆盖本文件中“VIP 礼包计入累计消费”“仅展示累计消费金额”等旧口径；涉及数字资产 V2 的实现、法务、发布与对外说明，请以后者为准。**

## 背景

平台需要记录每个用户的累计消费，作为后续“数字资产”体系的基础数据。未来该数据可能用于兑换股权、期权、工资、资产等级或其它权益，但这些规则尚未确定。

因此第一版的目标是：

1. 建立可审计、可回溯、可回填的累计消费数据底座。
2. 买家 App 提供“数字资产中心”雏形，真实展示“累计消费金额”。
3. 管理后台提供完整数字资产管理页，支持查询、流水、导出、超级管理员手动调整。
4. 严格隔离现有消费积分、平台红包、普通/VIP 分润系统，避免语义混淆。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 系统边界 | 新建独立 `digital-asset` 模块，不复用 `RewardAccount/RewardLedger` 或 Coupon 表 |
| 核心数据 | `DigitalAssetAccount` + `DigitalAssetLedger` |
| 入账时点 | 订单确认收货后入账 |
| 金额口径 | 商品实付金额，不含运费 |
| VIP 礼包 | 第一版曾定义为“计入累计消费”，该口径已被 2026-06-17 V2 规则覆盖为“不计入累计消费、不产生信用资产” |
| 售后/退款 | 退款/退货成功后按退款商品对应金额扣回 |
| 历史订单 | 回填所有已确认收货订单 |
| 买家 App | 增加“数字资产”入口，进入“数字资产中心”页面 |
| App 主文案 | “累计消费金额” |
| App 未来模块 | 资产价值、等级、权益福利、未来权益等仅展示“规则待公布/待开放” |
| 管理后台 | 做完整数字资产管理页：查询、流水、调整、导出、规则占位配置 |
| 手动调整 | 仅超级管理员可操作，必须填写原因，写审计流水 |

## 非目标

第一版不做以下内容：

- 不计算“数字资产价值”。
- 不定义累计消费到股权、期权、工资、等级或权益的兑换规则。
- 不允许用户发起兑换。
- 不把累计消费金额作为可提现余额、可抵扣余额或平台红包。
- 不改变现有普通/VIP 分润、消费积分双轨、平台红包发放规则。

## 与现有系统的关系

### 与 Reward 消费积分隔离

`RewardAccount/RewardLedger` 是消费积分和分润体系，支持提现和结算抵扣。累计消费金额不是余额，不能提现或抵扣，因此必须独立建模。

### 与 Coupon 平台红包隔离

`CouponTriggerType.CUMULATIVE_SPEND` 当前用于红包触发条件，现有实现会在确认收货后聚合 `Order.totalAmount` 判断发券。数字资产模块不替代红包触发逻辑。后续如需让红包触发使用数字资产累计金额，需要另起需求。

### 与普通/VIP 分润计数隔离

`VipProgress.selfPurchaseCount`、`NormalProgress.selfPurchaseCount` 是分润解锁中的“第几笔有效消费”计数，不等于累计消费金额。数字资产模块只记录金额基数。

## 数据模型

### 枚举

```prisma
enum DigitalAssetLedgerType {
  ORDER_RECEIVED      // 确认收货实时入账
  REFUND_REVERSAL     // 售后/退款成功扣回
  ADMIN_ADJUSTMENT    // 超级管理员手动调整
  BACKFILL            // 历史确认收货订单回填
}

enum DigitalAssetLedgerDirection {
  CREDIT  // 增加累计消费
  DEBIT   // 扣回累计消费
}
```

### 账户表

```prisma
model DigitalAssetAccount {
  id                    String   @id @default(cuid())
  userId                String   @unique
  user                  User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  cumulativeSpendAmount Float    @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  ledgers DigitalAssetLedger[]

  @@index([cumulativeSpendAmount])
  @@index([updatedAt])
}
```

### 流水表

```prisma
model DigitalAssetLedger {
  id            String                       @id @default(cuid())
  accountId     String
  account       DigitalAssetAccount          @relation(fields: [accountId], references: [id], onDelete: Restrict)
  userId        String
  user          User                         @relation(fields: [userId], references: [id], onDelete: Restrict)
  type          DigitalAssetLedgerType
  direction     DigitalAssetLedgerDirection
  amount        Float                       // 正数，方向由 direction 表示
  balanceAfter  Float

  orderId       String?
  order         Order?                       @relation(fields: [orderId], references: [id], onDelete: Restrict)
  orderItemId   String?
  orderItem     OrderItem?                   @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  refundId      String?
  refund        Refund?                      @relation(fields: [refundId], references: [id], onDelete: Restrict)
  afterSaleId   String?
  afterSale     AfterSaleRequest?            @relation(fields: [afterSaleId], references: [id], onDelete: Restrict)
  adminUserId   String?
  adminUser     AdminUser?                   @relation(fields: [adminUserId], references: [id], onDelete: Restrict)

  reason        String?
  idempotencyKey String                      @unique
  meta          Json?
  createdAt     DateTime                    @default(now())

  @@index([userId, createdAt])
  @@index([accountId, createdAt])
  @@index([orderId])
  @@index([orderItemId])
  @@index([refundId])
  @@index([afterSaleId])
  @@index([adminUserId, createdAt])
}
```

### User 关系

```prisma
model User {
  // ... existing fields ...
  digitalAssetAccount DigitalAssetAccount?
  digitalAssetLedgers DigitalAssetLedger[]
}
```

### Order / Refund / AfterSaleRequest / AdminUser 关系

实现时需要在相关模型上补反向关系，命名以 Prisma validate 通过为准。例如：

```prisma
model Order {
  // ... existing fields ...
  digitalAssetLedgers DigitalAssetLedger[]
}

model OrderItem {
  // ... existing fields ...
  digitalAssetLedgers DigitalAssetLedger[]
}

model Refund {
  // ... existing fields ...
  digitalAssetLedgers DigitalAssetLedger[]
}

model AfterSaleRequest {
  // ... existing fields ...
  digitalAssetLedgers DigitalAssetLedger[]
}

model AdminUser {
  // ... existing fields ...
  digitalAssetLedgers DigitalAssetLedger[]
}
```

## 金额计算规则

### 订单正向累计金额

正向累计只计算商品实付金额，不含运费：

```ts
orderAssetAmount = max(
  0,
  order.goodsAmount
    - order.vipDiscountAmount
    - order.discountAmount
    - (order.totalCouponDiscount ?? 0),
)
```

说明：

- `shippingFee` 不计入。
- 消费积分抵扣 `discountAmount` 不计入。
- 平台红包 `totalCouponDiscount` 不计入。
- VIP 折扣 `vipDiscountAmount` 不计入。
- VIP 礼包订单计入，按同一公式计算。当前 VIP 礼包订单的主订单商品金额应反映礼包实付基数。

### 多商户拆单

支付成功后一个 CheckoutSession 可能生成多个 `Order`。累计消费按每个已确认收货的 `Order` 单独入账。由于折扣已经在建单时按商户分摊到订单字段，数字资产模块直接使用订单字段，不再跨订单重新分摊。

### 退款/退货扣回金额

退款扣回以退款商品对应的实付商品金额为准，不含运费。第一版按下列优先级计算：

1. 如果 `RefundItem` 完整记录了行级退款商品和金额，则按退款行计算扣回。
2. 如果缺少 `RefundItem`，但存在 `AfterSaleRequest.orderItemId`，则用该售后单对应的 `orderItemId`、`orderItem.unitPrice`、`orderItem.quantity` 和 `AfterSaleRequest.refundAmount` 计算扣回；`returnShippingFee`、退货运费退款和售后运费支付退款均不计入数字资产扣回。
3. 每个订单商品行的可累计金额为：订单级商品实付金额按非奖品商品行成交金额比例分摊。
4. 分摊顺序固定为非奖品 `OrderItem.createdAt ASC, id ASC`。除最后一行外，每行 `assetAmount` 保留 2 位小数；最后一行承接尾差，确保所有行的 `assetAmount` 之和严格等于订单 `orderAssetAmount`。
5. 正向入账 ledger 的 `meta.itemAllocations` 必须保存每个 `orderItemId` 的分摊结果：`[{ orderItemId, skuId, quantity, grossAmount, assetAmount }]`，并记录尾差落在哪个 `orderItemId`。
6. 某行扣回金额为：`min(该 orderItemId 已入账未扣回累计金额, 本次退款对应的该行分摊累计金额)`。
7. 如果 `AfterSaleRequest.refundAmount` 混入退货运费或售后运费退款，进入数字资产扣回前必须先扣除对应运费部分，只保留商品退款金额。
8. 如果缺少 `RefundItem` 且 `AfterSaleRequest.orderItemId` 为空，但整单退款已成功，则扣回该订单剩余未扣回的全部正向累计金额。
9. 扣回总额不得超过该订单已累计入账且尚未扣回的金额。

奖品项 `isPrize=true` 默认不产生正向累计，也不产生扣回。

退款扣回 ledger 的 `meta.reversedItems` 必须保存本次扣回涉及的 `orderItemId`、数量、原分摊累计金额、本次扣回金额。这样管理后台可追踪每一次扣回来自哪一行商品，重复部分退款也能按行级剩余额度封顶。

## 幂等与一致性

### 统一正向订单幂等键

历史回填和实时确认收货必须共享同一个订单正向累计幂等键，避免重复累计：

```text
order:{orderId}:cumulative-spend-credit
```

如果回填先写入，后续不会再发生同一订单的确认收货入账。如果实时确认收货先写入，回填脚本再次扫描该订单时必须跳过。流水 `type` 可记录首次写入来源为 `ORDER_RECEIVED` 或 `BACKFILL`，但幂等键必须统一。

### 退款扣回幂等键

```text
refund:{refundId}:cumulative-spend-reversal
```

如果一个售后单产生多个退款记录，以 `refundId` 为准。若历史链路只有 `afterSaleId` 而无 `refundId`，使用：

```text
after-sale:{afterSaleId}:cumulative-spend-reversal
```

如果同一个售后单既有关联 `refundId` 又有 `afterSaleId`，只使用 `refundId` 幂等键，避免同一成功退款被重复扣回。

跨来源去重要求：

- `reverseRefund(refundId)` 必须先解析关联售后单：优先读取 `Refund.afterSaleId`，否则查询 `AfterSaleRequest.refundId=refundId`。
- 如果解析到 `afterSaleId`，且已经存在 `after-sale:{afterSaleId}:cumulative-spend-reversal` 对应 ledger，则不得再创建 `refund:{refundId}:...` ledger。可选择只补全既有 ledger 的 `refundId/meta.linkedRefundId`，或直接跳过并记录日志。
- `reverseAfterSale(afterSaleId)` 必须先检查售后单是否已有 `refundId`；如有，则委托 `reverseRefund(refundId)`，不得创建 `after-sale:{afterSaleId}:...` ledger。
- 如果 `reverseAfterSale(afterSaleId)` 已经创建兜底 ledger，后续补偿链路或数据修复新增 `Refund` 行时，`reverseRefund(refundId)` 必须识别既有 `afterSaleId` ledger 并跳过，避免同一部分退款被重复扣回。

### 管理员调整幂等键

手动调整由后端生成唯一幂等键：

```text
admin-adjust:{adminUserId}:{targetUserId}:{uuid}
```

前端可额外传 `clientIdempotencyKey`，用于弹窗重复提交保护。

### 事务要求

所有账户总额和流水写入必须在同一个 Serializable 事务中完成：

1. 查询或创建 `DigitalAssetAccount`。
2. 计算本次允许变动的 `delta`：正向入账为正数；退款扣回先按订单剩余可扣金额裁决；管理员扣减余额不足则拒绝。
3. 计算 `newBalance = oldBalance + delta`，且必须满足 `newBalance >= 0`。
4. 写 `DigitalAssetLedger(balanceAfter = newBalance)`。
5. 更新 `DigitalAssetAccount.cumulativeSpendAmount = newBalance`。

退款扣回和管理员负向调整必须禁止扣成负数，不能用静默截断掩盖过扣。除非后续另起 spec 明确允许负资产。

## 后端模块设计

### 模块结构

```text
backend/src/modules/digital-asset/
  digital-asset.module.ts
  digital-asset.service.ts
  digital-asset.controller.ts
  digital-asset-ledger-calculator.ts
  dto/
    digital-asset-query.dto.ts
    admin-adjust-digital-asset.dto.ts
    update-digital-asset-settings.dto.ts
  scripts/
    backfill-cumulative-spend.ts
```

管理后台 controller 可放在 `backend/src/modules/admin/digital-asset/`，但服务层应复用同一个 `DigitalAssetService`，避免两套记账逻辑。

### 服务方法

```ts
class DigitalAssetService {
  creditOrderReceived(orderId: string, source: 'ORDER_RECEIVED' | 'BACKFILL'): Promise<void>;
  reverseRefund(refundId: string): Promise<void>;
  reverseAfterSale(afterSaleId: string): Promise<void>;
  adjustByAdmin(params: {
    targetUserId: string;
    adminUserId: string;
    amount: number;
    direction: 'CREDIT' | 'DEBIT';
    reason: string;
    clientIdempotencyKey?: string;
  }): Promise<void>;
  getSummary(userId: string): Promise<DigitalAssetSummary>;
  listLedgers(userId: string, query: PaginationQuery): Promise<PaginatedLedgers>;
}
```

所有写操作只允许通过这些方法完成，禁止直接更新 `DigitalAssetAccount.cumulativeSpendAmount`。

## 业务流程

### 确认收货入账

现有 `OrderService.confirmReceive()` 在订单从 `SHIPPED/DELIVERED` CAS 更新为 `RECEIVED` 后触发数字资产入账。

要求：

- 入账失败不能让订单状态回滚到未收货。
- 如果入账失败，必须记录错误日志和持久化死信记录，供后台或运维重试。
- 推荐方式：确认收货事务提交后调用 `creditOrderReceived(orderId, 'ORDER_RECEIVED')`，数字资产服务内部使用幂等键防重复。

### 自动确认收货

现有 `OrderAutoConfirmService` 若会自动把订单置为 `RECEIVED`，也必须调用同一 `creditOrderReceived` 方法。不能只覆盖用户手动确认收货入口。

### 售后/退款扣回

在渠道退款最终成功闭环后触发扣回：

- 支付宝同步成功退款后触发。
- 微信退款通知或补偿查单确认 `REFUNDED` 后触发。
- 售后退款服务 `AfterSaleRefundService.handleRefundSuccess()` 应接入。
- 未发货取消退款如果订单还未确认收货，理论上无正向累计，扣回方法应幂等跳过。

### 历史回填

回填脚本分两阶段执行，必须保证“历史成功退款/售后”不会让累计消费被高估。

### 阶段一：历史收货订单正向入账

扫描所有存在收货事实且未被正向累计过的订单，逐单调用：

```ts
creditOrderReceived(order.id, 'BACKFILL')
```

收货事实判定：

- `Order.receivedAt IS NOT NULL`。
- 或 `Order.status='RECEIVED'`，用于兼容历史数据中 `receivedAt` 缺失但状态已收货的记录。

`Order.status='REFUNDED'` 只有在 `receivedAt IS NOT NULL` 时才写正向入账。未发货取消退款、支付后未收货就退款的订单没有收货事实，不进入数字资产累计。

### 阶段二：历史成功退款/售后扣回

阶段一完成后，扫描历史成功退款并逐笔调用扣回：

- `Refund.status='REFUNDED'` 且其订单已有正向累计 ledger。
- `AfterSaleRequest.status='REFUNDED'` 且没有可用 `refundId` 或没有对应 `Refund` 行时，用 `afterSaleId` 兜底扣回。

全额退款且订单曾经确认收货的历史订单，应表现为一条正向入账流水和一条负向扣回流水，最终净额为 0。这样保留审计链路，便于管理后台解释历史变化。

回填脚本必须：

- 支持 dry-run。
- 支持分页批处理。
- 支持断点重跑。
- 输出正向处理数量、扣回处理数量、跳过数量、失败订单/退款列表、累计正向金额、累计扣回金额、净额。
- 使用统一订单正向幂等键，保证重复执行安全。
- 使用统一退款扣回幂等键，保证重复执行安全。

## API 设计

### 买家端 API

#### `GET /api/v1/me/digital-assets/summary`

返回当前用户数字资产中心首页数据。

```ts
{
  cumulativeSpendAmount: number,
  modules: [
    { key: 'assetValue', title: '资产价值', status: 'COMING_SOON', description: '规则待公布' },
    { key: 'level', title: '资产等级', status: 'COMING_SOON', description: '待开放' },
    { key: 'benefits', title: '权益福利', status: 'COMING_SOON', description: '待开放' },
    { key: 'futureRights', title: '未来权益模块', status: 'COMING_SOON', description: '规则待公布' },
  ],
}
```

#### `GET /api/v1/me/digital-assets/ledgers`

分页返回当前用户资产流水。

Query:

```ts
{ page?: number; pageSize?: number; type?: DigitalAssetLedgerType }
```

Response item:

```ts
{
  id: string,
  type: DigitalAssetLedgerType,
  direction: 'CREDIT' | 'DEBIT',
  amount: number,
  balanceAfter: number,
  title: string,
  description?: string,
  orderId?: string,
  createdAt: string,
}
```

### 管理后台 API

#### `GET /api/v1/admin/digital-assets/accounts`

查询数字资产账户列表，支持手机号/昵称/userId、金额区间、更新时间排序。

#### `GET /api/v1/admin/digital-assets/accounts/:userId`

账户详情，包含用户基础信息、累计消费金额、最近流水、统计摘要。

#### `GET /api/v1/admin/digital-assets/accounts/:userId/ledgers`

用户流水分页查询。

#### `POST /api/v1/admin/digital-assets/accounts/:userId/adjust`

超级管理员手动调整。

```ts
{
  direction: 'CREDIT' | 'DEBIT',
  amount: number,
  reason: string,
  clientIdempotencyKey?: string,
}
```

校验：

- 只有角色名为 `超级管理员` 的管理员可调用。
- `amount > 0`，最多两位小数。
- `reason` 必填，建议 5 到 200 字。
- `DEBIT` 不允许导致账户余额小于 0。
- 写 `DigitalAssetLedger(type='ADMIN_ADJUSTMENT')`。
- 写后台审计日志（现有 Prisma 模型为 `AdminAuditLog`），记录调整前、调整后、原因、目标用户。

#### `GET /api/v1/admin/digital-assets/export`

导出账户或流水。第一版优先 CSV，沿用后台已有下载模式。

#### `GET /api/v1/admin/digital-assets/settings`

#### `PATCH /api/v1/admin/digital-assets/settings`

第一版只保存数字资产中心占位配置，例如模块开关、规则说明文案。不得配置兑换比例、资产价值、股权或期权规则。

## 买家 App 设计

### 入口

在 `app/(tabs)/me.tsx` 的“我的”页增加“数字资产”入口，点击进入：

```text
/me/digital-assets
```

### 页面

新增 `app/me/digital-assets.tsx`。

页面结构：

1. 顶部标题：数字资产中心。
2. 主数字卡：累计消费金额。
3. 模块占位区：资产价值、资产等级、权益福利、未来权益等，状态为“规则待公布”或“待开放”。
4. 明细列表：确认收货入账、退款扣回、后台调整。
5. 空态：暂无累计消费记录。
6. 错误态：加载失败，可重试。
7. 骨架屏：首屏加载中。

文案约束：

- 主数字只能叫“累计消费金额”。
- 不使用“余额”“可兑换”“可提现”“股权已获得”“期权已获得”等承诺性词汇。
- 未来权益模块只说明“规则待公布”。

响应式要求：

- 遵守 `docs/architecture/responsive-design.md`。
- 新页面不得在模块顶层使用 `Dimensions.get`。
- 金额文本使用 `priceTextProps` 或同等响应式策略。
- 大字体和 Android 虚拟导航键下不能遮挡明细列表底部。

## 管理后台设计

### 菜单与路由

新增页面：

```text
admin/src/pages/digital-assets/index.tsx
```

路由：

```text
/digital-assets
```

建议菜单放在“用户与奖励”分组下，名称为“数字资产”。

新增权限建议：

```ts
DIGITAL_ASSETS_READ: 'digital_assets:read'
DIGITAL_ASSETS_ADJUST: 'digital_assets:adjust'
DIGITAL_ASSETS_EXPORT: 'digital_assets:export'
DIGITAL_ASSETS_SETTINGS: 'digital_assets:settings'
```

即便有 `DIGITAL_ASSETS_ADJUST`，后端仍必须额外校验超级管理员角色。权限不是超级管理员校验的替代品。

### 页面能力

1. 统计卡片：累计资产账户数、累计消费总额、今日入账、今日扣回、手动调整次数。
2. 用户查询表：用户、手机号脱敏、会员类型、累计消费金额、最后更新时间。
3. 详情抽屉：账户详情、流水列表、订单/退款关联跳转。
4. 手动调整弹窗：仅超管可见或可操作，必须填写原因。
5. 导出：账户导出、流水导出。
6. 规则占位配置：管理 App 端模块文案和开关，不配置兑换比例。

### 用户详情页接入

在 `admin/src/pages/users/detail.tsx` 增加数字资产卡片：

- 累计消费金额。
- 最近一条流水。
- 跳转 `/digital-assets?userId=...`。

## 安全与审计

本需求涉及金额、资产基数、状态回退和管理员调整，实施必须对照 `docs/issues/tofix-safe.md` 的安全检查清单。

重点要求：

- 所有账户总额变动使用 Serializable 事务。
- 所有写入有幂等键。
- 管理员调整强制记录后台审计日志（`AdminAuditLog`）。
- 非超级管理员调整返回 403。
- 导出操作记录审计日志。
- 退款扣回不得过扣。
- 历史回填可重复执行。
- 不允许前端传入 `balanceAfter` 或账户总额。

## 测试计划

### 后端单元/集成测试

- 确认收货只入账一次。
- 自动确认收货入账。
- 历史回填可重复执行且不重复累计。
- 历史回填会对已成功退款/售后的已收货订单生成扣回流水。
- 实时入账后再跑回填不重复累计。
- 回填后再次调用实时入账不重复累计。
- VIP 礼包订单计入。
- 商品实付金额不含运费。
- 消费积分、平台红包、VIP 折扣正确排除。
- 部分退款扣回正确。
- 缺少 `RefundItem` 时使用 `AfterSaleRequest.orderItemId/refundAmount` 扣回正确。
- 多次部分退款按 `meta.itemAllocations` 的行级剩余额度封顶。
- `refundId` 与 `afterSaleId` 双来源不会对同一售后重复扣回。
- 行级分摊保留 2 位小数且尾差落到固定最后一行。
- 全额退款扣回订单剩余累计金额。
- 退款扣回不超过该订单已累计金额。
- 未确认收货订单退款不产生负向扣回。
- 超级管理员手动增加/扣减成功。
- 非超级管理员手动调整 403。
- 管理员扣减不能导致余额负数。
- `npx prisma validate` 通过。
- 后端 TypeScript 编译通过。

### 买家 App 测试

- “我的”页入口可进入数字资产中心。
- summary 和 ledgers 三态完整：loading / empty / error。
- 明细分页加载正确。
- 大字体、显示大小、Android 虚拟导航键适配。
- TypeScript 编译通过。

### 管理后台测试

- 数字资产菜单和路由可访问。
- 账户列表查询、排序、筛选正确。
- 用户详情数字资产卡片展示正确。
- 流水详情抽屉字段正确。
- 非超管调整按钮不可用或提交被拒绝。
- 超管调整成功后列表和详情刷新。
- 导出可下载 CSV。
- TypeScript 编译通过。

## 文档同步

实施时必须同步：

- `AGENTS.md`：登记本 spec 和后续 plan。
- `docs/architecture/data-system.md`：登记新增模型、枚举、关系。
- `docs/architecture/frontend.md`：登记买家 App 数字资产中心。
- `docs/architecture/admin-frontend.md`：登记管理后台数字资产页。
- `docs/issues/tofix-safe.md`：记录本需求的金额/资产安全检查结果，如发现新风险需追加。
- `plan.md`：进入实施后更新对应上线任务进度。

## 待后续单独设计的能力

- 数字资产价值计算。
- 资产等级规则。
- 累计消费到权益、工资、期权、股权的兑换规则。
- 用户兑换申请和审批。
- 法务文本和税务口径。
- 数字资产变动通知和用户协议确认。
