import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildInviteH5Url,
  extractUnifiedInviteCodeFromURL,
  shouldTryNormalShareAfterVipResult,
  shouldTryVipReferralAfterNormalResult,
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

test('app unified invite binding can fallback between normal and VIP code paths', () => {
  assert.equal(
    shouldTryVipReferralAfterNormalResult({
      ok: false,
      error: { displayMessage: '普通分享码无效' },
    }),
    true,
  );
  assert.equal(
    shouldTryNormalShareAfterVipResult({
      ok: false,
      error: { displayMessage: '推荐码无效' },
    }),
    true,
  );
  assert.equal(
    shouldTryVipReferralAfterNormalResult({
      ok: false,
      error: { retryable: true, displayMessage: '网络异常' },
    }),
    false,
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

test('app URL intake recognizes the unified H5 invite URL before legacy links', () => {
  const layout = read('app/_layout.tsx');

  assert.match(layout, /extractUnifiedInviteCodeFromURL/);
  assert.match(layout, /handleUnifiedInviteCode\(unifiedInviteCode\)/);
  assert.match(layout, /const normalShareCode = extractNormalShareCodeFromURL\(url\)/);
  assert.match(layout, /const code = extractReferralCodeFromURL\(url\)/);
});

test('referral center does not display the retired H5 login funnel', () => {
  const referral = read('app/me/referral.tsx');

  assert.doesNotMatch(referral, /InviteH5Repo/);
  assert.doesNotMatch(referral, /\['invite-h5-stats'\]/);
  assert.doesNotMatch(referral, /H5 邀请数据/);
  assert.doesNotMatch(referral, /inviteH5Stats/);
  assert.match(referral, /AppState\.addEventListener\('change'/);
});
