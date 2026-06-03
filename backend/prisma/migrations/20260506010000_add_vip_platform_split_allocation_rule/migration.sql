-- 补齐 AllocationRuleType 枚举：新增 VIP_PLATFORM_SPLIT
--
-- 背景：
--   schema.prisma 早先添加了 VIP_PLATFORM_SPLIT 用于 VIP 利润六分中的"平台 5 池记账"
--   （平台 50% / 产业基金 10% / 慈善 2% / 科技 2% / 备用金 6%）
--   但当时未生成对应 migration，staging/production DB 仍是 init 时的 5 个值。
--   导致 BonusAllocationService.executeVipPlatformSplit 写入时 PG 抛
--   "invalid input value for enum AllocationRuleType: VIP_PLATFORM_SPLIT"
--   → VIP 用户买普通商品订单收货后分润事务全部回滚 + cron 持续重试刷屏
--
-- 触发条件：VIP 身份用户购买 NORMAL_GOODS 订单收货时（VIP_PACKAGE 礼包订单不分润，不踩此 bug）
-- 风险：纯枚举追加，IF NOT EXISTS 幂等，零数据迁移，向后兼容

ALTER TYPE "AllocationRuleType" ADD VALUE IF NOT EXISTS 'VIP_PLATFORM_SPLIT';
