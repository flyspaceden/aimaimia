# 付费 VIP 礼包推荐奖恢复设计

## 背景

2026-07-05 的 VIP 升级推荐关系改造删除了 `activateVipAfterPayment()` 内的一次性 VIP 推荐奖调用。该删除本意是避免“累计消费自动升级 VIP”产生一次性奖励，但实际同时影响了真实付费的 `VIP_PACKAGE`，而新的持续直推佣金仅处理 `NORMAL_GOODS`，导致付费 VIP 礼包出现奖励断档。

## 业务边界

- 仅 `APP_VIP_PACKAGE` 付费激活成功时恢复一次性 VIP 推荐奖。
- 累计消费自动升级 VIP 继续不创建 `VipPurchase`，也不发一次性 VIP 推荐奖。
- 推荐人必须经过 `resolveVipUpgradeReferralContext()` 裁决后仍是有效的 VIP 直推推荐人；普通推荐人在被推荐人升级时失效，不获得 VIP 推荐奖。
- 奖励金额使用 `VipPurchase.amount × VipPurchase.referralBonusRate` 的购买快照，向下截断到分。
- 奖励立即记入推荐人的 `VIP_REWARD` 可用余额，流水保持 `refType=VIP_REFERRAL`、`scheme=VIP_REFERRAL`。
- 同一个 `VipPurchase.id` 只允许存在一笔有效 `VIP_REFERRAL` 流水。激活 CAS 是主幂等边界，授奖函数再按 `refType + refId` 做防御性查重。
- 被删除或非活跃的推荐人继续按既有逻辑把奖励转入平台利润账户。

## 数据修复

生产用户 `AIMM00000000000119` 的 VIP 礼包金额为 399 元、推荐奖励比例快照为 13%，有效推荐人为 `AIMM00000000000032`，应补发 `51.87` 元。

补发必须在 Serializable 事务中执行，并在写入前同时确认：购买记录激活成功、推荐关系仍指向 32、现有 `VIP_REFERRAL` 流水为 0。事务内创建流水并增加 32 的 `VIP_REWARD.balance`；重复执行时因已存在流水而跳过。

## 验证

- 回归测试先证明当前付费礼包不会调用授奖函数。
- 恢复后验证有效 VIP 推荐人收到 `amount × snapshot rate`。
- 保留累计消费自动升级不授奖的现有测试。
- 验证重复 `VipPurchase.id` 不重复增加余额。
- 运行 BonusService 聚焦测试、后端 TypeScript 构建、Prisma validate、`git diff --check`。
- 发布后核对生产部署提交，再执行单用户补发并复核流水数量与余额增量。
