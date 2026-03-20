# VIP 赠品组合（多商品）设计方案

> 日期: 2026-03-20
> 状态: 已确认

## 1. 背景与目标

**现状：** 每个 VIP 赠品方案（`VipGiftOption`）只能关联 1 个 SKU。

**目标：** 支持一个赠品方案包含多个商品的组合（如「海鲜×2 + 红酒500ml×1」），管理员可自由组合商品及数量。用户购买 VIP 时仍选择一个方案，但方案内包含多件商品。

## 2. 数据模型变更

### 2.1 新增 CoverMode 枚举

```prisma
enum CoverMode {
  AUTO_GRID      // 宫格拼图（默认）
  AUTO_DIAGONAL  // 对角线分割
  AUTO_STACKED   // 层叠卡片
  CUSTOM         // 自定义上传
}
```

### 2.2 修改 VipGiftOption

```prisma
model VipGiftOption {
  id        String              @id @default(cuid())
  title     String
  subtitle  String?
  badge     String?
  sortOrder Int                 @default(0)
  status    VipGiftOptionStatus @default(ACTIVE)
  coverMode CoverMode           @default(AUTO_GRID)   // 新增
  coverUrl  String?             // 仅 CUSTOM 时有值；切换为非 CUSTOM 时后端清空为 null
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt
  items     VipGiftItem[]       // 新增关系

  // 移除: skuId, sku, marketPrice

  @@index([status, sortOrder])
}
```

同时移除 `ProductSKU` 模型上的旧反向关系 `vipGiftOptions VipGiftOption[]`。

### 2.3 新增 VipGiftItem

```prisma
model VipGiftItem {
  id           String        @id @default(cuid())
  giftOptionId String
  giftOption   VipGiftOption @relation(fields: [giftOptionId], references: [id], onDelete: Cascade)
  skuId        String
  sku          ProductSKU    @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity     Int           @default(1)
  sortOrder    Int           @default(0)
  createdAt    DateTime      @default(now())

  @@unique([giftOptionId, skuId])
  @@index([giftOptionId])
}
```

在 `ProductSKU` 模型上添加新反向关系 `vipGiftItems VipGiftItem[]`。

> **注意：** 删除被赠品方案引用的商品规格会被数据库阻止（`onDelete: Restrict`）。管理员需先从组合中移除该规格，再删除。

### 2.4 价格计算

不存储冗余总价。前端/后端遍历 items 计算：`总价 = Σ(sku.price × quantity)`

### 2.5 VipPurchase 快照变更

`giftSnapshot` 字段新格式：

```json
{
  "title": "海鲜红酒尊享组合",
  "coverMode": "AUTO_GRID",
  "coverUrl": null,
  "badge": "热销",
  "items": [
    {
      "skuId": "xxx",
      "skuTitle": "500g 装",
      "productTitle": "深海大虾礼盒",
      "productImage": "https://...",
      "price": 128.00,
      "quantity": 2
    },
    {
      "skuId": "yyy",
      "skuTitle": "500ml 珍藏版",
      "productTitle": "法国进口红酒",
      "productImage": "https://...",
      "price": 299.00,
      "quantity": 1
    }
  ]
}
```

旧记录保持原格式 `{ title, coverUrl, marketPrice, badge }` 不动。代码读取时按有无 `items` 字段区分新旧格式。

`VipPurchase.giftSkuId` 字段保留但新记录不再写入（新记录 SKU 信息全在 snapshot.items 中）。

## 3. 管理后台前端

### 3.1 Drawer 表单结构（新增/编辑）

| 区域 | 内容 |
|------|------|
| 基础信息 | 方案标题*、副标题、标签、排序值、状态 |
| 组合商品* | Form.List 动态行。每行：商品缩略图 + 奖励商品搜索 + 商品规格选择 + 数量输入 + 小计 + 删除按钮。底部「＋添加商品」按钮。 |
| 价格汇总 | 自动计算：`N 件商品，共 M 件，总价 ¥XXX` |
| 封面图设置 | 单商品时隐藏（自动用商品图）。多商品时显示 Radio 选择拼合样式（宫格拼图/对角线分割/层叠卡片/自定义上传），选自定义时出现上传组件。右侧实时预览当前封面效果。 |

