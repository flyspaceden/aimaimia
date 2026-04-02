# 统一退换货系统 — 测试方案

> 版本：v1.0 | 日期：2026-03-30
> 对应设计文档：`2026-03-30-unified-after-sale-design.md`
> 对应规则文档：`refund.md`（23 条规则）

---

## 一、测试策略

### 测试层级

| 层级 | 工具 | 覆盖范围 |
|------|------|---------|
| 单元测试 | Jest | 退款金额计算、退货政策判定、时间窗口校验 |
| 集成测试 | Jest + Prisma (SQLite/Postgres) | 完整售后流程、状态机转换、并发安全、奖励冻结/解冻 |
| API 测试 | Supertest + NestJS Testing | 所有 API 端点、权限校验、DTO 校验 |
| 端到端场景测试 | 手动 + 自动化脚本 | 跨系统联动（订单→售后→奖励→退款→前端展示） |

### 测试数据准备

```
测试商户：
  - 公司 A（普通商品卖家）
  - 公司 B（生鲜海鲜卖家）

测试分类：
  - 「干货」→ returnPolicy: RETURNABLE
  - 「海鲜」→ returnPolicy: NON_RETURNABLE
  - 「海鲜 > 干海参」→ returnPolicy: INHERIT（继承父级 NON_RETURNABLE）

测试商品：
  - 商品 P1：干货分类，价格 100 元，returnPolicy: INHERIT（最终可退）
  - 商品 P2：海鲜分类，价格 200 元，returnPolicy: INHERIT（最终不可退）
  - 商品 P3：海鲜分类，价格 30 元，returnPolicy: RETURNABLE（商品级覆盖为可退）
  - 商品 P4：干货分类，价格 80 元，returnPolicy: NON_RETURNABLE（商品级覆盖为不可退）
  - 商品 P5：干货分类，价格 20 元（低于阈值 50 元）
  - 商品 P6：VIP 礼包商品

测试用户：
  - 买家 U1（已确认退换货协议）
  - 买家 U2（未确认退换货协议）
  - 买家 U3（有上级推荐人，用于测试分润）
  - 卖家 S1（公司 A 的 OWNER）
  - 卖家 S2（公司 B 的 OPERATOR，无审核权限）
  - 管理员 Admin
```

---

## 二、单元测试

### T-UNIT-01：退款金额计算

```
测试函数：calculateRefundAmount()

Case 1: 单商品退货，无红包
  输入：unitPrice=100, quantity=1, totalCouponDiscount=0, goodsAmount=100
  期望：refundAmount = 100

Case 2: 单商品退货，有红包
  输入：unitPrice=100, quantity=1, totalCouponDiscount=60, goodsAmount=600
  期望：refundAmount = 100 - 60*(100/600) = 90

Case 3: 多数量退货
  输入：unitPrice=50, quantity=3, totalCouponDiscount=30, goodsAmount=300
  期望：refundAmount = 150 - 30*(150/300) = 135

Case 4: 全部退货 + 质量问题 → 退运费
  输入：同 Case 2, isFullRefund=true, afterSaleType=QUALITY_RETURN, shippingFee=15
  期望：refundAmount = 90 + 15 = 105

Case 5: 全部退货 + 七天无理由 → 不退运费
  输入：同 Case 2, isFullRefund=true, afterSaleType=NO_REASON_RETURN, shippingFee=15
  期望：refundAmount = 90（不含运费）

Case 6: 精度测试（避免浮点误差）
  输入：unitPrice=33.33, quantity=1, totalCouponDiscount=10, goodsAmount=99.99
  期望：refundAmount 精确到分（两位小数）

Case 7: 红包分摊为 0
  输入：unitPrice=100, quantity=1, totalCouponDiscount=0, goodsAmount=100
  期望：refundAmount = 100
```

### T-UNIT-02：退货政策判定

