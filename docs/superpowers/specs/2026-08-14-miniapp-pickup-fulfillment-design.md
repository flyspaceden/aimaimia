# 微信小程序配送 / 到店自提履约设计

> 日期：2026-08-14
> 状态：本地实现、独立代码审查及 staging 部署已完成；真实支付/退款、真实数据库并发和真机闭环待验收
> 范围：普通商品、团购、VIP 礼包；小程序、共享后端、买家 App 兼容展示、卖家中心、管理后台
> 原型：[自提页面静态预览](../../ui-prototypes/2026-08-14-miniapp-pickup-preview.html)

## 1. 结论与边界

爱买买的正常电商订单在同一结算中同时支持两种履约方式：

- `DELIVERY`：现有配送方式，保留地址快照、顺丰计费、面单、物流轨迹、自动确认收货的全部现有行为。
- `PICKUP`：用户到商家自提点取货。自提运费为 `0`，不创建顺丰面单、不调用顺丰、不创建物流轨迹、不进入自动确认收货 cron；只能由卖家核销一次性取货凭证完成交付。

本设计是正常商城的履约能力，**不是**独立 `delivery` 业务线。小程序不得引用 `src/repos/delivery/**`、`/api/v1/delivery/**` 或 delivery 数据库。

普通商品、团购、VIP 礼包均支持自提：

| 业务 | 自提归属 | 特别规则 |
| --- | --- | --- |
| 普通商品 / 立即购买 | 每个实际商家订单各选一个自提点 | 一次多商家结算会生成多个自提地点和凭证 |
| 团购 | 团购商品所属商家自提点 | 团购资格、推荐名额和返还冻结规则不变；卖家核销后订单才进入 `RECEIVED`，因此才可能释放关联返还 |
| VIP 礼包 | 平台公司自提点 | VIP 权益仍在支付成功时开通；赠品的自提、签收和售后独立于权益开通 |

`DELIVERY` 是所有现有订单和客户端的兼容默认值。没有可用自提点的商家 / 团购 / VIP 礼包不展示或不允许 `PICKUP`，不能由客户端绕过。

## 2. 产品规则

### 2.1 结算与地点选择

1. 结算页默认选中“送货上门”，以避免改变既有付款行为。
2. 切换为“到店自提”后，不选择收货地址；用户填写本订单自提人姓名和手机号。
3. 服务端按最终可结算 SKU 的 `companyId` 分组，返回每个商家的可用自提点；用户必须为每个商家组选一个点，不能把不同商家的商品静默合并到一个点。
4. 同一购物车若含两个商家，自提页明确提示“需前往 2 个地点”，支付成功后生成两张凭证。若产品后续希望限制为单商家自提，应另开需求，不能在前端静默删商品。
5. 自提人的姓名和手机号仅冻结在这笔订单的加密快照中，不写入用户地址簿，也不替换默认收货地址。
6. 平台红包、消费积分、VIP 折扣、团购价格/返还规则、库存裁决和支付金额重算维持现有后端口径；唯一金额差异是自提运费为 `0`。

### 2.2 取消、售后和收货

- `PREPARING` 阶段对应订单仍为 `PAID`，普通商品沿用“已付款未发货”取消/退款路径；团购和 VIP 继续遵守各自付款后取消限制。
- 卖家标记 `READY` 后，买家不能通过普通的“未发货取消”直接取消；应提示联系商家/平台，由卖家或管理端走受控取消退款路径，防止已经备货的订单被无审计撤销。
- 管理端受控取消只开放给普通商品 `PICKUP + PAID + PREPARING/READY`，要求 `orders:refund` 权限、必填原因、不可逆二次确认和审计。多商家共享一个 CheckoutSession 时必须整会话一致取消，复用既有原路退款、库存、红包、消费积分、分润和数字资产补偿主链。团购 / VIP 不复用该快捷入口，必须进入各自专项处理流程。
- 卖家成功核销取货凭证后，订单原子更新为 `RECEIVED` 并写入 `receivedAt`；既有确认收货后的分润、数字资产、发票资格和售后窗口按现有规则执行。
- 自提后退货/换货仍使用统一售后主链路。若需要线下归还，售后单必须明确展示商家指定的退货地址/自提点；不能把取货点默认当作未确认的退货地址。

## 3. 状态机

