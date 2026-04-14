# L6 VIP 购买（多档位）链路 — A 档深审 (Tier 2)

**审查日期**: 2026-04-11
**审查模式**: 只读审查
**审查等级**: 💰 A 档（Tier 2，资金/核心业务）
**审查范围**: L6 VIP 多档位礼包购买 / 赠品选择 / 支付激活 / 三叉树落位 / 推荐奖励

---

## 🚨 必答问题

### Q1：VipPackage 多档位模型是否在 schema？
**✅ 在**。`backend/prisma/schema.prisma:290-301` 定义 `model VipPackage`：
```
price / referralBonusRate / sortOrder / status / giftOptions VipGiftOption[]
```
与 `VipGiftOption.packageId`（2344）一对多绑定。

### Q2：管理端 VipPackage CRUD 是否完成？
**✅ 完成**。`backend/src/modules/admin/vip-package/` 模块齐全：
- `vip-package.controller.ts`：`GET/POST/PATCH/DELETE /admin/vip/packages`，`@RequirePermission('config:read|config:update')`
- `vip-package.service.ts`：findAll / create / update / remove，删除前校验无下属 giftOption
- `vip-package.dto.ts`：CreateVipPackageDto / UpdateVipPackageDto
- 管理前端 `admin/src/pages/vip-gifts/index.tsx` 集成 VipPackage 查询/创建/更新/删除与「所属档位」过滤

### Q3：买家 App app/vip/ 目录下文件？
**只有 2 个文件**：
- `app/vip/_layout.tsx`（12 行，最小路由壳）
- `app/vip/gifts.tsx`（983 行，完整多档位赠品选择页，包含 `priceTabs` 档位切换、金色粒子、3D 卡片、脉冲符号、已是 VIP 提示、包含 `setVipPackageSelection` 写 store）

⚠️ **无独立 VIP 成功页**，激活成功后跳 `/me/vip`（app/me/vip.tsx 存在）。

### Q4：checkoutVipPackage 方法是否完整实现？
**✅ 完整**。`backend/src/modules/order/checkout.service.ts:684-954`（270 行）。流程：
1. 读 VipPackage + 状态校验
2. 幂等检查（`bizType=VIP_PACKAGE` 过滤）
3. 赠品方案预检（事务外，减少持锁）
4. 价格一致性校验
5. 地址校验 + 加密快照
6. 多商品快照
7. bizMeta 构造（packageId/giftOptionId/referralBonusRate/snapshotPrice）
8. **Serializable 事务**：重查 VIP 状态 + 清理过期 VIP 会话 + 活跃会话互斥 + 创建 session + CAS 逐项预留库存 + InventoryLedger RESERVE 记录
9. 支付宝 APP 支付参数生成

---

## 📋 17 个关键验证点

### VP-01 ✅ VipPackage 数据模型完整性
`schema.prisma:290-301` — price(Float) / referralBonusRate(Float 默认0.15) / sortOrder / status（复用 VipGiftOptionStatus ACTIVE/INACTIVE）/ `@@index([status, sortOrder])`。`VipGiftOption.packageId` + `@@index([packageId, status, sortOrder])`。`VipPurchase.packageId` + `referralBonusRate` 快照字段（1735-1736）均已落表。

### VP-02 ✅ 档位 × 赠品组合的价格计算
`bonus.service.ts:485-521` `getVipGiftOptions()` 按 packageId 分组返回，`totalPrice = Σ(sku.price × quantity)` 实时计算（不持久化冗余），`available` 由子项全 ACTIVE + 库存充足决定。与 CLAUDE.md 决策一致。

### VP-03 ✅ VipCheckoutDto 校验
`backend/src/modules/order/vip-checkout.dto.ts:12-49` — `packageId/giftOptionId/addressId` 必填 + `MaxLength(64)`，`paymentChannel/idempotencyKey/expectedTotal` 可选。
⚠️ **注意**：DTO 中**没有 `giftSkuId`**，因为多商品组合后该字段已废弃（VipPurchase.giftSkuId 在激活时固定写 null，248,268,292 处）。设计一致。

