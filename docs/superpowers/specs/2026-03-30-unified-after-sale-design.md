# 统一退换货系统设计方案

> 版本：v1.0 | 日期：2026-03-30 | 状态：设计完成，待实施
> 业务规则权威来源：`refund.md`（23 条规则 + 2 个附录）

---

## 一、概述

### 背景

因法律要求（《消费者权益保护法》第25条），平台需支持7天无理由退货。同时将现有独立的换货（Replacement）和退款（Refund）系统合并为统一售后入口，覆盖退货退款、质量问题换货两大场景。

### 设计目标

1. 统一售后入口：退货 + 换货共用一套模型、状态机、审核流程
2. 商品退货政策：分类级 + 商品级两级配置
3. 分润保护：7天退货保护期冻结，售后发生则整单奖励归平台
4. 全平台联动：买家App、卖家后台、管理后台同步改造

### 影响范围

- 数据库：Schema 枚举/模型扩展
- 后端：售后模块合并、奖励系统改造、订单模块、支付退款、Cron 任务
- 买家 App：售后表单/列表/详情页、商品详情页、结账页
- 卖家后台：售后管理页合并、商品退货政策
- 管理后台：售后仲裁页合并、分类退货政策、售后配置参数

---

## 二、数据库 Schema 变更

### 2.1 新增枚举

```prisma
enum AfterSaleType {
  NO_REASON_RETURN    // 七天无理由退货
  QUALITY_RETURN      // 质量问题退货退款
  QUALITY_EXCHANGE    // 质量问题换货
}

enum AfterSaleStatus {
  REQUESTED              // 买家提交
  UNDER_REVIEW           // 卖家审核中
  APPROVED               // 同意
  REJECTED               // 卖家驳回
  PENDING_ARBITRATION    // 平台待仲裁（买家升级 / 换货后再退直接进入）
  RETURN_SHIPPING        // 买家已寄回，等待卖家收货
  RECEIVED_BY_SELLER     // 卖家确认收到退回商品
  SELLER_REJECTED_RETURN // 卖家验收不通过
  REFUNDING              // 退款处理中
  REFUNDED               // 退款完成
  REPLACEMENT_SHIPPED    // 换货新商品已发出
  COMPLETED              // 售后完成
  CLOSED                 // 买家接受驳回/验收不通过，主动关闭
  CANCELED               // 买家主动撤销（审核前）
}

enum ReturnPolicy {
  RETURNABLE        // 支持7天无理由
  NON_RETURNABLE    // 不支持（生鲜/定制等）
  INHERIT           // 继承（分类继承父分类，商品继承分类）
}
```

### 2.2 改造现有 ReplacementRequest → AfterSaleRequest

在现有 `ReplacementRequest` 模型基础上扩展（方案 B：重命名 + 扩展，不新建表）：

> **v1 设计决策：每次售后申请只关联一个 OrderItem。** 买家要退多个商品需分别提交多次申请。这与现有 ReplacementRequest 结构一致，避免引入 AfterSaleItem[] 子表增加复杂度。规则 13「部分退货支持」通过多次申请实现，而非单次申请包含多商品。