### 3.2 交互细节

- 商品搜索 400ms 防抖，选商品后自动加载规格列表
- 单规格商品自动选中，数量默认 1
- 同方案内不能添加重复规格（前端校验提示）
- 至少 1 个商品行才能提交
- 所有 UI 文字使用中文（商品规格、排序值、上架/下架等），不出现英文缩写

### 3.3 列表页变更

- 原「关联商品」「商品规格」列 → 合并为「组合内容」列，显示如 `深海大虾×2, 红酒×1`
- 原「市场参考价」列 → 改为「组合总价」（自动计算）
- 封面图列按 coverMode 渲染实际效果

## 4. 后端 API 变更

### 4.1 DTO

```typescript
// 创建
CreateVipGiftOptionDto {
  title: string              // 必填，max 60
  subtitle?: string          // max 120
  badge?: string             // max 20
  sortOrder?: number         // 整数 ≥0，默认 0
  status?: VipGiftOptionStatus  // 默认 ACTIVE
  coverMode?: CoverMode      // 默认 AUTO_GRID
  coverUrl?: string          // 仅 CUSTOM 时必填，max 1000
  items: Array<{             // 至少 1 项
    skuId: string
    quantity: number         // 整数 ≥1
    sortOrder?: number       // 整数 ≥0，默认 0
  }>
}

// 更新 — 同结构，所有字段可选
// 传了 items 则整体替换（事务内 delete all + recreate）
```

### 4.2 接口变更

| 接口 | 变更 |
|------|------|
| `GET /admin/vip/gift-options` | 返回嵌套 `items[]`（含规格和商品详情），新增计算字段 `totalPrice` |
| `GET /admin/vip/gift-options/:id` | 同上 |
| `POST /admin/vip/gift-options` | body 用新 DTO，事务内创建 Option + Items |
| `PATCH /admin/vip/gift-options/:id` | 传 items 时事务内删旧建新 |
| `DELETE /admin/vip/gift-options/:id` | 子表 Items 通过 onDelete: Cascade 自动级联删除 |
| `PATCH .../status` | 不变 |
| `GET .../reward-skus` | 不变 |
| `GET .../sku-references/:skuId` | 查询改为查 VipGiftItem 表 |

### 4.3 校验规则

- 每个 item 的 SKU 必须属于平台公司（`isPlatform=true`）且商品和规格均为 ACTIVE
- items 内 skuId 不能重复
- items 数组不能为空，最多 20 项
- 单个 item 的 quantity 范围：1 ~ 99
- coverMode 为 CUSTOM 时 coverUrl 必填
- coverMode 切换为非 CUSTOM 时，后端自动清空 coverUrl

### 4.4 结算流程变更（checkout.service.ts）

VIP 结算流程当前假设单个 SKU，需改为多 SKU 支持：

1. **查询赠品方案**：`findUnique` 时 include `items` 及其嵌套 `sku.product`，不再读 `giftOption.skuId`
2. **库存校验**：遍历每个 item，检查 `sku.stock >= item.quantity` 且 `sku.status === ACTIVE` 且 `product.status === ACTIVE`
3. **库存预留**：为每个 item 创建独立的 `InventoryLedger` RESERVE 记录（skuId + quantity）
4. **itemsSnapshot**：生成多元素数组，每个元素对应一个 item（skuId、productTitle、skuTitle、price、quantity、productImage）
5. **bizMeta**：移除 `giftSkuId` 字段，改为 `giftOptionId`（方案 ID）+ `itemCount`（商品种类数）

### 4.5 VIP 激活流程变更（bonus.service.ts）

`activateVipAfterPayment` 方法需适配：

1. **参数签名**：移除 `giftSkuId` 参数，改为接收 `giftOptionId` + 完整 `giftSnapshot`（含 items 数组）
2. **VipPurchase 写入**：`giftSkuId` 设为 null，`giftSnapshot` 写入新格式（含 items 数组）
3. **bizMeta 校验**：支付回调中不再要求 `bizMeta.giftSkuId`，改为检查 `bizMeta.giftOptionId`

### 4.6 买家端赠品列表 API 变更

**接口：** `GET /bonus/vip/gift-options`（买家端，非管理端）

**响应变更：**