### VP-04 ✅ checkoutVipPackage Serializable 事务
`checkout.service.ts:830-924` 显式 `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`。事务内：
- 重查 `MemberProfile.tier` 防止并发已 VIP
- 清理本用户过期 ACTIVE VIP 会话并 RELEASE 库存
- 查找活跃 VIP 会话互斥（同一用户同时最多一个 VIP 下单会话）
- 创建 CheckoutSession
- 逐项 `productSKU.updateMany` CAS 扣库存（`stock: { gte: quantity }`），0 count 抛错
- 写 InventoryLedger RESERVE

### VP-05 ✅ POST /orders/vip-checkout 端点
`order.controller.ts:30-37` — `@Post('vip-checkout')` → `checkoutService.checkoutVipPackage(userId, dto)`。路由已注册。

### VP-06 ✅ bizType=VIP_PACKAGE 传递
- `CheckoutSession.bizType`：`schema.prisma:1318`，枚举 `CheckoutBizType`（NORMAL_GOODS/VIP_PACKAGE）
- `Order.bizType`：`schema.prisma:1363`，枚举 `OrderBizType`
- `handlePaymentSuccess` 建单处：`checkout.service.ts:1183` `bizType: (session as any).bizType || 'NORMAL_GOODS'`，bizMeta 同步传递

### VP-07 ✅ 支付回调 activateVipAfterPayment 3 次重试
`checkout.service.ts:1454-1528` — 命中 `sessionBizType === 'VIP_PACKAGE'` 后：
1. 校验 bizMeta 完整性（vipGiftOptionId + snapshotPrice）
2. for 1..3 循环调 `bonusService.activateVipAfterPayment`
3. 指数退避 `200 * 2^(attempt-1)` ms
4. 成功后发站内消息，失败记 ERROR 日志

### VP-08 ✅ VipActivationStatus 状态机
`schema.prisma:310-316` — PENDING / ACTIVATING / SUCCESS / FAILED / RETRYING（5 态齐全）。`bonus.service.ts:222-428` 双阶段事务：
- Phase-1（准备）：upsert VipPurchase 到 PENDING/RETRYING
- Phase-2（激活）：CAS PENDING→ACTIVATING / FAILED→RETRYING，失败更新 activationError
- Cron 由 `vip-activation-retry.service.ts` 每 5 分钟扫 `FAILED` 或 `ACTIVATING/RETRYING 超过 15 分钟` 的陈旧记录，先转回 FAILED 再调 activate

### VP-09 ✅ 三叉树 BFS 插入逻辑
`bonus.service.ts:1124-1225` `assignVipTreeNode(tx, userId)`：
- 有推荐人：`inviterNode.childrenCount < 3` 直接插；已满则 `bfsInSubtree` 在推荐人子树内 BFS 找空位；子树全满降级到系统节点
- 无推荐人：顺序遍历 A1..A10（level=0），找 `childrenCount < 3`
- A1-A10 全满：自动创建 A11, A12...（MAX_ROOT_NODES 上限）
- **S05 修复**：先 `increment childrenCount` 再用返回的 `updatedParent.childrenCount - 1` 作为 position，避免并发 stale read，配合 `@@unique([parentId, position])` 约束
- BFS 有 `MAX_BFS_ITERATIONS` + `MAX_TREE_DEPTH` 双保护

### VP-10 ✅ VIP 激活成功站内消息
`checkout.service.ts:1515-1526` — `this.inboxService.send({ category: 'system', type: 'vip_activated', title: 'VIP 会员开通成功', content: ..., target: { route: '/orders/[id]', params: { id } } })`，catch 仅记 warn 不阻塞主流程。

### VP-11 ✅ VIP 订单在 L5 分润的豁免
`bonus-allocation.service.ts:63-67` —
```
if (order.bizType === 'VIP_PACKAGE') {
  this.logger.log(`订单 ${orderId} 为 VIP_PACKAGE，跳过分润分配`);
  return;
}
```
入口守卫正确。与 CLAUDE.md「VIP 礼包订单不参与分润/有效消费」一致。

