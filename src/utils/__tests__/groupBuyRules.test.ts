import { buildGroupBuyActivityRules } from '../groupBuyRules';

declare const describe: any;
declare const it: any;
declare const expect: any;

describe('group-buy activity rules', () => {
  it('describes instant code generation and direct referrals from other users', () => {
    const rules = buildGroupBuyActivityRules(3);
    expect(rules).toContain('付款成功后立即生成本次团购推荐码。');
    expect(rules).toContain('只有通过你的推荐码购买同一团购商品的其他用户，才会计入推荐人数。');
    expect(rules.join('')).not.toContain('确认收货后，若没有退换货，会生成本次团购推荐码');
  });

  it('discloses that only VIP group-buy purchases accumulate consumption assets', () => {
    expect(buildGroupBuyActivityRules(3)).toContain('VIP用户购买团购后会累计消费资产，普通用户不累计消费资产。');
  });

  it('uses the configured tier count instead of hard-coding three referrals', () => {
    expect(buildGroupBuyActivityRules(4)).toContain('最多推荐4人，每次推荐都会获得相应奖励。');
  });
});
