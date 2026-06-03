# 商品上下架引发的级联 Bug 修复清单（2026-05-07）

> **生成日期**: 2026-05-07
> **触发场景**: 真机测试时发现一个被管理员下架的奖品 SKU 抽中后入了用户购物车，结果 **删不掉、付不掉、过不掉、永远卡在购物车里**。顺藤摸瓜审下来，发现 `ProductSKU.status` / `Product.status` 的翻转**没有任何下游清理或软排除逻辑**——这条 stuck 数据只是冰山一角，普通商品同样有问题，VIP 赠品、抽奖记录、CheckoutSession 等多处都受影响。
> **审计方式**: 全仓库 grep `status !== 'ACTIVE'` + Schema 关系图谱 + cart/order/lottery/admin 模块逐文件交叉读取 + 公开抽奖/claimToken 认领/结算 preview payload 抽查 + 与用户实际场景比对
> **状态说明**: ⬜ 待修 | 🔧 修复中 | ✅ 代码已修 | ⏭️ 待部署 | ❓ 需真机验证 | ⏸️ 暂缓

## 🎯 主题

**核心问题**：卖家与管理员可以自由翻转 `Product.status` / `ProductSKU.status`（从 ACTIVE → INACTIVE 或反向），但系统**只在"加购/结算"等"流入"路径做拦截，所有"已存在的引用方"（购物车、抽奖记录、CheckoutSession 快照、VIP 赠品配置）一律保持原样**。一旦状态翻转，这些引用方携带的 SKU 状态就过期了，且没有任何 cron 或事件触发清理。

**结果**：买家会看到"删不掉的奖品"、"价格校验失败的结算页"、"下单后留在车里的奖品"等一系列怪现象。表象多样，根因只有一个。

---

## 1. 用户观测到的三条表象（同一根因）

### 表象 A：奖品删除按钮"闪一下又恢复"
- 入口：购物车 → 点已解锁奖品的删除按钮
- 现象：UI 乐观删除→屏幕"闪一下"→后端 400→前端回滚→商品又出现
- 直接原因（`backend/src/modules/cart/cart.service.ts:280-282`）：
  ```ts
  if (item.isLocked) {
    throw new BadRequestException('锁定赠品不可删除…');
  }
  ```
  `CartItem.isLocked` 字段在赠品入车时一次写入 `true`（`lottery.service.ts:228` / `cart.service.ts:696`），**之后无任何代码改回 false**。前端做了"动态解锁"判定，但后端只看 DB stale 字段。
- 与上下架的关系：原本就有，但 SKU 下架后**雪上加霜**——用户即便凑够了门槛，奖品 SKU 已经下架，依然没法消费掉它。

### 表象 B：确认订单页底部按钮显示"价格校验失败"
- 入口：购物车 → 选中含奖品的项 → 去结算
- 现象：商品清单展示了 ¥0 的奖品行 + 应付金额走本地兜底（不含奖品）+ 按钮显示"价格校验失败"
- 直接原因：
  - 前端 Bug 1（`useCartStore.ts:171-175` + `app/checkout.tsx:53-59`）让锁定/不可用的奖品仍然进入 `selectedItems` → 一路传给 `previewOrder`
  - 前端 Bug 1b：`app/checkout.tsx:139-148` 调 `previewOrder` 时没有传 `cartItemId`，后端只能按 `skuId` 反查奖品；普通商品和奖品共用 SKU 时会误匹配
  - 后端 `previewOrder`（`order.service.ts:599-600`）对**任何 SKU 下架**直接 `throw BadRequestException`：
    ```ts
    if (sku.status !== 'ACTIVE') throw new BadRequestException(`商品规格 ${sku.title} 已下架`);
    if (sku.product.status !== 'ACTIVE') throw new BadRequestException(`商品 ${sku.product.title} 已下架`);
    ```
  - 前端 `previewData.ok=false` → `previewFailed=true` → 按钮文案"价格校验失败" + 数字回落到 `localGoodsTotal` 兜底（这就是 ¥39.26 + ¥8 = ¥47.26 的来源）

