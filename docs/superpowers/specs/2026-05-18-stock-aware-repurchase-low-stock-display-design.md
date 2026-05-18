# 库存感知复购与低库存展示设计方案

日期：2026-05-18

## 1. 背景

真机测试发现：用户从已完成订单发起“再次购买”时，历史订单数量可能已经大于当前 SKU 库存。现有复购设计沿用项目“普通商品超卖容忍”策略，库存不作为硬拦截；这会导致购物车里出现历史数量，用户在低库存场景下无法自然调整，测试人员会理解为系统把“再次购买”错误地锁成了原订单。

本方案补充并覆盖 `docs/superpowers/specs/2026-05-08-order-repurchase-design.md` 中的库存相关口径：底层订单/支付仍保留普通商品超卖容忍作为并发兜底，但复购、购物车和 App 展示必须变成库存感知，避免用户在已知低库存或无库存状态下误选、误结算。

## 2. 已确认决策

- 保留普通商品“超卖容忍”：支付成功后的普通商品库存扣减仍允许变为负数，卖家补货通知机制继续作为兜底。
- 复购入口要实时读取当前 SKU 库存。
- 复购目标数量超过当前库存，且库存大于 0 时，购物车里该 SKU 的最终数量为 `1`。
- 复购目标 SKU 当前库存为 `0` 时，不创建或合并真实 `CartItem`；接口返回虚拟不可结算结果，App 可在购物车顶部或复购提示区展示“无库存，未加入购物车”。
- 如果购物车里已经有同 SKU，复购遇到低库存时覆盖为 `1`、不累加；遇到无库存时不累加、不覆盖数量，只强制旧行未选中并返回虚拟提示。
- App 低库存展示使用平台统一阈值，管理后台可配置，默认 `10`。

## 3. 目标与边界

目标：
- 复购低库存时不再把历史数量原样带入购物车。
- 无库存商品不能作为新的真实购物车项加入；如果是库存变更后已经存在的旧购物车项，则必须变为不可选、不可结算，只能删除。
- App 在库存 `1..阈值` 时展示“仅剩 x 件”，库存 `0` 时展示“无库存”。
- 管理后台提供统一低库存展示阈值配置，默认 `10`。
- 购物车数量减少不被低库存拦截，用户能把超量商品降回合理数量或删除。

边界：
- 本期不改变普通商品支付回调的负库存容忍。
- 本期不做商家/商品/SKU 级独立阈值。
- 本期不把低库存展示扩展到所有列表卡片；第一版优先覆盖商品详情、购物车、结算页和复购结果。
- VIP 礼包、奖品、门槛赠品仍按各自库存/锁定规则处理，不套普通商品复购规则。

## 4. 复购库存规则

后端 `POST /api/v1/orders/:id/repurchase` 在现有订单状态、商品状态、限购、幂等校验基础上增加库存裁决。裁决必须在写购物车的 `Serializable` 事务内重新读取 SKU 库存和购物车现有数量。

逐 SKU 聚合后计算：

```ts
desiredFinalQty = existingCartQty + repurchaseQty;
currentStock = sku.stock;
```

处理规则：
- `currentStock <= 0`：不创建新购物车项；若同 SKU 已存在普通购物车行，保留该行但强制 `isSelected = false`，返回原因 `OUT_OF_STOCK_VIRTUAL`，消息“商品暂无库存，未加入购物车”。响应项标记 `virtual = true`，用于 App 展示虚拟提示。
- `currentStock > 0 && desiredFinalQty > currentStock`：最终购物车数量覆盖为 `1`，`isSelected = true`，返回原因 `LOW_STOCK_ADJUSTED`，消息“当前仅剩 x 件，已按 1 件加入购物车”。
- `currentStock > 0 && desiredFinalQty <= currentStock`：沿用原复购累加逻辑，最终数量为 `desiredFinalQty`，`isSelected = true`。

限购规则仍是硬约束：
- 如果最终数量超过 `maxPerOrder`，第一版保持既有复购口径：跳过该 SKU 并返回 `MAX_PER_ORDER_EXCEEDED`。
- 低库存覆盖为 `1` 后若 `maxPerOrder >= 1`，允许加入；若异常配置为 `0`，跳过并返回 `MAX_PER_ORDER_EXCEEDED`。

同 SKU 已在购物车时：
- 普通库存充足时继续按原逻辑累加。
- 低库存时覆盖同 SKU 普通购物车行的数量为 `1` 并设为选中；无库存时不累加、不覆盖数量，只强制该行未选中并返回虚拟提示。
- 如果历史数据里同一购物车存在多个同 SKU 普通行，先合并为一行再应用上述规则，避免用户看到重复行。

## 5. 购物车与结算规则

购物车需要以当前 SKU 库存派生库存状态：

```ts
stockStatus =
  sku.stock <= 0 ? 'OUT_OF_STOCK' :
  sku.stock <= lowStockDisplayThreshold ? 'LOW_STOCK' :
  'NORMAL';
```

交互规则：
- `OUT_OF_STOCK`：展示“无库存”，复选框禁用且保持未选中，数量加减禁用，删除按钮可用；新加购和复购不得创建真实购物车项。
- `LOW_STOCK`：展示“仅剩 x 件”，数量减少和删除始终可用；数量增加不得超过当前库存和 `maxPerOrder` 中更小的有效上限。
- `NORMAL`：沿用现有数量、限购和赠品解锁规则。
- 当服务端刷新发现已选商品库存变为 `0`，后端应把该购物车项置为 `isSelected = false`，App 展示不可选原因。
- 结算页进入或提交前要重新拉取购物车/库存快照。已知 `OUT_OF_STOCK` 商品不得进入 `CheckoutSession`；正库存但并发扣减导致最终超卖时，支付成功后的库存扣减仍保留普通商品超卖容忍兜底。

