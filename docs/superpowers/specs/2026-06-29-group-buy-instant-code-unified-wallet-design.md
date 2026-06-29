# 团购即时分享码与统一消费积分设计方案

> 状态：设计已确认，待实施计划
> 创建时间：2026-06-29
> 适用范围：买家 App / 后端 / 管理后台 / Prisma Schema / 订单支付 / 售后 / 钱包与流水 / 数字资产
>
> **For agentic workers:** 本文档是团购规则二次调整的权威来源，补充并覆盖 `docs/superpowers/specs/2026-06-21-group-buy-share-rebate-design.md` 中关于分享码生成、售后等待期、团购返还钱包展示和团购订单优惠使用的旧口径。

## 背景

第一版团购设计要求发起人订单在确认收货且售后期结束后才生成分享码。现在业务规则调整为：团购商品不支持退货、换货或退款，付款成功后应立即生成团购码，否则推广传播意义不足。

同时，团购返还余额和现有消费积分在用户端用途接近：都可用于普通商品抵扣和提现。后台仍需要保留每一笔账的来源和流水，但 App 用户不需要理解当前抵扣或提现来自分润奖励、团购返还还是产业基金。

## 当前代码事实

本次设计基于当前代码状态，而不是旧文档口径：

1. 团购下单已有现金购买硬拦截：`GroupBuyCheckoutService.assertCashOnly()` 会拒绝消费积分抵扣、团购返还余额抵扣、平台红包和旧 `rewardId`。
2. 团购 App 结算页当前只传 `activityId`、`addressId`、`paymentChannel`、`shareCode`、`idempotencyKey`，不传优惠字段。
3. 团购返还已有独立账户与流水：`GroupBuyRebateAccount` / `GroupBuyRebateLedger`。
4. 普通商品 checkout 已有团购返还余额独立抵扣字段：`groupBuyRebateDeductionAmount`。
5. 团购返还提现已接入 `WithdrawPayoutService.requestGroupBuyRebateWithdraw()`。
6. 当前消费积分钱包 `getWallet()` 合并展示 `VIP_REWARD`、`NORMAL_REWARD`、`INDUSTRY_FUND`，但订单抵扣只使用 `VIP_REWARD` 和 `NORMAL_REWARD`；产业基金当前只参与提现，不参与订单抵扣。
7. `/me` 用户资料当前没有返回“是否卖家 OWNER”，App 无法可靠判断是否展示产业基金明细入口。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 团购付款后分享码 | 团购订单支付成功后立即生成团购码并进入可分享状态 |
| 团购退换货 | 团购订单不支持用户主动取消、退款、退货、换货 |
| 质量问题 | 收货后 24 小时内质量问题联系客服，只补发，不退款；超过 24 小时不处理 |
| 团购优惠 | 团购订单必须现金支付，不能使用平台红包、消费积分、团购返还、VIP 折扣或任何优惠 |
| 团购推荐返还 | 被推荐人付款后，推荐人立即看到冻结/待释放的团购返还；被推荐人确认收货后释放为可用 |
| 返还后台账本 | 后端继续使用独立 `GroupBuyRebateAccount` / `GroupBuyRebateLedger` 详细记账 |
| App 消费积分 | App 用户端展示一个统一“消费积分”总账，不要求用户区分资金来源 |
| 普通商品抵扣 | 普通商品订单可使用统一消费积分抵扣；后端自动拆来源 |
| 团购商品抵扣 | 团购商品不可使用任何抵扣或优惠 |
| 统一提现 | App 使用一个消费积分提现入口；后端按来源自动拆账 |
| 产业基金展示 | 只有当前买家同时是卖家企业 OWNER 时，App 才显示产业基金明细入口或筛选 |
| 产业基金使用 | 保持当前规则：产业基金不参与普通商品订单抵扣，提现时作为最后扣款来源 |
| VIP 团购数字资产 | VIP 用户购买团购商品，付款成功后按团购商品实付金额计入数字资产；普通用户不计入 |
| 历史团购实例 | 已付款但仍处于 `QUALIFICATION_PENDING` 的团购实例，上线后一次性补生成码并进入分享中 |

## 非目标

本次不做以下内容：

- 不改变普通/VIP 分润、产业基金的计算和入账规则。
- 不把团购返还物理迁移进 `RewardAccount`。
- 不让产业基金参与普通商品订单抵扣。
- 不把团购商品放入普通购物车结算。
- 不支持团购订单退款、退货、换货、自助售后或用户主动取消。
- 不做多级团购推荐、团队、排行榜或收益榜。
- 不改变平台红包 Coupon 系统。

## 业务规则

### 团购购买与分享码

团购订单支付成功后，在支付回调创建订单的同一事务中完成：

