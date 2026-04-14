# 新功能设计方案

> 创建时间：2026-02-28
> 状态：设计完成，待审批实施
> 关联文档：`conflict1.md`（修复清单）、`plan-treeforuser.md`（改造计划）

---

## 实现顺序（按依赖关系）

```
F5 奖励过期可配置 ─── 独立，最简单
F4 平台公司设置 ─── 独立，主要是种子数据
F2 赠品锁定机制 ─── 依赖 F4（奖品商品归属平台）
F3 奖品过期机制 ─── 依赖 F2（共享 CartItem schema 变更）
F1 订单流程重构 ─── 依赖 F2 + F3（结算需处理锁定+过期）
```

---

## §1 F1: 订单流程重构（付款后创建订单）

### 1.1 当前流程 vs 目标流程

```
当前：选品 → createFromCart(PENDING_PAYMENT) → 扣库存 → 删奖品购物车项 → 用户付款 → 更新PAID
目标：选品 → checkout(创建结算会话) → 用户付款 → 支付回调 → 创建订单(PAID) + 扣库存 + 清购物车
```

### 1.2 Schema 变更

**新增 CheckoutSession 模型**：

```prisma
enum CheckoutSessionStatus {
  ACTIVE      // 会话创建，等待支付
  PAID        // 支付确认，正在创建订单
  COMPLETED   // 订单创建成功
  EXPIRED     // 会话超时（30分钟）
  FAILED      // 库存不足等原因失败（已退款）
}

model CheckoutSession {
  id              String                @id @default(cuid())
  userId          String
  user            User                  @relation(fields: [userId], references: [id])
  status          CheckoutSessionStatus @default(ACTIVE)

  // 结算快照（创建时冻结）
  itemsSnapshot   Json                  // [{skuId, quantity, cartItemId?, isPrize, prizeRecordId?, unitPrice}]
  addressSnapshot Json                  // 完整地址快照
  redPackId       String?               // 选用的奖励 ID
  expectedTotal   Float                 // 服务端计算的应付总额
  goodsAmount     Float                 // 商品金额
  shippingFee     Float                 // 运费
  discountAmount  Float    @default(0)  // 奖励抵扣

  // 支付信息
  merchantOrderNo String?  @unique      // 预生成的商户订单号
  paymentChannel  PaymentChannel?
  providerTxnId   String?  @unique      // 支付渠道返回的交易号

  // 幂等
  idempotencyKey  String?  @unique

  expiresAt       DateTime              // ACTIVE 会话 30 分钟后过期
  paidAt          DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  orders          Order[]               // 支付成功后创建的订单

  @@index([userId, status])
  @@index([merchantOrderNo])
  @@index([expiresAt, status])
}
```

**修改 Order 模型**：

```diff
model Order {
  ...existing fields...
+ checkoutSessionId  String?
+ checkoutSession    CheckoutSession? @relation(fields: [checkoutSessionId], references: [id])
}
```

**修改 RewardEntryStatus 枚举**（或 RewardLedger.status 字符串）：

```diff
+ RESERVED    // 奖励在结算会话中预留，支付成功后消费，会话过期后释放
```

