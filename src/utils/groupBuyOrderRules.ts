export const GROUP_BUY_AFTER_SALE_NOTICE =
  '团购订单支付后不支持取消、退款、退货或换货；收货后 24 小时内如有质量问题，请联系客服核实后补发。';

export function isGroupBuyOrderBizType(bizType?: string | null): boolean {
  return bizType === 'GROUP_BUY';
}
