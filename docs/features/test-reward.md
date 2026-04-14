# 爱买买分润奖励系统 — 商业模式盈利测试模型

> 文档创建时间：2026-03-19
> 状态：**设计完成，待实现**
> 目标：通过数学建模和仿真测试，验证分润奖励系统在不同参数组合下的盈利能力，找出盈利边界和最优参数配置

---

## 一、测试目标

### 1.1 核心问题

1. **在什么参数组合下，平台月度净利润 > 运营成本？**
2. **奖励池实际流出率是多少？**（被用户成功解锁提现 vs 冻结过期回流平台）
3. **树结构随用户增长的动态：早期用户会不会积累过多奖励？**
4. **VIP用户 vs 普通用户的盈利贡献差异**
5. **最危险的场景是什么？**（所有人都高频消费，全部解锁，全部提现）
6. **推荐的后台参数配置方案是什么？**

### 1.2 非目标（不在本测试范围内）

- 用户增长获客成本
- 物流履约成本细节
- 支付通道手续费
- 市场营销预算

---

## 二、系统资金流全景

### 2.1 普通用户订单资金流

```
用户支付：cost × markupRate（元）
    │
    ├── 卖家收入：cost（成本回收）+ profit × industryPct（产业基金）
    │   └── 真实支出，自动打到卖家账户
    │
    └── 平台可分配利润（profit = cost × (markupRate - 1)）
         ├── profit × platformPct     → 平台利润      ← 可控
         ├── profit × rewardPct       → 奖励池        ← 可能流出（提现）或回流（过期）
         ├── profit × industryPct     → 产业基金(卖家) ← 真实支出
         ├── profit × charityPct      → 慈善基金       ← 平台可控资金池
         ├── profit × techPct         → 科技基金       ← 平台可控资金池
         └── profit × reservePct      → 备用金         ← 平台可控资金池

默认配比：50% / 16% / 16% / 8% / 8% / 2%（总和=100%）
```

**普通订单单笔利润分析（默认参数，cost=100元）：**

| 项目 | 金额 | 占利润% | 性质 |
|------|------|---------|------|
| 售价 | 130.00 | — | 收入 |
| 成本（卖家回收） | 100.00 | — | 支出 |
| **毛利润** | **30.00** | **100%** | — |
| 平台利润 | 15.00 | 50% | 可控 |
| 产业基金→卖家 | 4.80 | 16% | 真实支出 |
| 奖励池 | 4.80 | 16% | **变量**：流出或回流 |
| 慈善基金 | 2.40 | 8% | 可控 |
| 科技基金 | 2.40 | 8% | 可控 |
| 备用金 | 0.60 | 2% | 可控 |

- **最好情况**（奖励全部过期回流）：平台可控 = 25.20元（利润的84%）
- **最差情况**（奖励全部被提现）：平台可控 = 20.40元（利润的68%）
- **确定性支出**：卖家产业基金 = 4.80元（利润的16%）

### 2.2 VIP用户订单资金流（新六分结构）

```
VIP用户订单资金流（新六分）：
用户支付：cost × markupRate × vipDiscountRate（元）
    │
    ├── 卖家收入：cost（成本回收）+ profit × vipIndustryFundPct（产业基金）
    │
    └── 平台可分配利润（profit = cost × (markupRate × vipDiscountRate - 1)）
         ├── profit × 50%  → 平台利润      ← 可控
         ├── profit × 30%  → 奖励池        ← 可能流出（提现）或回流（过期）
         ├── profit × 10%  → 产业基金(卖家) ← 真实支出
         ├── profit × 2%   → 慈善基金       ← 可控
         ├── profit × 2%   → 科技基金       ← 可控
         └── profit × 6%   → 备用金         ← 可控

默认配比：50% / 30% / 10% / 2% / 2% / 6%（总和=100%）
```

> **变更说明**：VIP利润公式已从 rebatePool 两级分割（rebateRatio → 60%/37%/1%/2%）改为与普通用户结构一致的六分公式。
> 关键区别：旧公式下 `profit × (1 - rebateRatio)` 部分为隐性平台收入（未追踪），新公式 100% 利润显式分配。

**VIP订单单笔利润分析（cost=100元，markupRate=1.3，vipDiscountRate=0.95，profit=23.50元）：**

| 池 | 金额 | 比例 | 属性 |
|----|------|------|------|
| 平台利润 | 11.75 | 50% | 可控 |
| 奖励池 | 7.05 | 30% | 可能流出或回流 |
| 产业基金(卖家) | 2.35 | 10% | 真实支出 |
| 慈善基金 | 0.47 | 2% | 可控 |
| 科技基金 | 0.47 | 2% | 可控 |
| 备用金 | 1.41 | 6% | 可控 |

- **最好情况**（奖励全部过期回流）：平台可控 = 21.15元（利润的90%）
- **最差情况**（奖励全部被提现）：平台可控 = 14.10元（利润的60%）
- **确定性支出**：卖家产业基金 = 2.35元（利润的10%）

### 2.3 VIP 399购买收入（简化建模假设）

```
VIP礼包售价：399元
固定净贡献：300元（**建模假设**：视为已扣除赠品成本、物流、支付手续费等）
推荐人奖励：-50元（有推荐人时）
━━━━━━━━━━━━
平台净贡献：250元/人（有推荐人时的一次性净贡献）
```

> 说明：这里的 399 元就是用户购买 VIP 时支付的礼包价。  
> 为了减少变量，第一版模型**不拆分**“赠品成本 / 物流 / 支付手续费”，而是直接用 `VIP礼包净贡献 = 300元` 作为输入假设。  
> 如果后续需要更高精度，再把它拆成：`399 - 赠品成本 - 物流 - 支付手续费`。

### 2.4 奖励生命周期（决定实际流出率的关键）

```
订单确认收货
    │
    ├── 计算奖励金额 = profit × rewardPct（普通：16%）或 profit × vipRewardPct（VIP：30%）
    │
    ├── 找第k个祖辈
    │     ├── 不存在/是根节点/是VIP(普通树) → 归平台（0流出）
    │     │
    │     ├── 祖辈已解锁（selfPurchaseCount ≥ k）→ AVAILABLE
    │     │     ├── 用户提现 → 真实流出（奖励只能提现，不能抵扣消费）
    │     │     └── AVAILABLE 过期（rewardExpiryDays 天后未提现）→ 归平台
    │     │
    │     └── 祖辈未解锁（selfPurchaseCount < k）→ FROZEN
    │           ├── freezeDays 内祖辈消费够次数 → 解锁 → AVAILABLE
    │           └── freezeDays 后仍未解锁 → VOIDED → 归平台（0流出）
    │
    └── k > maxLayers(15) → 归平台（0流出）
```