### 1.3 API 变更

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/orders/checkout` | 创建 CheckoutSession：校验库存+计算总额+预留奖励+返回支付参数 |
| POST | `/orders/checkout/:sessionId/cancel` | 取消会话：释放预留奖励 |
| GET | `/orders/checkout/:sessionId/status` | 前端轮询：检查订单是否已创建 |
| POST | `/payments/callback` | 支付回调：原子创建订单+扣库存+清购物车+触发分润 |

**废弃**（保留代码，标记 @deprecated）：
- `POST /orders` (createFromCart) — 旧流程
- `POST /orders/:id/pay` (payOrder) — 旧流程

### 1.4 核心逻辑

**checkout 流程**：
1. 校验所有 SKU 存在、ACTIVE、库存>0（读检查，不扣减）
2. 识别奖品项，校验 THRESHOLD_GIFT 门槛（按 selectedItemIds 计算）
3. 自动包含已解锁的 THRESHOLD_GIFT 赠品
4. 校验奖品未过期（expiresAt > now）
5. 计算各公司商品小计、运费、奖励抵扣
6. 预留奖励（CAS: AVAILABLE → RESERVED）
7. 生成 merchantOrderNo
8. 创建 CheckoutSession（expiresAt = now + 30min）
9. 返回 `{ sessionId, merchantOrderNo, totalPayable, paymentParams }`

**支付回调流程**（Serializable 事务）：
1. 查 CheckoutSession by merchantOrderNo
2. CAS: status ACTIVE → PAID
3. 逐 SKU 扣库存（`updateMany where: { stock: { gte: quantity } }`）
4. 如果任一 SKU 库存不足 → 全额退款 + status → FAILED
5. 消费奖励（RESERVED → VOIDED）
6. 按公司分组创建 Order（status = PAID）+ OrderItem
7. 删除对应购物车项（奖品+普通）
8. 消费奖品记录（LotteryRecord status → CONSUMED）
9. status → COMPLETED
10. 异步触发：确认收货后的分润分配

**会话过期定时任务**：
- 每分钟扫描 `status = ACTIVE AND expiresAt < now`
- 释放预留奖励（RESERVED → AVAILABLE）
- 更新 status → EXPIRED

### 1.5 库存竞态处理

支付成功但库存不足时（R12 超卖容忍）：
- 创建订单正常进行（库存变为负数）
- 卖家收到通知需补货
- 不退款，因为业务上允许超卖

### 1.6 废弃清理

| 组件 | 处理 |
|------|------|
| `order-expire.service.ts` | 标记 @deprecated，不再创建 PENDING_PAYMENT 订单 |
| `OrderStatus.PENDING_PAYMENT` | 保留枚举值用于历史数据，新订单不使用 |
| `payOrder()` | 标记 @deprecated |
| `createFromCart()` | 标记 @deprecated |

---

## §2 F2: 赠品锁定机制（THRESHOLD_GIFT 锁定状态）

### 2.1 Schema 变更

**修改 CartItem**：

```diff
model CartItem {
  ...existing fields...
+ isLocked      Boolean    @default(false)  // THRESHOLD_GIFT 未达门槛时锁定
+ threshold     Float?                       // 解锁门槛金额（缓存自 LotteryRecord.meta.threshold）
+ isSelected    Boolean    @default(true)    // 用户是否勾选该商品（用于部分结算）
+ createdAt     DateTime   @default(now())   // 入购物车时间（奖品过期起算点）
}
```

### 2.2 锁定/解锁逻辑

**锁定规则**：
- 用户抽中 THRESHOLD_GIFT 奖品 → 自动入购物车 → `isLocked = true, threshold = prize.threshold`
- 用户抽中 DISCOUNT_BUY 奖品 → 自动入购物车 → `isLocked = false`（可自由操作）

**解锁计算**：
- 锁定状态的计算基准 = **用户勾选（isSelected=true）的非奖品商品总额**
- 当 `selectedNonPrizeTotal >= threshold` 时，赠品解锁
- 解锁是实时计算的，不持久化（避免前端/后端状态不同步）
- 每次获取购物车或预览订单时重新计算

**操作限制**：
- `isLocked = true` 的商品：禁止 updateQuantity、removeItem、removePrizeItem
- 错误提示："锁定赠品不可操作，消费满 ¥X 后自动解锁"

### 2.3 API 变更

| 端点 | 变更 |
|------|------|
| `GET /cart` | 返回增加 `isLocked`, `threshold`, `unlockDeficit`, `isSelected`, `expiresAt` |
| `PATCH /cart/items/:skuId/select` | **新增**：勾选/取消勾选商品（更新 isSelected） |
| `POST /orders/preview` | 接收 selectedItemIds（或读取 isSelected），解锁赠品参与预览 |
| `POST /orders/checkout` | 同上，解锁赠品自动包含 |

### 2.4 购物车响应示例

```json
{
  "id": "cart-123",
  "items": [
    {
      "id": "ci-1", "skuId": "sku-a", "quantity": 2,
      "isPrize": false, "isSelected": true,
      "product": { "title": "有机苹果", "price": 59.9 }
    },
    {
      "id": "ci-2", "skuId": "sku-prize-1", "quantity": 1,
      "isPrize": true, "prizeRecordId": "lr-1",
      "isLocked": true, "threshold": 100,
      "unlockDeficit": 40.1,
      "expiresAt": "2026-03-01T10:00:00Z",
      "product": { "title": "精品白酒（赠品）", "price": 0, "originalPrice": 199 }
    }
  ],
  "selectedTotal": 119.8,
  "lockedGiftsInfo": [
    { "cartItemId": "ci-2", "threshold": 100, "deficit": 0, "unlocked": true }
  ]
}
```

### 2.5 结算时赠品处理

- 用户勾选商品金额 >= 门槛 → 赠品自动解锁并**强制包含**在订单中（用户不可取消勾选已解锁赠品）
- 用户勾选商品金额 < 门槛 → 赠品保持锁定，不参与结算，留在购物车
- 多个不同门槛赠品独立计算

---

## §3 F3: 奖品过期机制

### 3.1 Schema 变更

**修改 LotteryPrize**：

```diff
model LotteryPrize {
  ...existing fields...
+ expirationHours  Int?   // 可配置过期时间（小时），null = 不过期
}
```

**修改 CartItem**（已在 F2 中增加 createdAt）：

```diff
model CartItem {
  ...existing fields from F2...
+ expiresAt     DateTime?  // 奖品过期时间 = createdAt + prize.expirationHours，非奖品为 null
}
```

### 3.2 过期计算

抽奖中奖入购物车时：
```
expiresAt = prize.expirationHours
  ? new Date(now + prize.expirationHours * 3600 * 1000)
  : null
