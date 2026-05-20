# 消费积分双轨设计方案（提现 + 抵扣）

> **For agentic workers:** REQUIRED: Use this design as the authoritative source for the points/withdrawal/deduction system. Replaces and supersedes the old plan `docs/superpowers/plans/2026-05-17-alipay-realtime-withdrawal.md`.

## 1. 设计目标

把现有"分润奖励"系统升级为"消费积分双轨"系统：

1. **提现轨道**：用户可申请实时提现到支付宝账户，按法定 20% 代扣个人所得税
2. **抵扣轨道**：用户在结算订单时可使用消费积分抵扣订单金额（受比例约束）

两个轨道共享同一个余额池，用户在每次操作时自行选择走哪个轨道。

## 2. 核心架构决策

| 决策项 | 决议 |
|---|---|
| **用户端命名** | "消费积分"（避开"奖金/奖励/红包"字眼，对应税法的"消费券/抵用券"性质） |
| **数据模型** | 混合式：`RewardAccount.balance` 作为余额池 + `RewardLedger` 作为审计流水 |
| **双账户处理** | 数据库保留 `VIP_REWARD` / `NORMAL_REWARD` 两个独立账户（CLAUDE.md 现有决策），用户端合并显示一个总余额，内部 VIP 优先扣减 |
| **过期机制** | 永不过期 |
| **提现合规通道** | 平台代扣（默认 20%，可后台调） |
| **抵扣规则** | 用户可在 `[0, min(订单商品金额 × 比例, 余额)]` 范围内自由选择金额 |
| **可与平台红包叠加** | 是 |
| **历史数据** | 当前测试阶段无真实数据，直接清空 WithdrawRequest 起步 |

## 3. 法律合规依据

### 3.1 提现轨道：偶然所得代扣

依据：财政部 税务总局公告 2019 年第 74 号 + 个人所得税法第三条第六项。

- 平台向用户支付的分润奖金、推荐奖励等，按"偶然所得"项目计税
- 税率：20% 全额代扣（无起征点、无费用扣除）
- 平台义务：每笔代扣 + 月度/季度汇总向税务局申报

### 3.2 抵扣轨道：消费券性质豁免（存在空间，但非确定）

**法律依据**：财政部 税务总局公告 2019 年第 74 号

> "企业赠送的具有价格折扣或折让性质的消费券、代金券、抵用券、优惠券等礼品**除外**"

**关于本设计的适用性**：

本设计采用"同一余额池既能提现也能抵扣"的双轨模式。这与 74 号公告"除外"条款描述的"纯消费券"模型有差异 —— 纯消费券**仅可抵扣**、不可提现，而本设计的积分既可走偶然所得代扣的提现路径，也可走折让性质的抵扣路径。这种"混合性质"在税务实务中**存在被认定为偶然所得（须代扣）的可能性**，不能视为已经合规。

**为提高"抵扣部分按折让认定"成功率，必须做到**：
- 用户协议明示积分性质（消费抵扣 + 可提现两种用途，提现部分代扣 20%）
- 命名上使用"消费积分"（非"奖金/红包"）
- 单笔抵扣上限受订单金额比例约束（10% / 15%），强化"折让"语义
- 抵扣 ledger 与提现 ledger 在数据库分轨核算（同一 entryType=DEDUCT vs WITHDRAW），便于税务核查时清楚区分

**强制前置条件**：
- **上线前必须找税务师/财务师签字背书**本设计的合规性
- 如果税务师认定抵扣轨道也须按偶然所得代扣，需启动**降级方案**（见 3.3 节）

### 3.3 降级方案：拆双池（备选）

若税务师确认抵扣不能按折让豁免，本设计可降级为**拆双池模式**：

| 池 | 数据载体 | 用途 | 税务处理 |
|---|---|---|---|
| 可提现奖励余额 | 现 `RewardAccount` (VIP_REWARD/NORMAL_REWARD) | 仅可提现 | 偶然所得 20% 代扣 |
| 不可提现抵扣积分 | 新建账户类型或独立表 | 仅可抵扣 | 折让豁免 |

奖励发放时按规则拆分到两池（如 50%/50% 比例可配）。

**v1.0 默认走"单池双轨"**，spec 里所有设计基于此。如启动降级方案，需要：
- Schema 新增账户类型 `POINTS_DEDUCTION_ONLY`
- 利润分配引擎按比例分发到两个账户
- 用户端钱包页显示两个独立余额
- 估算多 1-2 周工作量

实施 plan 阶段保留"启动降级"的开关，便于上线前最后一刻切换。

## 4. 数据模型变更

### 4.1 `WithdrawRequest` 表扩展

```prisma
model WithdrawRequest {
  // 现有字段（保留语义）
  id               String          @id @default(cuid())
  userId           String
  user             User            @relation(fields: [userId], references: [id])
  amount           Float           // = grossAmount（申请金额，沿用旧字段名）
  channel          WithdrawChannel
  accountSnapshot  Json?           // 加密存 { account, name }，用 encryptJsonValue
  accountType      String          @default("VIP_REWARD")
  status           WithdrawStatus  @default(PROCESSING)
  providerPayoutId String?         // 支付宝 order_id
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  deletedAt        DateTime?

  // 新增字段
  taxAmount             Float    @default(0)    // 代扣金额（快照）
  netAmount             Float    @default(0)    // 实际到账 = amount - taxAmount - providerFeeAmount
  taxRate               Float    @default(0.20) // 代扣比例（快照，避免后续配置改影响历史记录）
  providerFeeAmount     Float    @default(0)    // 支付宝手续费（v1.0=0，预留字段）
  outBizNo              String?  @unique        // 商户单号 WD-{id}（预生成）
  clientIdempotencyKey  String?  @unique        // 客户端 UUID v4，防 App 重试重复提交
  providerFundOrderId   String?                 // 支付宝资金流水号
  providerStatus        String?                 // 支付宝侧最新状态
  providerErrorCode     String?
  providerErrorMessage  String?
  paidAt                DateTime?
  lastQueriedAt         DateTime?               // cron 上次查询时间
  queryAttempts         Int      @default(0)    // cron 查询累计次数

  // 历史兼容
  rejectReason     String?
  reviewerAdminId  String?
  reviewerAdmin    AdminUser? @relation(fields: [reviewerAdminId], references: [id])

  // 新增索引
  @@index([userId, status, createdAt])
  @@index([status, createdAt])
  @@index([providerFundOrderId])
  @@index([userId, createdAt])  // 年累计查询
}
```