**注意：奖励有两层过期机制**
1. **冻结过期**（FROZEN → VOIDED）：freezeDays 内未解锁，归平台
2. **可用过期**（AVAILABLE → VOIDED）：rewardExpiryDays 内未提现/使用，归平台

---

## 三、测试变量清单

### 3.1 可调系统参数（后台配置）

| 参数 | 代码键名 | 默认值 | 测试范围 | 影响 |
|------|---------|--------|---------|------|
| 加价率 | `MARKUP_RATE` | 1.30 | 1.10 ~ 2.00 | 决定利润空间 |
| 普通-平台分成 | `NORMAL_PLATFORM_PERCENT` | 0.50 | 0.30 ~ 0.60 | 平台确定性收入 |
| 普通-奖励比例 | `NORMAL_REWARD_PERCENT` | 0.16 | 0.05 ~ 0.30 | 潜在流出量 |
| 普通-产业基金 | `NORMAL_INDUSTRY_FUND_PERCENT` | 0.16 | 0.10 ~ 0.25 | 卖家真实支出 |
| 普通-慈善基金 | `NORMAL_CHARITY_PERCENT` | 0.08 | 0.00 ~ 0.15 | 可控 |
| 普通-科技基金 | `NORMAL_TECH_PERCENT` | 0.08 | 0.00 ~ 0.15 | 可控 |
| 普通-备用金 | `NORMAL_RESERVE_PERCENT` | 0.02 | 0.00 ~ 0.05 | 可控 |
| VIP-平台分成 | `VIP_PLATFORM_PERCENT` | 0.50 | 0.30 ~ 0.60 | VIP平台确定性收入 |
| VIP-奖励比例 | `VIP_REWARD_PERCENT` | 0.30 | 0.10 ~ 0.40 | VIP潜在流出量 |
| VIP-产业基金 | `VIP_INDUSTRY_FUND_PERCENT` | 0.10 | 0.05 ~ 0.20 | VIP卖家真实支出 |
| VIP-慈善基金 | `VIP_CHARITY_PERCENT` | 0.02 | 0.00 ~ 0.10 | 可控 |
| VIP-科技基金 | `VIP_TECH_PERCENT` | 0.02 | 0.00 ~ 0.10 | 可控 |
| VIP-备用金 | `VIP_RESERVE_PERCENT` | 0.06 | 0.00 ~ 0.10 | 可控 |
| 树叉数 | `NORMAL/VIP_BRANCH_FACTOR` | 3 | 2 ~ 5 | 树深度和分布 |
| 最大分配层数 | `NORMAL/VIP_MAX_LAYERS` | 15 | 8 ~ 20 | 奖励天花板 |
| 冻结天数 | `NORMAL/VIP_FREEZE_DAYS` | 30 | 15 ~ 60 | 过期回流率 |
| VIP礼包售价 | `VIP_PRICE` | 399 | 固定 | 仅用于营收口径 |
| VIP礼包利润 | 固定 | 300 | 200 ~ 400 | VIP一次性收入 |
| VIP推荐奖励 | `VIP_REFERRAL_BONUS` | 50 | 30 ~ 100 | VIP获客成本 |
| VIP折扣率 | `VIP_DISCOUNT_RATE` | 0.95 | 0.85 ~ 1.00 | VIP售价=cost×markup×此值 |
| VIP奖励有效期 | `VIP_REWARD_EXPIRY_DAYS` | 30 | 15 ~ 60 | AVAILABLE后的二次过期天数 |
| 普通奖励有效期 | `NORMAL_REWARD_EXPIRY_DAYS` | 30 | 15 ~ 60 | AVAILABLE后的二次过期天数 |
| 运营成本比例 | 模型参数 | 0.05 | 0.03 ~ 0.15 | 总营收的百分比 |

> **约束**：普通系统和VIP系统的六分比例之和均必须 = 100%

### 3.2 市场行为参数（不可控，需假设）

| 参数 | 默认假设 | 测试范围 | 说明 |
|------|---------|---------|------|
| 用户总量（年末） | 10,000 | 1,000 ~ 1,000,000 | 决定树深度 |
| 月新增用户 | 线性增长 | 可选S曲线/指数 | 增长模型 |
| 月均购买频率 | 3次/月 | 1 ~ 15次/月 | **最敏感变量** |
| 平均商品成本 | 50元 | 20 ~ 200元 | 影响绝对金额 |
| VIP年转化率 | 10% | 3% ~ 30% | 按普通用户平均存量折算月新增 VIP |
| VIP推荐率 | 70% | 30% ~ 100% | 有推荐人的VIP占比（无推荐人=省50元/人） |
| 提现率 | 80%/月 | 50% ~ 100% | 可用余额提现比例 |
| 用户月流失率 | 5% | 2% ~ 15% | 每月停止活跃的用户比例 |
| 订单完成率 | 95% | 85% ~ 99% | 到达RECEIVED状态的订单占比 |
| 换货率 | 3% | 1% ~ 10% | 申请换货的订单占比 |
| 抽奖日活跃率 | 30% | 10% ~ 80% | 每天参与抽奖的用户比例 |
| 抽奖平均中奖成本 | 5元 | 0 ~ 30元 | 每次中奖平台平均净亏损（含奖品成本-中奖价） |
| 抽奖中奖率 | 60% | 30% ~ 90% | 非"谢谢参与"的概率 |

> 说明：第一层解析模型里，`VIP年转化率` 采用**稳态近似**：
> `月新增VIP ≈ 普通用户平均存量 × 年转化率 / 12`。
> 更精确的 cohort 转化滞后，由第二层时序仿真处理。

### 3.3 初版遗漏变量（补充 — 影响结果的隐藏因素）

以下变量在初版设计中被遗漏，按对结果的影响程度分级：

#### 🔴 关键遗漏（显著影响盈利计算，必须纳入模型）

