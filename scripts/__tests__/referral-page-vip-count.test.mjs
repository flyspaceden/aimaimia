import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = () => readFileSync('app/me/referral.tsx', 'utf8');

test('referral page shows direct invited VIP count from bonus member profile', () => {
  const referralPage = source();

  assert.match(referralPage, /const inviteeVipCount = member\?\.inviteeVipCount \?\? 0;/);
  assert.match(referralPage, /已推荐 \{inviteeVipCount\} 位 VIP/);
});

test('referral page removes AI recommend badge beside exclusive code title', () => {
  const referralPage = source();

  assert.doesNotMatch(referralPage, /AiBadge/);
});