订单主状态不新增误导性的 `SHIPPED` 或 `DELIVERED`。自提的细分状态由 `PickupFulfillment.status` 承载。

```text
支付成功
  -> Order.status = PAID
  -> PickupFulfillment.status = PREPARING

卖家备货完成
  -> PickupFulfillment.status = READY
  -> 发送“可取货”订阅消息

卖家扫描/输入并核销有效凭证
  -> PickupFulfillment.status = PICKED_UP
  -> Order.status = RECEIVED, receivedAt = now()
  -> OrderStatusHistory + PickupFulfillmentEvent + 卖家审计日志

支付前关闭 / 已付款取消 / 退款成功
  -> PickupFulfillment.status = VOID / CANCELED（按实际业务原因）
  -> 永久失效全部未使用凭证
```

配送状态机保持：`PAID -> SHIPPED -> DELIVERED -> RECEIVED`。自提订单必须被 `OrderAutoConfirmService`、顺丰面单生成、发货确认、物流追踪和微信物流服务显式排除。

## 4. 数据模型

### 4.1 新枚举

```prisma
enum FulfillmentMode {
  DELIVERY
  PICKUP
}

enum PickupFulfillmentStatus {
  PREPARING
  READY
  PICKED_UP
  VOID
  CANCELED
}
```

### 4.2 自提点

新增 `PickupPoint`，归属 `Company`（平台官方公司也是普通 Company）。建议字段：

```prisma
model PickupPoint {
  id              String   @id @default(cuid())
  companyId       String
  name            String
  contactName     String
  contactPhone    String
  regionCode      String
  regionText      String
  detail          String
  location        Json?    // {lng, lat, provider, poiName}
  businessHours   Json     // 每周营业时间及节假日说明
  pickupNotice    String?  @db.VarChar(500)
  isActive         Boolean   @default(true)
  deletedAt        DateTime?
  deletedByAdminId String?
  deleteReason     String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  company         Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)
  fulfillments    PickupFulfillment[]

  @@index([companyId, deletedAt, isActive])
}
```

不能直接复用 `Company.address`：该 JSON 仅表达企业经营地址，不能审计自提点启停、营业时间、联系人或历史订单地点。

### 4.3 结算与订单快照

`CheckoutSession`：

- 新增 `fulfillmentMode FulfillmentMode @default(DELIVERY)`。
- `addressSnapshot` 改为可空；仅 `DELIVERY` 必填。
- 新增加密 `pickupRecipientSnapshot`，保存自提人姓名、手机号。
- 新增 `pickupSelectionsSnapshot`，保存服务端已经验证过的 `[{companyId, pickupPointId}]`。它是支付回调拆单时的唯一来源，绝不相信回调中的客户端参数。

`Order`：

- 新增 `fulfillmentMode FulfillmentMode @default(DELIVERY)`。
- 保持 `addressSnapshot` 可空；`PICKUP` 不复制假地址。
- 新增一对一 `pickupFulfillment PickupFulfillment?`。

`PickupFulfillment`：

```prisma
model PickupFulfillment {
  id                     String                   @id @default(cuid())
  orderId                String                   @unique
  pickupPointId          String
  status                 PickupFulfillmentStatus  @default(PREPARING)
  pickupPointSnapshot    Json                     // 名称、地址、坐标、营业时间、须知
  recipientSnapshot      Json                     // 加密前由服务层包装为加密 JSON
  pickupCodeDigest       String                   // 不保存明文短码
  pickupTokenDigest      String                   // 不保存二维码 / URL token 原文
  pickupCredentialEncrypted Json                 // AES-GCM 加密的可恢复凭证；仅本人凭证接口解密
  readyAt                DateTime?
  pickedUpAt             DateTime?
  pickedUpByStaffId      String?
  voidedAt               DateTime?
  voidReason             String?
  createdAt              DateTime                 @default(now())
  updatedAt              DateTime                 @updatedAt

  order                  Order                    @relation(fields: [orderId], references: [id], onDelete: Restrict)
  pickupPoint            PickupPoint              @relation(fields: [pickupPointId], references: [id], onDelete: Restrict)

  @@index([pickupPointId, status, readyAt])
}
```

可附加 `PickupFulfillmentEvent` 作为 append-only 时间线；至少每次转移同时写 `OrderStatusHistory`、卖家 / 管理端审计日志，核销不可只改一行状态。

### 4.4 迁移

迁移必须：

