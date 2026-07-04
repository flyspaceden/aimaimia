import { BadRequestException } from '@nestjs/common';
import { NormalShareDeferredService } from './normal-share-deferred.service';

const activeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'profile-1',
  userId: 'inviter-1',
  code: 'SABCDEFG',
  status: 'ACTIVE',
  user: {
    status: 'ACTIVE',
    deletionExecutedAt: null,
  },
  ...overrides,
});

describe('NormalShareDeferredService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('rejects invalid or disabled normal share codes', async () => {
    const prismaMock: any = {
      normalShareProfile: {
        findUnique: jest.fn().mockResolvedValue(activeProfile({ status: 'DISABLED' })),
      },
      normalShareDeferredLink: {
        create: jest.fn(),
      },
    };
    const service = new NormalShareDeferredService(prismaMock);

    await expect(
      service.create({
        code: 'SABCDEFG',
        userAgent: 'Mozilla/5.0 iPhone',
        screenWidth: 390,
        screenHeight: 844,
        language: 'zh-CN',
      }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.normalShareDeferredLink.create).not.toHaveBeenCalled();
  });

  it('stores a normal-share deferred record without touching VIP deferred links', async () => {
    const prismaMock: any = {
      normalShareProfile: {
        findUnique: jest.fn().mockResolvedValue(activeProfile()),
      },
      normalShareDeferredLink: {
        create: jest.fn().mockResolvedValue({ cookieId: 'nsdl_abc' }),
      },
      deferredDeepLink: {
        create: jest.fn(),
      },
    };
    const service = new NormalShareDeferredService(prismaMock);

    await expect(
      service.create({
        code: 'sabcdefg',
        userAgent: 'Mozilla/5.0 iPhone',
        screenWidth: 390,
        screenHeight: 844,
        language: 'zh-CN',
      }, '127.0.0.1'),
    ).resolves.toEqual({ cookieId: 'nsdl_abc' });

    expect(prismaMock.normalShareDeferredLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'SABCDEFG',
        ipAddress: '127.0.0.1',
        screenInfo: '390x844',
        language: 'zh-CN',
        matched: false,
        expiresAt: new Date('2026-07-05T00:00:00.000Z'),
      }),
    });
    expect(prismaMock.deferredDeepLink.create).not.toHaveBeenCalled();
  });

  it('resolves and consumes a pending normal-share deferred record', async () => {
    const found = {
      id: 'nsdl-1',
      cookieId: 'nsdl_abc',
      code: 'SABCDEFG',
      matched: false,
      expiresAt: new Date('2026-07-04T00:00:00.000Z'),
    };
    const tx: any = {
      normalShareDeferredLink: {
        findUnique: jest.fn().mockResolvedValue(found),
        update: jest.fn(({ data }: any) => ({ ...found, ...data })),
      },
      normalShareProfile: {
        findUnique: jest.fn().mockResolvedValue(activeProfile()),
      },
      deferredDeepLink: {
        update: jest.fn(),
      },
    };
    const prismaMock: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new NormalShareDeferredService(prismaMock);

    await expect(service.resolve('nsdl_abc')).resolves.toEqual({ code: 'SABCDEFG' });
    expect(tx.normalShareDeferredLink.update).toHaveBeenCalledWith({
      where: { id: 'nsdl-1' },
      data: { matched: true },
    });
    expect(tx.deferredDeepLink.update).not.toHaveBeenCalled();
  });
});