```prisma
model AfterSaleRequest {
  id                String          @id @default(cuid())
  orderId           String
  order             Order           @relation(fields: [orderId], references: [id], onDelete: Restrict)
  userId            String
  user              User            @relation(fields: [userId], references: [id], onDelete: Restrict)
  orderItemId       String          // v1: 每次申请只关联一个商品，多商品退货需分别提交
  orderItem         OrderItem       @relation(fields: [orderItemId], references: [id], onDelete: Restrict)

  // --- 售后类型与原因 ---
  afterSaleType     AfterSaleType                // 三种售后类型
  reasonType        ReplacementReasonType?        // 质量问题时的原因子类型（沿用现有枚举）
  reason            String?                       // 补充说明
  photos            String[]                      // 凭证照片 1-10 张

  // --- 状态 ---
  status            AfterSaleStatus  @default(REQUESTED)
  isPostReplacement Boolean          @default(false)  // 换货后再退标记
  arbitrationSource String?          // 仲裁来源状态（REJECTED / SELLER_REJECTED_RETURN），null 表示未经仲裁

  // --- 是否需要寄回 ---
  requiresReturn    Boolean          @default(false)   // 系统自动判定

  // --- 买家寄回信息 ---
  returnCarrierName   String?        // 退回快递公司
  returnWaybillNo     String?        // 退回快递单号
  returnShippedAt     DateTime?      // 买家寄出时间

  // --- 卖家审核信息 ---
  reviewerId        String?
  reviewNote        String?
  reviewedAt        DateTime?

  // --- 卖家验收不通过信息 ---
  sellerRejectReason  String?        // 验收拒绝原因
  sellerRejectPhotos  String[]       // 验收拒绝举证照片
  sellerReturnWaybillNo String?      // 卖家寄回给买家的快递单号

  // --- 退款信息 ---
  refundAmount      Float?           // 退款金额（系统计算）
  refundId          String?          // 关联的 Refund 记录 ID

  // --- 换货发货信息（沿用现有字段）---
  replacementCarrierCode  String?
  replacementCarrierName  String?
  replacementWaybillNo    String?
  replacementWaybillUrl   String?
  replacementShipmentId   String?

  // --- 超时控制 ---
  approvedAt        DateTime?        // 审核通过时间（买家寄回超时起算）
  sellerReceivedAt  DateTime?        // 卖家收到退回商品时间

  // --- 时间戳 ---
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  // --- 关联 ---
  virtualCallBindings VirtualCallBinding[]

  @@index([orderId])
  @@index([userId, status])
  @@index([status, createdAt])
  @@map("after_sale_request")
}
```

### 2.3 Category 模型扩展

```prisma
model Category {
  // ... 现有字段
  returnPolicy    ReturnPolicy   @default(INHERIT)  // 新增
}
```

### 2.4 Product 模型扩展

```prisma
model Product {
  // ... 现有字段
  returnPolicy    ReturnPolicy   @default(INHERIT)  // 新增
}
```

### 2.5 User 模型扩展

```prisma
model User {
  // ... 现有字段
  hasAgreedReturnPolicy  Boolean  @default(false)  // 新增：是否已确认退换货协议
}
```

### 2.6 Order 模型扩展

```prisma
model Order {
  // ... 现有字段
  deliveredAt             DateTime?   // 新增：物流签收时间
  returnWindowExpiresAt   DateTime?   // 新增：售后窗口截止时间
}
```

注意：检查现有 Order 模型是否已有 `deliveredAt` 字段，如有则复用。

### 2.7 RewardLedgerStatus 枚举扩展

```prisma
enum RewardLedgerStatus {
  FROZEN
  AVAILABLE
  WITHDRAWN
  VOIDED
  RESERVED
  RETURN_FROZEN    // 新增：退货保护期冻结（用户不可见）
}
```

---

## 三、统一售后后端服务

### 3.1 模块合并方案

| 现有模块 | 改造 |
|---------|------|
| `modules/replacement/` | → `modules/after-sale/`（买家端统一售后） |
| `modules/admin/replacements/` + `modules/admin/refunds/` | → `modules/admin/after-sale/`（管理端） |
| `modules/seller/replacements/` + `modules/seller/refunds/` | → `modules/seller/after-sale/`（卖家端） |

### 3.2 买家端 after-sale.service.ts

#### apply(userId, orderId, dto)

