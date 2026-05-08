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
- 返回逐项结果、价格变动信息和最新购物车，便于 App 给用户明确反馈。

边界：
- 只支持 `Order.status = RECEIVED`。
- `Order.bizType` 使用白名单，仅 `NORMAL_GOODS` 支持复购；任何非 `NORMAL_GOODS` 类型一律拒绝。
- `isPrize = true` 的奖品/赠品全部跳过，不重新加入购物车。
- `VIP_PACKAGE` 订单整体不支持再次购买。
- 本功能不创建 `CheckoutSession`，不锁红包，不预留分润奖励，不计算运费，不进入支付链路。
- `CANCELED` / `REFUNDED` 等非已完成订单是否开放复购列为 v2 议题，本期不做。

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
- 订单 `bizType !== NORMAL_GOODS`：返回 `400`，提示“当前订单类型不支持再次购买”。

逐项处理：
- `isPrize = true`：跳过，原因 `PRIZE_ITEM`。
- SKU 不存在：跳过，原因 `SKU_MISSING`。
- SKU 非 `ACTIVE`：跳过，原因 `SKU_INACTIVE`。
- Product 非 `ACTIVE`：跳过，原因 `PRODUCT_INACTIVE`。
- 商品所属商户非 `ACTIVE`：跳过，原因 `COMPANY_INACTIVE`。
- 商品所属商户 `isPlatform = true`：跳过，原因 `PLATFORM_PRODUCT`，避免平台奖品/奖励商品被主动加购结算。
- 购物车已有数量 + 原订单数量超过 `maxPerOrder`：跳过，原因 `MAX_PER_ORDER_EXCEEDED`。
- 当前 SKU 价格与原订单 `unitPrice` 不一致：仍加入购物车，但返回 `priceChanged = true`、`originalPrice`、`currentPrice` 供前端提示。
- 库存不作为硬拦截，沿用项目“超卖容忍”决策。

### 4.2 写入购物车

后端按普通购物车项合并：
- 用户没有购物车时创建购物车。
- 同 SKU 普通商品已存在时累加数量。
- 同一原订单内出现多行相同 SKU 时，先按 SKU 聚合本次复购数量，再对购物车执行一次更新或创建；返回结果仍保留原订单项行级明细，避免重复创建普通购物车行或用 stale quantity 少加数量。
- 如果历史/竞态数据里同一购物车已存在多个同 SKU 普通商品行，复购时先按这些行的总数量计算限购；未超限时合并为一行并删除重复普通行，超限时整体跳过该 SKU。
- 不创建奖品购物车项。
- 不改变购物车中原有不可用项或奖品项。
- 新加入或更新的商品强制 `isSelected = true`。即使该 SKU 原先在购物车里被用户取消勾选，用户主动点“再次购买”后也应进入可结算选中态。

购物车写入涉及数量状态，使用 `Serializable` 事务，并在事务内重新读取购物车项和限购信息，避免并发点击造成重复行或超过限购。遇到 Prisma `P2034` 序列化冲突时按项目现有模式短重试，超过重试次数再返回失败。

### 4.3 幂等、限流与审计

后端增加两层保护：
- 控制器加轻量限流：`@Throttle({ user: { ttl: 60000, limit: 10 } })`，登录后按用户分桶每分钟最多 10 次，未登录时由全局限流回退到匿名 IP 分桶。实施时必须确认全局 `AppThrottlerGuard` 已注册且 `user` bucket 的 `generateKey()` 按登录主体分桶；这是本项目首个 `user` bucket 路由，应纳入测试/代码审查检查项。
- 服务层用 Redis 做短窗口幂等，使用结果 key 与锁 key 分离：
  - `order:repurchase:result:{userId}:{orderId}`：保存首次成功结果，TTL 60 秒。
  - `order:repurchase:lock:{userId}:{orderId}`：处理中互斥锁，NX 语义，TTL 60 秒。
  - 请求先读 result key；未命中则抢 lock key；抢锁失败时短轮询 result key，仍未产出则返回“处理中，请稍后重试”。
  - 抢锁后再次读取 result key，避免 get 与 acquire 之间的竞态。
  - 成功写入购物车并取得最新 cart 后，写入 result key。失败、404、400 等校验错误不写 result key，只释放 lock key，因此用户修正状态或 orderId 后可立即重试。
  - 如果购物车写入成功但 result key 写入失败，接口返回 `409` 且不主动释放 lock key，让锁自然过期，避免短时间内重试重复加购。
  - Redis 不可用导致 `acquireLock()` 返回 `null` 时，接口 fail-closed 返回 `409`，不在缺少幂等保护的情况下继续写购物车。
  - 复购处理需在 lock TTL 内完成；若超过 60 秒，幂等保护可能失效，测试需覆盖超时/锁过期边界。

审计不直接套管理后台 `@AuditLog()`，因为当前 `AuditLogInterceptor` 写的是 `AdminAuditLog`，上下文是管理端。复购接口先记录结构化业务日志：

```json
{
  "action": "order_repurchase",
  "userId": "...",
  "orderId": "...",
  "addedQuantity": 3,
  "skippedQuantity": 1,
  "priceChangedCount": 1
}
```

