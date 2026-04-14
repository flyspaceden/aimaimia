# L3. 购物车 + 下单（CheckoutSession）💰 Audit Draft

**Tier**: 1
**审查时间**: 2026-04-11
**Agent**: general-purpose

## 🚨 关键疑点

> **2026-04-11 更新**：原疑点 1（普通商品库存非 CAS）已经用户确认为 R12 超卖容忍的**故意设计**（见 CLAUDE.md 架构决策：`超卖容忍：允许库存变为负数，卖家收到补货通知，不退款`）。从疑点清单移除。真正的 🟡 项是 R12 设计的另一半——`checkout.service.ts:1264` 的卖家补货通知 TODO 还没实现。详见下方"已知问题" section。

1. ~~**运费分摊尾差**~~ → ✅ 已确认非问题（2026-04-13 Q6）：**运费全部由平台支付，不考虑商家**。`checkout.service.ts:1124-1129` 的分摊逻辑仅影响 Order 表的 `shippingFee` 记账字段。商家不参与运费结算，所以 ±0.01 元尾差对业务无实际影响。代码不需要改。

2. **`previewOrder` 不参与 expectedTotal 一致性校验的锁定**：前端 preview 拿到 `totalPayable` → 作为 `expectedTotal` 传入 checkout，后端在事务内二次计算并比对（checkout.service.ts:591-600）。但 preview 和 checkout 中间，运费 ShippingRule / VIP 折扣率 / 红包 validateAndReserveCoupons 读取顺序不同——如果管理员在这几毫秒改配置，preview 会显示错的价格，checkout 会报"价格已变更"。这是可接受的，但对此类场景没有用户友好的"刷新并重试"按钮（见前端 checkout.tsx:293-296）。

## 📍 范围

审查范围覆盖购物车加购/合并（cart.service.ts）、CheckoutSession 创建与支付回调建单（checkout.service.ts）、订单路由（order.controller.ts）、前端 checkout 页面与 OrderRepo、CartStore 本地模式、Prisma schema 的 CheckoutSession/Order/OrderItem/ShippingRule 模型。

## 🔗 端到端路径

```
[前端 app/cart.tsx]
      ↓ 用户勾选商品 → 跳转 checkout
[前端 app/checkout.tsx] useEffect(syncFromServer) + useQuery(order-preview)
      ↓ POST /orders/preview  (OrderService.previewOrder)
      ↓ 用户点击提交 → OrderRepo.createCheckoutSession({items, addressId, couponInstanceIds, idempotencyKey, expectedTotal})
[后端 OrderController.checkout] → CheckoutService.checkout()
   1. 幂等命中直接返回
   2. 查 SKU + 购物车 + 奖品匹配 → snapshotItems
   3. F2 门槛赠品筛掉未解锁
   4. 地址快照（AES 加密）
   5. 计算整单运费（ShippingRule 三维度）
   6. VIP 折扣
   7. 红包 validateAndReserveCoupons（独立 Serializable 事务）
   8. === Serializable 事务 (3 retries on P2034) ===
      - RewardLedger CAS RESERVED
      - expectedTotal 计算 + 前端比对
      - CheckoutSession.create({status:ACTIVE, expiresAt:+30min})
      ===
   9. 返回 sessionId + paymentParams
      ↓
[前端] payWithAlipay or simulatePayment(merchantOrderNo)
      ↓
[后端 PaymentController 回调] → CheckoutService.handlePaymentSuccess()
   === Serializable 事务 (3 retries) ===
   1. CheckoutSession CAS ACTIVE→PAID
   2. 按 companyId 分组 → 逐 Order.create({status:PAID})
   3. 库存扣减（NORMAL: decrement / VIP: ledger 迁移）
   4. RewardLedger RESERVED→VOIDED
   5. 按 cartItemId 精确删购物车
   6. LotteryRecord WON/IN_CART→CONSUMED
   7. Session→COMPLETED
   ===
   8. 事务外：confirmCouponUsage + activateVipAfterPayment
      ↓
[前端轮询] GET /orders/checkout/:sessionId/status 直到 COMPLETED
      ↓ clearCheckedItems() + 跳转订单详情
```

