# 数字资产消费资产冻结实施计划

> 创建时间：2026-06-21
> 对应规格：`docs/superpowers/specs/2026-06-21-digital-asset-frozen-credit-design.md`

## 目标

付款成功后，VIP 用户能立刻在数字资产页看到本次普通商品订单产生的冻结消费资产，并看到“确认收货后释放”。确认收货后冻结资产释放为正式消费资产；确认收货前取消或退款成功则作废冻结资产。

## 任务

1. Schema 与迁移
   - `DigitalAssetAccount` 增加 `frozenCreditAssetBalance`、`frozenCumulativeSpendAmount`。
   - `DigitalAssetLedger` 增加冻结余额快照字段。
   - `DigitalAssetLedgerType` 增加冻结、释放、作废来源类型。

2. 后端数字资产服务
   - 新增 `recordOrderPaid()`，普通商品付款后创建冻结消费资产流水。
   - 改造 `recordOrderReceived()`，优先释放冻结资产；无冻结流水时兼容旧订单直接入账。
   - 改造退款扣回，确认收货前优先作废冻结资产，确认收货后沿用已释放资产扣回。
   - `getSummary()`、`listLedgers()` 返回冻结余额和冻结状态文案。

3. 订单支付链路
   - `CheckoutService.handlePaymentSuccess()` 在建单事务完成后异步触发 `recordOrderPaid(orderId)`。
   - `OrderModule` 给 `CheckoutService` 注入 `DigitalAssetService`。

4. 买家 App
   - 数字资产页新增“冻结资产”展示。
   - 最近流水与全部流水支持冻结、释放、作废三类文案。
   - `数字资产总额` 保持不包含冻结资产。

5. 管理后台
   - 总览、账户列表、账户详情、导出增加冻结消费资产。
   - 流水来源和标签支持冻结、释放、作废三类。

6. 验证
   - 后端单测覆盖付款冻结、确认释放、确认前退款作废、支付建单触发。
   - `npx prisma validate`。
   - 相关 Jest 测试。
   - App 和管理后台 TypeScript 检查。

## 安全检查

- 所有账户余额变更必须走 Serializable 事务。
- 冻结、释放、作废均使用业务幂等键。
- 释放或作废后不得留下负冻结余额。
- 退款前作废和退款后扣回互斥，以流水和余额状态判断实际可处理金额。
- 付款后冻结失败不得影响支付成功主链路；后续确认收货可按旧兜底直接入账。
