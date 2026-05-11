# 顺丰风格平台统一运费计价 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把买家侧运费从"金额区间 × 重量区间 × 固定费"升级为顺丰风格"首重 + 续重"公式计价；补齐 SKU 重量链路；新增 `OrderShippingCost` 模型记录每个顺丰包裹的真实承运成本，为月结对账打基础。

**Architecture:** Schema 先扩展 `ShippingRule` 公式字段并新增 `OrderShippingCost`；后端计算引擎重写为整数克 + 整数分内部计算，避免浮点误差；Redis 缓存 60s TTL + 写后主动失效；管理后台规则 CRUD/预览/CSV-JSON 导入升级；SKU 重量改必填 + 历史数据迁移；顺丰下单写入 `OrderShippingCost`，月结对账后回填真实成本。买家 App 只读最终 `shippingFee`，不感知公式细节。

**Tech Stack:** NestJS 11 + Prisma 6 + PostgreSQL + Redis + Serializable 事务；React 19 + Vite + Ant Design 5（管理后台 + 卖家后台）；React Native 0.81 + Expo Router（买家 App）；Jest + ts-jest。

**Related Spec:** `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md`

---

## Scope Check

本计划覆盖 spec 全量范围，但**不包含**退换货链路的退货面单/回寄面单/商家责任运费——这些由 `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md` 主导。`OrderShippingCost` 仅记录正向发货包裹成本，不写入售后退货成本。

## File Structure

后端 Schema 与公共类型：

- Modify `backend/prisma/schema.prisma`：`ShippingRule` 公式字段去默认值 + 新增 `OrderShippingCost` 模型 + `ProductSKU.weightGram` 改必填。
- Create generated migration `backend/prisma/migrations/*_sf_style_shipping_pricing/migration.sql` via `npx prisma migrate dev --name sf_style_shipping_pricing`。
- Create `backend/prisma/migrations/*_sf_style_shipping_pricing/data-backfill.sql`：历史 `ShippingRule.firstFee = fee` 回填、历史 `ProductSKU.weightGram` null → 1000g 回填。

后端运费引擎：

- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.service.ts`：新增 `calculateShippingDetail()`、整数化计算、priority+id 稳定排序、Redis 缓存。
- Create `backend/src/modules/admin/shipping-rule/shipping-rule.cache.ts`：Redis 缓存读写与失效。
- Modify `backend/src/modules/admin/shipping-rule/dto/create-shipping-rule.dto.ts`：`firstFee` 必填 + `firstFee > 0` 校验、字段重命名对齐 spec。
- Modify `backend/src/modules/admin/shipping-rule/dto/update-shipping-rule.dto.ts`：同上。
- Create `backend/src/modules/admin/shipping-rule/dto/import-shipping-rule.dto.ts`：CSV/JSON 导入请求 + dry-run 二次确认结构。
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.controller.ts`：`/preview`、`/import` 接口升级，所有写操作后清缓存。
- Create `backend/src/modules/admin/shipping-rule/shipping-rule-import.service.ts`：CSV RFC 4180 解析 + JSON 解析 + 校验 + dry-run + 落库。
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.module.ts`：注册并导出缓存/导入服务。

后端订单与发货链路：

- Modify `backend/src/modules/order/checkout.service.ts`：预结算调用 `calculateShippingDetail`、CheckoutSession 创建时锁定 `shippingFee`；支付回调 `handlePaymentSuccess()` 使用 session 锁定运费、不重算；按子订单商品金额比例分摊 `shippingFee` 不变。
- Create `backend/src/modules/shipment/order-shipping-cost.service.ts`：顺丰下单成功后写入 `OrderShippingCost`，月结回填 `actualCost` 接口。
- Modify `backend/src/modules/seller/shipping/seller-shipping.service.ts`：卖家生成顺丰面单时查询 `sku.weightGram`、传真实总重量、调用 `OrderShippingCostService.recordPackage()`。
- Modify `backend/src/modules/shipment/sf-express.service.ts`：保持 `totalWeight` 参数为 kg；调用方负责 `max(sum(weightGram × qty) / 1000, 1)`。
- Modify `backend/src/modules/shipment/shipment.module.ts`：注册并导出 `OrderShippingCostService`。

后端商品/SKU 重量链路：

- Modify `backend/src/modules/seller/products/seller-products.dto.ts`：`weightGram` 改必填、提示克为单位。
- Modify `backend/src/modules/seller/products/seller-products.service.ts`：保存 SKU 时校验 `weightGram > 0`。

测试：

- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.service.spec.ts`：新增浮点边界、稳定排序、赠品计入、缓存失效用例。
- Create `backend/src/modules/admin/shipping-rule/shipping-rule-import.service.spec.ts`：CSV/JSON 导入预检查与落库测试。
- Modify `backend/src/modules/order/checkout.service.spec.ts`：CheckoutSession 锁定运费、跨规则切换不重算。
- Create `backend/src/modules/shipment/order-shipping-cost.service.spec.ts`：写入与回填路径。