1. 创建团购订单。
2. 创建或更新 `GroupBuyInstance`。
3. 立即生成唯一 `GroupBuyCode`。
4. 将实例状态从旧的 `QUALIFICATION_PENDING` 口径调整为 `SHARING`。
5. 如果购买时使用他人的团购码，创建推荐人的候选返还记录。

分享码不再等待确认收货、售后期结束或 7 天窗口。旧的 `QUALIFICATION_PENDING` 只用于兼容历史数据迁移，不作为新订单常规状态。

### 团购售后口径

团购订单不提供用户自助售后入口：

- 订单列表和订单详情不展示取消订单、申请退款、申请退货、申请换货入口。
- 后端取消订单接口和售后申请接口必须拒绝 `bizType=GROUP_BUY`。
- 客服入口可以保留，但只能引导“收货后 24 小时内质量问题联系客服补发”。
- 补发由客服/后台线下或后续专门工单处理，不走退款资金链路。

文案统一：

```text
团购商品为活动专属价格，付款后不支持取消、退款、退货或换货。收货后 24 小时内如有质量问题，请联系客服核实后补发；超过 24 小时不再受理。
```

### 团购推荐返还

被推荐人通过团购码购买同款团购商品并付款成功后，推荐人立即看到待释放返还：

1. 支付成功后创建 `GroupBuyReferral`。
2. 同时创建 `GroupBuyRebateLedger`，类型为 `PENDING_REBATE`，状态为 `PENDING`。
3. 该金额计入 App 的冻结/待释放展示，但不增加 `GroupBuyRebateAccount.balance`。
4. 被推荐人确认收货后，将该笔返还释放为可用：
   - 写入 `RELEASE / AVAILABLE` 流水；若已有待释放流水，则通过元数据关联原 `PENDING_REBATE`。
   - 增加 `GroupBuyRebateAccount.balance`。
   - 将推荐记录标记为有效。
5. 团购订单无退款/退货/换货，因此不再等待 7 天售后保护期。

如果被推荐人的订单在付款后因系统异常、支付撤销、风控或管理员强制作废导致无法履约，则待释放返还应转为 `VOIDED`，并写明原因。

### 团购返还档位

返还档位、返还比例、推荐奖励规则保持当前团购规则不变。变化只在发放时点：

- 旧口径：确认收货 + 售后期结束后才计算并释放。
- 新口径：付款后立即展示冻结返还，确认收货后释放。

档位顺序仍按有效推荐订单顺序计算。为避免并发，付款创建待释放返还和确认收货释放返还都必须使用 Serializable 事务和幂等键。

## 统一消费积分设计

### 用户端口径

App 中只保留一个用户理解的账户：`消费积分`。

用户看到：

- 可用消费积分。
- 冻结/待释放消费积分。
- 累计获得。
- 消费积分抵扣。
- 消费积分提现。

用户不需要选择“用分润奖励还是团购返还”，也不需要知道提现扣的是哪一类来源。

### 后端账户来源

后台和数据库继续分账：

| 来源 | 数据载体 | App 是否并入消费积分总额 | 普通商品抵扣 | 提现 |
|---|---|---:|---:|---:|
| VIP 分润奖励 | `RewardAccount(VIP_REWARD)` | 是 | 是 | 是 |
| 普通分润奖励 | `RewardAccount(NORMAL_REWARD)` | 是 | 是 | 是 |
| 团购返还 | `GroupBuyRebateAccount` | 是 | 是 | 是 |
| 产业基金 | `RewardAccount(INDUSTRY_FUND)` | 是 | 否 | 是，最后扣 |

产业基金虽然计入 App 顶部总余额和提现可用余额，但不计入普通商品抵扣额度。结算页必须展示后端返回的可抵扣上限，不能直接用钱包总余额计算。

### 钱包聚合接口

实施时必须提供一个面向 App 的统一钱包数据结构。可以扩展现有 `/bonus/wallet`，也可以新增独立接口，但返回口径必须包含：

```ts
type UnifiedWallet = {
  balance: number;              // App 顶部可用消费积分：reward + group-buy + industry
  frozen: number;               // 冻结/待释放：reward frozen + pending group-buy + industry frozen
  total: number;                // 累计获得/历史合计
  deductibleBalance: number;    // 普通商品可抵扣余额：VIP_REWARD + NORMAL_REWARD + GROUP_BUY_REBATE，不含产业基金
  withdrawableBalance: number;  // 可提现余额：VIP_REWARD + NORMAL_REWARD + GROUP_BUY_REBATE + INDUSTRY_FUND
  isSellerOwner: boolean;
  breakdown?: {
    vipReward: { balance: number; frozen: number };
    normalReward: { balance: number; frozen: number };
    groupBuyRebate: { balance: number; pending: number; reserved: number };
    industryFund?: { balance: number; frozen: number };
  };
};
```