**关键约定**：
- `amount` 字段语义 = "申请金额" = `grossAmount`，保留旧名节省迁移工作量
- `outBizNo = 'WD-' + id`：先 `cuid()` 生成 id，再拼 outBizNo 一起 insert，避免崩溃窗口
- `accountSnapshot` 用 `encryptJsonValue({account, name})` 加密存

### 4.2 枚举值新增

```prisma
enum WithdrawStatus {
  REQUESTED   // 旧字段保留（兼容）
  PROCESSING  // 新增：实时提现初始态
  APPROVED    // 旧保留
  REJECTED    // 旧保留
  PAID
  FAILED
}

enum RewardEntryType {
  FREEZE
  RELEASE
  WITHDRAW
  VOID
  ADJUST
  DEDUCT      // 新增：结算抵扣
}
```

### 4.3 `CheckoutSession` 表（语义调整 + 跨账户字段）

```prisma
// 现有字段（继续使用）
rewardId         String?   // 改语义：指向 reserveDeduction 创建的"主"DEDUCT ledger（VIP 那条优先）
discountAmount   Float     // 抵扣总金额（沿用语义）

// 新增字段
deductionGroupId String?   // 跨账户抵扣组 ID（用于关联 VIP + NORMAL 两条 ledger）
```

测试阶段无历史数据，旧 `rewardId` 字段语义直接换为指向 DEDUCT ledger，无风险。`deductionGroupId` 用于跨账户混扣场景（详见 4.5 节）。

### 4.4 RewardLedger 跨账户拆分约定

**关键决策**：跨账户抵扣/提现时，**写两条 ledger**（VIP 一条 + NORMAL 一条），而不是一条 ledger 内 meta 拆分。原因：

- `RewardLedger.accountId` 是单一字段（schema:1930），`sum(amount where accountId=X) = balance 变动` 是对账基础公式
- meta 里写拆分明细会让"按账户聚合"算不出真实变动，对账逻辑必须分叉

**拆分约定**：

```typescript
// 跨账户抵扣示例：用户用 ¥80 抵扣，VIP 出 ¥50，NORMAL 出 ¥30
// 写两条 ledger：

ledger_1 = {
  accountId: VIP_REWARD_account_id,
  amount: 50,
  entryType: 'DEDUCT',
  status: 'RESERVED',
  refType: 'CHECKOUT',
  refId: checkoutSession.id,
  meta: { 
    scheme: 'POINTS_DEDUCTION',
    groupId: 'DG-{uuid}',         // 跨账户组 ID
    role: 'PRIMARY',              // 主条目（rewardId 指向它）
    siblingLedgerId: ledger_2.id  // 关联另一条
  }
}

ledger_2 = {
  accountId: NORMAL_REWARD_account_id,
  amount: 30,
  entryType: 'DEDUCT',
  status: 'RESERVED',
  refType: 'CHECKOUT',
  refId: checkoutSession.id,
  meta: { 
    scheme: 'POINTS_DEDUCTION',
    groupId: 'DG-{uuid}',         // 同一组 ID
    role: 'SECONDARY',
    siblingLedgerId: ledger_1.id
  }
}

// CheckoutSession.rewardId = ledger_1.id（主，VIP 那条）
// CheckoutSession.deductionGroupId = 'DG-{uuid}'
```

同样适用于跨账户提现：WithdrawRequest 关联两条 ledger（同一 outBizNo 作为 refId）。`WithdrawRequest.accountType` 保留为"主账户类型"（VIP_REWARD），不再表示唯一来源。

**对账校验**：

```sql
-- 按账户聚合的 ledger 总额必须等于该账户的 balance/frozen 净变动
SELECT SUM(amount) FROM RewardLedger WHERE accountId = X AND ...
== RewardAccount.balance 历史净变动 (X)
```

跨账户拆分后此公式成立，单条 ledger + meta 拆分则不成立。

### 4.5 `RuleConfig` 新增 12 个 key

### 4.4 `RuleConfig` 新增 12 个 key

```typescript
// 提现规则（6 个）
WITHDRAW_TAX_RATE                 = 0.20      // 代扣个税比例
WITHDRAW_MIN_AMOUNT               = 10        // 单笔最低（元）
WITHDRAW_MAX_AMOUNT               = 10000     // 单笔最高（元）
WITHDRAW_DAILY_MAX_COUNT          = 3         // 每日最多次数
WITHDRAW_COOLDOWN_SECONDS         = 60        // 提现间冷却（秒）
WITHDRAW_YEARLY_MAX_AMOUNT        = 50000     // 单用户年累计上限（元）

// 抵扣规则（4 个）
DEDUCTION_RATIO_NORMAL            = 0.10      // 普通用户抵扣比例
DEDUCTION_RATIO_VIP               = 0.15      // VIP 用户抵扣比例
DEDUCTION_MIN_ORDER_AMOUNT        = 0         // 最低订单门槛（元）
DEDUCTION_ALLOW_COUPON_STACK      = true      // 是否允许与平台红包叠加

// 通道参数（1 个）
WITHDRAW_PROVIDER_FEE_AMOUNT      = 0         // 单笔通道手续费（元，v1.0=0）

// 监控参数（1 个）
WITHDRAW_YEARLY_ALERT_THRESHOLD   = 0.80      // 年累计达到上限 80% 时告警
```

