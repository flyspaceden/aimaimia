# 订单页面重做设计（买家 App）

**日期**：2026-05-01
**目标分支**：staging
**涉及范围**：买家 App 前端 + NestJS 后端 Order DTO + 新增 CheckoutSession 防重逻辑

---

## 1. 背景与目标

### 1.1 现状问题

当前买家 App 的订单页（`app/orders/index.tsx` + `app/orders/[id].tsx` + `app/orders/track.tsx` + `app/orders/after-sale/index.tsx`）相比京东 / 淘宝差距明显：

- **订单列表**只显示订单号 + 商品件数 + 总价，**没有商品图、没有店铺名、没有 SKU 规格、没有任何状态进度暗示**
- **订单详情**没有收货地址、没有店铺分组、没有付款时间 / 发货时间 / 付款方式、没有买家留言、没有发票入口、没有底部固定 CTA
- **物流追踪**是占位地图 + 简单 timeline
- **未完成支付**的订单（用户取消支付宝后）在 app 里完全找不到入口续付，库存被锁 30 分钟用户感知不到
- 多商户分组未呈现 — 买家看不出哪些商品来自哪家店

### 1.2 目标

把买家 App 订单链路（列表 / 详情 / 物流 / 售后列表）升级到主流电商平台体验水平，同时**不破坏现有 F1 结算架构**（CheckoutSession-then-Order 模型）。

---

## 2. 范围

### 2.1 In Scope

| 页面 | 文件 | 变更类型 |
|---|---|---|
| 订单列表 | `app/orders/index.tsx` | 全面重写 |
| 订单详情 | `app/orders/[id].tsx` | 全面重写 |
| 物流追踪 | `app/orders/track.tsx` | 局部优化（保留主结构） |
| 售后列表 | `app/orders/after-sale/index.tsx` | 卡片样式同步升级（与订单列表一致） |
| 未完成订单横幅 | 新增组件 | 在首页 / 购物车 / 我的页顶部显示 |
| 订单 DTO（后端） | `backend/src/modules/order/order.service.ts` | 列表+详情 DTO 字段扩展 |
| CheckoutSession 接口 | `backend/src/modules/order/checkout.service.ts` + `checkout.controller.ts` | 新增"未完成 Session"查询接口 + 防重锁检查 |
| Order 模型 | `backend/prisma/schema.prisma` | 新增 `buyerNote` 字段 |

### 2.2 Out of Scope

- **评价系统**（项目目前没有 ProductReview 模型，本次不新建模块）
- **物流地图**（高德 SDK 调用费用 + 农产品场景不刚需）
- **下单可得分润奖励 / 红包提示**（已在购物车 + 结算页有，订单详情不重复露出）
- **管理后台 / 卖家后台订单页**（本次只动买家 App）
- **历史 PENDING_PAYMENT 订单专门处理**（项目仍在测试阶段，老测试数据可不管）
- **架构层面回归"提交订单即建单"**（破坏 F1 设计，工期 5-7 天，本次不做）

---

## 3. 设计决策清单

| 决策点 | 结论 | 备注 |
|---|---|---|
| 列表卡片布局 | **方案 B · 淘宝展开风** | 按店铺分组，每件商品独立一行，带图、SKU 规格、单价 ×数量 |
| 详情页区块顺序 | **7 区块**：状态头 → 物流卡 → 收货地址 → 店铺+商品 → 金额明细 → 订单信息 → 底部固定 CTA | |
| 状态头配色 | **按状态变色**（JD/淘宝风） | 待付款橙、待发货蓝、运输中蓝、已完成绿、售后红；本次破坏品牌色统一以提升状态识别效率 |
| 待付款倒计时 | **30 分钟**（已在 CheckoutSession.expiresAt 实现） | |
| 自动确认收货 | **签收（DELIVERED）后 7 天自动确认** | 已通过 `Order.autoReceiveAt` + `OrderAutoConfirmService` 实现，本次只需将字段暴露给前端 |
| 支付宝取消（6001）行为改造 | **不再立即 cancelCheckoutSession**，改为保留 Session ACTIVE，用户由横幅/未完成订单页继续支付或主动取消 | `app/checkout.tsx:463` 当前在 6001 分支立即 cancel，本次必须改 — 否则横幅方案根本不会触发 |
| "待付款" tab | **不做** — 删除当前 filter chip 中的 `pendingPay` 选项 | F1 流程下不存在"待付款订单"实体；改用"未完成订单横幅"承载未付款 Session 续付入口 |
| 我的页"待付款"入口 | **替换为"未完成支付"**，数据源从 `pending checkout session` 取 | `app/(tabs)/me.tsx:26` 当前是 pendingPay 跳订单列表，改为：有 ACTIVE Session 时点击进 `/checkout/pending`，无则隐藏入口 |
| Filter tabs | **全部 / 待发货 / 待收货 / 售后 / 已完成** | 删除"待付款" |
| VIP 礼包订单 | **走相同布局**，仅在状态头 + 商品行旁显示"VIP 开通礼包"标签 | 不再走老的简化版（用户决策） |
| 售后列表卡片 | **同步升级**（商品图、店铺名、状态着色） | |
| 未完成支付的处理 | **横幅 + 防重锁**：`GET /checkout-sessions/me/pending` 取最新 ACTIVE Session，首页 / 购物车 / 我的页顶部显示横幅，点击进入续付页；checkout 入口拒绝在已有 ACTIVE Session 的情况下重复提交 | |
| 购物车清空时机 | **保持现状**（付款成功后清空） | 待用户成功付款才清；横幅保证用户能找到未完成订单 |

