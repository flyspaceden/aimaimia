# 团长优惠后利润分成 V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按优惠后商品利润统一 VIP、普通用户和团长的分润基数，建立支付快照、平台留存资金占用、利润型团长月结和后台跨配置硬校验，交付可审计且不会重复创造资金的完整链路。

**Architecture:** 支付建单事务为每个商户订单创建不可变 `OrderProfitSnapshot`，所有后续直推、树奖励、产业基金、团长逐单和月奖只读取该快照。配置和商品写入统一经过 `ProfitSafetyService` 的 Serializable 事务及 PostgreSQL advisory lock；订单运行时不动态裁剪比例，只在数据不完整或守恒失败时关闭奖励并进入对账。团长关系仍为独立一层直接关系，资金从 VIP/普通路径的实际平台留存中占用。

**Tech Stack:** NestJS + Prisma + PostgreSQL + Jest；React 19 + Ant Design 5 + TypeScript；React Native 0.81 + Expo 54。

## Global Constraints

- `D = max(0, 商品原价合计 - 商品成本合计 - VIP折扣 - 平台红包 - 消费积分抵扣 - 商品级优惠及其他商品抵扣)`。
- 公式中的“商品原价合计”取 CheckoutSession 在订单级 VIP/红包/积分抵扣前的 `goodsAmount`，不含买家支付运费；订单项 `unitPrice` 已包含的商品促销视为已经降低商品金额，不再重复扣减。
- 统一积分钱包实际使用的团购返还余额属于消费积分抵扣，但数据库仍单独保存 `groupBuyRebateDeductionAmount` 便于审计。
- 商品项 `unitPrice` 已经包含的商品促销不得再次作为 `otherGoodsDiscountAmount` 重复扣减；只有订单字段明确记录的额外商品抵扣才进入该字段。
- 冷链履约成本、风险预留和目标平台净利不进入单笔订单 `D`；它们只参与后台标准单位经济安全校验。
- `D <= 0` 时订单正常支付和履约，但 VIP/普通直推、树奖励、产业基金及全部团长奖励均为 0。
- 团长月度资格 GMV 使用团长适用商品的优惠后实际净 GMV；零利润订单可以贡献其实际净 GMV，但该订单 `C=0`，不贡献任何逐单或月度奖励金额。
- 一个订单只选择一条买家路径（VIP 或普通）；直接推荐率由直接推荐人付款时身份决定；团长路径独立叠加但只允许一层直接客户。
- 团长不允许绑定自己；不得恢复二级团长、间接订单佣金或团队向上计酬。
- 平台占比、慈善、科技、备用金和无有效推荐人时的直推份额均作为平台留存；产业基金、树奖励和有效直推奖励属于外部资金。
- 团长逐单金额加月度最高预留必须小于等于本单平台留存；不允许把团长作为七分之外没有来源的第八份额。
- 金额字段继续遵循项目现状保存 Float/元，但所有计算、分摊和比较必须先转整数分；末分使用 `OrderItem.id` 稳定排序的最大余数法。
- 配置保存失败必须拒绝整笔写入，不自动调整管理员比例；订单支付和确认收货不得执行动态比例缩减。
- 支付时成本缺失、成本非正数或金额守恒失败不阻断支付；快照写 `RECONCILIATION_REQUIRED`，奖励失败关闭，补齐成本后才允许幂等重算。
- 所有金额、奖励、退款、配置并发写入使用 Serializable；配置/SKU安全写入还必须获取 `pg_advisory_xact_lock(hashtext('profit-safety-config-v1'))`。
- V2 销售额配置不得静默解释为利润比例；新 V3 首次生效从自然月第一天开始，历史 V2 只完成冻结、释放、退款和旧月结。
- 只有首次 V2→V3 使用未来自然月 `effectiveFrom`；V3 后续配置保存成功后立即作用于之后支付的新订单，不支持未来定时配置，旧订单继续使用自己的支付快照。
- 部署前已经支付且没有 `OrderProfitSnapshot` 的订单继续使用原规则完成收货和退款，不使用当前成本猜测回填；只有部署后支付的新订单进入利润快照链路。
- 不修改 VIP 树、普通树、VIP 邀请码、普通分享码和团长码之间已经确定的关系语义。
- 每个前端任务完成后同步 `docs/architecture/frontend.md` 或 `docs/architecture/admin-frontend.md`，最终同步 `docs/issues/tofix-safe.md` 与 `plan.md`。

---

## File Map

### Profit Core And Persistence

- Create: `backend/src/modules/profit/profit.types.ts`
- Create: `backend/src/modules/profit/money-allocation.ts`
- Create: `backend/src/modules/profit/order-profit-snapshot-calculator.ts`
- Create: `backend/src/modules/profit/order-profit-snapshot.service.ts`
- Create: `backend/src/modules/profit/profit-safety-validator.ts`
- Create: `backend/src/modules/profit/profit-safety.service.ts`
- Create: `backend/src/modules/profit/order-profit-refund.service.ts`
- Create: `backend/src/modules/profit/profit.module.ts`
- Create focused Jest specifications beside each service.
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710030000_captain_profit_v3/migration.sql`

### Payment, Rewards And Captain

- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- Modify: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts`
- Modify: `backend/src/modules/captain/captain.types.ts`
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Modify: `backend/src/modules/captain/captain-config.service.ts`
- Modify: `backend/src/modules/captain/captain-attribution.service.ts`
- Modify: `backend/src/modules/captain/captain-commission.service.ts`
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-reward.service.ts`

### Safe Configuration And Product Writes

- Modify: `backend/src/modules/admin/config/admin-config.service.ts`
- Modify: `backend/src/modules/admin/config/admin-config.controller.ts`
- Modify: `backend/src/modules/admin/config/config-validation.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.service.ts`
- Modify: `backend/src/modules/admin/captain/admin-captain.controller.ts`
- Modify: `backend/src/modules/admin/audit/admin-audit.service.ts`
- Modify: `backend/src/modules/admin/products/admin-products.service.ts`
- Modify: `backend/src/modules/seller/products/seller-products.service.ts`

### Admin And Buyer Interfaces

- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/captain.ts`
- Modify: `admin/src/api/config.ts`
- Modify: `admin/src/pages/captain/settings.tsx`
- Modify: `admin/src/pages/captain/orders.tsx`
- Modify: `admin/src/pages/captain/settlements.tsx`
- Modify: `admin/src/pages/bonus/vip-config.tsx`
- Modify: `admin/src/pages/bonus/normal-config.tsx`
- Modify: `admin/src/pages/products/edit.tsx`
- Modify: `src/types/domain/Captain.ts`
- Modify: `src/repos/CaptainRepo.ts`
- Modify: `app/me/captain.tsx`