### 表象 C：下单后奖品没被带走，永远留在购物车
- 入口：奖品已解锁 + 凑够门槛后下单成功
- 现象：订单详情**不包含奖品**，购物车里奖品依然在
- 真相：**奖品根本没进订单**。createCheckoutSession 在 SKU 状态校验那一步就抛了"已下架"（同表象 B 的 throw），用户其实是绕过这条错误后**只下了非奖品商品的单**（或者奖品被 splice 排除掉）。`handlePaymentSuccess` 的 `cartItem.deleteMany`（`checkout.service.ts:1587-1600`）只删 snapshot 里的 cartItemId——奖品根本不在 snapshot 里 → 自然不会被删 → cart 里继续存在 → 下次 `syncFromServer` 又拉回前端。

> **结论**：A、B、C 不是三个独立 Bug，是 **「stale 字段 (Bug 2) + 前端没过滤 (Bug 1) + SKU 下架后无下游清理 (本次主要议题)」** 在不同操作路径下的不同投影。

---

## 2. Schema 现状盘点

### 2.1 状态字段总览

| 字段 | 取值 | 改动者 | 翻转后下游清理 |
|------|------|--------|---------------|
| `Product.status` | DRAFT / ACTIVE / INACTIVE | 卖家 + 管理员 | ❌ 仅 update 状态 |
| `ProductSKU.status` | ACTIVE / INACTIVE | 卖家 + 管理员 | ❌ 同上 |
| `Product.auditStatus` | PENDING / APPROVED / REJECTED | 管理员 | 🟡 仅审核流程 |
| `LotteryPrize.isActive` | bool | 管理员 | ❌ |
| `VipGiftOption.status` | ACTIVE / INACTIVE | 管理员 | 🟡 部分 |

### 2.2 关键 Cascade 行为

```prisma
// CartItem
sku     ProductSKU @relation(fields: [skuId], references: [id])      // 🚨 没指定 onDelete = NO ACTION
                                                                      //    → 引用方还在的 SKU 永远删不掉

// VipGiftItem
sku     ProductSKU @relation(fields: [skuId], references: [id], onDelete: Restrict)
                                                                      // ✅ 强约束，正确

// ProductSKU
product Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
                                                                      // ✅ 删 Product 级联删 SKU
```

**关键观察**：
- 没有"软删除"位（Product/SKU 都没 `deletedAt`）。下架就是 status=INACTIVE。
- `LotteryPrize.isActive` 与底层 `SKU.status` / `Product.status` 是 **独立开关**，可能矛盾。当前没有任何代码做三者一致性兜底。
- admin `toggleStatus`（`admin-products.service.ts:222-230`）**只是 update 一行**，无副作用、无通知、无引用方扫描。
- admin `remove`（line 232+）有 guard：要求 INACTIVE + 无 OrderItem/CartItem/LotteryPrize/VipGiftItem 引用，否则拒绝。**这是唯一一处强约束**。

---

## 3. 所有"上下架后会出问题"的引用点

按 **读 / 写 / 在途 / 沉淀** 四类整理，每条标注当前行为 vs 期望行为。

### 3.1 读路径（展示侧）

| 位置 | 当前 | 期望 | 状态 |
|------|------|------|------|
| 买家 App 商品搜索/列表 | 已过滤 INACTIVE | ✓ 维持 | ✅ |
| 商品详情页（深链接进入） | 没拦截 | 显示"已下架"标识、禁加购 | ⬜ |
| **买家购物车 `getCart`** | 原样返回，不带状态标记 | 🚨 每项加 `unavailableReason: 'SKU_INACTIVE' \| 'PRODUCT_INACTIVE'`；前端打"已下架"角标，禁勾选/+− | ✅ |
| 抽奖奖池 `getPrizes` / 转盘展示 | 只看 `LotteryPrize.isActive` | 三 AND 过滤；不可兑现实物奖品不展示，避免用户看到抽不中/领不了的奖品 | ✅ |
| 收藏夹/最近浏览 | 待查 | 同购物车 | ⬜ |
| 订单详情/订单项 | snapshot 字段，不依赖现状 | ✓ 维持 | ✅ |
| AI 推荐 | 待查是否过滤 | 应过滤 | ⬜ |

### 3.2 写路径（流入控制）