管理后台：

- Modify `admin/src/api/shipping-rules.ts`：新增 import 预检查/确认、preview 详情、weightGram 模板下载。
- Modify `admin/src/pages/shipping-rules/index.tsx`：列表展示首重/续重字段、新增/编辑表单、批量导入文本框 + 二次确认 Modal、预览测试展示公式。
- Create `admin/src/pages/shipping-rules/components/ImportDialog.tsx`：CSV/JSON 粘贴 + dry-run 结果展示 + 模板下载。
- Create `admin/src/pages/shipping-rules/components/PreviewPanel.tsx`：预览结果含命中规则、公式、`fallbackUsed` 提示。

卖家后台：

- Modify `seller/src/pages/products/components/SkuEditor.tsx`（或当前 SKU 编辑组件）：`weightGram` 标记必填、提示克为单位。

买家 App：

- 不改业务逻辑。仅在订单/购物车摘要文案上保持 `summary.totalShippingFee` 与 `summary.amountToFreeShipping` 兼容（已存在）。

文档与运维：

- Modify `docs/architecture/data-system.md`：新增 `OrderShippingCost`、`ShippingRule` 字段变更（schema 权威来源）。
- Modify `docs/features/shipping.md`：登记顺丰风格计价。
- Modify `docs/features/plan-treeforuser.md`：替换旧"金额区间 × 地区 × 重量固定费"说明。
- Modify `docs/issues/app-tofix3.md`：Bug 33 / 34 / 56 状态与方案。
- Modify `docs/architecture/sales.md` / `docs/architecture/seller.md`：卖家 SKU 重量必填说明。
- Modify `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md`：清理旧金额区间过滤残留口径。
- Modify `AGENTS.md`：登记本设计文档和本实施计划（项目单一入口）。
- Modify `CLAUDE.md`：如该文件继续维护，同步「关键架构决策」表格中的"运费计价"条目。
- Modify `plan.md`：上线冲刺路线图新增本批次进度。

## Execution Rules

- 每个 Task 一个本地 commit，commit message 使用 `type(scope): 描述`。
- 不 push；推送或 OTA 必须另行取得用户确认。
- 涉及金额/库存/订单创建的写操作必须使用 `Prisma.TransactionIsolationLevel.Serializable`。
- `ShippingRule` 写操作完成后必须清 Redis 缓存。
- 数据回填脚本和迁移必须在 dev 库先跑通；生产前向用户确认回滚步骤。
- 完成每个 Phase 后启动独立审查 Agent（subagent_type: Explore），按 AGENTS.md 第 9 条「代码审查」流程修复 High/Critical。

---

### Task 1: Prisma Schema And Migration

**Files:**
- Modify `backend/prisma/schema.prisma`
- Generated: `backend/prisma/migrations/*_sf_style_shipping_pricing/migration.sql`
- Create `backend/prisma/migrations/*_sf_style_shipping_pricing/data-backfill.sql`

- [x] **Step 1: Update `ShippingRule` to formula fields**

```prisma
model ShippingRule {
  id                 String   @id @default(cuid())
  name               String
  regionCodes        String[]

  // 兼容旧字段：保留一版用于回滚兜底
  minAmount          Float?
  maxAmount          Float?
  minWeight          Int?
  maxWeight          Int?
  fee                Float    @default(0)

  // 新公式字段：firstFee / additionalFee 故意不设默认值，漏配立即报错
  firstWeightKg      Float    @default(3)
  firstFee           Float
  additionalWeightKg Float    @default(1)
  additionalFee      Float
  minChargeWeightKg  Float    @default(1)

  priority           Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([isActive, priority])
}
```

- [x] **Step 2: Add `OrderShippingCost` model**

