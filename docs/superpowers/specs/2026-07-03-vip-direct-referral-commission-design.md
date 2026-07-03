# VIP 直推持续佣金设计方案

## 1. 背景

当前 VIP 普通商品消费后的奖励只走 `VIP_UPSTREAM` 树上溯：第 `k` 笔有效消费给第 `k` 个树上祖先。用户直接推荐他人购买 VIP 后，只能拿一次性 `VIP_REFERRAL` 奖励；后续被推荐人的普通商品消费，不再持续奖励真实直推人。

这会造成激励错位：努力推荐的人只拿一次性奖励，而树位较靠上的用户可能因子树滑落获得后续消费分润。新规则的目标是让直系推荐人能从自己直推 VIP 的后续普通商品消费中持续获得一笔小佣金，同时保持总利润分配守恒。

## 2. 核心结论

VIP 利润分配从六分扩展为七分：

```text
VIP平台占比
+ VIP树奖励占比
+ VIP直推佣金占比
+ VIP产业基金(卖家)占比
+ VIP慈善占比
+ VIP科技占比
+ VIP备用金占比
= 100%
```

新增配置项：

```text
VIP_DIRECT_REFERRAL_PERCENT
```

含义：VIP 普通商品订单利润中，给直系推荐人的持续佣金比例。

默认值为 `0`，保证上线后不自动改变现有收益分配。管理后台推荐模板可提供七分方案，例如：

```text
50 / 25 / 5 / 10 / 2 / 2 / 6
```

即平台 50%，树奖励 25%，直推佣金 5%，产业基金 10%，慈善 2%，科技 2%，备用金 6%。

## 3. 业务规则

### 3.1 适用范围

直推持续佣金只适用于：

- 被推荐人已经是 VIP；
- 订单为普通商品订单；
- 订单支付成功并创建订单；
- 订单商品利润大于 0；
- 订单存在有效直系推荐人 `MemberProfile.inviterUserId`；
- 直系推荐人账号正常且可收款。

不适用于：

- VIP 礼包订单；
- 团购订单；
- 普通未升级 VIP 用户的消费；
- 运费；
- 已取消、退款、退货、换货成功导致不应发放的订单；
- 零利润或负利润订单。

### 3.2 没有可收款直推人

以下情况 `VIP_DIRECT_REFERRAL_PERCENT` 对应金额归平台：

- 被推荐人没有直系推荐人；
- 直系推荐人账号已注销；
- 直系推荐人账号被封禁或非 ACTIVE；
- 直系推荐人数据不存在。

这笔金额不转给树上祖先，不并回 `VIP_UPSTREAM`。

### 3.3 固定金额

第一版不支持固定金额，只支持利润比例。

原因：本规则属于利润七分结构的一部分，固定金额会破坏比例总和守恒，低利润订单还可能让平台亏钱。

## 4. 资金状态流

### 4.1 支付成功后立即冻结可见

普通商品支付成功并创建订单后，立即给直系推荐人生成一笔可见冻结佣金。

建议流水语义：

```text
RewardAccount.type = VIP_REWARD
RewardLedger.entryType = FREEZE
RewardLedger.status = FROZEN
RewardLedger.refType = ORDER
RewardLedger.refId = orderId
RewardLedger.meta.scheme = VIP_DIRECT_REFERRAL
```

`RewardAccount.frozen` 同步增加，用户钱包立即能看到待释放金额。

这类 `FROZEN` 不走现有 `VIP_UPSTREAM` 的冻结过期逻辑。它只能由两类路径处理：

- 订单取消、退款、退货、换货成功时作废；
- 退换货窗口结束且无成功售后时释放。

### 4.2 确认收货后仍不立即释放

订单确认收货后，直推佣金继续保持冻结。确认收货只代表履约完成，不代表退换货窗口结束。

### 4.3 退换货窗口结束后释放

当订单退换货窗口结束，并且没有退款、退货、换货成功记录时，定时任务释放直推佣金：

```text
RewardLedger.status: FROZEN -> AVAILABLE
RewardLedger.entryType: FREEZE -> RELEASE
RewardAccount.frozen -= amount
RewardAccount.balance += amount
```

售后取消或驳回不阻止释放。

### 4.4 成功售后作废

如果订单取消、退款、退货、换货成功，则作废这笔冻结佣金：

```text
RewardLedger.status: FROZEN -> VOIDED
RewardLedger.entryType: FREEZE -> VOID
RewardAccount.frozen -= amount
```

同时创建平台留存镜像流水，记录该直推佣金最终归平台，便于审计。

## 5. 后端设计

