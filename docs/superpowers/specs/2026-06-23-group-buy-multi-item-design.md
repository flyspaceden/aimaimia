# 团购多商品组合设计方案

## 1. 背景

当前团购活动只绑定一个平台商品和一个 SKU：`GroupBuyActivity.productId + skuId`。管理后台表单只能选择「平台商品 / SKU」，App 也只展示一个商品标题、一个规格和一个库存。

卖家中心已有组合商品能力，但它的模型是把多个 SKU 包成一个新的 `Product(type=BUNDLE)`，下单仍购买这个组合商品自己的售卖 SKU。团购的目标不同：运营人员希望在团购活动里直接选择多个平台商品 SKU，组成一个指定团购商品包，并给这个包设置一个独立团购价。

## 2. 目标

1. 管理后台团购活动可配置多个平台商品 SKU 及数量。
2. 团购价仍由活动本身填写，返还金额按活动团购价计算。
3. 团购库存按所有组成 SKU 的可售数量推导。
4. 团购运费按所有组成 SKU 的重量汇总计算，包邮开关仍按活动配置。
5. App 团购列表、详情、扫码落地和付款页展示组合内容。
6. 支付回调创建订单时保留每个组成 SKU 的订单项，库存、售后、退款、订单详情沿用现有订单链路。
7. 任何组成商品发生退款、退货、换货或取消，仍按现有团购规则使对应推荐资格无效。

## 3. 非目标

1. 不要求运营先创建一个 `Product(type=BUNDLE)` 才能配置团购。
2. 不支持跨平台商品来源；团购明细只能选择平台公司商品。
3. 不支持组合嵌套组合；如果选择已有组合商品作为来源，只展开其普通 SKU 明细，不保存嵌套关系。
4. 不重写普通商品 checkout；只改团购 checkout 的活动快照生成。
5. 不改变推荐码、推荐名额、返还档位和每月发起次数规则。

## 4. 数据模型

新增团购活动明细表：

```prisma
model GroupBuyActivityItem {
  id          String           @id @default(cuid())
  activityId  String
  activity    GroupBuyActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  productId   String
  product     Product          @relation(fields: [productId], references: [id], onDelete: Restrict)
  skuId       String
  sku         ProductSKU       @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity    Int
  sortOrder   Int              @default(0)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@unique([activityId, skuId])
  @@index([activityId])
  @@index([productId])
  @@index([skuId])
}
```

`GroupBuyActivity` 增加：

```prisma
items GroupBuyActivityItem[]
```

兼容策略：

- 保留现有 `GroupBuyActivity.productId` 和 `skuId` 字段，作为首个明细商品的兼容字段。
- 新建和编辑活动时，后端把首个明细同步到 `productId / skuId`。
- 读活动时优先使用 `items`；如果老数据没有 `items`，回退到 `productId / skuId`。
- migration 会按现有 `productId / skuId` 回填一条 `quantity=1` 的明细。

## 5. 管理后台交互

团购活动表单把现在的「平台商品 / SKU」改为「团购商品组合」：

- 添加商品规格：选择平台已上架商品的具体 SKU。
- 数量：每个 SKU 数量必须大于 0。
- 重复 SKU 自动合并数量。
- 可从已有组合商品复制，但只展开其普通 SKU 明细。
- 表格展示商品图、商品名、SKU、当前售价、库存、重量、数量、小计。
- 底部展示参考总价、可组合库存、组合重量。
- 团购价格仍由「团购价格」字段独立填写，不自动等于参考总价。

后台不直接 import 卖家中心代码。卖家中心 `BundleItemsEditor` 的交互和 helper 可以复用思路，在管理后台实现一个本地 `GroupBuyItemsEditor`，避免跨前端工程耦合。

新增或替换接口：

- `GET /admin/group-buy/product-catalog`：返回可选平台商品 SKU 和可展开的组合来源。
- `POST/PATCH /admin/group-buy/activities`：增加 `items: Array<{ productId, skuId, quantity, sortOrder }>`。

校验规则：

- 至少 1 个明细。
- 商品必须属于平台公司。
- 商品和 SKU 必须启用。
- SKU 必须属于对应商品。
- 明细 SKU 重量必须为正整数。
- 直接选择普通 SKU 时保存为活动明细。
- 选择组合商品作为来源时只展开普通 SKU 明细；不能保存组合商品本身为明细。