```
测试函数：resolveReturnPolicy(product, category)

Case 1: 商品 INHERIT + 分类 RETURNABLE
  期望：RETURNABLE

Case 2: 商品 INHERIT + 分类 NON_RETURNABLE
  期望：NON_RETURNABLE

Case 3: 商品 INHERIT + 分类 INHERIT + 父分类 RETURNABLE
  期望：RETURNABLE

Case 4: 商品 INHERIT + 分类 INHERIT + 父分类 INHERIT + 顶级分类 RETURNABLE
  期望：RETURNABLE

Case 5: 商品 RETURNABLE + 分类 NON_RETURNABLE（商品覆盖）
  期望：RETURNABLE

Case 6: 商品 NON_RETURNABLE + 分类 RETURNABLE（商品覆盖）
  期望：NON_RETURNABLE

Case 7: 商品 INHERIT + 分类 INHERIT + 无父分类（顶级）
  期望：RETURNABLE（兜底）

Case 8: 分类链条：A(INHERIT) → B(INHERIT) → C(NON_RETURNABLE)
  期望：NON_RETURNABLE
```

### T-UNIT-03：时间窗口校验

```
测试函数：isWithinReturnWindow(order, product, afterSaleType)

Case 1: 普通商品，七天无理由，签收后第 3 天
  deliveredAt = now - 3天
  期望：true

Case 2: 普通商品，七天无理由，签收后第 8 天
  deliveredAt = now - 8天
  期望：false

Case 3: 普通商品，七天无理由，签收后恰好第 7 天（边界）
  deliveredAt = now - 7天 + 1秒
  期望：true

Case 4: 普通商品，七天无理由，签收后第 7 天过 1 秒
  deliveredAt = now - 7天 - 1秒
  期望：false

Case 5: 生鲜商品，质量问题，签收后 20 小时
  deliveredAt = now - 20小时, returnPolicy=NON_RETURNABLE
  期望：true（24小时内）

Case 6: 生鲜商品，质量问题，签收后 25 小时
  deliveredAt = now - 25小时, returnPolicy=NON_RETURNABLE
  期望：false

Case 7: 生鲜商品，七天无理由
  returnPolicy = NON_RETURNABLE, afterSaleType = NO_REASON_RETURN
  期望：false（不可退商品不支持无理由退货）

Case 8: 无 deliveredAt 记录，使用 receivedAt 兜底
  deliveredAt = null, receivedAt = now - 3天
  期望：true

Case 9: VIP_PACKAGE 订单
  bizType = VIP_PACKAGE
  期望：false（一律不支持）
```

### T-UNIT-04：是否需要寄回判定

```
测试函数：requiresReturn(afterSaleType, itemAmount, threshold)

Case 1: 七天无理由，商品 20 元（低于阈值）
  期望：true（无理由一律寄回）

Case 2: 七天无理由，商品 200 元
  期望：true

Case 3: 质量问题退货，商品 20 元，阈值 50
  期望：false（低于阈值免寄回）

Case 4: 质量问题退货，商品 60 元，阈值 50
  期望：true（高于阈值需寄回）

Case 5: 质量问题退货，商品 50 元，阈值 50（边界：等于）
  期望：false（≤ 阈值免寄回）

Case 6: 质量问题换货，商品 30 元，阈值 50
  期望：false

Case 7: 质量问题换货，商品 80 元，阈值 50
  期望：true
```

---

## 三、集成测试 — 完整流程

### T-INT-01：七天无理由退货 — 需要寄回（完整流程）

```
前置：买家 U1 购买商品 P1（100元，可退），订单已 DELIVERED 3 天

Step 1: U1 提交售后申请
  → POST /after-sale/orders/:orderId
  → body: { orderItemId, afterSaleType: NO_REASON_RETURN, photos: [...] }
  → 断言：返回 201, status=REQUESTED, requiresReturn=true, refundAmount=100

Step 2: 卖家 S1 开始审核
  → POST /seller/after-sale/:id/review
  → 断言：status=UNDER_REVIEW

Step 3: 卖家 S1 同意
  → POST /seller/after-sale/:id/approve
  → 断言：status=APPROVED, approvedAt 非空

Step 4: 买家 U1 填写退回物流
  → POST /after-sale/:id/return-shipping
  → body: { returnCarrierName: '顺丰', returnWaybillNo: 'SF123456' }
  → 断言：status=RETURN_SHIPPING

Step 5: 卖家 S1 确认收到退回商品
  → POST /seller/after-sale/:id/receive
  → 断言：status=RECEIVED_BY_SELLER

Step 6: 系统自动触发退款
  → 断言：status 变为 REFUNDING → REFUNDED
  → 断言：Refund 记录创建，amount=100
  → 断言：订单状态仍为 RECEIVED（部分退货不改状态）

Step 7: 验证奖励处理
  → 断言：该订单所有 RETURN_FROZEN 奖励转为平台收入
```

