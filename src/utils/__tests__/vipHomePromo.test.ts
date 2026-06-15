declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { buildVipHomePromoCards, getVipPromoCarouselCopy } from '../vipHomePromo';

describe('getVipPromoCarouselCopy', () => {
  it('purchase 模式返回非 VIP 购买语境文案（与改动前 UI 文案一致）', () => {
    expect(getVipPromoCarouselCopy('purchase')).toEqual({
      title: 'VIP 开通礼包',
      cardActionHint: '点击查看赠品详情',
    });
  });

  it('referral 模式返回 VIP 推荐语境文案（主语是好友，不出现"开通 VIP"歧义）', () => {
    expect(getVipPromoCarouselCopy('referral')).toEqual({
      title: '好友开通可得礼包',
      cardActionHint: '点击查看礼包详情，可分享给好友',
    });
  });
});

describe('buildVipHomePromoCards', () => {
  it('keeps home carousel cards focused on package-level copy without SKU quantity details', () => {
    const cards = buildVipHomePromoCards([
      {
        id: 'pkg-699',
        price: 699,
        giftOptions: [
          {
            id: 'gift-1',
            title: '龙虾-忘不了10件大礼包',
            subtitle: null,
            badge: null,
            totalPrice: 699,
            available: true,
            items: [
              { productTitle: '龙虾', skuTitle: '默认规格', quantity: 4 },
              { productTitle: '苏丹鱼-忘不了鱼', skuTitle: '400/500克包装', quantity: 1 },
            ],
          },
        ],
      },
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].subtitle).toBe('精选礼包组合');
    expect(cards[0].itemLines).toEqual([]);
    expect(cards[0].subtitle).not.toContain('默认规格');
    expect(cards[0].subtitle).not.toContain('×');
  });
});
