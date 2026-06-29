declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { GROUP_BUY_AFTER_SALE_NOTICE, isGroupBuyOrderBizType } from '../groupBuyOrderRules';

describe('group buy order rules', () => {
  it('detects group-buy orders from bizType', () => {
    expect(isGroupBuyOrderBizType('GROUP_BUY')).toBe(true);
    expect(isGroupBuyOrderBizType('NORMAL_GOODS')).toBe(false);
    expect(isGroupBuyOrderBizType('VIP_PACKAGE')).toBe(false);
  });

  it('uses support-only no-return copy', () => {
    expect(GROUP_BUY_AFTER_SALE_NOTICE).toContain('不支持取消、退款、退货或换货');
    expect(GROUP_BUY_AFTER_SALE_NOTICE).toContain('收货后 24 小时内');
    expect(GROUP_BUY_AFTER_SALE_NOTICE).toContain('补发');
  });
});