| 位置 | 当前 | 期望 | 状态 |
|------|------|------|------|
| `cart.service.addItem` | ✓ 校验 SKU/Product status | 维持 | ✅ |
| `cart.service.updateItemQuantity` | 🚨 **只查 stock 和 maxPerOrder，不校验 status** | 加 status 校验，禁止下架 SKU 增数 | ✅ |
| `cart.service.mergeNormalItem` | ✓ 已拒绝下架 SKU/Product | 维持；补单测锁住 | ✅ |
| `cart.service.mergePrizeItem`（未登录中奖后登录认领） | 🚨 只校验 `prize.isActive`，不校验底层 SKU/Product | 三 AND 校验，任一不满足则拒绝认领并返回 `REJECTED_PRIZE_INACTIVE` | ✅ |
| `lottery.service.draw`（已登录抽奖） | 🚨 仅看 `prize.isActive`，**不校验底层 SKU/Product status** | 三 AND 过滤；失效实物奖品概率按 NO_PRIZE 处理，不让用户抽中不可兑奖品 | ✅ |
| `lottery.service.publicDraw`（未登录公开抽奖） | 🚨 同上，且会生成 claimToken | 同 `draw`；claimToken 中不得冻结不可用 SKU | ✅ |
| 卖家 / admin "上架"流程 | ✓ 走审核 | 维持 | ✅ |

### 3.3 在途流转（操作进行中遇到下架）

| 位置 | 当前 | 期望 | 状态 |
|------|------|------|------|
| `previewOrder`（结算页加载） | 🚨 status≠ACTIVE 直接 throw "已下架"，且状态校验发生在奖品识别前 | 先用 `cartItemId`/购物车记录识别奖品，再按分支处理：**奖品项**静默排除 + `excludedItems[].reason='已下架'`；**普通商品**保持 throw | ✅ |
| `createCheckoutSession`（点提交） | 同上 | 同上；返回会话前校验最终 snapshot 至少包含 1 个可结算项 | ✅ |
| `handlePaymentSuccess` | snapshot-based，不再校验 | ✓ 维持 | ✅ |
| `resumeSession`（30 分钟内续付） | 不重新校验 | ✓ 维持 | ✅ |
| `cancelSession` / `expireSession` | 不依赖 status | ✓ 维持 | ✅ |
| 库存扣减 `productSKU.update.decrement` | INACTIVE 还能扣 | ✓ 维持 | ✅ |

### 3.4 沉淀清理（已存在的过期引用）

| 数据点 | 当前 | 期望 | 状态 |
|--------|------|------|------|
| 普通商品的 cartItem 指向 INACTIVE SKU | 永久驻留 | 用户能手删（已能，`removeItem` 不查 status）；不需要 cron | ✅ |
| **奖品 cartItem 指向 INACTIVE SKU** | 🚨 删不掉（Bug 2 + isLocked stale）+ 不进订单 + 永久驻留 | `removePrizeItem`：SKU 不可用时**无条件**允许删，且 `LotteryRecord` 转 EXPIRED；cron 扫描转 EXPIRED + 删 cartItem | ✅ |
| `LotteryRecord.status=IN_CART` 但底层 prize 已禁用 / SKU 下架 | 永久 IN_CART | cron/repair SQL 扫描 → EXPIRED；「我的奖励」打"已失效" | ✅ 代码完成，SQL 未执行 |
| `LotteryRecord.status=WON` 但 prize 已禁用 / SKU 下架 | 永久 WON | cron/repair SQL 扫描 → EXPIRED；即使没有 cartItem 也要处理 | ✅ 代码完成，SQL 未执行 |
| `CheckoutSession.status=ACTIVE` snapshot 含已下架 SKU | snapshot-based 续付正常 | 不动；30 min 自然过期 | ✅ |
| `VipGiftItem` 指向已下架 SKU | VIP 激活会跳过（`bonus.service.ts:433`） | 管理端在下架时检查并提示 | ⬜ |

---

## 4. 不同角色下架的"语义差异"

| 角色 | 典型动机 | 是否需要立即清理引用？ |
|------|---------|---------------------|
| **卖家下架自己的普通商品** | 季节性、临时缺货、不想卖了 | ❌ 不该强制清理。买家手动看到"已下架"自己删；不影响已付订单 |
| **管理员下架平台奖品 SKU**（本次场景） | 奖品停发、SKU 业务调整 | ✅ 需要清理：奖品对用户来说**不可兑现 = 失效**。LotteryRecord 转 EXPIRED + CartItem 删除 + 一条 inbox 通知"你抽中的 X 已停发，名额作废" |
| **管理员违规下架卖家商品** | 合规处理 | 比卖家自己下架更激进：通知所有持仓买家、可能触发售后/退款流程。第一版只在 admin 后台给"批量清理引用"按钮，不强制自动 |
| **卖家"删除"商品** | 一般要求先下架 | 现有 `admin-products.service.remove` 已经有 guard，OK |

