import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralRepo } from '../repo';
import {
  buildMiniappInvitePath,
  normalizeInviteCode,
  normalReferralStatusLabel,
  preferredInviteKind,
  referralCenterProfileError,
  vipReferralStatusLabel,
} from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock } }));

describe('miniapp referral contracts', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); });

  it('accepts only the current eight-character invite format', () => {
    expect(normalizeInviteCode(' sabc1234 ')).toBe('SABC1234');
    expect(normalizeInviteCode('../admin')).toBeNull();
    expect(normalizeInviteCode('short')).toBeNull();
  });

  it('keeps code and kind inside a local miniapp path', () => {
    expect(buildMiniappInvitePath('SABC1234', 'normal')).toBe('/packages/referral/landing/index?code=SABC1234&kind=normal');
  });

  it('ignores a stale normal-profile error after the account is confirmed as VIP', () => {
    const staleNormalError = { code: 'BAD_REQUEST', message: 'VIP 用户不使用普通分享码', displayMessage: 'VIP 用户不使用普通分享码' };
    expect(referralCenterProfileError({
      ok: true,
      data: { tier: 'VIP', referralCode: 'VIPX1234', inviterUserId: null, inviteeVipCount: 0 },
    }, { ok: false, error: staleNormalError })).toBeNull();

    expect(referralCenterProfileError({
      ok: true,
      data: { tier: 'NORMAL', referralCode: null, inviterUserId: null, inviteeVipCount: 0 },
    }, { ok: false, error: staleNormalError })).toEqual(staleNormalError);
  });

  it('presents the invite code and mini-program code as one credential card', () => {
    const centerSource = readFileSync(new URL('../center/index.tsx', import.meta.url), 'utf8');
    const panelSource = readFileSync(new URL('../../../components/mini-program-code/index.tsx', import.meta.url), 'utf8');
    expect(centerSource).toContain("className='referral-code-card__credential'");
    expect(centerSource).toContain("variant='embedded'");
    expect(centerSource.indexOf("variant='embedded'")).toBeLessThan(centerSource.indexOf("referral-code-card__actions"));
    expect(panelSource).toContain("variant = 'standalone'");
    expect(panelSource).toContain("variant === 'embedded'");
  });

  it('disables persistent webpack cache outside development and verifies compiled embedded output', () => {
    const configSource = readFileSync(new URL('../../../../config/index.ts', import.meta.url), 'utf8');
    const artifactVerifier = readFileSync(new URL('../../../../scripts/verify-weapp-artifact.mjs', import.meta.url), 'utf8');
    expect(configSource).toContain("cache: { enable: appEnv === 'development' }");
    expect(artifactVerifier).toContain('/variant:\"embedded\"/');
    expect(artifactVerifier).toContain('/mini-code-panel--embedded/');
  });

  it('uses the separate normal and VIP binding endpoints', async () => {
    postMock.mockResolvedValue({ ok: true, data: {} });
    await ReferralRepo.bind('normal', 'SABC1234');
    await ReferralRepo.bind('vip', 'VIPX1234');
    expect(postMock).toHaveBeenNthCalledWith(1, '/normal-share/bind', { code: 'SABC1234', source: 'MINI_PROGRAM' });
    expect(postMock).toHaveBeenNthCalledWith(2, '/bonus/referral', { code: 'VIPX1234' });
  });

  it('infers only when old share links omit the explicit kind', () => {
    expect(preferredInviteKind(undefined, 'SABC1234')).toBe('normal');
    expect(preferredInviteKind(undefined, 'VIPX1234')).toBe('vip');
    expect(preferredInviteKind('vip', 'SABC1234')).toBe('vip');
  });

  it('treats link kind as a hint and falls back only for an invalid code type', async () => {
    postMock
      .mockResolvedValueOnce({ ok: false, error: { code: 'BAD_REQUEST', message: '普通分享码无效', retryable: false } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'bound' } });
    await expect(ReferralRepo.bindAuto('SABC1234', 'normal')).resolves.toEqual({
      ok: true,
      data: { id: 'bound', resolvedType: 'vip' },
    });
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('does not try another relationship type after a business-rule rejection', async () => {
    postMock.mockResolvedValue({ ok: false, error: { code: 'BAD_REQUEST', message: '已绑定推荐关系，不能更换', retryable: false } });
    await ReferralRepo.bindAuto('SABC1234', 'normal');
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('shows exact Chinese reward and relationship states instead of collapsing them', () => {
    expect(normalReferralStatusLabel({ id: '1', inviteeUserId: 'u1', rewardStatus: 'FIRST_ORDER_PENDING', relationStatus: 'ACTIVE', boundAt: '2026-01-01' })).toBe('待完成首单');
    expect(normalReferralStatusLabel({ id: '2', inviteeUserId: 'u2', rewardStatus: 'REVERSED', relationStatus: 'ADMIN_VOIDED', boundAt: '2026-01-01' })).toBe('奖励已冲正 · 关系已作废');
    expect(vipReferralStatusLabel({ id: '3', buyerNo: null, nickname: null, tier: 'NORMAL', boundAt: '2026-01-01' })).toBe('已绑定，待成为 VIP');
  });
});
