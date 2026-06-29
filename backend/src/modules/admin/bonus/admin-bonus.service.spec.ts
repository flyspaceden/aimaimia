import { AdminBonusService } from './admin-bonus.service';

describe('AdminBonusService reward income totals', () => {
  const ledgerRows = [
    {
      userId: 'buyer-1',
      entryType: 'RELEASE',
      amount: 51.87,
      status: 'AVAILABLE',
      account: { type: 'VIP_REWARD' },
    },
    {
      userId: 'buyer-1',
      entryType: 'VOID',
      amount: 50,
      status: 'VOIDED',
      account: { type: 'VIP_REWARD' },
    },
    {
      userId: 'buyer-1',
      entryType: 'WITHDRAW',
      amount: 50,
      status: 'WITHDRAWN',
      account: { type: 'VIP_REWARD' },
    },
  ];

  const matchesWhere = (row: (typeof ledgerRows)[number], where: any) => {
    if (where.userId && row.userId !== where.userId) return false;
    if (where.entryType && row.entryType !== where.entryType) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    const accountType = where.account?.type;
    if (accountType?.in && !accountType.in.includes(row.account.type)) return false;
    if (typeof accountType === 'string' && row.account.type !== accountType) return false;
    return true;
  };

  const makeService = () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'buyer-1',
          buyerNo: 'AIMM00000000000090',
          profile: { nickname: '刘义连', avatarUrl: null },
          authIdentities: [{ identifier: '13622383188' }],
        }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          tier: 'VIP',
          referralCode: 'VBHJ7PZT',
          inviterUserId: 'parent-1',
          vipPurchasedAt: new Date('2026-06-24T15:01:57.852Z'),
        }),
      },
      vipProgress: {
        findUnique: jest.fn().mockResolvedValue({ selfPurchaseCount: 0, exitedAt: null }),
      },
      rewardAccount: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'VIP_REWARD', balance: 1.87, frozen: 0 },
        ]),
      },
      vipTreeNode: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn(),
      },
      rewardLedger: {
        aggregate: jest.fn(async ({ where }: any) => ({
          _sum: {
            amount: ledgerRows
              .filter((row) => matchesWhere(row, where))
              .reduce((sum, row) => sum + row.amount, 0),
          },
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      withdrawRequest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AdminBonusService(
      prisma,
      { send: jest.fn() } as any,
      { get: jest.fn() } as any,
      { getConfig: jest.fn() } as any,
    );
    return { prisma, service };
  };

  it('counts released reward income without counting withdrawal ledgers again', async () => {
    const { prisma, service } = makeService();

    const detail = await service.getMemberDetail('buyer-1');

    expect(detail.wallet.totalEarned).toBe(51.87);
    expect(prisma.rewardLedger.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'buyer-1',
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      }),
      _sum: { amount: true },
    });
  });
});