### T-INT-02：质量问题退货 — 不用寄回

```
前置：买家 U1 购买商品 P5（20元，低于阈值50），订单已 DELIVERED 2 天

Step 1: U1 提交售后
  → afterSaleType: QUALITY_RETURN, reasonType: DAMAGED, photos: [...]
  → 断言：requiresReturn=false, refundAmount=20

Step 2: 卖家同意
  → 断言：status=APPROVED
  → 断言：自动触发退款（不需要寄回）

Step 3: 退款完成
  → 断言：REFUNDING → REFUNDED → COMPLETED
  → 断言：奖励归平台
```

### T-INT-03：质量问题换货 — 需要寄回

```
前置：买家购买商品 P1（100元），已 DELIVERED

Step 1: 提交换货申请
  → afterSaleType: QUALITY_EXCHANGE, reasonType: WRONG_ITEM
  → 断言：requiresReturn=true

Step 2: 卖家同意 → 买家寄回 → 卖家验收
Step 3: 卖家发出换货商品
  → 断言：status=REPLACEMENT_SHIPPED

Step 4: 买家确认收货
  → 断言：status=COMPLETED

Step 5: 验证奖励
  → 断言：整单奖励归平台
```

### T-INT-04：生鲜商品质量问题

```
前置：买家购买商品 P2（海鲜，200元，不可退），订单已 DELIVERED 20 小时

Step 1: 尝试提交七天无理由退货
  → 断言：400 错误，「该商品不支持七天无理由退货」

Step 2: 提交质量问题退货
  → afterSaleType: QUALITY_RETURN, reasonType: QUALITY_ISSUE
  → 断言：成功，requiresReturn=true（200元 > 阈值50元）

Step 3: 超过 24 小时后再提交
  → 断言：400 错误，「已超过售后申请期限」
```

### T-INT-05：VIP 礼包不支持售后

```
前置：买家购买 VIP 礼包（P6），已 DELIVERED

Step 1: 尝试任何类型的售后申请
  → 断言：400 错误，「VIP 礼包订单不支持退换货」
```

### T-INT-05b：抽奖奖品不支持售后

```
前置：买家订单中包含奖品商品（isPrize=true，如折扣购或满额赠品），已 DELIVERED

Step 1: 对奖品 OrderItem 提交任何类型的售后申请
  → 断言：400 错误，「抽奖奖品不支持退换货」

Step 2: 对同一订单中的非奖品 OrderItem 提交售后
  → 断言：成功（奖品限制不影响普通商品）
```

### T-INT-06：换货后再退货限制（规则 22）

```
前置：商品 P1 换货已完成（有一条 COMPLETED 的换货记录）

Step 1: 对同一 OrderItem 提交七天无理由退货
  → 断言：400 错误，「换货后不支持七天无理由退货」

Step 2: 提交质量问题退货
  → 断言：成功，isPostReplacement=true
  → 断言：状态直接到平台待仲裁（跳过卖家审核）
```

### T-INT-07：部分退货 + 红包分摊

```
前置：订单含 P1(100元) + P5(20元)，使用红包 12 元，实付 108 元

Step 1: 只退 P1
  → 红包分摊 = 12 × (100/120) = 10
  → 断言：refundAmount = 100 - 10 = 90
  → 断言：订单状态保持 RECEIVED

Step 2: 再退 P5
  → 红包分摊 = 12 × (20/120) = 2
  → 断言：refundAmount = 20 - 2 = 18
  → 断言：订单状态变为 REFUNDED（全部退完）
```

### T-INT-08：全部退货 + 运费处理

```
前置：订单含 P1(100元)，运费 15 元，无红包

Case A: 全部退货，七天无理由
  → 断言：refundAmount = 100（不含运费）

Case B: 全部退货，质量问题
  → 断言：refundAmount = 100 + 15 = 115（含运费）
```

---

## 四、集成测试 — 卖家验收不通过

### T-INT-09：验收不通过 → 仲裁