```prisma
model OrderShippingCost {
  id              String   @id @default(cuid())
  orderId         String
  order           Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  packageIndex    Int
  companyId       String?
  sfOrderId       String   @unique
  weightGramSent  Int
  estimatedCost   Float?
  actualCost      Float?
  reconciledAt    DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([orderId])
  @@index([companyId, createdAt])
  @@index([reconciledAt])
  @@map("order_shipping_costs")
}
```

在 `Order` 模型上新增反向关系：

```prisma
shippingCosts OrderShippingCost[]
```

- [x] **Step 3: `ProductSKU.weightGram` 改必填**

```prisma
weightGram Int  // 旧版本是 Int?，迁移时回填后改必填
```

- [x] **Step 4: 数据回填 SQL**

`data-backfill.sql` 内容（迁移生成后手工补到 migration.sql 末尾或单独执行）：

```sql
-- 旧固定费 → 公式首重价（保持当前买家体验）
UPDATE "ShippingRule"
SET "firstFee" = COALESCE("fee", 0),
    "additionalFee" = 0
WHERE "firstFee" IS NULL;

-- 历史 SKU 无重量 → 默认 1000g
UPDATE "ProductSKU" SET "weightGram" = 1000 WHERE "weightGram" IS NULL;
```

- [x] **Step 5: 校验**

```bash
cd backend
npx prisma validate
npx prisma migrate dev --name sf_style_shipping_pricing
npx prisma generate
```

迁移 SQL 中如包含 `firstFee` 改成必填且无默认，必须确认 Step 4 回填先于该列约束变更，否则迁移会失败。如 Prisma 自动生成的迁移顺序错误，手工调整 SQL。

**Verify:** `npx prisma validate` 通过；`npx prisma migrate status` 显示新迁移已应用；本地 dev 库 `\d "ShippingRule"` 显示 `firstFee` NOT NULL；`\dt order_shipping_costs` 表存在。

---

### Task 2: Shipping Rule Cache Module

**Files:**
- Create `backend/src/modules/admin/shipping-rule/shipping-rule.cache.ts`
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.module.ts`

- [x] **Step 1: Cache service skeleton**

```ts
@Injectable()
export class ShippingRuleCache {
  private static readonly RULES_KEY = 'shipping-rules:active';
  private static readonly CONFIG_KEY = 'shipping-config';
  private static readonly TTL_MS = 60_000;

  constructor(private readonly redis: RedisCoordinatorService) {}

  async getActiveRules(): Promise<ShippingRule[] | null> {
    const raw = await this.redis.get(ShippingRuleCache.RULES_KEY);
    return raw ? JSON.parse(raw) as ShippingRule[] : null;
  }

  async setActiveRules(rules: ShippingRule[]): Promise<void> {
    await this.redis.set(
      ShippingRuleCache.RULES_KEY,
      JSON.stringify(rules),
      ShippingRuleCache.TTL_MS,
    );
  }

  async getConfig(): Promise<ShippingConfig | null> {
    const raw = await this.redis.get(ShippingRuleCache.CONFIG_KEY);
    return raw ? JSON.parse(raw) as ShippingConfig : null;
  }

  async setConfig(cfg: ShippingConfig): Promise<void> {
    await this.redis.set(
      ShippingRuleCache.CONFIG_KEY,
      JSON.stringify(cfg),
      ShippingRuleCache.TTL_MS,
    );
  }

  async invalidate(): Promise<void> {
    await this.redis.del(ShippingRuleCache.RULES_KEY, ShippingRuleCache.CONFIG_KEY);
  }
}
```

- [x] **Step 2: 注册到 `ShippingRuleModule` providers + exports**

`RedisCoordinatorService` 已由 `backend/src/common/infra/infra.module.ts` 作为全局服务导出，不要新增 `@Inject('REDIS')` 裸 Redis provider。

**Verify:** `npm run build` 通过；模块装配后 `ShippingRuleCache` 在依赖图中可见。

---

### Task 3: Shipping Rule Calculation Engine

**Files:**
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.service.ts`
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.service.spec.ts`

- [x] **Step 1: `ShippingCalculationResult` 类型与服务边界**

```ts
export type ShippingCalculationResult = {
  fee: number;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  billingWeightKg: number;
  formula: string;
  fallbackUsed: boolean;
};