---

## 4. 后端现状与差距

### 4.1 字段已存在但 DTO 未暴露（直接在 service mapper 加一行就行）

| 字段 | 位置 | 列表已暴露 | 详情已暴露 |
|---|---|---|---|
| `addressSnapshot` | `Order.addressSnapshot`（加密 + `addressSnapshotMasked` 脱敏版） | ❌ | ✅ |
| `productSnapshot.image / skuTitle / title / companyId` | `OrderItem.productSnapshot` JSON | ❌ | 部分（前端未消费） |
| `paidAt / deliveredAt / receivedAt` | `Order.*At` | ❌ | ✅ |
| `paymentMethod` | `Order.paymentMethod` | ❌ | ✅ |
| `vipDiscountAmount` | `Order.vipDiscountAmount` | ❌ | ✅ |
| `autoReceiveAt` | `Order.autoReceiveAt` (schema.prisma:1382) | ❌ | ❌（**字段已有，需暴露**） |
| `shipments[].trackingEvents[]` 最新一条 | `summarizeShipments()` (order.service.ts:84-149) | ❌ | ✅（已 include，前端未消费摘要） |

### 4.2 字段不存在，需要新增

| 字段 | 位置 | 用途 |
|---|---|---|
| `Order.buyerNote: String?` | `prisma/schema.prisma` `model Order` | 买家在结算页填写的留言（"尽快发货""不要冰品"） |
| `companyName / companyLogo` | 列表 / 详情 DTO 的店铺分组块 | 不在 productSnapshot 里 — 通过 query-time join `Company` 获取（多商户场景，每订单店铺数有限，N+1 可控） |
| `CheckoutSession.itemsSnapshot` 中商品图 | 已存在于 `productSnapshot.image`（checkout.service.ts:305-313） | 横幅缩略图用 |

### 4.3 接口缺失，需要新增

| 接口 | 路径 | 用途 |
|---|---|---|
| 未完成 Session 查询 | `GET /checkout-sessions/me/pending` | 返回当前用户最新一条 `status=ACTIVE && expiresAt > now` 的 Session（含 itemsSnapshot 摘要、expectedTotal、expiresAt） |
| Checkout 入口防重检查 | 修改 `POST /orders/checkout` 入参处理 | 同用户已存在 ACTIVE Session 时拒绝新建，返回 409 + 现有 sessionId（前端弹"你有未完成订单 [继续支付] [取消重新下]"） |
| Session 续付（重新调起支付宝） | `POST /orders/checkout/:sessionId/resume` | 复用 session.merchantOrderNo + 现存 expectedTotal 重新生成支付宝 orderStr，返回 paymentParams |
| 未完成 Session 查询 | `GET /orders/checkout/me/pending` | 横幅与"我的页"未完成支付入口数据源 |

### 4.4 Cron / 配置已就绪

- 自动确认收货：`OrderAutoConfirmService` 每小时扫描 `autoReceiveAt <= now` 的 SHIPPED/DELIVERED 订单（autoConfirmDays 由 `BonusConfigService.getSystemConfig().autoConfirmDays` 提供，默认 7）
- 待付款超时：`checkout-expire.service.ts` 处理 CheckoutSession 30min 过期（已存在）
- 待付款 30min：`CheckoutSession.expiresAt = createdAt + 30min`（写死在 service，不用配置）

---

## 5. 数据层设计

### 5.1 Schema 变更

F1 流程下"提交订单"先建 CheckoutSession，付款成功才建 Order，所以买家留言**先存 CheckoutSession，付款回调时透传到 Order**：

```prisma
// prisma/schema.prisma

model CheckoutSession {
  // ... existing fields ...
  buyerNote   String?  @db.VarChar(200)   // 买家留言（结算页填写，<= 200 字）
  // ... existing fields ...
}

model Order {
  // ... existing fields ...
  buyerNote   String?  @db.VarChar(200)   // 由 CheckoutSession.buyerNote 在 handlePaymentSuccess 时透传
  // ... existing fields ...
}
```