## 6. 买家 App 展示

`GroupBuyActivity` 类型增加：

```ts
items: Array<{
  productId: string;
  skuId: string;
  productTitle: string;
  skuTitle: string;
  imageUrl: string | null;
  quantity: number;
  stock: number;
  weightGram: number | null;
}>;
availableStock: number;
totalWeightGram: number;
itemSummary: string;
```

展示规则：

- 商品卡片显示活动标题、团购价、包邮/运费、`itemSummary` 和可组合库存。
- 团购详情页在「商品详情」前后增加「包含商品」区块，列出每个商品、规格和数量。
- 扫码落地页和付款页也展示包含商品摘要，避免被推荐人只看到活动标题看不清实际商品。
- 若 `items` 缺失，App 回退展示现有单商品信息。

## 7. 团购 Checkout

团购 checkout 读取活动时 include `items.product.media` 和 `items.sku`。

库存口径：

```text
availableStock = min(floor(sku.stock / item.quantity))
```

如果任一 SKU 库存不足，拒绝付款会话创建。

重量口径：

```text
totalWeightGram = sum(sku.weightGram * item.quantity)
```

非包邮团购按 `totalWeightGram` 计算运费。

价格口径：

- `goodsAmount = activity.price`
- `expectedTotal = activity.price + shippingFee`
- 返还计算继续使用 `GroupBuyInstance.priceSnapshot = activity.price`

订单项价格分摊：

- 按 `sku.price * quantity` 的参考金额作为权重，把 `activity.price` 按分为单位分摊到每个明细。
- 最后一项承接尾差，确保所有订单项金额合计等于活动团购价。
- 每个订单项写入自己的 `skuId / quantity / unitPrice / productSnapshot`。

这能保证支付回调里的现有订单创建逻辑继续按 `itemsSnapshot` 创建订单项，并能正确扣减各 SKU 库存。

## 8. 订单、售后和推荐资格

支付回调已经按 `itemsSnapshot` 创建订单项并逐 SKU 扣库存。多商品团购只要生成正确快照，就能复用现有链路。

售后规则保持现有团购定义：

- 用户对任一组成商品发起退货、换货、退款、取消或产生退款记录，都视为该团购订单不满足有效条件。
- `GroupBuyLifecycleService` 和 `GroupBuyRebateService` 已通过订单级 `afterSaleRequests` / `refunds` 判断资格，继续复用。
- 部分商品售后时，普通订单售后退款按对应订单项金额计算；团购推荐资格仍整体无效。

## 9. 引用保护

奖励商品和 SKU 的删除、下架、禁用保护需要扩展：

- 现有保护只查 `GroupBuyActivity.productId / skuId`。
- 新增后必须同时查 `GroupBuyActivityItem.productId / skuId`。
- 活动处于 `ACTIVE` 或 `PAUSED` 时，组成商品/SKU 不能删除、下架或禁用。

## 10. 测试重点

后端：

- 创建单商品团购时自动生成 1 条明细。
- 创建多商品团购时保存明细并同步首个 `productId / skuId`。
- 重复 SKU 合并或拒绝，数量必须大于 0。
- 非平台商品、下架商品、禁用 SKU、重量缺失 SKU 被拒绝。
- 多商品 checkout 正确计算库存、重量、运费、价格分摊和 `itemsSnapshot`。
- 支付回调后多 SKU 库存分别扣减。
- 任一组成商品售后后，发起资格或推荐返还无效。
- 奖励商品/SKU 被团购明细引用时不能删除或下架。

管理后台：

- 表单可以添加多个 SKU、修改数量、删除明细。
- 可从已有组合商品复制并展开普通 SKU。
- 表格和详情展示组合摘要。

App：

- 团购卡片、详情、扫码落地、付款页展示组合摘要。
- 单商品老活动仍正常显示。
- 多商品库存不足时购买按钮禁用或 checkout 返回明确错误。

## 11. 上线顺序

1. 数据库 migration：新增 `GroupBuyActivityItem` 并回填历史活动。
2. 后端管理接口和 buyer API 返回兼容结构。
3. 管理后台活动表单切换到组合编辑器。
4. 团购 checkout 支持多明细快照。
5. App 展示组合内容。
6. 补齐引用保护和测试。

## 12. 已确认口径

返还金额按后台设置的团购价格计算，不按组成商品原价合计计算。
