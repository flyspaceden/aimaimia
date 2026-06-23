import { buildGroupBuyActivityRules } from '../groupBuyRules';

declare const describe: any;
declare const it: any;
declare const expect: any;

describe('group-buy activity rules', () => {
  it('uses the configured tier count instead of hard-coding three referrals', () => {
    expect(buildGroupBuyActivityRules(4)).toContain('最多推荐4人，每次推荐都会获得相应奖励。');
  });
});