存储格式：`{ value: <number/boolean>, description: "..." }`（沿用现有 RuleConfig pattern）。

## 5. 后端模块边界

```
backend/src/modules/bonus/
├─ bonus.service.ts                    ← 保留（管会员、钱包查询、树）
├─ bonus.controller.ts                 ← 微调路由
├─ withdraw-payout.service.ts          ← 新建（实时提现链路）
├─ reward-deduction.service.ts         ← 新建（结算抵扣链路）
├─ withdraw-rules.service.ts           ← 新建（从 RuleConfig 读参数）
└─ dto/
    ├─ withdraw.dto.ts                 ← 重写
    ├─ withdraw-rules.dto.ts           ← 新建（管理后台配置 DTO）
    └─ deduction.dto.ts                ← 新建

backend/src/modules/payment/
├─ payment.service.ts                  ← 扩展：加 initiateTransfer
├─ alipay.service.ts                   ← 扩展：加 transferToAccount + queryTransfer
└─ payment.controller.ts               ← 扩展：加 /alipay/transfer-notify 路由
```

## 6. 提现链路设计

### 6.1 API 规范

**路径**：`POST /bonus/withdraw`（沿用现有路由，body 改造）

```
POST /api/v1/bonus/withdraw
Headers: {
  Idempotency-Key: <client-uuid>   // 客户端生成的幂等键，必填
}
Body: {
  amount: number              // 申请金额（元，存数据库前先转 cents 校验）
  alipayAccount: string       // 支付宝账号（手机/邮箱/沙箱账号）
  alipayName: string          // 真实姓名
}
Response: {
  withdrawId: string
  grossAmount: number         // 100
  taxAmount: number           // 20
  taxRate: number             // 0.20
  netAmount: number           // 80
  status: 'PROCESSING' | 'PAID' | 'FAILED'
  message: string
}
```

**幂等设计**：
- App 提交前生成 `Idempotency-Key`（UUID v4）
- 后端 WithdrawRequest 加 `clientIdempotencyKey String? @unique` 字段
- 同一 key 重复提交：返回已存在的 WithdrawRequest 结果（不创建新提现）
- key 不存在时正常创建
- 防 App 网络抖动重试导致重复打款

**v1.0 不做二次验证**：

v1.0 提现不要求短信验证码、支付密码等二次验证。资金防护依赖以下多层机制：

| 机制 | 作用 |
|---|---|
| Idempotency-Key | 防 App 重试导致重复扣款 |
| 单笔最低 ¥10 / 最高 ¥10000 | 限制单次损失上限 |
| 每日 3 次 + 冷却 60s | 限制套现速度 |
| 年累计 ¥50000 | 限制单一账户总暴露面 |
| 代扣 20% | 套现成本天然提高 |
| 反洗钱告警（达 80% 阈值 Inbox） | 异常行为人工兜底 |

用户协议必须声明："提现风险防护依赖账号登录状态，请妥善保管登录密码 / 不要在不安全网络登录"，把账号安全责任边界划清。

v1.1+ 出现实际攻击案例后，可以加支付密码（独立于登录密码，参考支付宝/微信模式）。

**金额精度约定**：
- 所有金额计算**全程 cents（整数分）**：`cents = Math.round(yuan * 100)`
- 入参 `amount` 校验：`Math.round(amount * 100) ≥ Math.round(MIN_AMOUNT * 100)` 等
- taxAmount 计算：`taxCents = Math.floor(grossCents * taxRate)` （向下取整保护用户实到）
- netCents = grossCents - taxCents - providerFeeCents
- balance/frozen 扣减、跨账户拆分、退款返还、年累计求和：**全部转 cents 后计算**，最后存 DB 时再 `/100` 转回元
- Float 仅用于 DB schema 字段类型，业务逻辑层不直接 Float 比较

### 6.2 主流程

```
Phase 1: 校验 + 冻结（Serializable 事务内）
  1. WithdrawRulesService.getRules() → 取所有限额参数
  2. 幂等键查询：clientIdempotencyKey 存在则返回已有结果
  3. 事务内：
     a. 重新读 RewardAccount 余额（VIP + NORMAL）
     b. 校验：
        - amount 在 [MIN, MAX] 范围内
        - 余额够（VIP + NORMAL 合计）
        - 今日次数 < DAILY_MAX
        - 离上次提现 > COOLDOWN_SECONDS
        - 年累计 + amount ≤ YEARLY_MAX
     c. 计算 taxAmount = amount × taxRate, netAmount = amount - taxAmount
     d. 余额扣减（VIP 优先）：
        VIP 够 amount → 全从 VIP 扣
        否则 VIP 扣完 + NORMAL 补差
        （balance -= ?, frozen += ?）
     e. 预生成 cuid，拼 outBizNo = 'WD-' + id
     f. 创建 WithdrawRequest { status: 'PROCESSING', ... }
     g. 创建 RewardLedger { entryType: WITHDRAW, status: FROZEN }
  4. 事务提交

Phase 2: 调支付宝（事务外）
  5. PaymentService.initiateTransfer({
       channel: 'ALIPAY',
       amount: netAmount,        // 注意：传 net，不是 gross
       outBizNo,
       payeeAccount,
       payeeName,
     })
  6. 按 Alipay 结果 finalize：
     - SUCCESS → finalizePaid (CAS: PROCESSING → PAID)
     - 确定失败 → finalizeFailed (CAS: PROCESSING → FAILED)，退还余额
     - 不确定/超时 → 保留 PROCESSING，cron/notify 补偿
```

