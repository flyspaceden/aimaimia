-- 售后顺丰物流轨迹推送落库
--
-- 背景：顺丰路由推送（RoutePushService）按 Shipment.waybillNo 匹配，但售后退/换货
-- 单号写在 AfterSaleRequest.{returnWaybillNo,replacementWaybillNo,sellerReturnWaybillNo}
-- 不在 Shipment 表，导致推送进来后找不到对应记录被丢弃。
--
-- 修复：handleSfCallback 找不到 Shipment 时 fallback 匹配 AfterSaleRequest，
-- 把事件 append 到下面三个 JSON 字段。3 个字段对应三种退/换货物流方向。
--
-- 字段结构：[{ time: ISO字符串, message: 文案, location?, opCode?, statusCode? }, ...]
-- 升序按 acceptTime 排列，去重 by (time + opCode)。
--
-- 回滚：DROP COLUMN 即可，不破坏现有数据（nullable + 新增）。

ALTER TABLE "after_sale_request"
  ADD COLUMN "returnTrackingEvents"        JSONB,
  ADD COLUMN "replacementTrackingEvents"   JSONB,
  ADD COLUMN "sellerReturnTrackingEvents"  JSONB;