---

### Task 1: Add Profit Models And V3 Persistence Contract

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710030000_captain_profit_v3/migration.sql`
- Modify: `backend/src/modules/captain/captain.types.ts`
- Modify: `backend/src/modules/captain/captain.constants.ts`
- Test: `backend/src/modules/captain/captain-config.service.spec.ts`

**Interfaces:**
- Produces: `OrderProfitSnapshot`, `OrderProfitFundingLedger`, `OrderProfitRefundReversal`, `CaptainMonthlySettlementOrder` and V3 `CaptainSeafoodConfig`.
- Preserves: all V2 rows and legacy indirect audit fields without reinterpretation.

- [x] **Step 1: Write failing V3 contract tests**

```ts
expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.schemaVersion).toBe(3);
expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.enabled).toBe(false);
expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.perOrderCommission).toEqual({ directProfitRate: 0 });
expect(() => validateCaptainSeafoodConfig({ ...v2Config, enabled: true })).toThrow('V2');
expect(() => validateCaptainSeafoodConfig(v3Config)).not.toThrow();
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `cd backend && npx jest src/modules/captain/captain-config.service.spec.ts --runInBand`

Expected: FAIL because schema version 3 and profit-rate fields do not exist.

- [x] **Step 3: Add Prisma models and enums**

```prisma
enum OrderProfitSnapshotStatus { READY RECONCILIATION_REQUIRED }
enum OrderProfitFundingType {
  PLATFORM_RETAINED_CREDIT
  CAPTAIN_DIRECT_HOLD
  CAPTAIN_MONTHLY_HOLD
  CAPTAIN_MONTHLY_RELEASE
  REFUND_ADJUSTMENT
}

enum OrderProfitReconciliationStatus { PENDING RESOLVED REJECTED }
enum OrderProfitAdjustmentStatus { PENDING APPLIED REJECTED SUPERSEDED }

model OrderProfitSnapshot {
  id                            String                    @id @default(cuid())
  orderId                       String
  order                         Order                     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  revision                      Int                       @default(1)
  isCurrent                     Boolean                   @default(true)
  supersedesSnapshotId          String?
  supersedesSnapshot            OrderProfitSnapshot?      @relation("ProfitSnapshotRevision", fields: [supersedesSnapshotId], references: [id], onDelete: Restrict)
  supersededBy                  OrderProfitSnapshot[]      @relation("ProfitSnapshotRevision")
  status                        OrderProfitSnapshotStatus
  grossGoodsAmount              Float
  shippingAmount                Float                     @default(0)
  vipDiscountAmount             Float                     @default(0)
  couponDiscountAmount          Float                     @default(0)
  rewardDeductionAmount         Float                     @default(0)
  groupBuyRebateDeductionAmount Float                     @default(0)
  otherGoodsDiscountAmount      Float                     @default(0)
  netGoodsRevenue               Float
  productCostAmount             Float
  distributableProfitAmount     Float
  captainEligibleProfitAmount   Float
  calculationVersion            String
  itemBreakdown                 Json
  ruleSnapshot                  Json
  errorCode                     String?
  errorMeta                     Json?
  createdAt                     DateTime                  @default(now())
  createdByAdminId              String?

  @@unique([orderId, revision])
  @@index([orderId, isCurrent])
}

model OrderProfitFundingLedger {
  id             String                 @id @default(cuid())
  snapshotId     String
  snapshot       OrderProfitSnapshot    @relation(fields: [snapshotId], references: [id], onDelete: Restrict)
  orderId        String
  order          Order                  @relation(fields: [orderId], references: [id], onDelete: Restrict)
  type           OrderProfitFundingType
  amount         Float
  configVersion  String
  sourceLedgerId String?
  idempotencyKey String                 @unique
  meta           Json?
  createdAt      DateTime               @default(now())

  @@index([orderId, type])
  @@index([snapshotId, createdAt])
}

model OrderProfitRefundReversal {
  id                       String              @id @default(cuid())
  snapshotId               String
  snapshot                 OrderProfitSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Restrict)
  refundId                 String
  refund                   Refund              @relation(fields: [refundId], references: [id], onDelete: Restrict)
  orderItemId              String
  orderItem                OrderItem           @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  sourceLedgerId           String
  sourceLedgerType         String
  refundedQuantity         Int?
  refundedGoodsAmount      Float
  cumulativeRefundRatio    Float
  cumulativeTargetReversal Float
  incrementalReversal      Float
  createdAt                DateTime             @default(now())

  @@unique([refundId, orderItemId, sourceLedgerId])
  @@index([snapshotId, orderItemId])
}

model OrderProfitReconciliationTask {
  id                 String                          @id @default(cuid())
  orderId            String
  order              Order                           @relation(fields: [orderId], references: [id], onDelete: Restrict)
  sourceSnapshotId   String                          @unique
  sourceSnapshot     OrderProfitSnapshot              @relation("ReconciliationSource", fields: [sourceSnapshotId], references: [id], onDelete: Restrict)
  status             OrderProfitReconciliationStatus @default(PENDING)
  errorCode          String
  itemCostCorrections Json?
  resolutionNote     String?
  resolvedSnapshotId String?
  resolvedSnapshot   OrderProfitSnapshot?             @relation("ReconciliationResolved", fields: [resolvedSnapshotId], references: [id], onDelete: Restrict)
  resolvedByAdminId  String?
  resolvedAt         DateTime?
  createdAt          DateTime                        @default(now())
  updatedAt          DateTime                        @updatedAt

  @@index([status, createdAt])
  @@index([orderId, status])
}

model CaptainMonthlySettlementOrder {
  id                       String   @id @default(cuid())
  settlementId             String
  settlement               CaptainMonthlySettlement @relation(fields: [settlementId], references: [id], onDelete: Restrict)
  orderAttributionId       String
  orderAttribution         CaptainOrderAttribution  @relation(fields: [orderAttributionId], references: [id], onDelete: Restrict)
  configVersion            String
  profitBaseAmount         Float
  baseManagementAmount     Float    @default(0)
  growthBonusAmount        Float    @default(0)
  cultivationBonusAmount   Float    @default(0)
  performanceBonusAmount   Float    @default(0)
  reservedAmount           Float
  releasedAmount           Float    @default(0)
  reversedAmount           Float    @default(0)
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([settlementId, orderAttributionId])
  @@index([orderAttributionId])
}

model OrderProfitAdjustmentDraft {
  id               String                      @id @default(cuid())
  orderId          String
  order            Order                       @relation(fields: [orderId], references: [id], onDelete: Restrict)
  sourceSnapshotId String
  sourceSnapshot   OrderProfitSnapshot         @relation("ProfitAdjustmentSource", fields: [sourceSnapshotId], references: [id], onDelete: Restrict)
  targetSnapshotId String
  targetSnapshot   OrderProfitSnapshot         @relation("ProfitAdjustmentTarget", fields: [targetSnapshotId], references: [id], onDelete: Restrict)
  status           OrderProfitAdjustmentStatus @default(PENDING)
  adjustments      Json
  idempotencyKey   String                      @unique
  supersededByDraftId String?
  reviewNote       String?
  reviewedByAdminId String?
  reviewedAt       DateTime?
  appliedAt        DateTime?
  createdAt        DateTime                    @default(now())
  updatedAt        DateTime                    @updatedAt

  @@index([orderId, status])
}
```

