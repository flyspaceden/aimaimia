import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { CommunityRepo } from '../repo';
import { normalizeMiniProgramScanPath, parseScanTarget } from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock } }));

describe('miniapp community contracts', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); });

  it('uses the live captain buyer endpoints', async () => {
    getMock.mockResolvedValue({ ok: true, data: {} });
    postMock.mockResolvedValue({ ok: true, data: {} });
    await CommunityRepo.captainLanding(' sea001 ');
    await CommunityRepo.bindCaptain(' sea001 ');
    await CommunityRepo.captainLedgers(2, 10);
    expect(getMock).toHaveBeenNthCalledWith(1, '/captain/landing/SEA001');
    expect(postMock).toHaveBeenCalledWith('/captain/bind', { code: 'SEA001' });
    expect(getMock).toHaveBeenNthCalledWith(2, '/captain/me/ledgers', { page: 2, pageSize: 10 });
  });

  it('does not use the broken lowercase backend role filter for following', async () => {
    getMock.mockResolvedValue({ ok: true, data: [] });
    await CommunityRepo.following('active');
    expect(getMock).toHaveBeenCalledWith('/follows', { sort: 'active' });
  });

  it('submits the captain application to the existing buyer endpoint', async () => {
    postMock.mockResolvedValue({ ok: true, data: {} });
    const input = {
      realName: '林青', contact: 'wx-linqing', city: '杭州', communityScale: 'UNDER_50',
      expectedMonthlyGmv: 'UNDER_3000', resourceTypes: ['WECHAT_GROUP'], promotionPlan: '计划服务社区的家庭用户',
      seafoodExperience: 'BUYER', complianceAccepted: true,
    };
    await CommunityRepo.submitCaptainApplication(input);
    expect(postMock).toHaveBeenCalledWith('/captain/applications', input);
  });

  it('routes only known first-party QR formats', () => {
    expect(parseScanTarget('https://app.ai-maimai.com/invite/SABC1234')).toMatchObject({ kind: 'referral', inviteKind: 'normal', code: 'SABC1234' });
    expect(parseScanTarget('https://app.ai-maimai.com/r/VIPX1234')).toMatchObject({ kind: 'referral', inviteKind: 'vip' });
    expect(parseScanTarget('https://app.ai-maimai.com/gb/GB2ABCD999')).toMatchObject({ kind: 'group-buy', code: 'GB2ABCD999' });
    expect(parseScanTarget('https://app.爱买买.com/c/SEA001')).toMatchObject({ kind: 'captain', code: 'SEA001' });
    expect(parseScanTarget('https://evil.example/invite/SABC1234')).toBeNull();
    expect(parseScanTarget('https://app.ai-maimai.com/admin/users')).toBeNull();
    expect(parseScanTarget('ABCD')).toBeNull();
  });

  it('accepts only the signed scene relay from wx.scanCode path', () => {
    expect(normalizeMiniProgramScanPath('packages/community/scene/index?scene=abcdefghijklmnop'))
      .toBe('/packages/community/scene/index?scene=abcdefghijklmnop');
    expect(normalizeMiniProgramScanPath('/packages/community/scene/index?scene=ABC_def-123456789'))
      .toBe('/packages/community/scene/index?scene=ABC_def-123456789');
    expect(normalizeMiniProgramScanPath('packages/orders/order-list/index')).toBeNull();
    expect(normalizeMiniProgramScanPath('packages/community/scene/index?scene=short')).toBeNull();
    expect(normalizeMiniProgramScanPath('packages/community/scene/index?scene=abcdefghijklmnop&next=/admin')).toBeNull();
  });

  it('never places inviter identity into the scanner destination', () => {
    const target = parseScanTarget('SABC1234');
    expect(target?.url).toBe('/packages/referral/landing/index?code=SABC1234&kind=normal');
    expect(target?.url).not.toContain('name=');
  });

  it('keeps every protected community query in the auth revision generation', () => {
    const protectedPages = ['captain-center', 'captain-application', 'following', 'author-detail'];
    for (const page of protectedPages) {
      const source = readFileSync(new URL(`../${page}/index.tsx`, import.meta.url), 'utf8');
      expect(source).toContain('const authRevision = useAuthStore');
      for (const query of source.matchAll(/queryKey:\s*\[([^\]]+)\]/g)) expect(query[1]).toContain('authRevision');
    }
  });
});
