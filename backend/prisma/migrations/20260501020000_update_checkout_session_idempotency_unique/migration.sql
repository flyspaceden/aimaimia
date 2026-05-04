-- Replace CheckoutSession idempotency unique:
--   (userId, idempotencyKey) → (userId, bizType, idempotencyKey)
--
-- Reason: 普通商品 checkout 与 VIP 礼包 checkout 用同一个 CheckoutSession 表，
-- 但 idempotencyKey 在两套流程是独立空间。当前唯一约束没加 bizType，
-- 导致用户先创建 VIP session 后再创建普通 session（或反之）使用相同 key 时
-- 会撞 P2002，幂等行为错乱。
--
-- 业务上允许同一 (userId, idempotencyKey) 在不同 bizType 下并存。

DROP INDEX IF EXISTS "CheckoutSession_userId_idempotencyKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutSession_userId_bizType_idempotencyKey_key"
ON "CheckoutSession"("userId", "bizType", "idempotencyKey");