```
入参：
  - orderItemId: string        // 要退的商品
  - afterSaleType: AfterSaleType
  - reasonType?: ReplacementReasonType  // 质量问题时必填
  - reason?: string
  - photos: string[]            // 1-10张

校验流程：
  1. 订单存在且属于该用户
  2. 订单 bizType !== VIP_PACKAGE（VIP礼包不支持售后）
  3. orderItemId 有效且属于该订单
  3b. orderItem.isPrize !== true（抽奖奖品不支持退换）
  4. 该 OrderItem 没有进行中的售后申请
  4b. v1：退货为整个 OrderItem（全部数量），不支持部分数量退货
  5. 时间窗口校验：
     - 取商品的最终 returnPolicy（商品级 → 分类级向上查找 → 兜底 RETURNABLE）
     - NO_REASON_RETURN：returnPolicy 必须为 RETURNABLE + deliveredAt + 7天 > now
     - QUALITY_RETURN / QUALITY_EXCHANGE：
       - 不可退商品（生鲜等）：deliveredAt + FRESH_RETURN_HOURS > now
       - 可退商品：deliveredAt + RETURN_WINDOW_DAYS天 > now
  6. 换货后再退校验（规则22）：
     - 检查该 OrderItem 是否有已完成的换货记录
     - 如有：只允许 QUALITY_RETURN，标记 isPostReplacement = true
     - 隐藏 NO_REASON_RETURN 选项
  7. 照片数量校验：1-10张
  8. 计算是否需要寄回 requiresReturn：
     - NO_REASON_RETURN → 一律 true
     - QUALITY_RETURN / QUALITY_EXCHANGE → 商品金额 > RETURN_NO_SHIP_THRESHOLD 则 true
  9. 计算退款金额 refundAmount（退货时）：
     - 商品金额 = unitPrice × quantity
     - 红包分摊 = order.totalCouponDiscount × (商品金额 / order.goodsAmount)
     - refundAmount = 商品金额 - 红包分摊
  10. 创建 AfterSaleRequest，状态 REQUESTED
  11. 如果 isPostReplacement = true，跳过卖家审核，直接进入平台待仲裁

并发控制：Serializable 事务 + 3次 P2034 重试
```

#### cancel(userId, afterSaleId)

```
校验：
  - 售后申请属于该用户
  - 状态为 REQUESTED 或 UNDER_REVIEW
操作：
  - 状态 → CANCELED
```

#### fillReturnShipping(userId, afterSaleId, dto)

```
入参：returnCarrierName, returnWaybillNo
校验：
  - 状态为 APPROVED 且 requiresReturn = true
操作：
  - 记录快递信息 + returnShippedAt = now
  - 状态 → RETURN_SHIPPING
```

#### confirmReceive(userId, afterSaleId)

```
校验：状态为 REPLACEMENT_SHIPPED
操作：
  - 状态 → COMPLETED
  - 不触发奖励发放（因为退换货订单奖励已归平台）
```

#### escalate(userId, afterSaleId)

```
校验：
  - 状态为 REJECTED 或 SELLER_REJECTED_RETURN
操作：
  - 状态 → PENDING_ARBITRATION
```

#### acceptClose(userId, afterSaleId)

```
校验：
  - 状态为 REJECTED 或 SELLER_REJECTED_RETURN
操作：
  - 状态 → CLOSED（买家接受驳回/验收不通过，售后终止）
```

#### list(userId, page, pageSize) / findById(userId, id)

沿用现有逻辑，扩展返回字段。

### 3.3 卖家端 seller-after-sale.service.ts

> **角色限制：** 所有写操作（审核/同意/驳回/验收/发货）仅 OWNER / MANAGER 角色可执行。OPERATOR 只有只读权限（列表、详情查看）。通过 `@SellerRoleGuard` + `@Roles(OWNER, MANAGER)` 装饰器在 Controller 层强制校验。

#### startReview(companyId, afterSaleId)
- REQUESTED → UNDER_REVIEW

#### approve(companyId, afterSaleId, note?)
- REQUESTED/UNDER_REVIEW → APPROVED
- 记录 approvedAt = now（寄回超时起算点）
- 如果 requiresReturn = false 且 afterSaleType 是退货：自动触发退款流程

#### reject(companyId, afterSaleId, reason)
- REQUESTED/UNDER_REVIEW → REJECTED

#### confirmReceiveReturn(companyId, afterSaleId)
- RETURN_SHIPPING → RECEIVED_BY_SELLER
- 记录 sellerReceivedAt = now
- 如果 afterSaleType 是退货：自动触发退款流程
- 如果 afterSaleType 是换货：等待卖家发货

#### rejectReturn(companyId, afterSaleId, dto)
- RECEIVED_BY_SELLER → SELLER_REJECTED_RETURN
- dto: { reason, photos[], returnWaybillNo }（卖家寄回给买家）

#### ship(companyId, afterSaleId)
- 换货场景：APPROVED/RECEIVED_BY_SELLER → REPLACEMENT_SHIPPED
- 需先生成面单

#### generateWaybill / cancelWaybill
- 沿用现有逻辑

### 3.4 管理端 admin-after-sale.service.ts