async calculateShippingDetail(
  goodsAmount: number,
  regionCode: string,
  totalWeightGram: number,
  tx?: Prisma.TransactionClient,
): Promise<ShippingCalculationResult>;
```

- [x] **Step 2: 整数化计算**

```ts
const billingWeightG = Math.max(totalWeightGram, Math.round(rule.minChargeWeightKg * 1000));
const firstWeightG = Math.round(rule.firstWeightKg * 1000);
const additionalUnitG = Math.round(rule.additionalWeightKg * 1000);
const firstFeeCent = Math.round(rule.firstFee * 100);
const additionalFeeCent = Math.round(rule.additionalFee * 100);

let feeCent: number;
if (billingWeightG <= firstWeightG) {
  feeCent = firstFeeCent;
} else {
  const extraUnits = Math.ceil((billingWeightG - firstWeightG) / additionalUnitG);
  feeCent = firstFeeCent + extraUnits * additionalFeeCent;
}
const fee = feeCent / 100;
```

`formula` 文本拼接成 `"9.1 + ceil((4200g - 3000g) / 1000g) * 1.3 = 11.7"` 便于 preview 展示。

- [x] **Step 3: 匹配规则与稳定排序**

```ts
const candidates = rules
  .filter(r => r.isActive)
  .filter(r => regionMatches(r.regionCodes, regionCode))
  .sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
const matched = candidates[0] ?? null;
if (!matched) {
  const fallbackWeightKg = Math.max(totalWeightGram, 1000) / 1000;
  return {
    fee: DEFAULT_SHIPPING_FEE,
    matchedRuleId: null,
    matchedRuleName: null,
    billingWeightKg: fallbackWeightKg,
    formula: `fallback DEFAULT_SHIPPING_FEE = ${DEFAULT_SHIPPING_FEE}`,
    fallbackUsed: true,
  };
}
```

`regionMatches`：空数组 → 全国命中；否则按 `regionCode.slice(0, 2)` 与规则项前两位比较。

- [x] **Step 4: 缓存接入**

读路径优先 `cache.getActiveRules()`，miss 时查 DB 并 `cache.setActiveRules(rows)`。

- [x] **Step 5: 保留 `calculateShippingFee()` 兼容签名**

```ts
async calculateShippingFee(
  goodsAmount: number,
  regionCode: string,
  totalWeightGram: number,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const detail = await this.calculateShippingDetail(
    goodsAmount,
    regionCode,
    totalWeightGram,
    tx,
  );
  return detail.fee;
}
```

- [x] **Step 6: 单元测试**

新增/扩展用例（必须全部通过）：

1. 广东 3kg 内 → 首重价。
2. 广东 4.2kg → 首重价 + 2 个续重（防浮点 bug：`totalWeightGram = 4200`，`ceil((4200 - 3000) / 1000) = 2`）。
3. 同 priority 多条规则 → 按 id 升序稳定命中。
4. 全国 priority=100 vs 广东 priority=50 + 广东订单 → 全国命中（priority 绝对优先，用于管理员强制覆盖）。
5. 全国 priority=50 vs 广东 priority=100 + 广东订单 → 广东命中（地区规则通过更高 priority 覆盖全国默认）。
6. 含赠品 SKU 时总重量正确累加。
7. 无规则命中 → `DEFAULT_SHIPPING_FEE` 且 `fallbackUsed = true`。
8. 缓存命中跳过 DB 查询；写操作后缓存被清。

**Verify:** `npm test -- shipping-rule.service.spec.ts` 全绿。

---

### Task 4: Shipping Rule DTO And Validation Hardening

**Files:**
- Modify `backend/src/modules/admin/shipping-rule/dto/create-shipping-rule.dto.ts`
- Modify `backend/src/modules/admin/shipping-rule/dto/update-shipping-rule.dto.ts`

- [x] **Step 1: `firstFee` 必填 + `> 0`**

```ts
@IsNumber()
@IsPositive()
firstFee!: number;

@IsNumber()
@Min(0)
additionalFee!: number;

@IsNumber()
@IsPositive()
firstWeightKg!: number;

@IsNumber()
@IsPositive()
additionalWeightKg!: number;