```
Step 1-4: 正常流程到 RECEIVED_BY_SELLER
Step 5: 卖家验收不通过
  → POST /seller/after-sale/:id/reject-return
  → body: { reason: '商品已使用', photos: [...], returnWaybillNo: 'YT456' }
  → 断言：status=SELLER_REJECTED_RETURN

Step 6: 买家升级仲裁
  → POST /after-sale/:id/escalate
  → 断言：记录升级标记

Step 7: 管理员仲裁同意
  → POST /admin/after-sale/:id/arbitrate { status: APPROVED }
  → 断言：继续退款流程

Step 8: 管理员仲裁驳回（另一条测试路径）
  → POST /admin/after-sale/:id/arbitrate { status: REJECTED }
  → 断言：售后终止
```

---

## 五、集成测试 — 超时机制

### T-INT-10：卖家审核超时

```
前置：买家提交售后申请，createdAt = now - 4天（超过3天默认超时）

执行：触发 Cron
  → 断言：status 从 REQUESTED 变为 APPROVED
  → 断言：自动进入后续流程
```

### T-INT-11：买家寄回超时

```
前置：售后已 APPROVED，approvedAt = now - 8天，requiresReturn=true，买家未填物流

执行：触发 Cron
  → 断言：status 变为 CANCELED
```

### T-INT-12：卖家验收超时

```
前置：买家已寄回，returnShippedAt = now - 8天，卖家未操作

执行：触发 Cron
  → 断言：status 变为 RECEIVED_BY_SELLER
  → 断言：自动继续后续流程（退款或等待卖家发货）
```

### T-INT-13：换货买家确认超时

```
前置：换货已发货 8 天，买家未确认

执行：触发 Cron
  → 断言：status 变为 COMPLETED
```

---

## 六、集成测试 — 分润奖励

### T-INT-14：正常流程 — 无退货，奖励正常释放

```
前置：买家 U3 下单 P1(100元)，有推荐人。订单 DELIVERED 后确认收货。

Step 1: 订单 RECEIVED → 奖励发放
  → 断言：RewardLedger 记录状态为 RETURN_FROZEN
  → 断言：U3 的推荐人钱包余额不包含此奖励（不可见）

Step 2: 7 天后无退货 → Cron 解冻
  → 断言：RETURN_FROZEN → FROZEN
  → 断言：推荐人钱包可看到冻结中的奖励

Step 3: 后续满足第 x 单条件 → 正常解冻
  → 断言：FROZEN → AVAILABLE
  → 断言：推荐人可提现
```

### T-INT-15：退货保护期内退货 — 奖励归平台

```
前置：同 T-INT-14，但买家在第 3 天申请退货

Step 1: 提交退货
Step 2: 退货完成（REFUNDED）
  → 断言：所有 RETURN_FROZEN 奖励转为平台收入
  → 断言：推荐人钱包无此订单奖励
  → 断言：平台统计记录中有此笔收入
```

### T-INT-16：售后进行中，奖励保持 RETURN_FROZEN

```
前置：买家第 6 天提交售后，第 7 天退货窗口到期但售后还在审核中

执行：触发 Cron
  → 断言：奖励保持 RETURN_FROZEN（不解冻，因为有进行中售后）

售后完成后：
  → 断言：奖励归平台
```

### T-INT-17：换货也触发奖励归平台

```
前置：买家换货成功（COMPLETED）

  → 断言：整单奖励归平台（换货和退货同样处理）
```

### T-INT-18：同一订单多商品，部分退货

```
前置：订单含 P1 + P5，奖励已分配

Step 1: 只退 P5
  → 断言：整单全部奖励归平台（规则14，任何退货整单奖励归平台）
```

---

## 七、集成测试 — 并发安全

### T-INT-19：同一 OrderItem 并发提交售后

```
操作：两个请求同时为同一 OrderItem 提交售后
  → 断言：只有一个成功，另一个返回 400「该商品已有进行中的售后申请」
```

### T-INT-20：卖家和管理员同时操作

```
操作：卖家点击同意的同时，管理员仲裁驳回
  → 断言：只有一个操作生效（CAS 保证）
```

### T-INT-21：超时 Cron 和手动操作并发

```
操作：卖家在审核超时 Cron 执行的同一时刻点击驳回
  → 断言：只有一个操作生效
```

### T-INT-22：并发退款触发