**透传点**：`CheckoutService.handlePaymentSuccess` (checkout.service.ts:1186) 创建 Order 时 `data: { ..., buyerNote: session.buyerNote }`。

**迁移**：`prisma migrate dev --name add_buyer_note_to_checkout_and_order`，两个字段都可空，无数据回填，零风险。

**DTO 透传**：`CheckoutDto` 新增可选 `buyerNote?: string`（class-validator `@IsOptional() @MaxLength(200)`）。

### 5.2 Order 列表 DTO（`mapOrder`）扩展

**枚举对齐**：`status` 走现有 `STATUS_MAP`（order.service.ts:19-30）转为前端 lowerCamelCase 枚举（`pendingShip / shipping / delivered / completed / afterSale / canceled`）；`paymentMethod` 当前后端返回 lowercase `'wechat' / 'bankcard' / 'alipay'`（order.service.ts:1129-1133），DTO 与前端 `PaymentMethod` 类型保持 lowercase，不改大小写。

返回结构（每个订单按店铺分组）：

```ts
{
  id: string,
  status: OrderStatus,             // 前端 lowerCamelCase 枚举
  bizType: 'NORMAL_GOODS' | 'VIP_PACKAGE',
  totalPrice: number,
  goodsAmount: number,
  shippingFee: number,
  vipDiscountAmount: number,
  discountAmount: number,
  createdAt: string,
  paidAt: string | null,
  shippedAt: string | null,        // 取 shipments[0].shippedAt 早的一个
  deliveredAt: string | null,
  autoReceiveAt: string | null,    // 新暴露 — 详情页倒计时显示
  afterSaleStatus: string | null,
  // 新增：店铺分组（多商户支持，单商户订单也是 1 组）
  shopGroups: Array<{
    companyId: string,
    companyName: string,
    companyLogo: string | null,
    items: Array<{
      id: string,
      productId: string,
      title: string,
      skuTitle: string,            // SKU 规格，如 "5斤装"
      image: string,               // productSnapshot.image
      unitPrice: number,
      quantity: number,
      isPrize: boolean,
      isPostReplacement: boolean,
    }>,
  }>,
  // 新增：物流摘要（前端列表卡用）
  logisticsSummary: {
    status: 'INIT' | 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION' | null,
    latestEventMessage: string | null,    // 最新一条事件文字
    latestEventTime: string | null,       // 时间
  } | null,
}
```

**实现要点**：
- 店铺分组通过 `groupBy(items, item => item.companyId)` 在 service 内做，name/logo 一次性 `findMany Company where id IN (...)`
- 物流摘要复用 `summarizeShipments()` 但只取最新一条事件压扁
- VIP 礼包订单 `bizType=VIP_PACKAGE` 标记，前端在卡片右上加徽章

### 5.3 Order 详情 DTO（`mapOrderDetail`）扩展

在 5.2 基础上，详情接口还需要：

```ts
{
  // ... 5.2 所有字段 ...
  paymentMethod: 'wechat' | 'alipay' | 'bankcard' | null,   // 与现有后端 lowercase 一致
  buyerNote: string | null,
  // 完整地址（详情页用脱敏版）
  address: {
    recipientName: string,           // addressSnapshotMasked.name
    recipientPhone: string,          // 脱敏后的手机号 138****8888
    fullAddress: string,             // 省+市+区+详细
  } | null,
  // 完整物流（详情页"物流卡"区块用一行预览，跳详情页用完整）
  shipments: Array<{ /* 现有 ShipmentDetail */ }>,
  // 售后时间线（已有）
  afterSaleTimeline: AfterSaleProgress[],
  // 退货窗口
  returnWindowExpiresAt: string | null,
}
```

### 5.4 CheckoutSession 未完成接口

**路由归属**：保持现有约定，挂在 `OrderController` 下 `/orders/checkout/...`，不新建独立 controller（`backend/src/modules/order/order.controller.ts:23-58` 已有 `/orders/checkout` 入口、`/orders/checkout/:sessionId/cancel`、`/orders/checkout/:sessionId/status`，新接口同位置追加）。

```ts
// GET /orders/checkout/me/pending → 200 | null
{
  sessionId: string,
  merchantOrderNo: string | null,     // 续付时调起支付宝用
  expectedTotal: number,
  goodsAmount: number,
  shippingFee: number,
  expiresAt: string,                  // ISO timestamp，前端算倒计时
  itemCount: number,
  bizType: 'NORMAL_GOODS' | 'VIP_PACKAGE',
  // 摘要（横幅显示）
  preview: {
    firstItemImage: string,           // 第一件商品图
    firstItemTitle: string,           // 标题
    extraCount: number,               // "等共 N 件"
  },
} | null
```

