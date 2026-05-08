# 顺丰风格平台统一运费计价设计方案

日期：2026-05-08

## 1. 背景

平台当前已经统一对接顺丰丰桥，所有发货履约由平台承担并通过平台月结账号处理。买家侧现有运费链路是“满额包邮，不满额收运费”，且多商户订单按整单只收一次运费；支付成功后拆成多个商户订单时，再把 `CheckoutSession.shippingFee` 按商户商品金额比例分摊到各子订单。

当前 `ShippingRule` 的规则模型是“地区 + 金额区间 + 重量区间 + 固定运费”。这可以表达 `0-3kg = 9.1 元`、`3-4kg = 10.4 元`，但不适合维护类似顺丰协议价表的“首重 + 续重”计价方式。规则数量会随着地区和重量段快速膨胀。

本设计将买家侧运费改成顺丰风格公式计价：按平台后台维护的地区组、首重价、续重价计算。价格完全由平台自行设置，不调用顺丰实时计价接口，也不在代码中体现平台与顺丰或商户的真实谈判价格。

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
2. 不记录顺丰真实成本、商户分摊价、商户补贴或平台与顺丰的协议价差。
3. 不按商户包裹分别向买家计费。
4. 第一版不支持体积重量，因为当前商品/SKU 模型没有包装长宽高字段。
5. 第一版不做 Excel 上传，批量导入采用文本粘贴。

## 4. 核心业务规则

买家侧运费计算顺序：

```text
1. 读取普通/VIP 免邮门槛
2. 如果商品金额达到门槛：运费 = 0
3. 未达到门槛：按收货地区 + 整单 SKU 总重量匹配启用的 ShippingRule
4. 命中公式规则：按首重/续重计算运费
5. 无规则命中：使用 DEFAULT_SHIPPING_FEE 兜底
```

公式：

```text
计费重量kg = max(整单 SKU 重量合计kg, 最小计费重量kg)

如果 计费重量kg <= 首重重量kg：
  运费 = 首重价
否则：
  运费 = 首重价 + ceil((计费重量kg - 首重重量kg) / 续重单位kg) * 续重价
```

示例：

```text
广东规则：首 3kg = 9.1 元，续重每 1kg = 1.3 元
订单重量：4.2kg
运费：9.1 + ceil((4.2 - 3) / 1) * 1.3 = 11.7 元
```

## 5. 数据模型

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
  firstWeightKg      Float    @default(3)
  firstFee           Float    @default(0)
  additionalWeightKg Float    @default(1)
  additionalFee      Float    @default(0)
  minChargeWeightKg  Float    @default(1)

  priority           Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

字段约束：

```text
firstWeightKg > 0
firstFee >= 0
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

匹配规则：

1. 只查 `isActive = true`。
2. 按 `priority desc` 排序。
3. 地区匹配沿用当前省级前缀规则：`regionCode.slice(0, 2)` 与规则地区码前两位比较，空数组表示全国。
4. 如保留金额区间字段，则继续支持金额过滤，便于未来做低客单价特殊运费。
5. 命中后使用公式字段计算。
6. 无命中时返回 `DEFAULT_SHIPPING_FEE`，并标记 `fallbackUsed = true`。

预结算和下单仍按整单汇总重量计算一次运费：

```text
totalWeight = sum(sku.weightGram * quantity)
```

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
优先级
状态
更新时间
```

新增/编辑表单：

```text
规则名称
地区编码列表，留空 = 全国
首重重量 kg，默认 3
首重价 元
续重单位 kg，默认 1
续重价 元
最小计费重量 kg，默认 1
优先级
启用/停用
```

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
name,regionCodes,firstWeightKg,firstFee,additionalWeightKg,additionalFee,priority,isActive
广东省,"44",3,9.1,1,1.3,100,true
福建湖南广西江西,"35|43|45|36",3,10,1,2.3,90,true
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
    "priority": 100,
    "isActive": true
  }
]
```

导入策略：

1. 先校验全部行。
2. 有任意错误则不写入，并逐行返回错误。
3. 通过后批量 upsert 或 create。第一版可用 `name + regionCodes` 做前端提示，不强制唯一索引。
4. 导入后刷新列表并可立即预览。

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

1. Schema 增加公式字段，使用安全默认值，避免历史数据迁移失败。
2. 迁移已有种子规则为公式规则：
   - 全国默认：首重 3kg，首重价可沿用当前标准运费或按平台填写。
   - 新疆/西藏等偏远地区用更高优先级覆盖。
   - 旧规则迁移时 `firstFee = fee`，`fee` 继续保留为兼容字段。
3. 生产上线前在管理后台检查至少有一条全国默认公式规则。
4. 保留 `DEFAULT_SHIPPING_FEE`，避免地区规则漏配导致结算失败。
5. 旧字段保留一版，待公式规则稳定后再单独计划清理。

## 11. 测试清单

后端单元测试：

1. 广东 3kg 内返回首重价。
2. 广东 4.2kg 返回首重价 + 2 个续重。
3. 新疆/西藏等高优先级地区覆盖全国默认。
4. 满普通免邮门槛返回 0。
5. 满 VIP 免邮门槛返回 0。
6. 无规则命中返回 `DEFAULT_SHIPPING_FEE`，且 `fallbackUsed = true`。
7. SKU 重量为空的历史数据按迁移默认值后不再产生 0kg 运费。
8. CheckoutSession 创建金额与预结算金额一致。
9. 支付回调拆单后的子订单运费合计等于 `CheckoutSession.shippingFee`。
10. 顺丰 createOrder 收到真实 `totalWeight`。

管理后台测试：

1. 新增/编辑公式规则成功。
2. 负数、0 续重单位、0 首重重量被拒绝。
3. 预览显示命中规则和公式。
4. CSV/JSON 批量导入全部成功。
5. CSV/JSON 任意行错误时不写入。

买家 App 回归：

1. 不满免邮门槛显示运费。
2. 满免邮门槛显示免运费。
3. “再买多少可免运费”仍按商品金额计算。

## 12. 文档同步

实施时需要同步更新：

1. `docs/features/shipping.md`：记录顺丰风格平台统一运费计价。
2. `docs/features/plan-treeforuser.md`：替换旧“金额区间 × 地区 × 重量固定费”说明。
3. `docs/issues/app-tofix3.md`：Bug 33、Bug 34、Bug 56 状态与方案更新。
4. `AGENTS.md`：登记本设计文档，并新增平台运费计价架构决策。