```

### 3.3 清理机制（混合模式）

**访问时检查（主要）**：
- `CartService.getCart()` 调用前先执行 `cleanExpiredPrizeItems(cartId)`
- 删除所有 `isPrize=true AND expiresAt IS NOT NULL AND expiresAt < now` 的 CartItem

**定时任务（兜底）**：
- 每 15 分钟扫描全局过期奖品购物车项
- 删除过期项，更新 LotteryRecord status → EXPIRED

### 3.4 过期行为

| 奖品类型 | 过期后行为 |
|---------|----------|
| DISCOUNT_BUY | 购物车中该商品消失 |
| THRESHOLD_GIFT | 赠品消失，其他普通商品保留 |

**wonCount 不回退**（R3 确认）。

### 3.5 管理端配置

| 端点 | 变更 |
|------|------|
| `POST /admin/lottery/prizes` | DTO 增加 `expirationHours?: number` |
| `PUT /admin/lottery/prizes/:id` | DTO 增加 `expirationHours?: number` |

修改已有奖品的 expirationHours 只影响**未来新抽中的**奖品，已在购物车的项保留原 expiresAt。

### 3.6 结算时过期校验

`checkout` 和 `previewOrder` 均需检查奖品是否过期：
- 如已过期 → 自动排除，不包含在订单中
- 返回提示 "以下奖品已过期：..."

---

## §4 F4: 平台公司设置

### 4.1 当前状态

- 常量 `PLATFORM_COMPANY_ID = 'PLATFORM_COMPANY'` 已存在（`constants.ts:20`）
- 种子数据已创建公司，名称为"爱买买平台自营"（`seed.ts:1232-1251`）
- `RewardProductService` 已实现 CRUD（`admin/platform-product/`）
- `AdminLotteryService` 已校验奖品商品属于 `PLATFORM_COMPANY_ID`

### 4.2 需要变更

**Schema 新增**：

```diff
model Company {
  ...existing fields...
+ isPlatform  Boolean  @default(false)  // 平台官方公司标记
}
```

**种子数据更新**：

```typescript
await prisma.company.upsert({
  where: { id: 'PLATFORM_COMPANY' },
  update: { name: '爱买买app', isPlatform: true },
  create: {
    id: 'PLATFORM_COMPANY',
    name: '爱买买app',
    status: 'ACTIVE',
    isPlatform: true,
    // ...
  },
});
```

**商品搜索排除**：
- 用户端商品列表 API 增加 `WHERE company.isPlatform = false`
- 确保奖品商品只在抽奖/购物车中可见

**卖家端隔离**：
- 卖家注册/邀请流程中排除 `PLATFORM_COMPANY`

---

## §5 F5: 奖励过期可配置

### 5.1 新增配置项

| 配置 Key | 字段名 | 默认值 | 说明 |
|---------|--------|--------|------|
| `VIP_REWARD_EXPIRY_DAYS` | `vipRewardExpiryDays` | 30 | VIP 用户已释放奖励有效期（天） |
| `NORMAL_REWARD_EXPIRY_DAYS` | `normalRewardExpiryDays` | 30 | 普通用户已释放奖励有效期（天） |

### 5.2 改动点

**`bonus-config.service.ts`**：
- 接口增加两个字段
- KEY_MAP 增加映射
- DEFAULTS 增加默认值

**`order.service.ts`**（3 处硬编码替换）：
- 行 407：previewOrder 奖励校验
- 行 731：createFromCart 奖励 CAS
- 行 767：错误分支

替换逻辑：
```typescript
const config = await this.bonusConfig.getConfig();
const account = await this.prisma.rewardAccount.findUnique({
  where: { id: ledger.accountId },
  select: { type: true },
});
const expiryDays = account?.type === 'NORMAL_REWARD'
  ? config.normalRewardExpiryDays
  : config.vipRewardExpiryDays;
