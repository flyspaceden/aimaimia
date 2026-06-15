jest.mock('../auth/auth.service', () => ({ AuthService: class {} }));

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
      upsert: jest.fn(),
      update: jest.fn(),
    },
  } as any;
}

describe('UserService buyerNo contract', () => {
  it('returns buyerNo in GET /me profile shape', async () => {
    const prisma = makePrisma();
    const service = new UserService(prisma, {} as any);

    const profile = await service.getProfile('user-1');

    expect(profile).toMatchObject({
      id: 'user-1',
      buyerNo: 'AIMM00000000000001',
      name: '林青禾',
    });
  });
});