#### arbitrate(afterSaleId, dto)
- 可仲裁状态：PENDING_ARBITRATION（以及管理员主动介入时的 REQUESTED / UNDER_REVIEW）
- dto: { status: APPROVED | REJECTED, reason? }
- 仲裁 REJECTED → 售后终止（状态 REJECTED）
- 仲裁 APPROVED 后根据来源状态决定后续：
  - **来自 REJECTED（卖家审核驳回）：** 按正常 APPROVED 流程继续（判断是否需要寄回等）
  - **来自 SELLER_REJECTED_RETURN（卖家验收不通过）：** 货已在卖家手里，直接进入最终处理：
    - 退货退款（QUALITY_RETURN / NO_REASON_RETURN）→ 直接触发退款，状态 → REFUNDING
    - 换货（QUALITY_EXCHANGE）→ 等待卖家发出换货商品，状态 → APPROVED（卖家需执行 ship）
  - 记录 `arbitrationSource` 字段区分仲裁来源

#### getStats()
- 按 afterSaleType + status 分组统计

#### findAll / findById
- 合并原 replacements + refunds 列表

### 3.5 API 路由

**买家端：**
```
POST   /after-sale/orders/:orderId          # 提交售后申请
GET    /after-sale                           # 我的售后列表
GET    /after-sale/:id                       # 售后详情
POST   /after-sale/:id/cancel               # 撤销
POST   /after-sale/:id/return-shipping      # 填写退回物流
POST   /after-sale/:id/confirm              # 确认换货收货
POST   /after-sale/:id/escalate             # 升级到平台仲裁
POST   /after-sale/:id/accept-close        # 接受驳回/验收不通过，关闭售后
GET    /after-sale/return-policy             # 获取退换货协议内容
POST   /after-sale/agree-policy             # 确认退换货协议
```

**卖家端：**
```
GET    /seller/after-sale                    # 售后列表
GET    /seller/after-sale/stats              # 状态统计
GET    /seller/after-sale/:id                # 售后详情
POST   /seller/after-sale/:id/review        # 开始审核
POST   /seller/after-sale/:id/approve       # 同意
POST   /seller/after-sale/:id/reject        # 驳回
POST   /seller/after-sale/:id/receive       # 确认收到退回商品
POST   /seller/after-sale/:id/reject-return # 验收不通过
POST   /seller/after-sale/:id/ship          # 换货发货
POST   /seller/after-sale/:id/waybill       # 生成面单
DELETE /seller/after-sale/:id/waybill       # 取消面单
```

**管理端：**
```
GET    /admin/after-sale                     # 售后列表
GET    /admin/after-sale/stats               # 状态统计
GET    /admin/after-sale/:id                 # 售后详情
POST   /admin/after-sale/:id/arbitrate      # 仲裁
```

---

## 四、分润奖励系统变更

### 4.1 奖励发放时机变更

**当前：** 订单 RECEIVED → 发放奖励，状态 FROZEN
**改造后：** 订单 RECEIVED → 发放奖励，状态 **RETURN_FROZEN**

改动文件：
- `engine/normal-upstream.service.ts`：发放状态改为 RETURN_FROZEN
- `engine/vip-upstream.service.ts`：发放状态改为 RETURN_FROZEN

### 4.2 退货保护期解冻 Cron

在 `freeze-expire.service.ts` 新增逻辑：

```
每小时执行：
1. 查找 status = RETURN_FROZEN 的 RewardLedger 记录
2. 通过 refId 找到关联的 orderId
3. 查找该订单的 returnWindowExpiresAt
4. 如果 returnWindowExpiresAt < now 且该订单无进行中售后申请：
   → RETURN_FROZEN 转为 FROZEN（进入第二层冻结解冻机制）
5. 如果有进行中售后申请：
   → 保持 RETURN_FROZEN，等售后结果
```

### 4.3 售后成功时的奖励处理

```
售后申请到达终态（REFUNDED 或 COMPLETED）时：
1. 查找该订单所有 RETURN_FROZEN 状态的奖励
2. 全部转为平台收入：
   - 创建 VOID 条目
   - 将收益方改为平台账户
3. 按退货后实际金额重新计算分润数据（仅统计用，不实际发放）

注意：正常业务流中，售后只能在 7 天保护期内发生，奖励此时一定
还在 RETURN_FROZEN 状态。但作为数据纠偏兜底，如果发现该订单
存在 FROZEN 或 AVAILABLE 状态的奖励（例如 Cron 时序偏差导致
提前解冻），也一并回收为平台收入并记录告警日志。这是防御性编程，
不是正常业务流。
```

