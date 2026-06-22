# 数字资产消费资产冻结设计方案

> 状态：设计已确认，实施中
> 创建时间：2026-06-21
> 适用范围：买家 App / 管理后台 / 后端 / Prisma Schema / 订单支付与确认收货链路
>
> **For agentic workers:** 本文档补充并覆盖 `2026-06-17-digital-asset-v2-rules-design.md` 中“VIP 后普通消费确认收货时发消费资产”的时点描述。新口径是：普通商品付款成功后立即生成冻结消费资产流水，确认收货后释放为正式消费资产；取消或退款成功时作废或扣回。

## 背景

当前数字资产消费资产只在订单确认收货后入账。用户付款后进入数字资产页看不到任何消费资产变化，会误以为付款没有产生数字资产。

产品口径调整为：用户付款成功后立即能看到本次订单产生的消费资产，但该资产处于冻结状态，页面提示“确认收货后释放”。订单确认收货后，冻结资产释放为正式消费资产；如果订单在确认收货前取消或退款，冻结资产作废。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 付款成功展示 | 普通商品付款成功后立即写冻结消费资产流水 |
| 冻结提示 | 买家端显示“确认收货后释放” |
| 数字资产总额 | 仍等于 `seedAssetBalance + creditAssetBalance`，不包含冻结消费资产 |
| 消费资产余额 | 只包含已释放消费资产 |
| 冻结资产余额 | 新增 `frozenCreditAssetBalance`，只展示待释放消费资产 |
| 确认收货 | 优先释放冻结消费资产；若没有冻结流水，兼容旧订单直接确认入账 |
| 退款/取消 | 确认收货前退款或取消作废冻结资产；确认收货后退款继续扣回已释放资产 |
| VIP 礼包 | 不产生冻结消费资产，仍只走 VIP 种子资产和历史消费转入规则 |
| 普通用户 | 仍只有累计消费，不展示消费资产和冻结资产余额 |

## 数据模型

`DigitalAssetAccount` 增加两个待释放字段：

```text
frozenCreditAssetBalance: 冻结消费资产余额
frozenCumulativeSpendAmount: 冻结消费资产对应的待释放累计消费金额
```

`frozenCumulativeSpendAmount` 不直接展示给买家，但用于多个未确认收货订单连续付款时正确计算跨档倍率，避免每笔待释放订单都只基于已释放累计消费重复计算。

`DigitalAssetLedger` 增加冻结快照字段：

```text
frozenCreditAssetBalanceAfter: 本流水后的冻结消费资产余额
frozenCumulativeSpendAfter: 本流水后的冻结累计消费金额
```

`DigitalAssetLedgerType` 增加：

```text
CONSUMPTION_PAID_FROZEN     普通商品付款成功，消费资产冻结
CONSUMPTION_FROZEN_RELEASED 确认收货，冻结消费资产释放
CONSUMPTION_FROZEN_VOIDED   确认收货前取消或退款，冻结消费资产作废
```

## 状态流转

```text
普通商品付款成功
  -> 写 CONSUMPTION_PAID_FROZEN / CREDIT_ASSET
  -> 增加 frozenCreditAssetBalance
  -> 增加 frozenCumulativeSpendAmount

确认收货
  -> 写 CONSUMPTION_CONFIRMED / CUMULATIVE_SPEND
  -> 写 CONSUMPTION_FROZEN_RELEASED / CREDIT_ASSET
  -> 增加 cumulativeSpendAmount
  -> 增加 creditAssetBalance
  -> 减少 frozenCreditAssetBalance
  -> 减少 frozenCumulativeSpendAmount

确认收货前取消或退款成功
  -> 写 CONSUMPTION_FROZEN_VOIDED / CREDIT_ASSET
  -> 减少 frozenCreditAssetBalance
  -> 减少 frozenCumulativeSpendAmount

确认收货后退款或退货成功
  -> 沿用 REFUND_REVERSAL
  -> 扣回 cumulativeSpendAmount 和 creditAssetBalance
```

## 幂等键

| 场景 | 幂等键 |
|---|---|
| 付款冻结消费资产 | `order:{orderId}:credit-asset-frozen` |
| 释放冻结消费资产 | `order:{orderId}:credit-asset-release` |
| 释放累计消费 | `order:{orderId}:spend-credit` |
| 退款前冻结作废 | `refund:{refundId}:digital-asset-frozen-void:credit` |
| 售后前冻结作废 | `after-sale:{afterSaleId}:digital-asset-frozen-void:credit` |

所有账户变更必须在 Serializable 事务内完成，且所有自动流水必须有业务语义幂等键。

## 前端展示

买家 App VIP 数字资产页：

- 顶部 `数字资产总额` 不包含冻结资产。
- 保留 `种子资产`、`消费资产`。
- 新增 `冻结资产`，显示 `frozenCreditAssetBalance`。
- 最近流水中冻结记录标题为“消费资产冻结”，说明为“确认收货后释放”。
- 释放记录标题为“消费资产释放”。
- 作废记录标题为“冻结资产作废”。

管理后台：

- 总览、账户列表、账户详情展示冻结消费资产。
- 流水来源标签支持冻结、释放、作废三类。
- 导出增加冻结消费资产列。

## 安全检查

- 付款冻结、确认释放、退款作废均在 Serializable 事务内执行。
- 订单支付建单主事务完成后异步触发冻结资产，失败不阻断支付主链路。
- 确认收货释放失败不回滚订单终态，保留既有失败状态历史记录。
- 退款作废失败写入数字资产退款扣回补偿记录并复用补偿重试。
- `totalAssetBalance` 永远不包含冻结资产，避免把未履约订单展示为正式资产。