`breakdown.industryFund` 只有 `isSellerOwner=true` 时返回或在 App 展示。普通买家即使历史上不存在产业基金账户，也不展示产业基金 tab 或筛选项。

### OWNER 判断

后端以 `CompanyStaff` 判断：

```ts
companyStaff.count({
  where: {
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
  },
});
```

`isSellerOwner` 必须由后端返回，可以放在 `/me` 或统一钱包接口中。App 不应通过余额是否为 0、是否有产业基金流水、手机号或卖家登录状态猜测 OWNER 身份。

### 统一流水

钱包页流水将两套 ledger 合并排序：

| 后端来源 | App 标题 | 状态展示 |
|---|---|---|
| `RewardLedger RELEASE/AVAILABLE` | 消费返积分 / 推荐返积分 | 已到账 |
| `RewardLedger FREEZE/FROZEN` | 消费返积分 | 冻结中 |
| `RewardLedger DEDUCT` | 消费积分抵扣 | 已完成 / 已预留 |
| `RewardLedger WITHDRAW` | 消费积分提现 | 处理中 / 已到账 / 已退回 |
| `GroupBuyRebateLedger PENDING_REBATE/PENDING` | 团购返还 | 待收货释放 |
| `GroupBuyRebateLedger RELEASE/AVAILABLE` | 团购返还 | 已到账 |
| `GroupBuyRebateLedger DEDUCT` | 消费积分抵扣 | 已完成 / 已预留 |
| `GroupBuyRebateLedger WITHDRAW` | 消费积分提现 | 处理中 / 已到账 / 已退回 |
| `INDUSTRY_FUND` ledger | 产业基金 | 仅 OWNER 可见 |

默认钱包列表不需要让普通用户按来源理解每笔钱，但流水标题可以保留“团购返还”“产业基金”这种来源名称，便于对账。产业基金来源仅 OWNER 可见。

### 普通商品抵扣

普通商品结算页仍只展示一个“消费积分抵扣”输入。

后端扣款顺序固定为：

1. `VIP_REWARD`
2. `NORMAL_REWARD`
3. `GROUP_BUY_REBATE`

产业基金不参与订单抵扣。后端需要把一次用户输入拆成两套账本操作：

- `RewardDeductionService` 处理 `VIP_REWARD` / `NORMAL_REWARD`。
- `GroupBuyRebateDeductionService` 处理剩余的团购返还部分。

`CheckoutSession` 继续保留分账字段，包括 `deductionGroupId`、`groupBuyRebateDeductionGroupId`、`discountAmount`、`groupBuyRebateDeductionAmount`，但 App 不展示这些内部字段。

### 统一提现

App 只保留一个“消费积分提现”入口。

后端提现扣款顺序固定为：

1. `VIP_REWARD`
2. `NORMAL_REWARD`
3. `GROUP_BUY_REBATE`
4. `INDUSTRY_FUND`

`WithdrawRequest.accountType` 继续记录主来源，实际来源拆分写入各自 ledger。管理后台提现详情必须能展开看到每个来源扣了多少。

## 团购数字资产规则

团购订单接入数字资产，但只对 VIP 用户生效：

1. 买家是 VIP：团购付款成功后立即按团购商品实付金额计入数字资产。
2. 买家不是 VIP：不计入数字资产。
3. 金额口径：团购商品实付金额，不含运费；团购订单没有红包、积分、团购返还或 VIP 折扣，所以通常等于团购价。
4. 入账时点：付款成功创建订单后立即入账，不等确认收货。
5. 幂等键：`group-buy-payment:${orderId}:digital-asset-credit`。

这条规则是 `docs/superpowers/specs/2026-06-14-digital-asset-cumulative-spend-design.md` 的团购特例：普通商品和 VIP 礼包仍按原设计执行，团购 VIP 特例按本文件覆盖。

## App 改造范围

### 团购页面

需要更新所有旧售后期文案：

- 不再写“确认收货且无退换货后生成推荐码”。
- 改为“付款成功后生成团购码，可立即分享”。
- 规则说明强调“团购商品现金购买，不支持取消、退款、退货、换货；24 小时内质量问题联系客服补发”。

团购进度里增加待释放金额展示：

- 被推荐人付款后：`待释放 ¥x`。
- 被推荐人确认收货后：`已到账 ¥x`。

### 订单页面

`bizType=GROUP_BUY` 的订单：

- 不展示取消订单。
- 不展示申请售后。
- 不展示退款/退货/换货入口。
- 展示质量问题提示和客服入口。

### 钱包页面

钱包页继续叫“消费积分”：

