# 顺丰风格平台统一运费计价设计方案

日期：2026-05-08（最后更新：2026-05-10）

## 1. 背景

平台当前已经统一对接顺丰丰桥，所有发货履约由平台承担并通过平台月结账号处理。买家侧现有运费链路是“满额包邮，不满额收运费”，且多商户订单按整单只收一次运费；支付成功后拆成多个商户订单时，再把 `CheckoutSession.shippingFee` 按商户商品金额比例分摊到各子订单。

当前 `ShippingRule` 的规则模型是“地区 + 金额区间 + 重量区间 + 固定运费”。这可以表达 `0-3kg = 9.1 元`、`3-4kg = 10.4 元`，但不适合维护类似顺丰协议价表的“首重 + 续重”计价方式。规则数量会随着地区和重量段快速膨胀。

本设计将买家侧运费改成顺丰风格公式计价：按平台后台维护的地区组、首重价、续重价计算。价格完全由平台自行设置，不调用顺丰实时计价接口，也不在代码中体现平台与顺丰或商户的真实谈判价格。

### 1.1 多商户订单成本与亏损口径（业务确认）

多商户订单按"整单 SKU 总重量"计算一条规则的运费，但实际履约可能是多个商户独立顺丰包裹（每个包裹各自计首重）。买家收的运费 < 平台真实顺丰月结成本。

**业务决策**：接受这部分差额作为补贴用户的成本，**不调整买家计费逻辑**（不按商户数 × 首重）。

但平台需要在后端记录每个包裹的真实承运成本（顺丰月结对账后回填），用于：

- 月度顺丰账单核对
- "买家收入运费 vs 平台实付成本"亏损量统计
- 按商户聚合履约成本，为未来商户分摊运费成本预留字段

详见第 5.2 节 `OrderShippingCost` 模型。

### 1.2 与售后系统的边界

退换货链路的退货/回寄面单运费规则、商家责任记录、买家先付运费等场景**不在本 spec 范围**，详见 `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md`。

售后退货面单成本写入 `AfterSaleRequest.returnShippingFee`（售后 spec 定义），**不写入** `OrderShippingCost`，避免两份数据互相覆盖。`OrderShippingCost` 仅记录正向发货包裹成本。

参考资料：
- 顺丰标快公开说明：不同线路价格不同，采用首重 + 续重计费模式。<https://www.sf-express.com/chn/sc/express/delivery/standard>
- 顺丰运费时效查询/计费规则：按寄件地、收件地、重量、体积测算；计费重量与进位规则由承运商定义。<https://www.sf-express.com/chn/en/price-query>

## 2. 目标

1. 保留现有买家侧商业口径：满额包邮，不满额按平台规则收运费，买家支付的运费归平台。
2. 保留现有多商户口径：整单只收一次运费，平台统一承担顺丰履约成本。
3. 将“不满免邮门槛时的运费计算”升级为顺丰风格公式：首重价 + 续重价。
4. 管理后台支持平台手动维护价格，并支持批量文本导入。
5. 修复重量链路缺口：SKU 重量必填，顺丰下单传真实总重量。

## 3. 非目标

1. 不接入顺丰实时运费查询。
2. 不按商户包裹分别向买家计费（多商户订单合并计费的亏损由平台承担，见 1.1）。
3. 第一版不支持体积重量，因为当前商品/SKU 模型没有包装长宽高字段。
4. 第一版不做 Excel 上传，批量导入采用文本粘贴。
5. 退换货运费规则不在本 spec 范围，详见 `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md`。
6. 不在本期实现"按商户分摊真实承运成本"的对账系统；`OrderShippingCost` 仅做数据沉淀，对账报表后续单独立项。

## 4. 核心业务规则

买家侧运费计算顺序：

```text
1. 读取普通/VIP 免邮门槛
2. 如果商品金额达到门槛：运费 = 0
3. 未达到门槛：按收货地区 + 整单 SKU 总重量匹配启用的 ShippingRule
4. 命中公式规则：按首重/续重计算运费
5. 无规则命中：使用 DEFAULT_SHIPPING_FEE 兜底
```

整单 SKU 重量合计的口径（业务确认）：