### 6.3 finalize 实现要点

**finalizePaid**：
```typescript
async finalizeWithdrawalPaid(withdrawId, providerResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // CAS: PROCESSING → PAID
    const updated = await tx.withdrawRequest.updateMany({
      where: { id: withdrawId, status: 'PROCESSING' },
      data: {
        status: 'PAID',
        providerPayoutId: providerResult.orderId,
        providerFundOrderId: providerResult.payFundOrderId,
        paidAt: new Date(),
      }
    });
    if (updated.count === 0) return;  // 幂等：已 finalize

    const withdraw = await tx.withdrawRequest.findUnique({ where: { id: withdrawId } });
    
    // frozen 释放（按当时记的 fromVip/fromNormal）
    // ...

    // ledger: FROZEN → WITHDRAWN
    await tx.rewardLedger.updateMany({
      where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' },
      data: { status: 'WITHDRAWN' }
    });

    // 累计平台代扣账：v1.0 不单独维护"待解缴税款"账户表，
    // 通过聚合查询 `SUM(taxAmount) WHERE status=PAID AND createdAt 在 X 月内` 算出来即可。
    // 管理后台税务报送页直接查这个聚合。v1.1 如果需要更复杂的代扣账目（如已解缴/未解缴拆分），
    // 再新增 PlatformTaxAccrual 表。
  }, { isolationLevel: 'Serializable' });
  
  // 推送 Inbox 消息
}
```

**finalizeFailed**：CAS PROCESSING→FAILED + balance 回滚（frozen → balance）+ ledger VOIDED。

### 6.4 Notify 补偿

```
POST /api/v1/payments/alipay/transfer-notify
@Public + WebhookIpGuard

1. AlipayService.verifyNotify(body) 验签 → 失败返 'failure'
2. body.msg_method !== 'alipay.fund.trans.order.changed' → 返 'success' 忽略
3. JSON.parse(body.biz_content) → 解析
4. 按 out_biz_no 查 WithdrawRequest
5. 当前状态：
   - PROCESSING + 通知 SUCCESS → finalizePaid
   - PROCESSING + 通知 FAIL → finalizeFailed
   - 已 PAID/FAILED → 返 'success'（幂等）
6. 返 'success'
```

### 6.5 Cron 补偿

`@Cron(CronExpression.EVERY_10_MINUTES)` + Redis 锁：

```
1. 获取 Redis 锁（防多实例并发）
2. 扫 WithdrawRequest WHERE status='PROCESSING' AND createdAt < now-5min
3. 对每条记录：
   a. lastQueriedAt 更新
   b. queryAttempts++
   c. 调 AlipayService.queryTransfer({ outBizNo })
   d. SUCCESS → finalizePaid
   e. FAIL → finalizeFailed
   f. PROCESSING → 保留，等下次
   g. queryAttempts > 10 → 强制 finalizeFailed + 退款（NOT_FOUND 容错）
```

### 6.6 反洗钱告警

提现完成后立即检查：
```typescript
const yearTotal = await sumYearlyWithdraw(userId);
const threshold = rules.yearlyMaxAmount * rules.yearlyAlertThreshold;

if (yearTotal >= threshold && yearTotal < rules.yearlyMaxAmount) {
  // 发管理员 Inbox 告警
  await inboxService.sendToAllAdmins({
    category: 'risk',
    title: '高额提现告警',
    content: `用户 ${userId} 年累计提现 ¥${yearTotal}，已达上限 ${(yearTotal/rules.yearlyMaxAmount*100).toFixed(1)}%`,
  });
}
```

## 7. 抵扣链路设计

### 7.1 API 规范

**复用现有路由**，不新建。

**A. 结算预览（扩展现有 `POST /orders/preview`）**

```
POST /api/v1/orders/preview
Body: {
  items: [...],
  couponInstanceIds: [...]   // 现有字段
  // 不需要传 deductionAmount，预览只算"最多能扣多少"
}
Response: {
  totalGoodsAmount: 200,        // 现有字段
  totalShippingFee: 10,
  vipDiscountAmount: 0,
  
  // 新增字段
  pointsBalance: 100,           // 用户消费积分余额（VIP + NORMAL 合计）
  pointsRatio: 0.10,            // 当前抵扣比例（VIP=0.15 / 普通=0.10）
  maxDeductible: 20,            // min(200 × 0.10, 100) = 20
  
  expectedTotal: 210            // 默认不扣积分时的应付金额
}
```

**B. 提交结算（扩展现有 `POST /orders/checkout`）**

```
POST /api/v1/orders/checkout
Body: {
  items: [...],                 // 现有
  couponInstanceIds: [...],     // 现有
  paymentChannel: 'ALIPAY',     // 现有
  expectedTotal: 192,           // 现有，前端预算的应付金额
  idempotencyKey: '...',        // 现有
  
  // 新增字段
  deductionAmount: 18           // 用户在 [0, maxDeductible] 输入；0 表示不抵扣
  
  // 废弃字段：dto.rewardId 不再使用（旧 ledger 整张式）
}
```