查询条件：`userId = current && status = 'ACTIVE' && expiresAt > now()`，按 `createdAt DESC` 取一条。

**Resume 接口**：`POST /orders/checkout/:sessionId/resume` — 校验 sessionId 归属当前 userId、status=ACTIVE、未过期，复用 `merchantOrderNo` 重新生成支付宝 orderStr 返回 paymentParams。

### 5.5 Checkout 防重锁

修改 `CheckoutService.checkout()` 入口（checkout.service.ts:92）：

```
进入函数后、创建 Session 前：
  查询当前用户的 ACTIVE Session 数量（status=ACTIVE && expiresAt > now()）
  如果 >= 1：
    抛 ConflictException(409, {
      code: 'PENDING_CHECKOUT_EXISTS',
      sessionId: existingSession.id,
      message: '你有未完成的订单，请先完成支付或取消'
    })
  否则：继续现有流程
```

**幂等性**：保留现有 `idempotencyKey` 逻辑（同 key 直接返回原 Session）。新检查只针对**没有 idempotencyKey 或 key 不匹配**的新请求。

VIP 礼包结算（`checkoutVipPackage`，line:689）也要加同样的检查。

---

## 6. UI 设计

### 6.1 订单列表（`app/orders/index.tsx`）

**Filter tabs**：
```
全部 | 待发货 | 待收货 | 售后 | 已完成
```
（删除"待付款"，"售后"仍跳 `/orders/after-sale` 列表页）

**卡片结构**（每订单一张卡）：
```
┌─────────────────────────────────────────────┐
│ 🏪 青禾农场旗舰店             待发货         │  ← 店铺名 + 状态着色
├─────────────────────────────────────────────┤
│ [图] 云南红心猕猴桃 5斤装          ¥58.00   │  ← 商品行：图+标题+SKU+单价
│      规格：精选大果                  x1     │
├─────────────────────────────────────────────┤
│ [图] 赣南脐橙 10斤装               ¥36.00   │
│      规格：原箱装                    x2     │
├─────────────────────────────────────────────┤
│ 共 3 件，实付 ¥120.00      取消  立即支付    │  ← 主操作 + 次操作
└─────────────────────────────────────────────┘
```

**多商户**：一个订单跨多店铺时，每店铺一张子卡（同一 orderId 渲染多次卡片头），底部合计在最后一张。
（注：F1 流程下一个订单本身只属于一家店 — 多商家结算会拆成多个 Order，所以实际上一个 orderId 永远只对应一家店。但 DTO 仍保留 shopGroups 数组结构以兼容未来。）

**状态-CTA 映射**：

| 状态 | 主 CTA | 次 CTA |
|---|---|---|
| 待发货 | 联系客服 | 提醒发货 |
| 运输中（shipping） | 确认收货 | 查看物流 |
| 已完成 | 再次购买 | 申请售后（如未过 7 天） |
| 售后中 | 查看售后 | — |
| 已取消 | 删除订单 | — |

**新组件**：
- `src/components/cards/OrderCard.tsx`（替代当前列表的内联卡片）
- `src/components/cards/OrderItemRow.tsx`（商品行子组件）

### 6.2 订单详情（`app/orders/[id].tsx`）

7 区块从上到下：

#### ① 状态头（彩色背景大字）
```
┌─────────────────────────────────────┐
│  [背景色随状态变]                    │
│  待付款                              │
│  ⏱ 剩 28:42 自动取消                │
└─────────────────────────────────────┘
```
- VIP 礼包订单：状态文字旁加金色徽章 `[VIP 开通礼包]`
- 待发货：副文案"商家正在打包，预计 24 小时内发出"
- 运输中：副文案显示物流摘要最新一条
- 待收货：倒计时基于 `autoReceiveAt`，显示"还剩 X 天 X 小时自动确认"
- 已签收 / 已完成：显示"已送达，售后期至 X 月 X 日"

**配色映射**：
- 待付款 → `#FF6B35` (橙)
- 待发货 / 运输中 → `#3B82F6` (蓝)
- 已完成 → `#2E7D32` (绿)
- 售后中 → `#DC2626` (红)
- 已取消 → `#9CA3AF` (灰)

#### ② 物流卡（仅待发货 / 运输中 / 已签收 显示）
```
📦 已揽收 上海转运中心
   12 分钟前 · 顺丰 SF12****8888    查看物流 ›
```
点击 → 跳 `/orders/track?orderId=...`

#### ③ 收货地址
```
📍 张三 138****8888
   上海市浦东新区张江路 1234 号 5 栋 6 层
```
所有状态均显示（已签收订单也保留，方便售后核对）。