这套规则的重点是“已知无库存不能结算、已知低库存要给用户明确提示”，不是在所有竞态下彻底禁止普通商品负库存。

## 6. App 低库存展示

低库存阈值来自平台配置 `LOW_STOCK_DISPLAY_THRESHOLD`，默认 `10`。App 没有拿到配置或接口失败时使用默认值 `10`。

展示口径：
- `stock <= 0`：显示“无库存”或“暂时无库存”。
- `1 <= stock <= threshold`：显示“仅剩 x 件”。
- `stock > threshold`：不展示库存数量。
- `threshold = 0`：关闭“仅剩 x 件”展示，但 `stock <= 0` 的无库存状态仍必须展示。

第一版覆盖：
- 商品详情页：选中 SKU 区域和加入购物车按钮状态。
- 购物车页：商品卡片状态、复选框、数量控制、底部合计。
- 结算页：商品行展示和提交前库存刷新。
- 复购成功后的 toast：低库存调整和无库存虚拟提示要有明确文案。

第二版可选覆盖：
- 商品列表、搜索列表、推荐卡片、发现页瀑布流。
- 卖家/管理后台商品列表低库存筛选和预警样式统一。

## 7. 后台配置

使用现有 `RuleConfig` 表新增配置键：

```ts
LOW_STOCK_DISPLAY_THRESHOLD = 10
```

管理后台：
- 在平台设置页增加“App 低库存展示阈值”数字输入。
- 权限沿用 `config:read` / `config:update`。
- 校验规则：整数，范围 `0..999`；`0` 表示关闭“仅剩 x 件”展示。
- 保存时进入 `RuleVersion` 版本记录，便于回滚。

后端公共读取：
- 提供轻量读取方法，缺失或异常时回退 `10`。
- 新增公开只读接口 `GET /api/v1/app/config`，返回 `{ lowStockDisplayThreshold: number }`；后续 App 公共配置也复用该接口。
- 不把该阈值写入商品/SKU 表，避免商品数据和平台展示策略耦合。

## 8. API 与类型变更

复购返回项新增库存相关字段：

```ts
type RepurchaseItemResult = {
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  stock?: number;
  adjustedQuantity?: number;
  virtual?: boolean;
  reason?:
    | 'PRIZE_ITEM'
    | 'SKU_MISSING'
    | 'SKU_INACTIVE'
    | 'PRODUCT_INACTIVE'
    | 'COMPANY_INACTIVE'
    | 'PLATFORM_PRODUCT'
    | 'MAX_PER_ORDER_EXCEEDED'
    | 'LOW_STOCK_ADJUSTED'
    | 'OUT_OF_STOCK_VIRTUAL';
  message?: string;
};
```

购物车快照建议补充或派生：

```ts
type ServerCartItem = {
  sku: {
    stock: number;
    maxPerOrder?: number | null;
  };
  isSelected: boolean;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  selectable?: boolean;
};
```

如果后端不直接返回 `stockStatus`，App 也必须能用 `sku.stock` 和阈值本地派生；但 `OUT_OF_STOCK` 的 `isSelected=false` 应由后端持久化，不能只靠前端隐藏。

## 9. 测试计划

后端单测：
- 库存充足：复购按原订单数量或购物车累加数量加入。
- 原订单数量大于库存且库存为 `1`：最终购物车数量为 `1`，选中。
- 购物车已有同 SKU，复购后总数量会超过库存：最终覆盖为 `1`，选中。
- 库存为 `0`：不创建真实购物车项，返回 `OUT_OF_STOCK_VIRTUAL`，`virtual=true`。
- 库存为负数：按无库存处理，不创建真实购物车项，返回 `OUT_OF_STOCK_VIRTUAL`。
- 无库存购物车项尝试勾选：后端拒绝或强制保持未选中。
- 低库存商品数量减少：允许减少，不被库存校验拦截。
- 低库存商品数量增加超过库存：拒绝并提示“当前仅剩 x 件”。
- 配置缺失：低库存阈值回退 `10`。
- 配置为 `0`：不展示低库存，但无库存仍禁选。
- 复购事务并发冲突按现有 `Serializable` 重试策略处理。

App 真机验证：
- 库存 1、历史订单 3：再次购买后购物车显示数量 1，展示“仅剩 1 件”。
- 库存 0、历史订单 3：再次购买后真实购物车不新增该商品，App 展示“无库存，未加入购物车”的虚拟提示。
- 库存 10 且阈值 10：商品详情/购物车显示“仅剩 10 件”。
- 库存 11 且阈值 10：不显示低库存文案。
- 管理后台把阈值改为 5 后，App 展示口径跟随更新。
- 大字体模式下“仅剩 x 件”“无库存”不挤压主 CTA。

## 10. 不做事项

本期不做：
- 取消普通商品超卖容忍。
- 库存不足时自动改为 `min(原订单数量, 当前库存)`；已确认低库存统一改为 `1`。
- 每个商品/SKU 单独设置低库存展示阈值。
- 卖家端自定义低库存展示阈值。
- 自动删除已有无库存购物车项；已有旧购物车项保持可删除但不可选，新加购/复购不创建真实项。
- 对奖品、VIP 礼包套普通商品低库存复购规则。