| # | 变量 | 说明 | 影响 | 建模方式 |
|---|------|------|------|---------|
| M1 | **VIP折扣率** | 代码中 `vipDiscountRate=0.95`，VIP用户购物打95折。VIP售价 = cost × markup × 0.95，利润直接减少 | VIP每单利润缩水5%，六分结构下所有池均按缩减后利润计算 | 第一层纳入：`vip_profit = cost × (markup × discountRate - 1)` |
| M2 | **AVAILABLE过期（二次过期）** | 奖励解锁为AVAILABLE后，仍有有效期（`rewardExpiryDays=30`天）。超期未提现/未使用 → 归平台 | **进一步降低实际流出率**。相当于在冻结过期之上再加一层过滤，对平台有利 | 第一层：`实际流出 = 奖励池 × 解锁率 × 可用留存率 × 提现率`。第二层：仿真中AVAILABLE状态也检查过期 |
| M3 | **用户流失率（churn）** | 用户停止使用平台：不再购买，不再提现。其冻结奖励到期归平台，可用余额到期也归平台 | 流失用户 = 平台的隐性收入来源。流失率越高，奖励流出越低 | 第二层：每月一定比例用户标记为inactive，停止购买和提现 |
| M4 | **VIP出局后的纯利润效应** | VIP用户k>15后"出局"：后续所有订单的奖励部分全归平台，仍用VIP六分公式（奖励池30%归平台） | 长期运营后，出局VIP越来越多，这部分订单是**零奖励流出的纯利润**。是平台越来越赚钱的结构性因素 | 第二层：仿真中跟踪出局VIP用户数及其贡献 |
| M5 | **VIP推荐率** | 不是所有VIP都有推荐人。自然流量转化的VIP无推荐奖励支出 | 推荐率50% → 推荐奖励支出减半 | 第一层：`referral_cost = new_vips × referral_bonus × referral_rate` |
| M6 | **抽奖系统净成本** | 抽奖奖品的经济影响：DISCOUNT_BUY（1元买100元货→平台亏损）、THRESHOLD_GIFT（满X送→额外成本）。且中奖订单进入分润系统时，奖品项被排除（isPrize=true），但非奖品项仍参与分润 | 抽奖是获客工具但有真实成本。高概率/高价值奖品 → 成本高 | 第一层：独立计算 `lottery_net_cost = daily_users × avg_prize_cost × win_rate`。第二层：仿真中模拟抽奖事件 |
| M7 | **订单完成率** | 不是所有订单都到达RECEIVED状态。部分可能被取消、卡在物流、发起换货。只有RECEIVED的订单才触发分润 | 完成率90% → 实际触发分润的订单只有90% | 第一层：`effective_orders = orders × completion_rate` |

#### 🟡 中等影响（影响精度，第二层仿真纳入）

| # | 变量 | 说明 | 影响 | 建模方式 |
|---|------|------|------|---------|
| M8 | **平台红包抵扣对利润的影响** | 结算时的 `rewardId`/`discountAmount` 实际是**平台红包（Coupon系统）**的抵扣，**不是分润奖励**。分润奖励只能提现，不能抵扣。但红包抵扣会降低订单实付金额 → 间接降低利润基数 → 奖励池缩小 | 影响有限：红包使用率不高，且红包系统独立预算 | 第一版忽略，第二版可加红包抵扣对利润的折减系数 |
| M9 | **确认收货延迟** | `autoConfirmDays=7`。奖励分配在收货确认时触发，不是支付时 | 造成7天的现金流时差：平台先收钱，7天后才产生奖励义务。对月度P&L影响不大，但影响现金流峰值 | 第二层：仿真按天推进，自然体现延迟 |
| M10 | **换货成本** | 用户申请换货 → 重新发货。平台/卖家承担额外物流和商品成本 | 换货率越高成本越高。但换货不触发退款，不回滚奖励 | 第一层：`replacement_cost = orders × replacement_rate × avg_shipping_cost` |
| M11 | **商品成本方差** | 不同商品成本差异大（生鲜10元 vs 海鲜200元），影响利润分布 | 高方差 → 某些订单产生巨额奖励，某些接近零。树顶部用户可能收到极端大额奖励 | 第二层：用对数正态分布采样商品成本，而非固定均值 |
| M12 | **运费收入/支出** | 低于免运费门槛的订单收运费（收入），高于门槛的免运费（平台承担物流成本）。`normalFreeShippingThreshold=99`, `vipFreeShippingThreshold=49` | VIP更容易免运费 → VIP订单隐性成本更高。运费收入在低客单价时是重要收入来源 | 第一层：`shipping_revenue = orders_below_threshold × avg_shipping_fee`，`shipping_cost = orders × avg_shipping_cost` |

#### 🟢 低影响（简化处理或忽略）

| # | 变量 | 说明 | 处理方式 |
|---|------|------|---------|
| M13 | 季节性波动 | 农产品有旺季淡季（春节/中秋/双十一） | 第一版忽略，第二版可加月度系数 |
| M14 | 支付手续费 | 微信/支付宝~0.6% | 纳入运营成本比例即可 |
| M15 | 多商品订单的跨公司产业基金分配 | 一个订单多个卖家 → 产业基金按比例分 | 总额不变，只影响分配对象，对平台P&L无影响 |
| M16 | 奖品订单对树进度的影响 | 纯奖品订单利润=0，被零利润检查跳过，不推进k值。但混合订单（奖品+普通商品）仍推进k | 影响极小，第一版忽略 |

### 3.4 修正后的解锁率公式

纳入 M2（AVAILABLE过期）和 M3（用户流失）后，实际奖励流出率公式需修正：

```
原公式：
  实际流出 = 奖励池 × 解锁率 × 提现率

修正公式：
  实际流出 = 奖励池
             × 解锁率                    （冻结期内解锁的比例）
             × 可用留存率                 （AVAILABLE期内未过期的比例）
             × 活跃率                    （用户未流失的比例）
             × 提现率                    （活跃用户实际提现的比例）

其中：
  可用留存率 ≈ 1 - e^(-提现频率 × rewardExpiryDays/30)
  活跃率 = 1 - 月流失率^(月数)
```

**示例（默认参数，freq=3，流失率5%/月，rewardExpiryDays=30）：**
```
解锁率 ≈ 20%
可用留存率 ≈ 95%（30天内大部分活跃用户会提现）
活跃率 ≈ 95%（月度）
提现率 = 80%

实际流出 = 奖励池 × 0.20 × 0.95 × 0.95 × 0.80 = 奖励池 × 14.4%

对比原公式：奖励池 × 0.20 × 0.80 = 16%

差值不大（1.6个百分点），但在大规模下显著
```

---

## 四、解锁率数学推导

### 4.1 解锁率是什么

**解锁率 = 奖励被成功解锁的概率**，直接决定平台的奖励流出量。

用户A在 level L，A的第k次消费发奖励给第k层祖辈B（level L-k）。
B要解锁这笔奖励，需要 `B.selfPurchaseCount ≥ k`。

### 4.2 粗略解锁率估算

假设所有用户月均消费 `freq` 次，冻结期 `freeze_days` 天：

```
冻结期内用户最多消费次数 ≈ freq × (freeze_days / 30)

对于第k层奖励：
  祖辈在冻结期内能积累 freq × (freeze_days/30) 次消费
  解锁条件: freq × (freeze_days/30) ≥ k
  即: k ≤ freq × (freeze_days/30)

解锁的层数占比 ≈ min(freq × freeze_days/30, maxLayers) / maxLayers
```

**各频率下的粗略解锁率（freeze_days=30, maxLayers=15）：**

