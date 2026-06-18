import { BonusService } from './bonus.service';

describe('BonusService digital asset V2 integration', () => {
  const makeTxRunner = (prismaMock: any) => async (callback: any) => callback(prismaMock);

  function makeService(options?: {
    existingPurchase?: any;
    inviterUserId?: string | null;
    digitalAssetError?: Error;
  }) {
    const sequence: string[] = [];
    const vipPurchaseUpdate = jest.fn(({ data }: any) => {
      if (data?.activationStatus === 'SUCCESS') sequence.push('success');
      return { id: 'vp-1', ...data };
    });
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(options?.existingPurchase ?? null)
          .mockResolvedValueOnce({
            id: 'vp-1',
            userId: 'buyer-1',
            orderId: 'order-1',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0,
            amount: 399,
            packageId: 'pkg-399',
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-1',
          activationStatus: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'vp-1',
          activationStatus: options?.existingPurchase?.activationStatus === 'FAILED' ? 'RETRYING' : 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'buyer-1',
          tier: 'NORMAL',
          inviterUserId: options?.inviterUserId ?? 'inviter-1',
          referralCode: null,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'buyer-1',
          tier: 'VIP',
          inviterUserId: options?.inviterUserId ?? 'inviter-1',
          referralCode: 'VIP001',
        }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    prismaMock.vipPurchase.update = vipPurchaseUpdate;

    const digitalAssetService = {
      grantVipActivationAssets: jest.fn().mockImplementation(async () => {
        sequence.push('grant');
        if (options?.digitalAssetError) throw options.digitalAssetError;
      }),
    };

    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
      digitalAssetService as any,
    );
    jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);

    return { service, prismaMock, digitalAssetService, vipPurchaseUpdate, sequence };
  }

  it('grants self seed and historical credit assets before activation becomes SUCCESS', async () => {
    const { service, digitalAssetService, vipPurchaseUpdate, sequence } = makeService();

    await service.activateVipAfterPayment(
      'buyer-1',
      'order-1',
      'gift-1',
      399,
      { title: 'VIP 礼包' },
      'pkg-399',
      0,
    );

    expect(digitalAssetService.grantVipActivationAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'buyer-1',
        vipPurchaseId: 'vp-1',
        packageId: 'pkg-399',
        vipAmount: 399,
      }),
    );
    expect(sequence).toEqual(['grant', 'success']);
    expect(vipPurchaseUpdate).toHaveBeenCalledWith({
      where: { id: 'vp-1' },
      data: { activationStatus: 'SUCCESS', activationError: null },
    });
  });

  it('passes the direct inviter user id for referral seed asset grants', async () => {
    const { service, digitalAssetService } = makeService({ inviterUserId: 'direct-inviter' });

    await service.activateVipAfterPayment(
      'buyer-1',
      'order-1',
      'gift-1',
      699,
      { title: 'VIP 礼包' },
      'pkg-699',
      0,
    );

    expect(digitalAssetService.grantVipActivationAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inviterUserId: 'direct-inviter',
      }),
    );
  });

  it('retry path still performs at most one digital asset grant call for the activation attempt', async () => {
    const { service, digitalAssetService } = makeService({
      existingPurchase: {
        id: 'vp-1',
        userId: 'buyer-1',
        orderId: 'order-1',
        activationStatus: 'FAILED',
        referralBonusRate: 0,
        amount: 399,
        packageId: 'pkg-399',
      },
    });

    await service.activateVipAfterPayment(
      'buyer-1',
      'order-1',
      'gift-1',
      399,
      { title: 'VIP 礼包' },
      'pkg-399',
      0,
    );

    expect(digitalAssetService.grantVipActivationAssets).toHaveBeenCalledTimes(1);
  });

  it('marks activation FAILED when digital asset grant throws', async () => {
    const { service, prismaMock } = makeService({
      digitalAssetError: new Error('digital asset down'),
    });

    await expect(
      service.activateVipAfterPayment(
        'buyer-1',
        'order-1',
        'gift-1',
        399,
        { title: 'VIP 礼包' },
        'pkg-399',
        0,
      ),
    ).rejects.toThrow('digital asset down');

    expect(prismaMock.vipPurchase.update).toHaveBeenCalledWith({
      where: { id: 'vp-1' },
      data: {
        activationStatus: 'FAILED',
        activationError: 'digital asset down',
      },
    });
  });
});