### VP-12 ✅ VIP 购买幂等性
多层保护：
1. `VipPurchase.userId @unique`（schema.prisma:1722）— 一个用户一条记录
2. `CheckoutSession` 按 `(userId, bizType=VIP_PACKAGE, idempotencyKey)` 查复用
3. 活跃 VIP 会话互斥
4. `activateVipAfterPayment` 内幂等分支：
   - `existingPurchase.orderId !== orderId` → 跳过（另一 orderId 已激活）
   - `existingPurchase.orderId === orderId && status ∈ [ACTIVATING/RETRYING/SUCCESS]` → 跳过
5. Phase-2 CAS 二次防并发
6. 外层捕获 P2002 视为幂等成功

### VP-13 ✅ 买家 App 档位选择 UI 完整度
`app/vip/gifts.tsx` —
- `packages.map(pkg => PriceTab)` 展示 `¥price / VIP 礼包 / N 款可选`（417-451）
- `selectedPackageIndex` 切换档位时 reset `selectedIndex` 并 scroll 回 0
- 切换档位正确筛选 `giftOptions = currentPackage?.giftOptions ?? []`
- 结账时 `setVipPackageSelection({ packageId, giftOptionId, title, coverMode, coverUrl, totalPrice, price, items })`
- 已是 VIP 展示专属提示页（338-366）
- 包含金色粒子 / 脉冲符号 / 卡片 3D 动画 / 无推荐人提示条

### VP-14 ✅ VIP 赠品商品 Order 创建和发货
- 赠品 SKU 必须属于 `PLATFORM_COMPANY_ID`（754-760），因此 VIP 订单的 `companyId` 一定是平台公司
- 支付回调 `handlePaymentSuccess`（checkout.service.ts:1104-1231）走正常 companyGroups 分组建单路径，创建 PAID 订单并写 `orderItems`，后续 L8 发货通过 `seller-orders` 模块由平台公司（ownership）处理
- `seller-orders.service.ts:83-84` 支持 `bizType === 'VIP_PACKAGE'` 过滤，卖家后台能单独筛选 VIP 订单
- 库存 RESERVE → ORDER 引用迁移逻辑正确（checkout.service.ts:1237-1253）

### VP-15 ✅ VIP 订单展示（列表 + 详情，金色 Tag）
- 订单列表 `app/orders/index.tsx:186-190`：金色背景 `rgba(201,169,110,0.15)` + "VIP礼包" 标签
- 订单详情 `app/orders/[id].tsx:182-188`：金色提示条 "VIP 开通礼包 · 不支持退款"
- 详情页 header 渐变条在 VIP 模式下切换为金色 `['#C9A96E','#E8D5A3']`（194）
- 按钮行 VIP 模式禁用退款入口（383-390）

### VP-16 ✅ VIP 订单不可退款拦截（after-sale）
`backend/src/modules/after-sale/after-sale.service.ts:98-100` —
```ts
if ((order as any).bizType === 'VIP_PACKAGE') {
  throw new BadRequestException('VIP 礼包订单不支持退款和换货');
}
```

**2026-04-11 用户复核已撤销 H-问题**：after-sale.service.ts:79-88 的 Prisma 查询用 `findUnique({ where, include: { items: ... } })` 不带 `select`。Prisma 默认行为是返回所有 scalar 字段，`bizType` 是 scalar enum 字段（不是 relation）所以会被自动返回。`(order as any).bizType` 只是因为 line 88 把整个 `order` 结果 `as any`（注释说"宽松类型以访问 deliveredAt/receivedAt 等全部字段"），类型系统的表达问题，不是数据加载问题。**拦截是安全的**。

虽然不影响功能，但建议将来把 `as any` 去掉（用更精确的类型声明），这是代码整洁问题，不是 bug。

### VP-17 ✅ VipReferralBonus（推荐人奖励）
`bonus.service.ts:371-377` 在激活事务内计算：
```
referralBonus = floor(amount × referralBonusRate × 100) / 100
```
`referralBonusRate` 来自 VipPurchase 快照（购买时档位 snapshot）。通过 `grantVipReferralBonus`（1073-1114）写入 `VIP_REWARD` RewardAccount + RewardLedger（RELEASE/AVAILABLE/VIP_REFERRAL）。