Add `Order.groupBuyRebateDeductionAmount`, optional snapshot relations on `CaptainOrderAttribution`, nullable `RewardLedger.idempotencyKey @unique` and `RewardLedger.sourceLedgerId`, and nullable V3 audit fields without deleting V2 fields. Add `RuleVersion.isComplete @default(false)` and `RuleVersion.safetySummary Json?`; only versions created after this migration may set `isComplete=true` after writing a complete snapshot.

Add the required inverse relation arrays to `Order`, `OrderItem`, `Refund`, `OrderProfitSnapshot`, `CaptainOrderAttribution` and `CaptainMonthlySettlement`. Use explicit relation names shown above for snapshot revision, reconciliation source/resolution and adjustment source/target so `prisma validate` has no ambiguous dual relation.

- [x] **Step 4: Add migration SQL that preserves historical data**

The migration must create new tables/columns and indexes only. Add a PostgreSQL partial unique index on `OrderProfitSnapshot(orderId) WHERE isCurrent=true` so concurrent reconciliation cannot create two current revisions. Existing captain attribution rows receive `calculationModel='SALES_V2'`; no existing amount is converted to profit. Existing `RuleVersion` rows remain `isComplete=false` so a historical partial captain snapshot can never delete unrelated configuration through global rollback.

Funding amounts are signed: `PLATFORM_RETAINED_CREDIT=+R`, `CAPTAIN_DIRECT_HOLD=-directAmount`, `CAPTAIN_MONTHLY_HOLD=-monthlyMaximum`, `CAPTAIN_MONTHLY_RELEASE=+unusedReserve`; refund adjustments use the sign required to bring the platform net to the remaining target. The accounting invariant is `memberExternalNet + captainNet + sum(funding.amount) = remaining D`.

- [x] **Step 5: Implement V3 config names and explicit V2 normalization**

```ts
type CaptainSeafoodConfigV3 = {
  schemaVersion: 3;
  enabled: boolean;
  programCode: 'SEAFOOD_PREPACKAGED';
  programName: string;
  effectiveFrom: string;
  scope: CaptainScopeConfig;
  orderRules: CaptainOrderRules;
  monthlyQualification: CaptainMonthlyQualification;
  perOrderCommission: { directProfitRate: number };
  monthlyRewards: {
    baseTierGmv: number;
    baseManagementProfitRate: number;
    growthTierGmv: number;
    growthBonusProfitRate: number;
    excellentTierGmv: number;
    cultivationBonusProfitRate: number;
    performanceBonusProfitRate: number;
  };
  unitEconomics: { fulfillmentCostRate: number };
  caps: {
    maxTotalIncentiveProfitRate: number;
    targetNetProfitRate: number;
    coldChainRiskReserveRate: number;
  };
  tax: CaptainTaxConfig;
  risk: CaptainRiskConfig;
};
```

Implement `CaptainSeafoodConfig = CaptainSeafoodConfigV2 | CaptainSeafoodConfigV3` as a discriminated union. Persisted V2 reads remain possible for historical lifecycle, but `enabled=true` V2 is returned as migration-required and cannot create new attribution. Validate first V3 `effectiveFrom` as 00:00:00 on the first day of a natural month in `Asia/Shanghai`, stored as UTC.

