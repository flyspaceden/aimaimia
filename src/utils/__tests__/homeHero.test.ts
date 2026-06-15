declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { HOME_HERO_STATEMENT, HOME_MISSION_LINES } from '../homeHero';

describe('home hero copy', () => {
  it('uses the consumer productivity statement instead of time-based greetings', () => {
    expect(HOME_HERO_STATEMENT).toBe('消费者就是生产力\n是社会价值的创造者');
  });

  it('uses the two-line mission copy below the voice orb', () => {
    expect(HOME_MISSION_LINES).toEqual([
      '让消费者创造一个属于自己的世界',
      '为全世界创造一个共生的未来',
    ]);
  });
});