**Controller 改造**：`backend/src/modules/order/order.controller.ts` 已有 `@Post('preview')` (line 95) 和 `@Post('checkout')` (line 25)，**只需扩展 DTO 字段 + Service 内调用 RewardDeductionService**，不新加路由。

### 7.2 RewardDeductionService 方法

```typescript
class RewardDeductionService {
  calculateMaxDeductible(userId, goodsAmount): Promise<{
    pointsBalance: number;
    pointsRatio: number;
    maxDeductible: number;
  }>;
  
  reserveDeduction(tx, userId, goodsAmount, requestedAmount): Promise<{
    ledgerId: string;
    deductedFromVip: number;
    deductedFromNormal: number;
  }>;
  
  confirmDeduction(tx, ledgerId): Promise<void>;
  releaseDeduction(tx, ledgerId): Promise<void>;
  refundDeduction(tx, orderId, refundAmount, originalOrderAmount): Promise<void>;
}
```

### 7.3 状态机

**跟现有奖励抵扣终态保持一致**（checkout.service.ts:1641-1644 现有逻辑就是 RESERVED → VOIDED）：

```
RewardLedger entryType=DEDUCT:
  (新建)   → RESERVED   （checkout 创建时；写一条/两条 ledger，见 4.4 节）
  RESERVED → VOIDED     （支付成功，confirmDeduction；表示"已消费抵扣"）
  RESERVED → AVAILABLE  （支付失败/取消，releaseDeduction）

注意：
- 释放时不改 entryType（保留 DEDUCT，便于审计追溯"曾经被抵扣预留过"）
- VOIDED 终态跟现有平台红包/奖励抵扣的终态完全一致，
  reconciliation 逻辑无需为新模型单独分支

RewardAccount.balance / frozen:
  reserveDeduction：balance -= X, frozen += X
  confirmDeduction：frozen -= X（balance 不变，已扣过）
  releaseDeduction：frozen -= X, balance += X
```

跨账户场景下，两条 ledger 同步状态变化（用 refId/groupId 关联，确保 confirm/release 时一起转）。

### 7.4 跨账户扣减算法

VIP 优先（与提现保持一致）：

```typescript
async deductBalanceForDeduction(tx, userId, amount) {
  const vipBalance = ...;
  const normalBalance = ...;
  
  let fromVip, fromNormal;
  if (vipBalance >= amount) {
    fromVip = amount;
    fromNormal = 0;
  } else {
    fromVip = vipBalance;
    fromNormal = amount - vipBalance;
  }
  
  // CAS 扣减
  // ... (同提现链路 deductBalanceForWithdraw)
  
  return { fromVip, fromNormal };
}
```

### 7.5 改造 CheckoutService

```diff
- // 现有：按 ledger 整张式 + 5x 最低订单
- if (dto.rewardId) {
-   const ledger = await ...;
-   const minOrderAmount = ledger.amount >= 10 ? ledger.amount * 5 : 0;
-   if (totalGoodsAmount < minOrderAmount) throw ...;
-   discountAmount = ledger.amount;
- }

+ // 新模型：按余额比例式
+ if (dto.deductionAmount > 0) {
+   const result = await this.rewardDeductionService.reserveDeduction(
+     tx, userId, totalGoodsAmount, dto.deductionAmount
+   );
+   discountAmount = dto.deductionAmount;
+   reservedRewardId = result.ledgerId;
+ }
```

### 7.6 改造 PaymentService

支付成功（`handlePaymentCallback`）：
```diff
+ if (session.rewardId) {
+   await this.rewardDeductionService.confirmDeduction(tx, session.rewardId);
+ }
```

支付失败 / cancelSession：
```diff
+ if (session.rewardId) {
+   await this.rewardDeductionService.releaseDeduction(tx, session.rewardId);
+ }
```

### 7.7 跨商户分摊（不变）

现有 `allocateDiscountByCapacities` 函数按商户分摊已实现。新模型仍传 `deductionAmount` 给它，无需改动。

## 8. 退款链路

### 8.1 规则

- 全单退款 + 部分退款都走"原路返回 + 按比例分摊"
- 现金部分原路退到支付宝
- 抵扣部分按比例返还到 `RewardAccount.balance`
- 部分退款最后一次时，剩余抵扣金一次性清零（避免 0.01 误差累计）
- 退款返还操作必须以 `refundId` 幂等

### 8.2 计算公式

**关键**：返还比例的分子分母用**商品原价金额**，**不是**实际现金退款金额。

```
原订单：商品 ¥200 用了 ¥18 积分抵扣，实付 ¥182
部分退款：买家退商品原价 ¥80 的 SKU

正确公式（按商品原价比例）：
  refundRatio = 80 / 200 = 0.40
  现金退款额 = 80 × (182/200) = ¥72.80 （由 AfterSaleService 算好后传给支付宝）
  积分返还额 = 18 × 0.40 = ¥7.20（回到 balance）

错误公式（按现金退款比例）：
  ❌ refundRatio = 72.80 / 200 = 0.364
  ❌ 积分返还额 = 18 × 0.364 = ¥6.55（少返 ¥0.65）

→ 入参必须传 originalGoodsRefundAmount（商品原价的退款金额），不是 refund 现金额
```

**cents 化计算**：