```
操作：两个请求同时触发同一售后的退款
  → 断言：只创建一个 Refund 记录
```

---

## 八、集成测试 — 买家撤销

### T-INT-23：REQUESTED 状态撤销

```
Step 1: 买家提交售后
Step 2: 买家撤销
  → 断言：status=CANCELED
Step 3: 买家重新提交（仍在时限内）
  → 断言：成功创建新的售后申请
```

### T-INT-24：UNDER_REVIEW 状态撤销

```
  → 断言：成功，status=CANCELED
```

### T-INT-25：APPROVED 状态撤销

```
  → 断言：400 错误，「当前状态不支持撤销」
```

---

## 八-B、补充集成测试

### T-INT-26：买家接受 SELLER_REJECTED_RETURN 并关闭售后

```
Step 1-5: 正常流程到 SELLER_REJECTED_RETURN（卖家验收不通过）
Step 6: 买家选择接受关闭
  → POST /after-sale/:id/accept-close
  → 断言：status = CLOSED
  → 断言：售后终止，该 OrderItem 可以重新发起售后（如仍在时限内）
  → 断言：奖励不受影响（售后未成功，不触发奖励归平台）
```

### T-INT-27：同一订单两个不同 OrderItem 并行售后 + 同一 OrderItem 被阻止

```
前置：订单含 P1(100元) + P5(20元)

Step 1: 对 P1 提交退货申请
  → 断言：成功，status=REQUESTED

Step 2: 对 P5 同时提交换货申请
  → 断言：成功（不同 OrderItem 可并行）

Step 3: 再对 P1 提交换货申请
  → 断言：400，「该商品已有进行中的售后申请」

Step 4: P1 售后完成（REFUNDED）后再对 P1 提交
  → 断言：成功（已终结的不阻止新申请）
```

### T-INT-28：换货后再退 — 卖家端不可审核，只出现在平台仲裁列表

```
前置：商品 P1 换货已完成（COMPLETED）

Step 1: 对 P1 提交质量问题退货
  → 断言：成功，isPostReplacement=true

Step 2: 检查卖家端售后列表
  → 断言：该申请**不出现**在卖家的待审核列表（或标记为「平台处理」不可操作）

Step 3: 检查管理端售后列表
  → 断言：该申请出现在平台待仲裁列表，status=PENDING_ARBITRATION

Step 4: 卖家尝试审核
  → 断言：403 或 400，「该售后申请由平台直接处理」
```

### T-INT-29：奖励负面用例 — 7天后奖励安全，不可被售后回收

```
前置：订单 DELIVERED + RECEIVED，奖励发放为 RETURN_FROZEN

Step 1: 模拟 7 天过去，触发 Cron
  → 断言：RETURN_FROZEN → FROZEN

Step 2: 尝试提交售后（已超过窗口期）
  → 断言：400，「已超过售后申请期限」

Step 3: 确认奖励状态
  → 断言：奖励保持 FROZEN，未被回收
  → 断言：后续正常走第二层冻结解冻机制
```

---

## 九、API 测试 — 权限与校验

### T-API-01：DTO 校验

```
Case 1: photos 为空数组
  → 断言：400，照片必填

Case 2: photos 超过 10 张
  → 断言：400，最多 10 张

Case 3: afterSaleType 无效值
  → 断言：400，无效的售后类型

Case 4: 质量问题但未选 reasonType
  → 断言：400，请选择问题原因

Case 5: reason 超过 500 字
  → 断言：400

Case 6: returnCarrierName 或 returnWaybillNo 为空（填写物流时）
  → 断言：400
```

### T-API-02：权限校验

```
Case 1: 卖家 S2（OPERATOR 角色）尝试审核
  → 断言：403，仅 OWNER/MANAGER 可操作

Case 2: 公司 A 的卖家尝试操作公司 B 的售后
  → 断言：403 或 404

Case 3: 买家查看别人的售后详情
  → 断言：404

Case 4: 未登录用户访问售后接口
  → 断言：401

Case 5: 管理员无 after-sale:arbitrate 权限
  → 断言：403
```

### T-API-03：退换货协议接口