@IsNumber()
@Min(0)
minChargeWeightKg!: number;
```

`UpdateShippingRuleDto` 沿用 `PartialType` 但保持上述约束在被传入时生效。

- [x] **Step 2: 控制器写操作后清缓存**

```ts
async create(dto: CreateShippingRuleDto) {
  const row = await this.svc.create(dto);
  await this.cache.invalidate();
  return row;
}
```

`update / remove / toggle / import` 同样处理。

**Verify:** `npm run build` 通过；POST `firstFee = 0` 返回 400。

---

### Task 5: Shipping Rule Import Service

**Files:**
- Create `backend/src/modules/admin/shipping-rule/dto/import-shipping-rule.dto.ts`
- Create `backend/src/modules/admin/shipping-rule/shipping-rule-import.service.ts`
- Create `backend/src/modules/admin/shipping-rule/shipping-rule-import.service.spec.ts`
- Modify `backend/src/modules/admin/shipping-rule/shipping-rule.controller.ts`

- [x] **Step 1: DTO**

```ts
export class ImportShippingRuleDto {
  @IsIn(['csv', 'json']) format!: 'csv' | 'json';
  @IsString() payload!: string;
  @IsBoolean() @IsOptional() dryRun?: boolean;
}

export type ImportPreview = {
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
};
```

- [x] **Step 2: 解析 + 校验**

CSV 严格 RFC 4180（用 `papaparse` 或自实现状态机），regionCodes 内层 `|` 分隔。JSON 直接 `JSON.parse`。

校验逐行调用 `class-validator` 跑 `CreateShippingRuleDto`。任意 error 累积到 `errors[]`，**全部成功**才允许 `dryRun=false` 落库。

- [x] **Step 3: upsert 策略**

按 `name` 匹配现有记录：存在 → update（diff 不变则计入 `unchanged`）；不存在 → create。**不删除**导入文件中缺失的记录。

落库使用 Serializable 事务。完成后 `cache.invalidate()`。

- [x] **Step 4: Controller**

```text
POST /admin/shipping-rules/import     // dryRun=true 返回预检查
POST /admin/shipping-rules/import     // dryRun=false 落库
GET  /admin/shipping-rules/template   // 返回 CSV 模板字符串
```

- [x] **Step 5: 单元测试**

1. CSV 含 `,` 字段被双引号包裹时正确解析。
2. regionCodes `"35|43|45|36"` 解析为 4 元素数组。
3. 任意一行错误 → 全部不写入 + 逐行错误。
4. dryRun 返回 `{ toCreate, toUpdate, unchanged }` 三项。
5. 落库后缓存被清。
6. 不删除文件中缺失的记录。

**Verify:** `npm test -- shipping-rule-import` 全绿；手工 POST CSV 模板 dryRun 返回三项数字。

---

### Task 6: Checkout Session Shipping Lock-In

**Files:**
- Modify `backend/src/modules/order/checkout.service.ts`
- Modify `backend/src/modules/order/checkout.service.spec.ts`

- [x] **Step 1: 预结算与 CheckoutSession 创建使用 `calculateShippingDetail`**

预结算返回 `summary.totalShippingFee` + （可选）`shippingFormula` 用于将来透出。CheckoutSession 创建时把当前算得的 `fee` 写入 `CheckoutSession.shippingFee`，**不再在支付回调里重算**。

- [x] **Step 2: 整单 SKU 重量包含赠品/奖品**

```ts
const totalWeightGram = items
  .filter(it => it.isShippable !== false) // 默认全部参与
  .reduce((acc, it) => acc + (it.sku.weightGram ?? 1000) * it.quantity, 0);
