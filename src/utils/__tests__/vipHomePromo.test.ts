declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { getVipPromoCarouselCopy } from '../vipHomePromo';

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