---

## 🔴 发现的问题

### ~~H1 — `(order as any).bizType` 类型强转~~ 【已撤销 2026-04-11】
原判断：`as any` 可能导致 bizType 未 select，拦截失效。
**撤销理由**：after-sale.service.ts:79-88 的 `findUnique` + `include`（不带 `select`）会自动返回所有 scalar 字段，`bizType` 是 scalar enum 字段会被默认返回。`as any` 只是代码整洁问题，不影响功能。VIP 订单拦截是安全的。详见 VP-16。

### H2 — 旧 `purchaseVip()` 方法仍留在 service 但逻辑已失准
**严重级**: High（潜在死代码+误调用风险）
**位置**: `backend/src/modules/bonus/bonus.service.ts:132-215`
**问题**: 控制器端点已 `@deprecated` 并抛 `GoneException`，但 Service 方法仍完整存在。方法内 `amount=0`、`packageId: undefined`、`referralBonusRate: 0`，若被任意内部调用会创建无效 VipPurchase（0 元激活且无推荐奖励）。
**建议**: 删除旧方法或改为直接 throw，避免被新代码误调用。

### M1 — 站内消息依赖 `inboxService` 为可选（软依赖）
**严重级**: Medium
**位置**: `checkout.service.ts:54 / 1515`
**问题**: `inboxService: any = null` 动态注入，未绑定时 VIP 激活通知静默丢失（仅 warn）。
**建议**: 接入监控或在启动校验模块装配。

### M2 — 价格校验容差 0.01 元
**严重级**: Medium
**位置**: `checkout.service.ts:764`
**问题**: `Math.abs(expectedTotal - vipPrice) > 0.01`。Float 与元单位对齐，容差合理，但注意后端快照 `snapshotPrice` 存 bizMeta 而激活金额用的是 `bizMeta.snapshotPrice`，与前端展示保持一致。无严重问题，但建议改为整分比较（toFixed(2) 后转字符串比较）。

### ~~M3~~ → 🔴 升级为 BUG（2026-04-13 用户决策 Q7）

**严重级**: HIGH — 设计层面的 bug，非 feature
**位置**: `bonus.service.ts:1146-1156` + `bonus/engine/constants.ts:11,14`
**用户原话**: "这个降级行为不是我设计的，我的设计是让树一直往下，没有底"

**需要修复**:
1. `constants.ts:11` `MAX_BFS_ITERATIONS` 从 `10000` → `100000000`
2. `constants.ts:14` `MAX_TREE_DEPTH = 20` → 去掉对 BFS 的深度限制（或设为 999999）
3. `bonus.service.ts:1153` 删除"降级到系统节点"的 fallback 逻辑 → 改为 throw Error（"无法在推荐人子树中找到空位"不应该发生，如果发生说明有数据问题）
4. **受邀人永远在邀请人子树里** — 这是核心商业语义，代码不能破坏推荐关系

**对 500 用户首批的影响**: 无（单棵子树不可能超 100M 节点），但设计原则必须修正

### M4 — `giftSkuId` 字段在 VipPurchase 已废弃但仍保留
**严重级**: Medium（schema 清理）
**位置**: `schema.prisma:1731` + `bonus.service.ts:268/292`
**问题**: 激活时固定写 `giftSkuId: null`，代码/数据库字段残留。
**建议**: 下一次 migration 清理该字段，避免后续歧义。

### M5 — `referralBonusRate` 命名未统一
**严重级**: Medium（命名一致性）
**位置**: `VipPackage.referralBonusRate` vs `bonus.service.ts:183` 的 legacy `referralBonusRate`
**问题**: legacy `purchaseVip` 直接取 `vipPurchase.referralBonusRate ?? 0` 然后 `amount=0`，与新路径使用 Package 快照写入的 `referralBonusRate` 不同源。死代码语义紊乱。
**修复**: 与 H2 一并处理。

### L1 — 轮询次数硬编码（app/checkout.tsx:431）
**严重级**: Low
**问题**: `MAX_POLLS=30 * POLL_INTERVAL=2000` = 60s 固定值，建议从配置读。

