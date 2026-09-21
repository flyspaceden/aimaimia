declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { HOME_HERO_STATEMENT, HOME_MISSION_LINES } from '../homeHero';

describe('home hero copy', () => {
  it('uses the AI Life Circle statement instead of time-based greetings', () => {
    expect(HOME_HERO_STATEMENT).toBe('AI生活圈');
  });

  it('uses the two-line mission copy below the voice orb', () => {
    expect(HOME_MISSION_LINES).toEqual([
      '让消费者创造一个属于自己的世界',
      '为大家创造一个共同富裕的平台',
    ]);
  });
});
