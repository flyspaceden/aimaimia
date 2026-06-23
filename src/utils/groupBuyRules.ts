export function buildGroupBuyActivityRules(tierCount: number): string[] {
  const safeTierCount = Math.max(1, Math.floor(Number(tierCount) || 0));
  return [
    '购买本商品并确认收货后，若没有退换货，会生成本次团购推荐码。',
    '只有通过你的推荐码购买同一团购商品的其他用户，才会计入推荐人数。',
    '团购无法使用红包，消费积分抵扣等优惠活动。',
    `最多推荐${safeTierCount}人，每次推荐都会获得相应奖励。`,
    '同一时间只能有1个团购推荐码。',
    '可以随时终止团购，终止后未推荐的奖励即刻失效。',
  ];
}
