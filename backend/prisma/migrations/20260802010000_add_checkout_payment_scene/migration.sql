-- 旧 CheckoutSession 均由买家 App 创建，使用 APP 默认值向后兼容。
ALTER TABLE "CheckoutSession"
ADD COLUMN "paymentScene" "PaymentScene" NOT NULL DEFAULT 'APP';

CREATE INDEX "CheckoutSession_userId_status_paymentScene_idx"
ON "CheckoutSession"("userId", "status", "paymentScene");