## 💰 账本完整性检查

| 阶段 | 写入的表 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| checkout() 创建 | CheckoutSession | status=ACTIVE, expiresAt=+30min | ✅ checkout.service.ts:603-624 | ✅ |
| checkout() 预留奖励 | RewardLedger | AVAILABLE→RESERVED (CAS) | ✅ checkout.service.ts:540-557 | ✅ |
| checkout() 锁定红包 | CouponInstance | validateAndReserveCoupons | ✅ (独立事务:473-488) | ✅ |
| VIP 预留库存 | ProductSKU+InventoryLedger | CAS decrement + RESERVE ledger | ✅ checkout.service.ts:898-918 | ✅ |
| handlePaymentSuccess | CheckoutSession | CAS ACTIVE→PAID | ✅ checkout.service.ts:1071-1078 | ✅ |
| handlePaymentSuccess | Order | 每商户一单，idempotencyKey=`cs:{sid}:{hash}:{idx}` | ✅ checkout.service.ts:1177-1208 | ✅ |
| handlePaymentSuccess | OrderStatusHistory | PENDING_PAYMENT→PAID | ✅ checkout.service.ts:1219-1227 | ✅ |
| handlePaymentSuccess | ProductSKU | decrement（R12 超卖容忍，允许负数） | ✅ checkout.service.ts:1256-1259（by design，依赖卖家补货通知） | ✅ |
| handlePaymentSuccess | InventoryLedger | RESERVE record | ✅ checkout.service.ts:1266-1274 | ✅ |
| handlePaymentSuccess | RewardLedger | RESERVED→VOIDED | ✅ checkout.service.ts:1279-1283 | ✅ |
| handlePaymentSuccess | CartItem | 按 cartItemId 精确删 | ✅ checkout.service.ts:1286-1297（C3 修复） | ✅ |
| handlePaymentSuccess | LotteryRecord | WON/IN_CART→CONSUMED | ✅ checkout.service.ts:1301-1312 | ✅ |
| handlePaymentSuccess | CheckoutSession | ACTIVE→COMPLETED（实际 PAID→COMPLETED） | ✅ checkout.service.ts:1315-1318 | ✅ |
| 事务外 | CouponInstance | RESERVED→USED（3 次重试，失败仅日志） | 🟡 checkout.service.ts:1420-1452，失败后无补偿队列 | 🟡 |
| 事务外 | MemberProfile+VipTreeNode | activateVipAfterPayment（3 次重试） | 🟡 checkout.service.ts:1463-1512，失败后无补偿队列 | 🟡 |

## 🔒 并发安全检查

- [x] **Serializable 隔离级别**: ✅ checkout.service.ts:627, 830(VIP), 992(cancel), 1417(payment) 全部显式 `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`
- [x] **幂等键**:
  - CheckoutSession: `@@unique([userId, idempotencyKey])` (schema.prisma:1353) + `merchantOrderNo @unique` (schema.prisma:1332) ✅
  - Order: `idempotencyKey @unique` (schema.prisma:1373)，事务内生成 `cs:{sessionId}:{cartHash}:{idx}` (checkout.service.ts:1175) ✅
  - checkout() 入口双重保护：先查（140-148）后写（P2002 fallback 645-652）✅
- [x] **CAS 更新**:
  - RewardLedger CAS: ✅ checkout.service.ts:540 `where: { id, userId, status:'AVAILABLE', entryType:'RELEASE', refId:null }`
  - CheckoutSession 状态机 CAS: ✅ 1071, 973
  - VIP 库存 CAS: ✅ 898 `where: { stock: { gte: qty } }`（严格防超卖，VIP 礼包限量稀缺）
  - **普通商品库存非 CAS**: ✅ **by design** — checkout.service.ts:1256 裸 `decrement`，走 Serializable + 允许负数。这是 R12 超卖容忍设计（CLAUDE.md 架构决策，2026-04-11 用户再次确认），为最大化成交。真正缺的是 R12 设计的另一半——卖家补货通知（line 1264 TODO），见"已知问题"