### 4.4 钱包余额查询

`bonus.service.ts` 中余额查询排除 `RETURN_FROZEN` 状态的记录，确保用户看不到退货保护期内的奖励。

---

## 五、订单模块变更

### 5.1 Order 模型新增字段

- `deliveredAt: DateTime?` — 物流签收时间
- `returnWindowExpiresAt: DateTime?` — 售后窗口截止 = deliveredAt + RETURN_WINDOW_DAYS天

### 5.2 状态转换触发

```
订单变为 DELIVERED 时：
  → deliveredAt = now
  → returnWindowExpiresAt = now + RETURN_WINDOW_DAYS天（从配置表取）

订单变为 RECEIVED 时（兜底，防止物流异常无 DELIVERED 记录）：
  → 如果 deliveredAt 仍为 null：
    deliveredAt = receivedAt
    returnWindowExpiresAt = receivedAt + RETURN_WINDOW_DAYS天
```

### 5.3 order.service.ts 改动

- `list()`：售后状态从统一的 AfterSaleRequest 取，不再分别查 Refund + Replacement
- `getStatusCounts()`：售后中计数统一
- `mapOrder()`：返回 returnWindowExpiresAt、商品 returnPolicy、是否可申请售后
- `confirmReceive()`：奖励发放状态改为 RETURN_FROZEN

### 5.4 全部退货时订单状态

当一个订单的所有 OrderItem 都完成退款（REFUNDED）时：
- 订单状态 → REFUNDED
- 退款金额包含运费（仅质量问题时）

---

## 六、支付退款

### 6.1 退款金额计算

```typescript
function calculateRefundAmount(
  orderItem: OrderItem,
  order: Order,
  afterSaleType: AfterSaleType,
  isFullRefund: boolean  // 是否全部商品都退了
): number {
  const itemAmount = orderItem.unitPrice * orderItem.quantity;
  const couponShare = order.totalCouponDiscount
    ? order.totalCouponDiscount * (itemAmount / order.goodsAmount)
    : 0;

  let refundAmount = itemAmount - couponShare;

  // 全部退货 + 质量问题 → 退运费
  // 「全部退货」= 订单中所有 OrderItem（含奖品）都已退款完成
  // 因为奖品不可退，所以含奖品的订单永远不算「全部退货」，运费不退
  if (isFullRefund && afterSaleType !== 'NO_REASON_RETURN') {
    refundAmount += order.shippingFee;
  }

  return Math.round(refundAmount * 100) / 100; // 精确到分
}
```

### 6.2 退款触发时机

- 不需要寄回 + 审核通过 → 自动触发退款
- 需要寄回 + 卖家验收通过 → 自动触发退款
- 调用现有 `PaymentService.initiateRefund()`
- 失败进入现有重试 Cron

---

## 七、系统配置参数

存入 `RuleConfig` 表，管理后台可配置：

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `RETURN_WINDOW_DAYS` | Int | 7 | 七天无理由退货窗口天数（从 DELIVERED 起算） |
| `NORMAL_RETURN_DAYS` | Int | 7 | 非生鲜质量问题申报天数（从 DELIVERED 起算，≤ RETURN_WINDOW_DAYS） |
| `FRESH_RETURN_HOURS` | Int | 24 | 生鲜质量问题时限（小时，从 DELIVERED 起算） |
| `RETURN_NO_SHIP_THRESHOLD` | Float | 50 | 免寄回金额阈值（元） |
| `SELLER_REVIEW_TIMEOUT_DAYS` | Int | 3 | 卖家不审核自动同意 |
| `BUYER_SHIP_TIMEOUT_DAYS` | Int | 7 | 买家不寄回自动关闭 |
| `SELLER_RECEIVE_TIMEOUT_DAYS` | Int | 7 | 卖家不验收自动通过 |
| `BUYER_CONFIRM_TIMEOUT_DAYS` | Int | 7 | 换货不确认自动完成 |