#### ④ 店铺 + 商品（按店铺分组）
```
🏪 青禾农场旗舰店                      联系卖家 ›
─────────────────────────────────────
[图] 云南红心猕猴桃 5斤装        ¥58.00
     规格：精选大果       x1   申请售后
[图] 赣南脐橙 10斤装             ¥36.00
     规格：原箱装         x2
```
- 商品行右下"申请售后"按钮：仅 已收货 / 已完成 状态显示，奖品 / VIP 礼包 / 已过 7 天的不显示
- 联系卖家：跳 `/cs?source=ORDER_DETAIL&sellerId=companyId&orderId=...`

#### ⑤ 金额明细
```
商品金额                    ¥130.00
运费                        免运费
VIP 折扣                  -¥10.00（如有）
红包抵扣                   -¥10.00（如有）
─────────────────────────
实付                  ¥110.00（红色加粗）
```

#### ⑥ 订单信息
```
订单号  ORD12345678  [复制]
下单时间  2026-04-30 18:22:01
付款时间  2026-04-30 18:23:45
发货时间  2026-04-30 20:15:00（如已发货）
送达时间  2026-05-01 14:30:00（如已签收）
付款方式  支付宝
买家留言  尽快发货
发票      申请发票 ›（普通商品订单显示，VIP 礼包不显示）
```
- 复制按钮：用 `expo-clipboard.setStringAsync()`，弹 toast "已复制"

#### ⑦ 底部固定 CTA Bar（sticky bottom）
```
┌─────────────────────────────────────┐
│              [···]  [次操作]  [主CTA] │
└─────────────────────────────────────┘
```
- "···"：抽屉，收起删除订单 / 投诉等低频操作
- 状态-CTA 映射跟列表卡片一致（参见 6.1）

**新组件**：
- `src/components/orders/StatusHero.tsx`
- `src/components/orders/AddressCard.tsx`
- `src/components/orders/ShopGroup.tsx`（复用 OrderItemRow）
- `src/components/orders/AmountSummary.tsx`
- `src/components/orders/OrderInfoBlock.tsx`
- `src/components/orders/StickyCTABar.tsx`
- `src/components/ui/Countdown.tsx`（通用倒计时 hook + 渲染）

### 6.3 物流追踪（`app/orders/track.tsx`）

保留当前主结构（多包裹折叠 + timeline 脉动），优化点：

- **删除地图占位区**（用户不要）
- **顶部 Hero 改进**：显示完整最新事件 + 收件人姓名 + 完整地址（详情页脱敏，物流页内部用 — 但仍按 addressSnapshotMasked，避免泄露）
- **运单号复制按钮**：`expo-clipboard`
- **承运商电话**：从 carrierCode 映射到客服电话（顺丰 95338、中通 95311 等），点击 `Linking.openURL('tel:...')`

### 6.4 售后列表（`app/orders/after-sale/index.tsx`）

卡片结构与订单列表一致（店铺名 + 商品行带图 + 状态着色），但状态映射换成 `AfterSaleDetailStatus`：

| AfterSaleDetailStatus | 颜色 | 文案 |
|---|---|---|
| REQUESTED / UNDER_REVIEW | 橙 | 审核中 |
| APPROVED / RETURN_SHIPPING | 蓝 | 处理中 |
| REJECTED / SELLER_REJECTED_RETURN | 红 | 已驳回 |
| COMPLETED / REFUNDED | 绿 | 已完成 |
| CANCELED / CLOSED | 灰 | 已关闭 |

### 6.5 未完成订单横幅（新组件）

**位置**：买家 App 两处展示（不是三处 — 我的页改成入口卡片，不重复横幅）：
- `app/(tabs)/home.tsx`（首页）顶部
- `app/cart.tsx`（购物车，注意此页面不在 (tabs)/ 下）顶部

**实现**：新增 `src/components/overlay/PendingCheckoutBanner.tsx`，在两个页面 mount。

```
┌─────────────────────────────────────────────┐
│ ⏱ 你有未完成的订单 28:42                     │
│ [图] 云南红心猕猴桃 等 3 件 · ¥120  [继续支付]│
└─────────────────────────────────────────────┘
```

**数据源**：React Query `useQuery(['pending-checkout'], () => CheckoutSessionRepo.getPending(), { refetchInterval: 30_000 })`

**点击"继续支付"行为**：
- 调 `POST /orders/checkout/:sessionId/resume` → 拿到 paymentParams.orderStr → 调起支付宝 SDK
- 不要再调 `POST /orders/checkout`（会触发防重锁）

**点击横幅本身**：跳到 `app/checkout-pending.tsx`（顶层路由，与 `app/checkout.tsx` / `app/checkout-address.tsx` 同级。复用结算页 UI 但只读 + 续付按钮 + 取消订单按钮）

### 6.5.1 我的页"未完成支付"入口改造