1. 给历史 `CheckoutSession` 和 `Order` 回填 `DELIVERY`。
2. 先添加可空字段，再回填并设置安全默认值；不可因为历史会话没有新字段而阻塞支付结果查询。
3. 不回填 `PickupFulfillment`，历史订单继续使用原配送行为。
4. 企业日常暂停营业使用 `isActive=false`；平台“删除”使用 `deletedAt` 软删除并强制停用，记录操作者和原因。禁止物理删除；历史订单始终读取自己的 `pickupPointSnapshot`。恢复软删除记录后保持停用，必须再次显式启用才能用于新结算。

## 5. 接口契约

### 5.1 买家端

现有普通商品、团购、VIP 预结算/创建结算会话端点改用一个判别式 `fulfillment` 输入：

```ts
type DeliveryFulfillmentInput = {
  mode: 'DELIVERY';
  addressId: string;
};

type PickupFulfillmentInput = {
  mode: 'PICKUP';
  recipientName: string;
  recipientPhone: string;
  selections: Array<{ companyId: string; pickupPointId: string }>;
};
```

- `POST /orders/preview`、普通商品 mini-program checkout、group-buy checkout、VIP checkout 均接受该字段。
- 服务端根据 SKU / 活动 / 礼包的最终商家集合校验 `selections` 完整、一一匹配、点位归属正确且 `isActive=true`；客户端传入的公司、金额、运费、地点文本都不是可信来源。
- 可用点通过 `GET /orders/pickup-points?companyIds=...` 按商家加载；预结算响应新增服务端裁决后的 `fulfillment` 摘要，`PICKUP` 时 `totalShippingFee=0`。点位查询或 feature flag 失败时客户端必须关闭自提选择，不能乐观放行。
- `GET /orders/:id`、订单列表和订单状态统计响应新增 `fulfillmentMode` 和自提摘要；取货凭证只能由订单本人通过 `GET /orders/:id/pickup-pass` 获取，默认列表不返回明文码或 token。
- 取货凭证接口仅在 `READY` 时返回短码与签名二维码 payload；接口需认证、限流、审计，响应禁止被公共 CDN 缓存。

### 5.2 卖家端

卖家 API 应使用现有 seller JWT、角色守卫和审计拦截器：

- `GET/POST/PATCH /seller/pickup-points`；停用使用 `PATCH isActive=false`。
- `POST /seller/orders/:id/pickup/ready`：只允许订单所属商家、`PICKUP + PAID + PREPARING`。
- `POST /seller/orders/:id/pickup/verify`：输入扫描 token 或人工短码，核销操作必须标记为不可逆审计动作。
- 卖家订单列表/详情返回履约模式与自提状态；配送订单继续使用现有面单/发货接口。

#### 5.2.1 扫码核销台（2026-08-15 补充）

订单详情内的核销仍保留，但不能要求门店员工先人工检索订单。卖家中心新增独立 `/pickup-verify` 核销台，提供三个等价的凭证输入入口：

1. **二维扫码枪**：USB/蓝牙二维扫码枪以键盘方式把买家手机上的签名二维码内容输入焦点框；扫码枪不是电脑摄像头，界面必须明确标注。
2. **电脑摄像头**：由员工主动点击“打开摄像头扫描”后申请浏览器媒体权限，识别到二维码即停止预览并进入复核，绝不后台静默启用摄像头。
3. **人工取货码**：输入买家出示的 8 位短码；作为任何设备不支持摄像头/扫码枪时的可靠回退。

三种入口都必须先调用 `POST /seller/pickup/resolve`，只返回当前卖家企业范围内的最小核对摘要（订单号、商品/数量、脱敏取货人、自提点、READY/已核销状态），不返回二维码 token 或短码。员工当面核对商品与取货人后，必须再次点击“确认交付并核销”，才调用 `POST /seller/pickup/verify`。后者复用同一 Serializable/CAS 状态机；二维码或短码不可因预览而消费。订单详情的原 `POST /seller/orders/:id/pickup/verify` 保持兼容。

全局核销只接受已认证卖家员工：服务端按二维码内履约 ID 或短码 HMAC digest 定位候选，再在事务内重新校验本企业归属、`READY + PAID`、签名/token 或 digest 和一次性状态。短码出现碰撞或候选不唯一时必须 fail-closed，不得猜测订单。两条新路由分别限流；审计、`PickupFulfillmentEvent` 和错误日志严禁存储明文短码、二维码 payload/token。