> **命名说明：** `RETURN_WINDOW_DAYS` 控制「七天无理由退货」窗口，`NORMAL_RETURN_DAYS` 控制「非生鲜质量问题」窗口。两者分开配置但 `NORMAL_RETURN_DAYS ≤ RETURN_WINDOW_DAYS`（后台校验），因为所有售后必须在退货保护期内完成。refund.md 中的配置项名称与此一致。

---

## 八、超时 Cron 任务

新增 `after-sale-timeout.service.ts`：

| 场景 | 条件 | 操作 |
|------|------|------|
| 卖家审核超时 | REQUESTED/UNDER_REVIEW 且 createdAt + SELLER_REVIEW_TIMEOUT_DAYS < now | → APPROVED |
| 买家寄回超时 | APPROVED 且 requiresReturn=true 且 approvedAt + BUYER_SHIP_TIMEOUT_DAYS < now | → CANCELED |
| 卖家验收超时 | RETURN_SHIPPING 且 returnShippedAt + SELLER_RECEIVE_TIMEOUT_DAYS < now | → RECEIVED_BY_SELLER，继续后续流程 |
| 换货确认超时 | REPLACEMENT_SHIPPED 且发货时间 + BUYER_CONFIRM_TIMEOUT_DAYS < now | → COMPLETED |

频率：每小时执行一次。所有操作在 Serializable 事务内 + CAS 防并发。

退货保护期解冻 Cron（在 freeze-expire.service.ts 中新增）：
- 每小时扫描 RETURN_FROZEN 且 returnWindowExpiresAt < now 且无进行中售后 → 转 FROZEN

---

## 九、买家 App 变更

### 9.1 新增/改造页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 售后申请表单 | `app/orders/after-sale/[id].tsx` | **重写**：统一退货+换货表单 |
| 售后列表 | `app/orders/after-sale/index.tsx` | **新增**：我的售后申请列表 |
| 售后详情 | `app/orders/after-sale/detail/[id].tsx` | **新增**：进度+操作 |

### 9.2 售后申请表单流程

```
Step 1：选择商品（选择一个 OrderItem，每次申请只能选一个）
Step 2：选择售后类型
  → 系统根据 returnPolicy + 时间窗口动态展示可选项
  → 不可退商品：隐藏「七天无理由退货」
  → 超过时限：对应选项不展示
  → 所有选项不可用：显示「已超过售后申请期限」
Step 3：拍照上传（1-10张）
Step 4：原因选择（质量问题时）+ 补充说明
Step 5：确认提交
  → 显示退款金额预估
  → 显示是否需要寄回 + 运费说明
```

### 9.3 售后详情页按状态展示

| 状态 | 展示内容 | 操作 |
|------|---------|------|
| REQUESTED | 等待卖家审核 | 撤销按钮 |
| UNDER_REVIEW | 审核中 | 撤销按钮 |
| APPROVED（需寄回） | 请寄回商品 | 填写物流单号表单 |
| APPROVED（不用寄回） | 处理中 | 无 |
| RETURN_SHIPPING | 等待卖家验收 | 无 |
| RECEIVED_BY_SELLER | 验收中 | 无 |
| SELLER_REJECTED_RETURN | 验收不通过 + 原因 + 举证 | 升级仲裁按钮 + 接受关闭按钮 + 客服占位 |
| PENDING_ARBITRATION | 平台仲裁中 | 无（等待管理员处理） |
| REFUNDING | 退款处理中 | 无 |
| REFUNDED / COMPLETED | 售后完成 | 无 |
| REJECTED | 被驳回 + 原因 | 升级仲裁按钮 + 接受关闭按钮 + 客服占位 |
| CLOSED | 已关闭（买家接受驳回） | 无 |
| CANCELED | 已撤销 | 无 |

### 9.4 订单详情页改动

- 非生鲜可退商品：小字「支持7天无理由退换」
- 生鲜/不可退商品：小字「签收后24小时内如有质量问题可申请售后」
- VIP礼包/奖品：小字「不支持退换」
- 售后进行中：显示当前售后状态 + 跳转详情链接

### 9.5 结账页改动

- 用户 `hasAgreedReturnPolicy = false` 时：首次结账弹出退换货规则协议
- 协议包含：普通商品7天无理由规则 + 生鲜特殊规则 + VIP/奖品不退换条款
- 用户勾选确认 → 调用 `POST /after-sale/agree-policy` → `hasAgreedReturnPolicy = true`
- 后续结账不再弹出

