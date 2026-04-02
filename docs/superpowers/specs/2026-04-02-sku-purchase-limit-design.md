# SKU 单笔订单限购设计方案

> 日期：2026-04-02
> 状态：已确认

## 1. 需求概述

卖家可为每个 SKU 设置单笔订单限购数量。买家在一笔订单中对该 SKU 的购买数量不得超过此上限。不设置时默认不限制。

## 2. 数据模型

### ProductSKU 新增字段

```prisma
model ProductSKU {
  // ... 现有字段
  maxPerOrder  Int?    // 单笔订单限购数量，null = 不限制
}
```

- 类型：`Int?`，nullable
- 默认值：`null`（不限制）
- 约束：不为 null 时必须 >= 1

不需要新建表、枚举或关联关系。

## 3. 校验逻辑

三层校验，前端拦截 + 后端兜底：

### 3.1 商品详情页 — 加入购物车

买家在商品详情页点击"加入购物车"时：

```
已有数量 = 购物车中该 SKU 的 quantity（无则为 0）
if maxPerOrder != null && 已有数量 + 本次数量 > maxPerOrder:
    提示"该商品每单限购 {maxPerOrder} 件，购物车已有 {已有数量} 件"
    拒绝加入
```

### 3.2 购物车页 — 修改数量

买家在购物车中修改数量时：

- 数量 stepper 的 `+` 按钮在数量达到 `maxPerOrder` 时置灰
- `updateQty` 将数量 clamp 到 `maxPerOrder` 上限并 Toast 提示
- 数量 stepper 的最小值为 1（已有逻辑）

### 3.3 结账后端 — 兜底校验

`checkout.service.ts` 中，在现有 SKU 状态/库存校验之后：

```
for each item in checkoutItems:
    if sku.maxPerOrder != null && item.quantity > sku.maxPerOrder:
        throw BadRequestException("商品规格「{sku.title}」每单限购 {sku.maxPerOrder} 件")
```

此为安全兜底，防止绕过前端直接调用 API。

## 4. 卖家后台改动

### 商品编辑页

- SKU 列表每行新增"单笔限购"列
- 输入组件：`InputNumber`，min=1，placeholder="不限"
- 默认空（不限制），卖家主动填写才生效
- 清空输入框时传 `null`

### 卖家端 API

商品创建/编辑 DTO 中 SKU 对象新增字段：

```typescript
maxPerOrder?: number | null  // 可选，null 或不传 = 不限制，传值时 >= 1
```

## 5. 管理后台改动

- 商品编辑页：同卖家后台，SKU 行增加"单笔限购"输入框，默认空
- 商品详情查看：展示限购值（null 显示为"不限"）

## 6. 买家 App 改动

### 类型扩展

`src/types/domain/` 中 SKU 类型新增：

```typescript
maxPerOrder?: number | null
```

### 商品详情页

- 有限购的 SKU 在价格区域附近显示标签："每单限购 X 件"
- 加入购物车按钮触发时检查限购

### 购物车页

- 数量 stepper 上限受 `maxPerOrder` 约束
- 超限时 Toast 提示

### useCartStore

- `addItem`：检查已有数量 + 新增数量是否超过 `maxPerOrder`
- `updateQty`：clamp 数量到 `maxPerOrder`

## 7. 不涉及的范围

- **不做每人累计限购**（跨订单限制）— 当前无此需求
- **不做商品级聚合限购**（同商品不同 SKU 共享额度）— 限购在 SKU 级别独立
- **不影响库存逻辑** — 限购和库存是独立约束，超卖容忍机制不变
- **不影响奖品/赠品** — 奖品有独立的领取逻辑，不受此限购约束