- [x] **Step 6: Generate and validate Prisma, then verify GREEN**

Run:

```bash
cd backend
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
npx prisma generate
npx jest src/modules/captain/captain-config.service.spec.ts --runInBand
```

- [x] **Step 7: Commit**

```bash
git add backend/prisma backend/src/modules/captain
git commit -m "feat: add captain profit v3 contract"
```

### Task 2: Build The Integer-Cent Profit Calculator

**Files:**
- Create: `backend/src/modules/profit/profit.types.ts`
- Create: `backend/src/modules/profit/money-allocation.ts`
- Create: `backend/src/modules/profit/order-profit-snapshot-calculator.ts`
- Test: `backend/src/modules/profit/order-profit-snapshot-calculator.spec.ts`

**Interfaces:**
- Produces: `OrderProfitSnapshotCalculator.calculate(input): ProfitCalculationResult`.
- Consumes later: checkout snapshot service, refund reversal and reconciliation.

- [ ] **Step 1: Write failing golden-vector tests**

```ts
expect(calculate({ gross: 13500, cost: 10000, vip: 675, coupon: 1000, reward: 500 })).toMatchObject({
  netGoodsRevenueCents: 11325,
  distributableProfitCents: 1325,
});
expect(calculate({ gross: 13500, cost: 10000, vip: 675, coupon: 1000, reward: 500, other: 1500 }).distributableProfitCents).toBe(0);
expect(mixedItems([{ margin: 2000 }, { margin: -1500 }]).distributableProfitCents).toBe(500);
```

Add cases for discount-capacity redistribution, deterministic last-cent allocation, prize exclusion, missing cost, conservation failure, and `0 <= C <= D`.

- [ ] **Step 2: Run the test and verify RED**

Run: `cd backend && npx jest src/modules/profit/order-profit-snapshot-calculator.spec.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement money helpers and calculator**

```ts
export const yuanToCents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
export const centsToYuan = (value: number): number => Math.round(value) / 100;

export interface ProfitCalculationResult {
  status: 'READY' | 'RECONCILIATION_REQUIRED';
  distributableProfitCents: number;
  captainEligibleProfitCents: number;
  itemBreakdown: ProfitItemBreakdown[];
  errorCode?: 'ORDER_PROFIT_COST_MISSING' | 'ORDER_PROFIT_CONSERVATION_FAILED';
}
```

Allocate explicit item discounts first, then VIP/reward/group-buy/coupon order discounts by remaining item capacity. Sum all positive and negative item margins before applying the single order-level zero floor.

- [ ] **Step 4: Verify GREEN and refactor without changing behavior**

Run: `cd backend && npx jest src/modules/profit/order-profit-snapshot-calculator.spec.ts --runInBand`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/profit
git commit -m "feat: calculate discounted order profit"
```

### Task 3: Create Payment-Time Profit And Relationship Snapshots

**Files:**
- Create: `backend/src/modules/profit/order-profit-snapshot.service.ts`
- Create: `backend/src/modules/profit/profit.module.ts`
- Test: `backend/src/modules/profit/order-profit-snapshot.service.spec.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Test: `backend/src/modules/order/checkout-profit-snapshot.spec.ts`

**Interfaces:**
- Produces: `createForPaidOrder(tx, orderId): Promise<OrderProfitSnapshot>`.
- Snapshot rule JSON contains buyer path, direct inviter and tier, VIP/normal ancestor paths, captain relation/config version and all applicable rates.

- [ ] **Step 1: Write failing service and checkout integration tests**

```ts
await service.createForPaidOrder(tx, 'order-1');
expect(tx.orderProfitSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ distributableProfitAmount: 13.25, status: 'READY' }),
}));
```

Add tests proving cost failure creates `RECONCILIATION_REQUIRED` without throwing from `handlePaymentSuccess`, and each suborder stores its allocated group-buy deduction.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/profit/order-profit-snapshot.service.spec.ts src/modules/order/checkout-profit-snapshot.spec.ts --runInBand`

- [ ] **Step 3: Implement snapshot resolution**

Use the payment transaction client for all reads. Resolve current SKU cost at payment time, exclude prize items, capture the full buyer/recommender/captain/rule state, and write one immutable snapshot per order. Read the single current RuleConfig set directly through `tx` as one transaction-consistent snapshot; do not use the process cache. V3 later saves take effect immediately only for payments whose transaction begins after that save commits. `ProfitModule` may depend only on Prisma and local pure helpers so Bonus/Captain/Order modules can import it without a circular module dependency.

```ts
async createForPaidOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: SNAPSHOT_INCLUDE });
  const calculation = this.calculator.calculate(this.toInput(order));
  return tx.orderProfitSnapshot.create({ data: this.toCreateData(order, calculation) });
}
```

Move direct-relation resolution into one shared resolver consumed by both the snapshot service and direct commission service. For a normal buyer without a tree node, create/resolve the normal tree placement inside this payment transaction before capturing the ancestor path; add a test proving two concurrent first payments cannot create two nodes.

- [ ] **Step 4: Insert snapshot creation before any reward attribution**

In `CheckoutService.handlePaymentSuccess()`, persist `groupBuyRebateDeductionAmount`, create the profit snapshot immediately after each `Order`, then call direct-referral and captain services. Payment must not fail solely because the profit status is reconciliation-required.

- [ ] **Step 5: Verify GREEN and checkout regressions**

Run:

```bash
cd backend
npx jest src/modules/profit/order-profit-snapshot.service.spec.ts src/modules/order/checkout-profit-snapshot.spec.ts src/modules/order/checkout-captain-attribution.spec.ts src/modules/order/checkout-vip-direct-referral.spec.ts --runInBand
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/profit backend/src/modules/order backend/prisma/schema.prisma
git commit -m "feat: snapshot profit at payment"
```