**核心**：奖品场景是「该 SKU 不可用就该作废」，普通商品是「用户决定何时删」。两者**不能用同一套清理策略**，按 `isPrize` 分支处理。

---

## 5. 决策点（需要业务/产品拍板）

| ID | 决策点 | 候选方案 | 推荐 |
|----|--------|---------|------|
| **D1** | 普通商品下架后，购物车要不要主动清？ | A) 保留 + 打"已下架"角标 + 仅可删 / B) 直接清掉 + 通知 | **A** |
| **D2** | 奖品 SKU 下架，要不要给用户补偿？ | A) 直接作废 + inbox 通知 / B) 补偿一次抽奖 / C) 补偿等额平台红包 | **A**（先上） |
| **D3** | `LotteryPrize.isActive=true` 但底层 SKU.status=INACTIVE 时谁说了算？ | 三处统一按 AND 判定可用；admin 后台给只读提示 | 三 AND |
| **D4** | 已下架的 SKU 重新上架，僵尸 cartItem 复活？ | A) 不复活（接受清理代价） / B) 加复活逻辑 | **A** |
| **D5** | 在途 CheckoutSession（已生成 snapshot）遇到下架 | A) 不阻断，让付款 / B) 强制 expire | **A**（合规场景管理员手动 expire） |
| **D6** | 抽奖时发现活跃实物奖品底层 SKU/Product 已失效，概率怎么处理？ | A) 报错中断抽奖 / B) 该奖品概率落入 NO_PRIZE / C) 对剩余奖品重新归一化 | **B**（不中断用户，也不放大其他奖品中奖率） |

---

## 6. 修复分批

### 🔴 P0 — 救活当前 stuck 数据 + 让用户能逃出

| # | 改动 | 文件 | 工作量 | 状态 |
|---|------|------|--------|------|
| P0-1 | `removePrizeItem` 改为动态判定：仍锁定且可用的门槛赠品禁止删；已解锁有效奖品删除后 `IN_CART → WON`；SKU/Product/Prize 不可用时无条件允许删并 `IN_CART/WON → EXPIRED` | `backend/src/modules/cart/cart.service.ts:271-298` | 小 | ✅ 代码完成 |
| P0-2 | `clearCart` 改用动态判定：只保留"仍锁定且可用"的门槛赠品；删除已解锁奖品时 `IN_CART → WON`，删除不可用奖品时 `IN_CART/WON → EXPIRED` | `backend/src/modules/cart/cart.service.ts:303-331` | 小 | ✅ 代码完成 |
| P0-3 | 一次性 SQL：清理现存不可用奖品 cartItem + 对应 `LotteryRecord` 转 EXPIRED；同时处理无 cartItem 的 `WON/IN_CART` 失效中奖记录 | DB 直连 | 小 | 🟡 SQL 已写，未执行 |

### 🟡 P1 — 防止新的 stuck 产生

