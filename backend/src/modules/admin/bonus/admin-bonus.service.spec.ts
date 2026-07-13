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
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberProfile: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          tier: 'VIP',
          referralCode: 'VBHJ7PZT',
          inviterUserId: 'parent-1',
          vipPurchasedAt: new Date('2026-06-24T15:01:57.852Z'),
          normalTreeNodeId: null,
        }),
      },
      vipProgress: {
        findUnique: jest.fn().mockResolvedValue({ selfPurchaseCount: 0, exitedAt: null }),
      },
      rewardAccount: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'VIP_REWARD', balance: 1.87, frozen: 0 },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vipTreeNode: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'withdraw-1',
          userId: 'buyer-1',
          status: 'REQUESTED',
          amount: 100,
          accountType: 'VIP_REWARD',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(prisma)),
    };
    const notificationService = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminBonusService(
      prisma,
      notificationService as any,
      { get: jest.fn() } as any,
      { getConfig: jest.fn().mockResolvedValue({ vipMaxLayers: 6 }) } as any,
      { withRuleConfigUpdates: jest.fn() } as any,
    );
    return { prisma, notificationService, service };
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

  it('returns normal tree availability so the admin UI does not link users without a node', async () => {
    const { prisma, service } = makeService();

    await expect(service.getMemberDetail('buyer-1')).resolves.toMatchObject({
      normalTree: { hasNode: false },
    });

    prisma.memberProfile.findUnique.mockResolvedValue({
      tier: 'VIP',
      referralCode: 'VBHJ7PZT',
      inviterUserId: 'parent-1',
      vipPurchasedAt: new Date('2026-06-24T15:01:57.852Z'),
      normalTreeNodeId: 'normal-node-1',
    });

    await expect(service.getMemberDetail('buyer-1')).resolves.toMatchObject({
      normalTree: { hasNode: true },
    });
  });

  it('emits withdraw approved notification inside the review transaction', async () => {
    const { prisma, notificationService, service } = makeService();

    await service.approveWithdraw('withdraw-1', 'admin-1');

    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'withdraw.approved',
        aggregateType: 'withdrawRequest',
        aggregateId: 'withdraw-1',
        idempotencyKey: 'withdraw:withdraw-1:approved',
        actor: { kind: 'admin', id: 'admin-1' },
        payload: {
          withdrawId: 'withdraw-1',
          userId: 'buyer-1',
          amount: 100,
        },
      }),
      prisma,
    );
  });

  it('emits withdraw rejected notification without leaking the reject reason', async () => {
    const { prisma, notificationService, service } = makeService();

    await service.rejectWithdraw('withdraw-1', 'admin-1', '包含敏感备注 13800000000');

    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'withdraw.rejected',
        idempotencyKey: 'withdraw:withdraw-1:rejected',
        payload: {
          withdrawId: 'withdraw-1',
          userId: 'buyer-1',
          amount: 100,
        },
      }),
      prisma,
    );
    expect(JSON.stringify(notificationService.emit.mock.calls[0][0])).not.toContain('13800000000');
  });

  it('orders VIP members by self purchase count when table sorting requests it', async () => {
    const { prisma, service } = makeService();

    await service.findMembers(1, 20, 'VIP', undefined, 'selfPurchaseCount', 'ascend');

    expect(prisma.memberProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { user: { vipProgress: { selfPurchaseCount: 'asc' } } },
        { vipPurchasedAt: 'desc' },
        { id: 'asc' },
      ],
    }));
  });
});
