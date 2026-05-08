import { Prisma } from '@prisma/client';
import { BonusService } from './bonus.service';

/**
 * 回归测试：CRIT-1 — VIP 激活重试路径状态机错位
 *
 * 历史 bug：
 *   prepare tx 把 FAILED → RETRYING 后，inner tx 的 CAS 期望状态是 FAILED，
 *   导致 CAS 永远命中 0 行，重试路径永远跳过授奖代码块，
 *   推荐人永远拿不到 VIP 推荐奖（每单可能丢失数十至数百元）。
 *
 * 本测试验证：
 *   1. retrying=true 时 CAS 期望状态包含 'RETRYING'（而非 'FAILED'）
 *   2. retrying=false 时 CAS 期望状态包含 'PENDING'
 *   3. 两条路径都把状态推进到 'ACTIVATING'
 */
describe('BonusService.activateVipAfterPayment — CAS 状态机契约', () => {
  function buildService(prismaMock: any) {
    const bonusConfig = { getConfig: jest.fn().mockResolvedValue({}) } as any;
    const couponEngine = {} as any;
    const inboxService = {} as any;
    return new BonusService(
      prismaMock,
      bonusConfig,
      couponEngine,
      inboxService,
    );
  }

  /**
   * 让 $transaction 直接执行 callback，返回它的结果。
   * 同时把 prisma 顶层 mock 当作 tx 传给回调（共用同一个 mock）。
   */
  function makeTxRunner(prismaMock: any) {
    return async (cb: any) => cb(prismaMock);
  }

  it('重试路径：CAS 期望状态必须是 RETRYING（防止 CRIT-1 回归）', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });

    const prismaMock: any = {
      vipPurchase: {
        // prepare tx 看到 FAILED 状态
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'vp-1',
            userId: 'invitee-1',
            orderId: 'order-1',
            activationStatus: 'FAILED',
            referralBonusRate: 0.15,
          })
          // inner tx 在 CAS 后再次 findUnique
          .mockResolvedValueOnce({
            id: 'vp-1',
            userId: 'invitee-1',
            orderId: 'order-1',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 399,
          }),
        // prepare tx 把 FAILED 改成 RETRYING
        update: jest.fn().mockResolvedValue({
          id: 'vp-1',
          activationStatus: 'RETRYING',
        }),
        // 关键断言点：inner tx 的 CAS
        updateMany: updateManyMock,
      },
      memberProfile: {
        // 让 inner tx 走"已是 VIP，补记激活成功"的最短路径，
        // 不需要 mock 后面的 grantVipReferralBonus / 树插入等
        findUnique: jest.fn().mockResolvedValue({
          userId: 'invitee-1',
          tier: 'VIP',
          inviterUserId: 'inviter-1',
          referralCode: 'ABC12345',
        }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await service.activateVipAfterPayment(
      'invitee-1',
      'order-1',
      'gift-1',
      399,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.15,
    );

    // 关键断言：CAS where.activationStatus.in 必须是 ['RETRYING']，绝不能是 ['FAILED']
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0][0];
    expect(call.where.id).toBe('vp-1');
    expect(call.where.activationStatus).toEqual({ in: ['RETRYING'] });
    expect(call.data.activationStatus).toBe('ACTIVATING');
  });

  it('首次激活路径：CAS 期望状态必须是 PENDING', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });

    const prismaMock: any = {
      vipPurchase: {
        // prepare tx 看到无现存记录 → 走 create 分支
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-2',
            userId: 'invitee-2',
            orderId: 'order-2',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 399,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-2',
          activationStatus: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: updateManyMock,
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'invitee-2',
          tier: 'VIP',
          inviterUserId: 'inviter-2',
          referralCode: 'XYZ98765',
        }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await service.activateVipAfterPayment(
      'invitee-2',
      'order-2',
      'gift-2',
      399,
      { title: 'VIP 礼包' },
      'pkg-2',
      0.15,
    );

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0][0];
    expect(call.where.id).toBe('vp-2');
    expect(call.where.activationStatus).toEqual({ in: ['PENDING'] });
    expect(call.data.activationStatus).toBe('ACTIVATING');
  });

  it('CAS 命中 0 行（被其他流程接管）应安全返回，不抛错', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 0 });

    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'vp-3',
          userId: 'invitee-3',
          orderId: 'order-3',
          activationStatus: 'FAILED',
          referralBonusRate: 0.15,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'vp-3',
          activationStatus: 'RETRYING',
        }),
        updateMany: updateManyMock,
      },
      memberProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await expect(
      service.activateVipAfterPayment(
        'invitee-3',
        'order-3',
        'gift-3',
        399,
        { title: 'VIP 礼包' },
        'pkg-3',
        0.15,
      ),
    ).resolves.toBeUndefined();

    // CAS 命中 0 行后，inner tx 应直接 return，不再去查 memberProfile
    expect(prismaMock.memberProfile.findUnique).not.toHaveBeenCalled();
  });
});