### Task 4: Make VIP And Normal Rewards Consume The Snapshot

**Files:**
- Modify: `backend/src/modules/bonus/engine/reward-calculator.service.ts`
- Modify: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- Test: corresponding Jest specifications.

**Interfaces:**
- Consumes: `OrderProfitSnapshot.distributableProfitAmount` and `ruleSnapshot`.
- Produces: all member reward allocations whose net sum does not exceed `D`.

- [ ] **Step 1: Write failing tests for snapshot-only behavior**

Assert direct referral uses `D × inviterTierRate`, zero/reconciliation snapshots create no user ledger, receipt allocation does not read current SKU cost or current ratio, and mixed-item negative profit has already reduced `D`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/bonus/engine/reward-calculator.service.spec.ts src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts src/modules/bonus/engine/bonus-allocation.service.spec.ts --runInBand`

- [ ] **Step 3: Replace item-cost recalculation with pool calculation from D**

```ts
calculateFromProfit(profit: number, path: 'VIP' | 'NORMAL', config: BonusConfig): PoolCalculation
```

The direct rate comes from the inviter tier in the payment snapshot. Tree reward and industry fund come from the buyer path. Missing/inactive inviter routes the direct share to platform instead of a user.

- [ ] **Step 4: Use payment-time route and ancestor path at receipt**

`BonusAllocationService.allocateForOrder()` must load the snapshot and choose the eligible ancestor from `ruleSnapshot`; it must not re-read current cost, current config or current tree parentage. Orders paid before deployment with no snapshot follow the existing legacy path so historical fulfilment is not blocked or recomputed with current costs.

- [ ] **Step 5: Verify GREEN and full bonus engine tests**

Run: `cd backend && npx jest src/modules/bonus/engine --runInBand`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/bonus
git commit -m "refactor: allocate member rewards from profit snapshots"
```

### Task 5: Fund Captain V3 From Platform Retained Profit

**Files:**
- Modify: `backend/src/modules/captain/captain-attribution.service.ts`
- Modify: `backend/src/modules/captain/captain-commission.service.ts`
- Test: `backend/src/modules/captain/captain-attribution.service.spec.ts`
- Test: `backend/src/modules/captain/captain-commission.service.spec.ts`

**Interfaces:**
- Consumes: `C`, payment rule snapshot and platform retained `R`.
- Produces: direct frozen ledger, platform direct hold and invisible monthly maximum hold.

- [ ] **Step 1: Write failing V3 funding tests**

```ts
expect(attribution.commissionBase).toBe(35);
expect(directLedger.amount).toBe(3.85);
expect(monthlyHold.amount).toBe(1.58);
expect(directHold.amount + monthlyHold.amount).toBeLessThanOrEqual(platformRetained.amount);
```

Add tests for non-eligible products, self-binding prevention, no captain relation, `C=0`, reconciliation status, V2 disabled and idempotent duplicate payment.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/captain/captain-attribution.service.spec.ts src/modules/captain/captain-commission.service.spec.ts --runInBand`

- [ ] **Step 3: Implement snapshot-based attribution**

```ts
directAmount = roundMoney(C * directProfitRate);
monthlyMaximum = roundMoney(C * (
  baseManagementProfitRate + growthBonusProfitRate +
  cultivationBonusProfitRate + performanceBonusProfitRate
));
```

Write `PLATFORM_RETAINED_CREDIT` as `+R`, then `CAPTAIN_DIRECT_HOLD` and `CAPTAIN_MONTHLY_HOLD` as negative amounts with unique idempotency keys in the same payment transaction. Arithmetic invariant failure creates a reconciliation task and no reward; it never reduces rates dynamically.

- [ ] **Step 4: Keep V2 lifecycle isolated**

Existing `SALES_V2` ledgers continue release/void/clawback by their historical snapshot. V3 release reads its own `PROFIT_V3` attribution; no migration changes historical amounts.

- [ ] **Step 5: Verify GREEN**

Run: `cd backend && npx jest src/modules/captain --runInBand`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/captain backend/src/modules/profit
git commit -m "feat: fund captain rewards from retained profit"
```

### Task 6: Settle Monthly Profit Rewards By Order And Config Version

**Files:**
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Test: `backend/src/modules/captain/captain-monthly-settlement.service.spec.ts`

**Interfaces:**
- Consumes: monthly direct net GMV, effective buyer metrics, per-order `C`, config version and monthly hold.
- Produces: `CaptainMonthlySettlementOrder`, actual monthly ledgers and unused hold releases.

- [ ] **Step 1: Write failing monthly scenarios**

Cover 8,000 qualification without tier reward, 25,000 base+performance, 70,000 growth stacking, 140,000 full stacking, zero-profit orders with zero `C`, mixed config versions, refund-risk disqualification, and unused hold return. The mixed-version test must use one whole-month fact set while each order batch applies its own snapshotted thresholds and rates.

- [ ] **Step 2: Run test and verify RED**

Run: `cd backend && npx jest src/modules/captain/captain-monthly-settlement.service.spec.ts --runInBand`

- [ ] **Step 3: Implement order-level monthly target calculation**

```ts
monthFacts = { netGmv, effectiveBuyers, newEffectiveBuyers, refundRate };
batchQualified = compare(monthFacts, order.ruleSnapshot.monthlyThresholds);
actualRateForTier = batchQualified
  ? base + performance + (growthMet(monthFacts) ? growth : 0) + (excellentMet(monthFacts) ? cultivation : 0)
  : 0;
orderActualMonthly = min(order.monthlyReserveAmount, roundMoney(order.C * actualRateForTier));
unused = order.monthlyReserveAmount - orderActualMonthly;
```

Persist one settlement-order row per attribution, aggregate to the existing settlement amount fields, write `CAPTAIN_MONTHLY_RELEASE` for unused amounts and retain tax behavior.