### 5.1 配置模型

新增 `RuleConfig`：

```text
VIP_DIRECT_REFERRAL_PERCENT = 0
```

需要更新：

- `BonusConfig` 接口新增 `vipDirectReferralPercent`；
- 配置 key 映射新增 `VIP_DIRECT_REFERRAL_PERCENT`；
- 默认值新增 `vipDirectReferralPercent: 0`;
- VIP 比例校验从六项变为七项；
- `admin/config` 的跨项校验从六项变为七项；
- `seed.ts` 和 `production-bootstrap.ts` 插入新默认配置。

旧环境缺失该配置时按 0 处理。

### 5.2 利润计算

`RewardCalculatorService.calculateVip()` 从六分结果扩展为七分结果：

```ts
interface VipPoolCalculation {
  profit: number;
  platformProfit: number;
  rewardPool: number;           // VIP 树奖励，继续走 VIP_UPSTREAM
  directReferralPool: number;   // VIP 直推佣金
  industryFund: number;
  charityFund: number;
  techFund: number;
  reserveFund: number;
}
```

前六项独立按比例计算，备用金继续作为末池补差，保证总和等于 profit。

### 5.3 支付成功创建冻结佣金

在普通商品订单支付成功并创建订单后，新增直推佣金创建逻辑。建议独立服务：

```text
VipDirectReferralCommissionService
```

职责：

- 判断订单是否符合直推佣金条件；
- 查询消费者的 `MemberProfile.inviterUserId`；
- 校验直系推荐人是否可收款；
- 按订单利润和 `vipDirectReferralPercent` 计算金额；
- 写入 `RewardAllocation` 与 `RewardLedger`；
- 更新推荐人的 `VIP_REWARD.frozen`；
- 无可收款直推人时写平台留存流水；
- 保证幂等。

幂等键建议：

```text
ALLOC:ORDER_PAID:{orderId}:VIP_DIRECT_REFERRAL
```

资金写入必须在 Serializable 事务中执行。

### 5.4 与现有 VIP_UPSTREAM 的关系

现有 `VIP_UPSTREAM` 不改变入树、层级、解锁、出局规则。

变化只有：`VIP_REWARD_PERCENT` 代表树奖励占比，通常会被后台调低；新增的 `VIP_DIRECT_REFERRAL_PERCENT` 单独生成直推佣金流水。

示例：

```text
profit = 100
VIP_REWARD_PERCENT = 0.25
VIP_DIRECT_REFERRAL_PERCENT = 0.05

VIP_UPSTREAM rewardPool = 25
VIP_DIRECT_REFERRAL commission = 5
```

### 5.5 释放任务

新增或扩展现有冻结释放任务，扫描：

```text
RewardLedger.status = FROZEN
RewardLedger.entryType = FREEZE
RewardLedger.meta.scheme = VIP_DIRECT_REFERRAL
refType = ORDER
```

释放条件：

- 关联订单状态为 `RECEIVED`；
- `returnWindowExpiresAt < now`；
- 没有成功退款、退货、换货结果；
- 没有进行中需要阻止释放的售后。

取消或驳回的售后不阻止释放。

同时需要更新现有冻结过期任务：`VIP_DIRECT_REFERRAL` 不能被通用 FROZEN 过期扫描作废。否则长物流或长履约订单可能在确认收货前被提前归平台，破坏“支付后冻结、售后窗口后释放”的业务语义。

### 5.6 作废链路

订单取消、退款、退货、换货成功时，需要一并作废 `VIP_DIRECT_REFERRAL` 冻结流水。

该逻辑应接入现有售后/退款作废奖励链路，避免出现订单已退款但直推佣金仍释放的资金漏洞。

## 6. 管理后台设计

更新 `admin/src/pages/bonus/vip-config.tsx`：

- 标题从“VIP 利润六分比例”改为“VIP 利润七分比例”；
- 新增配置项“VIP直推佣金占比”；
- 顶部状态从“六项合计”改为“七项合计”；
- 文案从“以下六项须合计 = 100%”改为“以下七项须合计 = 100%”；
- 推荐模板改为七项，例如 `50/25/5/10/2/2/6`；
- 保存前校验七项总和为 100%；
- 推荐模板弹窗同步展示直推佣金。

管理端配置保存仍使用批量提交，避免逐项保存触发中间态比例不等于 100%。

## 7. 钱包与消息展示

账户仍使用 `VIP_REWARD`，不新增账户类型。

钱包流水文案建议：

- 冻结中：`直推佣金待释放`
- 已到账：`直推佣金到账`
- 作废：`直推佣金已作废`

