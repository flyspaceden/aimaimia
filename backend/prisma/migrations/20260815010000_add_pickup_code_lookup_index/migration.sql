-- 核销台按 8 位取货码的 HMAC digest 定位本企业待核销订单。
-- 明文短码从不写入数据库或索引。
CREATE INDEX "PickupFulfillment_pickupCodeDigest_status_idx"
ON "PickupFulfillment"("pickupCodeDigest", "status");
