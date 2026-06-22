import { calculateGroupBuyProgressTargetCount } from '../groupBuyProgress';

declare const describe: any;
declare const it: any;
declare const expect: any;

describe('group-buy progress target count', () => {
  it('uses the exact configured tier count instead of forcing three slots', () => {
    expect(calculateGroupBuyProgressTargetCount([{ sequence: 1 }])).toBe(1);
    expect(calculateGroupBuyProgressTargetCount([
      { sequence: 1 },
      { sequence: 2 },
    ])).toBe(2);
    expect(calculateGroupBuyProgressTargetCount([
      { sequence: 1 },
      { sequence: 2 },
      { sequence: 3 },
      { sequence: 4 },
    ])).toBe(4);
  });

  it('keeps one visible slot for malformed empty tier data', () => {
    expect(calculateGroupBuyProgressTargetCount([])).toBe(1);
  });
});
