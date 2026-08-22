import { NotFoundException } from '@nestjs/common';
import { FollowService } from './follow.service';

describe('FollowService buyer company visibility', () => {
  it('omits suspended and platform companies from the following list query', async () => {
    const prisma = {
      follow: {
        findMany: jest.fn().mockResolvedValue([{
          followedId: 'company-1',
          followedType: 'COMPANY',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn() },
    };
    const service = new FollowService(prisma as any);

    await expect(service.listFollowing('buyer-1')).resolves.toEqual([]);
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['company-1'] },
        status: 'ACTIVE',
        isPlatform: false,
      },
      include: { profile: true },
    });
  });

  it('fails closed when a company becomes hidden between type resolution and detail read', async () => {
    const prisma = {
      company: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'company-1' })
          .mockResolvedValueOnce(null),
      },
      user: { findUnique: jest.fn() },
      follow: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new FollowService(prisma as any);

    await expect(service.getAuthorProfile('company-1', 'buyer-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.company.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'company-1', status: 'ACTIVE', isPlatform: false },
      include: { profile: true },
    });
  });

  it('does not resolve a hidden company as a buyer-visible author', async () => {
    const prisma = {
      company: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new FollowService(prisma as any);

    await expect(service.getAuthorProfile('company-hidden', 'buyer-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'company-hidden', status: 'ACTIVE', isPlatform: false },
    });
  });
});