买家小程序/App 的凭证页必须把“已取得凭证”与“二维码已成功绘制”分开处理。二维码画布/原生组件失败时显示明确、可操作的回退提示和短码，不能展示无说明的空白白框；凭证仍只在 READY、认证、限流、`no-store` 条件下读取。

商品包装上的 SKU/条码可用于卖家拣货与出库复核，但**不能**替代买家一次性取货凭证：同一 SKU 可被多个订单持有，不能证明本次顾客有权提走商品。后续如接入“扫描商品复核”，仅作为核销前校验项，仍需独立扫码/输入取货凭证后才能变更订单状态。

### 5.3 管理端

- 管理端可读自提点、订单自提状态、凭证已核销时间、操作者与异常原因；不得返回明文凭证。
- 平台管理员是点位管理的最终兜底方：可跨企业选择正常经营的 `Company` 新建点位，完整编辑名称、联系人、电话、地址、坐标、营业时间、取货须知和启停状态；创建后不可改企业归属。
- 点位 API 使用独立权限 `pickup_points:read/create/update/delete`：`GET/POST/PATCH/DELETE /admin/pickup-points`，以及 `POST /admin/pickup-points/:id/restore`。企业选择器调用同模块的 `GET /admin/pickup-points/company-options`，只返回正常经营企业的 ID/名称，不额外要求或扩大 `companies:read`。超级管理员自动拥有全部权限；其他角色必须显式授权。
- 平台删除必须二次确认且原因必填，执行带 `updatedAt` 版本条件的软删除 CAS；重复删除/恢复幂等。默认列表隐藏已删除记录，回收站可查看删除原因并恢复。创建、更新、启停、删除和恢复在同一数据库事务写入管理端审计，包含目标 ID、脱敏前后快照、差异和原因。
- 卖家仍只能查看和维护本企业未删除点位，不能恢复平台已删除记录；买家点位发现和结算校验同时要求 `isActive=true AND deletedAt IS NULL`。
- 平台管理员也可按权限执行受控取消/退款和处理争议，所有动作使用现有管理端审计日志。
- `POST /admin/orders/:id/pickup-cancel-refund` 只允许普通商品自提异常单，使用 `orders:refund` 权限，并返回受影响订单 / 退款状态供页面复核；团购和 VIP 必须明确拒绝。
- 管理端订单发货、顺丰重试、收货信息编辑操作在 `PICKUP` 订单上隐藏并在 API 层拒绝。

## 6. 安全、并发与资金规则

自提涉及身份、履约状态和付款后订单，实施时必须逐项完成 `docs/issues/tofix-safe.md` 的并发与状态机检查：

1. 取货短码使用加密安全随机源生成；数据库只存 digest/HMAC，不存明文。
2. 二维码使用带版本、订单/履约 ID、随机 nonce、有效期和服务端签名的短 token；不把用户手机号、地址或商品明细编码进二维码。
3. `ready`、`verify`、取消、支付回调、退款/售后必须在 `Serializable` 事务中重新读取状态；转移使用来源状态条件的 `updateMany`/CAS 和 `count===1` 检查。
4. 同一凭证的并发核销必须只有一个成功；重复提交返回相同的已核销结果，不得触发二次分润、数字资产或通知。
5. 退款或取消成功后原子置 `VOID/CANCELED` 并永久作废 token；核销后禁止再走“已付款未发货取消”。
6. 预结算和创建 CheckoutSession 时必须验证点位存在、属于正确商家且已启用；停用点位立即阻止后续新会话。支付已经扣款后，支付通知必须从已冻结的 CheckoutSession 快照创建订单，即使点位随后停用也不能抛错造成“已扣款但无订单”。这类订单显式进入异常履约，由平台受控退款 / 人工处理；历史展示始终读取订单快照，不读取点位当前状态。
7. 创建会话返回结构化 `PICKUP_POINT_UNAVAILABLE` 时，三种结算入口立即清空旧 selection、重新加载点位；无可用点则切回配送。若服务器剔除了某商家的全部失效商品，预览 / 创建仅校验最终商家集合并忽略客户端多余的旧 selection，不让用户卡死在拿不到 excludedItems 的循环中。
8. 地址、自提人和点位联系信息延续现有加密/脱敏策略；卖家仅能看到本企业订单所需的最小信息。
9. 自提状态不得以客户端点击“确认收货”替代卖家核销；买家 API 不提供自提订单的 `/receive` 成功路径。
10. 当前 digest 未保存密钥版本。`PICKUP_TOKEN_SECRET` 轮换前必须关闭功能并确保不存在 `PREPARING/READY` 履约；否则旧凭证会失效。若要求不停机轮换，需先增加 key version/前一密钥兼容验证并单独评审。