```
Case 1: U2（未确认）访问结账
  → 断言：需要确认协议标记

Case 2: U2 确认协议
  → POST /after-sale/agree-policy
  → 断言：hasAgreedReturnPolicy = true

Case 3: U1（已确认）访问结账
  → 断言：无需再确认
```

---

## 十、端到端场景测试

### T-E2E-01：完整购买 → 退货 → 奖励处理流程

```
1. 买家 U3 首次结账 → 弹出退换货协议 → 确认
2. 下单 P1(100元) + P5(20元)，使用红包 12 元，运费 10 元
3. 支付成功 → 订单 PAID
4. 发货 → SHIPPED
5. 签收 → DELIVERED, deliveredAt 记录, returnWindowExpiresAt 计算
6. 确认收货 → RECEIVED
7. 验证：推荐人的奖励状态为 RETURN_FROZEN，钱包不可见
8. 第 3 天，退 P1 → 七天无理由
   → refundAmount = 100 - 12*(100/120) = 90
   → requiresReturn = true
9. 卖家审核通过
10. 买家填写物流寄回
11. 卖家验收通过
12. 退款 90 元
13. 验证：整单奖励（P1+P5 对应的）全部归平台
14. 验证：P5 不受影响（未退货，正常发货）
15. 验证：订单状态保持 RECEIVED
```

### T-E2E-02：生鲜商品完整流程

```
1. 买家购买 P2（海鲜 200元）
2. 订单 DELIVERED
3. 20 小时后发现质量问题 → 提交质量问题退货
   → requiresReturn = true（200 > 50阈值）
4. 卖家审核、买家寄回（到付，平台承担）、卖家验收
5. 退款 200 元
6. 验证：奖励归平台
```

### T-E2E-03：多商品订单 — 不同商品分别售后

```
1. 订单含公司 A 的 P1(100元) + 公司 B 的 P2(200元)
2. P1 申请七天无理由退货（公司 A 处理）
3. 同时 P2 申请质量问题换货（公司 B 处理）
4. 验证：两个售后独立进行
5. 验证：公司 A 只能看到 P1 的售后
6. 验证：公司 B 只能看到 P2 的售后
7. 验证：整单奖励归平台（只要有一个售后成功）
```

### T-E2E-04：超时自动处理完整链路

```
1. 买家提交售后
2. 卖家 3 天不审核 → Cron 自动同意
3. 买家 7 天不寄回 → Cron 自动关闭
4. 验证：售后状态 CANCELED
5. 验证：奖励不受影响（售后未成功）
```

### T-E2E-05：仲裁完整流程

```
1. 买家提交 → 卖家驳回 → 买家升级仲裁
2. 管理员查看双方信息
3. Case A：管理员同意 → 继续正常退货流程
4. Case B：管理员驳回 → 售后终止
5. 验证：审计日志记录所有操作
```

### T-E2E-06：卖家验收不通过 → 仲裁 → 退款

```
1. 买家寄回 → 卖家验收不通过（上传举证）
2. 买家升级仲裁
3. 管理员判定同意退货
4. 系统自动触发退款
5. 验证：退款金额正确
6. 验证：奖励归平台
```

---

## 十一、边界条件测试

### T-EDGE-01：时间边界

```
Case 1: 恰好第 7 天最后 1 秒提交
  → 断言：成功

Case 2: 第 7 天过 1 秒提交
  → 断言：失败

Case 3: 生鲜恰好第 24 小时提交
  → 断言：成功

Case 4: 生鲜第 24 小时过 1 秒
  → 断言：失败
```

### T-EDGE-02：金额边界

```
Case 1: 商品价格恰好等于阈值（50元）
  → 断言：不需要寄回（≤ 阈值）

Case 2: 商品价格 50.01 元
  → 断言：需要寄回

Case 3: 退款金额为 0（极端红包全额抵扣）
  → 断言：refundAmount = 0，不触发退款

Case 4: 单价 0.01 元商品
  → 断言：正常计算
```

### T-EDGE-03：状态机非法转换

```
Case 1: REQUESTED → REFUNDING（跳过审核）
  → 断言：400

Case 2: CANCELED → APPROVED（已撤销的不能继续）
  → 断言：400

Case 3: COMPLETED → REFUNDING（已完成的不能退款）
  → 断言：400

Case 4: REFUNDED → RETURN_SHIPPING（已退款不能寄回）
  → 断言：400

Case 5: REJECTED → RETURN_SHIPPING（被驳回不能寄回）
  → 断言：400
```