`app/(tabs)/me.tsx:26` 当前的 `pendingPay` 入口：
- 重命名 label：`待付款` → `未完成支付`
- 数据源：从 `OrderRepo.list('pendingPay')` 改为 `useQuery(['pending-checkout'], CheckoutSessionRepo.getPending)` 共享同一份缓存
- 显示规则：API 返回 null 时**隐藏**该入口（不再像旧版总是显示）；返回 Session 时显示徽标"剩 28:42"
- 点击：跳 `app/checkout-pending.tsx`

### 6.5.2 支付宝 6001 取消行为改造

**当前** `app/checkout.tsx:463`：6001 → 立即 `OrderRepo.cancelCheckoutSession(sessionId)` → Session EXPIRED → 横幅永远不出现。

**改造**：6001 分支**移除** cancelCheckoutSession 调用，改为：
- 直接 `router.replace('/checkout-pending?sessionId=...')`（让用户看到"未完成订单"页 + 倒计时）
- Session 仍 ACTIVE，库存仍锁，30min 后 Cron 自然过期
- 用户主动点"取消订单"才走 cancel
- 其他失败码（6002 网络异常、6004 等）保持现有 cancel 行为不变

**保护**：90s 超时分支（line:466 注释"不 cancel session"）当前已是预期行为，不动。

**显示规则**：
- 当 API 返回 `null` → 不显示
- 用户主动取消 Session（点取消订单）→ 调 `POST /checkout-sessions/:id/cancel` → 横幅消失
- Session 自然过期（30min 后 Cron 清）→ 下次 refetch 时消失

### 6.6 Checkout 防重弹窗

修改 `app/checkout/index.tsx` 提交订单按钮处理：

```
点击提交订单
  → 调 POST /orders/checkout
  → 收到 409 + code='PENDING_CHECKOUT_EXISTS'
  → 弹 Modal:
      "你有一个未完成的订单（剩 28:42）"
      [继续支付]  [取消旧订单并重新下单]  [关闭]
  → 继续支付：跳 /checkout/pending?sessionId=...
  → 取消旧订单：调 cancelSession(oldId) → 重试当前 checkout
```

---

## 7. 实施 Phase 拆分

### Phase 1 · 前端重写 + 最小后端 DTO 扩展（1.5-2 天）

**修正**：当前 `mapOrder()` (order.service.ts:1019-1029) 只返回 `id/productId/title/image/price/quantity`，**没有 skuTitle / companyId / isPrize / isPostReplacement**。Phase 1 完全零后端改动会让"淘宝展开风"卡片缺关键字段。所以 Phase 1 把**最小 DTO 扩展**也包含进来。

**后端最小改动（Phase 1 必须的）**：
- `mapOrder()` snapshot 函数补字段：`skuTitle / companyId / isPrize / isPostReplacement`（这些字段已存在于 `OrderItem.productSnapshot` JSON 或 `OrderItem` 直接列）
- 列表 DTO 加 `paidAt / shippedAt / deliveredAt`（详情已有，列表也加，倒计时和状态副文案要用）
- 暂不做：店铺 join、addressSnapshot 解密（这些放 Phase 2）

**前端改动**：
- 重写 `app/orders/index.tsx`：**ScrollView → FlatList**（虚拟化 + 分页）；卡片样式按 6.1
- 重写 `app/orders/[id].tsx` 七区块
- 优化 `app/orders/track.tsx`（删地图、加复制运单、加快递电话）
- 升级 `app/orders/after-sale/index.tsx` 卡片
- 抽出 6.1-6.4 列出的所有新组件
- 删除"待付款" filter chip
- 我的页 `app/(tabs)/me.tsx` 暂时保留 pendingPay 入口（Phase 2 横幅完成后再改）

**Phase 1 fallback 策略**：
- 店铺名：DTO 还没暴露时显示 "商家"（占位）→ Phase 2 后自动生效
- 完整地址：详情页 ③ 区块暂时显示脱敏简版（addressSnapshotMasked 已有）→ Phase 2 暴露完整字段
- autoReceiveAt：前端用 `deliveredAt + 7 days` 模拟 → Phase 2 真实暴露
- buyerNote：Phase 1 不显示（Phase 3 才有字段）

**Phase 1 验收**：
- TypeScript `tsc -b` 通过
- 后端单测：`mapOrder()` 输出包含 skuTitle / companyId
- 手机真机：列表 / 详情 / 物流 / 售后列表四页 UI 跟设计稿一致
- FlatList 滚动 100 单测试无掉帧
- 已有的"售后中"订单仍能正确显示售后时间线
- VIP 礼包订单标签正确显示

### Phase 2 · 后端剩余 DTO + 防重锁 + 续付链路 + 横幅（1.5-2 天）