| 月购买频率 | 冻结期内消费次数 | 可解锁层数 | 粗略解锁率 |
|-----------|----------------|-----------|-----------|
| 1次/月 | 1 | 1/15 | **7%** |
| 2次/月 | 2 | 2/15 | **13%** |
| 3次/月 | 3 | 3/15 | **20%** |
| 5次/月 | 5 | 5/15 | **33%** |
| 8次/月 | 8 | 8/15 | **53%** |
| 10次/月 | 10 | 10/15 | **67%** |
| 15次/月 | 15 | 15/15 | **100%** |

### 4.3 精确解锁率需要仿真

粗略估算假设所有层的奖励数量相同，但实际上：
- 深层用户数量远多于浅层（3叉树第k层有 3^k 个用户）
- 深层用户发的奖励需要更高的k值才能解锁
- 不同用户的消费频率不同
- 冻结起算时间不同

这些因素使得**精确解锁率必须通过仿真计算**。

### 4.4 额外的奖励归平台因素

除了冻结过期外，以下情况奖励也归平台（进一步降低实际流出率）：

| 因素 | 发生条件 | 预期频率 |
|------|---------|---------|
| k > maxLayers | 用户消费超过15次 | 活跃用户会触发 |
| 到达根节点 | 浅层用户的高k值奖励 | 早期用户常见 |
| 祖辈是VIP（普通树） | VIP/普通隔离 | 取决于VIP转化率 |
| 祖辈节点无用户 | 树的系统节点 | 仅根节点 |

---

## 五、模型架构设计

### 5.1 两层模型

```
┌────────────────────────────────────────────┐
│ 第一层：稳态解析模型（参数扫描，秒级出结果）       │
│                                            │
│  输入：全部参数 + 解锁率估算公式               │
│  输出：参数空间热力图、盈利边界线              │
│  用途：快速定位有价值的参数区间                │
└──────────────────┬─────────────────────────┘
                   │
                   ▼ 用解析模型筛选出的参数区间
┌────────────────────────────────────────────┐
│ 第二层：时序仿真引擎（精确验证，分钟级出结果）    │
│                                            │
│  输入：具体参数组合 + 用户行为分布              │
│  输出：月度P&L、树动态、提现压力、极端测试       │
│  用途：验证解析模型、发现动态风险               │
└────────────────────────────────────────────┘
```

### 5.2 第一层：解析模型

**口径说明**

- 第一层解析模型输出的是**稳态月均 P&L**，用于快速扫描参数空间
- 它会把“冻结→解锁→提现 / 过期”的跨月时滞折算成长期平均比例
- 因此它适合找**盈利边界**，但**不等于真实日历月现金流**
- 真实月度现金流、冻结余额峰值、集中提现压力，以第二层时序仿真为准

**核心公式**

```python
def calculate_monthly_pnl(params):
    """计算稳态月均平台净利润（解析公式，含补充变量 M1~M7）"""

    # ── 普通系统月度 ──
    effective_orders_normal = params.N_normal * params.freq * params.completion_rate  # M7: 订单完成率
    profit_normal = effective_orders_normal * params.avg_cost * (params.markup - 1)

    # 平台可控收入（确定性）
    platform_controlled_normal = profit_normal * (
        params.normal_platform_pct
        + params.normal_charity_pct
        + params.normal_tech_pct
        + params.normal_reserve_pct
    )
    # 卖家支出（确定性）
    seller_payout = profit_normal * params.normal_industry_pct
    # 奖励池（变量）— 四层过滤：解锁率 × 可用留存率 × 活跃率 × 提现率
    reward_pool_normal = profit_normal * params.normal_reward_pct
    available_retain_normal = 1 - (1 - params.withdrawal_rate) ** (params.normal_reward_expiry_days / 30)  # M2: AVAILABLE过期
    active_rate = 1 - params.churn_rate  # M3: 用户流失
    reward_outflow_normal = (reward_pool_normal
        * params.unlock_rate
        * available_retain_normal
        * active_rate
        * params.withdrawal_rate)
    reward_return_normal = reward_pool_normal - reward_outflow_normal  # 余下全部回流平台

    # ── VIP系统月度（六分结构，与普通系统对称）──
    effective_orders_vip = params.N_vip * params.freq * params.completion_rate  # M7
    # M1: VIP折扣率影响利润
    vip_sale_price = params.avg_cost * params.markup * params.vip_discount_rate
    profit_vip = effective_orders_vip * (vip_sale_price - params.avg_cost)

    # VIP六分：50%平台/30%奖励/10%产业基金/2%慈善/2%科技/6%备用金
    platform_controlled_vip = profit_vip * (
        params.vip_platform_pct       # 50% 平台利润
        + params.vip_charity_pct      # 2% 慈善基金
        + params.vip_tech_pct         # 2% 科技基金
        + params.vip_reserve_pct      # 6% 备用金
    )
    seller_payout_vip = profit_vip * params.vip_industry_pct  # 10% 产业基金→卖家
    reward_pool_vip = profit_vip * params.vip_reward_pct      # 30% 奖励池
    available_retain_vip = 1 - (1 - params.withdrawal_rate) ** (params.vip_reward_expiry_days / 30)  # M2
    reward_outflow_vip = (reward_pool_vip
        * params.unlock_rate_vip
        * available_retain_vip
        * active_rate
        * params.withdrawal_rate)
    reward_return_vip = reward_pool_vip - reward_outflow_vip

    # M4: VIP出局纯利润（长期运营后的结构性利润增长）
    # 估算：每月出局VIP数 ≈ 活跃VIP × (freq/maxLayers)（到达15单的概率）
    monthly_exit_rate = min(1.0, params.freq / params.vip_max_layers)  # 简化
    exited_vip_count = params.N_vip * monthly_exit_rate * 0.1  # 保守：累积约10%
    exited_vip_profit = exited_vip_count * params.freq * params.completion_rate * (vip_sale_price - params.avg_cost)
    exited_vip_platform = exited_vip_profit  # 出局后奖励全归平台（仅需扣除平台分润的非奖励部分）

    # ── VIP购买一次性收入 ──
    new_vips = params.N_normal * params.vip_conversion_rate_annual / 12
    vip_sales_revenue = new_vips * params.vip_price        # 399元/人，用于营收口径
    vip_income = new_vips * params.vip_profit               # 300元/人
    referral_cost = new_vips * params.vip_referral * params.vip_referral_rate  # M5: 推荐率

    # ── 抽奖系统净成本（M6）──
    daily_lottery_users = (params.N_normal + params.N_vip) * params.lottery_active_rate
    lottery_monthly_cost = (daily_lottery_users * 30
        * params.lottery_win_rate
        * params.lottery_avg_prize_cost)

    # ── 换货成本（M10）──
    total_orders = effective_orders_normal + effective_orders_vip
    replacement_cost = total_orders * params.replacement_rate * params.avg_shipping_cost

    # ── 运营成本 ──
    total_revenue = (
        params.N_normal * params.freq * params.avg_cost * params.markup  # 普通用户订单营收
        + params.N_vip * params.freq * vip_sale_price                    # VIP用户订单营收（含折扣）
        + vip_sales_revenue                                               # VIP礼包营收
    )
    operating_cost = total_revenue * params.operating_cost_pct

    # ── 月度净利润 ──
    net_profit = (
        platform_controlled_normal + reward_return_normal
        + platform_controlled_vip + reward_return_vip
        + exited_vip_platform                          # M4: 出局VIP纯利润
        + vip_income
        - seller_payout
        - seller_payout_vip                            # VIP产业基金→卖家
        - reward_outflow_normal
        - reward_outflow_vip
        - referral_cost
        - lottery_monthly_cost                         # M6: 抽奖净成本
        - replacement_cost                             # M10: 换货成本
        - operating_cost
    )

    return {
        'net_profit': net_profit,
        'net_margin': net_profit / total_revenue if total_revenue > 0 else 0,
        'reward_outflow_total': reward_outflow_normal + reward_outflow_vip,
        'reward_return_total': reward_return_normal + reward_return_vip,
        'platform_controlled': platform_controlled_normal + platform_controlled_vip,
        'seller_payout': seller_payout,
        'lottery_cost': lottery_monthly_cost,
        'replacement_cost': replacement_cost,
        'exited_vip_profit': exited_vip_platform,
        'operating_cost': operating_cost,
        'total_revenue': total_revenue,
    }
```