- **包含**所有要寄出的商品，含 VIP 赠品、阈值赠品、抽奖奖品。
- 重量基础来自 `ProductSKU.weightGram`（必填）。

公式：

```text
计费重量kg = max(整单 SKU 重量合计kg, 最小计费重量kg)

如果 计费重量kg <= 首重重量kg：
  运费 = 首重价
否则:
  运费 = 首重价 + ceil((计费重量kg - 首重重量kg) / 续重单位kg) * 续重价
```

为避免浮点精度（如 `4.2 - 3 = 1.2000000000000002` 导致 `ceil` 多算一段续重），实现时**内部按整数克 + 整数分计算**，对外仍返回元（Float）：

```ts
const billingWeightG = Math.max(totalWeightGram, minChargeWeightKg * 1000);
const firstWeightG = firstWeightKg * 1000;
const additionalUnitG = additionalWeightKg * 1000;
const firstFeeCent = Math.round(firstFee * 100);
const additionalFeeCent = Math.round(additionalFee * 100);

let feeCent: number;
if (billingWeightG <= firstWeightG) {
  feeCent = firstFeeCent;
} else {
  const extraUnits = Math.ceil((billingWeightG - firstWeightG) / additionalUnitG);
  feeCent = firstFeeCent + extraUnits * additionalFeeCent;
}
return feeCent / 100;
```

示例：

```text
广东规则：首 3kg = 9.1 元，续重每 1kg = 1.3 元
订单重量：4.2kg
运费：9.1 + ceil((4.2 - 3) / 1) * 1.3 = 11.7 元
```

## 5. 数据模型

### 5.1 ShippingRule

在现有 `ShippingRule` 上新增公式字段。旧固定价字段保留一版用于迁移兼容，但主逻辑不再依赖固定重量区间。

```prisma
model ShippingRule {
  id                 String   @id @default(cuid())
  name               String
  regionCodes        String[]

  // 兼容旧字段：保留一版，不作为新主逻辑
  minAmount          Float?
  maxAmount          Float?
  minWeight          Int?
  maxWeight          Int?
  fee                Float    @default(0) // 兼容旧字段，迁移后可写入 firstFee

  // 新公式字段，单位由字段名明确
  // firstFee / additionalFee 故意不设默认值：漏配时立即报错，避免 0 + 续重价静默生效
  firstWeightKg      Float    @default(3)
  firstFee           Float
  additionalWeightKg Float    @default(1)
  additionalFee      Float
  minChargeWeightKg  Float    @default(1)

  priority           Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

字段约束（Service / DTO 层强校验）：

```text
firstWeightKg > 0
firstFee > 0
additionalWeightKg > 0
additionalFee >= 0
minChargeWeightKg >= 0
```

保留系统配置：

```text
NORMAL_FREE_SHIPPING_THRESHOLD
VIP_FREE_SHIPPING_THRESHOLD
DEFAULT_SHIPPING_FEE
```

`DEFAULT_SHIPPING_FEE` 仅作为漏配兜底。后台仍建议配置一条全国默认公式规则：

```text
regionCodes = []
priority = 0
isActive = true
```

### 5.2 OrderShippingCost（新增）

记录每个顺丰包裹的真实承运成本，用于月结对账与统计。多商户订单一个 Order 可能有多条记录，每条对应一个顺丰包裹。

```prisma
model OrderShippingCost {
  id              String   @id @default(cuid())
  orderId         String
  order           Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  packageIndex    Int                  // 多商户订单的第几个包裹，单商户固定 0
  companyId       String?              // 哪个商户的发货包裹，便于按商户聚合
  sfOrderId       String   @unique     // 顺丰单号
  weightGramSent  Int                  // 顺丰面单填写的重量
  estimatedCost   Float?               // 创建面单时的预估成本（占位）
  actualCost      Float?               // 月结对账后回填的真实成本
  reconciledAt    DateTime?            // 对账完成时间
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([orderId])
  @@index([companyId, createdAt])
  @@index([reconciledAt])
  @@map("order_shipping_costs")
}
```

写入时机：

- 顺丰下单成功（`SfExpressService.createOrder` 返回 `sfOrderId`）后，由发货链路写入一条记录，`actualCost` 留空。
- 月结对账由独立任务/管理后台导入功能回填 `actualCost` 和 `reconciledAt`。

注意：

- 退货/回寄面单**不写入**本表，售后侧用 `AfterSaleRequest.returnShippingFee`。
- 取消面单的记录保留，但不再回填成本（取消后顺丰不计费）。

## 6. 后端计算引擎

保留现有 `ShippingRuleService.calculateShippingFee()` 的数字返回，避免大范围改动订单调用方；新增详情方法供管理后台预览和测试断言使用。

```ts
type ShippingCalculationResult = {
  fee: number;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  billingWeightKg: number;
  formula: string;
  fallbackUsed: boolean;
};
```

服务边界：

```ts
calculateShippingFee(goodsAmount, regionCode, totalWeightGram, tx?): Promise<number>
calculateShippingDetail(goodsAmount, regionCode, totalWeightGram, tx?): Promise<ShippingCalculationResult>
```

`calculateShippingFee()` 内部调用 `calculateShippingDetail()` 并返回 `result.fee`。

匹配规则（伪代码权威版）：

```ts
const candidates = rules
  .filter(r => r.isActive)
  .filter(r => regionMatches(r.regionCodes, regionCode))   // 空数组 = 全国
  .sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const specificity = Number(b.regionCodes.length > 0) - Number(a.regionCodes.length > 0);
    if (specificity !== 0) return specificity;               // 同 priority 地区规则优先于全国
    return a.id.localeCompare(b.id);                         // 同类型按 id 升序，保证稳定
  });