| # | 改动 | 文件 | 工作量 | 状态 |
|---|------|------|--------|------|
| P1-1 | `prize-expire.service` 或抽出的 `PrizeLifecycleService`：扫描过期奖品 cartItem、底层 SKU/Product/Prize 不可用的奖品 cartItem、以及无 cartItem 的失效 `LotteryRecord(WON/IN_CART)` → `EXPIRED` + 删除 cartItem | `backend/src/modules/cart/prize-expire.service.ts` | 中 | ✅ 代码完成 |
| P1-2 | 建统一奖品可用性判断 helper：`NO_PRIZE` 只看 `isActive`；实物奖品必须 `prize.isActive && sku.status==ACTIVE && product.status==ACTIVE`；覆盖 `draw` / `publicDraw` / `getPrizes` / `mergePrizeItem` | `backend/src/modules/lottery/lottery.service.ts` + `backend/src/modules/cart/cart.service.ts` | 中 | ✅ 代码完成 |
| P1-3 | `previewOrder` / `createCheckoutSession` 先识别奖品再做 status 分支；对**奖品项**静默排除（不 throw），普通商品保持硬拦截；返回 `excludedItems[]` 含 `cartItemId/skuId/reason/isPrize/prizeRecordId` | `backend/src/modules/order/order.service.ts:596-642` + `checkout.service.ts:235-330` + DTO/Repo 类型 | 中 | ✅ 代码完成 |
| P1-4 | `cart.service.updateItemQuantity` 增加 SKU/Product status 校验 | `backend/src/modules/cart/cart.service.ts:230-253` | 小 | ✅ 代码完成 |
| P1-5 | `cart.service.mergePrizeItem` 认领 claimToken 时拒绝已失效奖品，并把 `CartMergeResultStatus.REJECTED_PRIZE_INACTIVE` 传回前端 | `backend/src/modules/cart/cart.service.ts:520-728` + `src/types/domain/ServerCart.ts` | 小 | ✅ 代码完成 |
| P1-6 | `handlePaymentSuccess` 的清理加 `prizeRecordId` 兜底；同时读取 `CheckoutSession.bizMeta.excludedPrizeItems`，删除软排除奖品 cartItem 并将对应 `LotteryRecord` 转 `EXPIRED` | `backend/src/modules/order/checkout.service.ts:1587-1600` | 小 | ✅ 代码完成 |
| P1-7 | `previewOrder` 请求补传 `cartItemId`，避免普通商品/奖品共 SKU 时误识别 | `app/checkout.tsx:139-148` + `src/repos/OrderRepo.ts` | 小 | ✅ 代码完成 |
| P1-8 | 后端单测/集成测试覆盖 P0/P1 关键状态机 | `backend/src/modules/cart/*.spec.ts` + `backend/src/modules/lottery/*.spec.ts` + `backend/src/modules/order/*.spec.ts` | 中 | ✅ 自动化覆盖 |

### 🟢 P2 — 前端展示 + 用户感知

| # | 改动 | 文件 | 工作量 | 状态 |
|---|------|------|--------|------|
| P2-1 | 后端 `getCart`（mapCartItem）每项返回 `unavailableReason` 字段 | `backend/src/modules/cart/cart.service.ts:794-848` | 小 | ✅ 代码完成 |
| P2-2 | 买家 App 购物车给 unavailable 项打"已下架"角标 + 禁勾选/+- + 仅可删 | `app/cart.tsx` | 中 | ✅ 代码完成 |
| P2-3 | Bug 1 修复：`useCartStore.syncFromServer` 不把锁定/不可用赠品自动加入 `selectedIds` | `src/store/useCartStore.ts:171-175` | 小 | ✅ 代码完成 |
| P2-4 | Bug 1 修复：`app/checkout.tsx` selectedItems memo 加二次过滤动态锁定/不可用项 | `app/checkout.tsx:53-59` | 小 | ✅ 代码完成 |
| P2-5 | 商品详情页深链接进入显示"已下架"状态 | `app/product/[id].tsx` | 中 | ⬜ |
| P2-6 | 结算页展示 `excludedItems[]` 提示（例如"已下架奖品已自动移除"），避免静默变化让用户误解金额 | `app/checkout.tsx` | 小 | ✅ 代码完成 |

### ⚪ P3 — 管理端配套（可选）

| # | 改动 | 文件 | 工作量 | 状态 |
|---|------|------|--------|------|
| P3-1 | admin 下架商品时弹"X 个用户购物车里 / Y 条 LotteryRecord IN_CART"提示，让管理员选"立刻清理 / 仅下架" | `admin/src/pages/products/...` + `admin-products.service.toggleStatus` | 中 | ⬜ |
| P3-2 | 用户 inbox 通知"你抽中的 X 已停发"（在 cron 清理 LotteryRecord 时触发） | `prize-expire.service` + InboxService | 小 | ⬜ |
| P3-3 | admin 后台给 LotteryPrize 列表增加"底层 SKU 已下架"只读提示 | `admin/src/pages/lottery/...` | 小 | ⬜ |
| P3-4 | 卖家自己下架商品时：seller 后台提示"X 个用户购物车里有此商品" | `seller-products.service.ts` | 小 | ⬜ |

### 状态转换边界（实现时按此为准）