### L2 — `activateVipAfterPayment` 在 3 次失败后不回滚 CheckoutSession
**严重级**: Low
**位置**: `checkout.service.ts:1508-1512`
**问题**: VIP 激活最终失败，但订单已建、库存已扣、状态 PAID。依赖 Cron 后补偿；Cron 若配置异常，资金已到账但 VIP 未开通。建议在 session.bizMeta 加 `vipActivationFailed` 标记，并在失败时发 ADMIN 告警（当前仅 logger.error）。

### L3 — `app/vip/_layout.tsx` 仅 12 行
**严重级**: Low
**问题**: 无专属 VIP 头部/背景，所有装饰集中在 gifts.tsx 一页。后续扩展第二页（例：`success.tsx`）需重构 layout。当前不阻塞。

---

## ✅ 亮点

1. **多档位模型设计清晰**：VipPackage ↔ VipGiftOption 一对多，referralBonusRate 下沉到档位层面（399/899/1599 各自比例），VipPurchase 快照写入购买时的 referralBonusRate 防止后续管理员改配置影响历史奖励。
2. **幂等性多层保护**：DTO idempotencyKey → CheckoutSession 活跃互斥 → VipPurchase.userId unique → 激活状态机 CAS → P2002 fallback。
3. **状态机设计严谨**：VipActivationStatus 5 态 + Phase-1/Phase-2 双阶段事务 + Cron 重试 + stale lease 回收 + 15 分钟超时定义。
4. **Serializable 隔离覆盖所有写操作**：checkoutVipPackage / handlePaymentSuccess / cancelSession / activateVipAfterPayment 事务均指定 Serializable，符合 CLAUDE.md 资金/状态规则。
5. **L5 守卫入口干净**：一处 `bizType === 'VIP_PACKAGE' → return`，语义清晰。
6. **退款拦截明确**：after-sale service 在订单状态检查后立即拦截 VIP 订单。
7. **发货复用普通链路**：VIP 赠品 SKU 归属平台公司，seller-orders 原生支持 bizType 过滤，无需新增发货模块。

---

## 📊 审查结论

- ✅ **整体实现完整**：后端 schema / service / 控制器 / admin CRUD / 前端档位选择页 / 结算渲染 / 订单展示 / 退款拦截，17 个关键点全部具备
- 🔴 **1 个 High 问题**：H2 legacy `purchaseVip` 残留（H1 已撤销，见上文）
- ⚠️ **5 个 Medium 问题**：主要是代码清理 / 监控完善 / 业务语义确认
- 💡 **3 个 Low 问题**：用户体验与监控增强

### 建议优先级
1. 🚨 立即清理 H2（删除 legacy purchaseVip 或改为 throw）
2. ⚠️ Sprint 内处理 M1（inboxService 硬依赖 + 监控）与 M3（BFS 降级语义确认）
3. 💡 次周处理 L1/L2/L3 与 schema 清理 M4

### 风险点
- ~~after-sale bizType 拦截需要复核~~ **已复核（2026-04-11），Prisma `findUnique` 默认返回所有 scalar，拦截安全**
- **Cron 补偿**依赖 15 分钟超时回收，若订单激活长时间卡在 ACTIVATING 但不超时（系统时间漂移），可能永远不被 Cron 接管；建议增加 prometheus 告警

---

**相关文件清单**（绝对路径）：
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/prisma/schema.prisma
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/order/checkout.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/order/vip-checkout.dto.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/order/order.controller.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/order/checkout-expire.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/bonus.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/bonus.controller.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/vip-activation-retry.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/bonus/engine/bonus-allocation.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/vip-package/vip-package.controller.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/vip-package/vip-package.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/vip-package/vip-package.dto.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/admin/vip-gift/vip-gift.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/after-sale/after-sale.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/seller/orders/seller-orders.service.ts
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/vip/gifts.tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/vip/_layout.tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/checkout.tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/index.tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/[id].tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/orders/after-sale/[id].tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/admin/src/pages/vip-gifts/index.tsx
- /Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/admin/src/api/vip-gifts.ts