- [ ] **Step 4: Verify GREEN**

Run: `cd backend && npx jest src/modules/captain/captain-monthly-settlement.service.spec.ts src/modules/captain/captain-commission.service.spec.ts --runInBand`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/captain
git commit -m "feat: settle captain monthly profit rewards"
```

### Task 7: Reverse Profit And Funding For Partial Refunds

**Files:**
- Create: `backend/src/modules/profit/order-profit-refund.service.ts`
- Test: `backend/src/modules/profit/order-profit-refund.service.spec.ts`
- Modify: `backend/src/modules/after-sale/after-sale.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-reward.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/payment/payment.service.ts`
- Modify: `backend/src/modules/payment/payment.module.ts`
- Test: related after-sale Jest specs.
- Test: `backend/src/modules/payment/payment-captain-auto-refund.spec.ts`
- Test: paid-unshipped cancel and refund-finalization specifications.

**Interfaces:**
- Produces: incremental target reversals keyed by `orderId + refundId + orderItemId + sourceLedgerId`.

- [ ] **Step 1: Write failing refund tests**

Cover two consecutive partial refunds, last-cent absorption, item quantity refunds, amount-only refunds, cross-month refunds, approved/unpaid monthly awards, paid awards creating `CLAWBACK_PENDING`, paid-unshipped auto cancel, asynchronous Alipay/WeChat success, active-query compensation and final net ledgers equaling remaining `D`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/profit/order-profit-refund.service.spec.ts src/modules/after-sale/after-sale-refund.service.spec.ts src/modules/after-sale/after-sale-reward.service.spec.ts --runInBand`

- [ ] **Step 3: Implement cumulative target reversal**

```ts
cumulativeRatio = min(1, refundedQuantity / originalQuantity);
cumulativeTarget = roundCents(originalProfitShare * cumulativeRatio);
incrementForSource = cumulativeTargetForSource - alreadyReversedForSourceLedger;
```

For amount-only refunds, use cumulative refunded goods amount divided by original item discounted amount. Never use a refund total that includes returned shipping as the profit numerator, and never reverse more than original `D` or `C`.

- [ ] **Step 4: Persist line-level refund facts**

When an after-sale refund row is created, also create its existing `RefundItem` row using `orderItemId`, the full requested line quantity and the line's discounted goods refund amount from the current profit snapshot. Paid-unshipped cancellation expands every non-prize order item into `RefundItem` rows; the channel refund may include shipping but `RefundItem.amount` must not.

- [ ] **Step 5: Route every successful refund finalizer to one service**

`OrderProfitRefundService.finalizeSuccessfulRefund(tx, refundId)` runs inside the same Serializable transaction that CAS-transitions the refund to `REFUNDED`. Call it from after-sale success and `PaymentService.finalizeAutoRefundRecord`; provider callbacks, active query and retry compensation already converge on that finalizer. Before computing reversals, mark every `PENDING` adjustment draft for the order `SUPERSEDED`; after reversal, recompute at most one replacement draft from actual applied balances to the post-refund target. `APPLIED` adjustments are included in actual balances. Replace whole-order reward voiding for V3 snapshots and preserve legacy V2 behavior for orders with no profit snapshot.

- [ ] **Step 6: Verify GREEN**

Run: `cd backend && npx jest src/modules/profit/order-profit-refund.service.spec.ts src/modules/after-sale src/modules/payment/payment-captain-auto-refund.spec.ts --runInBand`

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/profit backend/src/modules/after-sale backend/src/modules/order backend/src/modules/payment
git commit -m "feat: reverse profit rewards on partial refunds"
```

### Task 8: Implement Cross-Configuration Hard Validation

**Files:**
- Create: `backend/src/modules/profit/profit-safety-validator.ts`
- Create: `backend/src/modules/profit/profit-safety.service.ts`
- Test: `backend/src/modules/profit/profit-safety-validator.spec.ts`
- Test: `backend/src/modules/profit/profit-safety.service.spec.ts`

**Interfaces:**
- Produces: `ProfitSafetySummary` and `withSafetyLock(work)`.
- Error: `{ code: 'CAPTAIN_PROFIT_SAFETY_VIOLATION', scenarios, limitingSkus, shortfall }`.

- [ ] **Step 1: Write failing four-scenario tests**

```ts
expect(summary.scenarios.map(x => x.key)).toEqual([
  'VIP_BUYER_VIP_INVITER', 'VIP_BUYER_NORMAL_INVITER',
  'NORMAL_BUYER_VIP_INVITER', 'NORMAL_BUYER_NORMAL_INVITER',
]);
expect(() => validator.assertSafe(unsafeCandidate)).toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');
```

Test `g_sku <= 0`, missing cost, current 1.35 markup + configured VIP discount, captain disabled, V2 enabled rejection, a low-margin SKU outside captain scope, an in-scope SKU, and the worst normal-buyer/VIP-inviter combination.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/profit/profit-safety-validator.spec.ts src/modules/profit/profit-safety.service.spec.ts --runInBand`

- [ ] **Step 3: Implement pure validation formula**

```ts
platformRequiredRevenueRate = fulfillmentCostRate + coldChainRiskReserveRate + targetNetProfitRate;
captainRateForSku = matchesCaptainScope(sku, captainScope) ? captainMax : 0;
externalProfitRate = treeRate + industryRate + actualDirectRate + captainRateForSku;
safe = externalProfitRate <= 1 && gSku * (1 - externalProfitRate) >= platformRequiredRevenueRate;
```

Evaluate every active ordinary SKU against the automatic markup baseline and its own mandatory-discount margin `gSku`; aggregate the limiting result only after scenario evaluation. Optional coupons/points do not participate in static SKU safety because actual `D` falls at order time.

