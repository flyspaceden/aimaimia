import { Prisma } from '@prisma/client';
import { FreezeExpireService } from './freeze-expire.service';

describe('FreezeExpireService notifications', () => {
  it('emits reward.expired inside the ledger Serializable transaction', async () => {
    const tx: any = {
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-1' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any, options: any) => {
        await callback(tx);
        return options;
      }),
    };
    const notificationService = {
      send: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FreezeExpireService(
      prisma,
      { getConfig: jest.fn() } as any,
      notificationService as any,
    );

    await (service as any).expireSingleLedger({
      id: 'ledger-expired-1',
      userId: 'buyer-1',
      accountId: 'account-1',
      amount: 12.34,
      meta: { scheme: 'VIP_UPSTREAM' },
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'reward.expired',
      aggregateType: 'rewardLedger',
      aggregateId: 'ledger-expired-1',
      idempotencyKey: 'reward:ledger-expired-1:expired',
      actor: { kind: 'system' },
      payload: {
        ledgerId: 'ledger-expired-1',
        userId: 'buyer-1',
        amount: 12.34,
      },
    }, tx);
  });
});