**最坏情况模式（悲观分析）**

> 用户要求：假设奖励全部被提现，都没有过期，计算最坏情况下能否赚钱。

在最坏情况模式下，覆盖以下参数：
```python
# 最坏情况参数覆盖
params.unlock_rate = 1.0            # 100%解锁，无冻结过期
params.unlock_rate_vip = 1.0        # VIP同上
params.withdrawal_rate = 1.0        # 100%提现
params.churn_rate = 0.0             # 无流失（所有人都提现）
params.normal_reward_expiry_days = 9999  # AVAILABLE不过期
params.vip_reward_expiry_days = 9999     # 同上
params.completion_rate = 1.0        # 所有订单都完成
```

此时公式简化为：
```python
# 最坏情况：奖励池 100% 流出
reward_outflow_normal = reward_pool_normal   # = profit_normal × rewardPct
reward_outflow_vip = reward_pool_vip         # = profit_vip × vipRewardPct（默认30%）
reward_return = 0                            # 无回流
```

**参数扫描**

对以下维度做网格搜索，生成热力图：

| 扫描组合 | 横轴 | 纵轴 | 固定其他参数为默认 |
|---------|------|------|-----------------|
| 扫描1 | markupRate (1.1~2.0) | rewardPct (5%~30%) | 标准 |
| 扫描2 | markupRate (1.1~2.0) | 购买频率 (1~15次/月) | 标准 |
| 扫描3 | VIP奖励比例 (10%~40%) | 购买频率 (1~15次/月) | 标准 |
| 扫描4 | 用户总量 (1k~1M) | VIP转化率 (3%~30%) | 标准 |
| 扫描5 | freezeDays (15~60) | 购买频率 (1~15次/月) | 标准 |
| 扫描6 | maxLayers (8~20) | 购买频率 (1~15次/月) | 标准 |
| 扫描7 | maxLayers (8~20) | rewardPct (5%~30%) | 标准，freq=3 |
| 扫描8 | branchFactor (2~5) | maxLayers (8~20) | 标准，颜色=奖励流出率 |
| 扫描9 | 用户总量 (1k~1M) | maxLayers (8~20) | 标准，颜色=净利率 |

### 5.3 第二层：时序仿真引擎

**仿真架构**

```
┌──────────────────────────────────────────────────────────────┐
│                    仿真引擎（按天推进）                          │
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────────┐        │
│  │  用户生成器  │──→│  行为模型   │──→│  交易处理器     │        │
│  │ (增长曲线)  │   │ (泊松分布)  │   │ (利润计算/分流) │        │
│  └────────────┘   └────────────┘   └───────┬────────┘        │
│                                            │                 │
│  ┌────────────┐   ┌────────────┐   ┌───────▼────────┐        │
│  │ 普通树管理  │←──│   树引擎    │──→│  VIP树管理     │        │
│  │ (轮询插入)  │   │ (祖辈查找)  │   │ (BFS插入)     │        │
│  └────────────┘   └────────────┘   └────────────────┘        │
│                        │                                     │
│                  ┌─────▼──────┐                               │
│                  │  奖励引擎   │                               │
│                  │冻结/解锁/过期│                               │
│                  └─────┬──────┘                               │
│                        │                                     │
│                  ┌─────▼──────┐   ┌────────────┐              │
│                  │  会计系统   │──→│  分析输出   │              │
│                  │ 全量资金追踪 │   │ P&L/图表   │              │
│                  └────────────┘   └────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

**各模块详细设计**

#### 模块1：用户生成器

```python
class UserGenerator:
    """
    支持三种增长模型：
    - linear: 每月固定新增 N 人
    - exponential: 月增长率 r%
    - s_curve: S曲线（初期慢→中期快→后期饱和）
    """
    def generate(self, day, config) -> list[User]:
        # 每个用户属性：
        # - join_day: 加入日期
        # - purchase_lambda: 个人购买频率（从正态分布采样，均值=config.freq）
        # - avg_order_cost: 个人平均客单成本（从对数正态分布采样）
        # - will_become_vip: 是否会转VIP（伯努利分布）
        # - vip_convert_day: VIP转化日期（加入后随机天数）
```

#### 模块2：行为模型

```python
class BehaviorModel:
    """
    每天为每个用户决定是否产生购买事件
    购买频率使用泊松过程：P(购买) = 1 - e^(-λ/30) ≈ λ/30
    """
    def daily_purchases(self, users, day, config) -> list[Order]:
        orders = []
        for user in users:
            if random() < user.purchase_lambda / 30:
                cost = sample_lognormal(user.avg_order_cost, sigma=0.3)
                price = cost * config.markup
                orders.append(Order(user=user, cost=cost, price=price))
        return orders
```

#### 模块3：树引擎

```python
class NormalTree:
    """
    单棵树，平台根节点（level 0, userId=None）
    轮询平衡插入：当前活跃层按父节点加入时间排序，
    先给每个父节点1个子节点，全部有1个后再给第2个，
    直到满层后进入下一层
    """
    def insert(self, user) -> TreeNode: ...
    def find_kth_ancestor(self, user_node, k) -> TreeNode | None: ...

class VipTree:
    """
    10棵子树，根节点 A1~A10
    BFS滑落插入（从上到下、从左到右找空位）
    """
    def insert(self, user) -> TreeNode: ...
    def find_kth_ancestor(self, user_node, k) -> TreeNode | None: ...