- 顶部余额展示统一总额。
- 普通用户不展示“产业基金”来源 tab。
- 卖家 OWNER 可以看到产业基金明细入口或筛选。
- 团购返还并入流水。
- 用户进行抵扣或提现时不需要选择来源。

### 提现页面

提现页展示统一可提现余额。提交仍只提交金额和支付宝信息，后端自动拆来源。

### 普通 checkout 页面

普通商品结算页展示一个消费积分抵扣金额。页面使用后端 preview 返回的最大可抵扣金额。不要用钱包总余额自行计算，因为产业基金不参与抵扣。

### 团购 checkout 页面

团购专用 checkout 保持现金支付：

- 不展示平台红包选择。
- 不展示消费积分抵扣。
- 不展示团购返还抵扣。
- 不展示 VIP 折扣。
- 底部只显示团购价、运费和应付现金金额。

## 管理后台与后台账本

管理后台必须保留详细来源：

- 团购返还账户明细。
- 团购返还待释放流水。
- 团购返还释放流水。
- 消费积分提现来源拆分。
- 普通商品抵扣来源拆分。
- 产业基金独立流水。

团购订单详情需要展示：

- 团购活动。
- 团购码。
- 是否通过他人团购码购买。
- 推荐人。
- 推荐返还状态：待释放 / 已释放 / 已作废。
- 是否已计入 VIP 数字资产。

## 历史数据与迁移

上线时需要处理历史团购数据：

1. 查找已付款、未取消、未退款、仍处于 `QUALIFICATION_PENDING` 的团购实例。
2. 为每个实例补生成 `GroupBuyCode`。
3. 将实例切到 `SHARING`。
4. 若已有通过分享码付款但未释放的候选推荐，根据付款状态补 `PENDING_REBATE` 流水。
5. 所有补偿脚本必须幂等，重复执行不能重复生成码或重复记账。

## 并发与资金安全

涉及金额、奖励、提现、抵扣、支付回调的改动必须使用 Serializable 事务或等价 CAS 保护：

- 支付成功生成团购码和待释放返还。
- 确认收货释放团购返还。
- 普通商品统一消费积分抵扣预留。
- 统一提现余额冻结。
- 迁移脚本补生成团购码和补记待释放流水。

每一类流水都必须有唯一幂等键：

- 团购码：`GROUP_BUY_CODE:{instanceId}`
- 待释放返还：`GROUP_BUY_PENDING_REBATE:{referralId}`
- 释放返还：`GROUP_BUY_REBATE:{referralId}`
- 团购 VIP 数字资产：`GROUP_BUY_DIGITAL_ASSET:{orderId}`
- 统一提现各来源 ledger：沿用 withdrawId/groupId 生成唯一键

## 测试要求

### 后端单测

- 团购 checkout 传入消费积分、团购返还、平台红包、`rewardId` 时全部拒绝。
- 团购支付成功后立即生成团购码。
- 同一个支付回调重复执行不会重复生成团购码。
- 被推荐人付款后创建 `PENDING_REBATE`，不增加可用余额。
- 被推荐人确认收货后释放返还并增加可用余额。
- 团购订单取消、售后申请、退款申请接口拒绝。
- VIP 买团购付款成功计入数字资产；普通用户不计入。
- 统一钱包聚合包含团购返还。
- 普通商品抵扣可跨 `RewardAccount` 和 `GroupBuyRebateAccount` 自动拆账，产业基金不参与抵扣。
- 统一提现可跨 `RewardAccount`、`GroupBuyRebateAccount`、`INDUSTRY_FUND` 自动拆账，产业基金最后扣。
- `isSellerOwner` 只在存在 ACTIVE OWNER `CompanyStaff` 时为 true。

### App 验证

- 团购 checkout 无任何优惠入口。
- 团购详情和 checkout 文案不再出现“7 天后生成码”或“无退换货后生成码”。
- 团购订单详情不展示取消/售后入口。
- 钱包页普通买家不展示产业基金 tab。
- 钱包页卖家 OWNER 展示产业基金明细入口。
- 钱包顶部总额包含团购返还。
- 普通商品 checkout 只展示一个消费积分抵扣输入。
- 用户只有团购返还余额时，可用于普通商品抵扣和提现。

## 发布与回滚

发布顺序：

1. 后端补齐状态机、钱包聚合、统一提现/抵扣和 OWNER 判断。
2. 跑历史补偿脚本，补生成已付款团购码。
3. App 更新团购、订单、钱包、checkout 文案和入口。
4. 管理后台补流水来源展示。

回滚原则：

- 已生成的团购码不回收，除非管理员明确作废活动。
- 已写入的团购返还流水不物理删除，只能通过 `VOIDED` 或调整流水修正。
- 已计入数字资产的 VIP 团购流水不删除，必要时通过反向流水冲正。