### 9.6 文件改动清单

| 文件 | 改动 |
|------|------|
| `app/orders/after-sale/[id].tsx` | 重写为统一售后表单 |
| `app/orders/after-sale/index.tsx` | 新增售后列表页 |
| `app/orders/after-sale/detail/[id].tsx` | 新增售后详情页 |
| `app/orders/[id].tsx` | 订单详情增加退货政策提示 + 售后入口 |
| `app/orders/index.tsx` | 售后状态筛选统一 |
| `src/types/domain/Order.ts` | 新增 AfterSaleType、AfterSaleStatus 等类型 |
| `src/repos/OrderRepo.ts` | API 路径更新 |
| `src/repos/ReplacementRepo.ts` | 废弃，功能合并到新的 AfterSaleRepo |
| `src/repos/AfterSaleRepo.ts` | 新建：售后相关 API 调用 |
| `src/constants/statuses.ts` | 新增 12 状态中文映射 |
| 结账相关页面 | 首次弹出协议 |
| 商品详情页 | 小字退货政策提示 |

---

## 十、卖家后台变更

### 10.1 菜单变更

- 「换货管理」+ 隐藏的「退款记录」→ 合并为 **「售后管理」**（`/seller/after-sale`）

### 10.2 页面改动

| 文件 | 改动 |
|------|------|
| `seller/src/pages/replacements/index.tsx` | 重写为 `after-sale/index.tsx` |
| `seller/src/pages/replacements/detail.tsx` | 重写为 `after-sale/detail.tsx` |
| `seller/src/pages/refunds/index.tsx` | 废弃 |
| `seller/src/api/replacements.ts` | 重写为 `after-sale.ts` |
| `seller/src/api/refunds.ts` | 废弃 |
| `seller/src/layouts/SellerLayout.tsx` | 菜单更新 |
| `seller/src/constants/statusMaps.ts` | 新增状态映射 |
| `seller/src/pages/products/index.tsx` | 商品编辑新增退货政策下拉 |

### 10.3 售后列表页

- Tab 筛选：全部 / 待审核 / 待验收 / 待发货 / 已完成
- 售后类型筛选：七天无理由 / 质量问题退货 / 质量问题换货
- 每行：售后类型标签 + 商品 + 买家匿名 + 金额 + 状态 + 操作

### 10.4 售后详情页操作

| 状态 | 操作 |
|------|------|
| REQUESTED | 开始审核 |
| UNDER_REVIEW | 同意 / 驳回（填原因） |
| APPROVED（换货不用寄回） | 生成面单 → 发货 |
| RETURN_SHIPPING | 确认收到退回商品 |
| RECEIVED_BY_SELLER | 验收通过 / 验收不通过（填原因+上传照片+寄回单号） |

### 10.5 商品退货政策

商品编辑页新增下拉：
- `跟随分类（当前：XXX）` ← 默认，括号动态显示分类实际值
- `支持7天无理由退货`
- `不支持7天无理由退货`

---

## 十一、管理后台变更

### 11.1 菜单变更

- 「换货仲裁」+「退款仲裁」→ 合并为 **「售后仲裁」**（`/admin/after-sale`）

### 11.2 页面改动

| 文件 | 改动 |
|------|------|
| `admin/src/pages/replacements/index.tsx` | 重写为 `after-sale/index.tsx` |
| `admin/src/pages/refunds/index.tsx` | 废弃 |
| `admin/src/api/replacements.ts` | 重写为 `after-sale.ts` |
| `admin/src/api/refunds.ts` | 废弃 |
| `admin/src/pages/categories/index.tsx` | 分类管理新增退货政策列 + 编辑 |
| `admin/src/pages/products/index.tsx` | 商品列表展示退货政策（只读） |
| `admin/src/layouts/AdminLayout.tsx` | 菜单更新 |
| `admin/src/constants/statusMaps.ts` | 新增状态映射 |

### 11.3 分类管理新增

- 分类列表新增「退货政策」列
- 分类编辑下拉：`支持退货` / `不支持退货` / `继承父分类`
- 顶级分类默认「支持退货」

### 11.4 售后仲裁页面