```

#### 模块4：奖励引擎

```python
class RewardEngine:
    def process_normal_order(self, order, user, config):
        """普通用户订单奖励分配"""
        profit = order.price - order.cost
        if profit <= 0:
            return

        # 六分利润
        platform = profit * config.normal_platform_pct
        seller   = profit * config.normal_industry_pct
        reward   = profit * config.normal_reward_pct
        funds    = profit * (config.normal_charity_pct + config.normal_tech_pct
                            + config.normal_reserve_pct)

        self.ledger.credit('PLATFORM', platform + funds)
        self.ledger.debit('SELLER', seller)

        # 首单入树
        if not user.in_normal_tree:
            user.tree_node = self.normal_tree.insert(user)
            user.in_normal_tree = True

        user.normal_purchase_count += 1
        k = user.normal_purchase_count

        # 超层归平台
        if k > config.max_layers:
            self.ledger.credit('PLATFORM', reward)
            self.try_unlock_self(user)
            return

        # 找祖辈
        ancestor_node = self.normal_tree.find_kth_ancestor(user.tree_node, k)

        # 无效祖辈 → 归平台
        if (not ancestor_node
            or ancestor_node.user is None           # 系统根节点
            or ancestor_node.user.is_vip):          # VIP排除
            self.ledger.credit('PLATFORM', reward)
            self.try_unlock_self(user)
            return

        ancestor = ancestor_node.user

        # 判断解锁
        if ancestor.normal_purchase_count >= k:
            ancestor.available_balance += reward
            self.ledger.credit('USER_AVAILABLE', reward, user=ancestor)
        else:
            frozen = FrozenReward(
                amount=reward,
                required_k=k,
                created_day=self.current_day,
                expires_day=self.current_day + config.freeze_days,
            )
            ancestor.frozen_rewards.append(frozen)
            self.ledger.credit('USER_FROZEN', reward, user=ancestor)

        # 检查自己是否因新消费解锁了冻结奖励
        self.try_unlock_self(user)

    def process_vip_order(self, order, user, config):
        """VIP用户订单奖励分配（六分结构，与普通系统对称）"""
        profit = order.price - order.cost
        if profit <= 0:
            return

        # VIP六分：50%平台/30%奖励/10%产业基金/2%慈善/2%科技/6%备用金
        reward   = profit * config.vip_reward_pct
        platform = profit * config.vip_platform_pct
        industry = profit * config.vip_industry_pct
        charity  = profit * config.vip_charity_pct
        tech     = profit * config.vip_tech_pct
        reserve  = profit * config.vip_reserve_pct

        self.ledger.credit('PLATFORM', platform + charity + tech + reserve)
        self.ledger.credit('SELLER_INDUSTRY', industry)

        user.vip_purchase_count += 1
        k = user.vip_purchase_count

        # k > maxLayers → VIP已出局，奖励归平台
        if k > config.vip_max_layers:
            self.ledger.credit('PLATFORM', reward)
            user.vip_exited = True
            self.try_unlock_vip_self(user)
            return

        ancestor_node = self.vip_tree.find_kth_ancestor(user.vip_tree_node, k)

        if not ancestor_node or ancestor_node.user is None:
            self.ledger.credit('PLATFORM', reward)
            self.try_unlock_vip_self(user)
            return

        ancestor = ancestor_node.user
        if ancestor.vip_purchase_count >= k:
            ancestor.vip_available_balance += reward
            self.ledger.credit('VIP_USER_AVAILABLE', reward, user=ancestor)
        else:
            frozen = FrozenReward(
                amount=reward,
                required_k=k,
                created_day=self.current_day,
                expires_day=self.current_day + config.vip_freeze_days,
            )
            ancestor.vip_frozen_rewards.append(frozen)
            self.ledger.credit('VIP_USER_FROZEN', reward, user=ancestor)

        self.try_unlock_vip_self(user)

    def try_unlock_self(self, user):
        """用户新增消费后，检查并释放符合条件的冻结奖励"""
        still_frozen = []
        for fr in user.frozen_rewards:
            if user.normal_purchase_count >= fr.required_k:
                user.available_balance += fr.amount
                self.ledger.transfer('USER_FROZEN', 'USER_AVAILABLE', fr.amount, user=user)
            else:
                still_frozen.append(fr)
        user.frozen_rewards = still_frozen

    def expire_frozen_rewards(self, current_day):
        """每日检查过期冻结奖励，归平台"""
        for user in self.all_users:
            still_frozen = []
            for fr in user.frozen_rewards:
                if current_day >= fr.expires_day:
                    self.ledger.transfer('USER_FROZEN', 'PLATFORM', fr.amount, user=user)
                else:
                    still_frozen.append(fr)
            user.frozen_rewards = still_frozen
            # VIP冻结同理
            still_vip = []
            for fr in user.vip_frozen_rewards:
                if current_day >= fr.expires_day:
                    self.ledger.transfer('VIP_USER_FROZEN', 'PLATFORM', fr.amount, user=user)
                else:
                    still_vip.append(fr)
            user.vip_frozen_rewards = still_vip
```

#### 模块5：会计系统

```python
class Ledger:
    """追踪所有资金流动"""

    accounts = {
        'PLATFORM':          0,  # 平台可控资金（含基金池）
        'SELLER_TOTAL':      0,  # 累计卖家支出
        'USER_AVAILABLE':    0,  # 用户可提现余额（普通）
        'USER_FROZEN':       0,  # 用户冻结中（普通）
        'VIP_USER_AVAILABLE': 0, # 用户可提现余额（VIP）
        'VIP_USER_FROZEN':   0,  # 用户冻结中（VIP）
        'WITHDRAWN':         0,  # 已提现总额
        'EXPIRED_TO_PLATFORM': 0, # 过期回流平台
        'VIP_PURCHASE_INCOME': 0, # VIP购买收入
        'REFERRAL_COST':     0,  # 推荐奖励支出
        'OPERATING_COST':    0,  # 运营成本
    }

    daily_snapshots = []  # 每日快照

    def monthly_pnl(self, month):
        """生成月度损益表"""
        return {
            'revenue':           self.month_sum('REVENUE', month),
            'cogs':              self.month_sum('COGS', month),
            'gross_profit':      self.month_sum('GROSS_PROFIT', month),
            'seller_payout':     self.month_sum('SELLER_TOTAL', month),
            'reward_withdrawn':  self.month_sum('WITHDRAWN', month),
            'reward_expired':    self.month_sum('EXPIRED_TO_PLATFORM', month),
            'vip_income':        self.month_sum('VIP_PURCHASE_INCOME', month),
            'referral_cost':     self.month_sum('REFERRAL_COST', month),
            'operating_cost':    self.month_sum('OPERATING_COST', month),
            'net_profit':        ...,  # 计算
        }