```

赠品（VIP / 阈值 / 抽奖奖品）的 `cartItem.sku.weightGram` 都参与累加。

- [x] **Step 3: 支付回调直接使用 `session.shippingFee`**

`CheckoutService.handlePaymentSuccess()` 拆子订单时按商品金额比例分摊 `session.shippingFee`，不重新调用 `calculateShippingFee`。

- [x] **Step 4: 测试**

1. `CheckoutSession` 创建后修改 `ShippingRule.firstFee`，session 仍使用创建时锁定的运费。
2. 含赠品 SKU 的订单总重量等于普通商品 + 赠品的 `weightGram × quantity` 之和。
3. 拆单后子订单 `shippingFee` 总和 = `session.shippingFee`（误差 ≤ 1 分由分摊算法兜底）。

**Verify:** `npm test -- checkout.service.spec.ts` 全绿。

---

### Task 7: Order Shipping Cost Recording

**Files:**
- Create `backend/src/modules/shipment/order-shipping-cost.service.ts`
- Create `backend/src/modules/shipment/order-shipping-cost.service.spec.ts`
- Modify `backend/src/modules/shipment/sf-express.service.ts`
- Modify `backend/src/modules/shipment/shipment.module.ts`
- Modify `backend/src/modules/seller/shipping/seller-shipping.service.ts`

- [x] **Step 1: Service skeleton**

```ts
@Injectable()
export class OrderShippingCostService {
  private readonly logger = new Logger(OrderShippingCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordPackage(input: {
    orderId: string;
    packageIndex: number;
    companyId?: string;
    sfOrderId: string;
    weightGramSent: number;
    estimatedCost?: number;
  }, tx?: Prisma.TransactionClient): Promise<OrderShippingCost | null> {
    const db = tx ?? this.prisma;

    try {
      return await db.orderShippingCost.upsert({
        where: { sfOrderId: input.sfOrderId },
        create: {
          orderId: input.orderId,
          packageIndex: input.packageIndex,
          companyId: input.companyId ?? null,
          sfOrderId: input.sfOrderId,
          weightGramSent: input.weightGramSent,
          estimatedCost: input.estimatedCost,
        },
        update: {
          orderId: input.orderId,
          packageIndex: input.packageIndex,
          companyId: input.companyId ?? null,
          weightGramSent: input.weightGramSent,
          estimatedCost: input.estimatedCost,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `OrderShippingCost 写入失败，不阻塞发货: sfOrderId=${input.sfOrderId}, err=${err.message}`,
      );
      return null;
    }
  }

  async reconcile(sfOrderId: string, actualCost: number): Promise<void> {
    await this.prisma.orderShippingCost.update({
      where: { sfOrderId },
      data: { actualCost, reconciledAt: new Date() },
    });
  }
}
```

- [x] **Step 1.5: 注册并导出服务**

在 `ShipmentModule` 的 `providers` 加入 `OrderShippingCostService`，并在 `exports` 同时导出 `SfExpressService` 与 `OrderShippingCostService`，供 `SellerShippingModule` 中的 `SellerShippingService` 注入使用。

- [x] **Step 2: SF 下单成功后调用**

修改 `SellerShippingService.generateWaybill()`：当前 `orderItem.findMany()` 只查询商品标题，需要补充 `sku.weightGram`；`createCarrierWaybill()` 返回 `weightGramSent`；顺丰下单和 `Shipment` 写入成功后调用：

```ts
await this.shippingCost.recordPackage({
  orderId: order.id,
  packageIndex: 0,
  companyId,
  sfOrderId: waybillResult.sfOrderId,
  weightGramSent: waybillResult.weightGramSent,
}, tx);
```

当前正向发货按 `orderId + companyId` 生成一个顺丰包裹，`packageIndex` 固定 0；如未来一个商户拆多包，再按同一订单同一商户内的包裹顺序递增。

- [x] **Step 3: SF 下单传真实重量**

修改 `SellerShippingService.createCarrierWaybill()` 的 `items` 类型为 `{ name: string; quantity: number; weightGram: number }`：

```ts
const totalWeightGram = items.reduce(
  (sum, item) => sum + item.weightGram * item.quantity,
  0,
);
const totalWeightKg = Math.max(totalWeightGram / 1000, 1);

const orderResult = await this.sfExpress.createOrder({
  orderId: `${orderId}_${companyId}`,
  sender: {
    name: senderInfo.senderName,
    tel: senderInfo.senderPhone,
    province: senderInfo.senderProvince,
    city: senderInfo.senderCity,
    district: senderInfo.senderDistrict,
    detail: senderInfo.senderDetail,
  },
  receiver: {
    name: recipientInfo.name,
    tel: recipientInfo.phone,
    province: recipientInfo.province,
    city: recipientInfo.city,
    district: recipientInfo.district,
    detail: recipientInfo.detail,
  },
  cargo,
  totalWeight: totalWeightKg,
  packageCount: 1,
});
```

`SfExpressService.createOrder()` 继续接收 kg 单位的 `totalWeight`，不要在该 service 内再猜测克/千克单位。

- [x] **Step 4: 测试**

1. 下单成功后 `OrderShippingCost` 写入正确字段（`sfOrderId`、`weightGramSent`、`packageIndex`）。
2. 重复 `sfOrderId` 调用 `recordPackage()` 走 upsert 幂等更新，不抛错。
3. `reconcile()` 回填 `actualCost` + `reconciledAt`。
4. 取消面单不写入 `actualCost`。
5. 极端情况下 `totalWeight = 0` 时传 1kg。
6. `OrderShippingCost` 写入异常只记录 warn，不影响 `Shipment` 创建和发货返回。

**Verify:** `npm test -- order-shipping-cost.service.spec.ts` 全绿；SF 沙箱手工下一单后查 `order_shipping_costs` 表有记录。

---

### Task 8: SKU Weight Required In Seller Backend

**Files:**
- Modify `backend/src/modules/seller/products/seller-products.dto.ts`
- Modify `backend/src/modules/seller/products/seller-products.service.ts`
- Modify `seller/src/pages/products/components/SkuEditor.tsx`（实际文件名以仓库为准，按 `weightGram` grep 定位）

- [x] **Step 1: DTO 改必填**

```ts
@IsInt()
@IsPositive()
weightGram!: number;
```

- [x] **Step 2: Service 校验**

`createProduct / updateProduct` 中 SKU 子项保存前显式校验 `weightGram > 0`，否则抛 `BadRequestException`。

- [x] **Step 3: 卖家前端表单**

`weightGram` 标记必填，提示文案："包装后重量（克），用于计算运费和顺丰面单。"

**Verify:** `npm run build`（backend + seller）通过；卖家后台保存空 weightGram → 表单报错。

---

### Task 9: Admin Shipping Rule Page Upgrade

**Files:**
- Modify `admin/src/api/shipping-rules.ts`
- Modify `admin/src/pages/shipping-rules/index.tsx`
- Create `admin/src/pages/shipping-rules/components/ImportDialog.tsx`
- Create `admin/src/pages/shipping-rules/components/PreviewPanel.tsx`

- [x] **Step 1: API 客户端方法**

```ts
listRules()
createRule(data)
updateRule(id, data)
deleteRule(id)
previewRule({ goodsAmount, regionCode, totalWeight })
importRulesDryRun({ format, payload })
importRules({ format, payload })
downloadTemplate()
```

- [x] **Step 2: 列表页**

ProTable 字段：规则名 / 地区范围 / 首重重量 / 首重价 / 续重单位 / 续重价 / 优先级 / 状态 / 更新时间 / 操作。

- [x] **Step 3: 新增/编辑表单**

ProForm 字段（`firstFee` 必填）：名称、地区编码（留空 = 全国）、首重重量 kg、首重价、续重单位 kg、续重价、最小计费重量 kg、优先级、启用。

- [x] **Step 4: 预览面板**

输入：地区、商品金额、整单重量。展示：命中规则、计算公式（含 `formula` 文本）、`fallbackUsed` 高亮。

- [x] **Step 5: 批量导入对话框**

- 文本框粘贴（CSV/JSON 切换 tab）。
- "下载模板" 按钮（GET `/admin/shipping-rules/template`）。
- 第一步 dryRun → 展示 `{ toCreate, toUpdate, unchanged, errors }`。
- 用户确认后落库；落库后 `queryClient.invalidateQueries(['shipping-rules'])`。

- [x] **Step 6: 用 `App.useApp()` 拿 message/modal hook**

避免静态 `message.success()` / `Modal.confirm()` 在 `<AntdApp>` 包裹下静默失效（AGENTS.md / CLAUDE.md 禁令）。

**Verify:** `npm run build`（admin）通过；本地起 dev 跑通新增/编辑/预览/导入/批量导入 dry-run 与落库。

---

### Task 10: Documentation Sync

**Files:**
- Modify `docs/architecture/data-system.md`
- Modify `docs/features/shipping.md`
- Modify `docs/features/plan-treeforuser.md`
- Modify `docs/issues/app-tofix3.md`
- Modify `docs/architecture/sales.md`
- Modify `docs/architecture/seller.md`
- Modify `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md`
- Modify `AGENTS.md`
- Modify `CLAUDE.md`（如继续维护该入口）
- Modify `plan.md`

- [x] **Step 1: data-system.md**

新增 `OrderShippingCost` 表定义 + `ShippingRule` 字段升级（去掉旧 minWeight/maxWeight 注释为废弃）。

- [x] **Step 2: shipping.md**

记录顺丰风格平台统一运费计价（首重 + 续重、地区组、缓存策略、SKU 重量必填、`OrderShippingCost` 月结对账）。

- [x] **Step 3: plan-treeforuser.md**

替换旧"金额区间 × 地区 × 重量固定费"段落，引用本 spec。

- [x] **Step 4: app-tofix3.md**

Bug 33 / 34 / 56 状态：标记修复路径走本 spec，引用 plan 文件。

- [x] **Step 5: AGENTS.md**

登记 `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md` + `docs/superpowers/plans/2026-05-08-sf-style-shipping-pricing.md`，并把平台运费计价关键决策更新为本计划口径。

- [x] **Step 6: CLAUDE.md（如继续维护该入口）**

「关键架构决策」表格新增条目：

```
| 运费计价 | 顺丰风格"首重+续重"公式，多商户订单合并计费亏损由平台承担。`OrderShippingCost` 记录每个顺丰包裹真实成本，月结对账后回填 `actualCost` |
```

「相关文档」列表新增 spec / plan 引用。

- [x] **Step 7: plan.md**

上线冲刺新增本批次（运费计价升级 + SKU 重量必填 + 真实成本沉淀），勾选状态留空。

- [x] **Step 8: sales.md / seller.md**

同步卖家商品 SKU 重量必填口径，避免卖家端权威文档继续写"选填"。

- [x] **Step 9: sf-style-shipping-pricing-design.md**

清理旧"保留金额区间字段则继续支持金额过滤"残留，明确 `minAmount/maxAmount/minWeight/maxWeight/fee` 仅作为旧数据兼容与回滚兜底字段。

**Verify:** 所有权威文档可在 `AGENTS.md` 入口找到引用；如保留 `CLAUDE.md`，其关键架构决策与 `AGENTS.md` 一致。

---

### Task 11: End-to-End Verification

- [x] **Step 1: TypeScript 全量编译**

```bash
cd backend && npx tsc -b
cd ../admin && npm run build
cd ../seller && npm run build
```

- [x] **Step 2: 后端测试套件**

```bash
cd backend && npm test
```

- [x] **Step 3: 启动审查 Agent（subagent_type: Explore）**

按 AGENTS.md 第 9 条「代码审查」流程。审查重点：

- 公式计算的整数化是否完整（不再有 `Math.ceil` 直接吃浮点的代码路径）。
- 写操作（create/update/delete/import/toggle）后是否都调用 `cache.invalidate()`。
- `CheckoutSession.shippingFee` 是否在所有支付回调路径都直接读取，没有重算。
- `OrderShippingCost` 的写入是否覆盖所有 SF 下单成功路径（含发货补偿、重试）。
- 导入服务是否真的不删除（grep `deleteMany` / `delete` 排除嫌疑）。
- DTO `firstFee` 必填校验是否在 update 路径也生效。

主 Agent 收到报告后修复所有 High/Critical，Medium 决策修或留，Low 记录。

- [ ] **Step 4: 手工冒烟（待 staging / SF 沙箱环境执行）**

- 管理后台新增一条全国规则（首重 3kg / 9 元，续重 1kg / 1 元）。
- 修改一个 SKU 重量 → 检查买家 App 预结算运费随之变化。
- 触发 SF 沙箱下单 → 查 `order_shipping_costs` 表新增记录。
- CheckoutSession 创建后立刻改规则 → 该 session 支付后子订单 shippingFee 仍是创建时锁定值。

- [ ] **Step 5: 与用户确认推送范围**

不自动 push。整理本批次 commits，复述要推送的内容（schema + 后端 + admin + seller + 文档），向用户确认推 staging 还是 main，按 AGENTS.md 第 10 条规则操作。

**Verify:** 所有自动化与手工冒烟通过；用户确认后 push。

---

## Risk & Rollback

| 风险 | 影响 | 回滚 |
|------|------|------|
| `firstFee` 改必填 + 历史脏数据 | 迁移失败 | Step 4 SQL 先回填，再加 NOT NULL；如失败：`prisma migrate resolve --rolled-back <name>` + 还原 schema |
| Redis 缓存与 DB 不同步 | 规则改后买家 60s 内仍按旧规则计费 | 写后强制 `invalidate()`；监控 cache miss 率 |
| 浮点 `ceil` 残留旧路径 | 偶发多收 1 段续重 | 单测覆盖 `4.2kg` 边界；审查 Agent grep `Math.ceil.*-` |
| `OrderShippingCost` 写入失败影响下单 | 顺丰下单成功但成本未记录 | 写入失败只 warn 不抛错（不影响主流程），月结对账时按 `sfOrderId` 反查补录 |
| 导入误删全表 | 现有规则丢失 | 设计上 `import-service` 只 upsert 不 delete；审查 grep 校验；可回滚 commit |
| SKU `weightGram` 改必填影响历史商品 | 卖家保存历史商品报错 | Step 4 SQL 全量回填 1000g；回滚把 schema 改回 `Int?` |