```typescript
const originalGoodsCents   = Math.round(originalGoodsAmount * 100);  // 20000
const goodsRefundCents     = Math.round(originalGoodsRefundAmount * 100);  // 8000
const originalDeductCents  = Math.round(originalDeductAmount * 100); // 1800

const refundDeductCents = Math.round(
  originalDeductCents * goodsRefundCents / originalGoodsCents
);  // 720

// 最后一次部分退款时，剩余抵扣金一次性清零
const alreadyRefundedDeductCents = ... // 已累计返还
const remainingDeductCents = originalDeductCents - alreadyRefundedDeductCents;
const isFinalRefund = (originalGoodsCents - alreadyRefundedGoodsCents === goodsRefundCents);
const finalRefundDeductCents = isFinalRefund 
  ? remainingDeductCents   // 清零，避免 0.01 累计误差
  : refundDeductCents;
```

### 8.3 实现入口

`AfterSaleRefundService.handleRefundSuccess` 内增加：

```typescript
// 1. 幂等校验：refundId 已处理过抵扣返还的，跳过
const alreadyRestored = await tx.rewardLedger.findFirst({
  where: { 
    refType: 'REFUND_RESTORE', 
    refId: refundId,  // 用 refundId 而非 orderId（部分退款可多次）
    deletedAt: null,
  }
});
if (alreadyRestored) return;

// 2. 通过 order → checkoutSession 找到原抵扣信息
const order = await tx.order.findUnique({ 
  where: { id: request.orderId },
  select: { checkoutSessionId: true }
});
if (!order?.checkoutSessionId) return;

const session = await tx.checkoutSession.findUnique({
  where: { id: order.checkoutSessionId },
  select: { 
    rewardId: true,            // 主 ledger（VIP 那条）
    deductionGroupId: true,    // 跨账户组 ID（如有）
    discountAmount: true, 
    goodsAmount: true 
  }
});
if (!session?.rewardId || session.discountAmount === 0) return;

// 3. 算商品原价的退款金额（不是实际现金退款金额）
// AfterSaleRequest 应该有原价字段；如果没有，从 OrderItem snapshot 累加
const originalGoodsRefundAmount = computeOriginalGoodsRefundAmount(request);

// 4. 调 refundDeduction
await this.rewardDeductionService.refundDeduction(tx, {
  refundId,
  orderId: request.orderId,
  originalGoodsAmount: session.goodsAmount,
  originalGoodsRefundAmount,
  originalDeductAmount: session.discountAmount,
  deductionGroupId: session.deductionGroupId,
});
```

`refundDeduction` 内部职责：
- 算 refundDeductCents（按商品原价比例）
- 找出原抵扣 ledger（含跨账户的两条），按各账户原扣减比例计算返还到对应账户的金额
- **每个被增加 balance 的账户单独写一条 ADJUST ledger**：`entryType=ADJUST, refType='REFUND_RESTORE', refId=refundId, status=AVAILABLE`
- 跨账户场景示例：原扣 VIP=10、NORMAL=8 → 部分退款比例 0.5 → VIP 返 5 写 ledger 给 VIP 账户、NORMAL 返 4 写 ledger 给 NORMAL 账户。**禁止只写一条 primary 账户 ledger 然后给两个账户加 balance**（会让 `sum(ledger.amount where accountId=X) == balance 变动` 对账公式破裂）
- 两条 REFUND_RESTORE ledger 用同一个 `meta.groupId = 原 DEDUCT 的 groupId` 关联，便于对账反查

## 9. 买家 App 改造

### 9.1 钱包页 `app/me/wallet.tsx`

- 标题"奖励钱包" → "消费积分"
- 标签"可用余额" → "可用积分"
- 标签"待解锁" → "冻结积分"
- 标签"累计收益" → "累计获得"
- 余额卡加副标题"用于平台商品抵扣 / 可提现至支付宝"
- 流水新增"消费抵扣 -¥18 关联订单 #xxxx"和"退款返还 +¥7.20"显示
- 新增筛选 Tab "消费抵扣"

### 9.2 提现页 `app/me/withdraw.tsx`

完全重写：
- 可用积分展示
- 提现金额输入（带快捷按钮 10/50/100/全部）
- 支付宝账号输入
- 真实姓名输入
- 实时显示：申请金额、代扣个税(20%)、实际到账
- 提交按钮（点击前生成 Idempotency-Key，作为 header 发送）
- 底部提现说明（限额、规则、支付宝服务费提示、账号安全责任声明）

**v1.0 不加短信验证、不加支付密码**。资金防护依赖账号登录态 + 多层后端限制（详见 spec 6.1）。

### 9.3 结算页

新增"消费积分"区块：
- 显示可抵扣 ¥X.XX（最多）
- 数字输入框（0 ~ 最大值）
- 实时刷新应付金额

### 9.4 Repository / Types

```typescript
// src/repos/BonusRepo.ts
requestWithdraw(input: WithdrawRequestInput): Promise<WithdrawResult>;
getDeductionPreview(goodsAmount: number): Promise<DeductionPreview>;

// src/repos/OrderRepo.ts（实际文件名，**不是** CheckoutRepo.ts）
createCheckout(input: {..., deductionAmount?: number}): Promise<...>;
preview(input: {...}): Promise<OrderPreviewResponse>;  // 返回新增 pointsBalance/pointsRatio/maxDeductible

// src/types/domain/Bonus.ts
export interface WithdrawRequestInput {
  amount: number;
  alipayAccount: string;
  alipayName: string;
  // v1.0 不带 smsCode / smsVerifyToken（spec 6.1 已记载）
}
export interface WithdrawResult { ... }
export interface DeductionPreview { ... }
```

## 10. 管理后台改造

### 10.1 提现记录页 `admin/src/pages/bonus/withdrawals.tsx`

新增列：申请金额 / 代扣个税 / 实际到账 / 商户单号 / 支付宝订单号 / 资金流水号 / 失败码 / 到账时间。

状态标签新增 PROCESSING（蓝色 processing）。

