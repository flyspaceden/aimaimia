import { AdminBonusService } from './admin-bonus.service';
import { WithdrawPayoutService } from '../../bonus/withdraw-payout.service';

describe('AdminBonusService manual withdrawal reconciliation', () => {
  it.each([
    ['WECHAT', '微信'],
    ['ALIPAY', '支付宝'],
  ])('delegates %s to the channel-aware payout reconciler', async (channel, label) => {
    const payout = {
      manualReconcileWithdrawal: jest.fn().mockResolvedValue({
        status: 'PROCESSING',
        channel,
        providerStatus: 'PROCESSING',
      }),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => token === WithdrawPayoutService ? payout : undefined),
    };
    const service = new AdminBonusService(
      {} as any,
      {} as any,
      moduleRef as any,
      {} as any,
      {} as any,
    );

    await expect(service.manualQueryWithdrawStatus('withdraw-1')).resolves.toEqual({
      ok: true,
      message: `${label}侧仍在处理中，请稍后再查或等待补偿任务`,
      newStatus: 'PROCESSING',
    });
    expect(payout.manualReconcileWithdrawal).toHaveBeenCalledWith('withdraw-1');
  });
});