如果后续补买家侧审计 sink，再把该日志接入正式用户行为审计。

## 5. 返回结构

```ts
type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
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
      | 'COMPANY_INACTIVE'
      | 'PLATFORM_PRODUCT'
      | 'MAX_PER_ORDER_EXCEEDED';
    priceChanged?: boolean;
    originalPrice?: number;
    currentPrice?: number;
    message?: string;
  }>;
};
```

数量口径：
- `addedItemCount` / `skippedItemCount` 为订单项行数。
- `addedQuantity` / `skippedQuantity` 为数量总和，即 `sum(quantity)`。
- `priceChangedCount` 为已加入但当前价格与原订单价格不一致的订单项行数。
- 如果一个订单项被限购跳过，不自动截断数量，避免用户误以为原数量已完整加入。

订单列表/详情 DTO 可增加轻量字段：

```ts
repurchasable: boolean;
```

该字段只做轻量 UI 判断：`status === RECEIVED && bizType === NORMAL_GOODS && 存在非奖品订单项`。不在列表接口实时深查 SKU/Product/Company 是否仍可买，避免 N+1 和展示口径漂移；真正可复购性仍由 `POST /orders/:id/repurchase` 的逐项结果裁决。

## 6. App 端交互

新增 `OrderRepo.repurchase(orderId)`，调用 `POST /orders/:id/repurchase`。

购物车 store 增加一个显式 hydrate 方法，例如 `replaceFromServer(cart: ServerCart, forceSelectedSkuIds?: string[])`，复用现有 `serverToLocal` 映射逻辑。默认保留本地已有商品的勾选/取消勾选状态；复购成功的 SKU 通过 `forceSelectedSkuIds` 强制选中。复购接口成功后直接用响应里的 `cart` 更新 store，不再额外调用 `syncFromServer()`，减少一次请求和竞态窗口。

接入位置：
- `app/orders/[id].tsx`：`RECEIVED` 状态主按钮“再次购买”改为真实请求。
- `app/orders/index.tsx`：列表卡片中的“再次购买”同步接入真实请求。

交互规则：
- 点击后按钮进入 loading/disabled，防重复点击。
- 订单列表的 `OrderCard` 明确支持 action disabled 状态，列表页与详情页在 loading 和 `repurchasable = false` 时保持一致视觉反馈。
- `addedQuantity > 0`：调用 `useCartStore.getState().replaceFromServer(result.cart)`，跳转 `/cart`。
- 全部成功：toast `已加入购物车`。
- 部分成功：toast `已加入 X 件商品，Y 件不可购买`。
- 存在价格变动：toast 文案追加 `部分商品价格已变动，请到购物车确认`。
- `addedQuantity = 0`：不跳转，toast/error `原订单商品当前不可再次购买`。
- 如 DTO 已返回 `repurchasable = false`，按钮可置灰或隐藏；但接口仍保留完整后端校验，不能依赖前端状态。

购物车页不新增特殊状态。价格、红包、运费、赠品解锁、下架拦截全部继续由购物车和结算页现有链路处理。

## 7. 测试计划

后端单测：
- 非本人订单返回 `404`。
- 非 `RECEIVED` 订单返回 `400`。
- `VIP_PACKAGE` 订单返回 `400`。
- 奖品项跳过。
- SKU 不存在、SKU 下架、Product 下架均跳过。
- Company 非 `ACTIVE` 时跳过。
- 平台公司商品 `isPlatform = true` 时跳过。
- 有效普通商品加入购物车。
- 同 SKU 已在购物车时累加数量。
- 同 SKU 在原订单中出现多行时，购物车只创建/更新一行普通商品，总数量正确累加，返回仍保留行级结果。
- 同 SKU 在购物车已存在多个普通商品行时，按总数量限购，并在未超限时合并重复行。
- 同 SKU 在购物车里 `isSelected = false` 时，复购后变为 `true`。
- 购物车已有数量 + 原订单数量超过 `maxPerOrder` 时跳过。
- 当前价格与原订单价格不一致时仍加入购物车，并返回 `priceChanged = true`。
- 60 秒结果缓存窗口内同用户同订单重复请求只生效一次，第二次返回首次结果。
- 校验失败不写入幂等结果缓存，只释放处理中锁。
- Redis 不可用时返回 `409`，不读取订单、不写购物车。
- result key 写入失败时返回 `409`，不主动释放 lock key，避免短时间重试重复加购。
- 处理中锁未释放/锁过期边界可控，重复请求不会在正常处理时间内二次累加。
- Serializable 冲突按重试策略处理。
- 并发复购不会创建重复普通商品行。

App 端验证：
- 订单详情页“再次购买”成功后跳购物车。
- 订单列表页“再次购买”成功后跳购物车。
- 部分失败 toast 正确。
- 全失败不跳转。
- 价格变动 toast 正确。
- `repurchasable = false` 的已完成订单按钮置灰或隐藏。
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
- 在订单列表实时深查每个 SKU/Product/Company 的可复购状态。