**后端改动**：
- `mapOrder` 列表 DTO 完整版（店铺分组 join Company、logisticsSummary、autoReceiveAt 暴露）
- `mapOrderDetail` 扩展（暴露完整 `address` 块、autoReceiveAt）
- 新增 `GET /orders/checkout/me/pending`（挂在 `order.controller.ts`）
- 新增 `POST /orders/checkout/:sessionId/resume`（同上）
- `CheckoutService.checkout()` + `checkoutVipPackage()` 加 ACTIVE Session 防重检查（5.5）
- `getById` SQL 加 `Company` join（取 name/logo）

**前端改动**：
- 列表卡片消费真实店铺名 / logo（去掉 fallback）
- 详情页消费真实 `autoReceiveAt`
- 新增 `src/components/overlay/PendingCheckoutBanner.tsx` + 在 `app/(tabs)/home.tsx` 与 `app/cart.tsx` mount
- 新增 `app/checkout-pending.tsx` 续付页（与 `app/checkout.tsx` 同级顶层路由）
- 修改 `app/checkout.tsx`：(1) 6001 取消分支不再 cancelSession 改为跳 `/checkout-pending` (2) 处理 409 防重弹窗
- 修改 `app/(tabs)/me.tsx:26`：pendingPay 入口改名"未完成支付" + 数据源改为 pending checkout session + 无 Session 时隐藏

**Phase 2 验收**：
- 后端单测：`GET /orders` 返回 5.2 全部字段（用真实数据库 fixtures）
- 后端单测：第二次 checkout 返回 409，错误体带 sessionId
- 后端单测：resume 接口能拿到新 orderStr
- 前端真机：取消支付宝后**直接跳到 /checkout-pending**，回到首页/购物车能看到横幅
- 前端真机：横幅倒计时到 0 自动消失（前端基于 expiresAt 判断，不依赖 Cron）
- 前端真机：在 /checkout-pending 点"继续支付" → 唤起支付宝 → 付款成功 → 订单出现在订单列表
- 前端真机：在 /checkout-pending 点"取消订单" → Session 立即 EXPIRED → 横幅消失
- 多 Session bug 修复验证：故意点两次提交订单 → 第二次被 409 拦截

### Phase 3 · buyerNote 字段 + 收尾（0.5 天）

**Schema 改动**（5.1 详细规范）：
- `prisma migrate dev --name add_buyer_note_to_checkout_and_order`
- 同时给 `CheckoutSession.buyerNote String? @db.VarChar(200)` 和 `Order.buyerNote String? @db.VarChar(200)`

**结算页改动**：
- `app/checkout.tsx` 新增"买家留言"输入框（max 200 字，提示文案"非必填，给商家的话"）
- `CheckoutDto` 加 `buyerNote?: string`（`@IsOptional() @MaxLength(200)`）
- `CheckoutService.checkout` / `checkoutVipPackage` 创建 Session 时落库 `buyerNote`
- `handlePaymentSuccess` 创建 Order 时透传 `buyerNote: session.buyerNote`

**详情页改动**：
- 详情页 ⑥ 订单信息块显示 `order.buyerNote`（仅当非空才显示该行）

**Phase 3 验收**：
- migration 在 staging 跑通
- 真机：结算页填留言 → 付款成功 → 订单详情能看到留言
- 留言为空时详情页该行不显示

---

## 8. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| F1 设计与"待付款 tab"语义冲突 | 用户体验跟京东淘宝有 5% 差异（没专门 tab） | 横幅方案覆盖"续付"核心需求；保留架构干净 |
| Phase 1 部分字段需 fallback | 上线后短期内店铺名显示"商家"占位 | Phase 1 → Phase 2 中间不超过 2 天间隔；fallback 逻辑用 `??` 一行处理 |
| 多 Session 防重锁可能误伤 | 用户网络抖动重试时被 409 拦截 | 保留 `idempotencyKey` 幂等（同 key 直接返回原 Session）；前端 retry 用相同 key |
| addressSnapshot 加密读取性能 | 列表页要解密 N 张地址 | 列表 DTO **不**返回完整地址，只详情页才解密；列表卡片不显示地址 |
| Company join 在大订单场景 N+1 | 列表页 20 张订单 → 20 次 join | 用 `findMany Company where id IN (...)` 一次批查；20 个 ID 内 PG 性能无压力 |
| autoReceiveAt 旧订单 NULL | 已有的"运输中"订单可能没设这个字段 | 前端 fallback：`autoReceiveAt ?? (deliveredAt + 7 days)`；并在 Phase 2 写一次性脚本回填 |
| VIP 礼包订单走完整布局后空字段 | bizType=VIP_PACKAGE 但 address 等仍真实存在（用户已确认） | 不需要特殊处理 — 用户决策 VIP 走相同流程 |

---

## 9. 验收标准（最终）