- 统计面板：按售后类型 + 状态分组
- 合并原换货仲裁 + 退款仲裁
- 仲裁弹窗：保留模板功能 + 新增退货退款模板
- SELLER_REJECTED_RETURN 状态：展示双方举证，管理员裁决

### 11.5 系统配置页面

新增「售后配置」分区，管理 7 个可配置参数。

---

## 十二、完整状态机图

```
                    ┌──────────┐
                    │ REQUESTED│──────────────────────────┐
                    └────┬─────┘                          │
                         │                                │
              ┌──────────▼──────────┐                     │
              │   UNDER_REVIEW      │                     │
              └──────────┬──────────┘                     │
                    ┌────┴────┐                           │
                    ▼         ▼                           ▼
              ┌──────────┐ ┌──────────┐            ┌──────────┐
              │ APPROVED │ │ REJECTED │            │ CANCELED │
              └────┬─────┘ └────┬─────┘            └──────────┘
                   │            │                  (买家主动撤销)
          ┌────────┴────────┐   │
          ▼                 ▼   └→ 买家可升级仲裁
   [需要寄回]          [不需要寄回]
          │                 │
          ▼                 │
  ┌───────────────┐         │
  │RETURN_SHIPPING│         │
  └───────┬───────┘         │
          ▼                 │
  ┌───────────────────┐     │
  │RECEIVED_BY_SELLER │     │
  └───────┬───────────┘     │
     ┌────┴────┐            │
     ▼         ▼            │
 [验收通过] [验收不通过]     │
     │    ┌──────────────────────────┐
     │    │SELLER_REJECTED_RETURN    │
     │    └──────────┬───────────────┘
     │               └→ 买家可升级仲裁
     │                        │
     ├────────────────────────┤
     │                        │
     ▼                        ▼
 [退货退款路径]          [换货路径]
     │                        │
     ▼                        ▼
 ┌──────────┐       ┌───────────────────┐
 │ REFUNDING│       │REPLACEMENT_SHIPPED│
 └────┬─────┘       └────────┬──────────┘
      ▼                      ▼
 ┌──────────┐          ┌──────────┐
 │ REFUNDED │          │COMPLETED │
 └────┬─────┘          └──────────┘
      ▼
 ┌──────────┐
 │COMPLETED │
 └──────────┘
```

---

## 十三、数据迁移方案

### 13.1 ReplacementRequest → AfterSaleRequest

```sql
-- 1. 重命名表
ALTER TABLE "ReplacementRequest" RENAME TO "after_sale_request";

-- 2. 新增字段
ALTER TABLE "after_sale_request" ADD COLUMN "afterSaleType" TEXT DEFAULT 'QUALITY_EXCHANGE';
ALTER TABLE "after_sale_request" ADD COLUMN "requiresReturn" BOOLEAN DEFAULT false;
ALTER TABLE "after_sale_request" ADD COLUMN "returnCarrierName" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnWaybillNo" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippedAt" TIMESTAMP;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerRejectReason" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerRejectPhotos" TEXT[] DEFAULT '{}';
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnWaybillNo" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "refundAmount" DOUBLE PRECISION;
ALTER TABLE "after_sale_request" ADD COLUMN "refundId" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "approvedAt" TIMESTAMP;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReceivedAt" TIMESTAMP;
ALTER TABLE "after_sale_request" ADD COLUMN "isPostReplacement" BOOLEAN DEFAULT false;

-- 3. 历史数据标记为换货类型
UPDATE "after_sale_request" SET "afterSaleType" = 'QUALITY_EXCHANGE' WHERE "afterSaleType" IS NULL;

-- 4. 状态映射（现有 ReplacementStatus → AfterSaleStatus 值相同，无需迁移）
```

### 13.2 其他模型新增字段

通过 Prisma migration 自动执行，均有默认值，无需手动迁移数据。

---

## 十四、并发安全

所有状态转换操作使用 Serializable 隔离级别 + CAS（Compare-And-Swap）模式 + P2034 重试（最多3次）。

关键并发场景：
1. 同一 OrderItem 并发提交售后 → CAS 检查无进行中申请
2. 卖家/管理员同时操作同一售后 → CAS 检查状态
3. 超时 Cron 与手动操作并发 → CAS 防冲突
4. 退款与奖励处理并发 → 同一事务内完成