| 触发 | CartItem 处理 | LotteryRecord 处理 |
|------|---------------|--------------------|
| 用户手动删除**有效且已解锁**奖品 | 删除该奖品 cartItem | `IN_CART → WON` |
| 用户手动删除**仍锁定且可用**门槛赠品 | 拒绝删除 | 状态不变 |
| 用户手动删除**不可用**奖品（SKU/Product/Prize 失效） | 删除该奖品 cartItem | `WON/IN_CART → EXPIRED` |
| 用户清空购物车 | 删除普通商品 + 已解锁有效奖品；保留仍锁定且可用门槛赠品；删除不可用奖品 | 已解锁有效奖品 `IN_CART → WON`；不可用奖品 `WON/IN_CART → EXPIRED` |
| cron / repair SQL 清理下架奖品 | 删除不可用奖品 cartItem | `WON/IN_CART → EXPIRED` |
| 支付成功消费奖品 | 删除 snapshot 中对应 cartItem，必要时按 `prizeRecordId` 兜底删除 | `WON/IN_CART → CONSUMED` |

---

## 7. 一次性数据修复 SQL（P0-3）

> ⚠️ 上 staging 前先 dry-run 计数，确认范围。生产执行前必须备份。

```sql
-- 0. 生产执行前备份（staging 可按需跳过）
CREATE TABLE "CartItem_backup_20260507" AS
SELECT * FROM "CartItem" WHERE "isPrize" = true;

CREATE TABLE "LotteryRecord_backup_20260507" AS
SELECT * FROM "LotteryRecord" WHERE status IN ('WON', 'IN_CART');

-- 1a. dry-run：当前有多少不可用奖品 cartItem
SELECT COUNT(*) AS ghost_cart_item_count
FROM "CartItem" ci
JOIN "ProductSKU" sku ON ci."skuId" = sku.id
JOIN "Product" p ON sku."productId" = p.id
LEFT JOIN "LotteryRecord" lr ON ci."prizeRecordId" = lr.id
LEFT JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
WHERE ci."isPrize" = true
  AND (
    sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
    OR lp."isActive" = false
  );

-- 1b. dry-run：当前有多少已中奖但不可兑现的 LotteryRecord（含无 cartItem 的 WON）
SELECT COUNT(*) AS invalid_lottery_record_count
FROM "LotteryRecord" lr
JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
LEFT JOIN "ProductSKU" sku ON lp."skuId" = sku.id
LEFT JOIN "Product" p ON p.id = COALESCE(lp."productId", sku."productId")
WHERE lr.status IN ('WON', 'IN_CART')
  AND lr.result = 'WON'
  AND lp.type != 'NO_PRIZE'
  AND (
    lp."isActive" = false
    OR sku.id IS NULL
    OR p.id IS NULL
    OR sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
  );

-- 2. 列出待清理 cartItem（验证数据合理性）
SELECT
  ci.id AS cart_item_id,
  ci."cartId",
  ci."skuId",
  ci."prizeRecordId",
  sku.title AS sku_title,
  sku.status AS sku_status,
  p.status AS product_status,
  lp.id AS prize_id,
  lp."isActive" AS prize_active,
  ci."isLocked",
  ci."expiresAt"
FROM "CartItem" ci
JOIN "ProductSKU" sku ON ci."skuId" = sku.id
JOIN "Product" p ON sku."productId" = p.id
LEFT JOIN "LotteryRecord" lr ON ci."prizeRecordId" = lr.id
LEFT JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
WHERE ci."isPrize" = true
  AND (
    sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
    OR lp."isActive" = false
  )
ORDER BY ci."createdAt" ASC;

-- 3. 事务内执行清理（先转 LotteryRecord 状态，再删 cartItem）
BEGIN;

-- 3a. LotteryRecord: WON/IN_CART → EXPIRED
UPDATE "LotteryRecord" lr
SET status = 'EXPIRED'
FROM "LotteryPrize" lp
LEFT JOIN "ProductSKU" sku ON lp."skuId" = sku.id
LEFT JOIN "Product" p ON p.id = COALESCE(lp."productId", sku."productId")
WHERE lr."prizeId" = lp.id
  AND lr.status IN ('WON', 'IN_CART')
  AND lr.result = 'WON'
  AND lp.type != 'NO_PRIZE'
  AND (
    lp."isActive" = false
    OR sku.id IS NULL
    OR p.id IS NULL
    OR sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
  );

-- 3b. 删除不可用奖品 cartItem
DELETE FROM "CartItem" ci
WHERE ci."isPrize" = true
  AND (
    EXISTS (
      SELECT 1
      FROM "ProductSKU" sku
      JOIN "Product" p ON sku."productId" = p.id
      WHERE sku.id = ci."skuId"
        AND (sku.status != 'ACTIVE' OR p.status != 'ACTIVE')
    )
    OR EXISTS (
      SELECT 1
      FROM "LotteryRecord" lr
      JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
      LEFT JOIN "ProductSKU" sku ON lp."skuId" = sku.id
      LEFT JOIN "Product" p ON p.id = COALESCE(lp."productId", sku."productId")
      WHERE lr.id = ci."prizeRecordId"
        AND lr.status = 'EXPIRED'
        AND lp.type != 'NO_PRIZE'
        AND (
          lp."isActive" = false
          OR sku.id IS NULL
          OR p.id IS NULL
          OR sku.status != 'ACTIVE'
          OR p.status != 'ACTIVE'
        )
    )
  );

-- 4a. 验证：不可用奖品 cartItem 应为 0
SELECT COUNT(*) AS remaining_ghost_cart_item_count
FROM "CartItem" ci
JOIN "ProductSKU" sku ON ci."skuId" = sku.id
JOIN "Product" p ON sku."productId" = p.id
LEFT JOIN "LotteryRecord" lr ON ci."prizeRecordId" = lr.id
LEFT JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
WHERE ci."isPrize" = true
  AND (
    sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
    OR lp."isActive" = false
  );
-- 应为 0

-- 4b. 验证：不可兑现的 WON/IN_CART 记录应为 0
SELECT COUNT(*) AS remaining_invalid_lottery_record_count
FROM "LotteryRecord" lr
JOIN "LotteryPrize" lp ON lr."prizeId" = lp.id
LEFT JOIN "ProductSKU" sku ON lp."skuId" = sku.id
LEFT JOIN "Product" p ON p.id = COALESCE(lp."productId", sku."productId")
WHERE lr.status IN ('WON', 'IN_CART')
  AND lr.result = 'WON'
  AND lp.type != 'NO_PRIZE'
  AND (
    lp."isActive" = false
    OR sku.id IS NULL
    OR p.id IS NULL
    OR sku.status != 'ACTIVE'
    OR p.status != 'ACTIVE'
  );
-- 应为 0

COMMIT;
```