## 7. 前端改动清单

### 7.1 小程序

修改 `miniapp/src/repos/checkout.ts`、`types/checkout.ts`、`repos/order.ts`、`types/order.ts` 以接收判别式履约输入/响应。主要页面：

- `packages/commerce/checkout`：配送/自提开关；地址或“每商家自提点 + 自提人”区域；预结算金额与提交按钮统一依赖服务端结果。
- `packages/group-buy/checkout`：同一履约控件，明确“取货核销后才确认收货/释放返还”的提示。
- VIP 礼包结算：同一履约控件；明确“付款即开通权益，礼包另行自提”。
- 自提点选择页/弹层：地图导航、营业时间、地址、取货须知、缺少可用点的明确空态。
- 订单列表、卡片、详情：按 `fulfillmentMode + pickupStatus` 显示“备货中 / 待自提 / 已取货”；自提订单不显示物流、修改收货地址或买家确认收货按钮。
- 新增取货凭证页：二维码、短码、地点、营业时间、核销后失效态；不展示可复制的长期 URL。
- 支付成功页：配送使用发货提醒；自提改为“备货完成提醒”，不申请或误用物流提醒。

### 7.2 买家 App

账号与订单在 App/小程序间共享。因此 App 至少必须读取并正确展示来自小程序的自提订单、凭证失效态和售后入口，不能把它显示成“待发货”。是否在 App 同时开放“选择自提”入口可在实施阶段统一开放；不能只改小程序造成跨端语义错误。

### 7.3 卖家中心与管理后台

- 卖家中心新增“自提点管理”与“自提订单”视图，操作是备货完成、扫描/输入取货码、查看核销记录；禁止生成/打印顺丰面单。
- 管理后台订单筛选新增履约方式和自提状态；自提点页面支持跨企业新建、完整编辑、启停、软删除、回收站和恢复；异常退款、点位操作与审计查看分别受权限控制。
- 三端只展示后端派生的状态文案，前端不得根据有无 `shippingFee` 或 `addressSnapshot` 猜测履约方式。

## 8. 后端改动清单

1. Prisma schema、迁移、生成 client 和回填脚本。
2. 新增 `pickup` 模块（point service、fulfillment service、pass/token service、buyer/seller/admin controllers、DTO、单测）。
3. 改造普通 `CheckoutService`、团购 checkout、VIP checkout、预结算和支付成功拆单，让它们冻结并创建自提履约。
4. 改造 `OrderService.mapOrder`、订单详情/列表/状态统计、取消、收货、售后资格和通知，使其理解履约方式。
5. 显式隔离 `SellerShippingService`、`SellerOrdersService.ship`、`ShipmentService`、`OrderAutoConfirmService`、顺丰成本记录和微信物流服务。
6. 补订阅消息模板/通知：备货完成、自提即将到期（若后续配置取货期限）、已核销；发送失败不影响状态机。
7. 管理/卖家权限、审计和观测日志；取货 token 绝不出现在普通日志或异常堆栈。

## 9. 实施顺序与验收

### Phase A：契约与模型

- [x] 建立 Prisma 迁移、默认回填和 feature flag `PICKUP_FULFILLMENT_ENABLED=false`。
- [x] 建立卖家自提点 CRUD、商家归属/启停校验与最小权限。
- [x] 建立平台跨企业点位新建/完整编辑/软删除/恢复、独立权限、CAS 与事务审计。
- [x] 建立普通 / 团购 / VIP 的统一判别式履约 DTO 和预结算服务端校验。
- [x] 验证 `npx prisma validate`，并在一次性 PostgreSQL 空库完整执行 114 个迁移。
- [ ] 在 staging 历史数据副本执行 migrate-deploy、回滚前向恢复和数据抽样；未获部署授权前不在真实库执行。

### Phase B：付款后履约与安全

