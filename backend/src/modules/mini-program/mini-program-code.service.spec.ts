import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WechatMiniProgramApiError } from '../wechat-mini-program-platform/wechat-mini-program-api.service';
import { MiniProgramCodeService } from './mini-program-code.service';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function harness() {
  const prisma: any = {
    memberProfile: { findUnique: jest.fn() },
    normalShareProfile: { findUnique: jest.fn() },
    captainProfile: { findFirst: jest.fn() },
    groupBuyInstance: { findFirst: jest.fn() },
    miniProgramScene: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const config = { get: jest.fn((_key: string, fallback?: string) => fallback) };
  const wechat = {
    isAvailable: jest.fn().mockReturnValue(true),
    postBuffer: jest.fn().mockResolvedValue(PNG),
  };
  return {
    prisma,
    wechat,
    service: new MiniProgramCodeService(prisma, config as any, wechat as any),
  };
}

describe('MiniProgramCodeService', () => {
  it('derives a VIP referral target exclusively from the authenticated owner', async () => {
    const { service, prisma, wechat } = harness();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP', referralCode: 'VIPA1234' });
    prisma.miniProgramScene.findFirst.mockResolvedValue(null);
    prisma.miniProgramScene.create.mockResolvedValue({
      id: 'scene-1', token: 'abcdefghijklmnopqrstuv', expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    prisma.miniProgramScene.update.mockResolvedValue({});

    await expect(service.createCode('user-1', 'REFERRAL')).resolves.toMatchObject({
      scene: 'abcdefghijklmnopqrstuv', kind: 'REFERRAL', mimeType: 'image/png', imageBase64: PNG.toString('base64'),
    });
    expect(prisma.memberProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    expect(prisma.miniProgramScene.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 'user-1', kind: 'REFERRAL',
      targetPath: '/packages/referral/landing/index?code=VIPA1234&kind=vip',
    }) });
    expect(wechat.postBuffer).toHaveBeenCalledWith('/wxa/getwxacodeunlimit', expect.objectContaining({
      scene: 'abcdefghijklmnopqrstuv', page: 'packages/community/scene/index', check_path: true,
    }));
  });

  it('refuses a group-buy code unless the current user owns an active sharing instance', async () => {
    const { service, prisma, wechat } = harness();
    prisma.groupBuyInstance.findFirst.mockResolvedValue(null);
    await expect(service.createCode('user-2', 'GROUP_BUY')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.groupBuyInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-2', status: 'SHARING' },
    }));
    expect(wechat.postBuffer).not.toHaveBeenCalled();
  });

  it('accepts the JPEG small-program code currently returned by WeChat', async () => {
    const { service, prisma, wechat } = harness();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP', referralCode: 'VIPA1234' });
    prisma.miniProgramScene.findFirst.mockResolvedValue({
      id: 'scene-jpeg', token: 'abcdefghijklmnopqrstuv', expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    prisma.miniProgramScene.update.mockResolvedValue({});
    wechat.postBuffer.mockResolvedValue(JPEG);

    await expect(service.createCode('user-jpeg', 'REFERRAL')).resolves.toMatchObject({
      mimeType: 'image/jpeg', imageBase64: JPEG.toString('base64'),
    });
  });

  it('falls back from an unpublished release page to the trial version only for WeChat 41030', async () => {
    const { service, prisma, wechat } = harness();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP', referralCode: 'VIPA1234' });
    prisma.miniProgramScene.findFirst.mockResolvedValue({
      id: 'scene-trial', token: 'abcdefghijklmnopqrstuv', expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    prisma.miniProgramScene.update.mockResolvedValue({});
    wechat.postBuffer
      .mockRejectedValueOnce(new WechatMiniProgramApiError(41030, 'invalid page'))
      .mockResolvedValueOnce(JPEG);

    await expect(service.createCode('user-trial', 'REFERRAL')).resolves.toMatchObject({
      mimeType: 'image/jpeg',
    });
    expect(wechat.postBuffer).toHaveBeenNthCalledWith(1, '/wxa/getwxacodeunlimit', expect.objectContaining({
      env_version: 'release', check_path: true,
    }));
    expect(wechat.postBuffer).toHaveBeenNthCalledWith(2, '/wxa/getwxacodeunlimit', expect.objectContaining({
      env_version: 'trial', check_path: false,
    }));
  });

  it('does not downgrade to trial for unrelated WeChat platform errors', async () => {
    const { service, prisma, wechat } = harness();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP', referralCode: 'VIPA1234' });
    prisma.miniProgramScene.findFirst.mockResolvedValue({
      id: 'scene-error', token: 'abcdefghijklmnopqrstuv', expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    wechat.postBuffer.mockRejectedValue(new WechatMiniProgramApiError(40001, 'invalid token'));

    await expect(service.createCode('user-error', 'REFERRAL')).rejects.toMatchObject({ status: 503 });
    expect(wechat.postBuffer).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported captain code before storing a scene or calling WeChat', async () => {
    const { service, prisma, wechat } = harness();
    prisma.captainProfile.findFirst.mockResolvedValue({ captainCode: '团长-code' });

    await expect(service.createCode('captain-1', 'CAPTAIN')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.miniProgramScene.create).not.toHaveBeenCalled();
    expect(wechat.postBuffer).not.toHaveBeenCalled();
  });

  it('reuses only a matching unexpired owner scene and never accepts a client target', async () => {
    const { service, prisma } = harness();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL', referralCode: null });
    prisma.normalShareProfile.findUnique.mockResolvedValue({ code: 'NORM1234', status: 'ACTIVE' });
    prisma.miniProgramScene.findFirst.mockResolvedValue({
      id: 'scene-existing', token: 'zyxwvutsrqponmlkjihgfe', expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    prisma.miniProgramScene.update.mockResolvedValue({});

    await service.createCode('user-3', 'REFERRAL');
    expect(prisma.miniProgramScene.create).not.toHaveBeenCalled();
    expect(prisma.miniProgramScene.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'user-3', kind: 'REFERRAL' }),
    }));
  });

  it('rejects expired scenes and stored destinations outside the local allowlist', async () => {
    const { service, prisma } = harness();
    prisma.miniProgramScene.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ kind: 'REFERRAL', targetPath: '/admin/users', expiresAt: new Date('2027-01-01') });
    await expect(service.resolveScene('abcdefghijklmnopqrstuv')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolveScene('zyxwvutsrqponmlkjihgfe')).rejects.toBeInstanceOf(NotFoundException);
  });
});
