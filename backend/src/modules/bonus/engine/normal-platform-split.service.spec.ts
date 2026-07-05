import { PLATFORM_USER_ID } from './constants';
import { NormalPlatformSplitService } from './normal-platform-split.service';

describe('NormalPlatformSplitService direct referral holding', () => {
  const makeTx = () => {
    const tx = {
      rewardAccount: {
        findUnique: jest.fn(({ where }) => {
          const { userId, type } = where.userId_type;
          return Promise.resolve({ id: `${userId}-${type}`, userId, type });
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      rewardLedger: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return tx;
  };

  it('credits default normal direct referral holding separately so 100 profit reconciles', async () => {
    const service = new NormalPlatformSplitService();
    const tx = makeTx();
    const normalRewardPoolHandledUpstream = 16;

    await service.split(
      tx as any,
      'allocation-1',
      'order-1',
      {
        platformProfit: 49,
        directReferralPool: 1,
        industryFund: 16,
        charityFund: 8,
        techFund: 8,
        reserveFund: 2,
      } as any,
      {},
    );

    const ledgerRows = tx.rewardLedger.create.mock.calls.map(([arg]) => arg.data);

    expect(ledgerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: `${PLATFORM_USER_ID}-PLATFORM_PROFIT`,
          userId: PLATFORM_USER_ID,
          entryType: 'RELEASE',
          amount: 49,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: 'order-1',
          meta: expect.objectContaining({
            scheme: 'NORMAL_PLATFORM_SPLIT',
            accountType: 'PLATFORM_PROFIT',
            sourceOrderId: 'order-1',
          }),
        }),
        expect.objectContaining({
          accountId: `${PLATFORM_USER_ID}-PLATFORM_PROFIT`,
          userId: PLATFORM_USER_ID,
          entryType: 'RELEASE',
          amount: 1,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: 'order-1',
          meta: expect.objectContaining({
            scheme: 'NORMAL_DIRECT_REFERRAL_HOLDING',
            originalScheme: 'NORMAL_DIRECT_REFERRAL',
            accountType: 'PLATFORM_PROFIT',
            directReferralPool: 1,
            sourceOrderId: 'order-1',
            holdingReason: 'DIRECT_REFERRAL_LEDGER_PENDING_TASK_6',
          }),
        }),
      ]),
    );
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: `${PLATFORM_USER_ID}-PLATFORM_PROFIT` },
      data: { balance: { increment: 49 } },
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: `${PLATFORM_USER_ID}-PLATFORM_PROFIT` },
      data: { balance: { increment: 1 } },
    });
    const platformSplitTotal = ledgerRows.reduce((sum, row) => sum + row.amount, 0);
    expect(platformSplitTotal).toBe(84);
    expect(normalRewardPoolHandledUpstream + platformSplitTotal).toBe(100);
  });
});