- [x] **P2034 重试**: ✅ checkout.service.ts:638-642 (checkout), 1010-1016 (cancel), 1531-1543 (payment) 均有指数退避 3 次重试
- [x] **金额精度 Float/元**: ✅ schema.prisma:1326-1329 全 Float；前后端金额均为元；内部折扣分配使用整数分（`toCents`）再除 100 返回元（checkout.service.ts:1562-1608，精度可控）

## ↩️ 回滚对称性

| 正向步骤 | 反向步骤 | 对称? | 证据 |
|---|---|---|---|
| RewardLedger RESERVED | cancelSession: RESERVED→AVAILABLE + 清 refType/refId | ✅ | checkout.service.ts:986-991 |
| CouponInstance 锁定 | cancelSession: releaseCoupons | ✅ | checkout.service.ts:995-1006 |
| CouponInstance 锁定 | checkout 失败：catch 中 releaseCoupons | ✅ | checkout.service.ts:653-665 |
| VIP 库存预留 | cancelSession: releaseVipReservation（stock increment + RELEASE ledger） | ✅ | checkout.service.ts:1668-1700 |
| VIP 库存预留 | checkout-expire.service 过期：同上 | ✅ | (未逐行验证, 但 releaseVipReservation 已抽象) |
| CheckoutSession ACTIVE | checkout-expire 过期 → EXPIRED + 释放全部预留 | ✅ | checkout-expire.service.ts（314 行，未逐行） |
| LotteryRecord IN_CART | cart.clearCart / removePrizeItem: IN_CART→WON | ✅ | cart.service.ts:289-294, 322-327 |
| LotteryRecord WON/IN_CART→CONSUMED | ❌ 无反向（支付成功后不可撤回，设计如此） | ✅ | checkout.service.ts:1301-1312 |
| NORMAL_GOODS 库存 decrement | ❌ 无对称补偿：退款/售后走 AfterSaleService | ✅ | 正常流程依赖 AfterSaleService 回滚 |

## ✅ 验证点清单

| # | 验证点 | 状态 | 证据 file:line | 阻塞 T1? | 补工作 |
|---|---|---|---|---|---|
| 1 | CheckoutSession 创建在 Serializable 事务中 | ✅ | checkout.service.ts:627 | 否 | - |
| 2 | 库存 CAS 扣减 (updateMany where stock gte qty) | ✅ | checkout.service.ts:898 (VIP CAS 严格) + 1256 (NORMAL 裸 decrement by design) | 否 | ✅ by design，VIP/NORMAL 两条路径的分层策略合理 |
| 3 | idempotencyKey 在 CheckoutSession / Order 表上 | ✅ | schema.prisma:1342(@@unique userId+key), 1373(Order @unique) | 否 | - |
| 4 | 金额精度全程 Float/元 | ✅ | schema.prisma:1326-1329 全 Float；分配算法用 toCents 保精度 | 否 | - |
| 5 | 地址选择强制 addressId 校验 | ✅ | checkout.dto.ts:44 @IsNotEmpty; checkout.service.ts:371-373 抛 BadRequest | 否 | - |
| 6 | 运费支持 ShippingRule（金额×地区×重量） | ✅ | shipping-rule.service.ts:122-167 三维度匹配 + priority 排序 | 否 | - |
| 7 | 购物车空态处理 | ✅ | checkout.dto.ts:35 @ArrayMinSize(1); checkout.service.ts:92-94; 前端 checkout.tsx:77 空状态 | 否 | - |
| 8 | 并发下单同一 SKU 防超卖（NORMAL） | ✅ | VIP 路径 CAS 严格；NORMAL 路径 R12 by design（允许负库存） | 否 | ✅ by design（R12），需要补上 line 1264 卖家补货通知 TODO |
| 9 | CheckoutSession → 支付 → 订单状态转换 | ✅ | ACTIVE→PAID→COMPLETED，CAS 保护，幂等返回已创建订单（checkout.service.ts:1086-1093） | 否 | - |
| 10 | 多商户拆单 | ✅ | checkout.service.ts:1162-1231 按 companyId 循环创建 Order，各有独立 idempotencyKey `cs:{sid}:{hash}:{idx}` | 否 | - |
| 11 | 旧 createFromCart/payOrder/batchPayOrders 返回 410 | ✅ | order.controller.ts:69-71(batch-pay), 74-77(create), 113-116(pay) 全部 `throw new GoneException`；order.service.ts:793-797 实现已删 | 否 | - |

