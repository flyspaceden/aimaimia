import { buildGroupBuyActivityRules } from '../groupBuyRules';

declare const describe: any;
declare const it: any;
declare const expect: any;

describe('group-buy activity rules', () => {
  it('uses the configured tier count instead of hard-coding three referrals', () => {
    expect(buildGroupBuyActivityRules(4)).toContain('最多推荐4人，每次推荐都会获得相应奖励。');
  });

  it('describes termination as invalidating only unconfirmed or unreleased returns', () => {
    expect(buildGroupBuyActivityRules(3)).toContain('可以随时终止团购，终止后未确认或未释放的返还将失效。');
    expect(buildGroupBuyActivityRules(3)).not.toContain('终止后未推荐的奖励即刻失效。');
  });
});