- [ ] **Step 4: Implement the shared transaction lock**

```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('profit-safety-config-v1'))`;
```

Inside the lock read all configs and active SKU economics, merge the candidate change, validate, execute the supplied write, create a full version snapshot and return the safety summary.

- [ ] **Step 5: Verify GREEN including simulated concurrent candidates**

Run: `cd backend && npx jest src/modules/profit/profit-safety-validator.spec.ts src/modules/profit/profit-safety.service.spec.ts --runInBand`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/profit
git commit -m "feat: validate profit safety across configurations"
```

### Task 9: Route Config, Rollback And Product Writes Through The Safety Lock

**Files:**
- Modify admin config/captain/audit/products and seller products services listed in the File Map.
- Test their existing Jest specifications.

**Interfaces:**
- Consumes: `ProfitSafetyService.withCandidateChange()`.
- Produces: complete RuleVersion snapshots, safety preview/summary APIs and zero-write failures.

- [ ] **Step 1: Write failing atomicity and rollback tests**

Assert validation happens inside the Serializable transaction after advisory lock, unsafe candidates perform no upsert/version/cache invalidation, captain versions contain the full RuleConfig snapshot, incomplete historical snapshots cannot globally roll back, and audit single-field rollback merges with current config before validation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd backend
npx jest src/modules/admin/config src/modules/admin/captain src/modules/admin/audit src/modules/admin/products src/modules/seller/products/seller-products.service.spec.ts --runInBand
```

- [ ] **Step 3: Refactor related config writes to one coordinator**

Remove transaction-external ratio/safety reads. Save a full snapshot and safety summary for every new RuleVersion. Remove the invalid `RuleConfig.description` create field from captain settings.

Expose these DTO-stable endpoints:

```text
GET  /admin/config/profit-safety-summary -> ProfitSafetySummary
POST /admin/config/profit-safety-preview -> { candidateUpdates, candidateCaptainConfig? } -> ProfitSafetySummary
```

Unsafe saves return HTTP 400 with `{ code: 'CAPTAIN_PROFIT_SAFETY_VIOLATION', message, scenarios, limitingSkus, shortfall }`. Version list/detail returns `isComplete`, `rollbackAllowed`, `rollbackBlockedReason` and `safetySummary`.

- [ ] **Step 4: Protect all SKU economic mutations**

Admin and seller create/update/submit/status paths provide candidate price, cost, category, company and active status to the validator before writing. Draft-only changes that cannot enter the active ordinary sale scope may skip the economic check but still use their existing validation.

- [ ] **Step 5: Verify GREEN and Prisma/backend build**

Run:

```bash
cd backend
npx jest src/modules/admin/config src/modules/admin/captain src/modules/admin/audit src/modules/admin/products src/modules/seller/products/seller-products.service.spec.ts --runInBand
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/admin backend/src/modules/seller backend/src/modules/profit
git commit -m "fix: lock profit-sensitive configuration writes"
```

### Task 10: Build The Profit Reconciliation Workflow

**Files:**
- Create: `backend/src/modules/admin/profit-reconciliation/admin-profit-reconciliation.controller.ts`
- Create: `backend/src/modules/admin/profit-reconciliation/admin-profit-reconciliation.service.ts`
- Create: `backend/src/modules/admin/profit-reconciliation/admin-profit-reconciliation.service.spec.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`
- Modify: `backend/src/modules/captain/captain-monthly-settlement.service.ts`
- Test: `backend/src/modules/captain/captain-monthly-settlement.service.spec.ts`
- Create: `admin/src/api/profit-reconciliation.ts`
- Create: `admin/src/pages/captain/reconciliation.tsx`
- Create: `admin/src/pages/captain/profit-adjustments.tsx`
- Modify: admin routes/navigation and `admin/src/types/index.ts`.

**Interfaces:**
- Produces: immutable profit snapshot revisions and auditable reconciliation tasks.
- Endpoints: list/detail/recalculate/reject under `/admin/profit-reconciliation`.

- [ ] **Step 1: Write failing revision and month-blocking tests**

Assert reconciliation-required payment creates one unique pending task, repeated creation is idempotent, audited cost correction creates revision 2 and leaves revision 1 unchanged, rewards already generated produce a supplement/clawback draft instead of silent mutation, and unresolved tasks block monthly review/payment.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && npx jest src/modules/admin/profit-reconciliation/admin-profit-reconciliation.service.spec.ts src/modules/captain/captain-monthly-settlement.service.spec.ts --runInBand`

- [ ] **Step 3: Implement immutable revision transition**

```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('order-profit-reconcile'), hashtext(${orderId}))`;
await tx.orderProfitSnapshot.update({ where: { id: current.id }, data: { isCurrent: false } });
await tx.orderProfitSnapshot.create({ data: { ...recalculated, revision: current.revision + 1, isCurrent: true, supersedesSnapshotId: current.id } });
```

Validate submitted item costs against order items, save admin/reason/before/after audit, CAS task `PENDING -> RESOLVED`, and invoke idempotent reward attribution only when no prior reward/funding/settlement exists.

- [ ] **Step 4: Implement explicit post-reward adjustment behavior**

If any user, seller or captain reward already exists, create a reviewable supplement/clawback draft linked to the new revision; do not alter available balances until finance calls `approveAndApply`. That method runs a Serializable CAS from `PENDING` directly to `APPLIED` and writes all reward/funding/account changes in the same transaction, so no approved-but-unapplied state exists. Tests must prove duplicate approvals cannot apply twice and `SUPERSEDED` drafts cannot apply.

- [ ] **Step 5: Add admin API and work-focused page**

```text
GET  /admin/profit-reconciliation?status=PENDING
GET  /admin/profit-reconciliation/:id
POST /admin/profit-reconciliation/:id/recalculate
POST /admin/profit-reconciliation/:id/reject