## 🚧 已知问题

### 🟡 T1 待补项（R12 设计的另一半）

**1. R12 超卖通知缺失**
- **位置**: checkout.service.ts:1261-1264
- **现状**: 检测到超卖后仅 `logger.warn('R12 超卖: ...')`，然后写了 `// TODO: 发送卖家补货通知` 就断了
- **影响**: R12 设计依赖"卖家收到通知后补货"，但通知没发 → 卖家不知情 → 超卖的订单可能发不出 → 引发售后纠纷
- **建议**: 上线前接通通知链路（走 InboxService.send + 可选 SMS），告诉卖家"你超卖了 N 件 SKU=X，请尽快补货或联系买家"
- **归类**: 🟡 Tier 1 必须补齐（阻塞"可靠发货"）

### 代码内其他 TODO

（无其他）

**漏洞风险**:
- checkout.service.ts:1423-1451 `confirmCouponUsage` 失败后仅 `this.logger.error` 且没入补偿队列，极端情况下用户订单已成功但红包仍 RESERVED，手动修复。
- checkout.service.ts:1507-1512 VIP 激活失败同上：订单已创建但用户未成为 VIP，需手动补偿。
- checkout.service.ts:1325 `@map("redPackId")` — 列名历史遗留，字段名 rewardId。审查时发现这是"分润奖励 vs 平台红包"两套系统合并期遗留的兼容列名。功能正确，但建议未来迁移。
- checkout.service.ts:165-190 SKU fallback 逻辑（skuId 可能是 productId）是一个很大的兼容层，前端理应传真正的 skuId，保留可以兼容老客户端。
- checkout.service.ts:268 奖品项 `item.quantity = prizeCartItem.quantity` 直接覆写 DTO 输入，前端传的数量被静默忽略（对奖品是对的，但未通过 DTO 层校验）。

**设计细节**:
- 运费按 `parseFloat((group.goodsAmount / totalSessionGoodsAmount * session.shippingFee).toFixed(2))` 分摊（1124-1129），**没有尾差补偿**，多商户订单合计可能有 ±0.01 元误差，不等于 session.shippingFee。
- `allocateDiscountByCapacities`（1558-1609）使用 cents 整数分配+余额补偿，相比之下运费分摊方案更粗糙，建议统一使用此算法。

## 🔗 耦合依赖

- **依赖**:
  - L? 红包系统（CouponService.validateAndReserveCoupons / releaseCoupons / confirmCouponUsage）
  - L? 奖励 RewardLedger（RESERVED 状态机）
  - L? 地址模块（Address.findUnique + 加密）
  - L? 运费 ShippingRuleService
  - L? 库存 InventoryLedger
  - L? 抽奖 LotteryRecord（IN_CART / WON / CONSUMED 状态机）
  - L? VIP 激活（BonusService.activateVipAfterPayment）
  - L? 支付回调（PaymentService.handlePaymentSuccess）