---

### 7.1 代码实施记录（2026-05-07）

- 已完成 P0-1/P0-2、P1-1～P1-8、P2-1～P2-4、P2-6 的代码改造。
- P0-3 只提供 SQL 和 dry-run 口径，尚未连接 staging/生产数据库执行。
- P2-5 商品详情页深链接下架态、P3 管理端提示/通知仍未做。
- 自动化验证已覆盖：奖品可用性 helper、已登录抽奖、未登录公开抽奖、购物车奖品删除/清空/改数量、结算 preview/createCheckoutSession 软排除下架奖品、支付成功清理软排除奖品。
- 外审修正（2026-05-07）：孤立 `CartItem.prizeRecordId`、以及 `LotteryRecord` 存在但 `prize=null` 均视为不可用奖品；`createCheckoutSession` 将软排除奖品写入 `bizMeta.excludedPrizeItems`；`handlePaymentSuccess` 一并删除软排除奖品并把对应 `LotteryRecord` 置 `EXPIRED`；`expectedTotal` 宽松校验限定为全部排除项均为奖品。
- 外审修正（2026-05-07 追加）：`mergePrizeItem` 认领 claimToken 时若奖品/SKU/Product 已失效，视为终态作废，删除 `lottery:claim:{hash}` 与 lock，避免失效 claim data 在 Redis 中保留到 24h TTL 或未来被重新认领。

---

## 8. 验收清单

### 8.1 P0 验收（修完即可上 staging 测）

- [ ] 真机：用户购物车里有"再消费 ¥X 解锁"奖品 + 该奖品 SKU 已被 admin 下架 → **能正常点删除**
- [ ] 真机：用户购物车里有奖品 + 凑够门槛 → 删除按钮**正常工作**（不再"闪一下")
- [ ] 真机：购物车有仍锁定且可用的赠品 + 用户点"清空购物车" → 锁定赠品按设计**保留**（不被误删）
- [ ] 真机：购物车有锁定但已下架的赠品 + 用户点"清空购物车" → 该赠品被清理，对应 LotteryRecord status=EXPIRED
- [ ] 真机：跑一次 P0-3 的 SQL 后，原幽灵 cartItem **消失**，对应 LotteryRecord status=EXPIRED；无 cartItem 的失效 WON 记录也转 EXPIRED

