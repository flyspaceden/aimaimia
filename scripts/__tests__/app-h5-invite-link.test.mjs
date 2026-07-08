import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildInviteH5Url,
  extractUnifiedInviteCodeFromURL,
} from '../../src/utils/inviteLink.ts';

const read = (path) => readFileSync(path, 'utf8');

test('app builds unified H5 invite URLs for normal and VIP codes', () => {
  assert.equal(buildInviteH5Url('s8k6m2q9'), 'https://app.ai-maimai.com/invite/S8K6M2Q9');
  assert.equal(buildInviteH5Url('vipcode1'), 'https://app.ai-maimai.com/invite/VIPCODE1');
});

test('app can parse the unified H5 invite URL without assuming code type', () => {
  assert.equal(
    extractUnifiedInviteCodeFromURL('https://app.ai-maimai.com/invite/s8k6m2q9'),
    'S8K6M2Q9',
  );
  assert.equal(
    extractUnifiedInviteCodeFromURL('https://app.xn--ckqa175y.com/invite/vipcode1'),
    'VIPCODE1',
  );
});

test('referral center QR and share copy use the H5 invite page instead of old download links', () => {
  const source = read('app/me/referral.tsx');

  assert.match(source, /buildInviteH5Url/);
  assert.match(source, /vipInviteUrl/);
  assert.match(source, /normalInviteUrl/);
  assert.doesNotMatch(source, /https:\/\/app\.ai-maimai\.com\/r\/\$\{referralCode\}/);
  assert.doesNotMatch(source, /shareProfile\?\.shareUrl/);
});

test('scanner accepts the unified H5 invite URL and resolves it as auto type', () => {
  const source = read('app/me/scanner.tsx');

  assert.ok(source.includes("com\\/invite\\/([A-Za-z0-9]{8})"));
  assert.match(source, /return \{ type: 'auto', code: unifiedUrlMatch\[2\]\.toUpperCase\(\) \}/);
});
