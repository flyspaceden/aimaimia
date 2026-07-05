import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('home search and drawn lottery hint appear below mission copy', () => {
  const home = read('app/(tabs)/home.tsx');
  const missionSecondLine = home.indexOf('{HOME_MISSION_LINES[1]}');
  const searchBar = home.indexOf('styles.searchBar');
  const drawnHint = home.indexOf('styles.drawnHint');

  assert.notEqual(missionSecondLine, -1);
  assert.notEqual(searchBar, -1);
  assert.notEqual(drawnHint, -1);
  assert.ok(missionSecondLine < searchBar);
  assert.ok(searchBar < drawnHint);
});

test('home places the user identity card in the former VIP carousel slot', () => {
  const home = read('app/(tabs)/home.tsx');
  const greeting = home.indexOf('styles.greetingRow');
  const identityCard = home.indexOf('<MeIdentityCard');
  const vipReferralStrip = home.indexOf('vipReferralPrompt ?');
  const groupBuyEntry = home.indexOf('styles.groupBuyEntry');

  assert.ok(greeting > 0, 'home greeting should exist');
  assert.ok(identityCard > greeting, 'identity card should render after the home greeting');
  assert.ok(vipReferralStrip > identityCard, 'VIP referral strip should remain below the identity card');
  assert.ok(groupBuyEntry > vipReferralStrip, 'group buy entry should remain below the VIP referral strip');
});
