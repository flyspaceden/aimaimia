-- VIP 礼包订单支付金额应以 CheckoutSession.expectedTotal / VipPurchase.amount 为准。
-- 历史版本支付回调用赠品 SKU 单价合计反写 Order.totalAmount/goodsAmount，
-- 导致 399 礼包在订单列表显示为赠品成本价合计。
UPDATE "Order" AS o
SET
  "totalAmount" = src.vip_amount,
  "goodsAmount" = src.vip_amount,
  "shippingFee" = 0,
  "discountAmount" = 0,
  "vipDiscountAmount" = 0,
  "totalCouponDiscount" = 0
FROM (
  SELECT
    oo."id" AS order_id,
    COALESCE(
      cs."expectedTotal",
      vp."amount",
      NULLIF(oo."bizMeta"->>'snapshotPrice', '')::DOUBLE PRECISION
    ) AS vip_amount
  FROM "Order" AS oo
  LEFT JOIN "CheckoutSession" AS cs ON cs."id" = oo."checkoutSessionId"
  LEFT JOIN "VipPurchase" AS vp ON vp."orderId" = oo."id"
  WHERE oo."bizType" = 'VIP_PACKAGE'
) AS src
WHERE o."id" = src.order_id
  AND src.vip_amount IS NOT NULL
  AND ABS(o."totalAmount" - src.vip_amount) > 0.01;