```

**`bonus.service.ts`**：
- `getNormalRewards()` / `getAvailableRewards()` 中的过期计算同步替换

### 5.3 种子数据

```typescript
await prisma.ruleConfig.upsert({
  where: { key: 'VIP_REWARD_EXPIRY_DAYS' },
  update: {},
  create: { key: 'VIP_REWARD_EXPIRY_DAYS', value: { value: 30, description: 'VIP用户奖励有效期（天）' } },
});
await prisma.ruleConfig.upsert({
  where: { key: 'NORMAL_REWARD_EXPIRY_DAYS' },
  update: {},
  create: { key: 'NORMAL_REWARD_EXPIRY_DAYS', value: { value: 30, description: '普通用户奖励有效期（天）' } },
});
```

### 5.4 注意事项

- 修改配置值会**追溯影响**所有已有奖励（过期是动态计算的：`createdAt + configDays`）
- 如果管理员把 30 天改为 15 天，已超过 15 天的奖励会立即变为过期
- 60 秒缓存延迟可接受

---

## 附录：Schema 变更汇总

| 模型 | 变更类型 | 新增/修改字段 | 来源功能 |
|------|---------|-------------|---------|
| CheckoutSession | 新增模型 | 全部字段 | F1 |
| CheckoutSessionStatus | 新增枚举 | ACTIVE/PAID/COMPLETED/EXPIRED/FAILED | F1 |
| Order | 修改 | +checkoutSessionId | F1 |
| CartItem | 修改 | +isLocked, +threshold, +isSelected, +createdAt, +expiresAt | F2 + F3 |
| LotteryPrize | 修改 | +expirationHours | F3 |
| Company | 修改 | +isPlatform | F4 |
| RewardEntryStatus | 修改枚举 | +RESERVED | F1 |

---

## 附录：API 变更汇总

| 方法 | 路径 | 变更类型 | 来源功能 |
|------|------|---------|---------|
| POST | `/orders/checkout` | 新增 | F1 |
| POST | `/orders/checkout/:id/cancel` | 新增 | F1 |
| GET | `/orders/checkout/:id/status` | 新增 | F1 |
| POST | `/payments/callback` | 修改（触发订单创建） | F1 |
| GET | `/cart` | 修改（返回锁定/过期/勾选信息） | F2 + F3 |
| PATCH | `/cart/items/:skuId/select` | 新增 | F2 |
| POST | `/orders/preview` | 修改（接收 selectedItemIds） | F2 |
| POST | `/admin/lottery/prizes` | 修改（DTO 增加 expirationHours） | F3 |
| PUT | `/admin/lottery/prizes/:id` | 修改（DTO 增加 expirationHours） | F3 |