```

#### 模块6：提现处理

```python
class WithdrawalProcessor:
    """
    每月底处理一次提现
    withdrawal_rate = 用户提现可用余额的比例（默认80%）
    """
    def process(self, users, config):
        for user in users:
            # 普通奖励提现
            withdraw_normal = user.available_balance * config.withdrawal_rate
            user.available_balance -= withdraw_normal
            self.ledger.transfer('USER_AVAILABLE', 'WITHDRAWN', withdraw_normal)

            # VIP奖励提现
            withdraw_vip = user.vip_available_balance * config.withdrawal_rate
            user.vip_available_balance -= withdraw_vip
            self.ledger.transfer('VIP_USER_AVAILABLE', 'WITHDRAWN', withdraw_vip)
```

---

## 六、输出报表设计

### 报表1：月度损益表（P&L）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
月份: 2026-06           普通系统    VIP系统     合计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
商品销售收入             xxx        xxx        xxx
商品成本(COGS)          (xxx)      (xxx)      (xxx)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
毛利润                   xxx        xxx        xxx

卖家产业基金支出         (xxx)       —         (xxx)
奖励提现支出             (xxx)      (xxx)      (xxx)
VIP礼包收入               —         xxx        xxx
VIP推荐奖励支出            —        (xxx)      (xxx)
冻结过期回流             +xxx       +xxx       +xxx
运营成本                (xxx)      (xxx)      (xxx)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
月度净利润               xxx        xxx        xxx
净利率                    x%         x%         x%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

累计指标:
  累计奖励池生成:    xxx 元
  累计已提现:        xxx 元  (占比 x%)
  累计已过期回流:    xxx 元  (占比 x%)
  当前冻结中:        xxx 元  (占比 x%)
  实际奖励流出率:    x%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 报表2：参数敏感性热力图

6组二维参数扫描，每组输出一张热力图：

| # | 横轴 | 纵轴 | 颜色 = 净利率 |
|---|------|------|-------------|
| 1 | 加价率 (1.1→2.0, step=0.05) | 普通奖励比例 (5%→30%, step=1%) | 红(-) → 白(0) → 绿(+) |
| 2 | 加价率 (1.1→2.0) | 购买频率 (1→15次/月) | 同上 |
| 3 | VIP奖励比例 (10%→40%) | 购买频率 (1→15次/月) | 同上 |
| 4 | 用户总量 (1k→1M, log) | VIP转化率 (3%→30%) | 同上 |
| 5 | 冻结天数 (15→60) | 购买频率 (1→15次/月) | 同上 |
| 6 | 最大层数 (8→20) | 购买频率 (1→15次/月) | 同上 |

**每张热力图上叠加盈利边界线（净利润=0的等高线）。**

### 报表3：时间序列动态图

12个月的趋势线：

```
图A: 累积资金流
  线1: 累计总营收
  线2: 累计平台可控收入
  线3: 累计奖励提现（真实流出）
  线4: 累计冻结过期（回流）

图B: 树结构动态
  线1: 用户总数（左轴）
  线2: 普通树深度（右轴）
  线3: VIP树深度（右轴）

图C: 月度净利润趋势
  柱状图: 每月净利润
  线: 净利率%

图D: 奖励分布
  堆叠面积图: 可用余额 / 冻结中 / 已提现 / 已过期
```

### 报表4：四种场景对比

| 场景 | 购买频率 | 解锁率估算 | 描述 |
|------|---------|-----------|------|
| A 冷清 | 1次/月 | ~7% | 用户不活跃，大量过期 |
| B 正常 | 3次/月 | ~20% | 典型生鲜电商 |
| C 活跃 | 8次/月 | ~53% | 高粘性用户 |
| D 极端 | 15次/月 | ~100% | 压力测试：全部解锁 |

每个场景输出完整P&L，横向对比。

### 报表5：树层级奖励分布分析（核心报表）

> 树的层数是分润系统最核心的结构变量。它同时影响：奖励能传多远、解锁有多难、早期用户能积累多少。
> 本报表从三个维度深入分析。

#### 5a. 逐层奖励流向表

对给定用户量和树结构，计算每一层的奖励收发情况：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
树层级奖励分析（普通树, N=10000, 3叉, maxLayers=15, freq=3次/月）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      │          │ 发出奖励     │ 收到奖励                                │
Level │ 用户数   │ (作为消费者)  │ 来自下层数  月均金额   解锁率   实际到手  │ 归平台
──────┼──────────┼─────────────┼────────────────────────────────────────┼────────
  0   │ 1(根)    │     —       │  xxx笔     xxx元     —       0(归平台) │ xxx元
  1   │ 3        │  3人×3次/月  │  xxx笔     xxx元     xx%     xxx元    │ xxx元
  2   │ 9        │  9人×3次/月  │  xxx笔     xxx元     xx%     xxx元    │ xxx元
  3   │ 27       │  27人×3次/月 │  xxx笔     xxx元     xx%     xxx元    │ xxx元
  ...
  8   │ 6561     │  ...        │  xxx笔     xxx元     xx%     xxx元    │ xxx元
  (树底)
──────┼──────────┼─────────────┼────────────────────────────────────────┼────────
合计  │ 10000    │             │            xxx元     平均xx%  xxx元    │ xxx元
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

关键比值:
  Level 1-3 用户占总用户: x%, 占总收到奖励: x%
  Level 1-3 人均月奖励: xxx元, 全树人均: xxx元, 倍数: xx倍
  归平台奖励占总奖励池: x%（含根节点 + 过期 + 超层 + VIP排除）
```

**为什么逐层分析至关重要**：
- 三叉树中 level 1 只有3人，但他们收到的奖励来自整棵树下方所有人的第1次消费
- level 8 有6561人，但每人收到的奖励远少（来自更深层的第8次消费，且来源用户更少）
- 这种"上少下多"的分布决定了：**浅层用户人均奖励远高于深层**
- 如果浅层用户集中提现，可能造成短期现金流压力

#### 5b. maxLayers 对比测试

固定其他参数，单独调整 maxLayers，对比关键指标：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
maxLayers 对比（N=10000, freq=3, markup=1.3, rewardPct=16%）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

maxLayers │ 奖励总池 │ 实际流出 │ 归平台  │ 流出率 │ 月净利率 │ Top1%集中度
──────────┼─────────┼─────────┼────────┼───────┼─────────┼───────────
    8     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
   10     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
   12     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
   15     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
   18     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
   20     │ xxx元   │ xxx元   │ xxx元  │  xx%  │  xx%    │    xx%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 5c. 树叉数 × maxLayers 交叉测试

叉数决定每层用户数，与 maxLayers 共同决定树结构：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
叉数 × 最大层数 交叉分析（N=10000, freq=3）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            maxLayers=8   maxLayers=12   maxLayers=15   maxLayers=20
          ┌────────────┬──────────────┬──────────────┬──────────────┐
