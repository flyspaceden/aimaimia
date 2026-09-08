import { PLATFORM_USER_ID } from './constants';
import { NormalPlatformSplitService } from './normal-platform-split.service';

describe('NormalPlatformSplitService direct referral pool handoff', () => {
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

  it('does not create temporary normal direct referral holding after direct commission is handled at order paid', async () => {
    const industryFund = { accrueInTransaction: jest.fn().mockResolvedValue(undefined) };
    const service = new NormalPlatformSplitService(industryFund as any);
    const tx = makeTx();
    const normalRewardPoolHandledUpstream = 16;
    const directReferralPoolHandledAtOrderPaid = 1;

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
      ]),
    );
    expect(ledgerRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            scheme: 'NORMAL_DIRECT_REFERRAL_HOLDING',
          }),
        }),
      ]),
    );
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: `${PLATFORM_USER_ID}-PLATFORM_PROFIT` },
      data: { balance: { increment: 49 } },
    });
    const platformSplitTotal = ledgerRows.reduce((sum, row) => sum + row.amount, 0);
    expect(platformSplitTotal).toBe(67);
    expect(industryFund.accrueInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: 16, orderId: 'order-1' }));
    expect(ledgerRows.some((row) => row.meta.accountType === 'INDUSTRY_FUND')).toBe(false);
    expect(
      normalRewardPoolHandledUpstream +
      directReferralPoolHandledAtOrderPaid +
      platformSplitTotal + 16,
    ).toBe(100);
  });
});