return candidates[0] ?? null;  // 无命中时返回 DEFAULT_SHIPPING_FEE，fallbackUsed = true
```

补充说明：

1. 地区匹配沿用当前省级前缀规则：`regionCode.slice(0, 2)` 与规则地区码前两位比较，空数组表示全国。
2. 同 priority 下地区规则优先于全国规则；同类型多条规则按 `id` 升序兜底，避免 DB 顺序漂移。
3. `minAmount/maxAmount/minWeight/maxWeight/fee` 仅作为旧数据兼容与回滚兜底字段保留；当前顺丰风格计价不再按金额区间或重量区间匹配，低客单价特殊运费应通过新增显式业务字段另行设计。
4. 命中后使用公式字段计算（见第 4 节）。

### 6.1 缓存策略

`ShippingRule` 是结算热路径，每次预结算/结账都查 DB 性能差。

- 缓存全量启用规则 + 系统配置到 Redis，TTL **60 秒**。
- 管理后台的所有写操作（create / update / delete / import / toggle isActive）后**主动失效**：

```ts
await cache.del('shipping-rules:active');
await cache.del('shipping-config');
```

- 读路径：先读缓存，miss 后回 DB 并回填缓存。
- 用户感知："管理后台改规则后**最长 60 秒**生效；主动失效场景立即生效。"

### 6.2 重量与运费锁定

预结算和下单仍按整单汇总重量计算一次运费：

```text
totalWeight = sum(sku.weightGram * quantity)  // 包含赠品/奖品 SKU
```

**CheckoutSession 创建时计算并写入 `shippingFee`，支付回调直接使用 session 上锁定的运费，不重新计算**。这避免了"管理员上线新规则的同时有用户在结算"的口径漂移。

支付回调拆子订单时，继续按商品金额比例分摊 `CheckoutSession.shippingFee`，维持当前订单金额口径。

## 7. 管理后台

运费规则页改为公式规则管理。

列表字段：

```text
规则名称
地区范围
首重重量
首重价
续重单位
续重价
状态
更新时间
```

新增/编辑表单：

```text
规则名称
适用地区省份多选，留空 = 全国
首重重量 kg，默认 3
首重价 元
续重单位 kg，默认 1
续重价 元
最小计费重量 kg，默认 1
启用/停用
```

手动新增/编辑时，管理后台展示省份/自治区/直辖市标签，例如 `广东省`、`福建省`。前端提交给后端的 `regionCodes` 是行政区划省级前缀，例如 `44`、`35`，不是邮政编码；邮政编码不参与运费规则匹配。

`priority` 保留为平台内部兜底字段，不在管理后台常规表格、表单和下载模板中展示。规则同优先级时，地区规则优先于全国默认规则，再按 `id` 升序稳定命中，避免运营需要理解“优先级”概念。

预览测试保留并显示计算过程：

```text
输入：广东，4.2kg，商品金额 50 元
命中规则：广东 3KG 首重
计算：9.1 + ceil((4.2 - 3) / 1) × 1.3 = 11.7
结果：¥11.70
```

批量导入第一版采用文本粘贴，支持 CSV 和 JSON 两种格式：

CSV 示例：

```csv
name,regionCodes,firstWeightKg,firstFee,additionalWeightKg,additionalFee,isActive
广东省,"44",3,9.1,1,1.3,true
福建湖南广西江西,"35|43|45|36",3,10,1,2.3,true
```

JSON 示例：

```json
[
  {
    "name": "广东省",
    "regionCodes": ["44"],
    "firstWeightKg": 3,
    "firstFee": 9.1,
    "additionalWeightKg": 1,
    "additionalFee": 1.3,
    "isActive": true
  }
]
```

导入策略：

1. **格式约定**：CSV 严格遵循 RFC 4180（字段含 `,` 必须用双引号包裹，双引号转义为 `""`）；regionCodes 内层用 `|` 分隔。后台提供"下载模板"按钮，避免用户用 Excel 默认 CSV 导出踩格式坑。
2. **upsert 主键**：按 `name` 匹配。已存在则更新，不存在则新增。前端提示用户"名称重复将覆盖"，不强制 DB 唯一索引（避免历史脏数据迁移失败）。
3. **只增量、不删除**：导入文件中没有的现有规则**保持不变**。删除规则只能从管理后台逐条操作，避免误传一份不完整的文件清空全表。
4. **预检查 + 二次确认**：先校验全部行，任意错误则全部不写入并逐行返回错误；校验通过后返回 `{ toCreate, toUpdate, unchanged }` 三个数字，用户确认后才落库。
5. 导入后清缓存（见 6.1）并刷新列表，可立即预览。

## 8. SKU 重量与顺丰下单

为了让运费计算和顺丰面单重量一致，需要补齐两个链路：

1. 卖家商品 SKU 重量改必填，表单提示单位为克。
2. 已有商品如果 `weightGram = null`，迁移时补默认 `1000g`。
3. 顺丰面单生成时查询 SKU `weightGram`，传给 `SfExpressService.createOrder.totalWeight`。
4. 如果极端情况下重量仍为 0，顺丰下单传 `1kg`，避免承运商按空重量处理。

这会解决 `docs/issues/app-tofix3.md` 中 Bug 33 描述的 0kg/空重量问题。

## 9. API 契约

管理端接口保持路径不变：

```text
GET    /admin/shipping-rules
POST   /admin/shipping-rules
PUT    /admin/shipping-rules/:id
DELETE /admin/shipping-rules/:id
POST   /admin/shipping-rules/preview
POST   /admin/shipping-rules/import
```

`preview` 返回：

```json
{
  "fee": 11.7,
  "input": {
    "goodsAmount": 50,
    "regionCode": "44",
    "totalWeight": 4.2
  },
  "matchedRule": {
    "id": "rule-id",
    "name": "广东省"
  },
  "billingWeightKg": 4.2,
  "formula": "9.1 + ceil((4.2 - 3) / 1) * 1.3",
  "fallbackUsed": false
}
```

买家 App 的订单预览接口可以继续只依赖：

```text
summary.totalShippingFee
summary.amountToFreeShipping
```

如后续要展示“运费怎么算”，再透出 `shippingFormula`。

## 10. 迁移策略

1. Schema 增加公式字段时，迁移 SQL 先回填历史数据，再加 NOT NULL 约束；运行期 `firstFee / additionalFee` 不设默认值，漏配立即报错。
2. 迁移已有种子规则为公式规则：
   - 全国默认：首重 3kg，首重价可沿用当前标准运费或按平台填写，续重价必须回填为真实价格；当前种子和老库迁移默认使用 1.3 元/kg，且通过 follow-up migration 修正已执行旧迁移的环境。
   - 新疆/西藏等偏远地区用地区规则覆盖全国默认，续重价应高于全国默认；当前种子示例分别为 5.1 元/kg、7.1 元/kg。`priority` 仅作内部兜底，不在常规运营页面展示。
   - 旧规则迁移时 `firstFee = fee`，`fee` 继续保留为兼容字段。
3. 生产上线前在管理后台检查至少有一条全国默认公式规则。
4. 保留 `DEFAULT_SHIPPING_FEE`，避免地区规则漏配导致结算失败。
5. 旧字段保留一版，待公式规则稳定后再单独计划清理。

顺丰成本记录的 `OrderShippingCostService.recordPackage()` 按 `sfOrderId` 做幂等 upsert；重复调用应更新同一记录，不抛 duplicate 错。该记录只服务平台月结对账，写入失败只记录 warn 并返回空结果，不阻塞顺丰面单生成、`Shipment` 创建或卖家发货链路。

## 11. 测试清单

后端单元测试：

1. 广东 3kg 内返回首重价。
2. 广东 4.2kg 返回首重价 + 2 个续重。
3. **浮点边界**：`totalWeightGram = 4200`、首重 3kg、续重 1kg 时，结果稳定为 `首重价 + 1 × 续重价`，不被 `4.2 - 3` 浮点误差影响。
4. 新疆/西藏等地区规则在同 priority 下覆盖全国默认。
5. **同 priority 多条地区规则**按 `id` 升序稳定命中，多次查询结果一致。
6. 满普通免邮门槛返回 0。
7. 满 VIP 免邮门槛返回 0。
8. 无规则命中返回 `DEFAULT_SHIPPING_FEE`，且 `fallbackUsed = true`。
9. **赠品/奖品 SKU 计入计费重量**：含 1 个赠品 SKU 时总重量正确累加。
10. SKU 重量为空的历史数据按迁移默认值后不再产生 0kg 运费。
11. CheckoutSession 创建金额与预结算金额一致。
12. **CheckoutSession 创建后修改 ShippingRule，session 仍使用创建时锁定的运费**，支付回调不重算。
13. 支付回调拆单后的子订单运费合计等于 `CheckoutSession.shippingFee`。
14. 顺丰 createOrder 收到真实 `totalWeight`。
15. **顺丰下单成功后写入 `OrderShippingCost`**，含 `sfOrderId`、`weightGramSent`、`packageIndex`。

缓存测试：

1. 写操作后 `shipping-rules:active` 缓存键被清除。
2. 缓存 miss 时回填 DB 数据。
3. 60 秒 TTL 后自动失效。

管理后台测试：

1. 新增/编辑公式规则成功。
2. 负数、0 续重单位、0 首重重量被拒绝；`firstFee` 必填校验生效。
3. 预览显示命中规则和公式。
4. CSV/JSON 批量导入全部成功。
5. CSV/JSON 任意行错误时不写入。
6. **导入预检查**返回 `{ toCreate, toUpdate, unchanged }` 三项数字，用户确认后才落库。
7. **导入只新增/更新，不删除**：导入文件中缺失的现有规则保持不变。

买家 App 回归：

1. 不满免邮门槛显示运费。
2. 满免邮门槛显示免运费。
3. "再买多少可免运费"仍按商品金额计算。

## 12. 文档同步

实施时需要同步更新：

1. `docs/architecture/data-system.md`：新增 `OrderShippingCost` 模型、`ShippingRule` 公式字段变更（schema 权威来源，必同步）。
2. `docs/features/shipping.md`：记录顺丰风格平台统一运费计价。
3. `docs/features/plan-treeforuser.md`：替换旧"金额区间 × 地区 × 重量固定费"说明。
4. `docs/issues/app-tofix3.md`：Bug 33、Bug 34、Bug 56 状态与方案更新。
5. `AGENTS.md`：登记本设计文档与实施计划，并新增平台运费计价架构决策。
6. `CLAUDE.md`：如该文件继续维护，同步「关键架构决策」表格中的"运费计价"条目（顺丰风格首重+续重 / 多商户合并计费亏损平台承担 / `OrderShippingCost` 记录真实成本）。