### UX 验收
- [ ] 订单列表卡片显示：店铺名 / 商品图 / SKU 规格 / 数量 / 单价 / 总计 / 状态色 / 主次 CTA
- [ ] 订单详情七区块全部正确渲染（状态头颜色随状态变化）
- [ ] 待收货状态显示自动确认倒计时
- [ ] 已签收订单可看到送达时间
- [ ] 订单号一键复制
- [ ] 物流页：删除地图，运单号可复制，可拨快递电话
- [ ] 售后列表卡片样式与订单列表一致
- [ ] 取消支付宝后回到首页 / 购物车 / 我的页能看到"未完成订单"横幅 + 倒计时
- [ ] 横幅点击能续付（不重复创建 Session）
- [ ] 重复点提交订单被 409 拦截，弹窗给出选项
- [ ] 30 分钟后横幅自动消失（库存释放）
- [ ] VIP 礼包订单显示金色徽章，其他布局与普通订单一致

### 数据验收
- [ ] `GET /orders` 列表返回 5.2 所有字段
- [ ] `GET /orders/:id` 详情返回 5.3 所有字段（特别是 `autoReceiveAt`、`buyerNote`、完整 `address`）
- [ ] `GET /checkout-sessions/me/pending` 返回正确数据，过期后返回 null
- [ ] `POST /orders/checkout` 在已有 ACTIVE Session 时返回 409 + sessionId

### 工程验收
- [ ] TypeScript `tsc -b` 编译通过（前端 + 后端）
- [ ] `npx prisma validate` 通过
- [ ] `npx prisma migrate dev` 干净跑通（Phase 3）
- [ ] 后端新增单测覆盖防重锁逻辑
- [ ] 三 Phase 各自独立 commit + 独立 PR，回滚粒度细
- [ ] CLAUDE.md 中"相关文档"添加本 spec 路径
- [ ] `plan.md` 添加三个 Phase 的 checkbox

---

## 10. 文件清单

### 新增
- `docs/superpowers/specs/2026-05-01-order-pages-redesign-design.md`（本文档）
- `docs/superpowers/plans/2026-05-01-order-pages-redesign.md`（实施计划，下一步生成）
- `src/components/cards/OrderCard.tsx`
- `src/components/cards/OrderItemRow.tsx`
- `src/components/orders/StatusHero.tsx`
- `src/components/orders/AddressCard.tsx`
- `src/components/orders/ShopGroup.tsx`
- `src/components/orders/AmountSummary.tsx`
- `src/components/orders/OrderInfoBlock.tsx`
- `src/components/orders/StickyCTABar.tsx`
- `src/components/overlay/PendingCheckoutBanner.tsx`
- `src/components/ui/Countdown.tsx`
- `app/checkout-pending.tsx`（顶层路由，与 `app/checkout.tsx` 同级）

### 修改
- `app/orders/index.tsx`（ScrollView → FlatList + 卡片重写）
- `app/orders/[id].tsx`（七区块重写）
- `app/orders/track.tsx`（删地图、加复制运单、加快递电话）
- `app/orders/after-sale/index.tsx`（卡片样式同步）
- `app/checkout.tsx`（顶层文件，**注意不是 app/checkout/index.tsx**；6001 行为改造 + 409 防重弹窗 + buyerNote 输入框）
- `app/(tabs)/home.tsx`（mount 横幅）
- `app/cart.tsx`（mount 横幅，**注意不在 (tabs)/ 下**）
- `app/(tabs)/me.tsx`（pendingPay 入口改造为"未完成支付"）
- `src/types/domain/Order.ts`（扩展类型 + paymentMethod 保持 lowercase）
- `src/repos/OrderRepo.ts`（消费新字段；`cancelCheckoutSession` 已有）
- `backend/prisma/schema.prisma`（CheckoutSession.buyerNote + Order.buyerNote）
- `backend/src/modules/order/order.service.ts`（mapOrder / mapOrderDetail 扩展）
- `backend/src/modules/order/checkout.service.ts`（防重锁 + buyerNote 透传）
- `backend/src/modules/order/checkout.dto.ts`（buyerNote 字段）
- `backend/src/modules/order/order.controller.ts`（**新增** `GET /orders/checkout/me/pending`、`POST /orders/checkout/:sessionId/resume`，挂在现有 controller 不新建）
- `CLAUDE.md`（添加文档引用）
- `plan.md`（添加三 Phase checkbox）

### 不会新建
- ~~`backend/src/modules/order/checkout.controller.ts`~~（项目本来就没有这个文件，所有 checkout 路由都在 `order.controller.ts` 下，沿用此约定）
- ~~`src/repos/CheckoutSessionRepo.ts`~~（`pending / resume` 方法直接加到现有 `OrderRepo.ts` 的 `cancelCheckoutSession` 旁，避免新建仓库带来的 import 散乱）

---

**作者**：Claude (主 Agent)
**Spec 状态**：草案，待用户 review