消息通知建议：

- 支付成功冻结：`您获得一笔直推佣金，订单完成售后保护期后可用。`
- 释放到账：`直推佣金已到账，可提现或用于普通商品抵扣。`
- 作废：`订单发生退款或售后，直推佣金已作废。`

## 8. 审计与报表

`RewardAllocation.meta` 需要包含：

- `scheme: VIP_DIRECT_REFERRAL`;
- `sourceUserId` 消费者；
- `directInviterUserId` 直系推荐人；
- `profit`；
- `directReferralPool`；
- `splitRatios` 七分比例快照；
- `routedToPlatform`；
- `platformReason`。

`RewardLedger.meta` 需要包含：

- `scheme: VIP_DIRECT_REFERRAL`;
- `sourceOrderId`;
- `sourceUserId`;
- `directInviterUserId`;
- `profit`;
- `ratio`;
- `releaseCondition`。

管理后台会员详情、树收益记录、订单分润记录应能区分：

- `VIP_REFERRAL`：购买 VIP 的一次性推荐奖励；
- `VIP_UPSTREAM`：树上溯分润；
- `VIP_DIRECT_REFERRAL`：普通商品后续直推持续佣金。

## 9. 测试计划

### 9.1 配置测试

- 七项合计等于 1.0 时保存通过；
- 七项合计不等于 1.0 时保存失败；
- 缺少 `VIP_DIRECT_REFERRAL_PERCENT` 时后端默认按 0；
- 推荐模板生成 `50/25/5/10/2/2/6`。

### 9.2 计算测试

- VIP 普通商品利润按七分拆分；
- `rewardPool + directReferralPool + 其他五项 = profit`；
- 备用金承担末位补差；
- 零利润订单不生成直推佣金。

### 9.3 支付成功冻结测试

- VIP 被推荐人普通商品支付成功后，直推人立即获得 `FROZEN` 佣金；
- `RewardAccount.frozen` 增加；
- 没有直推人时金额归平台；
- 直推人已注销或封禁时金额归平台；
- VIP 礼包不生成直推佣金；
- 团购不生成直推佣金；
- 普通未升级用户消费不生成直推佣金；
- 重复支付回调不重复生成佣金。

### 9.4 释放测试

- 确认收货但退换货窗口未结束时不释放；
- 退换货窗口结束且无成功售后时释放；
- 售后取消或驳回后仍可释放；
- 释放后 `frozen` 减少、`balance` 增加；
- 重复释放任务幂等。

### 9.5 作废测试

- 订单取消时作废冻结佣金；
- 退款成功时作废冻结佣金；
- 退货成功时作废冻结佣金；
- 换货成功且规则要求不发放时作废冻结佣金；
- 已作废流水不会再被释放；
- 作废时平台镜像流水金额守恒。

### 9.6 回归测试

- 现有 `VIP_UPSTREAM` 树上溯仍按 `VIP_REWARD_PERCENT` 分配；
- `VIP_REFERRAL` 一次性推荐奖励不受影响；
- 普通用户奖励系统 `NORMAL_*` 不受影响；
- 提现和消费积分抵扣继续读取 `VIP_REWARD` 账户余额。

## 10. 文档同步

实现时需要同步更新：

- `docs/architecture/data-system.md`
- `docs/architecture/backend.md`
- `docs/architecture/admin-frontend.md`
- `docs/features/plan-treeforuser.md`
- `docs/features/test-reward.md`
- `docs/features/buy-vip.md`
- `plan.md`

## 11. 发布与迁移

第一版上线建议：

1. 后端先支持新配置，默认 `VIP_DIRECT_REFERRAL_PERCENT = 0`；
2. 管理后台显示七分配置；
3. 验证生产现有配置仍保持等价：`50/30/0/10/2/2/6`；
4. 运营确认后再在后台切换推荐模板或手动调整为目标比例；
5. 调整时必须一次性批量保存七项，避免中间态总和不等于 100%。

## 12. 风险与安全要求

- 该功能涉及资金、奖励、状态转换，所有写入必须使用 Serializable 隔离级别。
- 支付回调、退款、售后、释放任务均必须幂等。
- 直推佣金作废必须和订单退款/售后成功保持一致，避免订单已退款但佣金释放。
- 直推佣金冻结流水必须排除在通用冻结过期任务之外，避免确认收货前被误作废。
- 不能把直推佣金混入 `VIP_UPSTREAM`，否则树收益和直推收益无法审计。
- 配置总和必须在后端强校验，不能只靠前端。
- 不允许固定金额模式进入第一版。
