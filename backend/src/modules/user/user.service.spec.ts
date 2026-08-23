jest.mock('../auth/auth.service', () => ({ AuthService: class {} }));

import { BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';

function makePrisma(profileOverrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        buyerNo: 'AIMM00000000000001',
        hasAgreedReturnPolicy: false,
        profile: {
          nickname: '林青禾',
          avatarUrl: 'preset://sprout',
          gender: 'UNKNOWN',
          birthday: null,
          level: '新芽会员',
          levelProgress: 0,
          growthPoints: 0,
          nextLevelPoints: 100,
          points: 0,
          city: '',
          interests: [],
          avatarFrameType: null,
          avatarFrameLabel: null,
          avatarFrameExpiresAt: null,
          ...profileOverrides,
        },
        authIdentities: [],
      }),
    },
    userProfile: {
      create: jest.fn(),
      upsert: jest.fn().mockResolvedValue({
        avatarUrl: profileOverrides.avatarUrl ?? 'preset://sprout',
      }),
      update: jest.fn(),
    },
    memberProfile: { findUnique: jest.fn() },
  } as any;
}

const config = {
  get: jest.fn((key: string, fallback?: string) => {
    if (key === 'NODE_ENV') return 'production';
    if (key === 'UPLOAD_BASE_URL') return 'https://api.ai-maimai.com/uploads';
    if (key === 'OSS_BUCKET') return 'aimai-assets';
    if (key === 'OSS_REGION') return 'oss-cn-hangzhou';
    return fallback;
  }),
} as any;

describe('UserService buyerNo contract', () => {
  it('returns buyerNo in GET /me profile shape', async () => {
    const prisma = makePrisma();
    const service = new UserService(prisma, {} as any, config);

    const profile = await service.getProfile('user-1');

    expect(profile).toMatchObject({
      id: 'user-1',
      buyerNo: 'AIMM00000000000001',
      name: '林青禾',
    });
  });

  it('clears an existing frame when the client selects the default frame', async () => {
    const prisma = makePrisma({ avatarFrameType: 'vip', avatarFrameLabel: 'VIP' });
    const service = new UserService(prisma, {} as any, config);

    await service.updateProfile('user-1', { avatarFrameId: 'default' });

    expect(prisma.userProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        avatarFrameType: null,
        avatarFrameLabel: null,
        avatarFrameExpiresAt: null,
      }),
    });
  });

  it('checks VIP membership before saving the VIP frame', async () => {
    const prisma = makePrisma();
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP' });
    const service = new UserService(prisma, {} as any, config);

    await service.updateProfile('user-1', { avatarFrameId: 'vip' });

    expect(prisma.memberProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { tier: true },
    });
    expect(prisma.userProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({ avatarFrameType: 'vip', avatarFrameLabel: 'VIP' }),
    });
  });

  it('allows only exact built-in avatars or platform-hosted avatar uploads', async () => {
    const prisma = makePrisma();
    const service = new UserService(prisma, {} as any, config);

    await expect(service.updateProfile('user-1', { avatar: 'preset://wheat' })).resolves.toBeDefined();
    await expect(service.updateProfile('user-1', {
      avatar: 'https://aimai-assets.oss-cn-hangzhou.aliyuncs.com/avatars/avatar.webp',
    })).resolves.toBeDefined();
    await expect(service.updateProfile('user-1', {
      avatar: 'https://tracker.example/avatars/pixel.webp',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateProfile('user-1', {
      avatar: 'preset://not-a-real-avatar',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