### 8.2 P1 验收

- [ ] 真机：管理员下架奖品 SKU → 等 cron 运行（≤15 min）→ 用户购物车里该奖品**自动消失**
- [ ] 真机：已登录抽奖时刚好奖品 SKU 处于下架状态 → **不会**被抽中，按 NO_PRIZE 处理
- [ ] 真机：未登录公开抽奖时刚好奖品 SKU 处于下架状态 → **不会**生成指向失效 SKU 的 claimToken
- [ ] 真机：未登录抽中奖品后、登录认领前奖品下架 → 登录合并时拒绝认领，前端收到 `REJECTED_PRIZE_INACTIVE`
- [ ] 真机：抽奖转盘 `getPrizes` 不展示底层 SKU/Product 已失效的实物奖品
- [ ] 真机：购物车含已下架奖品 → 进确认订单页 → **没有**"价格校验失败"，奖品被静默排除并展示"已下架"提示
- [ ] 真机：购物车含已下架普通商品 → 进确认订单页 → **保持** "X 已下架"硬错误（不能下单到下架货）
- [ ] 真机：用户在已下架 SKU 的购物车项上点 +/- → **被拦截**，提示"已下架"
- [ ] 单测：`removePrizeItem` / `clearCart` / `updateItemQuantity` / `draw` / `publicDraw` / `mergePrizeItem` / `previewOrder` / `createCheckoutSession` 覆盖上述状态转换

### 8.3 P2 验收

- [ ] 真机：购物车页面，已下架商品有"已下架"角标 + 复选框禁用 + +/- 禁用 + 删除可用
- [ ] 真机：商品详情页（深链接），SKU 已下架时显示"已下架"，加购按钮禁用
- [ ] 真机：结算页收到 `excludedItems[]` 时有明确提示，且应付金额与服务端 summary 一致
- [ ] 单测：`useCartStore.syncFromServer` 不把锁定/不可用赠品自动加入 selectedIds

### 8.4 P3 验收

- [ ] 真机：admin 下架奖品 SKU → 弹窗显示"X 个用户购物车里 / Y 条 LotteryRecord IN_CART"
- [ ] 真机：admin 选"立刻清理"后，相关数据立即清理 + 用户收到 inbox 通知

---

## 9. 与其他文档关联

- `docs/issues/app-tofix3.md` — 物流链路修复（已完成 P1）
- `docs/architecture/data-system.md` — 数据库设计（Schema 权威源）
- `docs/issues/tofix-safe.md` — 安全/并发问题（本次 P1-2 抽奖三重校验属于这一类）
- 修复完成后需更新 `plan.md`（v1.0 上线冲刺路线图）追加上下架处理项

---

## 10. 风险与回滚

### 风险
1. **P1-3 改奖品软排除**：如果业务方反对（认为下架奖品也该硬错），可改回硬错并通过 P1-1 cron 提前清理。
2. **P0-3 一次性 SQL**：误删风险，必须 dry-run + 备份。
3. **P1-2 抽奖概率处理**：失效实物奖品概率按 NO_PRIZE 处理会降低用户当次中奖率，但不会放大其他奖品中奖概率；如果业务方要补偿，需要新增 D2 补偿策略。
4. **P3-1 admin 下架弹窗**：如果体量大（数千用户车里有），清理操作可能阻塞——需要异步任务而非同步执行。

### 回滚
- P0-1 / P0-2：纯逻辑改动，git revert 即可。
- P0-3：删除/状态变更不可逆，**必须先备份**：
  ```sql
  -- 备份脚本
  CREATE TABLE "CartItem_backup_20260507" AS SELECT * FROM "CartItem" WHERE "isPrize" = true;
  CREATE TABLE "LotteryRecord_backup_20260507" AS SELECT * FROM "LotteryRecord" WHERE status IN ('WON', 'IN_CART');
  ```
- P1 / P2：常规 git revert + OTA / API 部署回滚。