- **被依赖**:
  - L? 订单列表 / 详情 / 售后（OrderService.list/getById/afterSale）
  - L? 分润奖励引擎（订单创建后触发 profitSplit）
  - L? InboxService（VIP 开通通知）

## 🧪 E2E 场景

1. **Golden path**: 登录 → 加购 → 勾选 → 结算 → 选地址/红包 → 提交 → 模拟支付 → 轮询 COMPLETED → 订单出现在"待发货"列表
2. **并发下单同一 SKU**: 两个 tab 同时点提交，同一 idempotencyKey → 第二次走 140-148 命中直接返回相同 session；不同 idempotencyKey → 两个独立 session 依次扣库存，NORMAL 路径可能出现负库存（设计容忍）
3. **支付回调丢失重放**: PaymentService 重放同一 merchantOrderNo → handlePaymentSuccess CAS 失败（session 已 PAID/COMPLETED）→ 走 1086-1093 幂等分支返回已创建的 orderIds
4. **库存不足**: NORMAL 路径 preview 阶段不拦截（超卖容忍），VIP 路径在 checkout 事务内 CAS 失败抛 BadRequest
5. **地址为空**: DTO 层 @IsNotEmpty 直接 400；或 addressId 非本人 → checkout.service.ts:360-373 抛"请选择有效的收货地址"
6. **价格变更**: 前端传 expectedTotal，事务内对比 >0.01 元差异 → 抛"价格已变更，请刷新后重新结算"（事务回滚释放奖励 RESERVED）
7. **红包锁定后 checkout 失败**: 653-665 catch 中 releaseCoupons 释放红包，防止 RESERVED 泄漏
8. **Session 过期**: checkout-expire.service.ts 定时任务 ACTIVE→EXPIRED + 释放奖励/红包/VIP 库存
9. **并发 cancel + pay 回调**: 两者都走 Serializable 事务 + CAS，一方成功另一方走幂等分支

## ❓ 需要用户确认的疑点

| # | 疑点 | 选项 A | 选项 B | 选项 C |
|---|---|---|---|---|
| ~~1~~ | ~~NORMAL_GOODS 库存非 CAS 是 R12 设计吗？~~ | ✅ **已确认** (2026-04-11)：R12 超卖容忍故意设计。补货通知 TODO 已单独列为 🟡 T1 待补项 | - | - |
| ~~1~~ | ~~补偿队列？~~ | ✅ **已确认 A（2026-04-13 Q5）**：不加，3 次重试够了 | — | — |
| ~~2~~ | ~~多商户运费分摊尾差~~ | ✅ **已确认（2026-04-13 Q6）**：运费全部由平台支付，不考虑商家。一个订单多商家算一个总运费，商家不管。`checkout.service.ts:1124-1129` 分摊逻辑仅影响 Order 记账字段，对商家无实际影响 | — | — |
| 3 | `@map("redPackId")` 列名遗留（schema.prisma:1324），是否计划迁移？ | A. 保留（兼容老数据） | B. 生成 migration 改名 rewardId | - |
| 4 | SKU fallback 逻辑（checkout.service.ts:165-190）允许前端传 productId 当 skuId，是否计划废弃？ | A. 保留（兼容老客户端） | B. 强制要求前端传真 skuId，后端校验失败 | - |

## 🎯 Tier 1 验收标准

- [x] 全部 11 个验证点检查完成（11 ✅，R12 设计已被用户确认）
- [x] 账本/对称性/幂等/Serializable/CAS 五维度均有具体 file:line 证据
- [x] R12 超卖容忍设计已确认（2026-04-11），line 1264 卖家补货通知补齐才能算 T1 完成
- [ ] **补上 line 1264 卖家补货通知**（R12 设计的另一半，🟡 T1 待补项）
- [x] ~~用户决定补偿策略~~ — 已确认 A: 不加（2026-04-13 Q5）
- [x] ~~用户决定运费分摊~~ — 已确认：运费全平台承担，无尾差问题（2026-04-13 Q6）
