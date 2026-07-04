import { CheckInService } from './check-in.service';

describe('CheckInService growth integration', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('triggers growth check-in event while preserving coupon trigger', async () => {
    const tx: any = {
      checkIn: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'check-in-1' }),
      },
      userProfile: {
        upsert: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      },
    };
    const prisma: any = {
      checkIn: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const couponEngine = { handleTrigger: jest.fn().mockResolvedValue(undefined) };
    const growthEvents = { receive: jest.fn().mockResolvedValue({ granted: true }) };
    const service = new CheckInService(prisma, couponEngine as any, growthEvents as any);

    await service.checkIn('user-1');

    expect(couponEngine.handleTrigger).toHaveBeenCalledWith('user-1', 'CHECK_IN', {
      consecutiveDays: 1,
    });
    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'CHECK_IN:user-1:2026-07-03',
      refType: 'CHECK_IN',
      refId: 'user-1:2026-07-03',
      meta: { consecutiveDays: 1 },
    }));
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
  });
});