2叉树     │ 深度=14层   │ 深度=14层    │ 深度=14层    │ 深度=14层    │
          │ 流出率=xx%  │ 流出率=xx%   │ 流出率=xx%   │ 流出率=xx%   │
          │ 净利率=xx%  │ 净利率=xx%   │ 净利率=xx%   │ 净利率=xx%   │
          │ Top1%=xx%   │ Top1%=xx%    │ Top1%=xx%    │ Top1%=xx%    │
          ├────────────┼──────────────┼──────────────┼──────────────┤
3叉树     │ 深度=9层    │ ...          │ ...          │ ...          │
(默认)    │ ...         │              │              │              │
          ├────────────┼──────────────┼──────────────┼──────────────┤
4叉树     │ 深度=7层    │ ...          │ ...          │ ...          │
          │ ...         │              │              │              │
          ├────────────┼──────────────┼──────────────┼──────────────┤
5叉树     │ 深度=6层    │ ...          │ ...          │ ...          │
          │ ...         │              │              │              │
          └────────────┴──────────────┴──────────────┴──────────────┘

关键发现：
  - 2叉树深，浅层用户少但深层用户多，奖励分布更均匀
  - 5叉树浅，浅层用户多，奖励到达根节点的比例更高（更多归平台）
  - maxLayers 超过实际树深度时无额外效果（如5叉树深度6，maxLayers>6无区别）
```

#### 5d. 树深度 vs 用户量 参照表

帮助直观理解不同用户规模下树长什么样：

```
用户量     │ 2叉深度 │ 3叉深度 │ 4叉深度 │ 5叉深度
───────────┼─────────┼─────────┼─────────┼─────────
    1,000  │   10    │    7    │    5    │    5
    5,000  │   13    │    8    │    7    │    6
   10,000  │   14    │    9    │    7    │    6
   50,000  │   16    │   10    │    8    │    7
  100,000  │   17    │   11    │    9    │    8
  500,000  │   19    │   12    │   10    │    9
1,000,000  │   20    │   13    │   10    │    9
```

> **关键洞察**：当树实际深度 < maxLayers 时，深层用户的高k值奖励会到达根节点归平台。
> 例如3叉树10000用户深度9，maxLayers=15，则用户第10~15次消费的奖励全部归平台。
> 这意味着 **maxLayers设得比树深度高并不会增加流出**，反而增加了归平台的比例。

### 报表6：参数推荐表

基于所有分析，输出推荐参数组合：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
推荐配置（保守型 — 确保盈利优先）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
加价率:          1.35
普通奖励比例:     12%
VIP奖励比例:       30%
冻结天数:         20天
最大层数:         12
运营成本预留:     8%

预期结果（3次/月, 10000用户, 10% VIP）:
  月营收:         xxx 万元
  月净利润:       xxx 万元
  净利率:         xx%
  奖励实际流出率:  xx%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
推荐配置（增长型 — 牺牲利润换用户吸引力）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
加价率:          1.25
普通奖励比例:     20%
VIP奖励比例:       40%
冻结天数:         30天
最大层数:         15
运营成本预留:     5%

预期结果: ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 七、压力测试清单

| # | 场景 | 测试内容 | 关注指标 |
|---|------|---------|---------|
| S1 | 全解锁 | freq=15, 所有用户活跃 | 最大奖励流出，平台是否仍盈利 |
| S2 | 金字塔集中 | 前100用户各有数千后代 | top 1%用户奖励集中度 |
| S3 | 增长停滞 | 6个月后新增为0，老用户继续消费 | 奖励只出不进，现金流 |
| S4 | 集中提现 | 某月100%可用余额提现 | 单月现金流压力 |
| S5 | VIP激进 | vipRewardPct=40%, freq=10 | VIP系统是否拖垮整体 |
| S6 | 低加价 | markupRate=1.15 | 利润空间极薄时的表现 |
| S7 | 参数突变 | 运营3个月后调整参数 | 参数变更对存量的影响 |
| S8 | 浅树高频 | 2叉树+maxLayers=20+freq=10, N=100k | 树深20层接近maxLayers，大量奖励被解锁 |
| S9 | 深树低层 | 5叉树+maxLayers=8, N=100k | 树深8层=maxLayers，第9次消费起全归平台 |
| S10 | Level 1-3集中提现 | 前39人（3叉树level 1-3）同时100%提现 | 单日/单月top用户提现金额峰值 |

---

## 八、实现计划

| 阶段 | 内容 | 产出文件 | 预计工作量 |
|------|------|---------|-----------|
| **P1** | 解析模型 + 9组热力图 | `tools/reward-model/analytical.py` | 核心公式 + matplotlib |
| **P2** | 时序仿真引擎（树+冻结+过期+提现） | `tools/reward-model/simulation.py` | 主要工作量 |
| **P3** | 4场景对比 + 月度P&L | `tools/reward-model/scenarios.py` | 调用P2引擎 |
| **P4** | 10项压力测试 | `tools/reward-model/stress_test.py` | 调用P2引擎 |
| **P5** | 树层级分析（逐层流向 + maxLayers对比 + 叉数交叉） | `tools/reward-model/tree_analysis.py` | 报表5a~5d |
| **P6** | 参数推荐报告生成 | `tools/reward-model/report.py` | 汇总P1~P5输出 |

**技术栈**：Python 3.10+ / NumPy / Matplotlib / 无外部依赖

**运行方式**：
```bash
cd tools/reward-model
python analytical.py          # 秒级：热力图 + 盈利边界
python simulation.py          # 分钟级：时序仿真
python scenarios.py           # 4场景对比
python stress_test.py         # 压力测试
python report.py              # 生成完整报告
```

---

## 九、初步数学判断（建模前的直觉）

### 利好因素（平台有利）

1. **单笔订单永远不亏**：平台至少拿利润的50%（普通默认）~60%（VIP默认，含备用金等可控池）
2. **解锁机制是天然过滤器**：月消费3次 → 只有20%奖励被解锁，80%回流
3. **树深度有限**：100万用户也只有13层深，远低于15层上限
4. **VIP 399是纯利润**：每个VIP贡献250元一次性收入
5. **奖励只能提现不能抵扣**：用户可能懒得提现，滞留在账户

### 风险因素

1. **VIP奖励比例过高时利润薄**：vipRewardPct=40%时平台可控比例下降，如果解锁率高则危险
2. **早期用户集中**：level 1~3的用户可能累积大额奖励
3. **加价率太低时**：利润空间不够覆盖运营成本
4. **高频用户场景**：如果用户真的每月消费15次，解锁率趋近100%

### 预判结论

**在默认参数下（markup=1.3, 普通rewardPct=16%, VIP rewardPct=30%, freq=3次/月），系统大概率盈利。** 最敏感的变量是购买频率和奖励比例的组合。模型的主要价值在于找到「前期激进配置（高奖励比例吸引用户）不至于亏损的边界在哪」。