### T-EDGE-04：重复操作

```
Case 1: 同一 OrderItem 已有 REFUNDED 的售后，再次提交退货
  → 断言：400，「该商品已完成退款」

Case 2: 同一 OrderItem 有 CANCELED 的售后，再次提交
  → 断言：成功（CANCELED 不阻止重新申请）

Case 3: 同一 OrderItem 有 REJECTED（未仲裁）的售后，再次提交
  → 断言：成功

Case 4: 同一 OrderItem 有 REQUESTED 的售后，再次提交
  → 断言：400，「该商品已有进行中的售后申请」
```

---

## 十二、前端展示测试（手动）

### T-FE-01：买家 App

```
Check 1: 商品详情页
  - 可退商品显示小字「支持7天无理由退换」
  - 不可退商品显示小字「签收后24小时内如有质量问题可申请售后」
  - VIP 礼包显示小字「不支持退换」

Check 2: 结账页
  - U2（首次）弹出退换货协议
  - U1（已确认）不弹出

Check 3: 订单详情页
  - DELIVERED 状态显示「申请售后」按钮
  - RECEIVED 且在窗口内显示「申请售后」按钮
  - 超过窗口期不显示按钮
  - VIP 订单不显示按钮

Check 4: 售后申请表单
  - 不可退商品无「七天无理由」选项
  - 超过时限的选项不展示
  - 所有选项不可用时显示「已超过售后期限」

Check 5: 售后详情页
  - 各状态正确展示对应内容和操作按钮
  - 撤销按钮仅在 REQUESTED/UNDER_REVIEW 显示
  - REJECTED/SELLER_REJECTED_RETURN 显示仲裁按钮和客服占位
```

### T-FE-02：卖家后台

```
Check 1: 菜单显示「售后管理」（不再是分开的换货+退款）
Check 2: 列表页 Tab 筛选正常
Check 3: 售后类型标签正确（七天无理由/质量退货/质量换货）
Check 4: 操作按钮按状态正确显示/隐藏
Check 5: 验收不通过需填原因+照片+寄回单号
Check 6: 商品编辑页退货政策下拉正常
Check 7: OPERATOR 角色看不到审核按钮
```

### T-FE-03：管理后台

```
Check 1: 菜单显示「售后仲裁」（不再是分开的换货+退款仲裁）
Check 2: 统计面板按类型+状态分组
Check 3: 仲裁弹窗展示双方信息
Check 4: 分类管理页可设置退货政策
Check 5: 系统配置页有售后配置分区（7个参数）
Check 6: 商品列表显示退货政策（只读）
```

---

## 十三、回归测试清单

确保退换货改造不破坏现有功能：

```
REG-01: 正常下单流程（无售后）不受影响
REG-02: VIP 购买流程不受影响
REG-03: 订单取消 + 自动退款流程不受影响
REG-04: 现有自动确认收货 Cron 不受影响
REG-05: 结账过期 Cron 不受影响
REG-06: 分润奖励的第二层冻结/解冻机制不受影响
REG-07: 提现功能不受影响
REG-08: 平台红包发放/使用不受影响
REG-09: 卖家商品管理（增删改查）不受影响
REG-10: 管理员分类管理不受影响
REG-11: 审计日志正常记录
REG-12: 卖家面单生成/打印不受影响
```

---

## 十四、测试执行优先级

| 优先级 | 测试集 | 数量 | 说明 |
|--------|-------|------|------|
| P0-必须通过 | T-INT-01~08, T-INT-14~18, T-INT-19~22, T-INT-27~29 | 21 | 核心流程 + 奖励 + 并发 + 并行/仲裁约束 |
| P1-重要 | T-INT-09~13, T-INT-23~26, T-EDGE-01~04 | 13 | 仲裁 + 超时 + 撤销 + 关闭 + 边界 |
| P2-标准 | T-UNIT-01~04, T-API-01~03 | 7 | 单元测试 + API 校验 |
| P3-端到端 | T-E2E-01~06 | 6 | 全链路验证 |
| P4-前端+回归 | T-FE-01~03, REG-01~12 | 15 | 手动验证 |
| **合计** | | **63** | |
