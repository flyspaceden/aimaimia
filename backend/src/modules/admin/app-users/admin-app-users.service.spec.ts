import { AdminAppUsersService } from './admin-app-users.service';

describe('AdminAppUsersService buyer public ids', () => {
  const makeService = () => {
    const prisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    return {
      prisma,
      service: new AdminAppUsersService(prisma as any),
    };
  };

  const userRow = {
    id: 'user-internal-1',
    buyerNo: 'AIMM00000000000001',
    status: 'ACTIVE',
    createdAt: new Date('2026-06-15T01:00:00.000Z'),
    updatedAt: new Date('2026-06-15T02:00:00.000Z'),
    profile: {
      nickname: '测试买家',
      avatarUrl: 'https://example.com/avatar.png',
      level: '新芽会员',
      growthPoints: 3,
      points: 5,
      gender: null,
      birthday: null,
      city: null,
    },
    authIdentities: [
      { provider: 'PHONE', identifier: '13800138000', verified: true },
    ],
    memberProfile: { tier: 'NORMAL' },
    _count: { orders: 2, addresses: 1, followsGiven: 0 },
  };

  it('returns buyerNo in app user list rows', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([userRow]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.findAll();

    expect(result.items[0]).toMatchObject({
      id: 'user-internal-1',
      buyerNo: 'AIMM00000000000001',
      nickname: '测试买家',
    });
  });

  it('returns buyerNo in app user detail', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(userRow);

    const result = await service.findById('user-internal-1');

    expect(result).toMatchObject({
      id: 'user-internal-1',
      buyerNo: 'AIMM00000000000001',
      nickname: '测试买家',
    });
  });

  it('searches app users by buyerNo keyword', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findAll(1, 20, undefined, 'AIMM00000000000001');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { buyerNo: 'AIMM00000000000001' },
        ]),
      }),
    }));
  });

  it('resolves AIMM detail input to the internal user id', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-internal-1' })
      .mockResolvedValueOnce(userRow);

    const result = await service.findById('AIMM00000000000001');

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { buyerNo: 'AIMM00000000000001' },
      select: { id: true },
    });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'user-internal-1' },
    }));
    expect(result.id).toBe('user-internal-1');
  });
});
