# 订单再次购买功能设计方案

日期：2026-05-08

## 1. 背景

买家 App 订单列表和订单详情在 `RECEIVED` 已完成订单上已经展示“再次购买”按钮，但当前只提示“功能即将上线”。本方案补齐该按钮的真实能力：把原订单中仍可购买的普通商品重新加入购物车，然后跳转购物车，由用户重新确认价格、运费、红包和结算。

相关现状：
- 订单流程已改为付款后建单：`CheckoutSession -> 支付回调 -> Order(PAID)`。
- 购物车已有单品加购与登录合并能力，但没有按订单批量复购接口。
- 奖品、赠品、VIP 礼包与普通商品存在独立业务规则，不能混入普通复购。
- 商品/SKU 上下架兜底已经在购物车和结算链路落地，不可用商品不应重新进入购物车。

## 2. 目标与边界

目标：
- `RECEIVED` 已完成普通商品订单支持“再次购买”。
- 点击后把可复购商品加入购物车，并跳转 `/cart`。
- 支持部分成功：可买商品加入购物车，不可买商品跳过并提示。
- 返回逐项结果，便于 App 给用户明确反馈。

边界：
- 只支持 `Order.status = RECEIVED`。
- 只支持 `Order.bizType = NORMAL_GOODS`。
- `isPrize = true` 的奖品/赠品全部跳过，不重新加入购物车。
- `VIP_PACKAGE` 订单整体不支持再次购买。
- 本功能不创建 `CheckoutSession`，不锁红包，不预留分润奖励，不计算运费，不进入支付链路。

## 3. 推荐方案

新增后端领域接口：

```http
POST /api/v1/orders/:id/repurchase
```

由 `OrderController` 暴露，调用 `OrderService.repurchase(orderId, userId)`。后端负责读取订单、校验归属与状态、筛选可复购项、合并到购物车，并返回最新购物车快照和逐项结果。

不采用纯前端循环加购，原因是前端当前不能可靠拿到订单项 `skuId`，并且下架、限购、部分失败、购物车合并等规则应由后端统一裁决。

## 4. 后端行为

### 4.1 校验

接口入口校验：
- 订单不存在或不属于当前用户：返回 `404`。
- 订单不是 `RECEIVED`：返回 `400`，提示“仅已完成订单支持再次购买”。
- 订单 `bizType = VIP_PACKAGE`：返回 `400`，提示“VIP 礼包不支持再次购买”。

逐项处理：
- `isPrize = true`：跳过，原因 `PRIZE_ITEM`。
- SKU 不存在：跳过，原因 `SKU_MISSING`。
- SKU 非 `ACTIVE`：跳过，原因 `SKU_INACTIVE`。
- Product 非 `ACTIVE`：跳过，原因 `PRODUCT_INACTIVE`。
- 购物车已有数量 + 原订单数量超过 `maxPerOrder`：跳过，原因 `MAX_PER_ORDER_EXCEEDED`。
- 库存不作为硬拦截，沿用项目“超卖容忍”决策。

### 4.2 写入购物车

后端按普通购物车项合并：
- 用户没有购物车时创建购物车。
- 同 SKU 普通商品已存在时累加数量。
- 不创建奖品购物车项。
- 不改变购物车中原有不可用项或奖品项。
- 新加入或更新的商品保持服务端默认 `isSelected = true`。

购物车写入涉及数量状态，使用 `Serializable` 事务，并在事务内重新读取购物车项和限购信息，避免并发点击造成重复行或超过限购。

## 5. 返回结构

```ts
type RepurchaseResult = {
  addedCount: number;
  skippedCount: number;
  cart: ServerCart;
  items: Array<{
    orderItemId: string;
    skuId: string;
    title: string;
    quantity: number;
    status: 'ADDED' | 'SKIPPED';
    reason?:
      | 'PRIZE_ITEM'
      | 'SKU_MISSING'
      | 'SKU_INACTIVE'
      | 'PRODUCT_INACTIVE'
      | 'MAX_PER_ORDER_EXCEEDED';
    message?: string;
  }>;
};
```

数量口径：
- `addedCount` 为成功加入购物车的订单项数量总和，即 `sum(quantity)`。
- `skippedCount` 为跳过的订单项数量总和，即 `sum(quantity)`。
- 如果一个订单项被限购跳过，不自动截断数量，避免用户误以为原数量已完整加入。

## 6. App 端交互

新增 `OrderRepo.repurchase(orderId)`，调用 `POST /orders/:id/repurchase`。

接入位置：
- `app/orders/[id].tsx`：`RECEIVED` 状态主按钮“再次购买”改为真实请求。
- `app/orders/index.tsx`：列表卡片中的“再次购买”同步接入真实请求。

交互规则：
- 点击后按钮进入 loading/disabled，防重复点击。
- `addedCount > 0`：调用 `useCartStore.getState().syncFromServer()`，跳转 `/cart`。
- 全部成功：toast `已加入购物车`。
- 部分成功：toast `已加入 X 件商品，Y 件不可购买`。
- `addedCount = 0`：不跳转，toast/error `原订单商品当前不可再次购买`。

购物车页不新增特殊状态。价格、红包、运费、赠品解锁、下架拦截全部继续由购物车和结算页现有链路处理。

## 7. 测试计划

后端单测：
- 非本人订单返回 `404`。
- 非 `RECEIVED` 订单返回 `400`。
- `VIP_PACKAGE` 订单返回 `400`。
- 奖品项跳过。
- SKU 不存在、SKU 下架、Product 下架均跳过。
- 有效普通商品加入购物车。
- 同 SKU 已在购物车时累加数量。
- 购物车已有数量 + 原订单数量超过 `maxPerOrder` 时跳过。
- 并发复购不会创建重复普通商品行。

App 端验证：
- 订单详情页“再次购买”成功后跳购物车。
- 订单列表页“再次购买”成功后跳购物车。
- 部分失败 toast 正确。
- 全失败不跳转。
- 按钮 loading 期间不能重复触发。

## 8. 文档同步

实施完成后同步：
- `docs/architecture/frontend.md`：订单页面“再次购买”从占位改为真实复购能力。
- `plan.md`：追加/更新订单链路任务进度。
- `AGENTS.md`：登记本设计文档与后续实施计划。

## 9. 不做事项

本期不做：
- 再次购买直接进入确认订单页。
- 弹出不可购买清单让用户二次确认。
- 复购奖品、门槛赠品、VIP 礼包。
- 自动选择红包、奖励或地址。
- 对取消/退款/运输中订单开放再次购买。