操作列：
- REQUESTED 老数据：保留"批准/拒绝"（兼容历史）
- PROCESSING 新数据：加"查询状态"按钮（手动触发 cron 查询）
- PAID/FAILED：仅查看

### 10.2 新建：规则配置页 `admin/src/pages/bonus/withdraw-rules.tsx`

12 个 RuleConfig key 全部列出，分三组：
- 提现参数（6 个）
- 抵扣参数（4 个）
- 通道参数（1 个）
- 监控参数（1 个）

API：
- `GET /admin/bonus/withdraw-rules`
- `PUT /admin/bonus/withdraw-rules` （带 AuditLog）

### 10.3 新建：税务报送页 `admin/src/pages/bonus/tax-reporting.tsx`

月度汇总：
- 本月提现笔数
- 本月提现总额
- 本月代扣总额
- 本月实际到账

操作：
- 导出明细 CSV（供向税务局报送）
- 生成代扣凭证

### 10.4 反洗钱告警

通过现有 Inbox 机制，cron 检查后发管理员消息。Admin 后台增加"高额提现监控" Tab 查看历史告警。

## 11. 卖家后台

**0 改动**。卖家不感知用户积分体系，订单流水里看到的是"商品金额 + 平台扣减"，跟当前一致。

## 12. 全部参数清单

12 个 RuleConfig key，全部带 description，管理后台统一配置页编辑。

| Key | 默认值 | 说明 |
|---|---|---|
| `WITHDRAW_TAX_RATE` | 0.20 | 代扣个税比例 |
| `WITHDRAW_MIN_AMOUNT` | 10 | 单笔最低（元） |
| `WITHDRAW_MAX_AMOUNT` | 10000 | 单笔最高（元） |
| `WITHDRAW_DAILY_MAX_COUNT` | 3 | 每日最多次数 |
| `WITHDRAW_COOLDOWN_SECONDS` | 60 | 提现间冷却（秒） |
| `WITHDRAW_YEARLY_MAX_AMOUNT` | 50000 | 单用户年累计上限（元） |
| `DEDUCTION_RATIO_NORMAL` | 0.10 | 普通用户抵扣比例 |
| `DEDUCTION_RATIO_VIP` | 0.15 | VIP 用户抵扣比例 |
| `DEDUCTION_MIN_ORDER_AMOUNT` | 0 | 最低订单门槛（元） |
| `DEDUCTION_ALLOW_COUPON_STACK` | true | 是否允许与平台红包叠加 |
| `WITHDRAW_PROVIDER_FEE_AMOUNT` | 0 | 单笔通道手续费（元，v1.0=0） |
| `WITHDRAW_YEARLY_ALERT_THRESHOLD` | 0.80 | 年累计达到上限百分之多少时告警 |

## 13. 测试覆盖

### 13.1 单元测试

| Service | 关键测试用例 |
|---|---|
| `WithdrawRulesService` | 默认值返回 / RuleConfig 写入 / 校验非法值 |
| `WithdrawPayoutService` | 余额不足拒绝 / 日次数限制 / 冷却 / 年累计 / VIP+NORMAL 跨账户扣减 / outBizNo 预生成 / SUCCESS finalize / FAILED finalize / 不确定保持 PROCESSING / 重复 notify 幂等 |
| `RewardDeductionService` | calculateMaxDeductible 边界 / reserveDeduction CAS / confirmDeduction / releaseDeduction / refundDeduction 按比例 / 跨账户扣减 |
| `AlipayService.transferToAccount` | API 入参映射 / SUCCESS 解析 / 业务失败解析 / 系统错误判定 processing / 签名验证 |
| `AlipayService.queryTransfer` | 查询入参 / 各状态映射 / NOT_FOUND 判定 |

### 13.2 集成测试

| 场景 | 验证点 |
|---|---|
| 完整提现：申请→Alipay 成功→PAID | 余额扣减、状态流转、个税额累计 |
| 提现 Alipay 失败 → 余额回滚 | balance 恢复，ledger VOIDED |
| 提现不确定 → cron 补偿 → PAID | cron 重试逻辑，queryAttempts |
| 完整结算抵扣：选积分→支付→confirm | balance 扣减，ledger DEDUCT→WITHDRAWN |
| 结算取消 → 抵扣释放 | balance 恢复，ledger AVAILABLE |
| 部分退款 → 抵扣金按比例返还 | balance 增加 X%，refund 退现金 1-X% |
| 全单退款 → 抵扣金 100% 返还 | balance 完全恢复 |

### 13.3 并发测试

| 场景 | 验证点 |
|---|---|
| 同一用户并发提交两笔提现 | Serializable 让一笔成功一笔失败 |
| 同一笔抵扣 ledger 并发 confirm + release | CAS 让一个成功 |
| Notify 和 cron 同时尝试 finalize | CAS 防止双重计入 |
| 同一笔提现重复 notify | finalize 幂等 |

### 13.4 边界测试

| 场景 | 验证点 |
|---|---|
| amount = 9.99 < MIN | 拒绝 |
| amount = 10000.01 > MAX | 拒绝 |
| 跨账户：VIP 50 + NORMAL 50，提现 80 | VIP 扣 50 + NORMAL 扣 30，写 2 条 ledger，groupId 关联 |
| 抵扣金额 = maxDeductible 边界 | 通过 |
| 抵扣金额 > maxDeductible | 拒绝 |
| 抵扣金额 = 0 | 通过（不创建 ledger） |
| Float 精度：100 - 99.99 == 0.01 | 不出错，业务层走 cents |
| 单年第 N+1 笔提现达到上限 | 拒绝 |
| 多次部分退款累计误差 | 最后一次清零，无 0.01 漂移 |
| 跨账户两条 ledger 一致性 | 一条 confirm 失败时另一条事务回滚 |
| Idempotency-Key 重复提交 | 返回首次结果，不创建新 WithdrawRequest |
| 重复 refundId 触发 refundDeduction | 第二次直接 return，不重复返还 |