- [x] 改造三种支付成功建单路径，按商家创建 `PickupFulfillment`。
- [x] 实现 `PREPARING -> READY -> PICKED_UP`、凭证签发、核销、取消/退款作废和 append-only 审计。
- [x] 隔离顺丰/物流/自动确认；验证团购返还与 VIP 权益时间点不被改坏。
- [x] 完成状态机、幂等、权限、token 泄露与 PII 脱敏单元/契约测试。
- [ ] 在真实 PostgreSQL 下补两路并发核销、`READY` 与管理端取消竞态、多商户部分退款后 cron 收口的集成测试。

### Phase C：三端界面

- [x] 小程序结算、团购、VIP、订单、取货凭证和支付成功页。
- [x] 买家 App 跨端兼容展示与必要入口。
- [x] 卖家自提点、备货、核销和管理端审核/异常处理。
- [x] 更新 `docs/architecture/frontend.md`、`docs/architecture/wechat-mini-program.md`、后端/数据/安全/商户文档与 `plan.md`。

### Phase D：验证与发布

- [x] 后端本地：Prisma validate、TypeScript build、普通/团购/VIP checkout、支付回调、取消、退款、物流隔离和权限测试；16 个关键套件 255 项通过。
- [x] 小程序本地：ESLint、类型检查、单测、staging/production 构建与产物断言通过；开发者工具目标路由 0 个 JS/React/WXSS 错误。
- [x] 卖家/管理本地：TypeScript/生产构建通过；用本地 Mock API 完成自提点、列表/详情、备货、核销和管理端退款确认页面检查。
- [ ] staging 登录态数据回归：普通多商家、团购、VIP 各完成一次配送与自提全流程；当前 staging 后端尚无本次迁移/API，开发者工具只能验证页面载入和认证门禁。
- [ ] 真实联调：微信支付成功 -> 卖家备货 -> 小程序收到提醒 -> 到店扫码 -> 订单 `RECEIVED` -> 关联分润/数字资产/售后窗口正确。
- [ ] 从最新 `origin/staging` 的干净 worktree 开发；先发 staging 和小程序体验版，验证后再按用户明确授权发布 main/正式版。

### 9.1 2026-08-14 本地验证记录

- 代码基线：从 `origin/staging` 的干净 worktree 开发；本轮未 commit、未 push、未部署。
- 数据库：一次性 PostgreSQL 空库成功执行 114 个迁移（含 `20260814010000_add_pickup_fulfillment`）；Prisma schema 校验通过。
- 后端：Nest build 通过；16 个自提、三类 checkout、退款、审计、订单映射、物流隔离关键套件共 255 项通过。
- 小程序：最终验证包含 50 个测试文件、271 项测试、TypeScript、ESLint、staging/production 构建和 72 页产物检查；新增 `qrcode` 不在 npm audit 漏洞项内。Taro/Vite/Webpack/Swiper 链仍有既有 14 条公告，继续按 `WMPF08` 独立升级。
- 买家 App：TypeScript、41 个测试套件 160+ 项及法律文本契约通过；自提订单隐藏物流/确认收货，凭证状态与小程序一致。
- 微信开发者工具：正确 AppID 工程已打开；最终登录态复跑普通结算、团购结算、VIP 礼包、取货凭证四条目标路由为 2 `PASS`、2 `NO_FIXTURE`、0 `AUTH_GATE`、0 `FAIL`，没有 JavaScript/React/WXSS 错误。普通结算已渲染配送/自提开关，但 staging 仍是旧后端，点位请求显示“订单未找到”；凭证缺订单 ID、团购缺活动数据，因此不能冒充真实业务通过。两条截图 warning 仅是自动截图 8 秒超时。
- 后台：卖家端和管理端用 Mock API 做浏览器页面测试；没有调用真实 staging API，也没有提交真实退款。
- 独立审查已修复：后端 `businessCode` 错误信封、过期凭证刷新、凭证读取审计、预览 stale selection、退款逐单状态返回、缺失履约关联的列表容错、核销输入 XOR/8 位短码约束、配置模板与灰度 runbook。

## 10. 非目标

- 不接入或复用独立 delivery 业务线。
- 不把普通订单拆成新的支付方式或手工收款。
- 不用“零运费 + 假顺丰单号”模拟自提。
- 不在二维码中携带明文个人资料或永久有效 token。
- 不将自提点物理删除或覆盖历史订单地点快照；平台“删除”只做可审计、可恢复且默认停用的软删除。