GET  /admin/profit-adjustments?status=PENDING
GET  /admin/profit-adjustments/:id
POST /admin/profit-adjustments/:id/approve-and-apply
POST /admin/profit-adjustments/:id/reject
```

The reconciliation page lists order, error, missing item cost and affected captain/month, opens a detail modal for audited costs and reason, and shows whether the result can auto-resume rewards or requires a supplement review. The adjustment page shows per-account before/target/delta, source and target revisions, current status and approve-and-apply/reject actions. Refunds automatically mark pending drafts `SUPERSEDED` and create a replacement draft; the page must make this replacement chain visible.

- [ ] **Step 6: Verify backend tests and admin build**

Run:

```bash
cd backend
npx jest src/modules/admin/profit-reconciliation/admin-profit-reconciliation.service.spec.ts src/modules/captain/captain-monthly-settlement.service.spec.ts --runInBand
cd ../admin && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin backend/src/modules/captain admin/src
git commit -m "feat: add profit reconciliation workflow"
```

### Task 11: Update Admin And Buyer Interfaces

**Files:**
- Modify all Admin and Buyer Interface files from the File Map.
- Test: `src/repos/__tests__/CaptainRepo.test.ts`

**Interfaces:**
- Admin consumes server `ProfitSafetySummary`; no hard-coded 35%/10.5% calculator remains.
- Buyer consumes V3 profit-base labels without exposing internal funding ledgers.

- [ ] **Step 1: Invoke frontend design guidance and inspect existing conventions**

Use `frontend-design:frontend-design` before edits. Keep the operational Ant Design layout, existing tooltips and current navigation.

- [ ] **Step 2: Write failing buyer repository/type expectations**

```ts
expect(order.calculationModel).toBe('PROFIT_V3');
expect(order.profitBase).toBe(35);
expect(order.commissionAmount).toBe(3.85);
```

- [ ] **Step 3: Replace captain V2 fields and hard-coded economics UI**

Use `directProfitRate`, the four monthly profit rates, fulfillment/risk/target parameters, server safety summary, four scenario rows, limiting SKU list and structured conflict messages. Every editable field retains a question-mark tooltip explaining its formula and related fields.

- [ ] **Step 4: Add safety feedback to VIP/normal/product pages**

VIP and normal pages display the current safety summary and route captain conflicts to `/captain/settings`. Version history disables incomplete or unsafe rollback. Product edit shows the limiting SKU and failed scenario from the server error.

- [ ] **Step 5: Update buyer captain center labels**

Show “直接客户可分润利润”“逐单利润奖励”“月度利润奖励”; keep V2 history visibly labelled “历史销售额规则”. A captain's own purchase must never show self captain commission.

- [ ] **Step 6: Update frontend documentation and verify builds**

Run:

```bash
npx jest src/repos/__tests__/CaptainRepo.test.ts --runInBand
npx tsc -b --noEmit --pretty false
cd admin && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add admin src app docs/architecture
git commit -m "feat: expose captain profit v3 controls"
```

### Task 12: Reconcile, Audit And Prove Delivery Readiness

**Files:**
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`
- Modify: `docs/superpowers/plans/2026-07-10-captain-profit-v3.md`

- [ ] **Step 1: Add reconciliation and golden invariant tests**

Create end-to-end service tests proving for ready snapshots:

```text
all external reward net amounts + platform retained net amount = remaining D
captain direct hold + captain monthly hold <= platform retained before captain
refund reversals never exceed original D or C
```

- [ ] **Step 2: Run complete focused suites**

```bash
cd backend
npx jest src/modules/profit src/modules/captain src/modules/bonus/engine src/modules/after-sale src/modules/admin/config src/modules/admin/captain src/modules/admin/products --runInBand
```

- [ ] **Step 3: Run schema and build verification**

```bash
cd backend
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
npm run build
cd ../admin && npm run build
cd .. && npx tsc -b --noEmit --pretty false
```

- [ ] **Step 4: Run source audits and diff checks**

```bash
rg -n "indirectRate|INDIRECT_ORDER|teamPoolRate|commissionBase.*totalAmount" backend/src admin/src src app
rg -n "unitPrice - cost|cost=0|按 cost=0" backend/src/modules/bonus backend/src/modules/captain
git diff --check
git status --short
```

Only explicitly labelled V2/legacy lifecycle references may remain.

- [ ] **Step 5: Perform independent whole-branch review and fix every Critical/Important finding**

Review money conservation, Serializable coverage, idempotency, V2/V3 isolation, incomplete rollback rejection, missing-cost fail-closed behavior, refund cumulative targets, App/admin contract alignment and every requirement in the design spec.

- [ ] **Step 6: Update security and project documentation**

Record the shared lock, profit snapshot, platform funding, refund reversal and verification evidence in `docs/issues/tofix-safe.md`; update `plan.md` and mark every completed checkbox in this plan.

- [ ] **Step 7: Commit final reviewed state**

```bash
git add backend admin src app docs plan.md
git commit -m "feat: complete captain profit v3"
```

## Self-Review Checklist

- [ ] Every design requirement has a task and verification command.
- [ ] No task treats V2 sales rates as V3 profit rates.
- [ ] No runtime path dynamically scales configured rates.
- [ ] Optional discounts lower `D`; zero/negative `D` does not block payment.
- [ ] Group-buy rebate deduction is persisted per order and included once.
- [ ] All payment/receipt/refund calculations read the same immutable snapshot.
- [ ] Captain monthly reserves are not visible buyer balances before settlement.
- [ ] Config and SKU writes share one lock and one complete candidate snapshot.
- [ ] Full rollback rejects incomplete historical snapshots instead of deleting unrelated configs.
- [ ] Frontend safety summaries come from the backend, not duplicated formulas.
