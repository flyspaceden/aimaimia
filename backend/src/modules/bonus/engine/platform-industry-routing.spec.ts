import { NormalPlatformSplitService } from './normal-platform-split.service';
import { VipPlatformSplitService } from './vip-platform-split.service';

describe('新产业基金隔离个人钱包', () => {
  it.each([
    [NormalPlatformSplitService, 'NORMAL_PLATFORM_SPLIT'],
    [VipPlatformSplitService, 'VIP_PLATFORM_SPLIT'],
  ] as const)('%s 仅向公司账本交接且其余基金保持原分配', async (Service, scheme) => {
    const companyLedger = { accrueInTransaction: jest.fn().mockResolvedValue(undefined) };
    const service = new Service(companyLedger as never);
    const tx = {
      rewardAccount: { findUnique: jest.fn().mockResolvedValue({ id: 'platform' }), update: jest.fn() },
      rewardLedger: { create: jest.fn() },
      companyStaff: { findFirst: jest.fn() },
    };
    await service.split(tx, 'allocation', 'order', { platformProfit: 49, directReferralPool: 1, industryFund: 16, charityFund: 8, techFund: 8, reserveFund: 2 }, { 'company-a': .6, 'company-b': .4 });
    expect(companyLedger.accrueInTransaction).toHaveBeenCalledWith(tx, {
      allocationId: 'allocation', orderId: 'order', amount: 16,
      companyProfitShares: { 'company-a': .6, 'company-b': .4 }, scheme,
    });
    expect(tx.companyStaff.findFirst).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create.mock.calls.map(([arg]) => arg.data.meta.accountType)).toEqual(['PLATFORM_PROFIT', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND']);
  });
});
