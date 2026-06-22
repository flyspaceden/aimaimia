declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { GROUP_BUY_SHARE_URL } from '../../components/group-buy/constants';

describe('group buy share link', () => {
  it('uses the dedicated group-buy landing route', () => {
    expect(GROUP_BUY_SHARE_URL).toBe('https://app.ai-maimai.com/gb');
  });
});
