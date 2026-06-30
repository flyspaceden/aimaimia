export function buildGroupBuyActivityRules(tierCount: number): string[] {
  const safeTierCount = Math.max(1, Math.floor(Number(tierCount) || 0));
  return [
    '付款成功后立即生成本次团购推荐码。',
    '只有通过你的推荐码购买同一团购商品的其他用户，才会计入推荐人数。',
    '好友付款后返还先冻结，好友确认收货后释放。',
    '团购无法使用红包、消费积分抵扣、团购返还余额等优惠活动。',
    `最多推荐${safeTierCount}人，每次推荐都会获得相应奖励。`,
    '同一时间只能有1个团购推荐码。',
    '团购商品不支持退换货或退款；收货后24小时内质量问题请联系客服补发。',
    'VIP用户购买团购后会累计消费资产，普通用户不累计消费资产。',
    '可以随时终止团购，终止后未确认或未释放的返还将失效。',
  ];
}