```typescript
{
  id: string
  title: string
  subtitle?: string
  badge?: string
  coverMode: CoverMode
  coverUrl?: string
  totalPrice: number          // 服务端计算 Σ(sku.price × quantity)
  available: boolean          // 所有 item 的 SKU 均 ACTIVE 且库存充足
  items: Array<{
    skuId: string
    productTitle: string
    productImage: string      // 取 product.media[0]
    skuTitle: string
    price: number             // sku.price
    quantity: number
  }>
}
```

**可用性判断：** `available = 每个 item 的 sku.status === ACTIVE && product.status === ACTIVE && sku.stock >= item.quantity`

### 4.7 getSkuReferences 查询变更

原来直接查 `VipGiftOption.skuId`，改为：通过 `VipGiftItem` 表查找引用该 skuId 的记录，再返回去重后的父级 `VipGiftOption` 信息。

## 5. 买家 App 端变更

### 5.1 赠品展示

- 赠品方案卡片显示：封面图 + 标题 + 副标题 + 组合摘要（如「深海大虾×2 + 红酒×1」）+ 组合总价
- 封面图根据 `coverMode` 渲染：
  - `AUTO_GRID` — 宫格拼图（2件左右各半，3件上1下2，4件2×2，5+件取前4+「+N」角标）
  - `AUTO_DIAGONAL` — 对角线分割
  - `AUTO_STACKED` — 层叠卡片
  - `CUSTOM` — 展示 coverUrl
- 单商品方案直接展示该商品图，忽略 coverMode

### 5.2 TypeScript 类型变更

`src/types/domain/Bonus.ts` 中 `VipGiftOption` 类型更新：
- 移除：`skuId`、`marketPrice`、`sku`
- 新增：`items: VipGiftItemInfo[]`、`coverMode: CoverMode`、`totalPrice: number`、`available: boolean`

`useCheckoutStore.ts` 中 `VipPackageSelection` 更新：
- 移除：`giftSkuId`
- 新增：`giftOptionId: string`、`giftSnapshot: object`（含 items 数组）

### 5.3 买家端 API

- `GET /bonus/vip/gift-options` 返回更新后的响应格式（见 §4.6）
- 每个 item 包含：商品名、商品图、规格名、单价、数量

### 5.4 快照

- 下单时将完整组合信息写入 `VipPurchase.giftSnapshot`（新格式含 `items` 数组）
- 订单详情页根据快照展示赠品组合
- 库存释放逻辑（`releaseVipReservation`）改为遍历 `itemsSnapshot` 多元素数组释放每个 SKU

## 6. 数据迁移

### 6.1 单次迁移脚本（事务内执行）

```sql
-- 整个迁移在单一事务中执行，任一步失败全部回滚
-- 1. 新增 CoverMode 枚举
-- 2. VipGiftOption 新增 coverMode 列（默认 AUTO_GRID）
-- 3. 创建 VipGiftItem 表
-- 4. 前置检查：验证所有 VipGiftOption.skuId 指向有效的 ProductSKU，记录孤儿数据
-- 5. 将现有每条 VipGiftOption 的 skuId 插入 VipGiftItem（quantity=1, sortOrder=0）
-- 6. 移除 VipGiftOption 的 skuId 和 marketPrice 列
```

### 6.3 种子数据

如 Prisma seed 脚本中有 VipGiftOption 相关数据，需更新为使用 `items` 嵌套创建，移除 `skuId`/`marketPrice`。

### 6.2 VipPurchase 兼容

- 旧 `giftSnapshot` 保持原格式不动
- 代码读取时：有 `items` 字段 → 新格式，无 → 旧格式
- `giftSkuId` 字段保留，新记录不写入

## 7. 前端文字规范

所有面向管理员/用户的 UI 不使用英文缩写：

| 代码/字段 | UI 展示文字 |
|-----------|------------|
| SKU | 商品规格 |
| coverMode: AUTO_GRID | 宫格拼图 |
| coverMode: AUTO_DIAGONAL | 对角线分割 |
| coverMode: AUTO_STACKED | 层叠卡片 |
| coverMode: CUSTOM | 自定义上传 |
| status: ACTIVE | 上架 |
| status: INACTIVE | 下架 |
| badge | 标签 |
| sortOrder | 排序值 |
| quantity | 数量 |