### 13.5 对账核查测试

| 场景 | 验证点 |
|---|---|
| `SUM(ledger.amount WHERE accountId=X) == RewardAccount.balance/frozen 历史净变动` | 跨账户拆分后此公式成立 |
| 提现 PAID 后 SUM(taxAmount) | 等于平台代扣账户应记金额 |
| 全周期：用户充值 → 抵扣 → 退款返还 → 提现 | 余额最终一致，无悬挂状态 |

## 14. 上线 Checklist

### 14.1 上线前准备

- [ ] 阿里云/支付宝企业账号注册并通过实名（注册需满 90 天）
- [ ] 申请签约 alipay.fund.trans.uni.transfer 产品（1 个工作日）
- [ ] 企业支付宝余额充值（够前 1 个月预估提现量）
- [ ] 配置 .env：
  - `ALIPAY_TRANSFER_NOTIFY_URL=https://api.ai-maimai.com/api/v1/payments/alipay/transfer-notify`
  - `ALIPAY_GATEWAY=https://openapi.alipaydev.com/gateway.do`（沙箱）或正式地址
- [ ] Nginx 配置 `/payments/alipay/transfer-notify` 路由
- [ ] Redis 可用（cron lock 必需）
- [ ] 数据库迁移：`prisma migrate deploy`
- [ ] Seed RuleConfig 12 个 key 默认值
- [ ] 找税务师/会计师签字背书"消费积分 + 提现按偶然所得 20% 代扣"的合规方案
- [ ] 用户协议加"账号安全责任"条款（v1.0 无二次验证 → 用户对登录态安全负责）

### 14.2 沙箱端到端验证

- [ ] 沙箱账号提现成功路径
- [ ] 沙箱错误账号提现失败 → 余额回滚
- [ ] 沙箱系统错误 → PROCESSING 保留 → cron 兜底 PAID
- [ ] 短信验证码错误 → 拒绝
- [ ] 余额不足 → 拒绝
- [ ] 日次数超限 → 拒绝
- [ ] 冷却时间内 → 拒绝
- [ ] 年累计接近上限 → 告警 Inbox
- [ ] 抵扣金结算 → confirm → 余额扣减
- [ ] 抵扣金支付失败 → release → 余额恢复
- [ ] 抵扣金退款 → 按比例返还

### 14.3 生产正式上线

- [ ] 切换 ALIPAY_GATEWAY 到正式环境
- [ ] 平台代扣账本初始化（确保平台账户余额够首批提现）
- [ ] App OTA 推送 v1.1 版本（新提现页）
- [ ] Admin 后台部署到 admin.ai-maimai.com
- [ ] Grafana 加面板"提现成功率/失败率/PROCESSING 滞留量"
- [ ] 客服 SOP：处理提现失败用户工单
- [ ] 用户协议更新：消费积分性质 + 代扣 20% 声明
- [ ] App 钱包页公告：v1.1 提现说明

## 15. 风险点与 Mitigation

| 风险 | 影响 | Mitigation |
|---|---|---|
| **抵扣轨道法律解释存疑** | 抵扣可能被税务局认定为偶然所得，平台须代扣 20% | 上线前**必须**找税务师签字背书；备 3.3 节"拆双池"降级方案 |
| 提现轨道个税分类未确认 | 法律责任 | 上线前必须找税务师签字背书 |
| App 重试导致重复提现 | 用户多扣余额 | Idempotency-Key 必填，WithdrawRequest 加 @unique 字段 |
| Float 精度导致金额偏差 | 多笔累计后用户余额漂移 | 业务计算全程 cents，DB 字段虽为 Float 但读写都过 cents helper |
| 跨账户混扣对账不一致 | `SUM(ledger) ≠ balance 变动` | 跨账户拆分写两条 ledger，公式天然成立 |
| 部分退款累计 0.01 误差 | 最后一笔余额漂移 | 最后一次返还时一次性清零剩余抵扣金 |
| 退款入参用错（refundAmount vs 商品原价） | 少返抵扣金，用户投诉 | refundDeduction 严格要求"商品原价退款金额"入参 |
| Alipay 沙箱跟生产差异 | 上线后才发现问题 | 沙箱跑完整 E2E + 找内部用户真实小额提现验证 |
| outBizNo 极端低概率冲突 | 提现重复打款 | `@unique` 约束 + Alipay 侧也按 outBizNo 幂等 |
| 平台支付宝余额不足 | 提现卡住 | cron 监控余额，低于阈值告警 |
| 同一身份证多账号套现 | 反洗钱风险 | 年累计 ¥50000 限制 + 异常行为告警 |
| 用户填错支付宝账号 | 钱打到陌生人 | 短信验证 + 提现页文案强提示 + 用户协议条款免责 |
| 个税代扣账户挤兑 | 平台需垫付 | 监控待解缴税款月度增长，财务月底前必解缴 |

## 16. v1.1+ 后续增强（不在本次范围）

- 个税自动报送税务局 API（电子税务局接入）
- 多渠道提现（微信支付、银行卡直转）
- 灵活用工平台对接（降低税务负担）
- 提现到账 push 通知
- 抵扣金过期机制（如果业务上决定要加）
- 跨用户分账户（如"专属团队池"等高级场景）
